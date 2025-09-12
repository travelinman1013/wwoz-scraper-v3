import fs from 'fs';
import path from 'path';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { ImageDb, ImageRow } from '../modules/image-selector/db.js';
import { computeDhash, computeSha256, computeSharpnessAndBrightness, readImageInfo, loadJpegBuffer } from '../modules/image-selector/image-utils.js';
import crypto from 'crypto';
import { MusicianScorer } from '../modules/image-selector/MusicianScorer.js';

function isImageFile(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  if (config.images.excludeExtensions.map((e) => e.toLowerCase()).includes(ext)) return false;
  return ['.jpg', '.jpeg', '.png', '.heic', '.webp', '.orf', '.arw', '.cr2', '.cr3', '.nef', '.raf', '.rw2', '.dng'].includes(ext);
}

async function walkFolder(dir: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile() && isImageFile(p)) files.push(p);
    }
  }
  return files;
}

async function indexOne(db: ImageDb, p: string): Promise<void> {
  const st = fs.statSync(p);
  const existing = db.getRow(p);
  if (existing && existing.mtimeMs === st.mtimeMs) return;

  const info = await readImageInfo(p);
  if (!info) {
    db.upsertImage({ path: p, mtimeMs: st.mtimeMs, width: null, height: null });
    return;
  }
  // Robust SHA256: for RAW files, hash the JPEG preview buffer to avoid filesystem/read issues
  let sha256: string | null = null;
  try {
    const ext = path.extname(p).toLowerCase();
    const isRaw = ['.orf', '.arw', '.cr2', '.cr3', '.nef', '.raf', '.rw2', '.dng'].includes(ext);
    if (isRaw) {
      const buf = await loadJpegBuffer(p);
      if (buf) {
        sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      } else {
        sha256 = await computeSha256(p);
      }
    } else {
      sha256 = await computeSha256(p);
    }
  } catch {
    sha256 = null; // continue; other fields can still be stored
  }
  const dhash = await computeDhash(p);
  const qb = await computeSharpnessAndBrightness(p);
  db.upsertImage({
    path: p,
    mtimeMs: st.mtimeMs,
    width: info.width,
    height: info.height,
    sha256: sha256 ?? null,
    dhash,
    sharpness: qb?.sharpness ?? null,
    brightness: qb?.brightness ?? null,
  });
}

export async function indexAllImages(): Promise<void> {
  const folder = config.images.folderPath;
  const db = new ImageDb(config.images.usedDbPath);
  const scorer = new MusicianScorer(config.images);
  try {
    Logger.info(`Scanning folder: ${folder}`);
    const files = await walkFolder(folder);
    Logger.info(`Found ${files.length} image files to consider.`);

    let updated = 0;
    for (let i = 0; i < files.length; i++) {
      const p = files[i];
      try {
        await indexOne(db, p);
        updated++;
        if (updated % 200 === 0) Logger.info(`Indexed ${updated}/${files.length}...`);
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        Logger.warn(`Index failure for ${p} | ${msg}`);
      }
    }
    Logger.info(`Indexing complete. ${updated} processed.`);

    // Compute CLIP scores for any quality-eligible rows missing scores
    const all: ImageRow[] = db.all();
    const toScore = all.filter((r) =>
      r.used === 0 &&
      r.width !== null && r.height !== null &&
      r.sha256 !== null && r.dhash !== null &&
      r.sharpness !== null && r.brightness !== null &&
      (r.clipScore === null || r.clipScore === undefined)
    );
    Logger.info(`CLIP scoring needed for ${toScore.length} images.`);

    let scored = 0;
    for (let i = 0; i < toScore.length; i++) {
      const r = toScore[i];
      try {
        const s = await scorer.score(r.path);
        if (s !== null && s !== undefined) {
          db.upsertImage({ path: r.path, mtimeMs: r.mtimeMs, clipScore: s });
          scored++;
          if (scored % 100 === 0) Logger.info(`Scored ${scored}/${toScore.length}...`);
        }
      } catch {
        // already logged inside scorer
      }
    }
    Logger.info(`CLIP scoring complete. ${scored} updated.`);
  } finally {
    db.close();
  }
}
