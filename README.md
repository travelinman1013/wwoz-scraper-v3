# WWOZ Scraper v3

A TypeScript (NodeNext ESM) tool that scrapes the WWOZ playlist, enriches results with Spotify, and archives discoveries into an Obsidian‑friendly Markdown daily note. It supports continuous operation, on‑demand runs, and daily snapshot playlist generation.

## Features

- Robust Playwright scraper for WWOZ playlist table (resilient selectors + cleanup)
- Spotify enrichment with search, scoring, rate‑limited API, playlist ops, and cover upload
- Duplicate detection against Spotify playlist and Obsidian archive
- Obsidian Markdown archiver with in-file dedup and "Daily Statistics" block
- Chronological row insertion (by played time; timestamp fallback)
- Continuous mode with safe early-stop after consecutive Spotify duplicates and configurable archive-duplicate streak
- Daily snapshot Spotify playlist generation from the archive
- Artist Discovery Pipeline: AI-powered research and Obsidian artist card generation (optional)
- On-demand CLI for single run, snapshots, and artist discovery backfill

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
  - `archive.basePath`, `archive.deduplicationWindowMinutes`, `archive.consecutiveArchiveDuplicatesStopThreshold`
  - `spotify.userId`, `spotify.clientId`, `spotify.clientSecret`, `spotify.refreshToken`
  - `spotify.staticPlaylistId` (optional; if set, adds to this playlist)
  - `rateLimit.spotify.{maxConcurrent,minTime}`
  - `chromePath` (optional; browser path if Playwright browsers not installed)
  - `artistDiscovery` (optional; see Artist Discovery Pipeline section for details)

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
- Backfill snapshot playlists (last N days): `node dist/index.js --backfill 7`
- Backfill artist discovery (last N days): `node dist/index.js --backfill-artists 7`
 

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
  - Stops early after N consecutive archive duplicates (config: `archive.consecutiveArchiveDuplicatesStopThreshold`, default 50)
  - Archive duplicates are summarized at the end of each run (totals + max streak); no per-duplicate log spam
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

## Artist Discovery Pipeline

The Artist Discovery Pipeline is an optional integration that automatically processes completed daily archives to create and enhance artist knowledge cards in your Obsidian vault using AI-powered research.

### Overview

When enabled, the system automatically triggers a Python-based artist discovery pipeline after each day's archive is finalized. The pipeline:
- Extracts unique artists from the daily archive
- Researches each artist using Perplexity AI
- Creates/updates Obsidian artist cards with biography, genre, discography, and more
- Downloads artist portrait images
- Tracks processing state to avoid duplicate work

### Configuration

Add the following section to your `config.yaml`:

```yaml
artistDiscovery:
  enabled: true  # Set to false to disable
  scriptPath: '/path/to/artist_discovery_pipeline.py'
  pythonPath: '/path/to/python3'  # Python 3.x executable with required dependencies
  perplexityApiKey: 'pplx-your-api-key-here'

  # Optional: Override default paths
  cardsDir: '/path/to/your/vault/Artists'  # Where artist cards are created
  imagesDir: '/path/to/your/vault/ArtistPortraits'  # Where portraits are saved

  forceReprocess: false  # Set to true to reprocess already-completed archives
  timeoutMinutes: 30  # Maximum time for script execution per archive
```

#### Required Configuration Fields:
- `enabled`: Master toggle for the feature
- `scriptPath`: Absolute path to the Python artist discovery script
- `pythonPath`: Path to Python 3 executable (must have required dependencies installed)
- `perplexityApiKey`: Your Perplexity AI API key for artist research

#### Optional Configuration Fields:
- `cardsDir`: Override the default artist cards directory
- `imagesDir`: Override the default artist portraits directory
- `forceReprocess`: When true, reprocess archives even if already completed successfully
- `timeoutMinutes`: Maximum execution time per archive (default: 30 minutes)

### Automatic Operation

In continuous mode, the artist discovery pipeline runs automatically:
1. The scraper completes a day's work and finalizes the archive
2. On day change (when processing switches to a new date), the completed archive is queued
3. The pipeline runs in the background while the scraper continues its next cycle
4. Processing state is tracked in `config/processed_archives.json`
5. Already-processed archives are skipped (unless `forceReprocess: true`)

### Manual Operation

#### Process a Specific Day
To manually run artist discovery for a specific date:

```bash
# Backfill artist discovery for the past 7 days
node dist/index.js --backfill-artists 7

# Backfill for just yesterday
node dist/index.js --backfill-artists 1

# Backfill for the past 30 days
node dist/index.js --backfill-artists 30
```

The backfill command:
- Automatically finds archive files for the specified date range
- Skips dates that have already been processed successfully
- Processes each archive sequentially
- Logs progress, skipped archives, and any errors
- Updates the processing state file after each archive

#### Force Reprocessing
To reprocess an archive that was already completed:

1. **Option 1**: Enable `forceReprocess: true` in config, then run backfill
2. **Option 2**: Delete the date entry from `config/processed_archives.json`, then run backfill

### Processing State Tracking

The system maintains processing state in `config/processed_archives.json`:

```json
{
  "2025-10-19": {
    "processedAt": "2025-10-20T03:15:42.123Z",
    "status": "success",
    "durationMs": 145230
  },
  "2025-10-18": {
    "processedAt": "2025-10-19T03:12:15.456Z",
    "status": "error",
    "error": "Script timeout after 30 minutes",
    "durationMs": 1800000
  }
}
```

- **success**: Archive processed successfully, won't be reprocessed unless forced
- **error**: Processing failed, will be retried on next backfill unless forced

### Python Script Requirements

Your Python artist discovery script should:
- Accept `--archive <path>` argument with the path to the daily archive file
- Accept optional `--cards-dir` and `--images-dir` arguments
- Accept optional `--dry-run` flag (when scraper is in dry-run mode)
- Accept optional `--force` flag (when `forceReprocess: true`)
- Use `PERPLEXITY_API_KEY` environment variable for API access
- Exit with code 0 on success, non-zero on failure
- Log progress to stdout (captured and logged by the scraper)
- Log errors to stderr (captured and logged as warnings)

Example invocation by the scraper:
```bash
/path/to/python3 /path/to/artist_discovery_pipeline.py \
  --archive "/vault/2025/10/WWOZ Saturday, Oct. 19th, 2025.md" \
  --cards-dir "/vault/Artists" \
  --images-dir "/vault/ArtistPortraits"
```

### Logging

Artist discovery operations are logged with `[Artist Discovery]` prefix:
- Pipeline start and completion times
- Artist counts processed
- Success/failure status
- Duration in seconds
- All script stdout/stderr output

Enable debug logging for more details:
```bash
LOG_LEVEL=debug npm start
# or
DEBUG=1 npm start
```

### Troubleshooting

**Pipeline not running automatically:**
- Check `artistDiscovery.enabled: true` in config
- Verify `scriptPath` exists and is executable
- Check logs for initialization message: "Artist Discovery Service initialized"

**"Script timeout after N minutes":**
- Increase `timeoutMinutes` in config
- Check Python script for hanging operations
- Verify Perplexity API is responding

**"Archive already processed" (when you want to reprocess):**
- Set `forceReprocess: true` in config, OR
- Remove the date entry from `config/processed_archives.json`

**Python script errors:**
- Verify all Python dependencies are installed
- Check `pythonPath` points to correct Python 3 executable
- Verify Perplexity API key is valid
- Check script logs for specific error messages

## Coding Conventions

- TypeScript strict mode, NodeNext ESM
- Include `.js` in import specifiers (ESM requirement)
- 2‑space indentation; named exports; focused functions
- Use `Logger` for info/warn/error/debug

## Troubleshooting

- Scraper returns 0 songs
  - The scraper waits for table rows with real content and retries once with a light reload. If you still see 0, verify `wwoz.playlistUrl` and that the table structure matches expectations. Enable debug logs for more detail.
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

## Logging

- Default logs surface high‑level actions and outcomes. Archive duplicates are only summarized at end of run.
- To enable detailed debug logs (including archive scans/duplicate hits), set `LOG_LEVEL=debug` or `DEBUG=1` when starting the app.

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
