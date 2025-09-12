import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { Logger } from '../../utils/logger.js';
export class ImageDb {
    db;
    constructor(dbPath) {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        this.db = new Database(dbPath);
        this.migrate();
    }
    migrate() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        path TEXT PRIMARY KEY,
        mtimeMs INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        sha256 TEXT,
        dhash TEXT,
        sharpness REAL,
        brightness REAL,
        clipScore REAL,
        used INTEGER NOT NULL DEFAULT 0,
        processedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_images_used ON images(used);
      CREATE INDEX IF NOT EXISTS idx_images_dhash ON images(dhash);
    `);
    }
    upsertImage(row) {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      INSERT INTO images (path, mtimeMs, width, height, sha256, dhash, sharpness, brightness, clipScore, used, processedAt)
      VALUES (@path, @mtimeMs, @width, @height, @sha256, @dhash, @sharpness, @brightness, @clipScore, COALESCE(@used, 0), @processedAt)
      ON CONFLICT(path) DO UPDATE SET
        mtimeMs=excluded.mtimeMs,
        width=COALESCE(excluded.width, images.width),
        height=COALESCE(excluded.height, images.height),
        sha256=COALESCE(excluded.sha256, images.sha256),
        dhash=COALESCE(excluded.dhash, images.dhash),
        sharpness=COALESCE(excluded.sharpness, images.sharpness),
        brightness=COALESCE(excluded.brightness, images.brightness),
        clipScore=COALESCE(excluded.clipScore, images.clipScore),
        used=COALESCE(excluded.used, images.used),
        processedAt=COALESCE(excluded.processedAt, images.processedAt)
    `);
        try {
            const params = {
                path: row.path,
                mtimeMs: row.mtimeMs,
                width: row.width ?? null,
                height: row.height ?? null,
                sha256: row.sha256 ?? null,
                dhash: row.dhash ?? null,
                sharpness: row.sharpness ?? null,
                brightness: row.brightness ?? null,
                clipScore: row.clipScore ?? null,
                used: row.used ?? 0,
                processedAt: row.processedAt ?? now,
            };
            stmt.run(params);
        }
        catch (err) {
            Logger.error('Failed to upsert image row', err);
            throw err;
        }
    }
    markUsed(p) {
        const stmt = this.db.prepare(`UPDATE images SET used = 1, processedAt = @now WHERE path = @path`);
        stmt.run({ path: p, now: new Date().toISOString() });
    }
    getRow(p) {
        const stmt = this.db.prepare(`SELECT * FROM images WHERE path = ?`);
        return stmt.get(p) ?? null;
    }
    getUsedDhashes() {
        const stmt = this.db.prepare(`SELECT dhash FROM images WHERE used = 1 AND dhash IS NOT NULL`);
        return stmt.all().map((r) => r.dhash);
    }
    getCandidates(minSharpness, minBrightness) {
        const stmt = this.db.prepare(`
      SELECT * FROM images
      WHERE used = 0
        AND sharpness IS NOT NULL AND sharpness >= @minSharpness
        AND brightness IS NOT NULL AND brightness >= @minBrightness
        AND dhash IS NOT NULL AND sha256 IS NOT NULL
        AND width IS NOT NULL AND height IS NOT NULL
    `);
        return stmt.all({ minSharpness, minBrightness });
    }
    all() {
        return this.db.prepare('SELECT * FROM images').all();
    }
    close() {
        this.db.close();
    }
}
