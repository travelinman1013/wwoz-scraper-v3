import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { Logger } from '../../utils/logger.js';
import { config } from '../../utils/config.js';
function sanitizeText(input) {
    if (!input)
        return '';
    // Normalize whitespace and trim common punctuation artifacts
    const cleaned = input
        .replace(/\s+/g, ' ') // collapse whitespace
        .replace(/[\u2018\u2019]/g, "'") // smart single quotes
        .replace(/[\u201C\u201D]/g, '"') // smart double quotes
        .replace(/^[-–—\s]+|[-–—\s]+$/g, '') // leading/trailing dashes
        .trim();
    return cleaned;
}
export class WWOZScraper {
    async scrape() {
        Logger.info('Launching browser...');
        let browser = null;
        const executablePath = this.resolveExecutablePath(config.chromePath ?? undefined);
        try {
            browser = await chromium.launch({ headless: true, executablePath });
            Logger.info('Browser launched. Opening new page...');
            const context = await browser.newContext();
            const page = await context.newPage();
            Logger.info('Navigating to page...');
            await page.goto(config.wwoz.playlistUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            // Ensure XHR-driven content loads
            await page.waitForLoadState('networkidle', { timeout: 30000 });
            const rowSelectors = [
                '.playlists table.table-striped.table-condensed tbody tr',
                'table.table-striped.table-condensed tbody tr',
                'table.table-condensed tbody tr',
                '.views-table tbody tr',
                'table.table-striped tbody tr',
                'table tbody tr',
            ];
            let activeSelector = null;
            for (const sel of rowSelectors) {
                try {
                    await page.waitForSelector(sel, { state: 'visible', timeout: 7000 });
                    activeSelector = sel;
                    break;
                }
                catch {
                    // try next
                }
            }
            if (!activeSelector) {
                // final broad attempt; will throw if not found
                activeSelector = 'table tbody tr';
                await page.waitForSelector(activeSelector, { state: 'visible', timeout: 15000 });
            }
            Logger.info('Extracting rows from playlist table...');
            const rawRows = await page.$$eval(activeSelector, (rows) => {
                // Map rows to structured data using explicit data-bind attributes when present.
                return rows.map((row) => {
                    const get = (sel) => (row.querySelector(sel)?.textContent || '').trim();
                    let artist = get('td[data-bind="artist"]');
                    let title = get('td[data-bind="title"]');
                    let album = get('td[data-bind="album"]');
                    let date = get('td[data-bind="date"]');
                    let time = get('td[data-bind="time"]');
                    if (!artist && !title) {
                        // Fallback to positional cells if data-bind attrs not present
                        const cells = Array.from(row.querySelectorAll('td'));
                        const texts = cells.map((c) => c.textContent?.trim() || '');
                        if (texts.length >= 5) {
                            // [Artist, Title, Album, Date, Time]
                            [artist, title, album, date, time] = texts;
                        }
                        else if (texts.length >= 3) {
                            [artist, title, album] = texts;
                        }
                        else if (texts.length === 2) {
                            [artist, title] = texts;
                        }
                        else if (texts.length >= 1) {
                            title = texts[0];
                        }
                    }
                    return { artist, title, album, date, time };
                });
            });
            const nowIso = new Date().toISOString();
            const songs = rawRows
                .map((r) => ({
                artist: sanitizeText(r.artist),
                title: sanitizeText(r.title),
                album: sanitizeText(r.album) || undefined,
                playedDate: sanitizeText(r.date) || undefined,
                playedTime: sanitizeText(r.time) || undefined,
                scrapedAt: nowIso,
            }))
                // Filter out invalid/empty entries where artist and title are missing
                .filter((s) => s.artist.length > 0 || s.title.length > 0);
            Logger.info(`Successfully scraped ${songs.length} songs.`);
            return songs;
        }
        catch (err) {
            Logger.error('Scraping failed.', err);
            throw err;
        }
        finally {
            if (browser) {
                Logger.info('Closing browser...');
                await browser.close();
            }
        }
    }
    resolveExecutablePath(input) {
        if (!input)
            return undefined;
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
                    if (fs.existsSync(candidate))
                        return candidate;
                }
                catch {
                    // ignore and continue
                }
            }
            // Fallback to the provided path; Playwright may still handle it or error clearly.
            return input;
        }
        return input;
    }
}
