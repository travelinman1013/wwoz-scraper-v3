#!/usr/bin/env python3
"""
Fix Quick Info Instrument Display

This script updates the Quick Info section in artist cards to match the corrected
frontmatter instruments list. Run this after deduplicate_artist_instruments.py.

Usage:
    python fix_quick_info_instruments.py [--dry-run]
"""

import os
import sys
import yaml
import argparse
import logging
import re
from pathlib import Path
from typing import List, Dict, Tuple, Optional


DEFAULT_CARDS_DIR = "/Users/maxwell/LETSGO/MaxVault/01_Projects/PersonalArtistWiki/Artists"


class QuickInfoFixer:
    """Fix Quick Info instruments section to match frontmatter."""

    def __init__(self, cards_dir: str, dry_run: bool = False):
        self.cards_dir = Path(cards_dir)
        self.dry_run = dry_run

        if not self.cards_dir.exists():
            raise ValueError(f"Cards directory does not exist: {cards_dir}")

        # Statistics
        self.stats = {
            'total_cards': 0,
            'cards_with_instruments': 0,
            'cards_fixed': 0,
            'cards_skipped': 0,
            'errors': 0
        }

        # Setup logging
        self.setup_logging()

    def setup_logging(self):
        """Configure logging."""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.StreamHandler(sys.stdout),
                logging.FileHandler('fix_quick_info.log')
            ]
        )
        self.logger = logging.getLogger(__name__)

    def get_all_artist_cards(self) -> List[Path]:
        """Get all artist card markdown files."""
        cards = list(self.cards_dir.glob("*.md"))
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
                return None, "", content

            frontmatter_end = content.find('---', 3)
            if frontmatter_end == -1:
                return None, "", content

            frontmatter_text = content[3:frontmatter_end]
            body_content = content[frontmatter_end + 3:]
            frontmatter = yaml.safe_load(frontmatter_text)

            return frontmatter, frontmatter_text, body_content

        except Exception as e:
            self.logger.error(f"Error parsing {card_path.name}: {e}")
            return None, "", ""

    def fix_quick_info_instruments(self, content: str, instruments: List[str]) -> Tuple[str, bool]:
        """
        Fix the Instruments line in the Quick Info section.

        Returns: (updated_content, was_changed)
        """
        # Find the Instruments line in Quick Info section
        pattern = r'(- \*\*Instruments\*\*:).*'

        # Build the replacement
        instruments_str = ', '.join(instruments)
        replacement = rf'\1 {instruments_str}'

        # Check if it needs updating
        match = re.search(pattern, content)
        if not match:
            return content, False

        current_line = match.group(0)
        new_line = re.sub(pattern, replacement, current_line)

        # Check if different
        if current_line == new_line:
            return content, False

        # Replace the line
        updated_content = re.sub(pattern, replacement, content)
        return updated_content, True

    def process_card(self, card_path: Path) -> str:
        """Process a single artist card."""
        try:
            # Parse card
            frontmatter, frontmatter_text, body_content = self.parse_card(card_path)
            if not frontmatter:
                self.stats['errors'] += 1
                return "❌ Parse error"

            # Check if card has instruments in frontmatter
            instruments = frontmatter.get('instruments')
            if not instruments or not isinstance(instruments, list):
                self.stats['cards_skipped'] += 1
                return "⏭️  No instruments"

            self.stats['cards_with_instruments'] += 1

            # Fix Quick Info section
            updated_body, was_changed = self.fix_quick_info_instruments(body_content, instruments)

            if not was_changed:
                return "✓ Already correct"

            if self.dry_run:
                self.logger.info(f"  [DRY RUN] Would update Quick Info in: {card_path.name}")
                return "🔍 Would fix Quick Info"

            # Rebuild the file
            frontmatter_yaml = yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True, sort_keys=False)
            updated_content = f"---\n{frontmatter_yaml}---{updated_body}"

            # Write updated card
            with open(card_path, 'w', encoding='utf-8') as f:
                f.write(updated_content)

            self.stats['cards_fixed'] += 1
            self.logger.info(f"  ✅ Fixed Quick Info: {card_path.name}")

            return "✅ Quick Info fixed"

        except Exception as e:
            self.logger.error(f"Error processing {card_path.name}: {e}")
            self.stats['errors'] += 1
            return f"❌ Error: {str(e)[:30]}"

    def run(self):
        """Run the Quick Info fix process."""
        cards = self.get_all_artist_cards()
        self.stats['total_cards'] = len(cards)

        print(f"\n🎵 Quick Info Instruments Fixer")
        print(f"Cards directory: {self.cards_dir}")
        print(f"Total cards: {self.stats['total_cards']}")
        if self.dry_run:
            print("🔍 DRY RUN MODE - No files will be modified")
        print()

        from tqdm import tqdm

        with tqdm(cards, desc="Fixing Quick Info", unit="card") as pbar:
            for card_path in pbar:
                pbar.set_description(f"Processing: {card_path.stem[:30]}")
                status = self.process_card(card_path)
                pbar.set_postfix_str(status)

        # Print summary
        self.print_summary()

    def print_summary(self):
        """Print processing summary."""
        print(f"\n📊 Quick Info Fix Summary:")
        print(f"✅ Cards fixed: {self.stats['cards_fixed']}")
        print(f"📋 Cards with instruments: {self.stats['cards_with_instruments']}")
        print(f"⏭️  Cards skipped (no instruments): {self.stats['cards_skipped']}")
        print(f"❌ Errors: {self.stats['errors']}")
        print(f"📁 Total cards processed: {self.stats['total_cards']}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Fix Quick Info instruments section in artist cards"
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

    args = parser.parse_args()

    try:
        fixer = QuickInfoFixer(
            cards_dir=args.cards_dir,
            dry_run=args.dry_run
        )

        fixer.run()

        print("\n✅ Quick Info fix completed successfully")

    except KeyboardInterrupt:
        print("\n\n⏹️  Process interrupted by user")
        sys.exit(1)
    except Exception as e:
        logging.error(f"Fatal error: {e}")
        print(f"\n❌ Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
