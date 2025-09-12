# WWOZ Scraper v3

A TypeScript (NodeNext ESM) tool that scrapes the WWOZ playlist, enriches results with Spotify, and archives discoveries into an Obsidian‑friendly Markdown daily note. It can run continuously or on demand, and can generate per‑day Spotify playlists from the archive.

## Features

- Playwright scraper for WWOZ playlist table
- Spotify enrichment with rate‑limited API access
- Duplicate detection against Spotify playlist and archive
- Obsidian Markdown archiver with daily stats block
- Chronological table insertion (rows sorted by time)
- Continuous mode with safe early‑stop after consecutive Spotify duplicates
- Daily snapshot Spotify playlist generation from the archive
- On‑demand CLI for snapshots and backfill

## Repository Structure

- `src/` TypeScript source (ESM, NodeNext)
  - `modules/` feature modules
    - `scrapers/` → `WWOZScraper`
    - `enrichers/` → `SpotifyEnricher`
    - `archivers/` → `ObsidianArchiver`
  - `services/` → `WorkflowService` orchestrates scrape → enrich → archive
  - `utils/` shared utilities (`config`, `logger`, `matching`, etc.)
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
  - `wwoz.playlistUrl`
  - `archive.basePath` (Obsidian vault or a folder; year/month subpaths are auto‑handled)
  - `archive.deduplicationWindowMinutes`
  - `spotify.userId`, `spotify.clientId`, `spotify.clientSecret`, `spotify.refreshToken`
  - `spotify.staticPlaylistId` (optional; if set, adds to this playlist)
  - `rateLimit.spotify.{maxConcurrent,minTime}`
  - `chromePath` (optional; path to a browser binary if Playwright browsers not installed)

3) Env overrides (optional)

- `CONFIG_PATH` → path to yaml config
- `SPOTIFY_STATIC_PLAYLIST_ID` → overrides `spotify.staticPlaylistId`

## Build & Run

- Dev (ts-node + nodemon): `npm run dev`
- Build: `npm run build`
- Start (continuous): `npm start`
- Single run: `npm run build && node dist/index.js --once`

### Snapshot and Backfill (on demand)

- Create a daily snapshot playlist from an existing archive:
  - `npm run build && node dist/index.js --snapshot YYYY-MM-DD`
- Backfill last N days:
  - `npm run build && node dist/index.js --backfill 7`

## How It Works

- `WorkflowService.runOnce()`
  - Scrapes playlist rows with `WWOZScraper` (Playwright)
  - Sorts oldest → newest and enriches via `SpotifyEnricher`
  - Checks Spotify for duplicates (fresh cache per run)
  - Archives each outcome to Markdown via `ObsidianArchiver`
  - Updates/repairs the daily “Daily Statistics” section
  - Creates a “yesterday” snapshot playlist named `WWOZTracker YYYY-MM-DD` from the archive

- Continuous mode
  - Repeats `runOnce` every `wwoz.scrapeIntervalSeconds`
  - Stops early after 5 consecutive Spotify duplicates (archive duplicates do not count)

## Archiving Details

- File path: `<baseRoot>/YYYY/MM/YYYY-MM-DD.md`
  - If `archive.basePath` already includes `/YYYY` or `/YYYY/MM`, those tail segments are ignored so folders roll over automatically
- Template: `templates/daily-archive.md.ejs`
  - Header: “WWOZ Discoveries – <day>”
  - Tracks table columns: `Time | Artist | Title | Album | Show | Host | Status | Confidence | Spotify`
- Row insertion
  - New rows are inserted into the Tracks table in chronological order (not appended)
  - Time parsing supports `h:mm AM/PM`, `h:mmam`, and `HH:mm`; unknown times go to the bottom
- Statistics
  - A single “Daily Statistics” block is maintained in the file; it is replaced or inserted above the Tracks section
- In‑memory dedup
  - `archive.deduplicationWindowMinutes` suppresses rapid repeats during the same process lifetime

## Spotify Details

- `SpotifyEnricher`
  - Manages token refresh and rate limits via Bottleneck
  - Fresh playlist cache is loaded per run to detect duplicates accurately
  - Duplicate checks are done against the target Spotify playlist
  - Adds tracks by URI; cache updated optimistically
- Static vs daily playlists
  - If `spotify.staticPlaylistId` is set (or `SPOTIFY_STATIC_PLAYLIST_ID`), adds to that playlist
  - A daily snapshot playlist `WWOZTracker YYYY-MM-DD` is also created (from the archive) to reflect chronological order for the day

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

## Security

- Do not commit real secrets
- Prefer a local YAML config file via `CONFIG_PATH`

## License

- Proprietary/private project by default. Add a license if/when appropriate.

