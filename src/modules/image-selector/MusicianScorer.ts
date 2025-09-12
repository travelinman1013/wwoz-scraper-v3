import { pipeline } from '@xenova/transformers';
import type { ImagesConfig } from '../../utils/config.js';
import { Logger } from '../../utils/logger.js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { loadJpegBuffer } from './image-utils.js';

export class MusicianScorer {
  private cfg: ImagesConfig;
  private pipePromise: Promise<any> | null = null;

  constructor(cfg: ImagesConfig) {
    this.cfg = cfg;
  }

  private async getPipeline() {
    if (!this.pipePromise) {
      // zero-shot image classification using CLIP
      this.pipePromise = pipeline('zero-shot-image-classification', this.cfg.clip.model === 'auto' ? undefined : this.cfg.clip.model);
    }
    return this.pipePromise;
  }

  async score(filePath: string): Promise<number | null> {
    try {
      const classify = await this.getPipeline();
      const labels = [...this.cfg.clip.positivePrompts, ...this.cfg.clip.negativePrompts];
      // Ensure the input is a JPEG buffer to avoid unsupported formats (HEIC/RAW/etc)
      const buf = await loadJpegBuffer(filePath);
      if (!buf) {
        Logger.warn(`Skipping CLIP scoring; unreadable image: ${filePath}`);
        return null;
      }
      // Xenova transformers expects a path/URL (or browser-native types) — not a Buffer.
      // Write to a temp JPEG and pass the file path, then clean up.
      const tmpPath = path.join(
        os.tmpdir(),
        `wwoz-clip-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
      );
      await fs.writeFile(tmpPath, buf);
      let result: Array<{ label: string; score: number }> = [];
      try {
        result = await classify(tmpPath, labels);
      } finally {
        // Best-effort cleanup
        try { await fs.unlink(tmpPath); } catch {}
      }
      // result: array of { label, score }
      let pos = 0;
      let neg = 0;
      for (const r of result) {
        if (this.cfg.clip.positivePrompts.includes(r.label)) pos = Math.max(pos, Number(r.score) || 0);
        if (this.cfg.clip.negativePrompts.includes(r.label)) neg = Math.max(neg, Number(r.score) || 0);
      }
      // Combine: margin between best positive and best negative. Range roughly -1..1
      const margin = pos - neg;
      return margin;
    } catch (err) {
      Logger.error('CLIP scoring failed', err);
      return null;
    }
  }
}
