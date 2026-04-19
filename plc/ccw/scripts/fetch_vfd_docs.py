"""Download AutomationDirect GS10 DURApulse documentation.

Usage:
    python scripts/fetch_vfd_docs.py
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "docs" / "vfd"
LOG_PATH = REPO / "docs" / "scraper.log"
USER_AGENT = "MIRA-Docs-Fetcher/1.0 (+research; contact:harperhousebuyers@gmail.com)"

# Known direct URLs to GS10 publications. AutomationDirect hosts these on its
# public CDN without authentication.
DOCS: list[tuple[str, str, str]] = [
    # filename (local), URL, human title
    (
        "GS10_UM.pdf",
        "https://cdn.automationdirect.com/static/manuals/gs10m/gs10m.pdf",
        "GS10 Series DURApulse AC Drive User Manual",
    ),
    (
        "GS10_quickstart.pdf",
        "https://cdn.automationdirect.com/static/specs/gs10specs.pdf",
        "GS10 Series Specifications / Quick Start",
    ),
    (
        "GS10_modbus_register_list.pdf",
        "https://cdn.automationdirect.com/static/manuals/gs10m/ch06.pdf",
        "GS10 User Manual Ch6 – Maintenance (contains register tables)",
    ),
]


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=20),
    retry=retry_if_exception_type((requests.exceptions.ConnectionError, requests.exceptions.Timeout)),
    reraise=True,
)
def fetch(session: requests.Session, url: str) -> requests.Response:
    return session.get(url, timeout=30, allow_redirects=True, stream=True)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    log_lines = [f"\n=== GS10 fetch run {datetime.now(timezone.utc).isoformat()} ==="]
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*"})
    wins = 0
    for filename, url, title in DOCS:
        out = OUT_DIR / filename
        if out.exists():
            log_lines.append(f"SKIP {filename} — already present")
            wins += 1
            continue
        log_lines.append(f"GET  {url}")
        try:
            resp = fetch(session, url)
        except Exception as exc:
            log_lines.append(f"  FAIL {url} — {exc}")
            continue
        if resp.status_code != 200:
            log_lines.append(f"  http {resp.status_code} {url}")
            resp.close()
            continue
        first = resp.raw.read(8, decode_content=True) if resp.raw else b""
        if not first.startswith(b"%PDF"):
            log_lines.append(f"  not-pdf {url}")
            resp.close()
            continue
        with open(out, "wb") as fh:
            fh.write(first)
            for chunk in resp.iter_content(chunk_size=64 * 1024):
                if chunk:
                    fh.write(chunk)
        resp.close()
        (OUT_DIR / f"{filename}.meta.json").write_text(
            json.dumps(
                {
                    "title": title,
                    "source_url": url,
                    "downloaded_at": datetime.now(timezone.utc).isoformat(),
                },
                indent=2,
            )
        )
        log_lines.append(f"OK   {filename}  ({out.stat().st_size / 1024:.0f} KiB)")
        wins += 1
        time.sleep(0.5)

    log_lines.append(f"GS10 run done: {wins}/{len(DOCS)} acquired.")
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write("\n".join(log_lines) + "\n")
    for line in log_lines:
        print(line)
    return 0 if wins > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
