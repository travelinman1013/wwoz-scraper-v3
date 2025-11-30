# Docker Deployment Guide

This guide explains how to run the WWOZ Scraper in a Docker container.

## Prerequisites

- Docker and Docker Compose installed
- A `config.yaml` file with valid Spotify credentials
- Path to your Obsidian vault (for archive output)

## Configuration Setup

### 1. Create Your Configuration File

Copy the example configuration and customize it:

```bash
cp config/config.example.yaml config/config.yaml
```

### 2. Update Configuration Values

Edit `config/config.yaml` with your settings:

```yaml
dryRun: false                    # Set to true for testing without writes

wwoz:
  playlistUrl: 'https://wwoz.org/programs/playlists'
  scrapeIntervalSeconds: 3600    # How often to scrape (in seconds)

spotify:
  clientId: 'YOUR_CLIENT_ID'     # From Spotify Developer Dashboard
  clientSecret: 'YOUR_SECRET'    # From Spotify Developer Dashboard
  refreshToken: 'YOUR_TOKEN'     # OAuth refresh token
  userId: 'YOUR_USER_ID'         # Your Spotify user ID
  staticPlaylistId: null         # Optional: specific playlist to update

archive:
  enabled: true
  basePath: '/vault'             # CRITICAL: Must match container mount point
  deduplicationWindowMinutes: 60

artistDiscovery:
  enabled: false                 # Enable for AI-powered artist cards
  perplexityApiKey: 'YOUR_KEY'   # Required if enabled

playlistArchiving:
  enabled: false                 # Enable for automatic playlist archiving
  mainPlaylistId: 'YOUR_PLAYLIST_ID'
  durationThresholdHours: 65
```

> **Important**: The `archive.basePath` must match the container's mount point for your Obsidian vault. If you mount your vault at `/vault` in the container, set `basePath: '/vault'`.

## Building the Image

Build the Docker image:

```bash
# Using docker build
docker build -t wwoz-scraper .

# Or using Docker Compose
docker compose build
```

The build process:
1. Compiles TypeScript source to JavaScript
2. Installs Node.js production dependencies
3. Installs Playwright with Chromium browser
4. Installs Python 3 with required packages for artist discovery

## Running the Container

### Continuous Mode (Default)

Run indefinitely, scraping at configured intervals:

```bash
# Using Docker Compose (recommended)
docker compose up -d

# Or using docker run
docker run -d \
  --name wwoz-scraper \
  -v $(pwd)/config/config.yaml:/app/config/config.yaml:ro \
  -v /path/to/your/obsidian/vault:/vault \
  -v wwoz-state:/app/config/state \
  wwoz-scraper
```

### Single Run Mode

Scrape once and exit:

```bash
docker run --rm \
  -v $(pwd)/config/config.yaml:/app/config/config.yaml:ro \
  -v /path/to/your/obsidian/vault:/vault \
  wwoz-scraper --once
```

### Snapshot Mode

Create a daily snapshot for a specific date:

```bash
docker run --rm \
  -v $(pwd)/config/config.yaml:/app/config/config.yaml:ro \
  -v /path/to/your/obsidian/vault:/vault \
  wwoz-scraper --snapshot 2025-11-30
```

### Backfill Mode

Create snapshots for the past N days:

```bash
docker run --rm \
  -v $(pwd)/config/config.yaml:/app/config/config.yaml:ro \
  -v /path/to/your/obsidian/vault:/vault \
  wwoz-scraper --backfill 7
```

### Artist Discovery Backfill

Run artist discovery for past N days of archives:

```bash
docker run --rm \
  -v $(pwd)/config/config.yaml:/app/config/config.yaml:ro \
  -v /path/to/your/obsidian/vault:/vault \
  wwoz-scraper --backfill-artists 7
```

### Manual Playlist Archiving

Manually trigger playlist archiving:

```bash
docker run --rm \
  -v $(pwd)/config/config.yaml:/app/config/config.yaml:ro \
  -v /path/to/your/obsidian/vault:/vault \
  wwoz-scraper --archive-playlist
```

## Volume Mounts

The container uses three volume mounts:

| Mount | Purpose | Access |
|-------|---------|--------|
| `config.yaml` | Configuration with secrets | Read-only |
| Obsidian vault | Archive output directory | Read-write |
| State volume | Persists `processed_archives.json` | Read-write |

### Configuration File Mount

```yaml
- ./config/config.yaml:/app/config/config.yaml:ro
```

Contains your Spotify credentials and API keys. Mounted read-only for security.

### Obsidian Vault Mount

```yaml
- /path/to/your/obsidian/vault:/vault
```

Your Obsidian vault where daily archives are written. The container path (`/vault`) must match the `archive.basePath` setting in your config.

### State Volume

```yaml
- wwoz-state:/app/config/state
```

Named volume that persists the `processed_archives.json` file across container restarts, preventing duplicate processing.

## Viewing Logs

```bash
# Follow logs in real-time (Docker Compose)
docker compose logs -f

# View logs for standalone container
docker logs wwoz-scraper

# Follow logs for standalone container
docker logs -f wwoz-scraper
```

## Stopping the Container

```bash
# Using Docker Compose
docker compose down

# Standalone container
docker stop wwoz-scraper
docker rm wwoz-scraper
```

## Troubleshooting

### "Config file not found"

- Verify the config file exists: `ls -la config/config.yaml`
- Check the mount path in your docker command
- Ensure `CONFIG_PATH` environment variable matches the mount point

```bash
# Debug: List config directory in container
docker run --rm -v $(pwd)/config:/app/config wwoz-scraper ls -la /app/config/
```

### "No data written to vault"

- Verify `archive.basePath` in config matches the container mount point
- Check that the vault directory has write permissions
- Ensure `archive.enabled` is `true` in config

```bash
# Debug: Check if vault is mounted correctly
docker run --rm -v /path/to/vault:/vault wwoz-scraper ls -la /vault
```

### "Spotify authentication failed"

- Verify credentials in `config.yaml` are correct
- Ensure the refresh token is still valid
- Check that client ID and secret match your Spotify app

### "Playwright/browser errors"

The Playwright base image includes all browser dependencies. If you see browser errors:

```bash
# Verify browser installation
docker run --rm wwoz-scraper npx playwright install --dry-run
```

### Container exits immediately

- Check logs for error messages: `docker logs wwoz-scraper`
- For one-time operations, use appropriate flags (`--once`, `--snapshot`, etc.)
- Verify config file is valid YAML

```bash
# Debug: Run interactively
docker run -it --rm \
  -v $(pwd)/config/config.yaml:/app/config/config.yaml:ro \
  wwoz-scraper --help
```

### Permission denied writing to vault

- Check the UID/GID of your vault directory
- The container runs as a non-root user (wwoz)
- Ensure the mounted directory is writable

```bash
# Check vault permissions on host
ls -la /path/to/your/obsidian/vault

# If needed, adjust permissions
chmod 777 /path/to/your/obsidian/vault
# Or for better security, match the container user's UID
```

### Python/Artist Discovery errors

```bash
# Verify Python installation
docker run --rm wwoz-scraper python3 --version

# Check Python packages
docker run --rm wwoz-scraper pip3 list
```

## Updating

To update to the latest version:

```bash
# Pull latest code
git pull

# Rebuild without cache
docker compose build --no-cache

# Restart with new image
docker compose up -d
```

## Image Size Note

The production image is approximately 2GB due to:
- Playwright browser (Chromium) and system dependencies
- Node.js runtime
- Python 3 runtime and packages

This size is expected and necessary for full functionality.
