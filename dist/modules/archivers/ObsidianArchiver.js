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
        await fs.promises.appendFile(filePath, `\n${row}\n`, 'utf8');
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
        const { statusLabel, confidenceText, spotifyText } = this.formatStatus(entry);
        const scraped = this.safeCell(this.pickScraped(entry));
        const cells = [time, artist, title, album, statusLabel, confidenceText, spotifyText, scraped];
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
    pickScraped(entry) {
        const at = dayjs(entry.song.scrapedAt || entry.archivedAt);
        return at.isValid() ? at.format('HH:mm:ss') : '-';
    }
}
