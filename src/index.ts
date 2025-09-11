import { Logger } from './utils/logger.js';
import { SpotifyEnricher } from './modules/enrichers/SpotifyEnricher.js';
import { ScrapedSong } from './types/index.js';

async function testEnricher() {
  Logger.info('Testing the Spotify Enricher...');
  const enricher = new SpotifyEnricher();
  
  const testSong: ScrapedSong = {
    artist: 'The Meters',
    title: 'Cissy Strut',
    scrapedAt: new Date().toISOString()
  };

  try {
    const match = await enricher.findMatch(testSong);
    if (match) {
      Logger.info(`Found match: ${match.track.name} with ${match.confidence.toFixed(1)}% confidence.`);
      console.log(match);
    } else {
      Logger.warn('No confident match found.');
    }
  } catch (error) {
    Logger.error('Enricher test failed', error);
  }
}

testEnricher();
