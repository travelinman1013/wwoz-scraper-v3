import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import dayjs from 'dayjs';
import { Logger } from '../../utils/logger.js';
import { config } from '../../utils/config.js';
export class ObsidianArchiver {
    recentKeys = new Map(); // key -> lastWrittenEpochMs
    async archive(entry) {
        const basePath = config.archive.basePath;
        if (!basePath || basePath.trim().length === 0) {
            throw new Error('archive.basePath is not configured.');
        }
        // Choose date from archivedAt -> song.scrapedAt -> now
        const fileDate = this.resolveDate(entry);
        const root = this.computeBaseRoot(basePath);
        const dir = path.join(root, fileDate.format('YYYY'), fileDate.format('MM'));
        const filePath = path.join(dir, `${fileDate.format('YYYY-MM-DD')}.md`);
        await fs.promises.mkdir(dir, { recursive: true });
        if (!(await this.exists(filePath))) {
            const template = await this.loadTemplate();
            const content = ejs.render(template, {
                date: fileDate.format('YYYY-MM-DD'),
                url: config.wwoz.playlistUrl,
                dayjs,
            });
            await fs.promises.writeFile(filePath, content, 'utf8');
        }
        // In-memory dedup to avoid rapid duplicates
        if (this.isRecentDuplicate(entry)) {
            Logger.info(`Archive dedup: skipping ${entry.song.artist} - ${entry.song.title}`);
            return;
        }
        const row = this.formatRow(entry);
        // Append exactly one newline after the row; avoid leading newline
        // so we don't create blank lines between rows.
        await fs.promises.appendFile(filePath, `${row}\n`, 'utf8');
    }
    async finalizeDailyStats(date) {
        try {
            const basePath = config.archive.basePath;
            if (!basePath || basePath.trim().length === 0)
                return;
            const day = date ? dayjs(date) : dayjs();
            if (!day.isValid())
                return;
            const root = this.computeBaseRoot(basePath);
            const dir = path.join(root, day.format('YYYY'), day.format('MM'));
            const filePath = path.join(dir, `${day.format('YYYY-MM-DD')}.md`);
            if (!(await this.exists(filePath)))
                return;
            const original = await fs.promises.readFile(filePath, 'utf8');
            const stats = this.computeStatsFromMarkdown(original);
            const statsBlock = this.renderStatsBlock(stats);
            const updated = this.upsertStatsBlock(original, statsBlock);
            if (updated !== original) {
                await fs.promises.writeFile(filePath, updated, 'utf8');
                Logger.info(`Updated daily statistics for ${day.format('YYYY-MM-DD')} (total=${stats.total}, found=${stats.found}, notFound=${stats.notFound}, low=${stats.lowConfidence}, dups=${stats.duplicates}).`);
            }
        }
        catch (err) {
            Logger.error('Failed to finalize daily stats (non-fatal).', err);
        }
    }
    computeStatsFromMarkdown(content) {
        const lines = content.split(/\r?\n/);
        let inTracks = false;
        let headerSeen = false;
        let total = 0;
        let found = 0;
        let notFound = 0;
        let low = 0;
        const seenKeys = new Set();
        let duplicateCount = 0;
        for (const raw of lines) {
            const line = raw.trim();
            if (line.startsWith('## ')) {
                inTracks = line.toLowerCase().startsWith('## tracks');
                headerSeen = false;
                continue;
            }
            if (!inTracks)
                continue;
            if (line.startsWith('| :')) {
                // alignment row
                headerSeen = true;
                continue;
            }
            if (line.startsWith('|') && line.endsWith('|')) {
                // skip the header titles row
                if (!headerSeen)
                    continue;
                const cells = line
                    .split('|')
                    .map((s) => s.trim())
                    .slice(1, -1);
                if (cells.length < 7)
                    continue;
                total++;
                const statusCell = cells[6] || '';
                const statusLower = statusCell.toLowerCase();
                if (statusLower.includes('not found'))
                    notFound++;
                else if (statusLower.includes('low confidence'))
                    low++;
                else if (statusLower.includes('found'))
                    found++;
                // Duplicate detection by normalized artist+title
                const artist = (cells[1] || '').toLowerCase().replace(/\s+/g, ' ').trim();
                const title = (cells[2] || '').toLowerCase().replace(/\s+/g, ' ').trim();
                const key = `${artist}::${title}`;
                if (artist && title) {
                    if (seenKeys.has(key))
                        duplicateCount++;
                    else
                        seenKeys.add(key);
                }
            }
        }
        return { total, found, notFound, lowConfidence: low, duplicates: duplicateCount };
    }
    renderStatsBlock(stats) {
        const lines = [
            '<!-- wwoz:stats:start -->',
            '## Daily Statistics',
            '',
            '| Metric | Count |',
            '|--------|-------|',
            `| Total Tracks | ${stats.total} |`,
            `| Successfully Found | ${stats.found} |`,
            `| Not Found | ${stats.notFound} |`,
            `| Low Confidence | ${stats.lowConfidence} |`,
            `| Duplicates | ${stats.duplicates} |`,
            '<!-- wwoz:stats:end -->',
            '',
        ];
        return lines.join('\n');
    }
    upsertStatsBlock(content, statsBlock) {
        const startMarker = '<!-- wwoz:stats:start -->';
        const endMarker = '<!-- wwoz:stats:end -->';
        const re = new RegExp(`${startMarker}[\
\s\S]*?${endMarker}`);
        if (re.test(content)) {
            return content.replace(re, statsBlock);
        }
        // Insert above the Tracks section if present
        const tracksHeadingRe = /\n##\s+Tracks\s*\n/;
        if (tracksHeadingRe.test(content)) {
            return content.replace(tracksHeadingRe, `\n${statsBlock}\n\n## Tracks\n`);
        }
        // Fallback: append at end
        return `${content.trim()}\n\n${statsBlock}`;
    }
    resolveDate(entry) {
        const a = dayjs(entry.archivedAt);
        if (a.isValid())
            return a;
        const s = dayjs(entry.song.scrapedAt);
        if (s.isValid())
            return s;
        return dayjs();
    }
    async exists(p) {
        try {
            await fs.promises.access(p, fs.constants.F_OK);
            return true;
        }
        catch {
            return false;
        }
    }
    async loadTemplate() {
        const templatePath = path.resolve(process.cwd(), 'templates', 'daily-archive.md.ejs');
        return fs.promises.readFile(templatePath, 'utf8');
    }
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
            return path.sep + parts.slice(0, -2).join(path.sep);
        }
        if (isYear(last)) {
            return path.sep + parts.slice(0, -1).join(path.sep);
        }
        return norm;
    }
    normalize(s) {
        return s
            .toLowerCase()
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }
    isRecentDuplicate(entry) {
        const windowMinutes = config.archive.deduplicationWindowMinutes ?? 0;
        if (windowMinutes <= 0)
            return false;
        const key = `${this.normalize(entry.song.artist || '')}::${this.normalize(entry.song.title || '')}`;
        const now = Date.now();
        const last = this.recentKeys.get(key) || 0;
        const isDup = now - last <= windowMinutes * 60 * 1000;
        if (!isDup)
            this.recentKeys.set(key, now);
        return isDup;
    }
    formatRow(entry) {
        const time = this.safeCell(this.pickTime(entry));
        const artist = this.safeCell(entry.song.artist || '-');
        const title = this.safeCell(entry.song.title || '-');
        const album = this.safeCell(entry.song.album?.trim() || '-');
        const show = this.safeCell(entry.song.show || '-');
        const host = this.safeCell(entry.song.host || '-');
        const { statusLabel, confidenceText, spotifyText } = this.formatStatus(entry);
        const cells = [time, artist, title, album, show, host, statusLabel, confidenceText, spotifyText];
        return `| ${cells.join(' | ')} |`;
    }
    safeCell(input) {
        const s = (input || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').trim();
        return s.length > 0 ? s : '-';
    }
    pickTime(entry) {
        const played = (entry.song.playedTime || '').trim();
        if (played) {
            // normalize to HH:MM if possible
            const m = played.match(/^(\d{1,2}):(\d{2})/);
            if (m)
                return `${m[1].padStart(2, '0')}:${m[2]}`;
            return played;
        }
        const at = dayjs(entry.song.scrapedAt || entry.archivedAt);
        return at.isValid() ? at.format('HH:mm') : '-';
    }
    formatStatus(entry) {
        // Prefer explicit fields; fall back to match payload if provided.
        let confidence = entry.confidence;
        let spotifyUrl = entry.spotifyUrl;
        if ((confidence === undefined || spotifyUrl === undefined) && entry.match) {
            try {
                const any = entry.match;
                if (confidence === undefined && typeof any?.confidence === 'number')
                    confidence = any.confidence;
                const url = any?.track?.external_urls?.spotify;
                if (spotifyUrl === undefined && typeof url === 'string')
                    spotifyUrl = url;
            }
            catch {
                // ignore
            }
        }
        let statusLabel = '-';
        switch (entry.status) {
            case 'found':
                statusLabel = '✅ Found';
                break;
            case 'not_found':
                statusLabel = '❌ Not Found';
                break;
            case 'low_confidence':
                statusLabel = '⚠️ Low Confidence';
                break;
            default:
                statusLabel = '-';
        }
        const confidenceText = typeof confidence === 'number' ? `${confidence.toFixed(1)}%` : '-';
        // Don't escape markdown link; table cell escaping handled for other fields
        const spotifyText = spotifyUrl ? `[Open](${spotifyUrl})` : '-';
        return { statusLabel, confidenceText, spotifyText };
    }
}
