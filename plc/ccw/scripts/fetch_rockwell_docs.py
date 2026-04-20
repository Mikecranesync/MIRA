"""Download Rockwell Automation publications relevant to the MIRA stack.

Probes the handful of URL patterns Rockwell uses for their literature CDN,
downloads the PDF on the first 200 response, and logs every attempt.

Usage:
    python scripts/fetch_rockwell_docs.py
"""

from __future__ import annotations

import io
import json
import sys
import time

# Force UTF-8 stdout on Windows so any printed characters don't crash cp1252
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
from datetime import datetime, timezone
from pathlib import Path

import requests
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "docs" / "rockwell"
LOG_PATH = REPO / "docs" / "scraper.log"
USER_AGENT = "MIRA-Docs-Fetcher/1.0 (+research; contact:harperhousebuyers@gmail.com)"

# (publication, type_folder, human_title)
PUBS: list[tuple[str, str, str]] = [
    ("2080-UM004", "um", "Micro820 Programmable Controllers User Manual"),
    ("2080-UM005", "um", "Micro830/850/870 Programmable Controllers User Manual"),
    ("2080-UM002", "um", "Micro800 External AC Power Supply User Manual"),
    ("2080-UM003", "um", "Micro800 Remote LCD Module User Manual"),
    ("2080-RM001", "rm", "Micro800 Discrete/Analog/Specialty I/O Modules User Manual"),
    ("2080-RM002", "rm", "Micro800 Plug-in Modules User Manual"),
    ("2080-RM003", "rm", "Micro800 Programmable Controllers Instruction Set Reference"),
    ("2080-IN001", "in", "Micro820 Installation Instructions"),
    ("2080-IN004", "in", "Micro820 Installation Instructions"),
    ("2080-SG001", "sg", "Micro800 Family Selection Guide"),
    ("2080-WD005", "wd", "Micro820 Wiring Diagrams"),
    ("2080-QR002", "qr", "Micro800 Controllers Quick Reference"),
    ("2080-QS001", "qs", "Micro820 Quick Start"),
    ("2080-AT002", "at", "Micro820 PLC Architecture Tech Note"),
    ("2080-PM001", "pm", "Micro800 Programmable Controllers Programming Manual"),
    ("9328-UM001", "um", "Connected Components Workbench Software User Manual"),
    ("9328-QS003", "qs", "Connected Components Workbench Quick Start"),
]

# Revision letters newest→oldest; Rockwell appends -en-{rev} to every PDF URL.
REV_CANDIDATES = ["p", "n", "m", "l", "k", "e", "d", "c", "b", "a"]

URL_PATTERNS = [
    # classic IDC URL
    "https://literature.rockwellautomation.com/idc/groups/literature/documents/{type}/{pub_lower}_-en-{rev}.pdf",
    # newer CDN path (some 2024+ documents moved here)
    "https://www.rockwellautomation.com/content/dam/rockwell-automation/documents/en-us/{pub_lower}_-en-{rev}.pdf",
]


class Logger:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = open(self.path, "a", encoding="utf-8")
        self.fh.write(f"\n=== Rockwell fetch run {datetime.now(timezone.utc).isoformat()} ===\n")

    def log(self, msg: str) -> None:
        line = f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}"
        print(line)
        self.fh.write(line + "\n")
        self.fh.flush()

    def close(self) -> None:
        self.fh.close()


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=20),
    retry=retry_if_exception_type((requests.exceptions.ConnectionError, requests.exceptions.Timeout)),
    reraise=True,
)
def try_url(session: requests.Session, url: str) -> requests.Response:
    return session.get(url, timeout=30, allow_redirects=True, stream=True)


def is_pdf(content_start: bytes) -> bool:
    return content_start.startswith(b"%PDF")


def fetch_one(session: requests.Session, log: Logger, pub: str, ptype: str, title: str) -> tuple[bool, str | None]:
    target = OUT_DIR / f"{pub}_-en-{{rev}}.pdf"
    # idempotent: skip if we already have any revision of this publication
    for existing in OUT_DIR.glob(f"{pub}_-en-*.pdf"):
        log.log(f"SKIP {pub} — already have {existing.name}")
        return True, existing.name

    pub_lower = pub.lower()
    for pattern in URL_PATTERNS:
        for rev in REV_CANDIDATES:
            url = pattern.format(type=ptype, pub_lower=pub_lower, rev=rev)
            try:
                resp = try_url(session, url)
            except Exception as exc:  # network glitch after retries
                log.log(f"  FAIL {url} — {exc}")
                continue

            if resp.status_code == 200:
                first_chunk = resp.raw.read(8, decode_content=True) if resp.raw else b""
                if not is_pdf(first_chunk):
                    # consume rest to free connection, skip — not a real PDF
                    resp.close()
                    log.log(f"  not-pdf {url}")
                    continue
                out_path = OUT_DIR / f"{pub}_-en-{rev}.pdf"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                with open(out_path, "wb") as f:
                    f.write(first_chunk)
                    for chunk in resp.iter_content(chunk_size=64 * 1024):
                        if chunk:
                            f.write(chunk)
                resp.close()
                log.log(f"OK  {pub} rev {rev} <- {url}  ({out_path.stat().st_size / 1024:.0f} KiB)")
                # write a sidecar with title + source URL
                (OUT_DIR / f"{pub}_-en-{rev}.meta.json").write_text(
                    json.dumps(
                        {
                            "publication": pub,
                            "revision": rev,
                            "title": title,
                            "source_url": url,
                            "downloaded_at": datetime.now(timezone.utc).isoformat(),
                        },
                        indent=2,
                    )
                )
                return True, out_path.name

            if resp.status_code != 404:
                log.log(f"  http {resp.status_code} {url}")
            resp.close()
            time.sleep(0.2)  # polite client

    log.log(f"MISS {pub} — no working URL found")
    return False, None


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    log = Logger(LOG_PATH)
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*"})

    wins = 0
    total = len(PUBS)
    for pub, ptype, title in PUBS:
        log.log(f"--- {pub}: {title} ---")
        ok, _ = fetch_one(session, log, pub, ptype, title)
        if ok:
            wins += 1
        time.sleep(0.5)  # gap between pubs

    log.log(f"Rockwell run done: {wins}/{total} publications acquired.")
    log.close()
    return 0 if wins > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
