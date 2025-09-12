import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface WwozConfig {
  playlistUrl: string;
  scrapeIntervalSeconds: number;
}

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userId: string;
  staticPlaylistId: string | null;
}

export interface ArchiveConfig {
  enabled: boolean;
  basePath: string;
  deduplicationWindowMinutes: number;
}

export interface RateLimitBucketConfig {
  maxConcurrent: number;
  minTime: number;
}

export interface RateLimitConfig {
  spotify: RateLimitBucketConfig;
}

export interface ImagesConfig {
  folderPath: string;
  minSharpness: number;
  minBrightness: number; // 0..1
  duplicateHammingMax: number;
  excludeExtensions: string[];
  clip: {
    model: 'auto' | string; // 'auto' uses Xenova cache path
    positivePrompts: string[];
    negativePrompts: string[];
  };
  usedDbPath: string; // sqlite path
}

export interface CoverConfig {
  maxKB: number; // max JPEG size for Spotify
  grayscale?: boolean; // optional: convert to B&W before upload
}

export interface AppConfig {
  dryRun: boolean;
  wwoz: WwozConfig;
  spotify: SpotifyConfig;
  archive: ArchiveConfig;
  rateLimit: RateLimitConfig;
  chromePath: string | null;
  images: ImagesConfig;
  cover: CoverConfig;
}

function resolveConfigPath(): string {
  const fromEnv = process.env.CONFIG_PATH;
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }
  // Assume the app is started from the project root
  return path.resolve(process.cwd(), 'config', 'config.yaml');
}

export function loadConfig(filePath?: string): AppConfig {
  const cfgPath = filePath ? path.resolve(filePath) : resolveConfigPath();
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`Configuration file not found at: ${cfgPath}`);
  }
  const file = fs.readFileSync(cfgPath, 'utf8');
  const raw = yaml.load(file) as unknown;
  // Basic runtime shape check to surface obvious issues early
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid configuration: expected a YAML mapping at the root.');
  }

  const cfg = raw as AppConfig;
  // Spot-check a few required fields
  if (typeof cfg.dryRun !== 'boolean') {
    throw new Error('Invalid configuration: "dryRun" must be a boolean.');
  }
  if (!cfg.wwoz || typeof cfg.wwoz.playlistUrl !== 'string') {
    throw new Error('Invalid configuration: "wwoz.playlistUrl" must be a string.');
  }
  if (!cfg.spotify || typeof cfg.spotify.clientId !== 'string' || typeof cfg.spotify.clientSecret !== 'string') {
    throw new Error('Invalid configuration: spotify credentials are required.');
  }
  if (!cfg.images || typeof cfg.images.folderPath !== 'string') {
    throw new Error('Invalid configuration: images.folderPath is required.');
  }
  if (!cfg.cover || typeof cfg.cover.maxKB !== 'number') {
    throw new Error('Invalid configuration: cover.maxKB is required.');
  }

  // Environment overrides (non-secret convenience)
  const envStaticPlaylist = process.env.SPOTIFY_STATIC_PLAYLIST_ID;
  if (envStaticPlaylist && envStaticPlaylist.trim().length > 0) {
    cfg.spotify.staticPlaylistId = envStaticPlaylist.trim();
  }

  return cfg;
}

export const config: AppConfig = loadConfig();
