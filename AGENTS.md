# Repository Guide (Current Status)

## Structure
- Source: `src/` (TypeScript, NodeNext ESM)
  - `src/modules/` → features (`scrapers/`, `enrichers/`, `archivers/`)
  - `src/services/` → workflows (`WorkflowService`)
  - `src/utils/` → shared (`config.ts`, `logger.ts`, `matching.ts`, `date.ts`, `showGuesser.ts`)
  - `src/types/` → shared interfaces and types
- Build: `dist/` (compiled JS)
- Config: `config/config.yaml` (runtime settings)
- Templates: `templates/` (EJS for Markdown)

## Build & Run
- `npm run dev` — ts-node + nodemon
- `npm run build` — compile TS → `dist/`
- `npm start` — run `dist/index.js`
- Tip: `npm run build && npm start` to run latest code.

## Coding Conventions
- TS strict mode, NodeNext ESM.
- Always include `.js` in TS import specifiers.
- 2-space indent; named exports; focused functions.
- Use `Logger` for info/warn/error/debug.

## Modules (Implemented)
- Scraper: `WWOZScraper` (Playwright) parses playlist rows (robust selectors + cleanup).
- Enricher: `SpotifyEnricher` handles search, scoring, rate-limited API, playlist ops, cover upload.
- Archiver: `ObsidianArchiver` writes daily Markdown, dedups, keeps rows chronologically, updates stats.
- Workflow: `WorkflowService` orchestrates scrape → enrich → archive/playlist; snapshots and stats.

## CLI Entrypoint
- File: `src/index.ts` (Commander)
- Default: continuous (`npm start`) with interval `wwoz.scrapeIntervalSeconds`.
- Single run: `node dist/index.js --once`.
- Snapshots: `--snapshot YYYY-MM-DD` (build daily snapshot playlist from archive and exit).
- Backfill: `--backfill <days>` (create past N daily snapshots and exit).
  

## Types (Key)
- `ScrapedSong`: artist, title, album?, playedDate?, playedTime?, scrapedAt, show?, host?
- `ArchiveEntry`: { song, status: 'found'|'not_found'|'low_confidence'|'unknown', confidence?, spotifyUrl?, match?, archivedAt }
- `IArchiver.archive(entry): Promise<void>` (+ optional `finalizeDailyStats`, `wasArchived`, `getDailySpotifyTrackUris`)

## Archiver (Current)
- Template: `templates/daily-archive.md.ejs`
  - Frontmatter: date, station, source_url, tags
  - Header: “WWOZ Discoveries - <Weekday, Month D, YYYY>”
  - Table columns: Time | Artist | Title | Album | Show | Host | Status | Confidence | Spotify
- File path: `<baseRoot>/YYYY/MM/WWOZ Discoveries - <Weekday> YYYY-MM-DD.md`
  - Also recognizes legacy names: `YYYY-MM-DD - <Weekday>.md` and `YYYY-MM-DD.md`.
- Behavior:
  - Creates year/month dirs if missing; renders template on first write.
  - Routes to correct day using `song.playedDate` (avoids cross-day bleed).
  - In-file dedup (scan existing rows) + in-memory dedup within `archive.deduplicationWindowMinutes`.
  - Inserts rows in chronological order (by played time; otherwise timestamp fallback).
  - Escapes Markdown cells (pipes/newlines). Spotify cell = `[Open](url)`.
  - Computes/updates a “Daily Statistics” block inside the file (best-effort).
  - Exposes `getDailySpotifyTrackUris(date)` to build daily snapshot playlists.

## Workflow Notes
- Loads fresh Spotify playlist cache at start; refreshes before/after adds for accurate counts.
- Buffers playlist additions and applies them in chronological order (to match archive).
- Stops early after 5 consecutive Spotify duplicates (normal pause in continuous mode).
- Early archive-duplicate detection (does not count toward stop threshold).
- Skips adding to today’s playlist when a song is routed to another day; still archives it.
- End of run: updates today’s archive stats and ensures yesterday’s daily snapshot playlist.

## Security / Config
- Do not commit real secrets; prefer local YAML via `CONFIG_PATH`.
- Key config fields:
  - `wwoz.playlistUrl`, `wwoz.scrapeIntervalSeconds`
  - `archive.basePath`, `archive.deduplicationWindowMinutes`
  - `spotify.clientId`, `spotify.clientSecret`, `spotify.refreshToken`, `spotify.userId`, `spotify.staticPlaylistId`
  - `rateLimit.spotify.maxConcurrent`, `rateLimit.spotify.minTime`
  - `chromePath` (or install Playwright browsers)
- Env override: `SPOTIFY_STATIC_PLAYLIST_ID` supersedes `spotify.staticPlaylistId`.

## Next Steps (Planned)
- Optional: persist archive dedup keys across runs.
- Add richer CLI toggles (dry-run per action, target playlist override).
- Improve show/host mapping and low-confidence feedback loop.
