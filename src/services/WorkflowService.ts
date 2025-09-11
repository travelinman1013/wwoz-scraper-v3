import dayjs from 'dayjs';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import type { IArchiver, IEnricher, IScraper, ArchiveEntry, ScrapedSong, TrackMatch } from '../types/index.js';

export class WorkflowService {
  private scraper: IScraper;
  private enricher: IEnricher;
  private archiver: IArchiver;

  constructor(scraper: IScraper, enricher: IEnricher, archiver: IArchiver) {
    this.scraper = scraper;
    this.enricher = enricher;
    this.archiver = archiver;
  }

  async runOnce(): Promise<void> {
    Logger.info('Workflow run started. Scraping playlist...');

    const songs = await this.scraper.scrape();
    if (songs.length === 0) {
      Logger.warn('No songs scraped. Nothing to process.');
      return;
    }

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

    // Reset and load a fresh cache to reflect current remote state
    if (this.enricher.clearPlaylistCache) this.enricher.clearPlaylistCache(playlistId);
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
          Logger.info(
            `Duplicate in ${playlistName}: ${song.artist} - ${song.title} (track ${match.track.id}). ${duplicatesInARow} dup(s) in a row.`
          );
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
      } catch (err) {
        duplicatesInARow = 0; // treat errors as non-dup to avoid premature stop
        Logger.error('Error processing song. Continuing with next.', err);
        // Archive as unknown to capture the occurrence
        await this.archiveOutcome(song, 'unknown', archivedAt);
      }
      if (stoppedDueToDuplicates) break;
    }
    // Optionally refresh to compute actual added count from remote
    let remoteAdded = added;
    try {
      if (this.enricher.clearPlaylistCache) this.enricher.clearPlaylistCache(playlistId);
      await this.enricher.loadPlaylistCache(playlistId);
      const finalCount = typeof this.enricher.getCachedTrackCount === 'function'
        ? this.enricher.getCachedTrackCount(playlistId)
        : initialCount + added;
      remoteAdded = Math.max(0, finalCount - initialCount);
    } catch {
      // ignore; fall back to local counter
    }

    const stopNote = stoppedDueToDuplicates ? ' (stopped after 5 consecutive duplicates)' : '';
    Logger.info(`Workflow run finished. Processed=${processed}, Added=${remoteAdded}.${stopNote}`);
  }

  async runContinuous(): Promise<void> {
    const intervalSec = Math.max(5, Number(config.wwoz.scrapeIntervalSeconds) || 300);
    Logger.info(`Entering continuous mode. Interval=${intervalSec}s`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await this.runOnce();
      } catch (err) {
        Logger.error('Run failed; continuing after delay.', err);
      }
      Logger.info(`Waiting ${intervalSec}s before next run...`);
      await this.waitSeconds(intervalSec);
    }
  }

  private waitSeconds(seconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  private buildPlaylistName(): string {
    const today = dayjs().format('YYYY-MM-DD');
    return `WWOZ Discoveries - ${today}`;
  }

  private async archiveOutcome(
    song: ScrapedSong,
    status: ArchiveEntry['status'],
    archivedAt: string,
    match?: TrackMatch | null
  ): Promise<void> {
    const entry: ArchiveEntry = {
      song,
      status,
      archivedAt,
    };
    if (match) {
      entry.confidence = match.confidence;
      const id = match.track.id;
      if (id) entry.spotifyUrl = `https://open.spotify.com/track/${id}`;
      entry.match = match as unknown;
    }
    await this.archiver.archive(entry);
  }
}
