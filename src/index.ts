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
  .action(async (options) => {
    const scraper = new WWOZScraper();
    const enricher = new SpotifyEnricher();
    const archiver = new ObsidianArchiver();
    const workflow = new WorkflowService(scraper, enricher, archiver);

    if (options.once) {
      Logger.info('Starting a single run...');
      await workflow.runOnce();
    } else {
      Logger.info('Starting continuous monitoring mode...');
      await workflow.runContinuous();
    }
  });

program.parse(process.argv);
