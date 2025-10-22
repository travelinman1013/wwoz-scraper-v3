#!/usr/bin/env python3
"""
MusicBrainz Backfill Script for Existing Artist Cards

This script updates existing Obsidian artist cards with MusicBrainz metadata enrichment.
It processes cards that don't already have MusicBrainz data and adds:
- Birth/death dates
- Origin/birth place
- Instruments
- Aliases
- Tags
- Member relationships
- Collaborators
- Gender, artist type, disambiguation

Usage:
    python backfill_musicbrainz_data.py [--dry-run] [--limit N] [--force]
"""

import os
import re
import sys
import json
import time
import logging
import argparse
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional, Tuple, Any

import yaml
import musicbrainzngs

# Configuration
DEFAULT_CARDS_DIR = "/Users/maxwell/LETSGO/MaxVault/01_Projects/PersonalArtistWiki/Artists"
MUSICBRAINZ_RATE_LIMIT = 1.0  # seconds (required: 1 request/second)
REQUEST_TIMEOUT = 30

# MusicBrainz Configuration
MUSICBRAINZ_APP_NAME = "WWOZ-Artist-Backfill"
MUSICBRAINZ_APP_VERSION = "1.0"
MUSICBRAINZ_CONTACT = "wwoz-scraper@example.com"
MUSICBRAINZ_MIN_CONFIDENCE = 80  # Minimum confidence (0-100) to accept a match


class MusicBrainzBackfiller:
    """Backfill existing artist cards with MusicBrainz metadata."""

    def __init__(self, cards_dir: str, dry_run: bool = False, force: bool = False):
        self.cards_dir = Path(cards_dir)
        self.dry_run = dry_run
        self.force = force

        if not self.cards_dir.exists():
            raise ValueError(f"Cards directory does not exist: {cards_dir}")

        # Initialize MusicBrainz
        musicbrainzngs.set_useragent(MUSICBRAINZ_APP_NAME, MUSICBRAINZ_APP_VERSION, MUSICBRAINZ_CONTACT)

        # Statistics
        self.stats = {
            'total': 0,
            'processed': 0,
            'updated': 0,
            'skipped_has_mb': 0,
            'skipped_no_mb_data': 0,
            'errors': 0
        }

        # Setup logging
        self.setup_logging()

    def setup_logging(self):
        """Configure logging for the backfill process."""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.StreamHandler(sys.stdout),
                logging.FileHandler('musicbrainz_backfill.log')
            ]
        )
        self.logger = logging.getLogger(__name__)

        # Suppress musicbrainzngs verbose logging (uncaught attribute messages)
        logging.getLogger('musicbrainzngs').setLevel(logging.WARNING)

    def get_all_artist_cards(self) -> List[Path]:
        """Get all artist card markdown files."""
        cards = list(self.cards_dir.glob("*.md"))
        # Filter out the connections file
        cards = [c for c in cards if c.name != "artist_connections.json"]
        self.logger.info(f"Found {len(cards)} artist cards in {self.cards_dir}")
        return sorted(cards)

    def parse_card(self, card_path: Path) -> Tuple[Optional[Dict], str]:
        """
        Parse artist card and extract frontmatter and content.

        Returns: (frontmatter_dict, full_content)
        """
        try:
            with open(card_path, 'r', encoding='utf-8') as f:
                content = f.read()

            if not content.startswith('---'):
                self.logger.warning(f"No frontmatter found in {card_path.name}")
                return None, content

            # Find frontmatter boundaries
            frontmatter_end = content.find('---', 3)
            if frontmatter_end == -1:
                self.logger.warning(f"Malformed frontmatter in {card_path.name}")
                return None, content

            frontmatter_text = content[3:frontmatter_end]
            frontmatter = yaml.safe_load(frontmatter_text)

            return frontmatter, content

        except Exception as e:
            self.logger.error(f"Error parsing {card_path.name}: {e}")
            return None, ""

    def needs_musicbrainz_enrichment(self, frontmatter: Dict) -> bool:
        """Check if card needs MusicBrainz enrichment."""
        if self.force:
            return True

        # Check if already has MusicBrainz ID
        if frontmatter.get('musicbrainz_id'):
            return False

        # Check if has any MusicBrainz-specific fields
        mb_fields = ['birth_date', 'death_date', 'gender', 'disambiguation', 'aliases']
        for field in mb_fields:
            if frontmatter.get(field):
                # Already has some MB data
                return False

        return True

    def calculate_match_confidence(self, artist: Dict[str, Any], search_name: str, spotify_genres: List[str] = None) -> int:
        """
        Calculate confidence score (0-100) for a MusicBrainz match.

        Scoring breakdown:
        - MusicBrainz search score: 0-40 points (how well MB ranked this result)
        - Name matching: 0-40 points (exact match = 40, partial = 20)
        - Genre validation: 0-20 points (keyword overlap in disambiguation)

        Perfect score (100) = ext:score 100 + exact name + genre match

        Args:
            artist: MusicBrainz artist dict
            search_name: Original search query
            spotify_genres: Optional Spotify genres for validation

        Returns:
            Confidence score (0-100)
        """
        confidence = 0

        # 1. Base score from MusicBrainz search ranking (0-40 points)
        mb_score = int(artist.get('ext:score', 0))
        confidence += (mb_score / 100) * 40

        # 2. Name matching (0-40 points)
        artist_name = artist.get('name', '').lower().strip()
        search_name_norm = search_name.lower().strip()

        if artist_name == search_name_norm:
            confidence += 40  # Exact match
        elif artist_name in search_name_norm or search_name_norm in artist_name:
            confidence += 20  # Partial match
        else:
            confidence += 0  # No match

        # 3. Genre validation via disambiguation (0-20 points)
        if spotify_genres:
            disambiguation = artist.get('disambiguation', '').lower()
            if disambiguation:
                genre_keywords = set()
                for genre in spotify_genres:
                    genre_keywords.update(genre.lower().split())

                matches = sum(1 for keyword in genre_keywords if keyword in disambiguation)
                if matches > 0:
                    confidence += min(matches * 5, 20)

        return min(int(confidence), 100)

    def find_best_musicbrainz_match(self, artist_name: str, spotify_genres: List[str] = None,
                                   min_confidence: int = MUSICBRAINZ_MIN_CONFIDENCE) -> Optional[Tuple[Dict[str, Any], int]]:
        """
        Find the best MusicBrainz match for an artist using intelligent matching with confidence scoring.

        Matching strategy:
        1. Prefer exact name matches (case-insensitive)
        2. If multiple exact matches, use Spotify genres to validate via disambiguation
        3. Calculate confidence score (0-100) based on name matching + genre overlap
        4. Reject matches below min_confidence threshold

        Args:
            artist_name: Artist name to search for
            spotify_genres: Optional list of Spotify genres for validation
            min_confidence: Minimum confidence score (0-100) to accept a match (default: 90)

        Returns:
            Tuple of (artist_dict, confidence_score) if match found with sufficient confidence,
            or None if no match or confidence too low
        """
        try:
            # Search for top 10 candidates
            result = musicbrainzngs.search_artists(artist=artist_name, limit=10)

            if not result.get('artist-list'):
                return None

            candidates = result['artist-list']

            # Phase 1: Filter for exact name matches (case-insensitive)
            normalized_search = artist_name.lower().strip()
            exact_matches = [
                artist for artist in candidates
                if artist.get('name', '').lower().strip() == normalized_search
            ]

            if exact_matches:
                candidates = exact_matches
                self.logger.debug(f"Found {len(exact_matches)} exact name matches for '{artist_name}'")

            # Phase 2: If we have multiple candidates and Spotify genres, score by genre relevance
            if len(candidates) > 1 and spotify_genres:
                genre_keywords = set()
                for genre in spotify_genres:
                    # Extract keywords from genre strings (e.g., "east coast hip hop" -> ["east", "coast", "hip", "hop"])
                    genre_keywords.update(genre.lower().split())

                scored_candidates = []
                for artist in candidates:
                    score = 0
                    disambiguation = artist.get('disambiguation', '').lower()
                    artist_type = artist.get('type', '').lower()

                    # Check for genre keyword overlap in disambiguation
                    for keyword in genre_keywords:
                        if keyword in disambiguation:
                            score += 2  # Strong signal

                    # Bonus for having disambiguation info (more detailed entry)
                    if disambiguation:
                        score += 1

                    # Type-based scoring (prefer more specific types)
                    if artist_type in ['person', 'group', 'band']:
                        score += 1

                    scored_candidates.append((score, artist))

                # Sort by score (descending)
                scored_candidates.sort(key=lambda x: x[0], reverse=True)

                # If top candidate has significantly better score, use it
                if scored_candidates[0][0] > 0:
                    best_match = scored_candidates[0][1]
                    self.logger.debug(f"Selected match with genre score {scored_candidates[0][0]}: "
                                    f"{best_match.get('name')} - {best_match.get('disambiguation', 'no disambiguation')}")
                else:
                    best_match = candidates[0]
            else:
                # Phase 3: Use first candidate (most relevant by MusicBrainz search ranking)
                best_match = candidates[0]

            # Phase 4: Calculate confidence and validate threshold
            confidence = self.calculate_match_confidence(best_match, artist_name, spotify_genres)

            if confidence < min_confidence:
                disambiguation = best_match.get('disambiguation', 'no disambiguation')
                self.logger.warning(
                    f"Low confidence match ({confidence}%) for '{artist_name}' -> "
                    f"'{best_match.get('name')}' ({disambiguation}). "
                    f"Skipping MusicBrainz enrichment (threshold: {min_confidence}%)"
                )
                return None

            self.logger.info(f"Match confidence: {confidence}% for '{best_match.get('name')}'")
            return (best_match, confidence)

        except Exception as e:
            self.logger.error(f"Error searching MusicBrainz for '{artist_name}': {e}")
            return None

    def get_musicbrainz_metadata(self, artist_name: str, spotify_genres: List[str] = None) -> Optional[Dict[str, Any]]:
        """
        Get comprehensive MusicBrainz metadata for an artist.

        Args:
            artist_name: Name of artist to search for
            spotify_genres: Optional Spotify genres for better matching

        Returns None if no match found or confidence below threshold
        """
        try:
            self.logger.info(f"Searching MusicBrainz for: {artist_name}")

            # Use improved matching logic with confidence scoring
            match_result = self.find_best_musicbrainz_match(artist_name, spotify_genres)

            if not match_result:
                self.logger.info(f"No confident MusicBrainz match for: {artist_name} (skipping enrichment)")
                return None

            artist, confidence = match_result
            mbid = artist.get('id')

            if not mbid:
                self.logger.warning(f"No MBID found for: {artist_name}")
                return None

            disambiguation = artist.get('disambiguation', '')
            if disambiguation:
                self.logger.info(f"Found MusicBrainz artist ({confidence}% confidence): {artist.get('name')} ({disambiguation}) - MBID: {mbid}")
            else:
                self.logger.info(f"Found MusicBrainz artist ({confidence}% confidence): {artist.get('name')} (MBID: {mbid})")

            # Fetch detailed artist information
            time.sleep(MUSICBRAINZ_RATE_LIMIT)
            detailed = musicbrainzngs.get_artist_by_id(
                mbid,
                includes=['artist-rels', 'recording-rels', 'aliases', 'tags', 'ratings']
            )

            artist_data = detailed.get('artist', {})

            # Extract metadata
            metadata = {
                'mbid': mbid,
                'name': artist_data.get('name', artist_name),
                'sort_name': artist_data.get('sort-name', ''),
                'artist_type': artist_data.get('type', ''),
                'gender': artist_data.get('gender', ''),
                'disambiguation': artist_data.get('disambiguation', ''),
            }

            # Extract birth/death dates
            life_span = artist_data.get('life-span', {})
            artist_type = artist_data.get('type', '').lower()

            if life_span.get('begin'):
                metadata['birth_date'] = life_span['begin']

            # Only set death_date for individuals (Person type), not groups
            # For groups, life-span.end represents disbandment, not death
            if life_span.get('end') and artist_type == 'person':
                metadata['death_date'] = life_span['end']

            # Extract origin
            if artist_data.get('area'):
                metadata['country'] = artist_data['area'].get('name', '')
            if artist_data.get('begin-area'):
                metadata['origin'] = artist_data['begin-area'].get('name', '')

            # Extract instruments
            instruments = []
            for rel in artist_data.get('artist-relation-list', []):
                if rel.get('type') == 'member of band':
                    for attr in rel.get('attribute-list', []):
                        if attr not in instruments:
                            instruments.append(attr)

            if instruments:
                metadata['instruments'] = instruments

            # Extract aliases
            aliases = []
            for alias in artist_data.get('alias-list', []):
                alias_name = alias.get('name', '')
                if alias_name and alias_name != artist_name:
                    aliases.append(alias_name)
            if aliases:
                metadata['aliases'] = aliases[:5]

            # Extract tags
            tags = []
            for tag in artist_data.get('tag-list', [])[:10]:
                tag_name = tag.get('name', '')
                if tag_name:
                    tags.append(tag_name)
            if tags:
                metadata['tags'] = tags[:3]

            # Parse members (context-aware: members for groups, associated acts for individuals)
            members, original_members = self.parse_member_relationships(artist_data, artist_type)
            if members:
                # For individuals: these are associated acts (bands they belong to)
                # For groups: these are band members
                if artist_type == 'person':
                    metadata['associated_acts'] = members
                else:
                    metadata['members'] = members
            if original_members:
                metadata['original_members'] = original_members

            # Extract collaborators
            collaborators = self.extract_collaborators(mbid)
            if collaborators:
                metadata['collaborators'] = collaborators

            self.logger.info(f"MusicBrainz metadata extracted: {len(metadata)} fields")
            return metadata

        except musicbrainzngs.NetworkError as e:
            self.logger.error(f"MusicBrainz network error for {artist_name}: {e}")
            return None
        except musicbrainzngs.ResponseError as e:
            self.logger.error(f"MusicBrainz response error for {artist_name}: {e}")
            return None
        except Exception as e:
            self.logger.error(f"Error getting MusicBrainz metadata for {artist_name}: {e}")
            return None

    def parse_member_relationships(self, artist_data: Dict, artist_type: str = '') -> Tuple[List[Dict], List[Dict]]:
        """
        Parse member and original member relationships from MusicBrainz artist data.

        Context-aware parsing based on artist type:
        - For Groups/Bands: Returns (members_list, original_members_list) - individuals who are members
        - For Individuals: Returns (associated_acts_list, []) - bands/groups they belong to

        Args:
            artist_data: MusicBrainz artist data dictionary
            artist_type: 'Person', 'Group', 'Band', etc. from MusicBrainz

        Returns: (members/associated_acts list, original_members list)
        """
        members = []
        original_members = []
        artist_type_lower = artist_type.lower()

        try:
            for rel in artist_data.get('artist-relation-list', []):
                if rel.get('type') == 'member of band':
                    member_artist = rel.get('artist', {})
                    member_name = member_artist.get('name', '')

                    if not member_name:
                        continue

                    member_info = {
                        'name': member_name,
                        'mbid': member_artist.get('id', ''),
                        'instruments': rel.get('attribute-list', []),
                        'begin': rel.get('begin', ''),
                        'end': rel.get('end', '')
                    }

                    # For individuals: These are bands/groups they're associated with (associated acts)
                    # For groups: These are individual members of the band
                    if 'person' in artist_type_lower:
                        # Individual artist - relationships are bands they belong to
                        members.append(member_info)
                        # Don't track "original_members" for individuals' associated acts
                    else:
                        # Group/Band - relationships are band members
                        members.append(member_info)

                        # Check if original member
                        if 'founder' in str(rel.get('attribute-list', [])).lower():
                            original_members.append(member_info)

            return members, original_members

        except Exception as e:
            self.logger.error(f"Error parsing member relationships: {e}")
            return [], []

    def extract_collaborators(self, mbid: str) -> List[str]:
        """Extract collaborators from recordings."""
        try:
            time.sleep(MUSICBRAINZ_RATE_LIMIT)
            recordings = musicbrainzngs.browse_recordings(artist=mbid, limit=100)

            collaborators = set()
            for recording in recordings.get('recording-list', []):
                for credit in recording.get('artist-credit', []):
                    if isinstance(credit, dict):
                        artist = credit.get('artist', {})
                        artist_name = artist.get('name', '')
                        if artist.get('id') != mbid and artist_name:
                            collaborators.add(artist_name)

            return sorted(list(collaborators))[:20]

        except Exception as e:
            self.logger.error(f"Error extracting collaborators: {e}")
            return []

    def sanitize_filename(self, name: str) -> str:
        """Sanitize artist name for filename."""
        sanitized = name.replace(' ', '_')
        sanitized = re.sub(r'[<>:"/\\|?*]', '', sanitized)
        sanitized = re.sub(r'[&]', 'and', sanitized)
        sanitized = re.sub(r'[^\w\-_.]', '', sanitized)
        return sanitized.strip('.')[:200]

    def merge_musicbrainz_into_card(self, card_path: Path, frontmatter: Dict,
                                   content: str, mb_data: Dict) -> str:
        """Merge MusicBrainz data into existing card."""
        # Update frontmatter with MB data
        if mb_data.get('mbid'):
            frontmatter['musicbrainz_id'] = mb_data['mbid']
            if 'external_urls' not in frontmatter:
                frontmatter['external_urls'] = {}
            frontmatter['external_urls']['musicbrainz'] = f"https://musicbrainz.org/artist/{mb_data['mbid']}"

        # Add structured data fields (only if not present)
        if mb_data.get('birth_date') and not frontmatter.get('birth_date'):
            frontmatter['birth_date'] = mb_data['birth_date']
        if mb_data.get('death_date') and not frontmatter.get('death_date'):
            frontmatter['death_date'] = mb_data['death_date']
        if mb_data.get('gender') and not frontmatter.get('gender'):
            frontmatter['gender'] = mb_data['gender']
        if mb_data.get('artist_type') and not frontmatter.get('artist_type'):
            frontmatter['artist_type'] = mb_data['artist_type']
        if mb_data.get('disambiguation') and not frontmatter.get('disambiguation'):
            frontmatter['disambiguation'] = mb_data['disambiguation']
        if mb_data.get('instruments') and not frontmatter.get('instruments'):
            frontmatter['instruments'] = mb_data['instruments']
        if mb_data.get('aliases') and not frontmatter.get('aliases'):
            frontmatter['aliases'] = mb_data['aliases']
        if mb_data.get('tags') and not frontmatter.get('tags'):
            frontmatter['tags'] = mb_data['tags']
        if mb_data.get('members') and not frontmatter.get('members'):
            frontmatter['members'] = mb_data['members']
        if mb_data.get('original_members') and not frontmatter.get('original_members'):
            frontmatter['original_members'] = mb_data['original_members']
        if mb_data.get('associated_acts') and not frontmatter.get('associated_acts'):
            frontmatter['associated_acts'] = mb_data['associated_acts']

        # Update origin/birth_place
        if mb_data.get('origin') and not frontmatter.get('origin') and not frontmatter.get('birth_place'):
            artist_type = mb_data.get('artist_type', '').lower()
            if 'person' in artist_type:
                frontmatter['birth_place'] = mb_data['origin']
            else:
                frontmatter['origin'] = mb_data['origin']

        # Update last_updated timestamp
        frontmatter['last_updated'] = datetime.now().isoformat()
        frontmatter['musicbrainz_enriched_at'] = datetime.now().isoformat()

        # Parse the existing content sections
        content_parts = content.split('---', 2)
        if len(content_parts) < 3:
            self.logger.error(f"Cannot parse content structure for {card_path.name}")
            return content

        markdown_content = content_parts[2]

        # Update Quick Info section with new fields
        markdown_content = self.update_quick_info(markdown_content, frontmatter, mb_data)

        # Add Members section (for groups) or Associated Acts section (for individuals) if needed
        if mb_data.get('members') or mb_data.get('associated_acts'):
            markdown_content = self.add_members_section(markdown_content, mb_data)

        # Update External Links section
        markdown_content = self.update_external_links(markdown_content, mb_data)

        # Add Tags section if needed
        if mb_data.get('tags'):
            markdown_content = self.add_tags_section(markdown_content, mb_data)

        # Rebuild the file
        frontmatter_text = yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True)
        return f"---\n{frontmatter_text}---{markdown_content}"

    def update_quick_info(self, content: str, frontmatter: Dict, mb_data: Dict) -> str:
        """Update Quick Info section with MusicBrainz data."""
        # Find Quick Info section
        quick_info_match = re.search(r'## Quick Info\n(.*?)(?=\n##|\Z)', content, re.DOTALL)
        if not quick_info_match:
            return content

        quick_info = quick_info_match.group(1)
        updated_info = quick_info

        # Add instruments (for individuals)
        artist_type = mb_data.get('artist_type', '').lower()
        if mb_data.get('instruments') and 'person' in artist_type:
            if '**Instruments**' not in quick_info:
                instruments_line = f"- **Instruments**: {', '.join(mb_data['instruments'])}\n"
                # Insert after Genres line
                updated_info = re.sub(
                    r'(- \*\*Genres\*\*:.*\n)',
                    r'\1' + instruments_line,
                    updated_info
                )

        # Add aliases
        if mb_data.get('aliases') and '**Aliases**' not in quick_info:
            aliases_line = f"- **Aliases**: {', '.join(mb_data['aliases'])}\n"
            # Insert after Instruments or Genres
            if '**Instruments**' in updated_info:
                updated_info = re.sub(
                    r'(- \*\*Instruments\*\*:.*\n)',
                    r'\1' + aliases_line,
                    updated_info
                )
            else:
                updated_info = re.sub(
                    r'(- \*\*Genres\*\*:.*\n)',
                    r'\1' + aliases_line,
                    updated_info
                )

        # Update Born/Origin with dates if available
        if mb_data.get('birth_date'):
            birth_place = frontmatter.get('birth_place', mb_data.get('origin', ''))
            if birth_place:
                new_born_line = f"- **Born**: {mb_data['birth_date']}, {birth_place}\n"
                updated_info = re.sub(
                    r'- \*\*Born\*\*:.*\n',
                    new_born_line,
                    updated_info
                )
                # If no Born line exists, add it
                if '**Born**' not in updated_info:
                    updated_info += new_born_line

        # Add death date if present
        if mb_data.get('death_date') and '**Died**' not in quick_info:
            died_line = f"- **Died**: {mb_data['death_date']}\n"
            updated_info += died_line

        # Replace in content
        return content.replace(quick_info, updated_info)

    def add_members_section(self, content: str, mb_data: Dict) -> str:
        """Add or update Members section (for groups) or Associated Acts section (for individuals)."""
        artist_type = mb_data.get('artist_type', '').lower()

        # Check if we need to convert "Members" to "Associated Acts" for individuals
        if '## Members' in content and 'person' in artist_type:
            # Individual with wrong "Members" section - needs conversion to "Associated Acts"
            content = content.replace('## Members', '## Associated Acts')
            self.logger.info("Converted '## Members' to '## Associated Acts' for individual artist")
            return content

        # Check if already has correct section
        if ('## Members' in content and 'person' not in artist_type) or '## Associated Acts' in content:
            return content

        # Find where to insert (after Fun Facts, before Musical Connections)
        insert_pos = content.find('## Musical Connections')
        if insert_pos == -1:
            insert_pos = content.find('## External Links')
        if insert_pos == -1:
            return content

        # Build section for groups (Members)
        if mb_data.get('members') and 'person' not in artist_type:
            section = "\n## Members\n"
            for member in mb_data['members']:
                member_name = member.get('name', '')
                instruments = member.get('instruments', [])
                begin = member.get('begin', '')
                end = member.get('end', '')

                sanitized_name = self.sanitize_filename(member_name)
                member_line = f"- [[{sanitized_name}|{member_name}]]"

                if instruments:
                    member_line += f" - {', '.join(instruments)}"

                if begin or end:
                    if begin and end:
                        member_line += f" (from {begin} until {end})"
                    elif begin:
                        member_line += f" (from {begin})"
                    elif end:
                        member_line += f" (until {end})"

                section += member_line + "\n"

            # Add original members if present
            if mb_data.get('original_members'):
                section += "\n### Original Members\n"
                for orig in mb_data['original_members']:
                    orig_name = orig.get('name', '')
                    orig_instruments = orig.get('instruments', [])
                    sanitized = self.sanitize_filename(orig_name)
                    line = f"- [[{sanitized}|{orig_name}]]"
                    if orig_instruments:
                        line += f" - {', '.join(orig_instruments)}"
                    section += line + "\n"

            # Insert section
            return content[:insert_pos] + section + "\n" + content[insert_pos:]

        # Build section for individuals (Associated Acts)
        elif mb_data.get('associated_acts') and 'person' in artist_type:
            section = "\n## Associated Acts\n"
            for act in mb_data['associated_acts']:
                act_name = act.get('name', '')
                instruments = act.get('instruments', [])
                begin = act.get('begin', '')
                end = act.get('end', '')

                sanitized_name = self.sanitize_filename(act_name)
                act_line = f"- [[{sanitized_name}|{act_name}]]"

                if instruments:
                    act_line += f" - {', '.join(instruments)}"

                if begin or end:
                    if begin and end:
                        act_line += f" ({begin}–{end})"
                    elif begin:
                        act_line += f" ({begin}–present)"
                    elif end:
                        act_line += f" (until {end})"

                section += act_line + "\n"

            # Insert section
            return content[:insert_pos] + section + "\n" + content[insert_pos:]

        return content

    def update_external_links(self, content: str, mb_data: Dict) -> str:
        """Add MusicBrainz link to External Links section."""
        if not mb_data.get('mbid'):
            return content

        mb_url = f"https://musicbrainz.org/artist/{mb_data['mbid']}"
        mb_link = f"- [MusicBrainz]({mb_url})\n"

        # Find External Links section
        if '## External Links' in content:
            # Check if MusicBrainz already there
            if 'MusicBrainz' in content:
                return content

            # Add before the closing or next section
            insert_pos = content.find('## External Links')
            section_end = content.find('\n## ', insert_pos + 1)
            if section_end == -1:
                section_end = content.find('\n---', insert_pos + 1)
            if section_end == -1:
                section_end = len(content)

            # Insert before section end
            return content[:section_end] + mb_link + content[section_end:]

        return content

    def add_tags_section(self, content: str, mb_data: Dict) -> str:
        """Add Tags section at the bottom."""
        if '**Tags**:' in content:
            return content  # Already has tags

        tags = mb_data.get('tags', [])
        if not tags:
            return content

        tag_string = ', '.join([f"#{tag.replace(' ', '-').replace('/', '-')}" for tag in tags])
        tags_section = f"\n---\n**Tags**: {tag_string}\n"

        # Add at the very end
        return content.rstrip() + tags_section

    def process_card(self, card_path: Path) -> str:
        """Process a single artist card."""
        try:
            self.logger.info(f"Processing: {card_path.name}")

            # Parse card
            frontmatter, content = self.parse_card(card_path)
            if not frontmatter:
                self.stats['errors'] += 1
                return "❌ Parse error"

            # Check if needs enrichment
            if not self.needs_musicbrainz_enrichment(frontmatter):
                self.stats['skipped_has_mb'] += 1
                return "⏭️  Already has MB data"

            # Get artist name and genres (for better matching)
            artist_name = frontmatter.get('title', card_path.stem.replace('_', ' '))
            spotify_genres = frontmatter.get('genres', [])

            # Get MusicBrainz data
            mb_data = self.get_musicbrainz_metadata(artist_name, spotify_genres)
            if not mb_data:
                self.stats['skipped_no_mb_data'] += 1
                return "⚠️  No MB data found"

            time.sleep(MUSICBRAINZ_RATE_LIMIT)

            # Merge data into card
            updated_content = self.merge_musicbrainz_into_card(card_path, frontmatter, content, mb_data)

            # Write updated card
            if not self.dry_run:
                with open(card_path, 'w', encoding='utf-8') as f:
                    f.write(updated_content)
                self.logger.info(f"Updated: {card_path.name}")
            else:
                self.logger.info(f"[DRY RUN] Would update: {card_path.name}")

            self.stats['updated'] += 1
            return "✅ Updated"

        except Exception as e:
            self.logger.error(f"Error processing {card_path.name}: {e}")
            self.stats['errors'] += 1
            return f"❌ Error: {str(e)[:30]}"

    def run(self, limit: Optional[int] = None):
        """Run the backfill process."""
        cards = self.get_all_artist_cards()
        self.stats['total'] = len(cards)

        if limit:
            cards = cards[:limit]
            self.logger.info(f"Limited to first {limit} cards")

        print(f"\n🎵 MusicBrainz Backfill Process")
        print(f"Cards directory: {self.cards_dir}")
        print(f"Total cards: {self.stats['total']}")
        print(f"Processing: {len(cards)} cards")
        if self.dry_run:
            print("🔍 DRY RUN MODE - No files will be modified")
        if self.force:
            print("⚡ FORCE MODE - Re-processing cards that already have MB data")
        print()

        from tqdm import tqdm

        with tqdm(cards, desc="Processing cards", unit="card") as pbar:
            for card_path in pbar:
                pbar.set_description(f"Processing: {card_path.stem[:30]}")

                status = self.process_card(card_path)
                pbar.set_postfix_str(status)
                self.stats['processed'] += 1

                time.sleep(0.1)

        # Print summary
        self.print_summary()

    def print_summary(self):
        """Print processing summary."""
        print(f"\n📊 Backfill Summary:")
        print(f"✅ Updated: {self.stats['updated']} cards")
        print(f"⏭️  Skipped (has MB data): {self.stats['skipped_has_mb']}")
        print(f"⚠️  Skipped (no MB data found): {self.stats['skipped_no_mb_data']}")
        print(f"❌ Errors: {self.stats['errors']}")
        print(f"📁 Total processed: {self.stats['processed']}/{self.stats['total']}")

        if self.stats['processed'] > 0:
            success_rate = (self.stats['updated'] / self.stats['processed'] * 100)
            print(f"\n🎯 Update rate: {success_rate:.1f}%")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Backfill existing artist cards with MusicBrainz metadata"
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
        '--force',
        action='store_true',
        help='Re-process cards that already have MusicBrainz data'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Limit processing to first N cards (for testing)'
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
        # Create backfiller and run
        backfiller = MusicBrainzBackfiller(
            cards_dir=args.cards_dir,
            dry_run=args.dry_run,
            force=args.force
        )

        backfiller.run(limit=args.limit)

        print("\n✅ Backfill completed successfully")

    except KeyboardInterrupt:
        print("\n\n⏹️  Process interrupted by user")
        sys.exit(1)
    except Exception as e:
        logging.error(f"Fatal error: {e}")
        print(f"\n❌ Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
