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

export interface ArtistDiscoveryConfig {
  enabled: boolean;
  scriptPath: string;
  pythonPath: string;
  perplexityApiKey: string;
  cardsDir?: string;
  imagesDir?: string;
  forceReprocess: boolean;
  timeoutMinutes?: number;
}

export interface PlaylistArchivingConfig {
  enabled: boolean;
  mainPlaylistId: string;
  durationThresholdHours: number;
  checkIntervalRuns: number;
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
  artistDiscovery?: ArtistDiscoveryConfig;
  playlistArchiving?: PlaylistArchivingConfig;
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

  // Validate artist discovery config if enabled
  if (cfg.artistDiscovery?.enabled) {
    if (!cfg.artistDiscovery.scriptPath || typeof cfg.artistDiscovery.scriptPath !== 'string') {
      throw new Error('Invalid configuration: artistDiscovery.scriptPath is required when enabled.');
    }
    if (!fs.existsSync(cfg.artistDiscovery.scriptPath)) {
      throw new Error(`Artist discovery script not found at: ${cfg.artistDiscovery.scriptPath}`);
    }
    if (!cfg.artistDiscovery.perplexityApiKey || typeof cfg.artistDiscovery.perplexityApiKey !== 'string') {
      throw new Error('Invalid configuration: artistDiscovery.perplexityApiKey is required when enabled.');
    }
    if (!cfg.artistDiscovery.pythonPath || typeof cfg.artistDiscovery.pythonPath !== 'string') {
      throw new Error('Invalid configuration: artistDiscovery.pythonPath is required when enabled.');
    }
  }

  // Validate playlist archiving config if enabled
  if (cfg.playlistArchiving?.enabled) {
    if (!cfg.playlistArchiving.mainPlaylistId || typeof cfg.playlistArchiving.mainPlaylistId !== 'string') {
      throw new Error('Invalid configuration: playlistArchiving.mainPlaylistId is required when enabled.');
    }
    if (typeof cfg.playlistArchiving.durationThresholdHours !== 'number' || cfg.playlistArchiving.durationThresholdHours <= 0) {
      throw new Error('Invalid configuration: playlistArchiving.durationThresholdHours must be a positive number.');
    }
    if (typeof cfg.playlistArchiving.checkIntervalRuns !== 'number' || cfg.playlistArchiving.checkIntervalRuns <= 0) {
      throw new Error('Invalid configuration: playlistArchiving.checkIntervalRuns must be a positive number.');
    }
  }

  // Environment overrides (non-secret convenience)
  const envStaticPlaylist = process.env.SPOTIFY_STATIC_PLAYLIST_ID;
  if (envStaticPlaylist && envStaticPlaylist.trim().length > 0) {
    cfg.spotify.staticPlaylistId = envStaticPlaylist.trim();
  }

  // No image selection defaults

  return cfg;
}

export const config: AppConfig = loadConfig();
