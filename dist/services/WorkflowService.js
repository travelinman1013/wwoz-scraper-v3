import dayjs from 'dayjs';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { ShowGuesser } from '../utils/showGuesser.js';
import { resolveSongDayString, buildWwozDisplayTitle } from '../utils/date.js';
export class WorkflowService {
    scraper;
    enricher;
    archiver;
    showGuesser;
    immediateRunRequested = false;
    immediateEmitter = new EventEmitter();
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
        // Process newest-first to hit fresh items and stop early on dups in continuous mode
        const songsOrdered = songs.slice().sort((a, b) => this.sortKeyForSong(b) - this.sortKeyForSong(a));
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
        // Reset and load a fresh cache
        if (this.enricher.clearPlaylistCache) {
            Logger.debug('Clearing all in-memory Spotify playlist caches before loading fresh state...');
            this.enricher.clearPlaylistCache();
        }
        await this.enricher.loadPlaylistCache(playlistId);
        const initialCount = typeof this.enricher.getCachedTrackCount === 'function'
            ? this.enricher.getCachedTrackCount(playlistId)
            : 0;
        // Clear archiver in-memory dedup at start
        if (typeof this.archiver.clearDedupCache === 'function') {
            this.archiver.clearDedupCache();
        }
        let processed = 0;
        let added = 0;
        const pendingAdds = [];
        let duplicatesInARow = 0;
        let stoppedDueToDuplicates = false;
        let archiveDuplicatesInARow = 0;
        let archiveDuplicatesTotal = 0;
        let archiveDuplicatesMaxStreak = 0;
        // We still track archive duplicate stats but no longer stop early.
        for (const song of songsOrdered) {
            processed++;
            const archivedAt = new Date().toISOString();
            try {
                // Determine the song's calendar day using playedDate when present
                const songDay = resolveSongDayString(song.playedDate, archivedAt || song.scrapedAt);
                const todayStr = dayjs().format('YYYY-MM-DD');
                const isTodaySong = songDay === todayStr;
                Logger.debug(`Date routing: ${song.artist || '-'} - ${song.title || '-'} | playedDate=${song.playedDate || '-'} ` +
                    `playedTime=${song.playedTime || '-'} -> songDay=${songDay} (today=${todayStr}, isToday=${isTodaySong})`);
                // Enrich show/host using per-row played time (fallback to scrapedAt)
                const programInfo = this.showGuesser.guessShowFromLocalParts(song.playedDate, song.playedTime, song.scrapedAt);
                if (programInfo) {
                    song.show = programInfo.show;
                    song.host = programInfo.host;
                }
                // Early duplicate detection against archive
                if (typeof this.archiver.wasArchived === 'function') {
                    const alreadyArchived = await this.archiver.wasArchived({
                        song,
                        status: 'unknown',
                        archivedAt,
                    });
                    if (alreadyArchived) {
                        archiveDuplicatesInARow++;
                        archiveDuplicatesTotal++;
                        if (archiveDuplicatesInARow > archiveDuplicatesMaxStreak) {
                            archiveDuplicatesMaxStreak = archiveDuplicatesInARow;
                        }
                        // Do not log each archive duplicate to keep logs concise; summarized at end of run.
                        // Do not process further for archive duplicates
                        continue;
                    }
                }
                const match = await this.enricher.findMatch(song);
                if (!match) {
                    // Not found (or below confidence threshold)
                    duplicatesInARow = 0;
                    archiveDuplicatesInARow = 0; // reset archive-dup streak on any non-dup outcome
                    Logger.info(`No Spotify match: archiving as NOT FOUND (day=${songDay}).`);
                    await this.archiveOutcome(song, 'not_found', archivedAt);
                    continue;
                }
                // Check for duplicate in Spotify playlist
                const isDup = await this.enricher.isDuplicate(playlistId, match.track.id);
                if (isDup) {
                    duplicatesInARow++;
                    archiveDuplicatesInARow = 0; // reset archive-dup streak on spotify-dup
                    await this.archiveOutcome(song, 'found', archivedAt, match);
                    if (duplicatesInARow >= 5) {
                        Logger.info('Encountered 5 consecutive Spotify duplicates; stopping early.');
                        stoppedDueToDuplicates = true;
                        break;
                    }
                    continue;
                }
                // New addition: archive first, then queue for playlist add
                duplicatesInARow = 0;
                archiveDuplicatesInARow = 0; // reset archive-dup streak on new addition
                await this.archiveOutcome(song, 'found', archivedAt, match);
                const minutes = this.parsePlayedTimeToMinutes(song.playedTime);
                const timeKey = minutes !== null
                    ? minutes
                    : (() => {
                        const t = dayjs(song.scrapedAt || archivedAt);
                        return t.isValid() ? t.hour() * 60 + t.minute() : Number.MAX_SAFE_INTEGER;
                    })();
                pendingAdds.push({ uri: match.track.uri, id: match.track.id, timeKey });
            }
            catch (err) {
                duplicatesInARow = 0; // treat errors as non-dup to avoid premature stop
                Logger.error('Error processing song. Continuing with next.', err);
                await this.archiveOutcome(song, 'unknown', archivedAt);
            }
            if (stoppedDueToDuplicates)
                break;
        }
        // Perform buffered playlist additions in chronological order (to match archive)
        try {
            if (pendingAdds.length > 0) {
                if (this.enricher.clearPlaylistCache)
                    this.enricher.clearPlaylistCache(playlistId);
                await this.enricher.loadPlaylistCache(playlistId);
                pendingAdds.sort((a, b) => a.timeKey - b.timeKey);
                for (const item of pendingAdds) {
                    const dup = await this.enricher.isDuplicate(playlistId, item.id);
                    if (dup)
                        continue;
                    await this.enricher.addToPlaylist(playlistId, item.uri);
                    added++;
                }
            }
        }
        catch (err) {
            Logger.error('Failed during deferred playlist additions (non-fatal).', err);
        }
        // Optionally refresh to compute actual added count from remote
        let remoteAdded = added;
        try {
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
        const stopNote = stoppedDueToDuplicates
            ? ' (stopped after 5 consecutive Spotify duplicates)'
            : '';
        Logger.info(`Workflow run finished. Processed=${processed}, Added=${remoteAdded}.${stopNote}`);
        Logger.info(`Archive duplicate check: total=${archiveDuplicatesTotal}, maxStreak=${archiveDuplicatesMaxStreak}`);
        // Recompute and update per-day stats in the markdown archive (best-effort)
        try {
            if (typeof this.archiver.finalizeDailyStats === 'function') {
                await this.archiver.finalizeDailyStats(dayjs().format('YYYY-MM-DD'));
            }
        }
        catch (err) {
            Logger.error('Failed to update archive statistics (non-fatal).', err);
        }
        // End-of-day snapshot: ensure yesterday's playlist
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
        // If a manual refresh was requested already, skip waiting entirely.
        if (this.immediateRunRequested) {
            this.immediateRunRequested = false;
            Logger.info('Manual refresh requested. Starting new run now...');
            return;
        }
        let remaining = Math.max(0, Math.floor(totalSeconds));
        while (remaining > 0) {
            const step = Math.min(tickSeconds, remaining);
            // Race the timeout against a manual trigger event for immediate refresh
            await Promise.race([
                new Promise((resolve) => setTimeout(resolve, step * 1000)),
                new Promise((resolve) => this.immediateEmitter.once('trigger', resolve)),
            ]);
            if (this.immediateRunRequested) {
                this.immediateRunRequested = false;
                Logger.info('Manual refresh requested. Starting new run now...');
                return;
            }
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
        const minutes = this.parsePlayedTimeToMinutes(song.playedTime);
        const d = song.playedDate ? dayjs(song.playedDate) : null;
        if (minutes !== null && d && d.isValid()) {
            const dayStartMs = d.startOf('day').valueOf();
            return Math.floor(dayStartMs / 60000) + minutes;
        }
        if (minutes !== null)
            return minutes;
        const t = dayjs(song.scrapedAt);
        if (t.isValid())
            return Math.floor(t.valueOf() / 60000);
        return Math.floor(Date.now() / 60000);
    }
    async archiveOutcome(song, status, archivedAt, match) {
        const entry = { song, status, archivedAt };
        if (match) {
            entry.confidence = match.confidence;
            const id = match.track.id;
            if (id)
                entry.spotifyUrl = `https://open.spotify.com/track/${id}`;
            entry.match = match;
        }
        await this.archiver.archive(entry);
    }
    // Public API: allow external callers (e.g., CLI key handler) to request an immediate run.
    requestImmediateRun() {
        this.immediateRunRequested = true;
        // Wake any pending wait so the next run can start immediately.
        this.immediateEmitter.emit('trigger');
    }
    async createDailySnapshotPlaylistFromArchive(date) {
        const archiverAny = this.archiver;
        if (typeof archiverAny.getDailySpotifyTrackUris !== 'function')
            return;
        const uris = await archiverAny.getDailySpotifyTrackUris(date);
        if (!uris || uris.length === 0)
            return;
        const d = dayjs(date);
        const playlistName = d.isValid() ? buildWwozDisplayTitle(d) : `WWOZ ${date}`;
        const pl = await this.enricher.getOrCreatePlaylist(playlistName);
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
