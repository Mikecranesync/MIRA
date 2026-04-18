"""Military Technical Manual source registry and downloader.

Downloads TM PDFs from Internet Archive, liberatedmanuals.com, armypubs.army.mil,
and other public-domain military document sources. All target documents are
Distribution Statement A (approved for public release).

Usage:
    # List available sources
    python -m vim.tm_sources --list

    # Search Internet Archive for aviation TMs
    python -m vim.tm_sources --search "TM 55-1520"

    # Download top 50 priority TMs
    python -m vim.tm_sources --download --limit 50

    # Download specific identifier
    python -m vim.tm_sources --download-id "TM-55-1520-240-23"
"""

from __future__ import annotations

import argparse
import logging
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from .config import ParserConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("vim-tm-sources")


# ---------------------------------------------------------------------------
# Source registry
# ---------------------------------------------------------------------------


@dataclass
class TMSource:
    """A single TM acquisition source."""

    name: str
    url: str
    method: str  # internetarchive_api | torrent | search_scrape | direct_pdf | govinfo_api
    auth: str | None = None
    notes: str = ""
    search_terms: list[str] = field(default_factory=list)


SOURCES: dict[str, TMSource] = {
    "internet_archive": TMSource(
        name="Internet Archive",
        url="https://archive.org/details/military-field-manuals-and-guides",
        method="internetarchive_api",
        notes="pip install internetarchive; ia download <id> --glob='*.pdf'",
        search_terms=[
            "milmanual",
            "army technical manual",
            "TM 55",
            "TM 9",
            "NAVAIR 01",
            "NAVAIR 17",
        ],
    ),
    "liberatedmanuals": TMSource(
        name="Liberated Manuals",
        url="https://www.liberatedmanuals.com",
        method="torrent",
        notes="Full-site torrent (4,792 PDFs) available on homepage.",
    ),
    "armypubs": TMSource(
        name="Army Publishing Directorate",
        url="https://armypubs.army.mil",
        method="search_scrape",
        notes="Filter Distribution Statement A only. Robots.txt compliant.",
        search_terms=["TM 9", "TM 1-15", "TM 55", "TM 10", "TM 43"],
    ),
    "govinfo": TMSource(
        name="GovInfo",
        url="https://www.govinfo.gov",
        method="govinfo_api",
        auth="free_api_key",
        notes="Register at api.govinfo.gov. Use collection:GOVPUB filter.",
    ),
    "navair_docs": TMSource(
        name="NAVAIR Documents",
        url="https://navair.navy.mil/documents",
        method="direct_pdf",
        notes="NAMP instruction + AMAs. Limited volume, high quality.",
    ),
    "marines_pubs": TMSource(
        name="Marines Publications",
        url="https://www.marines.mil/News/Publications/MCPEL/",
        method="search_scrape",
        search_terms=["CH-46", "NAVMC 3500", "aviation maintenance"],
        notes="CH-46E T&R Manual (NAVMC 3500.46A) is here.",
    ),
}


# ---------------------------------------------------------------------------
# Priority TM series — download these first
# ---------------------------------------------------------------------------

PRIORITY_TM_SERIES: list[str] = [
    # Aviation (CH-46E focus + broader Army aviation)
    "TM 55-1520",  # Army aviation helicopters
    "TM 1-1520",  # Army aviation maintenance
    "NAVAIR 01",  # Navy/Marine aviation all series
    "NAVAIR 17",  # Support equipment manuals
    "TO 1-1A-1",  # USAF/joint aircraft general maintenance
    # Ground vehicles
    "TM 9-2320",  # Wheeled vehicles (HMMWV, trucks)
    "TM 9-2350",  # Tracked vehicles (M1 Abrams, Bradley)
    "TM 9-4910",  # Ground support equipment
    # Support
    "TM 9-6140",  # Batteries and power systems
    "TM 10-3950",  # Materials handling (forklifts, cranes)
    "TM 11-5820",  # Communications-electronics
]

# Internet Archive search queries derived from priority series
_IA_SEARCH_QUERIES: list[str] = [
    # Aviation
    'subject:"military manuals" AND title:"TM 55-1520"',
    'subject:"military manuals" AND title:"TM 1-1520"',
    'subject:"military manuals" AND title:"NAVAIR"',
    'subject:"military manuals" AND title:"helicopter"',
    # Ground vehicles
    'subject:"military manuals" AND title:"TM 9-2320"',
    'subject:"military manuals" AND title:"TM 9-2350"',
    'subject:"military manuals" AND title:"TM 9-4910"',
    # Broad sweep
    'subject:"military manuals" AND mediatype:texts AND title:"technical manual"',
    'subject:"army field manual" AND mediatype:texts',
]


# ---------------------------------------------------------------------------
# Internet Archive helpers
# ---------------------------------------------------------------------------


def _check_ia_cli() -> bool:
    """Check if the `ia` CLI tool is available."""
    try:
        result = subprocess.run(
            ["ia", "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def search_internet_archive(query: str, max_results: int = 50) -> list[dict]:
    """Search Internet Archive for items matching query.

    Returns list of dicts with keys: identifier, title, description.
    Uses the `internetarchive` Python library.
    """
    try:
        import internetarchive
    except ImportError:
        logger.error("internetarchive not installed. Run: uv pip install internetarchive")
        return []

    results = []
    try:
        search = internetarchive.search_items(query, fields=["identifier", "title", "description"])
        for i, item in enumerate(search):
            if i >= max_results:
                break
            results.append(
                {
                    "identifier": item.get("identifier", ""),
                    "title": item.get("title", ""),
                    "description": item.get("description", "")[:200]
                    if item.get("description")
                    else "",
                }
            )
    except Exception as e:
        logger.error("Internet Archive search failed: %s", e)

    return results


def download_ia_item(
    identifier: str,
    output_dir: Path,
    glob_pattern: str = "*.pdf",
) -> list[Path]:
    """Download PDF files from an Internet Archive item.

    Returns list of downloaded file paths.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Prefer the ia CLI for reliability
    if _check_ia_cli():
        return _download_via_cli(identifier, output_dir, glob_pattern)

    # Fall back to Python library
    return _download_via_library(identifier, output_dir, glob_pattern)


def _download_via_cli(
    identifier: str,
    output_dir: Path,
    glob_pattern: str,
) -> list[Path]:
    """Download via `ia` CLI tool."""
    logger.info("Downloading %s via ia CLI → %s", identifier, output_dir)
    try:
        result = subprocess.run(
            [
                "ia",
                "download",
                identifier,
                f"--glob={glob_pattern}",
                f"--destdir={output_dir}",
                "--no-directories",
                "--quiet",
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            logger.warning("ia download failed for %s: %s", identifier, result.stderr[:200])
            return []
    except subprocess.TimeoutExpired:
        logger.warning("ia download timed out for %s", identifier)
        return []

    # Find downloaded PDFs
    downloaded = list(output_dir.glob("*.pdf"))
    logger.info("Downloaded %d PDFs from %s", len(downloaded), identifier)
    return downloaded


def _download_via_library(
    identifier: str,
    output_dir: Path,
    glob_pattern: str,
) -> list[Path]:
    """Download via internetarchive Python library."""
    try:
        import internetarchive
    except ImportError:
        logger.error("internetarchive not installed")
        return []

    logger.info("Downloading %s via Python library → %s", identifier, output_dir)
    downloaded = []
    try:
        item = internetarchive.get_item(identifier)
        for file in item.files:
            name = file.get("name", "")
            if not name.lower().endswith(".pdf"):
                continue
            dest = output_dir / name
            if dest.exists():
                logger.debug("Skipping existing: %s", name)
                downloaded.append(dest)
                continue
            try:
                internetarchive.download(
                    identifier,
                    files=[name],
                    destdir=str(output_dir),
                    no_directory=True,
                    silent=True,
                )
                if dest.exists():
                    downloaded.append(dest)
            except Exception as e:
                logger.warning("Failed to download %s/%s: %s", identifier, name, e)
    except Exception as e:
        logger.error("Failed to access item %s: %s", identifier, e)

    logger.info("Downloaded %d PDFs from %s", len(downloaded), identifier)
    return downloaded


# ---------------------------------------------------------------------------
# Batch download pipeline
# ---------------------------------------------------------------------------


def discover_and_download(
    output_dir: Path,
    limit: int = 50,
    delay_s: float = 1.0,
) -> list[Path]:
    """Search priority TM series on Internet Archive and download PDFs.

    Args:
        output_dir: Directory to save PDFs into.
        limit: Maximum total PDFs to download.
        delay_s: Polite delay between downloads.

    Returns:
        List of downloaded file paths.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    all_downloaded: list[Path] = []
    seen_ids: set[str] = set()

    for query in _IA_SEARCH_QUERIES:
        if len(all_downloaded) >= limit:
            break

        logger.info("Searching: %s", query)
        results = search_internet_archive(query, max_results=limit - len(all_downloaded))

        for item in results:
            if len(all_downloaded) >= limit:
                break

            identifier = item["identifier"]
            if identifier in seen_ids:
                continue
            seen_ids.add(identifier)

            # Skip items that don't look like TMs
            title = (item.get("title") or "").lower()
            if not _looks_like_tm(identifier, title):
                logger.debug("Skipping non-TM: %s (%s)", identifier, title[:60])
                continue

            files = download_ia_item(identifier, output_dir)
            all_downloaded.extend(files)

            if delay_s > 0:
                time.sleep(delay_s)

    logger.info("Total downloaded: %d PDFs", len(all_downloaded))
    return all_downloaded


def _looks_like_tm(identifier: str, title: str) -> bool:
    """Heuristic: does this item look like a military technical manual?"""
    combined = f"{identifier} {title}".lower()
    tm_patterns = [
        r"tm[\s-]*\d",
        r"navair",
        r"navmc",
        r"technical\s+manual",
        r"field\s+manual",
        r"maintenance\s+manual",
        r"milmanual",
        r"military.*manual",
    ]
    return any(re.search(p, combined) for p in tm_patterns)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vim.tm_sources",
        description="Military Technical Manual source registry and downloader",
    )
    p.add_argument("--list", action="store_true", help="List all configured sources")
    p.add_argument("--search", type=str, help="Search Internet Archive for a query")
    p.add_argument("--download", action="store_true", help="Download priority TMs")
    p.add_argument("--download-id", type=str, help="Download a specific IA identifier")
    p.add_argument("--limit", type=int, default=50, help="Max PDFs to download (default: 50)")
    p.add_argument(
        "--output-dir",
        type=str,
        default="",
        help="Output directory (default: mira-hud/data/tm_pdfs/)",
    )
    return p


def main() -> None:
    args = _build_parser().parse_args()
    config = ParserConfig()
    output_dir = Path(args.output_dir) if args.output_dir else config.tm_pdfs_dir

    if args.list:
        print("=== TM Source Registry ===\n")
        for key, src in SOURCES.items():
            print(f"  [{key}]")
            print(f"    Name:   {src.name}")
            print(f"    URL:    {src.url}")
            print(f"    Method: {src.method}")
            if src.auth:
                print(f"    Auth:   {src.auth}")
            if src.search_terms:
                print(f"    Terms:  {', '.join(src.search_terms)}")
            print(f"    Notes:  {src.notes}")
            print()

        print("=== Priority TM Series ===\n")
        for series in PRIORITY_TM_SERIES:
            print(f"  {series}")
        return

    if args.search:
        results = search_internet_archive(args.search, max_results=args.limit)
        print(f"\n=== Internet Archive Results ({len(results)}) ===\n")
        for r in results:
            print(f"  ID:    {r['identifier']}")
            print(f"  Title: {r['title']}")
            if r["description"]:
                print(f"  Desc:  {r['description'][:100]}")
            print()
        return

    if args.download_id:
        files = download_ia_item(args.download_id, output_dir)
        print(f"\nDownloaded {len(files)} PDFs from {args.download_id} → {output_dir}")
        for f in files:
            print(f"  {f.name}")
        return

    if args.download:
        files = discover_and_download(output_dir, limit=args.limit)
        print(f"\nDownloaded {len(files)} PDFs → {output_dir}")
        for f in files[:20]:
            print(f"  {f.name}")
        if len(files) > 20:
            print(f"  ... and {len(files) - 20} more")
        return

    _build_parser().print_help()


if __name__ == "__main__":
    main()
