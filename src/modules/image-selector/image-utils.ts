import fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp';
import os from 'os';
import path from 'path';
import fsPromises from 'fs/promises';
import { exiftool } from 'exiftool-vendored';

function isRawExt(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.orf', '.arw', '.cr2', '.cr3', '.nef', '.raf', '.rw2', '.dng'].includes(ext);
}

export async function openSharp(filePath: string): Promise<sharp.Sharp | null> {
  try {
    if (!isRawExt(filePath)) {
      return sharp(filePath);
    }
    // Try extracting an embedded JPEG preview via exiftool to a temp file, then read it
    const tmp = path.join(os.tmpdir(), `raw-preview-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    try {
      await exiftool.extractPreview(filePath, tmp).catch(async () => {
        // Fallback to thumbnail if preview missing
        await exiftool.extractThumbnail(filePath, tmp);
      });
      const buf = await fsPromises.readFile(tmp);
      await fsPromises.unlink(tmp).catch(() => {});
      return sharp(buf);
    } catch {
      // Do not attempt to decode RAW directly with libvips; many DNG/RAW compressions are unsupported.
      // Indicate unreadable by returning null so callers can skip heavy processing gracefully.
      return null;
    }
  } catch {
    return null;
  }
}

// Load any supported file (including RAW/HEIC via preview) as a JPEG-encoded buffer
export async function loadJpegBuffer(filePath: string): Promise<Buffer | null> {
  try {
    const s = await openSharp(filePath);
    if (!s) return null;
    // Normalize orientation and encode to JPEG for downstream consumers
    const buf = await s.rotate().jpeg().toBuffer();
    return buf;
  } catch {
    return null;
  }
}

export interface BasicImageInfo {
  width: number;
  height: number;
}

export async function readImageInfo(filePath: string): Promise<BasicImageInfo | null> {
  try {
    const s = await openSharp(filePath);
    if (s) {
      const meta = await s.metadata();
      if (meta.width && meta.height) return { width: meta.width, height: meta.height };
    }
    // Fallback for RAW without decodable preview: read dimensions via exiftool metadata
    try {
      const tags: any = await exiftool.read(filePath);
      const width = Number(
        tags.ImageWidth ?? tags.ExifImageWidth ?? tags.PreviewImageWidth ?? tags.SourceImageWidth ?? null
      );
      const height = Number(
        tags.ImageHeight ?? tags.ExifImageHeight ?? tags.PreviewImageHeight ?? tags.SourceImageHeight ?? null
      );
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { width, height };
      }
    } catch {
      // ignore
    }
    return null;
  } catch {
    return null;
  }
}

export async function computeSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return await new Promise<string>((resolve, reject) => {
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// 64-bit dHash (horizontal). Resize to 9x8 grayscale; compare adjacent pixels row-wise.
export async function computeDhash(filePath: string): Promise<string> {
  try {
    const s = await openSharp(filePath);
    if (!s) return '0'.repeat(16);
    const img = s.grayscale().resize(9, 8, { fit: 'fill' });
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const bits: number[] = [];
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width - 1; x++) {
        const i1 = y * info.width + x;
        const i2 = i1 + 1;
        bits.push(data[i1] > data[i2] ? 1 : 0);
      }
    }
    // Convert to 16 hex chars (64 bits)
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
      hex += nibble.toString(16);
    }
    return hex.padStart(16, '0');
  } catch {
    return '0'.repeat(16);
  }
}

export function hamming(hexA: string, hexB: string): number {
  const a = BigInt('0x' + hexA);
  const b = BigInt('0x' + hexB);
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

export async function computeSharpnessAndBrightness(filePath: string): Promise<{ sharpness: number; brightness: number } | null> {
  // Downscale for speed; grayscale; compute variance of Laplacian (sharpness) and mean luminance (brightness)
  try {
    const size = 512;
    const s = await openSharp(filePath);
    if (!s) return null;
    const img = s.grayscale().resize(size, size, { fit: 'inside', withoutEnlargement: true });
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const pix = data; // 0..255 grayscale

    let sum = 0;
    for (let i = 0; i < pix.length; i++) sum += pix[i];
    const brightness = (sum / pix.length) / 255; // 0..1

    // Laplacian kernel (4-neighbor): [[0,1,0],[1,-4,1],[0,1,0]]
    const lap: number[] = new Array(w * h).fill(0);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const center = pix[i];
        const up = pix[i - w];
        const down = pix[i + w];
        const left = pix[i - 1];
        const right = pix[i + 1];
        const L = (up + down + left + right) - 4 * center;
        lap[i] = L;
      }
    }
    // Variance of Laplacian
    let mean = 0;
    let count = 0;
    for (let i = w + 1; i < w * (h - 1) - 1; i++) { // skip borders
      mean += lap[i];
      count++;
    }
    mean /= Math.max(1, count);
    let variance = 0;
    for (let i = w + 1; i < w * (h - 1) - 1; i++) {
      const d = lap[i] - mean;
      variance += d * d;
    }
    variance /= Math.max(1, count);
    const sharpness = variance; // unbounded; threshold tuned empirically

    return { sharpness, brightness };
  } catch {
    return null;
  }
}
