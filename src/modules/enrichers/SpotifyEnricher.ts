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
      return; // still valid
    }
    try {
      const data = await this.spotify.refreshAccessToken();
      const token = data.body.access_token;
      const expiresInSec = data.body.expires_in ?? 3600;
      this.spotify.setAccessToken(token);
      this.accessTokenExpiresAt = Date.now() + expiresInSec * 1000;
      Logger.debug('Spotify access token refreshed.');
    } catch (err) {
      Logger.error('Failed to refresh Spotify access token.', err);
      throw err;
    }
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
          const isRetryable = status === 429 || (status >= 500 && status < 600);
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

  async getOrCreatePlaylist(name: string): Promise<{ id: string; name: string }> {
    const { userId } = config.spotify;
    const existing = await this.findUserPlaylistByName(userId, name);
    if (existing) {
      Logger.info(`Using existing playlist: ${existing.name} (${existing.id})`);
      return existing;
    }
    Logger.info(`Creating playlist: ${name}`);
    const res = await this.schedule(() => this.spotify.createPlaylist(name, { public: false }), 'createPlaylist');
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

  async isDuplicate(playlistId: string, trackId: string): Promise<boolean> {
    if (!this.playlistCache.has(playlistId)) {
      await this.loadPlaylistCache(playlistId);
    }
    const set = this.playlistCache.get(playlistId)!;
    return set.has(trackId);
  }

  async addToPlaylist(playlistId: string, trackUri: string): Promise<void> {
    if (config.dryRun) {
      Logger.info(`[dryRun] Would add to playlist ${playlistId}: ${trackUri}`);
      return;
    }
    Logger.info(`Adding track to playlist ${playlistId}: ${trackUri}`);
    await this.schedule(() => this.spotify.addTracksToPlaylist(playlistId, [trackUri]), 'addTracksToPlaylist');
    // Update cache optimistically
    const id = trackUri.replace('spotify:track:', '');
    if (!this.playlistCache.has(playlistId)) {
      this.playlistCache.set(playlistId, new Set([id]));
    } else {
      this.playlistCache.get(playlistId)!.add(id);
    }
  }
}
