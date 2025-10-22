# MusicBrainz Backfill Script

This script updates all existing Obsidian artist cards with MusicBrainz metadata enrichment.

## What It Does

The backfill script scans your artist cards directory and enriches cards that don't already have MusicBrainz data with:

### Biographical Data
- ✅ Birth date and death date (structured YYYY-MM-DD format)
- ✅ Origin/birthplace (city-level precision)
- ✅ Gender (for individuals)
- ✅ Artist type (Person/Group/Band)
- ✅ Disambiguation (contextual information)

### Musical Details
- ✅ Instruments (all instruments for individuals)
- ✅ Aliases (alternative names)
- ✅ Tags (top 3 genre tags as hashtags)

### Relationships
- ✅ Members (for groups/bands with time periods and instruments)
- ✅ Original Members (founding members subsection)
- ✅ Collaborators (from recording appearances)

### Enhanced Sections
- ✅ Updated Quick Info with new fields
- ✅ New Members section (for groups)
- ✅ MusicBrainz link in External Links
- ✅ Tags section at bottom

## Installation

The script requires `musicbrainzngs` library:

```bash
# If using venv (recommended)
cd /Users/maxwell/LETSGO/Projects/wwoz-scraper-v3
python3 -m venv venv
source venv/bin/activate
pip install musicbrainzngs

# Or system-wide
pip install --break-system-packages musicbrainzngs
```

## Usage

### Basic Usage

```bash
# From wwoz-scraper-v3 directory
cd /Users/maxwell/LETSGO/Projects/wwoz-scraper-v3
python3 backfill_musicbrainz_data.py

# Or with venv
source venv/bin/activate
python backfill_musicbrainz_data.py
```

### Dry Run (Preview Changes)

**RECOMMENDED**: Always run dry-run first to see what will be updated:

```bash
python backfill_musicbrainz_data.py --dry-run
```

This will:
- Show which cards would be updated
- Display MusicBrainz data that would be added
- Not modify any files
- Generate a log file for review

### Test with Limited Cards

Test on just a few cards first:

```bash
python backfill_musicbrainz_data.py --dry-run --limit 5
```

### Force Re-process All Cards

If you want to update cards that already have MusicBrainz data:

```bash
python backfill_musicbrainz_data.py --force
```

### Custom Cards Directory

```bash
python backfill_musicbrainz_data.py --cards-dir /path/to/your/artists
```

### All Options

```bash
python backfill_musicbrainz_data.py \
  --cards-dir /path/to/artists \  # Custom directory
  --dry-run \                      # Preview only
  --force \                        # Re-process cards with MB data
  --limit 10 \                     # Process first 10 cards only
  --log-level DEBUG                # Verbose logging
```

## How It Works

1. **Scan Directory**: Finds all `.md` files in your artist cards directory

2. **Check Cards**: For each card:
   - Parses frontmatter and content
   - Checks if it already has MusicBrainz data (skips if present, unless `--force`)
   - Extracts artist name from title or filename

3. **Fetch MusicBrainz Data**:
   - Searches MusicBrainz for the artist
   - Fetches detailed metadata with relationships
   - Respects rate limit (1 request/second)

4. **Merge Data**:
   - Updates frontmatter with new fields
   - Enhances Quick Info section
   - Adds Members section (if applicable)
   - Adds MusicBrainz link to External Links
   - Adds Tags section at bottom
   - Preserves all existing content

5. **Write Updates**: Saves updated card (unless dry-run)

## Output

The script provides:

### Progress Display
```
🎵 MusicBrainz Backfill Process
Cards directory: /Users/maxwell/LETSGO/MaxVault/01_Projects/PersonalArtistWiki/Artists
Total cards: 962
Processing: 962 cards

Processing cards:  45%|████▌     | 433/962 [14:33<17:48,  2.02s/card]
```

### Summary Statistics
```
📊 Backfill Summary:
✅ Updated: 687 cards
⏭️  Skipped (has MB data): 201
⚠️  Skipped (no MB data found): 52
❌ Errors: 22
📁 Total processed: 962/962

🎯 Update rate: 71.4%
```

### Log File
All processing details saved to: `musicbrainz_backfill.log`

## Status Indicators

- `✅ Updated` - Card successfully enriched with MusicBrainz data
- `⏭️  Already has MB data` - Card already enriched (skipped unless --force)
- `⚠️  No MB data found` - Artist not found in MusicBrainz database
- `❌ Parse error` - Could not parse card frontmatter
- `❌ Error` - Other processing error (see log)

## Safety Features

1. **Non-destructive**: Only adds data, never removes existing content
2. **Smart skipping**: Won't re-process cards that already have MB data
3. **Dry-run mode**: Preview all changes before applying
4. **Detailed logging**: Full audit trail in log file
5. **Timestamps**: Adds `musicbrainz_enriched_at` timestamp to frontmatter
6. **Rate limiting**: Respects MusicBrainz API limits (1 req/sec)

## Recommended Workflow

### First Time

1. **Dry run with limit**:
   ```bash
   python backfill_musicbrainz_data.py --dry-run --limit 10
   ```

2. **Review log file**:
   ```bash
   tail -50 musicbrainz_backfill.log
   ```

3. **Check a few updated cards** in your vault to verify formatting

4. **Run on all cards** (dry-run):
   ```bash
   python backfill_musicbrainz_data.py --dry-run
   ```

5. **Review summary** and log

6. **Run for real** (without --dry-run):
   ```bash
   python backfill_musicbrainz_data.py
   ```

### Regular Updates

After adding new artists to your vault:

```bash
python backfill_musicbrainz_data.py
```

The script automatically skips cards that already have MusicBrainz data.

## Troubleshooting

### "No module named 'musicbrainzngs'"
Install the dependency:
```bash
pip install --break-system-packages musicbrainzngs
```

### "Cards directory does not exist"
Check the path or specify custom directory:
```bash
python backfill_musicbrainz_data.py --cards-dir /your/actual/path
```

### Rate limit errors
The script automatically waits 1 second between requests. If you see rate limit errors, the script will log them but continue processing.

### Many "No MB data found" results
Some artists may not be in MusicBrainz database. This is normal. The script will skip these and continue.

### Parse errors
Some cards may have malformed frontmatter. Check the log file for details and fix manually if needed.

## Time Estimates

Processing time depends on:
- Number of cards
- Network speed
- MusicBrainz API response time

**Approximate rates**:
- ~2-3 seconds per card (with rate limiting)
- 100 cards: ~3-5 minutes
- 500 cards: ~15-25 minutes
- 1000 cards: ~30-50 minutes

Use `--limit` for faster testing!

## Notes

- Script respects existing data (won't overwrite)
- Adds `musicbrainz_enriched_at` timestamp for tracking
- Generates detailed log file for review
- Safe to run multiple times (skips already-enriched cards)
- Use `--force` to re-process all cards with updated MB data

## Support

Check the log file (`musicbrainz_backfill.log`) for detailed error messages and processing information.
