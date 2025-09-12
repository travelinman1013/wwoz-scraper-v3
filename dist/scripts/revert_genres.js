import fs from 'fs';
import path from 'path';
import { Logger } from '../utils/logger.js';
async function main() {
    try {
        const args = process.argv.slice(2);
        const files = args.filter((a) => !a.startsWith('--')).map((f) => path.resolve(f));
        if (files.length === 0) {
            Logger.warn('Usage: node dist/scripts/revert_genres.js <file1.md> [file2.md ...]');
            process.exit(1);
            return;
        }
        for (const file of files) {
            await revertFile(file);
        }
    }
    catch (err) {
        Logger.error('Revert genres script failed.', err);
        process.exitCode = 1;
    }
}
async function revertFile(filePath) {
    if (!(await exists(filePath))) {
        Logger.warn(`File does not exist: ${filePath}`);
        return;
    }
    const original = await fs.promises.readFile(filePath, 'utf8');
    const updated = removeGenresColumn(original);
    if (updated !== original) {
        await fs.promises.writeFile(filePath, updated, 'utf8');
        Logger.info(`Reverted Genres column in ${filePath}.`);
    }
    else {
        Logger.info(`No Genres column found or no changes needed for ${filePath}.`);
    }
}
function removeGenresColumn(content) {
    const lines = content.split(/\r?\n/);
    // Find Tracks section
    let tracksStart = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim().toLowerCase();
        if (line.startsWith('## tracks')) {
            tracksStart = i;
            break;
        }
    }
    if (tracksStart === -1)
        return content;
    // Find header and alignment rows
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
    if (headerLine === -1 || alignLine === -1)
        return content;
    const titles = splitCells(lines[headerLine]);
    const genresIdx = titles.findIndex((c) => c.toLowerCase() === 'genres');
    if (genresIdx === -1)
        return content; // nothing to remove
    // Remove from header
    titles.splice(genresIdx, 1);
    lines[headerLine] = `| ${titles.join(' | ')} |`;
    // Remove from alignment
    const aligns = splitCells(lines[alignLine]);
    if (genresIdx < aligns.length) {
        aligns.splice(genresIdx, 1);
        lines[alignLine] = `| ${aligns.join(' | ')} |`;
    }
    // Remove from data rows
    for (let i = alignLine + 1; i < lines.length; i++) {
        const raw = lines[i];
        const t = raw.trim();
        if (!(t.startsWith('|') && t.endsWith('|')))
            break; // end of table
        const cells = splitCells(raw);
        if (genresIdx < cells.length) {
            cells.splice(genresIdx, 1);
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
async function exists(p) {
    try {
        await fs.promises.access(p, fs.constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
main();
