"""Harder-to-find Rockwell publications that the generic scraper missed.

Tries a wider net per publication: every revision letter a..p on every known
type folder (um/rm/in/wd/sg/qr/qs/at/pm/ap/pp/ca/ma/sp/td/ug), on both the
classic IDC host and the newer DAM CDN.

Usage:
    python scripts/fetch_rockwell_one_offs.py
"""

from __future__ import annotations

import io
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "docs" / "rockwell"
LOG_PATH = REPO / "docs" / "scraper.log"
USER_AGENT = "MIRA-Docs-Fetcher/1.0 (+research; contact:harperhousebuyers@gmail.com)"

# Candidates for publications still missing after the generic pass.
# Each row = (pub, suspected_type_folder, title). The script will also try
# every other type folder in case the suspected one is wrong.
MISSING: list[tuple[str, str, str]] = [
    ("9328-UM001", "um", "Connected Components Workbench Software User Manual"),
    ("9328-QS003", "qs", "Connected Components Workbench Quick Start"),
    ("2080-PM001", "pm", "Micro800 Programmable Controllers Programming Manual"),
    ("2080-AT002", "at", "Micro820 PLC Architecture Tech Note"),
    ("2080-QR002", "qr", "Micro800 Controllers Quick Reference"),
    ("2080-IN004", "in", "Micro820 Installation Instructions"),
    # also try a few high-value add-ons we didn't even attempt the first run:
    ("2080-AT003", "at", "Micro800 Motion Tech Note"),
    ("2080-RN024", "rn", "Micro820 Firmware Release Notes"),
    ("1756-PM020", "pm", "Logix 5000 Controllers Structured Text Programming"),
    ("1756-RM009", "rm", "Logix 5000 Controllers I/O and Tag Data Reference"),
    ("MICRO-AT001", "at", "Micro800 Overview Tech Note"),
]

TYPE_FALLBACKS = ["um", "rm", "in", "wd", "sg", "qr", "qs", "at", "pm", "rn", "ap", "pp", "ca", "ma", "sp", "td", "ug"]
REV_CANDIDATES = list("pnmlkjihgfedcba")
HOSTS = [
    "https://literature.rockwellautomation.com/idc/groups/literature/documents",
    "https://www.rockwellautomation.com/content/dam/rockwell-automation/documents/en-us",
]


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=15),
    retry=retry_if_exception_type((requests.exceptions.ConnectionError, requests.exceptions.Timeout)),
    reraise=True,
)
def head_or_get(session: requests.Session, url: str) -> requests.Response:
    return session.get(url, timeout=20, allow_redirects=True, stream=True)


def try_pub(session: requests.Session, log_fh, pub: str, primary_type: str, title: str) -> bool:
    for existing in OUT_DIR.glob(f"{pub}_-en-*.pdf"):
        log_fh.write(f"SKIP {pub} — already have {existing.name}\n")
        return True

    # Ordered attempt: primary type first, then fallbacks, across hosts, across revs
    type_order = [primary_type] + [t for t in TYPE_FALLBACKS if t != primary_type]
    pub_lower = pub.lower()
    tried = 0
    for host in HOSTS:
        for t in type_order:
            for rev in REV_CANDIDATES:
                if "idc/groups" in host:
                    url = f"{host}/{t}/{pub_lower}_-en-{rev}.pdf"
                else:
                    # DAM path uses a slightly different naming that varies; try both
                    url = f"{host}/{pub_lower}_-en-{rev}.pdf"
                tried += 1
                try:
                    resp = head_or_get(session, url)
                except Exception as exc:
                    resp = None
                    log_fh.write(f"  net-fail {url}: {exc}\n")
                    continue
                if resp.status_code == 200:
                    first = resp.raw.read(8, decode_content=True) if resp.raw else b""
                    if not first.startswith(b"%PDF"):
                        resp.close()
                        continue
                    out = OUT_DIR / f"{pub}_-en-{rev}.pdf"
                    with open(out, "wb") as fh:
                        fh.write(first)
                        for chunk in resp.iter_content(chunk_size=64 * 1024):
                            if chunk:
                                fh.write(chunk)
                    resp.close()
                    (OUT_DIR / f"{pub}_-en-{rev}.meta.json").write_text(
                        json.dumps(
                            {
                                "publication": pub,
                                "revision": rev,
                                "title": title,
                                "source_url": url,
                                "downloaded_at": datetime.now(timezone.utc).isoformat(),
                                "found_by": "one_offs_script",
                            },
                            indent=2,
                        )
                    )
                    line = f"OK  {pub} <- {url}  ({out.stat().st_size / 1024:.0f} KiB, after {tried} tries)\n"
                    print(line, end="")
                    log_fh.write(line)
                    return True
                resp.close()
                # don't hammer
                if tried % 25 == 0:
                    time.sleep(0.3)
    line = f"MISS {pub} after {tried} URL probes\n"
    print(line, end="")
    log_fh.write(line)
    return False


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log_fh = open(LOG_PATH, "a", encoding="utf-8")
    log_fh.write(f"\n=== One-off Rockwell fetch {datetime.now(timezone.utc).isoformat()} ===\n")
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*"})
    wins = 0
    for pub, ptype, title in MISSING:
        print(f"--- {pub}: {title} ---")
        log_fh.write(f"--- {pub} ---\n")
        if try_pub(session, log_fh, pub, ptype, title):
            wins += 1
        time.sleep(0.5)
    print(f"One-offs done: {wins}/{len(MISSING)}")
    log_fh.write(f"One-offs done: {wins}/{len(MISSING)}\n")
    log_fh.close()
    return 0 if wins > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
