import fs from 'fs';
import path from 'path';
import { Logger } from '../../utils/logger.js';
import { config } from '../../utils/config.js';
import { ImageDb } from './db.js';
import { computeDhash, computeSha256, computeSharpnessAndBrightness, hamming, readImageInfo, openSharp } from './image-utils.js';
import { MusicianScorer } from './MusicianScorer.js';
export class ImageSelector {
    db;
    scorer;
    constructor() {
        this.db = new ImageDb(config.images.usedDbPath);
        this.scorer = new MusicianScorer(config.images);
    }
    isImageFile(file) {
        const ext = path.extname(file).toLowerCase();
        if (config.images.excludeExtensions.map((e) => e.toLowerCase()).includes(ext))
            return false;
        return ['.jpg', '.jpeg', '.png', '.heic', '.webp', '.orf', '.arw', '.cr2', '.cr3', '.nef', '.raf', '.rw2', '.dng'].includes(ext);
    }
    async indexFolder(dir) {
        const files = [];
        const stack = [dir];
        while (stack.length) {
            const d = stack.pop();
            let entries = [];
            try {
                entries = fs.readdirSync(d, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const ent of entries) {
                const p = path.join(d, ent.name);
                if (ent.isDirectory())
                    stack.push(p);
                else if (ent.isFile() && this.isImageFile(p))
                    files.push(p);
            }
        }
        return files;
    }
    async ensureIndexed(p) {
        const st = fs.statSync(p);
        const row = this.db.getRow(p);
        if (row && row.mtimeMs === st.mtimeMs)
            return; // up-to-date
        // Extract basics
        const info = await readImageInfo(p);
        if (!info) {
            this.db.upsertImage({ path: p, mtimeMs: st.mtimeMs, width: null, height: null });
            return;
        }
        const sha256 = await computeSha256(p);
        const dhash = await computeDhash(p);
        const qb = await computeSharpnessAndBrightness(p);
        this.db.upsertImage({
            path: p,
            mtimeMs: st.mtimeMs,
            width: info.width,
            height: info.height,
            sha256,
            dhash,
            sharpness: qb?.sharpness ?? null,
            brightness: qb?.brightness ?? null,
        });
    }
    async ensureClipScore(p) {
        const row = this.db.getRow(p);
        if (!row)
            return;
        if (row.clipScore !== null && row.clipScore !== undefined)
            return;
        const s = await this.scorer.score(p);
        if (s !== null && s !== undefined) {
            this.db.upsertImage({ path: p, mtimeMs: row.mtimeMs, clipScore: s });
        }
    }
    filterNearDuplicates(cands, usedHashes) {
        const result = [];
        const seen = [...usedHashes];
        for (const c of cands) {
            if (!c.dhash)
                continue;
            let isDup = false;
            for (const h of seen) {
                if (h && hamming(c.dhash, h) <= config.images.duplicateHammingMax) {
                    isDup = true;
                    break;
                }
            }
            if (!isDup) {
                result.push(c.path);
                seen.push(c.dhash);
            }
        }
        return result;
    }
    async pickBest(dryRun = false) {
        const folder = config.images.folderPath;
        const files = await this.indexFolder(folder);
        Logger.info(`Image indexing: found ${files.length} files under ${folder}`);
        // Index/update basics and quality
        for (const p of files) {
            try {
                await this.ensureIndexed(p);
            }
            catch { }
        }
        // Gather candidates by quality
        const allCands = this.db.getCandidates(config.images.minSharpness, config.images.minBrightness);
        const cands = allCands.filter((r) => r.path.startsWith(folder));
        Logger.info(`Candidates after quality filter: ${cands.length}`);
        if (cands.length === 0)
            return null;
        // Filter near-duplicates against used and within candidates
        const usedHashes = this.db.getUsedDhashes();
        const dedupOrder = cands
            .filter((r) => r.dhash)
            .map((r) => ({ path: r.path, dhash: r.dhash }));
        const uniquePaths = this.filterNearDuplicates(dedupOrder, usedHashes);
        Logger.info(`Unique after dedupe: ${uniquePaths.length}`);
        if (uniquePaths.length === 0)
            return null;
        // Ensure CLIP scores for all unique candidates
        for (const p of uniquePaths) {
            try {
                await this.ensureClipScore(p);
            }
            catch { }
        }
        // Rank
        const withScores = uniquePaths
            .map((p) => this.db.getRow(p))
            .filter((r) => r.clipScore !== null && r.clipScore !== undefined)
            .sort((a, b) => (b.clipScore - a.clipScore) || (b.sharpness - a.sharpness) || (b.brightness - a.brightness));
        // Selection strategy
        let best = withScores[0];
        const sel = config.images.selection ?? {};
        const strategy = sel.strategy ?? 'softmax';
        if (withScores.length > 0) {
            if (strategy === 'top_k') {
                const k = Math.max(1, Math.min(sel.topK ?? 200, withScores.length));
                const idx = Math.floor(Math.random() * k);
                best = withScores[idx];
            }
            else if (strategy === 'softmax') {
                const temp = sel.temperature ?? 0.15;
                const max = withScores[0].clipScore ?? 0;
                // Compute softmax weights biased toward higher CLIP scores
                const weights = withScores.map((r) => Math.exp(((r.clipScore ?? 0) - max) / Math.max(0.001, temp)));
                const total = weights.reduce((a, b) => a + b, 0);
                let target = Math.random() * total;
                for (let i = 0; i < withScores.length; i++) {
                    target -= weights[i];
                    if (target <= 0) {
                        best = withScores[i];
                        break;
                    }
                }
            }
            else if (strategy === 'uniform') {
                const idx = Math.floor(Math.random() * withScores.length);
                best = withScores[idx];
            }
            else {
                // 'best' — keep top-1 as-is
                best = withScores[0];
            }
        }
        if (!best)
            return null;
        if (!dryRun)
            this.db.markUsed(best.path);
        return {
            path: best.path,
            clipScore: best.clipScore ?? 0,
            sharpness: best.sharpness ?? 0,
            brightness: best.brightness ?? 0,
        };
    }
    async prepareCover(filePath, maxKB) {
        // Auto-rotate, center-crop to square, resize to 640, JPEG compress under maxKB
        const s = await openSharp(filePath);
        if (!s) {
            throw new Error(`Unsupported or unreadable image for cover: ${filePath}`);
        }
        let img = s.rotate();
        const meta = await img.metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        const side = Math.min(w, h);
        const left = Math.max(0, Math.floor((w - side) / 2));
        const top = Math.max(0, Math.floor((h - side) / 2));
        img = img.extract({ left, top, width: side, height: side }).resize(640, 640, { fit: 'cover' });
        // Optional: convert to black & white before encoding
        if (config.cover?.grayscale) {
            img = img.grayscale();
        }
        let quality = 90;
        for (let attempt = 0; attempt < 6; attempt++) {
            const buf = await img.jpeg({ quality, mozjpeg: true }).toBuffer();
            const kb = Math.ceil(buf.length / 1024);
            if (kb <= maxKB)
                return buf;
            quality = Math.max(40, Math.floor(quality * 0.85));
        }
        // As a last resort, shrink a bit and try again
        img = img.resize(600, 600, { fit: 'cover' });
        const buf = await img.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
        return buf;
    }
}
