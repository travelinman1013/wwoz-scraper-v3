import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
export class ArtistDiscoveryService {
    stateFilePath;
    stateDb = {};
    constructor() {
        this.stateFilePath = path.resolve(process.cwd(), 'config', 'processed_archives.json');
        this.loadState();
    }
    /**
     * Process a daily archive file with the Python artist discovery pipeline.
     * Non-blocking: returns immediately and logs results when complete.
     */
    async processArchive(archivePath) {
        if (!config.artistDiscovery?.enabled) {
            Logger.debug('Artist discovery is disabled; skipping.');
            return;
        }
        // Extract date from archive path for state tracking
        const archiveDate = this.extractDateFromPath(archivePath);
        if (!archiveDate) {
            Logger.warn(`Cannot extract date from archive path: ${archivePath}`);
            return;
        }
        // Check if already successfully processed (unless forceReprocess is enabled)
        if (!config.artistDiscovery.forceReprocess && this.wasProcessedSuccessfully(archiveDate)) {
            const state = this.stateDb[archiveDate];
            Logger.debug(`Archive ${archiveDate} already processed successfully at ${state.processedAt}; skipping.`);
            return;
        }
        // Verify archive file exists
        if (!fs.existsSync(archivePath)) {
            Logger.warn(`Archive file not found: ${archivePath}; skipping artist discovery.`);
            return;
        }
        Logger.info(`[Artist Discovery] Starting pipeline for ${archiveDate} (${archivePath})`);
        const startTime = Date.now();
        try {
            await this.executePythonScript(archivePath, archiveDate);
            const duration = Date.now() - startTime;
            const state = {
                processedAt: new Date().toISOString(),
                status: 'success',
                durationMs: duration,
            };
            this.saveState(archiveDate, state);
            Logger.info(`[Artist Discovery] Completed successfully for ${archiveDate} (duration=${Math.round(duration / 1000)}s)`);
        }
        catch (err) {
            const duration = Date.now() - startTime;
            const errorMsg = err instanceof Error ? err.message : String(err);
            const state = {
                processedAt: new Date().toISOString(),
                status: 'error',
                error: errorMsg,
                durationMs: duration,
            };
            this.saveState(archiveDate, state);
            Logger.error(`[Artist Discovery] Failed for ${archiveDate}: ${errorMsg}`);
        }
    }
    /**
     * Execute the Python artist discovery script and stream output to logger.
     */
    async executePythonScript(archivePath, archiveDate) {
        const cfg = config.artistDiscovery;
        const timeoutMs = (cfg.timeoutMinutes || 30) * 60 * 1000;
        // Build arguments
        const args = [
            cfg.scriptPath,
            '--archive',
            archivePath,
        ];
        if (cfg.cardsDir) {
            args.push('--cards-dir', cfg.cardsDir);
        }
        if (cfg.imagesDir) {
            args.push('--images-dir', cfg.imagesDir);
        }
        if (config.dryRun) {
            args.push('--dry-run');
        }
        if (cfg.forceReprocess) {
            args.push('--force');
        }
        // Set environment with Perplexity API key
        const env = {
            ...process.env,
            PERPLEXITY_API_KEY: cfg.perplexityApiKey,
        };
        return new Promise((resolve, reject) => {
            const proc = spawn(cfg.pythonPath, args, { env });
            let stdout = '';
            let stderr = '';
            let killed = false;
            // Set timeout
            const timer = setTimeout(() => {
                killed = true;
                proc.kill('SIGTERM');
                reject(new Error(`Script timeout after ${cfg.timeoutMinutes} minutes`));
            }, timeoutMs);
            // Stream stdout
            proc.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                // Log each line with prefix
                text.split('\n').forEach((line) => {
                    if (line.trim()) {
                        Logger.info(`[Artist Discovery] ${line}`);
                    }
                });
            });
            // Stream stderr
            proc.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                // Log errors with prefix
                text.split('\n').forEach((line) => {
                    if (line.trim()) {
                        Logger.warn(`[Artist Discovery] ${line}`);
                    }
                });
            });
            // Handle process exit
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (killed)
                    return; // Already rejected
                if (code === 0) {
                    // Try to extract artist count from output
                    const match = stdout.match(/processed[:\s]+(\d+)/i) || stdout.match(/created[:\s]+(\d+)/i);
                    if (match) {
                        const count = parseInt(match[1], 10);
                        Logger.debug(`[Artist Discovery] Processed ${count} artist(s)`);
                    }
                    resolve();
                }
                else {
                    const msg = stderr.trim() || stdout.trim() || `Exit code ${code}`;
                    reject(new Error(msg));
                }
            });
            // Handle spawn errors
            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`Failed to spawn Python process: ${err.message}`));
            });
        });
    }
    /**
     * Extract YYYY-MM-DD from archive file path.
     * Expected formats:
     * - /path/to/YYYY/MM/WWOZ Day, Mon. DD, YYYY.md
     * - /path/to/YYYY/MM/YYYY-MM-DD.md
     */
    extractDateFromPath(archivePath) {
        // Try ISO date pattern first: YYYY-MM-DD
        const isoMatch = archivePath.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
            return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
        }
        // Try directory-based pattern: /YYYY/MM/ in path
        const dirMatch = archivePath.match(/\/(\d{4})\/(\d{2})\//);
        if (dirMatch) {
            const year = dirMatch[1];
            const month = dirMatch[2];
            // Try to extract day from filename
            const dayMatch = path.basename(archivePath).match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
            if (dayMatch) {
                const day = dayMatch[1].padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
        }
        return null;
    }
    /**
     * Check if an archive date has been processed successfully.
     */
    wasProcessedSuccessfully(archiveDate) {
        const state = this.stateDb[archiveDate];
        return state !== undefined && state.status === 'success';
    }
    /**
     * Reload state from disk (useful for batch operations).
     */
    reloadState() {
        this.loadState();
    }
    /**
     * Load state from JSON file.
     */
    loadState() {
        try {
            if (fs.existsSync(this.stateFilePath)) {
                const data = fs.readFileSync(this.stateFilePath, 'utf8');
                this.stateDb = JSON.parse(data);
                Logger.debug(`Loaded artist discovery state: ${Object.keys(this.stateDb).length} archive(s)`);
            }
            else {
                Logger.debug('No existing artist discovery state file; starting fresh.');
                this.stateDb = {};
            }
        }
        catch (err) {
            Logger.warn(`Failed to load artist discovery state file (will recreate): ${err}`);
            this.stateDb = {};
        }
    }
    /**
     * Save state for a specific archive date.
     */
    saveState(archiveDate, state) {
        this.stateDb[archiveDate] = state;
        try {
            const dir = path.dirname(this.stateFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.stateFilePath, JSON.stringify(this.stateDb, null, 2), 'utf8');
            Logger.debug(`Saved artist discovery state for ${archiveDate}`);
        }
        catch (err) {
            Logger.error(`Failed to save artist discovery state: ${err}`);
        }
    }
}
