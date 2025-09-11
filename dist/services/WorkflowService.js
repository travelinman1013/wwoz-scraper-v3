import dayjs from 'dayjs';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { ShowGuesser } from '../utils/showGuesser.js';
export class WorkflowService {
    scraper;
    enricher;
    archiver;
    showGuesser;
    constructor(scraper, enricher, archiver) {
        this.scraper = scraper;
        this.enricher = enricher;
        this.archiver = archiver;
        this.showGuesser = new ShowGuesser();
    }
    async runOnce() {
        Logger.info(`Workflow run started. dryRun=${config.dryRun}. Scraping playlist...`);
        const songs = await this.scraper.scrape();
        if (songs.length === 0) {
            Logger.warn('No songs scraped. Nothing to process.');
            return;
        }
        // Resolve target playlist
        let playlistId;
        let playlistName;
        if (config.spotify.staticPlaylistId && config.spotify.staticPlaylistId.trim().length > 0) {
            playlistId = config.spotify.staticPlaylistId.trim();
            playlistName = 'Static Playlist';
            Logger.info(`Using static playlist ID from config: ${playlistId}`);
        }
        else {
            const dailyName = this.buildPlaylistName();
            const pl = await this.enricher.getOrCreatePlaylist(dailyName);
            playlistId = pl.id;
            playlistName = pl.name;
        }
        // Reset and load a fresh cache to reflect current remote state
        if (this.enricher.clearPlaylistCache)
            this.enricher.clearPlaylistCache(playlistId);
        await this.enricher.loadPlaylistCache(playlistId);
        const initialCount = typeof this.enricher.getCachedTrackCount === 'function'
            ? this.enricher.getCachedTrackCount(playlistId)
            : 0;
        let processed = 0;
        let added = 0;
        let duplicatesInARow = 0;
        let stoppedDueToDuplicates = false;
        for (const song of songs) {
            processed++;
            const archivedAt = new Date().toISOString();
            try {
                // Enrich show/host using per-row played time (fallback to scrapedAt)
                const programInfo = this.showGuesser.guessShowFromLocalParts(song.playedDate, song.playedTime, song.scrapedAt);
                if (programInfo) {
                    song.show = programInfo.show;
                    song.host = programInfo.host;
                }
                const match = await this.enricher.findMatch(song);
                if (!match) {
                    // Not found (or below confidence threshold)
                    duplicatesInARow = 0;
                    await this.archiveOutcome(song, 'not_found', archivedAt);
                    continue;
                }
                // Found a match; if confidence is unexpectedly low, mark and archive
                if (match.confidence < 70) {
                    duplicatesInARow = 0;
                    await this.archiveOutcome(song, 'low_confidence', archivedAt, match);
                    continue;
                }
                // Found a confident match; check playlist duplication
                const isDup = await this.enricher.isDuplicate(playlistId, match.track.id);
                if (isDup) {
                    duplicatesInARow++;
                    Logger.info(`Duplicate in ${playlistName}: ${song.artist} - ${song.title} (track ${match.track.id}). ${duplicatesInARow} dup(s) in a row.`);
                    await this.archiveOutcome(song, 'found', archivedAt, match);
                    if (duplicatesInARow >= 5) {
                        Logger.info('Reached 5 consecutive duplicates. Stopping early.');
                        stoppedDueToDuplicates = true;
                        break;
                    }
                    continue;
                }
                // New addition
                duplicatesInARow = 0;
                await this.enricher.addToPlaylist(playlistId, match.track.uri);
                added++;
                await this.archiveOutcome(song, 'found', archivedAt, match);
            }
            catch (err) {
                duplicatesInARow = 0; // treat errors as non-dup to avoid premature stop
                Logger.error('Error processing song. Continuing with next.', err);
                // Archive as unknown to capture the occurrence
                await this.archiveOutcome(song, 'unknown', archivedAt);
            }
            if (stoppedDueToDuplicates)
                break;
        }
        // Optionally refresh to compute actual added count from remote
        let remoteAdded = added;
        try {
            if (this.enricher.clearPlaylistCache)
                this.enricher.clearPlaylistCache(playlistId);
            await this.enricher.loadPlaylistCache(playlistId);
            const finalCount = typeof this.enricher.getCachedTrackCount === 'function'
                ? this.enricher.getCachedTrackCount(playlistId)
                : initialCount + added;
            remoteAdded = Math.max(0, finalCount - initialCount);
        }
        catch {
            // ignore; fall back to local counter
        }
        const stopNote = stoppedDueToDuplicates ? ' (stopped after 5 consecutive duplicates)' : '';
        Logger.info(`Workflow run finished. Processed=${processed}, Added=${remoteAdded}.${stopNote}`);
        // Recompute and update per-day stats in the markdown archive (best-effort)
        try {
            if (typeof this.archiver.finalizeDailyStats === 'function') {
                // Update today's archive file since archivedAt is based on run time
                await this.archiver.finalizeDailyStats(dayjs().format('YYYY-MM-DD'));
            }
        }
        catch (err) {
            Logger.error('Failed to update archive statistics (non-fatal).', err);
        }
    }
    async runContinuous() {
        const intervalSec = Math.max(5, Number(config.wwoz.scrapeIntervalSeconds) || 300);
        Logger.info(`Entering continuous mode. Interval=${intervalSec}s`);
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                await this.runOnce();
            }
            catch (err) {
                Logger.error('Run failed; continuing after delay.', err);
            }
            Logger.info(`Waiting ${intervalSec}s before next run...`);
            await this.waitSeconds(intervalSec);
        }
    }
    waitSeconds(seconds) {
        return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
    buildPlaylistName() {
        const today = dayjs().format('YYYY-MM-DD');
        return `WWOZ Discoveries - ${today}`;
    }
    async archiveOutcome(song, status, archivedAt, match) {
        const entry = {
            song,
            status,
            archivedAt,
        };
        if (match) {
            entry.confidence = match.confidence;
            const id = match.track.id;
            if (id)
                entry.spotifyUrl = `https://open.spotify.com/track/${id}`;
            entry.match = match;
        }
        await this.archiver.archive(entry);
    }
}
