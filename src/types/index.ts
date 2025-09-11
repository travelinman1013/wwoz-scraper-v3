// Basic types adapted from old project
export interface ScrapedSong {
  artist: string;
  title: string;
  album?: string;
  // Optional fields scraped from the playlist row
  playedDate?: string; // e.g., MM/DD
  playedTime?: string; // e.g., 12:49pm
  scrapedAt: string;
}

// Spotify-related summaries (kept minimal to avoid importing external types)
export interface SpotifyTrackSummary {
  id: string;
  uri: string;
  name: string;
  artists: string[]; // display names of artists
  album?: string;
  durationMs?: number;
}

export interface TrackMatch {
  track: SpotifyTrackSummary;
  confidence: number; // 0..100
  reason?: string;
}

// Interfaces for the new modular architecture
export interface IScraper {
  scrape(): Promise<ScrapedSong[]>;
}

export interface IEnricher {
  findMatch(song: ScrapedSong): Promise<TrackMatch | null>;
  isDuplicate(playlistId: string, trackId: string): Promise<boolean>;
  addToPlaylist(playlistId: string, trackUri: string): Promise<void>;
  loadPlaylistCache(playlistId: string): Promise<void>;
  getOrCreatePlaylist(name: string): Promise<{ id: string; name: string }>;
}

// Simplified Archiving
export type ArchiveStatus = 'found' | 'not_found' | 'low_confidence' | 'unknown';

export interface ArchiveEntry {
  song: ScrapedSong;
  status: ArchiveStatus;
  confidence?: number; // 0..100
  spotifyUrl?: string; // direct URL if known
  match?: unknown; // optional raw match payload (for compatibility)
  archivedAt: string; // ISO timestamp for when we append
}

export interface IArchiver {
  archive(entry: ArchiveEntry): Promise<void>;
}
