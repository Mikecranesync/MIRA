"""Use Apify to locate hard-to-find vendor PDFs, then download them locally.

Driver: the Apify `google-search-scraper` actor (actor ID `apify/google-search-scraper`).
It runs a Google query for each missing publication, returns the top organic
results as JSON, and we harvest any `*.pdf` URL that matches the expected
publication number.

Requirements:
  - Environment variable APIFY_TOKEN with a valid Apify API token
      (https://console.apify.com/settings/integrations -> API tokens)
  - `pip install apify-client` (installed on demand below if missing)

Usage:
    export APIFY_TOKEN=apify_api_xxx
    python scripts/apify_doc_search.py
    # or pass --queries to search for something specific:
    python scripts/apify_doc_search.py --query "2080-PM001 Micro800 programming"

The script will NOT attempt a run if APIFY_TOKEN is unset — it just prints
what it would have searched for, then exits 0. That keeps this safe to commit
without leaking costs.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "docs" / "rockwell"
LOG_PATH = REPO / "docs" / "scraper.log"
USER_AGENT = "MIRA-Docs-Fetcher/1.0 (+research; contact:harperhousebuyers@gmail.com)"

# Each query will be fed to Google (via Apify). The key is also used as a filename.
DEFAULT_QUERIES: list[tuple[str, str]] = [
    ("9328-UM001", "Rockwell 9328-UM001 Connected Components Workbench User Manual filetype:pdf"),
    ("9328-QS003", "Rockwell 9328-QS003 CCW Quick Start filetype:pdf"),
    ("2080-PM001", "Rockwell 2080-PM001 Micro800 programming manual filetype:pdf"),
    ("2080-AT002", "Rockwell 2080-AT002 Micro820 architecture tech note filetype:pdf"),
    ("2080-QR002", "Rockwell 2080-QR002 Micro800 quick reference filetype:pdf"),
    ("2080-IN004", "Rockwell 2080-IN004 Micro820 installation instructions filetype:pdf"),
    ("2080-RN024", "Rockwell 2080-RN024 Micro820 firmware release notes filetype:pdf"),
    ("1756-PM020", "Rockwell 1756-PM020 Logix 5000 Structured Text Programming filetype:pdf"),
]


def ensure_client() -> "object":
    try:
        from apify_client import ApifyClient  # type: ignore
        return ApifyClient
    except ImportError:
        print("apify-client not installed; installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "apify-client"])
        from apify_client import ApifyClient  # type: ignore
        return ApifyClient


def already_have(pub: str) -> bool:
    return any(OUT_DIR.glob(f"{pub}_-en-*.pdf"))


def extract_pdf_url(results: list[dict], pub: str) -> str | None:
    """From Apify Google-search-scraper results, pick the first PDF URL that
    mentions the publication number (case-insensitive)."""
    pub_lower = pub.lower()
    for item in results:
        for key in ("url", "link"):
            u = item.get(key)
            if not u:
                continue
            if not u.lower().endswith(".pdf"):
                continue
            if pub_lower in u.lower() or pub_lower in (item.get("title") or "").lower():
                return u
    # second pass — any PDF URL at all from rockwellautomation.com
    for item in results:
        u = item.get("url") or item.get("link") or ""
        if u.lower().endswith(".pdf") and "rockwellautomation" in u.lower():
            return u
    return None


def download(url: str, pub: str) -> Path | None:
    out = OUT_DIR / f"{pub}_-en-apify.pdf"
    try:
        r = requests.get(url, timeout=45, headers={"User-Agent": USER_AGENT}, stream=True)
    except Exception as exc:
        print(f"  download fail {url}: {exc}")
        return None
    if r.status_code != 200:
        print(f"  http {r.status_code} {url}")
        return None
    first = r.raw.read(8, decode_content=True) if r.raw else b""
    if not first.startswith(b"%PDF"):
        r.close()
        print(f"  not-pdf {url}")
        return None
    with open(out, "wb") as fh:
        fh.write(first)
        for chunk in r.iter_content(chunk_size=64 * 1024):
            if chunk:
                fh.write(chunk)
    r.close()
    (OUT_DIR / f"{pub}_-en-apify.meta.json").write_text(
        json.dumps(
            {
                "publication": pub,
                "title": f"Discovered via Apify Google search for {pub}",
                "source_url": url,
                "downloaded_at": datetime.now(timezone.utc).isoformat(),
                "found_by": "apify_google_search",
            },
            indent=2,
        )
    )
    print(f"  OK {out.name} ({out.stat().st_size / 1024:.0f} KiB)")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", action="append", default=None,
                    help="Additional custom queries (label=query). Can repeat.")
    ap.add_argument("--results-per-query", type=int, default=10)
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    log_fh = open(LOG_PATH, "a", encoding="utf-8")
    log_fh.write(f"\n=== Apify doc search {datetime.now(timezone.utc).isoformat()} ===\n")

    queries: list[tuple[str, str]] = list(DEFAULT_QUERIES)
    if args.query:
        for q in args.query:
            if "=" in q:
                label, text = q.split("=", 1)
                queries.append((label.strip(), text.strip()))
            else:
                queries.append((f"custom_{len(queries)}", q))

    token = os.environ.get("APIFY_TOKEN")
    if not token:
        print("APIFY_TOKEN not set. Would have searched for:")
        for label, q in queries:
            print(f"  {label}: {q}")
        print("\nTo actually run, export APIFY_TOKEN and re-invoke.")
        return 0

    ApifyClient = ensure_client()
    client = ApifyClient(token)

    wins = 0
    for label, query in queries:
        if label not in {"custom"} and already_have(label):
            print(f"--- {label}: already on disk, skip ---")
            continue
        print(f"--- {label}: {query} ---")
        log_fh.write(f"--- {label}: {query} ---\n")
        run_input = {
            "queries": query,
            "resultsPerPage": args.results_per_query,
            "maxPagesPerQuery": 1,
            "saveHtml": False,
            "mobileResults": False,
            "languageCode": "en",
            "countryCode": "US",
        }
        try:
            run = client.actor("apify/google-search-scraper").call(run_input=run_input)
            dataset_id = run.get("defaultDatasetId")
            items = list(client.dataset(dataset_id).iterate_items()) if dataset_id else []
        except Exception as exc:
            print(f"  apify fail: {exc}")
            log_fh.write(f"  apify fail: {exc}\n")
            continue

        # Each item typically has an organicResults array; flatten:
        organic: list[dict] = []
        for it in items:
            organic.extend(it.get("organicResults", []) or [])
        url = extract_pdf_url(organic, label)
        if not url:
            print(f"  no PDF URL found for {label}")
            log_fh.write(f"  no PDF URL for {label}\n")
            continue
        result = download(url, label)
        if result:
            wins += 1
        time.sleep(1.0)

    print(f"Apify pass done: {wins} new files.")
    log_fh.write(f"Apify pass done: {wins} new files.\n")
    log_fh.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
