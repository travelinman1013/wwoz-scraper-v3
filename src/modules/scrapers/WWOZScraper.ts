import { chromium, Browser } from 'playwright';
import fs from 'fs';
import path from 'path';
import { Logger } from '../../utils/logger.js';
import { config } from '../../utils/config.js';
import type { IScraper, ScrapedSong } from '../../types/index.js';

function sanitizeText(input: string | undefined | null): string {
  if (!input) return '';
  // Normalize whitespace and trim common punctuation artifacts
  const cleaned = input
    .replace(/\s+/g, ' ') // collapse whitespace
    .replace(/[\u2018\u2019]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D]/g, '"') // smart double quotes
    .replace(/^[-–—\s]+|[-–—\s]+$/g, '') // leading/trailing dashes
    .trim();
  return cleaned;
}

export class WWOZScraper implements IScraper {
  async scrape(): Promise<ScrapedSong[]> {
    Logger.info('Launching browser...');

    let browser: Browser | null = null;
    const executablePath = this.resolveExecutablePath(config.chromePath ?? undefined);

    try {
      browser = await chromium.launch({ headless: true, executablePath });
      Logger.info('Browser launched. Opening new page...');

      const context = await browser.newContext();
      const page = await context.newPage();

      Logger.info('Navigating to page...');
      await page.goto(config.wwoz.playlistUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Avoid relying on 'networkidle' — WWOZ page can long-poll. We'll wait for table rows instead.
      // If 'networkidle' ever becomes reliable again, we can reinstate it as a soft wait.

      const rowSelectors = [
        '.playlists table.table-striped.table-condensed tbody tr',
        'table.table-striped.table-condensed tbody tr',
        'table.table-condensed tbody tr',
        '.views-table tbody tr',
        'table.table-striped tbody tr',
        'table tbody tr',
      ];
      let activeSelector: string | null = null;
      for (const sel of rowSelectors) {
        try {
          await page.waitForSelector(sel, { state: 'visible', timeout: 7000 });
          activeSelector = sel;
          break;
        } catch {
          // try next
        }
      }
      if (!activeSelector) {
        // final broad attempt; will throw if not found
        activeSelector = 'table tbody tr';
        await page.waitForSelector(activeSelector, { state: 'visible', timeout: 15000 });
      }

      // Wait until at least one row appears to contain a plausible time and some content
      try {
        await page.waitForFunction(
          (sel: string) => {
            const rows = Array.from(document.querySelectorAll(sel));
            const timeRe = /^\d{1,2}:\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?$/;
            return rows.some((row) => {
              const texts = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'))
                .map((c) => (c.textContent || '').trim())
                .filter(Boolean);
              const hasTime = texts.some((t) => timeRe.test(t));
              const hasContent = texts.some((t) => t !== '-' && t.length > 1);
              return hasTime && hasContent;
            });
          },
          activeSelector,
          { timeout: 30000 }
        );
      } catch {
        // continue; extraction below will fall back to retry/reload
      }

      Logger.info('Extracting rows from playlist table...');

      let rawRows = await page.$$eval(activeSelector, (rows) => {
        // Map rows to structured data using explicit data-bind attributes when present.
        return rows.map((row) => {
          const get = (sel: string) => (row.querySelector<HTMLTableCellElement>(sel)?.textContent || '').trim();
          let artist = get('td[data-bind="artist"]');
          let title = get('td[data-bind="title"]');
          let album = get('td[data-bind="album"]');
          let date = get('td[data-bind="date"]');
          let time = get('td[data-bind="time"]');

          if (!artist && !title) {
            // Fallback heuristics when explicit bindings are missing.
            const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'));
            const texts = cells.map((c) => (c.textContent || '').trim());
            const timeRe = /^\d{1,2}:\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?$/; // matches 3:05 PM, 3:05pm, 15:05

            // Common table layout: [Time, Artist, Title, Album]
            if (texts.length >= 4 && timeRe.test(texts[0])) {
              time = texts[0];
              artist = texts[1] || '';
              title = texts[2] || '';
              album = texts[3] || '';
            } else {
              // Generic mapping with time detection anywhere in the row
              const timeIdx = texts.findIndex((t) => timeRe.test(t));
              if (timeIdx >= 0) time = texts[timeIdx];
              const nonTime = texts.filter((_, i) => i !== timeIdx).filter((t) => t && t !== '-');
              if (nonTime.length >= 3) {
                // Assume [Artist, Title, Album]
                artist = nonTime[0];
                title = nonTime[1];
                album = nonTime[2];
              } else if (nonTime.length === 2) {
                [artist, title] = nonTime;
              } else if (nonTime.length === 1) {
                title = nonTime[0];
              }
              // Try to capture date if last cell looks like a date (MM/DD or MM/DD/YYYY)
              const dateRe = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;
              const dateIdx = texts.findIndex((t) => dateRe.test(t));
              if (dateIdx >= 0) date = texts[dateIdx];
            }
          }

          return { artist, title, album, date, time };
        });
      });

      // If no rows were captured (site slow or dynamic), try one light reload once.
      if (!rawRows || rawRows.length === 0) {
        try {
          Logger.warn('No rows detected; retrying once after reload...');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForSelector(activeSelector, { state: 'visible', timeout: 15000 });
          try {
            await page.waitForFunction(
              (sel: string) => {
                const rows = Array.from(document.querySelectorAll(sel));
                const timeRe = /^\d{1,2}:\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?$/;
                return rows.some((row) => {
                  const texts = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'))
                    .map((c) => (c.textContent || '').trim())
                    .filter(Boolean);
                  const hasTime = texts.some((t) => timeRe.test(t));
                  const hasContent = texts.some((t) => t !== '-' && t.length > 1);
                  return hasTime && hasContent;
                });
              },
              activeSelector,
              { timeout: 20000 }
            );
          } catch {
            // ignore; proceed to evaluate
          }
          rawRows = await page.$$eval(activeSelector, (rows) => {
            return rows.map((row) => {
              const get = (sel: string) => (row.querySelector<HTMLTableCellElement>(sel)?.textContent || '').trim();
              return {
                artist: get('td[data-bind="artist"]'),
                title: get('td[data-bind="title"]'),
                album: get('td[data-bind="album"]'),
                date: get('td[data-bind="date"]'),
                time: get('td[data-bind="time"]'),
              } as any;
            });
          });
        } catch {
          // proceed; will result in empty songs and handled by caller
        }
      }

      const nowIso = new Date().toISOString();

      const songs: ScrapedSong[] = rawRows
        .map((r) => ({
          artist: sanitizeText(r.artist),
          title: sanitizeText(r.title),
          album: sanitizeText(r.album) || undefined,
          playedDate: sanitizeText((r as any).date) || undefined,
          playedTime: sanitizeText((r as any).time) || undefined,
          scrapedAt: nowIso,
        }))
        // Filter out invalid/empty entries where artist and title are missing
        .filter((s) => s.artist.length > 0 || s.title.length > 0);

      Logger.info(`Successfully scraped ${songs.length} songs.`);
      return songs;
    } catch (err) {
      Logger.error('Scraping failed.', err);
      throw err;
    } finally {
      if (browser) {
        Logger.info('Closing browser...');
        await browser.close();
      }
    }
  }

  private resolveExecutablePath(input: string | undefined): string | undefined {
    if (!input) return undefined;
    // If user passed a macOS .app bundle, attempt to resolve the actual binary inside.
    if (process.platform === 'darwin' && /\.app\/?$/i.test(input)) {
      const candidates = [
        'Arc',
        'ARC',
        'Google Chrome',
        'Chromium',
        'Brave Browser',
        'Microsoft Edge',
      ].map((bin) => path.join(input, 'Contents', 'MacOS', bin));

      for (const candidate of candidates) {
        try {
          if (fs.existsSync(candidate)) return candidate;
        } catch {
          // ignore and continue
        }
      }
      // Fallback to the provided path; Playwright may still handle it or error clearly.
      return input;
    }
    return input;
  }
}
