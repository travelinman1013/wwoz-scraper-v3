import { Logger } from './utils/logger.js';
import { ObsidianArchiver } from './modules/archivers/ObsidianArchiver.js';
import type { ArchiveEntry } from './types/index.js';

async function testArchiver() {
  Logger.info('Testing the Obsidian Archiver...');
  const archiver = new ObsidianArchiver();

  const testEntry: ArchiveEntry = {
    song: { artist: 'Test Artist', title: 'Test Title', scrapedAt: new Date().toISOString() },
    status: 'found',
    match: { confidence: 95.5, track: { external_urls: { spotify: 'http://spotify.com' } } } as any,
    archivedAt: new Date().toISOString(),
  };

  try {
    await archiver.archive(testEntry);
    Logger.info('Archive test successful. Check your configured directory for the markdown file.');
  } catch (error) {
    Logger.error('Archiver test failed', error);
  }
}

testArchiver();
