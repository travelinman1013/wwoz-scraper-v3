import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { ShowGuesser } from '../utils/showGuesser.js';
import { resolveSongDayString, buildWwozDisplayTitle } from '../utils/date.js';
import { ArtistDiscoveryService } from './ArtistDiscoveryService.js';
import { PlaylistArchiver } from './PlaylistArchiver.js';
import type { IArchiver, IEnricher, IScraper, ScrapedSong, TrackMatch, ArchiveEntry } from '../types/index.js';

export class WorkflowService {
  private scraper: IScraper;
  private enricher: IEnricher;
  private archiver: IArchiver;
  private showGuesser: ShowGuesser;
  private artistDiscoveryService: ArtistDiscoveryService | null = null;
  private playlistArchiver: PlaylistArchiver | null = null;
  private pendingArchivePath: string | null = null;
  private immediateRunRequested = false;
  private immediateEmitter = new EventEmitter();
  private runCounter = 0;

  constructor(scraper: IScraper, enricher: IEnricher, archiver: IArchiver) {
    this.scraper = scraper;
    this.enricher = enricher;
    this.archiver = archiver;
    this.showGuesser = new ShowGuesser();

    // Initialize artist discovery if enabled
    if (config.artistDiscovery?.enabled) {
      this.artistDiscoveryService = new ArtistDiscoveryService();
      Logger.info('Artist Discovery Service initialized.');
    }

    // Initialize playlist archiver if enabled
    if (config.playlistArchiving?.enabled) {
      // Type assertion needed because enricher is IEnricher interface
      this.playlistArchiver = new PlaylistArchiver(enricher as any);
      Logger.info('Playlist Archiver initialized.');
    }
  }

  async runOnce(): Promise<void> {
    Logger.info(`Workflow run started. dryRun=${config.dryRun}. Scraping playlist...`);
    const songs = await this.scraper.scrape();
    if (songs.length === 0) {
      Logger.warn('No songs scraped. Nothing to process.');
      return;
    }

    // Process newest-first to hit fresh items and stop early on dups in continuous mode
    const songsOrdered = songs.slice().sort((a, b) => this.sortKeyForSong(b) - this.sortKeyForSong(a));

    // Resolve target playlist
    let playlistId: string;
    let playlistName: string;
    if (config.spotify.staticPlaylistId && config.spotify.staticPlaylistId.trim().length > 0) {
      playlistId = config.spotify.staticPlaylistId.trim();
      playlistName = 'Static Playlist';
      Logger.info(`Using static playlist ID from config: ${playlistId}`);
    } else {
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
      ? this.enricher.getCachedTrackCount!(playlistId)
      : 0;

    // Clear archiver in-memory dedup at start
    if (typeof this.archiver.clearDedupCache === 'function') {
      this.archiver.clearDedupCache!();
    }

    let processed = 0;
    let added = 0;
    const pendingAdds: { uri: string; id: string; timeKey: number }[] = [];
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
        Logger.debug(
          `Date routing: ${song.artist || '-'} - ${song.title || '-'} | playedDate=${song.playedDate || '-'} ` +
            `playedTime=${song.playedTime || '-'} -> songDay=${songDay} (today=${todayStr}, isToday=${isTodaySong})`
        );

        // Enrich show/host using per-row played time (fallback to scrapedAt)
        const programInfo = this.showGuesser.guessShowFromLocalParts(song.playedDate, song.playedTime, song.scrapedAt);
        if (programInfo) {
          song.show = programInfo.show;
          song.host = programInfo.host;
        }

        // Early duplicate detection against archive
        if (typeof this.archiver.wasArchived === 'function') {
          const alreadyArchived = await this.archiver.wasArchived!({
            song,
            status: 'unknown',
            archivedAt,
          } as ArchiveEntry);
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
      } catch (err) {
        duplicatesInARow = 0; // treat errors as non-dup to avoid premature stop
        Logger.error('Error processing song. Continuing with next.', err as Error);
        await this.archiveOutcome(song, 'unknown', archivedAt);
      }
      if (stoppedDueToDuplicates) break;
    }

    // Perform buffered playlist additions in chronological order (to match archive)
    try {
      if (pendingAdds.length > 0) {
        if (this.enricher.clearPlaylistCache) this.enricher.clearPlaylistCache(playlistId);
        await this.enricher.loadPlaylistCache(playlistId);
        pendingAdds.sort((a, b) => a.timeKey - b.timeKey);
        for (const item of pendingAdds) {
          const dup = await this.enricher.isDuplicate(playlistId, item.id);
          if (dup) continue;
          await this.enricher.addToPlaylist(playlistId, item.uri);
          added++;
        }
      }
    } catch (err) {
      Logger.error('Failed during deferred playlist additions (non-fatal).', err as Error);
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
        ? this.enricher.getCachedTrackCount!(playlistId)
        : initialCount + added;
      remoteAdded = Math.max(0, finalCount - initialCount);
    } catch {
      // ignore; fall back to local counter
    }

    const stopNote = stoppedDueToDuplicates
      ? ' (stopped after 5 consecutive Spotify duplicates)'
      : '';
    Logger.info(`Workflow run finished. Processed=${processed}, Added=${remoteAdded}.${stopNote}`);
    Logger.info(
      `Archive duplicate check: total=${archiveDuplicatesTotal}, maxStreak=${archiveDuplicatesMaxStreak}`
    );

    // Recompute and update per-day stats in the markdown archive (best-effort)
    try {
      if (typeof this.archiver.finalizeDailyStats === 'function') {
        await this.archiver.finalizeDailyStats!(dayjs().format('YYYY-MM-DD'));
      }
    } catch (err) {
      Logger.error('Failed to update archive statistics (non-fatal).', err as Error);
    }

    // End-of-day snapshot: ensure yesterday's playlist
    try {
      await this.createDailySnapshotPlaylistFromArchive(dayjs().subtract(1, 'day').format('YYYY-MM-DD'));
    } catch (err) {
      Logger.error('Failed to create daily snapshot Spotify playlist (non-fatal).', err as Error);
    }

    // Check if playlist archiving should occur (periodic check)
    this.runCounter++;
    if (this.playlistArchiver && config.playlistArchiving?.enabled) {
      const { checkIntervalRuns } = config.playlistArchiving;
      if (this.runCounter % checkIntervalRuns === 0) {
        try {
          const shouldArchive = await this.playlistArchiver.shouldArchive();
          if (shouldArchive) {
            Logger.info('Playlist duration threshold reached. Starting archiving process...');
            await this.playlistArchiver.archivePlaylist();
          }
        } catch (err) {
          Logger.error('Failed to check or execute playlist archiving (non-fatal).', err as Error);
        }
      }
    }
  }

  async runContinuous(): Promise<void> {
    const intervalSec = Math.max(5, Number(config.wwoz.scrapeIntervalSeconds) || 300);
    Logger.info(`Entering continuous mode. Interval=${intervalSec}s`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Check for delayed pending archive from ObsidianArchiver (new behavior)
      if (typeof this.archiver.getPendingArchiveIfReady === 'function' && this.artistDiscoveryService) {
        const archivePath = this.archiver.getPendingArchiveIfReady!();
        if (archivePath) {
          // Delay has elapsed, ready to process
          if (typeof this.archiver.clearPendingArchive === 'function') {
            this.archiver.clearPendingArchive!();
          }

          if (await this.fileExists(archivePath)) {
            Logger.info(`[Artist Discovery] Processing delayed pending archive: ${archivePath}`);
            // Fire and forget: run artist discovery in background
            this.artistDiscoveryService.processArchive(archivePath).catch((err) => {
              Logger.error(`Artist discovery failed for ${archivePath}:`, err as Error);
            });
          } else {
            Logger.warn(`[Artist Discovery] Delayed pending archive not found: ${archivePath}`);
          }
        }
      }

      // Process immediate pending archive from day change (legacy behavior for dayChangeDelayHours=0)
      if (this.pendingArchivePath && this.artistDiscoveryService) {
        const archivePath = this.pendingArchivePath;
        this.pendingArchivePath = null;

        // Verify the archive file exists before processing
        if (await this.fileExists(archivePath)) {
          Logger.info(`[Artist Discovery] Processing immediate pending archive: ${archivePath}`);
          // Fire and forget: run artist discovery in background
          this.artistDiscoveryService.processArchive(archivePath).catch((err) => {
            Logger.error(`Artist discovery failed for ${archivePath}:`, err as Error);
          });
        } else {
          Logger.warn(`[Artist Discovery] Immediate pending archive not found: ${archivePath}`);
        }
      }

      try {
        await this.runOnce();
      } catch (err) {
        Logger.error('Run failed; continuing after delay.', err as Error);
      }

      Logger.info(`Waiting ${intervalSec}s before next run...`);
      await this.waitWithCountdown(intervalSec, 100);
    }
  }

  private async waitWithCountdown(totalSeconds: number, tickSeconds = 100): Promise<void> {
    // If a manual refresh was requested already, skip waiting entirely.
    if (this.immediateRunRequested) {
      this.immediateRunRequested = false;
      Logger.info('Manual refresh requested. Starting new run now...');
      return;
    }

    let remaining = Math.max(0, Math.floor(totalSeconds));
    while (remaining > 0) {
      const step = Math.min(tickSeconds, remaining);
      // Race the timeout against a manual trigger event for immediate refresh,
      // but ensure we always remove the event listener to avoid accumulating
      // listeners and hitting MaxListenersExceededWarning over long uptimes.
      await new Promise<void>((resolve) => {
        let timer: NodeJS.Timeout | null = null;
        const onTrigger = () => {
          if (timer) clearTimeout(timer);
          this.immediateEmitter.off('trigger', onTrigger);
          resolve();
        };
        timer = setTimeout(() => {
          this.immediateEmitter.off('trigger', onTrigger);
          resolve();
        }, step * 1000);
        this.immediateEmitter.on('trigger', onTrigger);
      });

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

  private buildPlaylistName(): string {
    const today = dayjs();
    return `WWOZ Discoveries - ${today.format('dddd')} ${today.format('YYYY-MM-DD')}`;
  }

  private parsePlayedTimeToMinutes(playedTime?: string): number | null {
    if (!playedTime) return null;
    const s = playedTime.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (ampm) {
      let hh = parseInt(ampm[1], 10);
      const mm = parseInt(ampm[2], 10);
      const mer = ampm[3].toLowerCase();
      if (mer === 'am') {
        if (hh === 12) hh = 0;
      } else if (mer === 'pm') {
        if (hh !== 12) hh += 12;
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

  private sortKeyForSong(song: ScrapedSong): number {
    const minutes = this.parsePlayedTimeToMinutes(song.playedTime);
    const d = song.playedDate ? dayjs(song.playedDate) : null;
    if (minutes !== null && d && d.isValid()) {
      const dayStartMs = d.startOf('day').valueOf();
      return Math.floor(dayStartMs / 60000) + minutes;
    }
    if (minutes !== null) return minutes;
    const t = dayjs(song.scrapedAt);
    if (t.isValid()) return Math.floor(t.valueOf() / 60000);
    return Math.floor(Date.now() / 60000);
  }

  private async archiveOutcome(song: ScrapedSong, status: ArchiveEntry['status'], archivedAt: string, match?: TrackMatch | null): Promise<void> {
    const entry: ArchiveEntry = { song, status, archivedAt };
    if (match) {
      entry.confidence = match.confidence;
      const id = match.track.id;
      if (id) entry.spotifyUrl = `https://open.spotify.com/track/${id}`;
      entry.match = match as unknown;
    }
    await this.archiver.archive(entry);
  }

  // Public API: allow external callers (e.g., CLI key handler) to request an immediate run.
  public requestImmediateRun(): void {
    this.immediateRunRequested = true;
    // Wake any pending wait so the next run can start immediately.
    this.immediateEmitter.emit('trigger');
  }

  // Public API: set the archiver after construction (for circular dependency resolution)
  public setArchiver(archiver: IArchiver): void {
    this.archiver = archiver;
  }

  // Public API: set pending archive path from day-change callback
  public setPendingArchive(archivePath: string): void {
    this.pendingArchivePath = archivePath;
    Logger.info(`[Artist Discovery] Pending archive queued: ${archivePath}`);
  }

  async createDailySnapshotPlaylistFromArchive(date: string): Promise<void> {
    const archiverAny = this.archiver as any;
    if (typeof archiverAny.getDailySpotifyTrackUris !== 'function') return;
    const uris: string[] = await archiverAny.getDailySpotifyTrackUris(date);
    if (!uris || uris.length === 0) return;
    const d = dayjs(date);
    const playlistName = d.isValid() ? buildWwozDisplayTitle(d) : `WWOZ ${date}`;
    const pl = await this.enricher.getOrCreatePlaylist(playlistName);
    if (this.enricher.clearPlaylistCache) this.enricher.clearPlaylistCache(pl.id);
    await this.enricher.loadPlaylistCache(pl.id);
    let added = 0;
    for (const uri of uris) {
      const id = uri.replace('spotify:track:', '');
      const dup = await this.enricher.isDuplicate(pl.id, id);
      if (dup) continue;
      await this.enricher.addToPlaylist(pl.id, uri);
      added++;
    }
    Logger.info(`Daily snapshot playlist ensured: ${playlistName}. Tracks added=${added}.`);
  }

  async backfillDailySnapshots(days: number): Promise<void> {
    const n = Math.max(1, Math.floor(days));
    for (let i = 1; i <= n; i++) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      try {
        await this.createDailySnapshotPlaylistFromArchive(date);
      } catch (err) {
        Logger.error(`Failed to create snapshot for ${date} (non-fatal).`, err as Error);
      }
    }
  }

  async backfillArtistDiscovery(days: number): Promise<void> {
    if (!this.artistDiscoveryService) {
      Logger.warn('Artist Discovery is not enabled; cannot backfill.');
      return;
    }

    const n = Math.max(1, Math.floor(days));
    Logger.info(`Starting artist discovery backfill for past ${n} day(s)...`);

    const basePath = config.archive.basePath;
    if (!basePath || basePath.trim().length === 0) {
      Logger.error('archive.basePath is not configured; cannot backfill.');
      return;
    }

    // Use ObsidianArchiver's path resolution logic
    const archiverAny = this.archiver as any;
    if (typeof archiverAny.getDailyFilePath !== 'function') {
      Logger.error('Archiver does not support getDailyFilePath; cannot backfill.');
      return;
    }

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 1; i <= n; i++) {
      const date = dayjs().subtract(i, 'day');
      const dateStr = date.format('YYYY-MM-DD');

      try {
        // Compute base root (strip year/month from path if present)
        const root = this.computeBaseRoot(basePath);
        const { filePath } = await archiverAny.getDailyFilePath(root, date);

        // Check if archive file exists
        if (!await this.fileExists(filePath)) {
          Logger.debug(`Archive file not found for ${dateStr}; skipping.`);
          skipped++;
          continue;
        }

        Logger.info(`Processing artist discovery for ${dateStr}...`);
        await this.artistDiscoveryService.processArchive(filePath);
        processed++;
      } catch (err) {
        Logger.error(`Failed to process artist discovery for ${dateStr} (non-fatal).`, err as Error);
        errors++;
      }
    }

    Logger.info(
      `Artist discovery backfill completed: processed=${processed}, skipped=${skipped}, errors=${errors}`
    );
  }

  private computeBaseRoot(input: string): string {
    const norm = path.resolve(input);
    const parts = norm.split(path.sep).filter(Boolean);
    if (parts.length === 0) return norm;
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    const isYear = (s?: string) => !!s && /^\d{4}$/.test(s);
    const isMonth = (s?: string) => !!s && /^(0[1-9]|1[0-2])$/.test(s);

    if (isYear(prev) && isMonth(last)) {
      return path.sep + parts.slice(0, -2).join(path.sep);
    }
    if (isYear(last)) {
      return path.sep + parts.slice(0, -1).join(path.sep);
    }
    return norm;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  // Public API: manually trigger playlist archiving
  public async triggerPlaylistArchiving(): Promise<void> {
    if (!this.playlistArchiver || !config.playlistArchiving?.enabled) {
      Logger.warn('Playlist archiving is not enabled.');
      return;
    }

    Logger.info('Manual playlist archiving triggered...');
    await this.playlistArchiver.archivePlaylist();
  }
}
