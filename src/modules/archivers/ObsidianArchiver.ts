import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import dayjs from 'dayjs';
import { Logger } from '../../utils/logger.js';
import { config } from '../../utils/config.js';
import type { ArchiveEntry, IArchiver } from '../../types/index.js';

export class ObsidianArchiver implements IArchiver {
  private recentKeys: Map<string, number> = new Map(); // key -> lastWrittenEpochMs

  clearDedupCache(): void {
    this.recentKeys.clear();
  }

  async archive(entry: ArchiveEntry): Promise<void> {
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

  async finalizeDailyStats(date?: string): Promise<void> {
    try {
      const basePath = config.archive.basePath;
      if (!basePath || basePath.trim().length === 0) return;
      const day = date ? dayjs(date) : dayjs();
      if (!day.isValid()) return;

      const root = this.computeBaseRoot(basePath);
      const dir = path.join(root, day.format('YYYY'), day.format('MM'));
      const filePath = path.join(dir, `${day.format('YYYY-MM-DD')}.md`);
      if (!(await this.exists(filePath))) return;

      const original = await fs.promises.readFile(filePath, 'utf8');

      const stats = this.computeStatsFromMarkdown(original);
      const statsBlock = this.renderStatsBlock(stats);

      const updated = this.upsertStatsBlock(original, statsBlock);
      if (updated !== original) {
        await fs.promises.writeFile(filePath, updated, 'utf8');
        Logger.info(
          `Updated daily statistics for ${day.format('YYYY-MM-DD')} (total=${stats.total}, found=${stats.found}, notFound=${stats.notFound}, low=${stats.lowConfidence}, dups=${stats.duplicates}).`
        );
      }
    } catch (err) {
      Logger.error('Failed to finalize daily stats (non-fatal).', err);
    }
  }

  async wasArchived(entry: ArchiveEntry): Promise<boolean> {
    try {
      const basePath = config.archive.basePath;
      if (!basePath || basePath.trim().length === 0) return false;

      const fileDate = this.resolveDate(entry);
      const root = this.computeBaseRoot(basePath);
      const dir = path.join(root, fileDate.format('YYYY'), fileDate.format('MM'));
      const filePath = path.join(dir, `${fileDate.format('YYYY-MM-DD')}.md`);
      if (!(await this.exists(filePath))) return false;

      const content = await fs.promises.readFile(filePath, 'utf8');
      const keys = this.collectSongKeysFromMarkdown(content);
      Logger.debug(`Archive scan: ${filePath} has ${keys.size} track row(s).`);
      const key = this.buildSongKey(entry);
      return keys.has(key);
    } catch (err) {
      Logger.error('Failed to check archived status (non-fatal).', err);
      return false;
    }
  }

  private computeStatsFromMarkdown(content: string): {
    total: number;
    found: number;
    notFound: number;
    lowConfidence: number;
    duplicates: number;
  } {
    const lines = content.split(/\r?\n/);
    let inTracks = false;
    let headerSeen = false;
    let total = 0;
    let found = 0;
    let notFound = 0;
    let low = 0;
    const seenKeys = new Set<string>();
    let duplicateCount = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('## ')) {
        inTracks = line.toLowerCase().startsWith('## tracks');
        headerSeen = false;
        continue;
      }
      if (!inTracks) continue;
      if (line.startsWith('| :')) {
        // alignment row
        headerSeen = true;
        continue;
      }
      if (line.startsWith('|') && line.endsWith('|')) {
        // skip the header titles row
        if (!headerSeen) continue;
        const cells = line
          .split('|')
          .map((s) => s.trim())
          .slice(1, -1);
        if (cells.length < 7) continue;

        total++;

        const statusCell = cells[6] || '';
        const statusLower = statusCell.toLowerCase();
        if (statusLower.includes('not found')) notFound++;
        else if (statusLower.includes('low confidence')) low++;
        else if (statusLower.includes('found')) found++;

        // Duplicate detection by normalized artist+title
        const artist = (cells[1] || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const title = (cells[2] || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const key = `${artist}::${title}`;
        if (artist && title) {
          if (seenKeys.has(key)) duplicateCount++;
          else seenKeys.add(key);
        }
      }
    }

    return { total, found, notFound, lowConfidence: low, duplicates: duplicateCount };
  }

  private renderStatsBlock(stats: { total: number; found: number; notFound: number; lowConfidence: number; duplicates: number }): string {
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

  private upsertStatsBlock(content: string, statsBlock: string): string {
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

  private resolveDate(entry: ArchiveEntry): dayjs.Dayjs {
    const a = dayjs(entry.archivedAt);
    if (a.isValid()) return a;
    const s = dayjs(entry.song.scrapedAt);
    if (s.isValid()) return s;
    return dayjs();
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(p, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async loadTemplate(): Promise<string> {
    const templatePath = path.resolve(process.cwd(), 'templates', 'daily-archive.md.ejs');
    return fs.promises.readFile(templatePath, 'utf8');
  }

  private computeBaseRoot(input: string): string {
    const norm = path.resolve(input);
    const parts = norm.split(path.sep).filter(Boolean);
    if (parts.length === 0) return norm;
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    const isYear = (s?: string) => !!s && /^\d{4}$/.test(s);
    const isMonth = (s?: string) => !!s && /^(0[1-9]|1[0-2])$/.test(s);

    if (isYear(prev) && isMonth(last)) {
      return path.sep + parts.slice(0, -2).join(path.sep);
    }
    if (isYear(last)) {
      return path.sep + parts.slice(0, -1).join(path.sep);
    }
    return norm;
  }

  private normalize(s: string): string {
    return s
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildSongKey(entry: ArchiveEntry): string {
    const artist = this.normalize(entry.song.artist || '');
    const title = this.normalize(entry.song.title || '');
    return `${artist}::${title}`;
  }

  private isRecentDuplicate(entry: ArchiveEntry): boolean {
    const windowMinutes = config.archive.deduplicationWindowMinutes ?? 0;
    if (windowMinutes <= 0) return false;
    const key = this.buildSongKey(entry);
    const now = Date.now();
    const last = this.recentKeys.get(key) || 0;
    const isDup = now - last <= windowMinutes * 60 * 1000;
    if (!isDup) this.recentKeys.set(key, now);
    return isDup;
  }

  private formatRow(entry: ArchiveEntry): string {
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

  private safeCell(input: string): string {
    const s = (input || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').trim();
    return s.length > 0 ? s : '-';
  }

  private pickTime(entry: ArchiveEntry): string {
    const playedRaw = (entry.song.playedTime || '').trim();
    if (playedRaw) {
      // Handle common forms: "h:mm AM/PM", "h:mmam", "h:mm a.m.", and 24h "HH:mm"
      const s = playedRaw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
      const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
      if (ampmMatch) {
        let hh = parseInt(ampmMatch[1], 10);
        const mm = ampmMatch[2];
        const mer = ampmMatch[3].toLowerCase();
        if (mer === 'am') {
          if (hh === 12) hh = 0;
        } else if (mer === 'pm') {
          if (hh !== 12) hh += 12;
        }
        return `${String(hh).padStart(2, '0')}:${mm}`;
      }
      const twentyFour = s.match(/^(\d{1,2}):(\d{2})$/);
      if (twentyFour) return `${twentyFour[1].padStart(2, '0')}:${twentyFour[2]}`;
      // Fallback: return original if unrecognized
      return playedRaw;
    }
    const at = dayjs(entry.song.scrapedAt || entry.archivedAt);
    return at.isValid() ? at.format('HH:mm') : '-';
  }

  private formatStatus(entry: ArchiveEntry): { statusLabel: string; confidenceText: string; spotifyText: string } {
    // Prefer explicit fields; fall back to match payload if provided.
    let confidence = entry.confidence;
    let spotifyUrl = entry.spotifyUrl;
    if ((confidence === undefined || spotifyUrl === undefined) && entry.match) {
      try {
        const any = entry.match as any;
        if (confidence === undefined && typeof any?.confidence === 'number') confidence = any.confidence;
        const url = any?.track?.external_urls?.spotify;
        if (spotifyUrl === undefined && typeof url === 'string') spotifyUrl = url;
      } catch {
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

  // Removed scraped column in favor of Show/Host columns

  private collectSongKeysFromMarkdown(content: string): Set<string> {
    const lines = content.split(/\r?\n/);
    let inTracks = false;
    let headerSeen = false;
    const keys = new Set<string>();
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('## ')) {
        inTracks = line.toLowerCase().startsWith('## tracks');
        headerSeen = false;
        continue;
      }
      if (!inTracks) continue;
      if (line.startsWith('| :')) { headerSeen = true; continue; }
      if (line.startsWith('|') && line.endsWith('|')) {
        if (!headerSeen) continue; // skip titles row
        const cells = line
          .split('|')
          .map((s) => s.trim())
          .slice(1, -1);
        if (cells.length < 3) continue;
        const artist = this.normalize(cells[1] || '');
        const title = this.normalize(cells[2] || '');
        if (!artist && !title) continue;
        keys.add(`${artist}::${title}`);
      }
    }
    return keys;
  }
}
