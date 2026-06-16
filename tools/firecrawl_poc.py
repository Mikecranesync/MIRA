"""Firecrawl proof-of-concept — discover and extract manufacturer PDFs.

Standalone sandbox. Does NOT touch production ingest pipeline.
Uses httpx directly (not the firecrawl-py SDK which hangs on Windows).

Usage:
    doppler run -p factorylm -c prd -- python tools/firecrawl_poc.py --url https://new.abb.com/drives/documents --map-only
    doppler run -p factorylm -c prd -- python tools/firecrawl_poc.py --scrape-pdf https://cdn.automationdirect.com/static/manuals/gs20m/gs20m.pdf
    doppler run -p factorylm -c prd -- python tools/firecrawl_poc.py --url https://new.abb.com/drives/documents --limit 3
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("firecrawl-poc")

API_BASE = "https://api.firecrawl.dev/v1"


def get_headers() -> dict:
    """Get auth headers for Firecrawl API."""
    api_key = os.getenv("FIRECRAWL_API_KEY", "")
    if not api_key:
        logger.error("FIRECRAWL_API_KEY not set")
        sys.exit(1)
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def map_site(url: str, limit: int = 1000) -> list[str]:
    """Map a website to discover all URLs."""
    logger.info("Mapping %s (limit=%d)...", url, limit)
    with httpx.Client(timeout=60) as client:
        resp = client.post(
            f"{API_BASE}/map",
            headers=get_headers(),
            json={"url": url, "limit": limit},
        )
        resp.raise_for_status()
        data = resp.json()
    links = data.get("links", [])
    logger.info("Discovered %d URLs", len(links))
    return links


def scrape_url(url: str, parse_pdf: bool = True) -> dict:
    """Scrape a single URL and return extracted content."""
    logger.info("Scraping: %s", url)
    payload = {"url": url, "formats": ["markdown"]}
    if parse_pdf:
        payload["parsers"] = ["pdf"]

    with httpx.Client(timeout=120) as client:
        resp = client.post(
            f"{API_BASE}/scrape",
            headers=get_headers(),
            json=payload,
        )
        if resp.status_code != 200:
            logger.error("Scrape failed (%d): %s", resp.status_code, resp.text[:500])
            # Retry without parsers field if it caused the error
            if parse_pdf and "parser" in resp.text.lower():
                logger.info("Retrying without parsers field...")
                payload.pop("parsers", None)
                resp = client.post(
                    f"{API_BASE}/scrape",
                    headers=get_headers(),
                    json=payload,
                )
            resp.raise_for_status()
        data = resp.json()
    return data.get("data", data)


def filter_pdfs(
    links: list[str],
    include: list[str] | None = None,
    exclude: list[str] | None = None,
) -> list[str]:
    """Filter URLs that look like PDF manual downloads."""
    pdfs = []
    for link in links:
        lower = link.lower()
        if not lower.endswith(".pdf"):
            continue
        if include and not any(p in lower for p in include):
            continue
        if exclude and any(p in lower for p in exclude):
            continue
        pdfs.append(link)
    return pdfs


def save_results(results: list[dict], output_dir: Path) -> None:
    """Save extracted markdown to files."""
    output_dir.mkdir(parents=True, exist_ok=True)
    for i, result in enumerate(results):
        metadata = result.get("metadata") or {}
        url = metadata.get("sourceURL", f"unknown_{i}")
        filename = url.rsplit("/", 1)[-1] if "/" in url else f"doc_{i}.pdf"
        md_file = output_dir / f"{filename}.md"
        markdown = result.get("markdown", "") or ""
        md_file.write_text(markdown, encoding="utf-8")
        logger.info("Saved: %s (%d chars)", md_file.name, len(markdown))

    # Also save raw JSON for inspection
    json_file = output_dir / "_raw_results.json"
    json_file.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    logger.info("Saved raw JSON: %s", json_file)


def cmd_map(args: argparse.Namespace) -> None:
    """Map a site and list PDF URLs."""
    links = map_site(args.url, limit=args.map_limit)
    pdfs = filter_pdfs(
        links,
        include=args.include.split(",") if args.include else None,
        exclude=args.exclude.split(",") if args.exclude else None,
    )
    print(f"\n=== Found {len(pdfs)} PDF links out of {len(links)} total URLs ===\n")
    for pdf in pdfs[:50]:
        print(f"  {pdf}")
    if len(pdfs) > 50:
        print(f"  ... and {len(pdfs) - 50} more")
    if not pdfs and links:
        print("  No PDFs found. Sample URLs discovered:")
        for link in links[:10]:
            print(f"    {link}")


def cmd_scrape(args: argparse.Namespace) -> None:
    """Map, filter, and scrape PDFs from a site."""
    links = map_site(args.url, limit=args.map_limit)
    pdfs = filter_pdfs(
        links,
        include=args.include.split(",") if args.include else None,
        exclude=args.exclude.split(",") if args.exclude else None,
    )
    print(f"\nFound {len(pdfs)} PDF links. Scraping up to {args.limit}...\n")

    results = []
    for pdf_url in pdfs[: args.limit]:
        try:
            result = scrape_url(pdf_url)
            markdown = result.get("markdown", "") or ""
            metadata = result.get("metadata", {}) or {}
            results.append(result)

            print(f"--- {pdf_url} ---")
            print(f"  Title:    {metadata.get('title', 'N/A')}")
            print(f"  Status:   {metadata.get('statusCode', 'N/A')}")
            print(f"  Markdown: {len(markdown)} chars")
            if len(markdown) > 300:
                print(f"  Preview:  {markdown[:300]}...")
            else:
                print(f"  Full:     {markdown}")
            print()
        except Exception as e:
            logger.error("Failed to scrape %s: %s", pdf_url, e)

    if results:
        timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        output_dir = Path.home() / ".claude" / "scratchpad" / f"{timestamp}_firecrawl_poc"
        save_results(results, output_dir)
        print(f"\nResults saved to: {output_dir}")

    print(f"\nSummary: {len(results)}/{min(args.limit, len(pdfs))} PDFs scraped successfully")


def cmd_scrape_pdf(args: argparse.Namespace) -> None:
    """Scrape a single known PDF URL directly."""
    result = scrape_url(args.scrape_pdf)
    markdown = result.get("markdown", "") or ""
    metadata = result.get("metadata", {}) or {}

    print(f"\n=== {args.scrape_pdf} ===")
    print(f"Title:    {metadata.get('title', 'N/A')}")
    print(f"Status:   {metadata.get('statusCode', 'N/A')}")
    print(f"Markdown: {len(markdown)} chars")
    print(f"\n{markdown[:2000]}")
    if len(markdown) > 2000:
        print(f"\n... ({len(markdown) - 2000} more chars)")

    timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    output_dir = Path.home() / ".claude" / "scratchpad" / f"{timestamp}_firecrawl_poc"
    save_results([result], output_dir)
    print(f"\nFull result saved to: {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="firecrawl-poc",
        description="Firecrawl proof-of-concept for manufacturer PDF discovery",
    )
    parser.add_argument("--url", type=str, help="Manufacturer portal URL to map/scrape")
    parser.add_argument("--scrape-pdf", type=str, help="Scrape a single known PDF URL directly")
    parser.add_argument("--limit", type=int, default=3, help="Max PDFs to scrape (default: 3)")
    parser.add_argument(
        "--map-limit", type=int, default=1000, help="Max URLs to discover via map (default: 1000)"
    )
    parser.add_argument("--map-only", action="store_true", help="Only map URLs, don't scrape")
    parser.add_argument("--include", type=str, help="Comma-separated include patterns for PDF URLs")
    parser.add_argument("--exclude", type=str, help="Comma-separated exclude patterns for PDF URLs")
    args = parser.parse_args()

    if not args.url and not args.scrape_pdf:
        parser.error("Provide --url or --scrape-pdf")

    if args.scrape_pdf:
        cmd_scrape_pdf(args)
    elif args.map_only:
        cmd_map(args)
    else:
        cmd_scrape(args)


if __name__ == "__main__":
    main()
