"""Recursive crawl of Inductive Automation's Ignition 8.3 user manual.

Strictly bounded: same-host only, path-prefix allowlist, respects robots.txt,
bounded depth and max file count. Saves HTML + assets preserving URL paths.

Usage:
    python scripts/fetch_ignition_docs.py [--max-pages N] [--max-depth D]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urljoin, urldefrag
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "docs" / "ignition" / "8.3"
LOG_PATH = REPO / "docs" / "scraper.log"
USER_AGENT = "MIRA-Docs-Fetcher/1.0 (+research; contact:harperhousebuyers@gmail.com)"

START_URL = "https://www.docs.inductiveautomation.com/docs/8.3/intro"
ALLOWED_HOSTS = {"www.docs.inductiveautomation.com", "docs.inductiveautomation.com"}
# Only crawl under /docs/8.3 and /images so we stay inside the 8.3 manual + its assets.
PATH_ALLOW_REGEXES = [re.compile(r"^/docs/8\.3(/|$)"), re.compile(r"^/images/"), re.compile(r"^/_next/")]


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((requests.exceptions.ConnectionError, requests.exceptions.Timeout)),
    reraise=True,
)
def fetch(session: requests.Session, url: str) -> requests.Response:
    return session.get(url, timeout=30, allow_redirects=True)


def allowed(url: str) -> bool:
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        return False
    if p.netloc not in ALLOWED_HOSTS:
        return False
    return any(rx.match(p.path) for rx in PATH_ALLOW_REGEXES)


def local_path_for(url: str) -> Path:
    p = urlparse(url)
    rel = p.path.lstrip("/")
    if not rel or rel.endswith("/"):
        rel = (rel or "index") + "index.html"
    if p.query:
        rel += "_" + re.sub(r"\W+", "_", p.query)
    # pages without explicit extension get .html
    if "." not in os.path.basename(rel):
        rel += ".html"
    return OUT_DIR / rel


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-pages", type=int, default=1500)
    ap.add_argument("--max-depth", type=int, default=8)
    ap.add_argument("--start", default=START_URL)
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    log_fh = open(LOG_PATH, "a", encoding="utf-8")
    log_fh.write(f"\n=== Ignition docs crawl {datetime.now(timezone.utc).isoformat()} ===\n")

    def log(msg: str) -> None:
        line = f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}"
        print(line)
        log_fh.write(line + "\n")
        log_fh.flush()

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    # robots.txt check (best-effort)
    rp = RobotFileParser()
    try:
        robots_url = f"https://{urlparse(args.start).netloc}/robots.txt"
        rp.set_url(robots_url)
        rp.read()
    except Exception as exc:
        log(f"robots.txt unreadable ({exc}); continuing with conservative rate")

    queue: deque[tuple[str, int]] = deque([(args.start, 0)])
    visited: set[str] = set()
    fetched = 0
    bytes_total = 0
    index_hits = {"modbus": False, "micro800": False}

    while queue and fetched < args.max_pages:
        url, depth = queue.popleft()
        if url in visited:
            continue
        if depth > args.max_depth:
            continue
        if not allowed(url):
            continue
        if not rp.can_fetch(USER_AGENT, url):
            log(f"robots-disallow {url}")
            visited.add(url)
            continue
        visited.add(url)

        try:
            resp = fetch(session, url)
        except Exception as exc:
            log(f"FAIL {url} — {exc}")
            continue
        if resp.status_code != 200:
            log(f"http {resp.status_code} {url}")
            continue

        out_path = local_path_for(url)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(resp.content)
        fetched += 1
        bytes_total += len(resp.content)
        ctype = resp.headers.get("content-type", "").lower()

        if "modbus" in resp.text.lower():
            index_hits["modbus"] = True
        if "micro800" in resp.text.lower() or "micro 800" in resp.text.lower():
            index_hits["micro800"] = True

        if fetched % 25 == 0:
            log(f"  crawled {fetched} pages, {bytes_total / (1024*1024):.1f} MiB")

        # only follow links from HTML
        if "html" in ctype:
            soup = BeautifulSoup(resp.text, "html.parser")
            for tag, attr in (("a", "href"), ("link", "href"), ("script", "src"), ("img", "src")):
                for el in soup.find_all(tag):
                    href = el.get(attr)
                    if not href:
                        continue
                    absu, _ = urldefrag(urljoin(url, href))
                    if allowed(absu) and absu not in visited:
                        queue.append((absu, depth + 1))

        # enforce 2 GB cap
        if bytes_total > 2 * 1024 * 1024 * 1024:
            log("hit 2 GB cap — stopping")
            break

        time.sleep(0.25)  # polite

    log(f"Ignition crawl done: fetched={fetched} bytes={bytes_total} modbus_hit={index_hits['modbus']} micro800_hit={index_hits['micro800']}")
    (OUT_DIR / "_crawl_summary.json").write_text(
        json.dumps(
            {
                "start_url": args.start,
                "pages": fetched,
                "bytes": bytes_total,
                "index_hits": index_hits,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        )
    )
    log_fh.close()
    return 0 if fetched > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
