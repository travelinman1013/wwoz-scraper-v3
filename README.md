# WWOZ Scraper v3

A TypeScript (NodeNext ESM) tool that scrapes the WWOZ playlist, enriches results with Spotify, and archives discoveries into an Obsidian‑friendly Markdown daily note. It supports continuous operation, on‑demand runs, and daily snapshot playlist generation.

## Features

- Robust Playwright scraper for WWOZ playlist table (resilient selectors + cleanup)
- Spotify enrichment with search, scoring, rate‑limited API, playlist ops, and cover upload
- Duplicate detection against Spotify playlist and Obsidian archive
- Obsidian Markdown archiver with in‑file dedup and “Daily Statistics” block
- Chronological row insertion (by played time; timestamp fallback)
- Continuous mode with safe early‑stop after consecutive Spotify duplicates
- Daily snapshot Spotify playlist generation from the archive
- On‑demand CLI for single run, snapshots, and backfill

## Repository Structure

- `src/` TypeScript source (ESM, NodeNext)
  - `modules/` feature modules
    - `scrapers/` → `WWOZScraper`
    - `enrichers/` → `SpotifyEnricher`
    - `archivers/` → `ObsidianArchiver`
  - `services/`
    - `WorkflowService` orchestrates scrape → enrich → archive/playlist
  - `utils/` shared utilities (`config.ts`, `logger.ts`, `matching.ts`, `date.ts`, `showGuesser.ts`)
  - `types/` shared interfaces
- `templates/` EJS templates for Markdown (daily archive)
- `config/` default `config.yaml`
- `dist/` compiled JavaScript

## Requirements

- Node 18+
- Playwright (Chromium) available via installed browsers or a `chromePath`
- Spotify API credentials (client id/secret, refresh token, user id)

## Setup

1) Install dependencies

- `npm install`

2) Configure settings

- Copy or edit `config/config.yaml` (use `CONFIG_PATH` env var to point to your local copy)
- Key fields:
  - `wwoz.playlistUrl`, `wwoz.scrapeIntervalSeconds`
  - `archive.basePath`, `archive.deduplicationWindowMinutes`
  - `spotify.userId`, `spotify.clientId`, `spotify.clientSecret`, `spotify.refreshToken`
  - `spotify.staticPlaylistId` (optional; if set, adds to this playlist)
  - `rateLimit.spotify.{maxConcurrent,minTime}`
  - `chromePath` (optional; browser path if Playwright browsers not installed)

3) Env overrides (optional)

- `CONFIG_PATH` → path to yaml config
- `SPOTIFY_STATIC_PLAYLIST_ID` → overrides `spotify.staticPlaylistId`

## Build & Run

- Dev (ts-node + nodemon): `npm run dev`
- Build: `npm run build`
- Start (continuous, interval = `wwoz.scrapeIntervalSeconds`): `npm start`
- Tip: run latest compiled code: `npm run build && npm start`
- Single run: `node dist/index.js --once`

### CLI commands

- Daily snapshot from archive: `node dist/index.js --snapshot YYYY-MM-DD`
- Backfill last N days: `node dist/index.js --backfill 7`
 

## How It Works

- `WorkflowService`
  - Scrapes playlist rows with `WWOZScraper` (Playwright)
  - Sorts oldest → newest and enriches via `SpotifyEnricher`
  - Loads a fresh Spotify playlist cache at start; refreshes before/after adds
  - Buffers playlist additions and applies them in chronological order
  - Archives each outcome to Markdown via `ObsidianArchiver`
  - Updates the daily “Daily Statistics” section
  - Ensures yesterday’s daily snapshot playlist exists and is up to date

- Continuous mode
  - Repeats on interval `wwoz.scrapeIntervalSeconds`
  - Stops early after 5 consecutive Spotify duplicates
  - Early archive‑duplicate detection (does not count toward stop threshold)
  - Skips adding to today’s playlist when a song routes to another day (still archived)

## Archiving Details

- File path: `<baseRoot>/YYYY/MM/WWOZ Discoveries - <Weekday> YYYY-MM-DD.md`
  - Also recognizes legacy names: `YYYY-MM-DD - <Weekday>.md` and `YYYY-MM-DD.md`
- Template: `templates/daily-archive.md.ejs`
  - Frontmatter: date, station, source_url, tags
  - Header: “WWOZ Discoveries - <Weekday, Month D, YYYY>”
  - Table columns: `Time | Artist | Title | Album | Show | Host | Status | Confidence | Spotify`
- Behavior
  - Creates year/month dirs if missing; renders template on first write
  - Routes rows to the correct file based on `song.playedDate`
  - In‑file dedup (scan existing rows) and in‑memory dedup within `archive.deduplicationWindowMinutes`
  - Inserts rows in chronological order (by played time; otherwise timestamp fallback)
  - Escapes Markdown cells (pipes/newlines). Spotify cell = `[Open](url)`
  - Computes/updates an in‑file “Daily Statistics” block
  - Exposes `getDailySpotifyTrackUris(date)` to build snapshot playlists

## Spotify Details

- `SpotifyEnricher`
  - Manages token refresh and rate limits via Bottleneck
  - Loads and refreshes playlist cache to detect duplicates accurately
  - Buffers and applies additions in chronological order
  - Adds tracks by URI; cache updated optimistically
- Static vs daily playlists
  - If `spotify.staticPlaylistId` is set (or `SPOTIFY_STATIC_PLAYLIST_ID`), adds to that playlist
  - Daily snapshot playlist `WWOZTracker YYYY-MM-DD` is (re)built from the archive for exact chronology

 

## Coding Conventions

- TypeScript strict mode, NodeNext ESM
- Include `.js` in import specifiers (ESM requirement)
- 2‑space indentation; named exports; focused functions
- Use `Logger` for info/warn/error/debug

## Troubleshooting

- “Playlist cache loaded with N tracks”
  - This reflects the actual remote state after cache reset; it’s expected to equal the number of items in the target Spotify playlist
- Multiple “Daily Statistics” sections
  - The archiver now pre‑cleans any old block and inserts one up‑to‑date block
- Browser path on macOS
  - If providing a `.app` path in `chromePath`, the scraper resolves the actual binary inside the bundle automatically

## Security / Config

- Do not commit real secrets
- Prefer a local YAML config file via `CONFIG_PATH`
- Key config fields:
  - `wwoz.playlistUrl`, `wwoz.scrapeIntervalSeconds`
  - `archive.basePath`, `archive.deduplicationWindowMinutes`
  - `spotify.clientId`, `spotify.clientSecret`, `spotify.refreshToken`, `spotify.userId`, `spotify.staticPlaylistId`
  - `rateLimit.spotify.maxConcurrent`, `rateLimit.spotify.minTime`
  - `chromePath`
- Env override: `SPOTIFY_STATIC_PLAYLIST_ID` supersedes `spotify.staticPlaylistId`

## Types (Key)

- `ScrapedSong`: artist, title, album?, playedDate?, playedTime?, scrapedAt, show?, host?
- `ArchiveEntry`: { song, status: 'found'|'not_found'|'low_confidence'|'unknown', confidence?, spotifyUrl?, match?, archivedAt }
- `IArchiver.archive(entry): Promise<void>` (+ optional `finalizeDailyStats`, `wasArchived`, `getDailySpotifyTrackUris`)

## Next Steps (Planned)

- Optional: persist archive dedup keys across runs
- Add richer CLI toggles (dry‑run per action, target playlist override)
- Improve show/host mapping and low‑confidence feedback loop
 

## License

- Proprietary/private project by default. Add a license if/when appropriate.
