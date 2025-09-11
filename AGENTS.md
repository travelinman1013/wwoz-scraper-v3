# Repository Guide (Current Status)

## Structure
- Source: `src/` (TypeScript, NodeNext ESM)
  - `src/modules/` → features (`scrapers/`, `enrichers/`, `archivers/`)
  - `src/utils/` → shared (`config.ts`, `logger.ts`, `matching.ts`)
  - `src/types/` → shared interfaces and types
- Build: `dist/` (compiled JS)
- Config: `config/config.yaml` (runtime settings)
- Templates: `templates/` (EJS for Markdown)

## Build & Run
- `npm run dev` — ts-node + nodemon
- `npm run build` — compile TS → `dist/`
- `npm start` — run `dist/index.js`

Tip: `npm run build && npm start` to run latest code.

## Coding Conventions
- TS strict mode, NodeNext ESM.
- Always include `.js` in TS import specifiers.
- 2-space indent; named exports; keep functions focused.
- Use `Logger` for info/warn/error/debug.

## Modules (What’s Implemented)
- Scraper: `WWOZScraper` (Playwright) parses playlist rows.
- Enricher: `SpotifyEnricher` handles search, scoring, playlist ops.
- Archiver: simplified `ObsidianArchiver` (Markdown appender).

## Archiver (Simplified, Current Focus)
- Template: `templates/daily-archive.md.ejs`
  - Frontmatter: date, station, source_url, tags
  - Header: “WWOZ Discoveries - <day>”
  - Table columns: Time | Artist | Title | Album | Status | Confidence | Spotify | Scraped
- Types:
  - `ArchiveEntry` { song, status: 'found'|'not_found'|'low_confidence'|'unknown', confidence?, spotifyUrl?, match?, archivedAt }
  - `IArchiver.archive(entry): Promise<void>`
- File path: `<baseRoot>/YYYY/MM/YYYY-MM-DD.md`
  - `archive.basePath` may be the vault root, or include `/YYYY` or `/YYYY/MM` — these trailing segments are stripped so folders roll over automatically.
- Behavior:
  - Creates year/month dirs if missing.
  - If daily file doesn’t exist, renders template; otherwise appends a single table row.
  - Time column = `song.playedTime` (HH:MM) if present, else from `scrapedAt`.
  - Scraped column = `scrapedAt` (HH:mm:ss) or `archivedAt` fallback.
  - In-memory dedup within `archive.deduplicationWindowMinutes` for rapid repeats.
  - No reading or updating of in-file statistics.

## Entry Point (Temporary Testing)
- `src/index.ts` appends a sample row via `ObsidianArchiver`.
- Adjust `archive.basePath` to a safe local path for testing.

## Next Steps (Planned)
- Wire pipeline: scrape → enrich → archive/playlist.
- Add CLI flags for run modes; schedule by `wwoz.scrapeIntervalSeconds`.
- Optional: persist dedup keys across runs.

## Security / Config
- Do not commit real secrets; prefer local YAML via `CONFIG_PATH`.
- Key config fields:
  - `wwoz.playlistUrl`
  - `archive.basePath`
  - `archive.deduplicationWindowMinutes`
  - `chromePath` (or install Playwright browsers)
