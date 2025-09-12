import dayjs from 'dayjs';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { ShowGuesser } from '../utils/showGuesser.js';
import { resolveSongDayString } from '../utils/date.js';
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
        // Process in reverse-chronological order (newest -> oldest) so that
        // continuous mode hits fresh items first and stops after encountering
        // recent duplicates, enabling quick resume when new tracks appear.
        const songsOrdered = songs.slice().sort((a, b) => {
            const aKey = this.sortKeyForSong(a);
            const bKey = this.sortKeyForSong(b);
            return bKey - aKey;
        });
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
        // Clear all cached playlists to avoid any cross-run leakage
        if (this.enricher.clearPlaylistCache) {
            Logger.debug('Clearing all in-memory Spotify playlist caches before loading fresh state...');
            this.enricher.clearPlaylistCache();
        }
        await this.enricher.loadPlaylistCache(playlistId);
        const initialCount = typeof this.enricher.getCachedTrackCount === 'function'
            ? this.enricher.getCachedTrackCount(playlistId)
            : 0;
        // Clear archiver's in-memory duplicate cache at the start of each run/session
        if (typeof this.archiver.clearDedupCache === 'function') {
            this.archiver.clearDedupCache();
        }
        let processed = 0;
        let added = 0;
        let duplicatesInARow = 0;
        let stoppedDueToDuplicates = false;
        for (const song of songsOrdered) {
            processed++;
            const archivedAt = new Date().toISOString();
            try {
                // Determine the song's calendar day using playedDate when present
                const songDay = resolveSongDayString(song.playedDate, archivedAt || song.scrapedAt);
                const todayStr = dayjs().format('YYYY-MM-DD');
                const isTodaySong = songDay === todayStr;
                // Enrich show/host using per-row played time (fallback to scrapedAt)
                const programInfo = this.showGuesser.guessShowFromLocalParts(song.playedDate, song.playedTime, song.scrapedAt);
                if (programInfo) {
                    song.show = programInfo.show;
                    song.host = programInfo.host;
                }
                // Early duplicate detection against archive (covers NOT FOUND duplicates)
                if (typeof this.archiver.wasArchived === 'function') {
                    const alreadyArchived = await this.archiver.wasArchived({
                        song,
                        status: 'unknown',
                        archivedAt,
                    });
                    if (alreadyArchived) {
                        // Do NOT count archive duplicates toward the stop threshold.
                        // The stop heuristic should be driven by Spotify playlist duplicates only.
                        Logger.info(`Archive duplicate encountered (ignored for stop-threshold): ${song.artist} - ${song.title}.`);
                        continue;
                    }
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
                // If the song belongs to a different day, do not add it to today's
                // discovery playlist. Still archive it (to its own day) below.
                if (!isTodaySong) {
                    await this.archiveOutcome(song, 'found', archivedAt, match);
                    continue;
                }
                // Found a confident match; check playlist duplication (only for today's songs)
                const isDup = await this.enricher.isDuplicate(playlistId, match.track.id);
                if (isDup) {
                    duplicatesInARow++;
                    Logger.info(`Spotify duplicate in ${playlistName}: ${song.artist} - ${song.title} (track ${match.track.id}). ${duplicatesInARow} dup(s) in a row.`);
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
            // Clear all cached playlists again before recompute to ensure accuracy
            if (this.enricher.clearPlaylistCache) {
                Logger.debug('Clearing all in-memory Spotify playlist caches before recomputing final counts...');
                this.enricher.clearPlaylistCache();
            }
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
        // End-of-day snapshot: create a new Spotify playlist for yesterday
        // based on the archived, chronologically ordered song list.
        try {
            await this.createDailySnapshotPlaylistFromArchive(dayjs().subtract(1, 'day').format('YYYY-MM-DD'));
        }
        catch (err) {
            Logger.error('Failed to create daily snapshot Spotify playlist (non-fatal).', err);
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
            await this.waitWithCountdown(intervalSec, 100);
        }
    }
    async waitWithCountdown(totalSeconds, tickSeconds = 100) {
        let remaining = Math.max(0, Math.floor(totalSeconds));
        while (remaining > 0) {
            const step = Math.min(tickSeconds, remaining);
            await new Promise((resolve) => setTimeout(resolve, step * 1000));
            remaining -= step;
            if (remaining > 0) {
                Logger.info(`Next refresh in ${remaining} seconds`);
            }
        }
    }
    buildPlaylistName() {
        const today = dayjs();
        return `WWOZ Discoveries - ${today.format('dddd')} ${today.format('YYYY-MM-DD')}`;
    }
    parsePlayedTimeToMinutes(playedTime) {
        if (!playedTime)
            return null;
        const s = playedTime.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
        const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
        if (ampm) {
            let hh = parseInt(ampm[1], 10);
            const mm = parseInt(ampm[2], 10);
            const mer = ampm[3].toLowerCase();
            if (mer === 'am') {
                if (hh === 12)
                    hh = 0;
            }
            else if (mer === 'pm') {
                if (hh !== 12)
                    hh += 12;
            }
            return hh * 60 + mm;
        }
        const h24 = s.match(/^(\d{1,2}):(\d{2})$/);
        if (h24) {
            const hh = parseInt(h24[1], 10);
            const mm = parseInt(h24[2], 10);
            return hh * 60 + mm;
        }
        return null;
    }
    sortKeyForSong(song) {
        // Try to build an absolute minutes-since-epoch key if playedDate is parsable
        const minutes = this.parsePlayedTimeToMinutes(song.playedTime);
        const d = song.playedDate ? dayjs(song.playedDate) : null;
        if (minutes !== null && d && d.isValid()) {
            const dayStartMs = d.startOf('day').valueOf();
            return Math.floor(dayStartMs / 60000) + minutes;
        }
        // If only time-of-day is available, use minutes (sort within the same day)
        if (minutes !== null)
            return minutes;
        // Fallback to scrapedAt/archivedAt timestamps converted to minutes
        const t = dayjs(song.scrapedAt);
        if (t.isValid())
            return Math.floor(t.valueOf() / 60000);
        return Math.floor(Date.now() / 60000);
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
    async createDailySnapshotPlaylistFromArchive(date) {
        // Archiver must support extracting track URIs from the archive.
        const archiverAny = this.archiver;
        if (typeof archiverAny.getDailySpotifyTrackUris !== 'function')
            return;
        const uris = await archiverAny.getDailySpotifyTrackUris(date);
        if (!uris || uris.length === 0)
            return;
        const d = dayjs(date);
        const playlistName = `WWOZTracker ${d.isValid() ? d.format('dddd') + ' ' : ''}${date}`;
        const pl = await this.enricher.getOrCreatePlaylist(playlistName);
        // Ensure we operate against fresh remote state for the snapshot playlist
        if (this.enricher.clearPlaylistCache)
            this.enricher.clearPlaylistCache(pl.id);
        await this.enricher.loadPlaylistCache(pl.id);
        let added = 0;
        for (const uri of uris) {
            const id = uri.replace('spotify:track:', '');
            const dup = await this.enricher.isDuplicate(pl.id, id);
            if (dup)
                continue;
            await this.enricher.addToPlaylist(pl.id, uri);
            added++;
        }
        Logger.info(`Daily snapshot playlist ensured: ${playlistName}. Tracks added=${added}.`);
    }
    async backfillDailySnapshots(days) {
        const n = Math.max(1, Math.floor(days));
        for (let i = 1; i <= n; i++) {
            const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
            try {
                await this.createDailySnapshotPlaylistFromArchive(date);
            }
            catch (err) {
                Logger.error(`Failed to create snapshot for ${date} (non-fatal).`, err);
            }
        }
    }
}
