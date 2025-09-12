import dayjs from 'dayjs';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { ImageSelector } from '../modules/image-selector/ImageSelector.js';
import { SpotifyEnricher } from '../modules/enrichers/SpotifyEnricher.js';
import { buildWwozDisplayTitle } from '../utils/date.js';

export async function updateSnapshotCover(date: string, dryRun: boolean): Promise<void> {
  const d = dayjs(date);
  if (!d.isValid()) {
    throw new Error(`Invalid date for --update-cover: ${date}`);
  }
  const playlistName = buildWwozDisplayTitle(d);
  const enricher = new SpotifyEnricher();

  const { id: playlistId, name } = await enricher.getOrCreatePlaylist(playlistName);
  Logger.info(`Target snapshot playlist: ${name} (${playlistId})`);

  const selector = new ImageSelector();
  const chosen = await selector.pickBest(dryRun || config.dryRun);
  if (!chosen) {
    Logger.warn('No suitable image found for cover.');
    return;
  }

  Logger.info(`Chosen image: ${chosen.path} | clip=${chosen.clipScore.toFixed(3)} sharp=${chosen.sharpness.toFixed(1)} bright=${chosen.brightness.toFixed(3)}`);
  if (dryRun || config.dryRun) return;

  const buf = await selector.prepareCover(chosen.path, config.cover.maxKB);
  const base64 = buf.toString('base64');
  await enricher.uploadPlaylistCover(playlistId, base64);
  Logger.info('Cover image uploaded successfully.');
}

