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
  .option('--backfill-artists <days>', 'Run artist discovery pipeline for the past <days> days and exit', (v) => parseInt(v, 10))
  // cover/image-selection functionality removed
  .action(async (options) => {
    const scraper = new WWOZScraper();
    const enricher = new SpotifyEnricher();

    // Create workflow service first (it will initialize artist discovery)
    const workflow = new WorkflowService(scraper, enricher, null as any); // temporary null

    // Create archiver with day-change callback that sets pending archive in workflow
    const archiver = new ObsidianArchiver((previousDayArchivePath: string) => {
      workflow.setPendingArchive(previousDayArchivePath);
    });

    // Now set the archiver on workflow
    workflow.setArchiver(archiver);

    // Keybinding: Up Arrow triggers immediate refresh in continuous mode
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (key: string) => {
          // Ctrl+C exits
          if (key === '\u0003') {
            Logger.info('Exiting on Ctrl+C');
            process.exit();
          }
          // Up Arrow sequence
          if (key === '\u001b[A') {
            Logger.info('Manual refresh requested (Up Arrow).');
            workflow.requestImmediateRun();
          }
        });
      }
    } catch {
      // Non-TTY environments may throw; ignore safely
    }

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

    if (typeof options.backfillArtists === 'number' && !Number.isNaN(options.backfillArtists)) {
      const days = Math.max(1, options.backfillArtists);
      Logger.info(`Backfilling artist discovery for past ${days} day(s)...`);
      await workflow.backfillArtistDiscovery(days);
      return;
    }

    // image cover update and indexing commands removed

    if (options.once) {
      Logger.info('Starting a single run...');
      await workflow.runOnce();
    } else {
      Logger.info('Starting continuous monitoring mode...');
      await workflow.runContinuous();
    }
  });

program.parse(process.argv);
