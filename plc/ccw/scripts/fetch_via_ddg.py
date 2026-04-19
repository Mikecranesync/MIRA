"""No-API-key fallback: search DuckDuckGo HTML for missing vendor PDFs.

Use when Apify credits are exhausted. DuckDuckGo's `html.duckduckgo.com`
endpoint returns a server-rendered results page that we parse with BeautifulSoup.
"""

from __future__ import annotations

import io
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus, urlparse, parse_qs, unquote

import requests
from bs4 import BeautifulSoup

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "docs" / "rockwell"
LOG_PATH = REPO / "docs" / "scraper.log"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

QUERIES: list[tuple[str, str]] = [
    ("9328-UM001", "9328-UM001 Connected Components Workbench filetype:pdf"),
    ("9328-QS003", "9328-QS003 Connected Components Workbench Quick Start filetype:pdf"),
    ("2080-PM001", "2080-PM001 Micro800 programming manual filetype:pdf"),
    ("2080-AT002", "2080-AT002 Micro820 architecture tech note filetype:pdf"),
    ("2080-QR002", "2080-QR002 Micro800 quick reference filetype:pdf"),
    ("2080-IN004", "2080-IN004 Micro820 installation filetype:pdf"),
    ("2080-RN024", "2080-RN024 Micro820 firmware release notes filetype:pdf"),
    ("1756-PM020", "1756-PM020 Logix 5000 Structured Text Programming filetype:pdf"),
]


def already_have(pub: str) -> bool:
    return any(OUT_DIR.glob(f"{pub}_-en-*.pdf"))


def search_ddg(session: requests.Session, query: str) -> list[str]:
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    try:
        r = session.post("https://html.duckduckgo.com/html/", data={"q": query}, timeout=25)
    except Exception as exc:
        print(f"  ddg fail: {exc}")
        return []
    if r.status_code != 200:
        print(f"  ddg http {r.status_code}")
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    links: list[str] = []
    for a in soup.select("a.result__a"):
        href = a.get("href", "")
        if not href:
            continue
        # DDG wraps in a redirector ?uddg=...
        parsed = urlparse(href)
        q = parse_qs(parsed.query)
        if "uddg" in q:
            links.append(unquote(q["uddg"][0]))
        else:
            links.append(href)
    return links


def looks_like_pub_pdf(url: str, pub: str) -> bool:
    u = url.lower()
    return u.endswith(".pdf") and pub.lower() in u


def download(session: requests.Session, url: str, pub: str) -> bool:
    out = OUT_DIR / f"{pub}_-en-ddg.pdf"
    try:
        r = session.get(url, timeout=45, stream=True, allow_redirects=True)
    except Exception as exc:
        print(f"  download fail: {exc}")
        return False
    if r.status_code != 200:
        print(f"  http {r.status_code}")
        return False
    first = r.raw.read(8, decode_content=True) if r.raw else b""
    if not first.startswith(b"%PDF"):
        r.close()
        print(f"  not-pdf {url}")
        return False
    with open(out, "wb") as fh:
        fh.write(first)
        for chunk in r.iter_content(chunk_size=64 * 1024):
            if chunk:
                fh.write(chunk)
    r.close()
    (OUT_DIR / f"{pub}_-en-ddg.meta.json").write_text(
        json.dumps(
            {
                "publication": pub,
                "source_url": url,
                "downloaded_at": datetime.now(timezone.utc).isoformat(),
                "found_by": "ddg_search",
            },
            indent=2,
        )
    )
    print(f"  OK {out.name} ({out.stat().st_size / 1024:.0f} KiB)")
    return True


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log_fh = open(LOG_PATH, "a", encoding="utf-8")
    log_fh.write(f"\n=== DDG fallback search {datetime.now(timezone.utc).isoformat()} ===\n")
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    wins = 0
    for pub, q in QUERIES:
        if already_have(pub):
            print(f"SKIP {pub}")
            continue
        print(f"--- {pub}: {q}")
        log_fh.write(f"--- {pub}: {q}\n")
        links = search_ddg(session, q)
        # Prefer exact pub matches first, then any PDF from rockwellautomation.com
        ordered = (
            [u for u in links if looks_like_pub_pdf(u, pub)]
            + [u for u in links if u.lower().endswith(".pdf") and "rockwellautomation" in u.lower()]
            + [u for u in links if u.lower().endswith(".pdf")]
        )
        hit = False
        for url in ordered[:5]:
            print(f"  try {url}")
            if download(session, url, pub):
                wins += 1
                hit = True
                break
            time.sleep(0.5)
        if not hit:
            print(f"  no usable result")
        time.sleep(2.0)  # be polite

    log_fh.write(f"DDG pass: {wins} new files\n")
    log_fh.close()
    print(f"DDG pass done: {wins} new files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
