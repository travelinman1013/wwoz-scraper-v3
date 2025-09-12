import { Command } from 'commander';
import { Logger } from './utils/logger.js';
import { WorkflowService } from './services/WorkflowService.js';
import { WWOZScraper } from './modules/scrapers/WWOZScraper.js';
import { SpotifyEnricher } from './modules/enrichers/SpotifyEnricher.js';
import { ObsidianArchiver } from './modules/archivers/ObsidianArchiver.js';
const program = new Command();
program
    .name('wwoz-scraper')
    .description('Scrapes WWOZ, enriches with Spotify, and archives to Obsidian.')
    .option('--once', 'Run the scraper a single time and exit')
    .option('--snapshot <date>', 'Create a daily snapshot playlist for YYYY-MM-DD and exit')
    .option('--backfill <days>', 'Create daily snapshot playlists for the past <days> days and exit', (v) => parseInt(v, 10))
    .option('--update-cover [date]', 'Pick a musician photo and set as cover for snapshot playlist of YYYY-MM-DD (default: yesterday).')
    .option('--cover-dry-run', 'Do not upload; only select and print the chosen image.')
    .option('--index-images', 'Index all images and compute missing CLIP scores, then exit')
    .action(async (options) => {
    const scraper = new WWOZScraper();
    const enricher = new SpotifyEnricher();
    const archiver = new ObsidianArchiver();
    const workflow = new WorkflowService(scraper, enricher, archiver);
    if (options.snapshot) {
        const date = String(options.snapshot);
        Logger.info(`Creating daily snapshot playlist for ${date}...`);
        await workflow.createDailySnapshotPlaylistFromArchive(date);
        return;
    }
    if (typeof options.backfill === 'number' && !Number.isNaN(options.backfill)) {
        const days = Math.max(1, options.backfill);
        Logger.info(`Backfilling daily snapshot playlists for past ${days} day(s)...`);
        await workflow.backfillDailySnapshots(days);
        return;
    }
    if (typeof options.updateCover !== 'undefined') {
        const { updateCover, coverDryRun } = options;
        const dateArg = typeof updateCover === 'string' ? updateCover : undefined;
        const date = dateArg ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
        const { updateSnapshotCover } = await import('./services/coverWorkflow.js');
        await updateSnapshotCover(date, !!coverDryRun);
        return;
    }
    if (options.indexImages) {
        const { indexAllImages } = await import('./services/imageIndex.js');
        await indexAllImages();
        return;
    }
    if (options.once) {
        Logger.info('Starting a single run...');
        await workflow.runOnce();
    }
    else {
        Logger.info('Starting continuous monitoring mode...');
        await workflow.runContinuous();
    }
});
program.parse(process.argv);
