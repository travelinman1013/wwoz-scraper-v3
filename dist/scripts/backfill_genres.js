import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import SpotifyWebApi from 'spotify-web-api-node';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
async function main() {
    try {
        const spotify = new SpotifyWebApi({
            clientId: config.spotify.clientId,
            clientSecret: config.spotify.clientSecret,
        });
        spotify.setRefreshToken(config.spotify.refreshToken);
        await refreshToken(spotify);
        const args = process.argv.slice(2);
        const filesFlagIdx = args.indexOf('--files');
        if (filesFlagIdx !== -1) {
            const fileArgs = args.slice(filesFlagIdx + 1).filter((a) => !a.startsWith('--'));
            if (fileArgs.length === 0) {
                Logger.warn('No files specified after --files; nothing to do.');
                return;
            }
            for (const f of fileArgs) {
                await backfillForFile(spotify, path.resolve(f));
            }
        }
        else {
            const today = dayjs();
            const yesterday = today.subtract(1, 'day');
            const targets = [yesterday, today];
            for (const d of targets) {
                await backfillForDate(spotify, d);
            }
        }
    }
    catch (err) {
        Logger.error('Backfill genres script failed.', err);
        process.exitCode = 1;
    }
}
async function refreshToken(spotify) {
    const data = await spotify.refreshAccessToken();
    spotify.setAccessToken(data.body.access_token);
}
async function backfillForDate(spotify, day) {
    const basePath = config.archive.basePath;
    if (!basePath || basePath.trim().length === 0) {
        throw new Error('archive.basePath is not configured.');
    }
    const { filePath } = await getDailyFilePath(computeBaseRoot(basePath), day);
    if (!(await exists(filePath))) {
        Logger.warn(`No archive file for ${day.format('YYYY-MM-DD')} at ${filePath}. Skipping.`);
        return;
    }
    Logger.info(`Backfilling genres for ${day.format('YYYY-MM-DD')} → ${filePath}`);
    const original = await fs.promises.readFile(filePath, 'utf8');
    const updated = await updateFileContents(spotify, original);
    if (updated !== original) {
        await fs.promises.writeFile(filePath, updated, 'utf8');
        Logger.info(`Updated genres for ${day.format('YYYY-MM-DD')}.`);
    }
    else {
        Logger.info(`No changes needed for ${day.format('YYYY-MM-DD')}.`);
    }
}
async function backfillForFile(spotify, filePath) {
    if (!(await exists(filePath))) {
        Logger.warn(`File does not exist: ${filePath}`);
        return;
    }
    Logger.info(`Backfilling genres for file: ${filePath}`);
    const original = await fs.promises.readFile(filePath, 'utf8');
    const updated = await updateFileContents(spotify, original);
    if (updated !== original) {
        await fs.promises.writeFile(filePath, updated, 'utf8');
        Logger.info(`Updated genres in ${filePath}.`);
    }
    else {
        Logger.info(`No changes needed for ${filePath}.`);
    }
}
async function updateFileContents(spotify, original) {
    const lines = original.split(/\r?\n/);
    // Find Tracks section and header rows
    let tracksStart = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.toLowerCase().startsWith('## tracks')) {
            tracksStart = i;
            break;
        }
    }
    if (tracksStart === -1) {
        Logger.warn('No Tracks section found; skipping.');
        return original;
    }
    let headerLine = -1;
    let alignLine = -1;
    for (let i = tracksStart + 1; i < Math.min(lines.length, tracksStart + 10); i++) {
        const t = lines[i].trim();
        if (t.startsWith('| Time '))
            headerLine = i;
        else if (t.startsWith('| :')) {
            alignLine = i;
            break;
        }
    }
    if (alignLine === -1) {
        Logger.warn('Malformed Tracks table; skipping.');
        return original;
    }
    // Ensure Genres column exists after Album
    const titles = splitCells(lines[headerLine]);
    let genresIdx = titles.findIndex((c) => c.toLowerCase() === 'genres');
    if (genresIdx === -1) {
        const albumIdx = titles.findIndex((c) => c.toLowerCase() === 'album');
        if (albumIdx !== -1) {
            titles.splice(albumIdx + 1, 0, 'Genres');
            lines[headerLine] = `| ${titles.join(' | ')} |`;
            const aligns = splitCells(lines[alignLine]);
            aligns.splice(albumIdx + 1, 0, ':---');
            lines[alignLine] = `| ${aligns.join(' | ')} |`;
            genresIdx = albumIdx + 1;
        }
    }
    else {
        // already present
    }
    if (genresIdx === -1) {
        Logger.warn('Could not determine Genres column index; skipping.');
        return original;
    }
    // Map important column indices
    const colIndex = (name) => titles.findIndex((c) => c.toLowerCase() === name.toLowerCase());
    const artistIdx = colIndex('artist');
    const titleIdx = colIndex('title');
    const spotifyIdx = titles.length - 1; // last column is Spotify
    if (artistIdx === -1 || titleIdx === -1) {
        Logger.warn('Missing Artist or Title columns; skipping.');
        return original;
    }
    // Process data rows and update Genres cell
    for (let i = alignLine + 1; i < lines.length; i++) {
        const raw = lines[i];
        const t = raw.trim();
        if (!(t.startsWith('|') && t.endsWith('|')))
            break; // end of table
        // Skip header titles row if encountered
        if (i === headerLine)
            continue;
        const cells = splitCells(raw);
        if (cells.length < Math.max(artistIdx, titleIdx, spotifyIdx) + 1)
            continue;
        const artist = cells[artistIdx]?.trim() || '';
        const title = cells[titleIdx]?.trim() || '';
        if (!artist && !title)
            continue;
        // If we already have non-empty Genres cell, skip
        const currentGenres = (cells[genresIdx] || '').trim();
        if (currentGenres && currentGenres !== '-')
            continue;
        // Try to read Spotify track ID from Spotify cell
        const spCell = cells[spotifyIdx] || '';
        const idFromLink = extractTrackIdFromSpotifyCell(spCell);
        let genres = [];
        try {
            if (idFromLink) {
                const track = await spotify.getTrack(idFromLink);
                const artistIds = (track.body.artists || []).map((a) => a.id).filter(Boolean);
                if (artistIds.length > 0) {
                    const g = await fetchArtistGenres(spotify, artistIds);
                    genres = g;
                }
            }
            else {
                // Fallback: try search by artist/title
                const q = buildSearchQuery(artist, title);
                const data = await spotify.searchTracks(q, { limit: 5, market: 'US' });
                const items = data.body.tracks?.items ?? [];
                const best = items[0];
                if (best) {
                    const artistIds = (best.artists || []).map((a) => a.id).filter(Boolean);
                    if (artistIds.length > 0)
                        genres = await fetchArtistGenres(spotify, artistIds);
                }
            }
        }
        catch (err) {
            Logger.warn(`Failed to fetch genres for ${artist} - ${title} (non-fatal).`);
        }
        if (genres.length > 0) {
            cells[genresIdx] = genres.slice(0, 3).join(', ');
            lines[i] = `| ${cells.join(' | ')} |`;
        }
    }
    return lines.join('\n');
}
function splitCells(rowLine) {
    return rowLine
        .split('|')
        .map((s) => s.trim())
        .filter((s, idx, arr) => !(idx === 0 && s === '') && !(idx === arr.length - 1 && s === ''));
}
function extractTrackIdFromSpotifyCell(cell) {
    const m = cell.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
    return m?.[1] || null;
}
async function fetchArtistGenres(spotify, artistIds) {
    const unique = Array.from(new Set(artistIds)).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < unique.length; i += 50)
        chunks.push(unique.slice(i, i + 50));
    const all = new Set();
    for (const chunk of chunks) {
        const res = await spotify.getArtists(chunk);
        for (const a of res.body.artists || []) {
            (a.genres || []).forEach((g) => all.add(g));
        }
    }
    return Array.from(all);
}
function computeBaseRoot(input) {
    const norm = path.resolve(input);
    const parts = norm.split(path.sep).filter(Boolean);
    if (parts.length === 0)
        return norm;
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    const isYear = (s) => !!s && /^\d{4}$/.test(s);
    const isMonth = (s) => !!s && /^(0[1-9]|1[0-2])$/.test(s);
    if (isYear(prev) && isMonth(last))
        return path.sep + parts.slice(0, -2).join(path.sep);
    if (isYear(last))
        return path.sep + parts.slice(0, -1).join(path.sep);
    return norm;
}
async function getDailyFilePath(root, day) {
    const dir = path.join(root, day.format('YYYY'), day.format('MM'));
    const base = day.format('YYYY-MM-DD');
    const dow = day.format('dddd');
    const friendly = `WWOZ Discoveries - ${dow} ${base}.md`;
    const preferred = path.join(dir, friendly);
    const prevPreferred = path.join(dir, `${base} - ${dow}.md`);
    const legacy = path.join(dir, `${base}.md`);
    try {
        if (await exists(preferred))
            return { dir, filePath: preferred };
        if (await exists(prevPreferred))
            return { dir, filePath: prevPreferred };
        if (await exists(legacy))
            return { dir, filePath: legacy };
    }
    catch { }
    return { dir, filePath: preferred };
}
async function exists(p) {
    try {
        await fs.promises.access(p, fs.constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
function buildSearchQuery(artist, title) {
    const escape = (s) => s.replace(/[\\"\:\(\)\[\]\{\}\!\^\~\*\?\\]/g, ' ');
    const parts = [];
    if (title && title.trim())
        parts.push(`track:${escape(title.trim())}`);
    if (artist && artist.trim())
        parts.push(`artist:${escape(artist.trim())}`);
    return parts.join(' ');
}
// Run
main();
