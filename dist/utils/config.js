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
    return cfg;
}
export const config = loadConfig();
