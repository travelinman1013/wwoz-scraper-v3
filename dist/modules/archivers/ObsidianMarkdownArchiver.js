import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import dayjs from 'dayjs';
import { Logger } from '../../utils/logger.js';
import { config } from '../../utils/config.js';
export class ObsidianMarkdownArchiver {
    async archiveDay(date, items) {
        const basePath = config.archive.basePath;
        if (!basePath || basePath.trim().length === 0) {
            throw new Error('archive.basePath is not configured.');
        }
        const day = dayjs(date);
        const baseRoot = this.computeBaseRoot(basePath);
        const dir = path.join(baseRoot, day.format('YYYY'), day.format('MM'));
        const filePath = path.join(dir, `${day.format('YYYY-MM-DD')}-wwoz-tracks.md`);
        await this.ensureDir(dir);
        const now = dayjs();
        const existing = await this.readExisting(filePath);
        const existingRows = existing?.rows ?? [];
        let nextSeq = this.getNextSeq(existingRows);
        let written = 0;
        let skipped = 0;
        const dedupWindowMin = config.archive.deduplicationWindowMinutes ?? 0;
        for (const { song, match } of items) {
            const scrapedAt = dayjs(song.scrapedAt);
            if (!scrapedAt.isValid()) {
                Logger.warn(`Skipping song with invalid scrapedAt: ${song.artist} - ${song.title}`);
                skipped++;
                continue;
            }
            // Dedup within window using normalized artist+title vs existing rows' scraped times
            if (dedupWindowMin > 0 && this.isDuplicateWithinWindow(existingRows, song, scrapedAt.toDate(), dedupWindowMin)) {
                Logger.info(`Dedup (within ${dedupWindowMin}m): ${song.artist} - ${song.title}`);
                skipped++;
                continue;
            }
            nextSeq += 1;
            const id = `${scrapedAt.format('HHmmss')}-${String(nextSeq).padStart(3, '0')}`;
            const row = this.buildRow(id, song, match);
            existingRows.push(row);
            written++;
        }
        // Keep rows ordered as they appear (existing + new appended). This preserves scrape order.
        const fm = this.buildFrontmatter(existing?.frontmatter ?? null, day, now, written);
        const content = this.renderFile(fm, existingRows);
        await fs.promises.writeFile(filePath, content, 'utf8');
        Logger.info(`Archived ${written} song(s) to ${filePath} (skipped ${skipped}).`);
        return { filePath, written, skipped };
    }
    // Allows archive.basePath to be either the vault root, or include
    // optional trailing /YYYY or /YYYY/MM segments. We strip those so that
    // we always create year/month based on the provided date.
    computeBaseRoot(input) {
        const norm = path.resolve(input);
        const parts = norm.split(path.sep).filter(Boolean);
        if (parts.length === 0)
            return norm;
        const last = parts[parts.length - 1];
        const prev = parts[parts.length - 2];
        const isYear = (s) => !!s && /^\d{4}$/.test(s);
        const isMonth = (s) => !!s && /^(0[1-9]|1[0-2])$/.test(s);
        if (isYear(prev) && isMonth(last)) {
            // Strip /YYYY/MM
            return path.sep + parts.slice(0, -2).join(path.sep);
        }
        if (isYear(last)) {
            // Strip /YYYY
            return path.sep + parts.slice(0, -1).join(path.sep);
        }
        return norm;
    }
    async ensureDir(dir) {
        await fs.promises.mkdir(dir, { recursive: true });
    }
    buildFrontmatter(prev, day, now, wrote) {
        const base = prev ?? {
            title: `WWOZ Tracks - ${day.format('YYYY-MM-DD')}`,
            date: day.format('YYYY-MM-DD'),
            tags: ['wwoz', 'music', 'radio', 'new-orleans'],
            type: 'daily-archive',
            archiveCreated: now.format('YYYY-MM-DD HH:mm:ss'),
            lastUpdated: now.format('YYYY-MM-DD HH:mm:ss'),
            totalRunsToday: 0,
            lastRunStatus: '-'
        };
        // Update dynamic fields
        base.lastUpdated = now.format('YYYY-MM-DD HH:mm:ss');
        base.totalRunsToday = (prev?.totalRunsToday ?? 0) + 1;
        return base;
    }
    buildRow(id, song, match) {
        const playedTime = song.playedTime?.trim() || '-';
        const album = song.album?.trim() || '-';
        const scraped = dayjs(song.scrapedAt).format('HH:mm:ss');
        let status = '-';
        let confidence = '-';
        let spotify = '-';
        if (match) {
            const conf = typeof match.confidence === 'number' ? Number(match.confidence) : NaN;
            confidence = Number.isFinite(conf) ? `${conf.toFixed(1)}%` : '-';
            if (conf >= 70) {
                status = '✅ Found';
            }
            else if (conf > 0) {
                status = '⚠️ Low Confidence';
            }
            else {
                status = '❌ Not Found';
            }
            if (match.track?.id) {
                const url = `https://open.spotify.com/track/${match.track.id}`;
                spotify = `[Open](${url})`;
            }
        }
        return {
            id,
            time: playedTime.length >= 4 && playedTime.includes(':') ? playedTime.slice(0, 5) : playedTime,
            artist: song.artist || '-',
            title: song.title || '-',
            album,
            status,
            confidence,
            spotify,
            scraped,
        };
    }
    isDuplicateWithinWindow(existingRows, song, scrapedAt, windowMinutes) {
        const norm = (s) => s
            .toLowerCase()
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
        const targetArtist = norm(song.artist || '');
        const targetTitle = norm(song.title || '');
        if (!targetArtist && !targetTitle)
            return false;
        const windowMs = windowMinutes * 60 * 1000;
        const scrapedMs = scrapedAt.getTime();
        for (const row of existingRows) {
            const artist = norm(row.artist);
            const title = norm(row.title);
            if (artist === targetArtist && title === targetTitle) {
                // Compare times using the file's date + scraped HH:MM:SS
                // We cannot reliably get the date from the row, but given this is per-day file,
                // use the same day as the archive date.
                const rowTime = row.scraped; // HH:mm:ss
                const [hh, mm, ss] = rowTime.split(':').map((x) => Number(x) || 0);
                const sameDay = new Date(scrapedAt);
                sameDay.setHours(hh, mm, ss, 0);
                const delta = Math.abs(scrapedMs - sameDay.getTime());
                if (delta <= windowMs)
                    return true;
            }
        }
        return false;
    }
    getNextSeq(rows) {
        let max = 0;
        for (const r of rows) {
            const m = r.id.match(/-(\d{3,})$/);
            if (m) {
                const n = Number(m[1]);
                if (!Number.isNaN(n))
                    max = Math.max(max, n);
            }
        }
        return max;
    }
    async readExisting(filePath) {
        try {
            const text = await fs.promises.readFile(filePath, 'utf8');
            return this.parseExisting(text);
        }
        catch (e) {
            if (e && e.code === 'ENOENT')
                return null;
            throw e;
        }
    }
    parseExisting(text) {
        let frontmatter = null;
        let rest = text;
        if (text.startsWith('---')) {
            const end = text.indexOf('\n---', 3);
            if (end !== -1) {
                const fmText = text.slice(3, end).trim();
                try {
                    const parsed = yaml.load(fmText);
                    if (parsed && typeof parsed === 'object') {
                        frontmatter = {
                            title: String(parsed.title ?? ''),
                            date: String(parsed.date ?? ''),
                            tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
                            type: String(parsed.type ?? ''),
                            archiveCreated: parsed.archiveCreated ? String(parsed.archiveCreated) : undefined,
                            lastUpdated: parsed.lastUpdated ? String(parsed.lastUpdated) : undefined,
                            totalRunsToday: typeof parsed.totalRunsToday === 'number' ? parsed.totalRunsToday : undefined,
                            lastRunStatus: parsed.lastRunStatus ? String(parsed.lastRunStatus) : undefined,
                        };
                    }
                }
                catch {
                    // ignore YAML errors; keep frontmatter null
                }
                rest = text.slice(end + 4); // skip closing '---\n'
            }
        }
        // Find Tracks table header
        const startIdx = rest.indexOf('\n## Tracks');
        if (startIdx === -1)
            return { frontmatter, rows: [] };
        const tblIdx = rest.indexOf('\n\n|', startIdx);
        if (tblIdx === -1)
            return { frontmatter, rows: [] };
        const tableText = rest.slice(tblIdx).trim();
        const lines = tableText.split(/\n+/);
        const rows = [];
        // Skip first two lines (header + separator)
        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith('|'))
                break; // stop at first non-table line
            const cols = line.split('|').map((s) => s.trim());
            // cols[0] is empty due to leading '|'; last col may be '' due to trailing '|'
            const cells = cols.slice(1, -1);
            if (cells.length < 9)
                continue;
            const [id, time, artist, title, album, status, confidence, spotify, scraped] = cells;
            rows.push({ id, time, artist, title, album, status, confidence, spotify, scraped });
        }
        return { frontmatter, rows };
    }
    renderFile(fm, rows) {
        const day = dayjs(fm.date);
        const header = `---\n${yaml.dump({
            title: fm.title,
            date: fm.date,
            tags: fm.tags,
            type: fm.type,
            archiveCreated: fm.archiveCreated,
            lastUpdated: fm.lastUpdated,
            totalRunsToday: fm.totalRunsToday,
            lastRunStatus: fm.lastRunStatus,
        }).trim()}\n---\n`;
        const prettyTitle = `WWOZ Tracks - ${day.format('dddd, MMMM D, YYYY')}`;
        const intro = `\n# ${prettyTitle}\n\nThis archive contains all tracks scraped from WWOZ's playlist on ${day.format('YYYY-MM-DD')}.\n`;
        // Stats
        const stats = this.computeStats(rows);
        const summary = `\n## Summary\n\n- **Date**: ${day.format('YYYY-MM-DD')}\n- **Day**: ${day.format('dddd')}\n- **Archive Created**: ${fm.archiveCreated ?? ''}\n- **Last Updated**: ${fm.lastUpdated ?? ''}\n- **Total Runs Today**: ${fm.totalRunsToday ?? 0}\n- **Last Run Status**: ${fm.lastRunStatus ?? '-'}\n`;
        const dailyStats = `\n## Daily Statistics\n\n| Metric             | Count |\n| ------------------ | ----- |\n| Total Tracks       | ${stats.total}   |\n| Successfully Found | ${stats.found}   |\n| Not Found          | ${stats.notFound}    |\n| Low Confidence     | ${stats.lowConfidence}     |\n| Duplicates         | ${stats.duplicates}     |\n`;
        // Tracks table
        const head = `\n## Tracks\n\n\n| ID         | Time  | Artist                                                      | Title                                         | Album                                                            | Status       | Confidence | Spotify                                                       | Scraped  |\n| ---------- | ----- | ----------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- | ------------ | ---------- | ------------------------------------------------------------- | -------- |`;
        const body = rows.map((r) => this.renderRow(r)).join('\n');
        return [header, intro, summary, dailyStats, head, body, ''].join('\n');
    }
    computeStats(rows) {
        let found = 0, notFound = 0, low = 0;
        for (const r of rows) {
            if (r.status.startsWith('✅'))
                found++;
            else if (r.status.startsWith('❌'))
                notFound++;
            else if (r.status.startsWith('⚠️'))
                low++;
        }
        return {
            total: rows.length,
            found,
            notFound,
            lowConfidence: low,
            duplicates: 0, // only computed across runs; left 0 here
        };
    }
    renderRow(r) {
        // Pad columns visually similar to example by fixed-width table header; content can vary.
        const cells = [r.id, r.time, r.artist, r.title, r.album, r.status, r.confidence, r.spotify, r.scraped];
        return `| ${cells.join(' | ')} |`;
    }
}
