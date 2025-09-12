import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
function resolveConfigPath() {
    const fromEnv = process.env.CONFIG_PATH;
    if (fromEnv && fromEnv.trim().length > 0) {
        return path.resolve(fromEnv);
    }
    // Assume the app is started from the project root
    return path.resolve(process.cwd(), 'config', 'config.yaml');
}
export function loadConfig(filePath) {
    const cfgPath = filePath ? path.resolve(filePath) : resolveConfigPath();
    if (!fs.existsSync(cfgPath)) {
        throw new Error(`Configuration file not found at: ${cfgPath}`);
    }
    const file = fs.readFileSync(cfgPath, 'utf8');
    const raw = yaml.load(file);
    // Basic runtime shape check to surface obvious issues early
    if (typeof raw !== 'object' || raw === null) {
        throw new Error('Invalid configuration: expected a YAML mapping at the root.');
    }
    const cfg = raw;
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
    // Defaults for image selection strategy (maintains backward compatibility)
    if (!cfg.images.selection)
        cfg.images.selection = {};
    if (!cfg.images.selection.strategy)
        cfg.images.selection.strategy = 'softmax';
    if (cfg.images.selection.strategy === 'softmax' &&
        (cfg.images.selection.temperature === undefined || cfg.images.selection.temperature === null)) {
        cfg.images.selection.temperature = 0.15; // moderate randomness toward higher-scored images
    }
    if (cfg.images.selection.strategy === 'top_k' &&
        (cfg.images.selection.topK === undefined || cfg.images.selection.topK === null)) {
        cfg.images.selection.topK = 200; // pick from the top 200 by default
    }
    return cfg;
}
export const config = loadConfig();
