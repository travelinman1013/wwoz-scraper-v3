import Bottleneck from 'bottleneck';
import SpotifyWebApi from 'spotify-web-api-node';
import { Logger } from '../../utils/logger.js';
import { config } from '../../utils/config.js';
import type { IEnricher, ScrapedSong, TrackMatch, SpotifyTrackSummary } from '../../types/index.js';
import { SongMatcher } from '../../utils/matching.js';

type ApiCall<T> = () => Promise<T>;

export class SpotifyEnricher implements IEnricher {
  private spotify: SpotifyWebApi;
  private limiter: Bottleneck;
  private accessTokenExpiresAt: number | null = null; // epoch ms
  private playlistCache: Map<string, Set<string>> = new Map(); // playlistId -> set(trackId)

  private readonly matchThreshold = 70; // percent

  constructor() {
    const { clientId, clientSecret, refreshToken } = config.spotify;

    this.spotify = new SpotifyWebApi({ clientId, clientSecret });
    this.spotify.setRefreshToken(refreshToken);

    const { maxConcurrent, minTime } = config.rateLimit.spotify;
    this.limiter = new Bottleneck({ maxConcurrent, minTime });
  }

  // Ensures we have a valid access token, refreshing proactively
  private async ensureAccessToken(): Promise<void> {
    const now = Date.now();
    if (this.accessTokenExpiresAt && now < this.accessTokenExpiresAt - 60_000) {
      const remainingMs = this.accessTokenExpiresAt - now;
      const remainingMin = Math.floor(remainingMs / 60000);
      Logger.debug(`Spotify access token still valid (expires in ${remainingMin} minutes).`);
      return; // still valid
    }

    // Retry logic for token refresh to handle transient network/API failures
    const maxAttempts = 3;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        Logger.debug(`Refreshing Spotify access token (attempt ${attempt}/${maxAttempts})...`);
        const data = await this.spotify.refreshAccessToken();
        const token = data.body.access_token;
        const expiresInSec = data.body.expires_in ?? 3600;
        this.spotify.setAccessToken(token);
        this.accessTokenExpiresAt = Date.now() + expiresInSec * 1000;
        const expiresInMin = Math.floor(expiresInSec / 60);
        Logger.debug(`Spotify access token refreshed successfully (expires in ${expiresInMin} minutes).`);
        return; // success
      } catch (err) {
        lastErr = err;

        if (attempt < maxAttempts) {
          const backoffMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
          Logger.warn(`Failed to refresh Spotify access token (attempt ${attempt}/${maxAttempts}). Retrying in ${backoffMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    // All attempts failed
    Logger.error('Failed to refresh Spotify access token after all retry attempts.', lastErr);
    throw lastErr;
  }

  private async schedule<T>(fn: ApiCall<T>, label?: string, attempts = 3): Promise<T> {
    return this.limiter.schedule(async () => {
      await this.ensureAccessToken();
      let lastErr: unknown;
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fn();
          return res;
        } catch (err: any) {
          lastErr = err;
          const status = err?.statusCode || err?.status || err?.body?.error?.status;
          const retryAfter = Number(err?.headers?.['retry-after']) || 0;
          // Treat common transient network errors as retryable, in addition to 429/5xx
          const code = (err?.code || '').toString();
          const message: string = (err?.message || '').toString();
          const transientCodes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);
          const looksLikeTimeout = code === 'ETIMEDOUT' || /timeout|timed out|ETIMEDOUT/i.test(message);
          const isRetryable = (
            status === 429 || (status >= 500 && status < 600) ||
            transientCodes.has(code) || looksLikeTimeout
          );
          const backoffMs = retryAfter > 0 ? retryAfter * 1000 : 500 * Math.pow(2, i);
          if (isRetryable && i < attempts - 1) {
            Logger.warn(`Spotify API ${label ?? ''} failed (status ${status}). Retrying in ${backoffMs}ms...`);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    });
  }

  async findMatch(song: ScrapedSong): Promise<TrackMatch | null> {
    const q = this.buildSearchQuery(song);
    Logger.debug(`Searching Spotify for: ${q}`);

    const data = await this.schedule(() => this.spotify.searchTracks(q, { limit: 10, market: 'US' }), 'searchTracks');
    const items = data.body.tracks?.items ?? [];
    if (items.length === 0) return null;

    const candidates: TrackMatch[] = items.map((t) => this.toTrackMatch(song, t));
    candidates.sort((a, b) => b.confidence - a.confidence);

    const best = candidates[0];
    if (best && best.confidence >= this.matchThreshold) {
      Logger.info(`Match found: ${best.track.name} (${best.confidence.toFixed(1)}%)`);
      // Fetch genres for the best match from its artists
      try {
        const bestItem = items.find((t) => t.id === best.track.id);
        const artistIds = (bestItem?.artists || [])
          .map((a) => a.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (artistIds.length > 0) {
          const genres = await this.fetchArtistGenres(artistIds);
          if (genres.length > 0) {
            best.track.genres = genres;
            Logger.debug(`Genres for match: ${genres.join(', ')}`);
          }
        }
      } catch (err) {
        Logger.warn('Failed to fetch artist genres (non-fatal).');
      }
      return best;
    }
    Logger.warn('No confident match found from search results.');
    return null;
  }

  private buildSearchQuery(song: ScrapedSong): string {
    const artist = song.artist?.trim();
    const title = song.title?.trim();
    let q = '';
    if (title) q += `track:${this.escapeQuery(title)} `;
    if (artist) q += `artist:${this.escapeQuery(artist)} `;
    return q.trim();
  }

  private escapeQuery(s: string): string {
    return s.replace(/[\"\:\(\)\[\]\{\}\!\^\~\*\?\\]/g, ' ');
  }

  private toTrackMatch(song: ScrapedSong, t: SpotifyApi.TrackObjectFull): TrackMatch {
    const summary: SpotifyTrackSummary = {
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: (t.artists ?? []).map((a) => a.name),
      album: t.album?.name,
      durationMs: t.duration_ms,
    };
    return SongMatcher.score(song, summary);
  }

  private async fetchArtistGenres(artistIds: string[]): Promise<string[]> {
    if (!artistIds || artistIds.length === 0) return [];
    // Spotify getArtists supports up to 50 IDs
    const unique = Array.from(new Set(artistIds));
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 50) chunks.push(unique.slice(i, i + 50));
    const allGenres = new Set<string>();
    for (const chunk of chunks) {
      const res = await this.schedule(() => this.spotify.getArtists(chunk), 'getArtists');
      const artists = res.body.artists || [];
      for (const a of artists) {
        (a.genres || []).forEach((g) => allGenres.add(g));
      }
    }
    return Array.from(allGenres);
  }

  async getOrCreatePlaylist(name: string): Promise<{ id: string; name: string }> {
    const { userId } = config.spotify;
    const existing = await this.findUserPlaylistByName(userId, name);
    if (existing) {
      Logger.info(`Using existing playlist: ${existing.name} (${existing.id})`);
      return existing;
    }
    Logger.info(`Creating playlist: ${name}`);
    const res = await this.schedule(() => this.spotify.createPlaylist(name, { public: true }), 'createPlaylist', 5);
    const pl = res.body;
    return { id: pl.id, name: pl.name };
  }

  private async findUserPlaylistByName(userId: string, name: string): Promise<{ id: string; name: string } | null> {
    const target = name.trim().toLowerCase();
    let offset = 0;
    const limit = 50;
    // paginate through user's playlists
    while (true) {
      const res = await this.schedule(() => this.spotify.getUserPlaylists(userId, { limit, offset }), 'getUserPlaylists');
      const items = res.body.items ?? [];
      for (const pl of items) {
        if (pl.name.trim().toLowerCase() === target) return { id: pl.id, name: pl.name };
      }
      if (items.length < limit) break;
      offset += limit;
    }
    return null;
  }

  async loadPlaylistCache(playlistId: string): Promise<void> {
    Logger.info(`Loading playlist cache for ${playlistId}...`);
    const ids = new Set<string>();
    let offset = 0;
    const limit = 100;
    while (true) {
      const res = await this.schedule(() => this.spotify.getPlaylistTracks(playlistId, { offset, limit }), 'getPlaylistTracks');
      const items = res.body.items ?? [];
      for (const it of items) {
        const tr = it.track as SpotifyApi.TrackObjectFull | null;
        const id = tr?.id;
        if (id) ids.add(id);
      }
      if (items.length < limit) break;
      offset += limit;
    }
    this.playlistCache.set(playlistId, ids);
    Logger.info(`Playlist cache loaded with ${ids.size} tracks.`);
  }

  clearPlaylistCache(playlistId?: string): void {
    if (playlistId) {
      this.playlistCache.delete(playlistId);
    } else {
      this.playlistCache.clear();
    }
  }

  getCachedTrackCount(playlistId: string): number {
    return this.playlistCache.get(playlistId)?.size ?? 0;
  }

  async isDuplicate(playlistId: string, trackId: string): Promise<boolean> {
    if (!this.playlistCache.has(playlistId)) {
      await this.loadPlaylistCache(playlistId);
    }
    const set = this.playlistCache.get(playlistId)!;
    return set.has(trackId);
  }

  async addToPlaylist(playlistId: string, trackUri: string, position?: number): Promise<void> {
    if (config.dryRun) {
      Logger.info(`[dryRun] Would add to playlist ${playlistId}: ${trackUri}${position !== undefined ? ` at position ${position}` : ''}`);
      return;
    }
    Logger.info(`Adding track to playlist ${playlistId}: ${trackUri}${position !== undefined ? ` at position ${position}` : ''}`);
    const options = position !== undefined ? { position } : undefined;
    await this.schedule(() => this.spotify.addTracksToPlaylist(playlistId, [trackUri], options), 'addTracksToPlaylist');
    // Update cache optimistically
    const id = trackUri.replace('spotify:track:', '');
    if (!this.playlistCache.has(playlistId)) {
      this.playlistCache.set(playlistId, new Set([id]));
    } else {
      this.playlistCache.get(playlistId)!.add(id);
    }
  }

  async uploadPlaylistCover(playlistId: string, jpegBase64: string): Promise<void> {
    if (config.dryRun) {
      Logger.info(`[dryRun] Would upload custom cover to playlist ${playlistId} (base64 JPEG ${Math.ceil(jpegBase64.length / 1024)} KB)`);
      return;
    }
    Logger.info(`Uploading custom cover image to playlist ${playlistId}...`);
    await this.schedule(() => this.spotify.uploadCustomPlaylistCoverImage(playlistId, jpegBase64), 'uploadCustomPlaylistCoverImage');
  }

  async getPlaylistDuration(playlistId: string): Promise<number> {
    Logger.debug(`Calculating total duration for playlist ${playlistId}...`);
    let totalMs = 0;
    let offset = 0;
    const limit = 100;

    while (true) {
      const res = await this.schedule(() => this.spotify.getPlaylistTracks(playlistId, { offset, limit }), 'getPlaylistTracks');
      const items = res.body.items ?? [];

      for (const it of items) {
        const tr = it.track as SpotifyApi.TrackObjectFull | null;
        if (tr?.duration_ms) {
          totalMs += tr.duration_ms;
        }
      }

      if (items.length < limit) break;
      offset += limit;
    }

    const hours = totalMs / (1000 * 60 * 60);
    return hours;
  }

  async getPlaylistTracksWithMetadata(playlistId: string): Promise<Array<{ id: string; uri: string; name: string; addedAt: string; durationMs: number }>> {
    Logger.debug(`Fetching all tracks with metadata for playlist ${playlistId}...`);
    const tracks: Array<{ id: string; uri: string; name: string; addedAt: string; durationMs: number }> = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const res = await this.schedule(() => this.spotify.getPlaylistTracks(playlistId, { offset, limit }), 'getPlaylistTracks');
      const items = res.body.items ?? [];

      for (const it of items) {
        const tr = it.track as SpotifyApi.TrackObjectFull | null;
        if (tr?.id && tr?.uri) {
          tracks.push({
            id: tr.id,
            uri: tr.uri,
            name: tr.name,
            addedAt: it.added_at || new Date().toISOString(),
            durationMs: tr.duration_ms || 0,
          });
        }
      }

      if (items.length < limit) break;
      offset += limit;
    }

    Logger.debug(`Retrieved ${tracks.length} tracks with metadata.`);
    return tracks;
  }

  async copyTracksToPlaylist(fromPlaylistId: string, toPlaylistId: string): Promise<number> {
    if (config.dryRun) {
      Logger.info(`[dryRun] Would copy tracks from ${fromPlaylistId} to ${toPlaylistId}`);
      return 0;
    }

    Logger.info(`Copying tracks from playlist ${fromPlaylistId} to ${toPlaylistId}...`);

    // Load cache for destination playlist to avoid duplicates
    await this.loadPlaylistCache(toPlaylistId);

    // Fetch all tracks from source playlist
    const sourceTracks = await this.getPlaylistTracksWithMetadata(fromPlaylistId);

    let added = 0;
    const batchSize = 100; // Spotify API allows max 100 tracks per add request
    const urisToAdd: string[] = [];

    for (const track of sourceTracks) {
      const isDup = await this.isDuplicate(toPlaylistId, track.id);
      if (!isDup) {
        urisToAdd.push(track.uri);
      }
    }

    // Add tracks in batches
    for (let i = 0; i < urisToAdd.length; i += batchSize) {
      const batch = urisToAdd.slice(i, i + batchSize);
      await this.schedule(() => this.spotify.addTracksToPlaylist(toPlaylistId, batch), 'addTracksToPlaylist');
      added += batch.length;
      Logger.debug(`Added batch ${Math.floor(i / batchSize) + 1}: ${batch.length} tracks`);
    }

    Logger.info(`Copied ${added} tracks to destination playlist.`);
    return added;
  }

  async removeTracksFromPlaylist(playlistId: string, keepAfterDate: string): Promise<number> {
    if (config.dryRun) {
      Logger.info(`[dryRun] Would remove tracks from ${playlistId} before date ${keepAfterDate}`);
      return 0;
    }

    Logger.info(`Removing old tracks from playlist ${playlistId} (keeping tracks from ${keepAfterDate})...`);

    // Fetch all tracks with metadata
    const tracks = await this.getPlaylistTracksWithMetadata(playlistId);

    // Filter tracks to remove (those added before keepAfterDate)
    const tracksToRemove: Array<{ uri: string }> = [];
    for (const track of tracks) {
      const addedDate = track.addedAt.split('T')[0]; // Extract YYYY-MM-DD
      if (addedDate < keepAfterDate) {
        tracksToRemove.push({ uri: track.uri });
      }
    }

    if (tracksToRemove.length === 0) {
      Logger.info('No old tracks to remove.');
      return 0;
    }

    // Spotify API allows max 100 tracks per remove request
    const batchSize = 100;
    let removed = 0;

    for (let i = 0; i < tracksToRemove.length; i += batchSize) {
      const batch = tracksToRemove.slice(i, i + batchSize);
      await this.schedule(() => this.spotify.removeTracksFromPlaylist(playlistId, batch), 'removeTracksFromPlaylist');
      removed += batch.length;
      Logger.debug(`Removed batch ${Math.floor(i / batchSize) + 1}: ${batch.length} tracks`);
    }

    Logger.info(`Removed ${removed} old tracks from playlist.`);
    return removed;
  }
}
