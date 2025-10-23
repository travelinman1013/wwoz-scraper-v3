import dayjs from 'dayjs';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import type { SpotifyEnricher } from '../modules/enrichers/SpotifyEnricher.js';

interface PlaylistTrackWithMetadata {
  id: string;
  uri: string;
  name: string;
  addedAt: string; // ISO timestamp
  durationMs: number;
}

export class PlaylistArchiver {
  private enricher: SpotifyEnricher;

  constructor(enricher: SpotifyEnricher) {
    this.enricher = enricher;
  }

  /**
   * Check if the main playlist should be archived based on duration threshold
   */
  async shouldArchive(): Promise<boolean> {
    if (!config.playlistArchiving?.enabled) {
      return false;
    }

    const { mainPlaylistId, durationThresholdHours } = config.playlistArchiving;

    try {
      const durationHours = await this.enricher.getPlaylistDuration(mainPlaylistId);
      Logger.info(`Main playlist duration: ${durationHours.toFixed(2)} hours (threshold: ${durationThresholdHours} hours)`);

      return durationHours >= durationThresholdHours;
    } catch (err) {
      Logger.error('Failed to check playlist duration for archiving:', err as Error);
      return false;
    }
  }

  /**
   * Archive the main playlist: create dated archive, copy all tracks, remove old tracks
   */
  async archivePlaylist(): Promise<void> {
    if (!config.playlistArchiving?.enabled) {
      Logger.warn('Playlist archiving is not enabled in config.');
      return;
    }

    const { mainPlaylistId } = config.playlistArchiving;
    Logger.info('Starting playlist archiving process...');

    try {
      // Step 1: Fetch all tracks with metadata
      const tracks = await this.enricher.getPlaylistTracksWithMetadata(mainPlaylistId);
      if (tracks.length === 0) {
        Logger.warn('Main playlist is empty; nothing to archive.');
        return;
      }

      // Step 2: Determine date range from added_at timestamps
      const { startDate, endDate } = this.determineDateRange(tracks);
      const archivePlaylistName = `WWOZTracker ${startDate} - ${endDate}`;
      Logger.info(`Creating archive playlist: ${archivePlaylistName}`);

      // Step 3: Create archive playlist
      const archivePlaylist = await this.enricher.getOrCreatePlaylist(archivePlaylistName);
      Logger.info(`Archive playlist ready: ${archivePlaylist.name} (${archivePlaylist.id})`);

      // Step 4: Copy all tracks to archive playlist
      const copiedCount = await this.enricher.copyTracksToPlaylist(mainPlaylistId, archivePlaylist.id);
      Logger.info(`Copied ${copiedCount} tracks to archive playlist.`);

      // Step 5: Remove old tracks from main playlist (keep only today's songs)
      const todayStr = dayjs().format('YYYY-MM-DD');
      const removedCount = await this.enricher.removeTracksFromPlaylist(mainPlaylistId, todayStr);
      Logger.info(`Removed ${removedCount} old tracks from main playlist (kept tracks from ${todayStr}).`);

      // Step 6: Clear cache for main playlist
      if (this.enricher.clearPlaylistCache) {
        this.enricher.clearPlaylistCache(mainPlaylistId);
        Logger.info('Cleared main playlist cache after archiving.');
      }

      Logger.info(`Playlist archiving completed successfully: ${archivePlaylistName}`);
    } catch (err) {
      Logger.error('Playlist archiving failed:', err as Error);
      throw err;
    }
  }

  /**
   * Determine start and end dates from track added_at timestamps
   */
  private determineDateRange(tracks: PlaylistTrackWithMetadata[]): { startDate: string; endDate: string } {
    // Find oldest and newest added_at timestamps
    let oldest: dayjs.Dayjs | null = null;
    let newest: dayjs.Dayjs | null = null;

    for (const track of tracks) {
      const date = dayjs(track.addedAt);
      if (!date.isValid()) continue;

      if (!oldest || date.isBefore(oldest)) {
        oldest = date;
      }
      if (!newest || date.isAfter(newest)) {
        newest = date;
      }
    }

    // Format as M/D/YY (e.g., 9/30/25)
    const startDate = oldest ? oldest.format('M/D/YY') : dayjs().format('M/D/YY');
    const endDate = newest ? newest.format('M/D/YY') : dayjs().format('M/D/YY');

    return { startDate, endDate };
  }
}
