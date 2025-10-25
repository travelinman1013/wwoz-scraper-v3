#!/usr/bin/env python3
"""
Deduplicate Instruments in Artist Cards

This script fixes artist cards that have duplicate instruments in their frontmatter
due to the operator precedence bug in artist_discovery_pipeline.py.

It processes all artist cards and:
- Deduplicates instruments list while preserving order
- Updates frontmatter
- Generates a summary report

Usage:
    python deduplicate_artist_instruments.py [--dry-run] [--cards-dir PATH]
"""

import os
import sys
import yaml
import argparse
import logging
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from collections import OrderedDict


DEFAULT_CARDS_DIR = "/Users/maxwell/LETSGO/MaxVault/01_Projects/PersonalArtistWiki/Artists"


class InstrumentDeduplicator:
    """Deduplicate instruments in artist card frontmatter."""

    def __init__(self, cards_dir: str, dry_run: bool = False):
        self.cards_dir = Path(cards_dir)
        self.dry_run = dry_run

        if not self.cards_dir.exists():
            raise ValueError(f"Cards directory does not exist: {cards_dir}")

        # Statistics
        self.stats = {
            'total_cards': 0,
            'cards_with_duplicates': 0,
            'cards_fixed': 0,
            'total_duplicates_removed': 0,
            'errors': 0
        }

        # Detailed report
        self.report = []

        # Setup logging
        self.setup_logging()

    def setup_logging(self):
        """Configure logging."""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.StreamHandler(sys.stdout),
                logging.FileHandler('deduplicate_instruments.log')
            ]
        )
        self.logger = logging.getLogger(__name__)

    def get_all_artist_cards(self) -> List[Path]:
        """Get all artist card markdown files."""
        cards = list(self.cards_dir.glob("*.md"))
        # Filter out non-artist files
        cards = [c for c in cards if c.name != "artist_connections.json"]
        self.logger.info(f"Found {len(cards)} artist cards in {self.cards_dir}")
        return sorted(cards)

    def parse_card(self, card_path: Path) -> Tuple[Optional[Dict], str, str]:
        """
        Parse artist card and extract frontmatter and content.

        Returns: (frontmatter_dict, frontmatter_text, body_content)
        """
        try:
            with open(card_path, 'r', encoding='utf-8') as f:
                content = f.read()

            if not content.startswith('---'):
                self.logger.warning(f"No frontmatter found in {card_path.name}")
                return None, "", content

            # Find frontmatter boundaries
            frontmatter_end = content.find('---', 3)
            if frontmatter_end == -1:
                self.logger.warning(f"Malformed frontmatter in {card_path.name}")
                return None, "", content

            frontmatter_text = content[3:frontmatter_end]
            body_content = content[frontmatter_end + 3:]
            frontmatter = yaml.safe_load(frontmatter_text)

            return frontmatter, frontmatter_text, body_content

        except Exception as e:
            self.logger.error(f"Error parsing {card_path.name}: {e}")
            return None, "", ""

    def deduplicate_list(self, items: List[str]) -> Tuple[List[str], int]:
        """
        Deduplicate a list while preserving order.

        Returns: (deduplicated_list, number_of_duplicates_removed)
        """
        seen = set()
        result = []
        duplicates = 0

        for item in items:
            if item not in seen:
                seen.add(item)
                result.append(item)
            else:
                duplicates += 1

        return result, duplicates

    def has_duplicate_instruments(self, frontmatter: Dict) -> bool:
        """Check if frontmatter has duplicate instruments."""
        instruments = frontmatter.get('instruments')
        if not instruments or not isinstance(instruments, list):
            return False

        # Check for duplicates
        return len(instruments) != len(set(instruments))

    def fix_quick_info_instruments(self, content: str, deduplicated_instruments: List[str]) -> str:
        """
        Fix the Instruments line in the Quick Info section of the markdown body.

        Replaces duplicate instrument lists with the deduplicated version.
        """
        import re

        # Find the Instruments line in Quick Info section
        # Pattern matches: - **Instruments**: [any text until newline]
        pattern = r'(- \*\*Instruments\*\*:).*'

        # Build the replacement instruments line
        instruments_str = ', '.join(deduplicated_instruments)
        replacement = rf'\1 {instruments_str}'

        # Replace the line
        updated_content = re.sub(pattern, replacement, content)

        return updated_content

    def process_card(self, card_path: Path) -> str:
        """Process a single artist card."""
        try:
            self.logger.info(f"Processing: {card_path.name}")

            # Parse card
            frontmatter, frontmatter_text, body_content = self.parse_card(card_path)
            if not frontmatter:
                self.stats['errors'] += 1
                return "❌ Parse error"

            # Check if has duplicate instruments
            if not self.has_duplicate_instruments(frontmatter):
                return "✓ No duplicates"

            # Get instruments
            instruments = frontmatter['instruments']
            original_count = len(instruments)

            # Deduplicate
            deduplicated, duplicates_removed = self.deduplicate_list(instruments)
            deduplicated_count = len(deduplicated)

            self.logger.info(
                f"  {card_path.name}: {original_count} instruments -> {deduplicated_count} "
                f"(removed {duplicates_removed} duplicates)"
            )

            # Update statistics
            self.stats['cards_with_duplicates'] += 1
            self.stats['total_duplicates_removed'] += duplicates_removed

            # Add to report
            self.report.append({
                'file': card_path.name,
                'artist': frontmatter.get('title', card_path.stem),
                'original_count': original_count,
                'deduplicated_count': deduplicated_count,
                'duplicates_removed': duplicates_removed,
                'instruments': deduplicated
            })

            if self.dry_run:
                self.logger.info(f"  [DRY RUN] Would update: {card_path.name}")
                return f"🔍 Would fix ({duplicates_removed} duplicates)"

            # Update frontmatter
            frontmatter['instruments'] = deduplicated

            # Fix the Quick Info section in the markdown body
            body_content = self.fix_quick_info_instruments(body_content, deduplicated)

            # Rebuild the file
            frontmatter_yaml = yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True, sort_keys=False)
            updated_content = f"---\n{frontmatter_yaml}---{body_content}"

            # Write updated card
            with open(card_path, 'w', encoding='utf-8') as f:
                f.write(updated_content)

            self.stats['cards_fixed'] += 1
            self.logger.info(f"  ✅ Updated: {card_path.name}")

            return f"✅ Fixed ({duplicates_removed} duplicates removed)"

        except Exception as e:
            self.logger.error(f"Error processing {card_path.name}: {e}")
            self.stats['errors'] += 1
            return f"❌ Error: {str(e)[:30]}"

    def run(self):
        """Run the deduplication process."""
        cards = self.get_all_artist_cards()
        self.stats['total_cards'] = len(cards)

        print(f"\n🎵 Artist Instrument Deduplication")
        print(f"Cards directory: {self.cards_dir}")
        print(f"Total cards: {self.stats['total_cards']}")
        if self.dry_run:
            print("🔍 DRY RUN MODE - No files will be modified")
        print()

        from tqdm import tqdm

        with tqdm(cards, desc="Processing cards", unit="card") as pbar:
            for card_path in pbar:
                pbar.set_description(f"Processing: {card_path.stem[:30]}")

                status = self.process_card(card_path)
                pbar.set_postfix_str(status)

        # Print summary
        self.print_summary()

        # Print detailed report
        if self.report:
            self.print_detailed_report()

    def print_summary(self):
        """Print processing summary."""
        print(f"\n📊 Deduplication Summary:")
        print(f"✅ Cards fixed: {self.stats['cards_fixed']}")
        print(f"🔍 Cards with duplicates found: {self.stats['cards_with_duplicates']}")
        print(f"📉 Total duplicates removed: {self.stats['total_duplicates_removed']}")
        print(f"❌ Errors: {self.stats['errors']}")
        print(f"📁 Total cards processed: {self.stats['total_cards']}")

        if self.stats['cards_with_duplicates'] > 0:
            avg_duplicates = self.stats['total_duplicates_removed'] / self.stats['cards_with_duplicates']
            print(f"\n📈 Average duplicates per affected card: {avg_duplicates:.1f}")

    def print_detailed_report(self):
        """Print detailed report of affected cards."""
        print(f"\n📋 Detailed Report ({len(self.report)} cards with duplicates):")
        print("=" * 80)

        # Sort by most duplicates first
        sorted_report = sorted(self.report, key=lambda x: x['duplicates_removed'], reverse=True)

        for i, entry in enumerate(sorted_report[:20], 1):  # Show top 20
            print(f"\n{i}. {entry['artist']} ({entry['file']})")
            print(f"   Original: {entry['original_count']} instruments")
            print(f"   Deduplicated: {entry['deduplicated_count']} instruments")
            print(f"   Removed: {entry['duplicates_removed']} duplicates")
            print(f"   Final instruments: {', '.join(entry['instruments'][:10])}" +
                  (f"... (+{len(entry['instruments']) - 10} more)" if len(entry['instruments']) > 10 else ""))

        if len(sorted_report) > 20:
            print(f"\n... and {len(sorted_report) - 20} more cards with duplicates")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Deduplicate instruments in artist card frontmatter"
    )

    parser.add_argument(
        '--cards-dir',
        default=DEFAULT_CARDS_DIR,
        help=f'Directory containing artist cards (default: {DEFAULT_CARDS_DIR})'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without modifying files'
    )
    parser.add_argument(
        '--log-level',
        choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
        default='INFO',
        help='Set logging level (default: INFO)'
    )

    args = parser.parse_args()

    # Setup logging level
    numeric_level = getattr(logging, args.log_level.upper())
    logging.getLogger().setLevel(numeric_level)

    try:
        # Create deduplicator and run
        deduplicator = InstrumentDeduplicator(
            cards_dir=args.cards_dir,
            dry_run=args.dry_run
        )

        deduplicator.run()

        print("\n✅ Deduplication completed successfully")

    except KeyboardInterrupt:
        print("\n\n⏹️  Process interrupted by user")
        sys.exit(1)
    except Exception as e:
        logging.error(f"Fatal error: {e}")
        print(f"\n❌ Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
