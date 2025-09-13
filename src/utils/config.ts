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
  // Optional: stop a run if too many archive duplicates in a row
  consecutiveArchiveDuplicatesStopThreshold?: number;
}

export interface RateLimitBucketConfig {
  maxConcurrent: number;
  minTime: number;
}

export interface RateLimitConfig {
  spotify: RateLimitBucketConfig;
}

// Image selector and cover functionality removed

export interface AppConfig {
  dryRun: boolean;
  wwoz: WwozConfig;
  spotify: SpotifyConfig;
  archive: ArchiveConfig;
  rateLimit: RateLimitConfig;
  chromePath: string | null;
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
  // image selector removed — no image/cover config required

  // Environment overrides (non-secret convenience)
  const envStaticPlaylist = process.env.SPOTIFY_STATIC_PLAYLIST_ID;
  if (envStaticPlaylist && envStaticPlaylist.trim().length > 0) {
    cfg.spotify.staticPlaylistId = envStaticPlaylist.trim();
  }

  // No image selection defaults

  return cfg;
}

export const config: AppConfig = loadConfig();
