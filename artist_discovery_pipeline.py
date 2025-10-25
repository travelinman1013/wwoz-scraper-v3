#!/usr/bin/env python3
"""
Artist Discovery Pipeline - Consolidated WWOZ Archive Processor

This script consolidates three separate workflows into one streamlined pipeline:
1. Parse WWOZ markdown archive for artist names
2. Check if artist card exists in Obsidian vault
3. If new or missing enhancement:
   - Get Spotify metadata (genres, followers, popularity, image URL)
   - Research with Perplexity AI (biography, musical connections)
   - Download high-res artist image
   - Build/update artist card with merged data
   - Update artist connections network

Architecture:
- Hybrid approach: Spotify for metadata, Perplexity for content
- Atomic operations: Each artist fully succeeds or fully skips
- Smart updates: Only enhance cards missing Perplexity data
- Rate limiting: Respects all API limits
- Network graph: Maintains artist_connections.json

Usage:
    python artist_discovery_pipeline.py --archive path/to/wwoz_archive.md [--force] [--dry-run]
"""

import os
import re
import sys
import json
import time
import logging
import argparse
import requests
import base64
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional, Tuple, Any
from urllib.parse import quote

import yaml
from openai import OpenAI
from tqdm import tqdm
import musicbrainzngs

# Configuration
SPOTIFY_CLIENT_ID = "a088edf333334899b6ad55579b834389"
SPOTIFY_CLIENT_SECRET = "78b5d889d9094ff0bb0b2a22cc8cfaac"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search"
SPOTIFY_ARTIST_URL = "https://api.spotify.com/v1/artists"

PERPLEXITY_API_BASE = "https://api.perplexity.ai"
PERPLEXITY_MODEL = "sonar-pro"
PERPLEXITY_TEMPERATURE = 0.3
PERPLEXITY_MAX_TOKENS = 4096

# Default vault paths
DEFAULT_CARDS_DIR = "/Users/maxwell/LETSGO/MaxVault/01_Projects/PersonalArtistWiki/Artists"
DEFAULT_IMAGES_DIR = "/Users/maxwell/LETSGO/MaxVault/03_Resources/source_material/ArtistPortraits"
CONNECTIONS_FILE = "artist_connections.json"

# Rate limiting
SPOTIFY_RATE_LIMIT = 0.6  # seconds
PERPLEXITY_RATE_LIMIT = 2.0  # seconds
MUSICBRAINZ_RATE_LIMIT = 1.0  # seconds (required: 1 request/second)
REQUEST_TIMEOUT = 30

# MusicBrainz Configuration
MUSICBRAINZ_APP_NAME = "WWOZ-Artist-Discovery-Pipeline"
MUSICBRAINZ_APP_VERSION = "1.0"
MUSICBRAINZ_CONTACT = "wwoz-scraper@example.com"
MUSICBRAINZ_MIN_CONFIDENCE = 80  # Minimum confidence (0-100) to accept a match


class ArtistDiscoveryPipeline:
    """Main pipeline for discovering and processing new artists from WWOZ archives."""

    def __init__(self, cards_dir: str, images_dir: str, dry_run: bool = False, force: bool = False):
        self.cards_dir = Path(cards_dir)
        self.images_dir = Path(images_dir)
        self.dry_run = dry_run
        self.force = force

        # Create directories if they don't exist
        self.cards_dir.mkdir(parents=True, exist_ok=True)
        self.images_dir.mkdir(parents=True, exist_ok=True)

        # Initialize components
        self.session = requests.Session()
        self.spotify_token = None
        self.spotify_token_expires_at = 0
        self.perplexity_client = None

        # Initialize MusicBrainz
        musicbrainzngs.set_useragent(MUSICBRAINZ_APP_NAME, MUSICBRAINZ_APP_VERSION, MUSICBRAINZ_CONTACT)

        # Load connections database
        self.connections_file = self.cards_dir / CONNECTIONS_FILE
        self.connections_db = self._load_connections()

        # Statistics
        self.stats = {
            'total': 0,
            'processed': 0,
            'skipped_existing': 0,
            'skipped_perplexity': 0,  # Skipped due to already having Perplexity enhancement
            'skipped_duplicate': 0,  # Skipped due to finding case variant
            'enhanced': 0,
            'created': 0,
            'errors': 0,
            'connections_found': 0
        }

        # Setup logging
        self.setup_logging()

    def setup_logging(self):
        """Configure logging for the pipeline."""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.StreamHandler(sys.stdout),
                logging.FileHandler('artist_discovery_pipeline.log')
            ]
        )
        self.logger = logging.getLogger(__name__)

        # Suppress musicbrainzngs verbose logging (uncaught attribute messages)
        logging.getLogger('musicbrainzngs').setLevel(logging.WARNING)

    def _load_connections(self) -> Dict[str, Any]:
        """Load existing connections database or create new one."""
        if self.connections_file.exists():
            try:
                with open(self.connections_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                self.logger.warning(f"Could not load connections file: {e}")
        return {}

    def _save_connections(self) -> None:
        """Save connections database to file."""
        if not self.dry_run:
            try:
                with open(self.connections_file, 'w', encoding='utf-8') as f:
                    json.dump(self.connections_db, f, indent=2, ensure_ascii=False)
                self.logger.info(f"Saved connections database with {len(self.connections_db)} artists")
            except Exception as e:
                self.logger.error(f"Error saving connections: {e}")

    # === SPOTIFY API METHODS ===

    def authenticate_spotify(self) -> bool:
        """Authenticate with Spotify using Client Credentials flow."""
        try:
            credentials = f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}"
            encoded_credentials = base64.b64encode(credentials.encode()).decode()

            headers = {
                "Authorization": f"Basic {encoded_credentials}",
                "Content-Type": "application/x-www-form-urlencoded"
            }

            data = {"grant_type": "client_credentials"}

            response = self.session.post(
                SPOTIFY_TOKEN_URL,
                headers=headers,
                data=data,
                timeout=REQUEST_TIMEOUT
            )

            if response.status_code == 200:
                token_data = response.json()
                self.spotify_token = token_data["access_token"]
                expires_in = token_data.get("expires_in", 3600)
                self.spotify_token_expires_at = time.time() + expires_in - 60

                self.logger.info("Successfully authenticated with Spotify API")
                return True
            else:
                self.logger.error(f"Failed to authenticate with Spotify: {response.status_code}")
                return False

        except Exception as e:
            self.logger.error(f"Exception during Spotify authentication: {e}")
            return False

    def ensure_spotify_authenticated(self) -> bool:
        """Ensure we have a valid Spotify access token."""
        if not self.spotify_token or time.time() >= self.spotify_token_expires_at:
            return self.authenticate_spotify()
        return True

    def get_spotify_metadata(self, artist_name: str) -> Optional[Dict[str, Any]]:
        """
        Get comprehensive Spotify metadata for an artist.

        Returns dict with: artist_id, name, genres, popularity, followers, spotify_url, image_url
        """
        if not self.ensure_spotify_authenticated():
            return None

        try:
            headers = {
                "Authorization": f"Bearer {self.spotify_token}",
                "Content-Type": "application/json"
            }

            # Search for artist
            query = quote(artist_name)
            url = f"{SPOTIFY_SEARCH_URL}?q={query}&type=artist&limit=10"

            response = self.session.get(url, headers=headers, timeout=REQUEST_TIMEOUT)

            if response.status_code == 200:
                data = response.json()
                artists = data.get('artists', {}).get('items', [])

                if artists:
                    artist = artists[0]

                    # Get image URL
                    image_url = None
                    if artist.get('images'):
                        image_url = artist['images'][0]['url']

                    metadata = {
                        'artist_id': artist['id'],
                        'name': artist['name'],
                        'genres': artist.get('genres', []),
                        'popularity': artist.get('popularity', 0),
                        'followers': artist.get('followers', {}).get('total', 0),
                        'spotify_url': artist.get('external_urls', {}).get('spotify', ''),
                        'image_url': image_url
                    }

                    self.logger.info(f"Found Spotify artist: {artist['name']} (ID: {artist['id']})")
                    return metadata
                else:
                    self.logger.warning(f"No Spotify artist found for: {artist_name}")
                    return None

            elif response.status_code == 401:
                self.logger.warning("Spotify token expired, re-authenticating...")
                if self.authenticate_spotify():
                    return self.get_spotify_metadata(artist_name)
                return None

            else:
                self.logger.error(f"Spotify API error for {artist_name}: {response.status_code}")
                return None

        except Exception as e:
            self.logger.error(f"Error getting Spotify metadata for {artist_name}: {e}")
            return None

    def download_artist_image(self, image_url: str, artist_name: str) -> Optional[str]:
        """
        Download artist image and return relative path for Obsidian.

        Returns: Relative path string like "03_Resources/source_material/ArtistPortraits/Artist_Name.jpg"
        """
        try:
            sanitized_name = self.sanitize_filename(artist_name)

            # Check if image already exists
            for ext in ['.jpg', '.jpeg', '.png', '.webp']:
                image_path = self.images_dir / f"{sanitized_name}{ext}"
                if image_path.exists():
                    self.logger.info(f"Image already exists: {image_path}")
                    return f"03_Resources/source_material/ArtistPortraits/{sanitized_name}{ext}"

            if self.dry_run:
                self.logger.info(f"[DRY RUN] Would download image for: {artist_name}")
                return f"03_Resources/source_material/ArtistPortraits/{sanitized_name}.jpg"

            # Download new image
            response = self.session.get(image_url, timeout=REQUEST_TIMEOUT, stream=True)

            if response.status_code == 200:
                content_type = response.headers.get('content-type', '')
                if 'jpeg' in content_type or 'jpg' in content_type:
                    extension = '.jpg'
                elif 'png' in content_type:
                    extension = '.png'
                elif 'webp' in content_type:
                    extension = '.webp'
                else:
                    extension = '.jpg'

                file_path = self.images_dir / f"{sanitized_name}{extension}"

                with open(file_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)

                self.logger.info(f"Downloaded image: {file_path}")
                return f"03_Resources/source_material/ArtistPortraits/{sanitized_name}{extension}"
            else:
                self.logger.error(f"Failed to download image from {image_url}: {response.status_code}")
                return None

        except Exception as e:
            self.logger.error(f"Error downloading image for {artist_name}: {e}")
            return None

    # === MUSICBRAINZ API METHODS ===

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
        # MB returns 'ext:score' in search results (0-100)
        mb_score = int(artist.get('ext:score', 0))
        confidence += (mb_score / 100) * 40  # Normalize to 0-40

        # 2. Name matching (0-40 points)
        artist_name = artist.get('name', '').lower().strip()
        search_name_norm = search_name.lower().strip()

        if artist_name == search_name_norm:
            # Exact match
            confidence += 40
        elif artist_name in search_name_norm or search_name_norm in artist_name:
            # Partial match (e.g., "The Band" matches "ALEX LEACH BAND")
            confidence += 20
        else:
            # No direct name match - likely wrong artist
            confidence += 0

        # 3. Genre validation via disambiguation (0-20 points)
        if spotify_genres:
            disambiguation = artist.get('disambiguation', '').lower()
            if disambiguation:
                genre_keywords = set()
                for genre in spotify_genres:
                    genre_keywords.update(genre.lower().split())

                # Count keyword matches
                matches = sum(1 for keyword in genre_keywords if keyword in disambiguation)
                if matches > 0:
                    confidence += min(matches * 5, 20)  # Up to 20 points (4+ matches = max)

        return min(int(confidence), 100)  # Cap at 100

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

        Returns dict with: mbid, birth_date, death_date, origin, instruments, aliases,
                          tags, members, original_members, collaborators, artist_type, gender

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

            # Fetch detailed artist information with relationships
            time.sleep(MUSICBRAINZ_RATE_LIMIT)
            detailed = musicbrainzngs.get_artist_by_id(
                mbid,
                includes=['artist-rels', 'recording-rels', 'aliases', 'tags', 'ratings']
            )

            artist_data = detailed.get('artist', {})

            # Extract basic metadata
            metadata = {
                'mbid': mbid,
                'name': artist_data.get('name', artist_name),
                'sort_name': artist_data.get('sort-name', ''),
                'artist_type': artist_data.get('type', ''),  # Person, Group, Orchestra, etc.
                'gender': artist_data.get('gender', ''),  # Male, Female, Other, Not applicable
                'disambiguation': artist_data.get('disambiguation', ''),
            }

            # Extract birth/death dates from life-span
            life_span = artist_data.get('life-span', {})
            artist_type = artist_data.get('type', '').lower()

            if life_span.get('begin'):
                metadata['birth_date'] = life_span['begin']

            # Only set death_date for individuals (Person type), not groups
            # For groups, life-span.end represents disbandment, not death
            if life_span.get('end') and artist_type == 'person':
                metadata['death_date'] = life_span['end']

            # Extract origin/birth place
            if artist_data.get('area'):
                metadata['country'] = artist_data['area'].get('name', '')
            if artist_data.get('begin-area'):
                metadata['origin'] = artist_data['begin-area'].get('name', '')

            # Extract instruments (for Person type)
            instruments = []
            for rel in artist_data.get('artist-relation-list', []):
                if rel.get('type') == 'member of band':
                    # Extract instruments from attributes
                    for attr in rel.get('attribute-list', []):
                        if attr not in instruments:
                            instruments.append(attr)

            # Also check recording relations for instruments
            for rel in artist_data.get('recording-relation-list', []):
                for attr in rel.get('attribute-list', []):
                    if attr not in instruments and ('vocal' in attr.lower() or 'guitar' in attr.lower() or 'piano' in attr.lower()):
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
                metadata['aliases'] = aliases[:5]  # Limit to 5 most relevant

            # Extract tags (top 3 genre tags)
            tags = []
            for tag in artist_data.get('tag-list', [])[:10]:  # Get top 10
                tag_name = tag.get('name', '')
                if tag_name:
                    tags.append(tag_name)
            if tags:
                metadata['tags'] = tags[:3]  # Top 3 for display

            # Parse member relationships (context-aware: members for groups, associated acts for individuals)
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

            # Extract collaborators from recordings
            collaborators = self.extract_collaborators_from_musicbrainz(mbid)
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

    def parse_member_relationships(self, artist_data: Dict[str, Any], artist_type: str = '') -> Tuple[List[Dict], List[Dict]]:
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

                    # Extract time period
                    begin = rel.get('begin', '')
                    end = rel.get('end', '')

                    # Extract instruments/roles from attributes
                    instruments_roles = rel.get('attribute-list', [])

                    # Build member/associated act info
                    member_info = {
                        'name': member_name,
                        'mbid': member_artist.get('id', ''),
                        'instruments': instruments_roles if instruments_roles else [],
                        'begin': begin,
                        'end': end
                    }

                    # For individuals: These are bands/groups they're associated with (associated acts)
                    # For groups: These are individual members of the band
                    if 'person' in artist_type_lower:
                        # Individual artist - relationships are bands they belong to
                        members.append(member_info)
                        # Don't track "original_members" for individuals' associated acts
                    else:
                        # Group/Band - relationships are band members
                        # Determine if original member
                        if 'original' in str(rel.get('attribute-list', [])).lower() or not end or end == '':
                            members.append(member_info)
                            # Also add to original if founding member
                            if 'founder' in str(rel.get('attribute-list', [])).lower() or (begin and not end):
                                original_members.append(member_info)
                        else:
                            members.append(member_info)

            return members, original_members

        except Exception as e:
            self.logger.error(f"Error parsing member relationships: {e}")
            return [], []

    def extract_collaborators_from_musicbrainz(self, mbid: str) -> List[str]:
        """
        Extract unique collaborator names from artist's recording appearances.

        Returns: List of unique collaborator artist names (deduplicated)
        """
        try:
            # Get artist's recordings with artist credits
            time.sleep(MUSICBRAINZ_RATE_LIMIT)

            # Browse recordings by artist
            recordings = musicbrainzngs.browse_recordings(artist=mbid, limit=100)

            collaborators = set()

            for recording in recordings.get('recording-list', []):
                # Check artist-credit for collaborations
                for credit in recording.get('artist-credit', []):
                    if isinstance(credit, dict):
                        artist = credit.get('artist', {})
                        artist_name = artist.get('name', '')

                        # Skip if it's the same artist
                        if artist.get('id') != mbid and artist_name:
                            collaborators.add(artist_name)

            self.logger.info(f"Found {len(collaborators)} unique collaborators from MusicBrainz")
            return sorted(list(collaborators))[:20]  # Limit to top 20

        except Exception as e:
            self.logger.error(f"Error extracting collaborators from MusicBrainz: {e}")
            return []

    def deduplicate_collaborators(self, mb_collaborators: List[str],
                                 perplexity_collaborators: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Merge and deduplicate collaborators from MusicBrainz and Perplexity sources.

        Returns: Deduplicated list of collaborator dicts with wikilink format
        """
        try:
            # Normalize function for comparison
            def normalize(name: str) -> str:
                return name.lower().strip().replace('.', '').replace(',', '')

            # Build set of normalized names from Perplexity (already have details)
            perplexity_names = set()
            result = []

            # Add Perplexity collaborators first (they have context)
            for collab in perplexity_collaborators:
                if isinstance(collab, dict):
                    name = collab.get('name', '')
                    if name:
                        perplexity_names.add(normalize(name))
                        result.append(collab)

            # Add MusicBrainz collaborators if not already in list
            for mb_name in mb_collaborators:
                normalized = normalize(mb_name)
                if normalized not in perplexity_names:
                    # Add as simple collaborator dict
                    result.append({
                        'name': mb_name,
                        'context': 'Collaborated on recordings',
                        'specific_works': '',
                        'time_period': '',
                        'source': 'musicbrainz'
                    })
                    perplexity_names.add(normalized)

            self.logger.info(f"Deduplicated collaborators: {len(result)} total ({len(perplexity_collaborators)} from Perplexity, {len(mb_collaborators)} from MusicBrainz)")
            return result

        except Exception as e:
            self.logger.error(f"Error deduplicating collaborators: {e}")
            return perplexity_collaborators

    # === PERPLEXITY API METHODS ===

    def initialize_perplexity(self) -> bool:
        """Initialize Perplexity API client."""
        if self.dry_run:
            self.logger.info("[DRY RUN] Skipping Perplexity initialization")
            return True

        try:
            api_key = os.getenv('PERPLEXITY_API_KEY')
            if not api_key:
                self.logger.error("PERPLEXITY_API_KEY environment variable is required")
                return False

            self.perplexity_client = OpenAI(
                api_key=api_key,
                base_url=PERPLEXITY_API_BASE
            )
            self.logger.info(f"Initialized Perplexity client with model: {PERPLEXITY_MODEL}")
            return True

        except Exception as e:
            self.logger.error(f"Error initializing Perplexity: {e}")
            return False

    def research_with_perplexity(self, artist_name: str, spotify_metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Research artist using Perplexity AI web search.

        Returns dict with: biography, connections, fun_facts, sources, wikipedia_url, location_full, entity_type
        """
        if self.dry_run:
            mock_biography = f"""**{artist_name}** is a renowned musical artist known for their contributions to {', '.join(spotify_metadata.get('genres', ['music'])[:2])}. Throughout their career, they have established themselves as a significant figure in the music industry."""

            return {
                'success': True,
                'biography': mock_biography,
                'connections': {
                    'mentors': [],
                    'collaborators': [],
                    'influenced': []
                },
                'fun_facts': ["Pioneering artist in their genre", "Recorded numerous acclaimed albums"],
                'sources': ["Wikipedia", "AllMusic"],
                'wikipedia_url': f"https://en.wikipedia.org/wiki/{artist_name.replace(' ', '_')}",
                'location_full': "United States",
                'entity_type': "individual"
            }

        try:
            # Extract Spotify context
            top_tracks = spotify_metadata.get('top_tracks', [])[:3] if 'top_tracks' in spotify_metadata else []
            genres = spotify_metadata.get('genres', [])

            # Build research prompt
            research_prompt = f"""Research the musical artist "{artist_name}" and provide comprehensive biographical information.

CONTEXT FROM SPOTIFY:
- Genres: {', '.join(genres) if genres else 'Unknown'}
- Popularity: {spotify_metadata.get('popularity', 'Unknown')}

REQUIRED INFORMATION:
1. **Biography**: 2-3 flowing paragraphs covering early life, career development, musical style, and legacy

2. **Musical Connections** (be specific and accurate):
   - **Mentors/Influences**: Teachers, inspirations, stylistic influences
   - **Key Collaborators**: Band members, frequent collaborators
   - **Artists Influenced**: Students, proteges, inspired musicians

3. **Fun Facts**: 3-4 interesting anecdotes or lesser-known details

4. **Sources**: Note Wikipedia URL if available

RESPONSE FORMAT (JSON):
{{
  "biography": "2-3 paragraph biography text...",
  "connections": {{
    "mentors": [
      {{"name": "Artist Name", "context": "relationship description", "specific_works": "albums/projects", "time_period": "years"}}
    ],
    "collaborators": [
      {{"name": "Artist Name", "context": "nature of collaboration", "specific_works": "albums/bands", "time_period": "years"}}
    ],
    "influenced": [
      {{"name": "Artist Name", "context": "how they were influenced", "specific_works": "relevant works", "time_period": "years"}}
    ]
  }},
  "fun_facts": ["fact 1", "fact 2", "fact 3"],
  "wikipedia_url": "URL if found",
  "sources": ["source1", "source2"],
  "location_full": "City, State/Region, Country (birthplace for individuals, origin for bands/groups)",
  "entity_type": "individual" or "band" or "group"
}}

Only include verified information from credible sources."""

            self.logger.info(f"Researching artist with Perplexity: {artist_name}")

            response = self.perplexity_client.chat.completions.create(
                model=PERPLEXITY_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert music researcher with access to web search. Provide accurate, well-researched information. Always respond with valid JSON only."
                    },
                    {
                        "role": "user",
                        "content": research_prompt
                    }
                ],
                temperature=PERPLEXITY_TEMPERATURE,
                max_tokens=PERPLEXITY_MAX_TOKENS
            )

            # Parse JSON response
            if not response or not hasattr(response, 'choices') or not response.choices:
                self.logger.error(f"Invalid Perplexity response for {artist_name}")
                return None

            response_text = response.choices[0].message.content.strip()

            # Clean and parse JSON
            if response_text.startswith('```json'):
                response_text = response_text.replace('```json', '').replace('```', '').strip()
            elif response_text.startswith('```'):
                response_text = response_text.replace('```', '').strip()

            research_data = json.loads(response_text)

            # Add confidence scores to connections
            for conn_type in ['mentors', 'collaborators', 'influenced']:
                if conn_type in research_data.get('connections', {}):
                    for connection in research_data['connections'][conn_type]:
                        if 'confidence' not in connection:
                            connection['confidence'] = 0.95

            self.logger.info(f"Research successful: {len(research_data.get('biography', ''))} chars biography")

            return {
                'success': True,
                **research_data
            }

        except Exception as e:
            self.logger.error(f"Error researching with Perplexity for {artist_name}: {e}")
            return None

    # === HELPER METHODS ===

    def parse_archive(self, archive_path: str) -> List[str]:
        """Parse WWOZ markdown archive and extract artist names."""
        try:
            with open(archive_path, 'r', encoding='utf-8') as file:
                content = file.read()

            lines = content.split('\n')
            found_artists = []

            for line in lines:
                line = line.strip()

                if not line:
                    continue

                # Check if this is a table row (starts with |)
                if line.startswith('|') and '|' in line[1:]:
                    columns = [col.strip() for col in line.split('|')]

                    # Skip header rows and separator rows
                    if len(columns) >= 9 and columns[1] not in ['Time', ':----', '']:
                        artist = columns[2].strip()
                        status = columns[8].strip()

                        # Check if status is "✅ Found"
                        if status == "✅ Found" and artist:
                            found_artists.append(artist)
                            self.logger.debug(f"Found artist: {artist}")

            self.logger.info(f"Parsed {len(found_artists)} artists from {archive_path}")
            return found_artists

        except Exception as e:
            self.logger.error(f"Failed to parse archive file {archive_path}: {e}")
            return []

    def sanitize_filename(self, name: str) -> str:
        """
        Sanitize artist name for use as filename with normalization.

        Converts to lowercase first to prevent duplicates like:
        - "DR. JOHN" -> "dr_john.md"
        - "Dr. John" -> "dr_john.md"
        - "dr john" -> "dr_john.md"
        """
        # Normalize to lowercase first to prevent case-based duplicates
        sanitized = name.lower()

        # Replace spaces with underscores
        sanitized = sanitized.replace(' ', '_')

        # Remove or replace special characters
        sanitized = re.sub(r'[<>:"/\\|?*]', '', sanitized)
        sanitized = re.sub(r'[&]', 'and', sanitized)
        sanitized = re.sub(r'[^\w\-_.]', '', sanitized)

        # Trim length if needed
        if len(sanitized) > 200:
            sanitized = sanitized[:200]

        return sanitized.strip('.')

    def find_existing_card(self, artist_name: str) -> Tuple[bool, Optional[Path], Optional[str]]:
        """
        Find existing artist card with fuzzy matching to catch duplicates.

        Returns:
            (exists, card_path, match_type) where match_type is:
            - "exact": Exact normalized filename match
            - "case_variant": Found a case variation (e.g., "DR._JOHN.md" when looking for "dr_john")
            - None: No match found
        """
        sanitized_name = self.sanitize_filename(artist_name)
        exact_path = self.cards_dir / f"{sanitized_name}.md"

        # Check for exact match first
        if exact_path.exists():
            return True, exact_path, "exact"

        # Check for case variations and punctuation differences
        # This catches existing files like "DR._JOHN.md" or "D'Angelo.md" when looking for "dr_john" or "dangelo"
        if self.cards_dir.exists():
            # Normalize the search name for comparison - remove ALL non-alphanumeric characters
            normalized_search = re.sub(r'[^a-z0-9]', '', sanitized_name.lower())

            for existing_file in self.cards_dir.glob("*.md"):
                # Normalize existing filename for comparison - remove ALL non-alphanumeric characters
                existing_normalized = re.sub(r'[^a-z0-9]', '', existing_file.stem.lower())

                if existing_normalized == normalized_search:
                    self.logger.info(f"Found case/punctuation variant: {existing_file.name} matches {artist_name}")
                    return True, existing_file, "case_variant"

        return False, None, None

    def card_exists(self, artist_name: str) -> Tuple[bool, Optional[Path]]:
        """Check if artist card exists in vault (uses find_existing_card internally)."""
        exists, card_path, _ = self.find_existing_card(artist_name)
        return exists, card_path

    def has_perplexity_enhancement(self, card_path: Path) -> bool:
        """
        Check if card has already been enhanced with Perplexity AI.

        This is a strict check - if Perplexity ran once, we never run it again
        (unless --force flag is used). This prevents expensive duplicate API calls.

        Returns:
            True if card has 'enhancement_provider: perplexity' in frontmatter
            False otherwise
        """
        try:
            with open(card_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Check for Perplexity enhancement marker in frontmatter
            if content.startswith('---'):
                frontmatter_end = content.find('---', 3)
                if frontmatter_end != -1:
                    frontmatter_text = content[3:frontmatter_end]
                    frontmatter = yaml.safe_load(frontmatter_text)

                    # Strict check: has Perplexity marker?
                    if frontmatter and frontmatter.get('enhancement_provider') == 'perplexity':
                        return True

            return False

        except Exception as e:
            self.logger.error(f"Error checking Perplexity enhancement status for {card_path}: {e}")
            return False  # Assume not enhanced on error, will attempt processing

    def should_skip_processing(self, card_path: Path) -> Tuple[bool, str]:
        """
        Comprehensive quality check to determine if artist card should be skipped.

        This prevents reprocessing artists that are already fully enhanced,
        saving expensive Perplexity API calls and processing time.

        Returns:
            (should_skip, reason) tuple where:
            - should_skip: True if processing should be skipped
            - reason: Human-readable explanation
        """
        try:
            with open(card_path, 'r', encoding='utf-8') as f:
                content = f.read()

            if not content.startswith('---'):
                return False, "No frontmatter found"

            frontmatter_end = content.find('---', 3)
            if frontmatter_end == -1:
                return False, "Malformed frontmatter"

            frontmatter_text = content[3:frontmatter_end]
            frontmatter_data = yaml.safe_load(frontmatter_text)

            if not frontmatter_data:
                return False, "Empty frontmatter"

            # Quality check 1: Has Perplexity enhancement?
            if frontmatter_data.get('enhancement_provider') != 'perplexity':
                return False, "Not enhanced with Perplexity"

            # Quality check 2: Has valid enhancement timestamp?
            if not frontmatter_data.get('biography_enhanced_at'):
                return False, "Missing enhancement timestamp"

            # Quality check 3: Has Spotify data?
            spotify_data = frontmatter_data.get('spotify_data', {})
            if not spotify_data or not spotify_data.get('id'):
                return False, "Missing Spotify data"

            # Quality check 4: Has musical connections?
            musical_connections = frontmatter_data.get('musical_connections', {})
            has_connections = (
                bool(musical_connections.get('mentors')) or
                bool(musical_connections.get('collaborators')) or
                bool(musical_connections.get('influenced'))
            )

            # Quality check 5: Check biography content in body
            body_content = content[frontmatter_end + 3:].strip()
            has_biography = '## Biography' in body_content and len(body_content) > 500

            if not has_biography:
                return False, "Biography section incomplete or missing"

            # Quality check 6: Has external URLs?
            external_urls = frontmatter_data.get('external_urls', {})
            has_urls = bool(external_urls.get('spotify'))

            # All quality checks passed
            if has_connections and has_urls and has_biography:
                enhancement_date = frontmatter_data.get('biography_enhanced_at', 'unknown')
                return True, f"Complete and enhanced (last: {enhancement_date[:10]})"

            # Partial pass - has Perplexity but missing some data
            missing = []
            if not has_connections:
                missing.append("connections")
            if not has_urls:
                missing.append("URLs")

            return False, f"Incomplete: missing {', '.join(missing)}"

        except Exception as e:
            self.logger.error(f"Error in quality check for {card_path}: {e}")
            return False, f"Quality check error: {str(e)[:50]}"

    def build_artist_card(self, artist_name: str, spotify_data: Dict[str, Any],
                         musicbrainz_data: Dict[str, Any], perplexity_data: Dict[str, Any],
                         image_path: str) -> str:
        """Build complete artist card markdown with merged data from Spotify, MusicBrainz, and Perplexity."""
        # Extract Spotify data
        genres = spotify_data.get('genres', [])
        popularity = spotify_data.get('popularity', 0)
        followers = spotify_data.get('followers', 0)
        spotify_url = spotify_data.get('spotify_url', '')

        # Extract Perplexity data
        biography = perplexity_data.get('biography', '')
        connections = perplexity_data.get('connections', {})
        fun_facts = perplexity_data.get('fun_facts', [])
        sources = perplexity_data.get('sources', [])
        wikipedia_url = perplexity_data.get('wikipedia_url', '')
        location_full = perplexity_data.get('location_full', '')
        entity_type = perplexity_data.get('entity_type', 'individual')

        # Extract MusicBrainz data (with priority for structured data)
        mb_birth_date = musicbrainz_data.get('birth_date', '')
        mb_death_date = musicbrainz_data.get('death_date', '')
        mb_origin = musicbrainz_data.get('origin', '')
        mb_country = musicbrainz_data.get('country', '')
        mb_instruments = musicbrainz_data.get('instruments', [])
        mb_aliases = musicbrainz_data.get('aliases', [])
        mb_tags = musicbrainz_data.get('tags', [])
        mb_artist_type = musicbrainz_data.get('artist_type', '').lower()
        mb_gender = musicbrainz_data.get('gender', '')
        mb_disambiguation = musicbrainz_data.get('disambiguation', '')
        mb_members = musicbrainz_data.get('members', [])
        mb_original_members = musicbrainz_data.get('original_members', [])
        mb_associated_acts = musicbrainz_data.get('associated_acts', [])

        # Merge entity_type: MusicBrainz has priority
        if mb_artist_type:
            if 'person' in mb_artist_type:
                entity_type = 'individual'
            elif 'group' in mb_artist_type or 'band' in mb_artist_type:
                entity_type = 'group'
        # Fallback: If no MusicBrainz type but has members data, likely a group
        elif mb_members and not mb_artist_type:
            entity_type = 'group'
            self.logger.debug(f"Inferred entity_type=group from members data for {artist_name}")

        # Merge origin/birth_place: MusicBrainz has priority for structured data
        if mb_origin:
            location_full = mb_origin
        elif mb_country and not location_full:
            location_full = mb_country

        # Convert connections to simple format for frontmatter
        simple_connections = {}
        for conn_type in ['mentors', 'collaborators', 'influenced']:
            if conn_type in connections:
                simple_connections[conn_type] = [
                    conn.get('name', '') for conn in connections[conn_type] if isinstance(conn, dict)
                ]

        # Build YAML frontmatter
        frontmatter = {
            'title': artist_name,
            'status': 'active',
            'genres': genres[:10],
            'spotify_data': {
                'id': spotify_data.get('artist_id', ''),
                'url': spotify_url,
                'popularity': popularity,
                'followers': followers
            },
            'primary_source': 'perplexity',
            'enhancement_provider': 'perplexity',
            'research_sources': sources,
            'musical_connections': simple_connections,
            'network_extracted': True,
            'biography_enhanced_at': datetime.now().isoformat(),
            'external_urls': {
                'spotify': spotify_url,
                'wikipedia': wikipedia_url
            },
            'image_path': image_path,
            'entry_created': datetime.now().isoformat(),
            'last_updated': datetime.now().isoformat()
        }

        # Add MusicBrainz data to frontmatter
        if musicbrainz_data.get('mbid'):
            frontmatter['musicbrainz_id'] = musicbrainz_data['mbid']
            frontmatter['external_urls']['musicbrainz'] = f"https://musicbrainz.org/artist/{musicbrainz_data['mbid']}"

        if mb_birth_date:
            frontmatter['birth_date'] = mb_birth_date
        if mb_death_date:
            frontmatter['death_date'] = mb_death_date
        if mb_gender:
            frontmatter['gender'] = mb_gender
        if mb_artist_type:
            frontmatter['artist_type'] = mb_artist_type
        if mb_disambiguation:
            frontmatter['disambiguation'] = mb_disambiguation
        if mb_instruments:
            frontmatter['instruments'] = mb_instruments
        if mb_aliases:
            frontmatter['aliases'] = mb_aliases
        if mb_tags:
            frontmatter['tags'] = mb_tags
        if mb_members:
            frontmatter['members'] = mb_members
        if mb_original_members:
            frontmatter['original_members'] = mb_original_members
        if mb_associated_acts:
            frontmatter['associated_acts'] = mb_associated_acts

        # Add location based on entity type
        if location_full:
            if entity_type == 'individual':
                frontmatter['birth_place'] = location_full
            elif entity_type in ['band', 'group']:
                frontmatter['origin'] = location_full

        # Build markdown content
        image_filename = image_path.split('/')[-1] if image_path else ''

        content = f"""![]({image_filename})

# {artist_name}

## Quick Info
- **Genres**: {', '.join(genres[:5]) if genres else 'Not specified'}
"""

        # Add instruments (for individuals only)
        if mb_instruments and entity_type == 'individual':
            content += f"- **Instruments**: {', '.join(mb_instruments)}\n"

        # Add aliases
        if mb_aliases:
            content += f"- **Aliases**: {', '.join(mb_aliases)}\n"

        content += f"- **Spotify Popularity**: {popularity}/100\n"
        content += f"- **Followers**: {followers:,}\n"

        # Add birth place/origin
        if location_full:
            if entity_type == 'individual':
                if mb_birth_date:
                    content += f"- **Born**: {mb_birth_date}, {location_full}\n"
                else:
                    content += f"- **Born**: {location_full}\n"
            elif entity_type in ['band', 'group']:
                content += f"- **Origin**: {location_full}\n"
            else:
                # Safety fallback: If entity_type is ambiguous, check for birth_date
                # Groups should never have death_date, so use that as indicator
                if mb_birth_date and not mb_members:
                    # Has birth date, no members → likely individual
                    content += f"- **Born**: {mb_birth_date}, {location_full}\n"
                else:
                    # No birth date or has members → likely group
                    content += f"- **Origin**: {location_full}\n"

        # Add death date (if applicable)
        if mb_death_date:
            content += f"- **Died**: {mb_death_date}\n"

        content += f"""
## Biography
{biography}

*Enhanced with Perplexity AI research*
"""

        # Add sources (excluding Wikipedia)
        non_wiki_sources = [s for s in sources if 'wikipedia.org' not in s.lower()]
        if non_wiki_sources:
            source_links = [f"[Source{i+1}]({url})" for i, url in enumerate(non_wiki_sources)]
            content += f"\n*Sources: {', '.join(source_links)}*\n"

        # Add Fun Facts
        if fun_facts:
            content += "\n## Fun Facts\n"
            for fact in fun_facts:
                content += f"- {fact}\n"

        # Add Members section (for groups/bands) or Associated Acts (for individuals)
        if mb_members and entity_type in ['group', 'band']:
            content += "\n## Members\n"
            for member in mb_members:
                member_name = member.get('name', '')
                instruments = member.get('instruments', [])
                begin = member.get('begin', '')
                end = member.get('end', '')

                # Build member line
                sanitized_member_name = self.sanitize_filename(member_name)
                member_line = f"- [[{sanitized_member_name}|{member_name}]]"

                # Add instruments
                if instruments:
                    member_line += f" - {', '.join(instruments)}"

                # Add time period
                if begin or end:
                    if begin and end:
                        member_line += f" (from {begin} until {end})"
                    elif begin:
                        member_line += f" (from {begin})"
                    elif end:
                        member_line += f" (until {end})"

                content += member_line + "\n"

            # Add Original Members subsection
            if mb_original_members:
                content += "\n### Original Members\n"
                for orig_member in mb_original_members:
                    orig_name = orig_member.get('name', '')
                    orig_instruments = orig_member.get('instruments', [])

                    sanitized_orig_name = self.sanitize_filename(orig_name)
                    orig_line = f"- [[{sanitized_orig_name}|{orig_name}]]"

                    if orig_instruments:
                        orig_line += f" - {', '.join(orig_instruments)}"

                    content += orig_line + "\n"

        # Add Associated Acts section (for individuals)
        elif mb_associated_acts and entity_type == 'individual':
            content += "\n## Associated Acts\n"
            for act in mb_associated_acts:
                act_name = act.get('name', '')
                instruments = act.get('instruments', [])
                begin = act.get('begin', '')
                end = act.get('end', '')

                # Build associated act line
                sanitized_act_name = self.sanitize_filename(act_name)
                act_line = f"- [[{sanitized_act_name}|{act_name}]]"

                # Add instruments/roles
                if instruments:
                    act_line += f" - {', '.join(instruments)}"

                # Add time period
                if begin or end:
                    if begin and end:
                        act_line += f" ({begin}–{end})"
                    elif begin:
                        act_line += f" ({begin}–present)"
                    elif end:
                        act_line += f" (until {end})"

                content += act_line + "\n"

        # Add Musical Connections
        if connections:
            content += "\n## Musical Connections\n"

            if connections.get('mentors'):
                content += "\n### Mentors/Influences\n"
                for mentor in connections['mentors']:
                    if isinstance(mentor, dict):
                        name = mentor.get('name', '')
                        context = mentor.get('context', '')
                        works = mentor.get('specific_works', '')
                        period = mentor.get('time_period', '')

                        detail_parts = [context]
                        if works:
                            detail_parts.append(f"({works})")
                        if period:
                            detail_parts.append(f"[{period}]")

                        # Use proper Obsidian wikilink format: [[Filename|Display Name]]
                        sanitized_name = self.sanitize_filename(name)
                        content += f"- [[{sanitized_name}|{name}]] - {' '.join(detail_parts)}\n"

            if connections.get('collaborators'):
                content += "\n### Key Collaborators\n"
                for collab in connections['collaborators']:
                    if isinstance(collab, dict):
                        name = collab.get('name', '')
                        context = collab.get('context', '')
                        works = collab.get('specific_works', '')
                        period = collab.get('time_period', '')

                        detail_parts = [context]
                        if works:
                            detail_parts.append(f"({works})")
                        if period:
                            detail_parts.append(f"[{period}]")

                        # Use proper Obsidian wikilink format: [[Filename|Display Name]]
                        sanitized_name = self.sanitize_filename(name)
                        content += f"- [[{sanitized_name}|{name}]] - {' '.join(detail_parts)}\n"

            if connections.get('influenced'):
                content += "\n### Artists Influenced\n"
                for influenced in connections['influenced']:
                    if isinstance(influenced, dict):
                        name = influenced.get('name', '')
                        context = influenced.get('context', '')
                        works = influenced.get('specific_works', '')
                        period = influenced.get('time_period', '')

                        detail_parts = [context]
                        if works:
                            detail_parts.append(f"({works})")
                        if period:
                            detail_parts.append(f"[{period}]")

                        # Use proper Obsidian wikilink format: [[Filename|Display Name]]
                        sanitized_name = self.sanitize_filename(name)
                        content += f"- [[{sanitized_name}|{name}]] - {' '.join(detail_parts)}\n"

        # Add external links
        content += "\n## External Links\n"
        if spotify_url:
            content += f"- [Spotify]({spotify_url})\n"
        if wikipedia_url:
            content += f"- [Wikipedia]({wikipedia_url})\n"
        if musicbrainz_data.get('mbid'):
            mb_url = f"https://musicbrainz.org/artist/{musicbrainz_data['mbid']}"
            content += f"- [MusicBrainz]({mb_url})\n"

        # Add Tags at the bottom (top 3 genre tags from MusicBrainz)
        if mb_tags:
            tag_string = ', '.join([f"#{tag.replace(' ', '-').replace('/', '-')}" for tag in mb_tags])
            content += f"\n---\n**Tags**: {tag_string}\n"

        # Combine frontmatter and content
        frontmatter_text = yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True)
        return f"---\n{frontmatter_text}---\n\n{content}"

    def write_card(self, card_path: Path, content: str) -> bool:
        """Write artist card to disk."""
        try:
            if self.dry_run:
                self.logger.info(f"[DRY RUN] Would write card: {card_path}")
                return True

            card_path.write_text(content, encoding='utf-8')
            self.logger.info(f"Wrote card: {card_path}")
            return True

        except Exception as e:
            self.logger.error(f"Error writing card {card_path}: {e}")
            return False

    def process_artist(self, artist_name: str) -> str:
        """
        Process a single artist through the complete pipeline.

        STRICT DUPLICATE PREVENTION:
        - If card exists with Perplexity enhancement, ALWAYS skip (unless --force)
        - No quality checks or partial enhancement logic
        - "Once enhanced with Perplexity, never again" policy

        Returns: Status message string
        """
        try:
            self.logger.info(f"Processing: {artist_name}")

            # STEP 1: Find existing card (fuzzy matching catches case variants like "DR. JOHN" vs "dr_john")
            exists, card_path, match_type = self.find_existing_card(artist_name)

            if exists and not self.force:
                # Case variant found (e.g., "DR._JOHN.md" when looking for "dr_john")
                if match_type == "case_variant":
                    self.logger.info(f"Found case variant for '{artist_name}': {card_path.name}")
                    self.stats['skipped_duplicate'] += 1
                    return f"🔍 Duplicate: {card_path.name}"

                # STRICT CHECK: Has Perplexity enhancement? Skip immediately.
                if self.has_perplexity_enhancement(card_path):
                    self.logger.info(f"Skipping '{artist_name}': Already enhanced with Perplexity")
                    self.stats['skipped_perplexity'] += 1
                    return "✅ Already enhanced with Perplexity"

                # Card exists but NO Perplexity data - proceed to enhance it
                self.logger.info(f"Card exists for '{artist_name}' but lacks Perplexity enhancement - processing...")

            # STEP 1: Get Spotify metadata
            self.logger.info(f"Fetching Spotify metadata for: {artist_name}")
            spotify_data = self.get_spotify_metadata(artist_name)
            if not spotify_data:
                self.stats['errors'] += 1
                return "❌ Spotify not found"

            time.sleep(SPOTIFY_RATE_LIMIT)

            # STEP 2: Get MusicBrainz metadata (optional, non-blocking)
            self.logger.info(f"Fetching MusicBrainz metadata for: {artist_name}")
            spotify_genres = spotify_data.get('genres', [])
            musicbrainz_data = self.get_musicbrainz_metadata(artist_name, spotify_genres)
            if musicbrainz_data:
                self.logger.info(f"MusicBrainz data retrieved for: {artist_name}")
            else:
                self.logger.info(f"No MusicBrainz data found for: {artist_name} (continuing with Perplexity only)")
                musicbrainz_data = {}

            time.sleep(MUSICBRAINZ_RATE_LIMIT)

            # STEP 3: Research with Perplexity
            self.logger.info(f"Researching with Perplexity: {artist_name}")
            perplexity_data = self.research_with_perplexity(artist_name, spotify_data)
            if not perplexity_data or not perplexity_data.get('success'):
                self.stats['errors'] += 1
                return "❌ Perplexity research failed"

            time.sleep(PERPLEXITY_RATE_LIMIT)

            # STEP 3.5: Merge and deduplicate collaborators from both sources
            perplexity_collaborators = perplexity_data.get('connections', {}).get('collaborators', [])
            mb_collaborators = musicbrainz_data.get('collaborators', [])
            if mb_collaborators or perplexity_collaborators:
                merged_collaborators = self.deduplicate_collaborators(mb_collaborators, perplexity_collaborators)
                # Update perplexity_data with merged collaborators
                if 'connections' not in perplexity_data:
                    perplexity_data['connections'] = {}
                perplexity_data['connections']['collaborators'] = merged_collaborators

            # STEP 4: Download image
            self.logger.info(f"Downloading image for: {artist_name}")
            image_path = None
            if spotify_data.get('image_url'):
                image_path = self.download_artist_image(spotify_data['image_url'], artist_name)

            if not image_path:
                self.logger.warning(f"No image downloaded for: {artist_name}")
                image_path = ""  # Continue without image

            # STEP 5: Build card
            self.logger.info(f"Building card for: {artist_name}")
            card_content = self.build_artist_card(artist_name, spotify_data, musicbrainz_data, perplexity_data, image_path)

            # STEP 6: Write card
            card_path = self.cards_dir / f"{self.sanitize_filename(artist_name)}.md"
            if not self.write_card(card_path, card_content):
                self.stats['errors'] += 1
                return "❌ Failed to write card"

            # STEP 7: Update connections database
            connections = perplexity_data.get('connections', {})
            if connections:
                simple_connections = {}
                for conn_type in ['mentors', 'collaborators', 'influenced']:
                    if conn_type in connections:
                        simple_connections[conn_type] = [
                            conn.get('name', '') for conn in connections[conn_type] if isinstance(conn, dict)
                        ]

                self.connections_db[artist_name] = {
                    **simple_connections,
                    'updated': datetime.now().isoformat(),
                    'source': 'perplexity_research'
                }

                connection_count = sum(len(v) for v in simple_connections.values())
                self.stats['connections_found'] += connection_count

            # Update stats
            if exists:
                self.stats['enhanced'] += 1
                status_msg = f"✅ Enhanced ({self.stats['connections_found']} connections)"
            else:
                self.stats['created'] += 1
                status_msg = f"✨ Created ({self.stats['connections_found']} connections)"

            return status_msg

        except Exception as e:
            self.logger.error(f"Error processing {artist_name}: {e}")
            self.stats['errors'] += 1
            return f"❌ Error: {str(e)[:50]}"

    def process_archive(self, archive_path: str) -> None:
        """Process entire WWOZ archive file."""
        self.logger.info(f"Processing archive: {archive_path}")

        # Parse archive
        artists = self.parse_archive(archive_path)
        if not artists:
            self.logger.error("No artists found in archive")
            return

        self.stats['total'] = len(artists)

        # Authenticate with Spotify
        if not self.authenticate_spotify():
            self.logger.error("Failed to authenticate with Spotify")
            return

        # Initialize Perplexity
        if not self.initialize_perplexity():
            self.logger.error("Failed to initialize Perplexity")
            return

        # Process each artist
        print(f"\n🎵 Artist Discovery Pipeline")
        print(f"Archive: {archive_path}")
        print(f"Found: {len(artists)} artists")
        if self.dry_run:
            print("🔍 DRY RUN MODE - No files will be modified")
        print()

        with tqdm(artists, desc="Processing artists", unit="artist") as pbar:
            for artist in pbar:
                pbar.set_description(f"Processing: {artist}")

                status = self.process_artist(artist)
                pbar.set_postfix_str(status)
                self.stats['processed'] += 1

                time.sleep(0.1)  # Brief pause

        # Save connections database
        self._save_connections()

        # Print summary
        self._print_summary()

    def _print_summary(self) -> None:
        """Print processing summary statistics."""
        print(f"\n📊 Processing Summary:")
        print(f"✨ Created: {self.stats['created']} new cards")
        print(f"✅ Enhanced: {self.stats['enhanced']} existing cards")
        print(f"⏭️  Skipped (already has Perplexity): {self.stats['skipped_perplexity']}")
        print(f"🔍 Skipped (duplicate variant found): {self.stats['skipped_duplicate']}")
        print(f"🔗 Connections found: {self.stats['connections_found']}")
        print(f"📚 Network size: {len(self.connections_db)} artists")
        print(f"❌ Errors: {self.stats['errors']}")
        print(f"📁 Total processed: {self.stats['processed']}/{self.stats['total']}")

        # Calculate efficiency metrics
        total_skipped = self.stats['skipped_perplexity'] + self.stats['skipped_duplicate']
        if total_skipped > 0:
            print(f"\n💰 API Cost Savings: Skipped {total_skipped} expensive Perplexity API calls")

        if self.stats['processed'] > 0:
            success_count = self.stats['created'] + self.stats['enhanced']
            success_rate = (success_count / self.stats['processed'] * 100)
            print(f"\n🎯 Success rate: {success_rate:.1f}%")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Unified pipeline for discovering and processing artists from WWOZ archives"
    )

    parser.add_argument(
        '--archive',
        required=True,
        help='Path to WWOZ markdown archive file'
    )
    parser.add_argument(
        '--cards-dir',
        default=DEFAULT_CARDS_DIR,
        help=f'Directory for artist cards (default: {DEFAULT_CARDS_DIR})'
    )
    parser.add_argument(
        '--images-dir',
        default=DEFAULT_IMAGES_DIR,
        help=f'Directory for artist images (default: {DEFAULT_IMAGES_DIR})'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without modifying files'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Re-process and re-enhance already completed artists'
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
        # Check for required API key
        if not args.dry_run and not os.getenv('PERPLEXITY_API_KEY'):
            print("❌ Error: PERPLEXITY_API_KEY environment variable is required")
            print("Please set your Perplexity API key:")
            print("export PERPLEXITY_API_KEY='your-api-key-here'")
            print("\nGet your API key at: https://www.perplexity.ai/settings/api")
            sys.exit(1)

        # Validate archive file
        if not os.path.exists(args.archive):
            print(f"❌ Error: Archive file does not exist: {args.archive}")
            sys.exit(1)

        # Create pipeline and process
        pipeline = ArtistDiscoveryPipeline(
            cards_dir=args.cards_dir,
            images_dir=args.images_dir,
            dry_run=args.dry_run,
            force=args.force
        )

        pipeline.process_archive(args.archive)

        print("\n✅ Pipeline completed successfully")

    except KeyboardInterrupt:
        print("\n\n⏹️ Process interrupted by user")
        sys.exit(1)
    except Exception as e:
        logging.error(f"Fatal error: {e}")
        print(f"\n❌ Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
