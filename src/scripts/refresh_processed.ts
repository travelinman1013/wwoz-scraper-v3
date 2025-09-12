import fs from 'fs';
import path from 'path';
import { Logger } from '../utils/logger.js';

// Allowed image extensions (lowercase, with dot)
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.heic', '.webp', '.orf', '.arw', '.cr2', '.cr3', '.nef', '.raf', '.rw2', '.dng'];

async function listFilesRecursively(dir: string): Promise<string[]> {
  const results: string[] = [];
  const stack: string[] = [dir];
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
      else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (ALLOWED_EXTS.includes(ext)) results.push(p);
      }
    }
  }
  return results;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function clearDirectory(dir: string) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) continue; // keep directories intact if any
    try { fs.unlinkSync(p); } catch {}
  }
}

async function copySample(files: string[], destDir: string, count: number) {
  await ensureDir(destDir);
  shuffleInPlace(files);
  const pick = files.slice(0, Math.min(count, files.length));
  let idx = 1;
  for (const src of pick) {
    const base = path.basename(src);
    const name = `${String(idx).padStart(4, '0')}-${base}`;
    const dest = path.join(destDir, name);
    fs.copyFileSync(src, dest);
    idx++;
  }
}

async function main() {
  const [,, sourceArg, countArg, destArg] = process.argv;
  if (!sourceArg) {
    console.error('Usage: node dist/scripts/refresh_processed.js <sourceDir> [count=100] [destDir=data/processed-500]');
    process.exit(1);
  }
  const sourceDir = path.resolve(sourceArg);
  const count = countArg ? Math.max(1, parseInt(countArg, 10) || 100) : 100;
  const destDir = path.resolve(destArg || 'data/processed-500');

  Logger.info(`Scanning source directory: ${sourceDir}`);
  const files = await listFilesRecursively(sourceDir);
  Logger.info(`Found ${files.length} candidate images in source.`);
  if (files.length === 0) {
    console.error('No images found in source directory.');
    process.exit(2);
  }

  Logger.info(`Clearing destination: ${destDir}`);
  await ensureDir(destDir);
  await clearDirectory(destDir);

  Logger.info(`Copying ${Math.min(count, files.length)} random images to destination...`);
  await copySample(files, destDir, count);
  Logger.info('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

