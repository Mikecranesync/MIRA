"""Fetch the T2108 (eufy RoboVac 11S) owner's manual from the official CDN.

See README.md in this directory for identity/provenance. The binary is
gitignored; this script is the reproducible way to materialize it. A SHA-256
mismatch is a hard failure — the fixture's identity is pinned to revision V02.

Run: py tests/beta/fixtures/t2108/fetch.py
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import httpx

URL = (
    "https://d2211byn0pk9fi.cloudfront.net/spree/accessories/attachments/72623/"
    "T2108_Manual_51005000959_20180525_148x210mm_V02_EN.pdf?1533028783="
)
EXPECTED_SHA256 = "b2e7912ed063dd118eb8db05060c2c30f18865e60ea0b33d609cf6cf473b506e"
DEST = Path(__file__).parent / "T2108_Manual_EN.pdf"


def main() -> int:
    if DEST.exists():
        digest = hashlib.sha256(DEST.read_bytes()).hexdigest()
        if digest == EXPECTED_SHA256:
            print(f"already present and verified: {DEST}")
            return 0
        print(f"present but WRONG hash ({digest}) — re-downloading")

    print(f"fetching {URL}")
    resp = httpx.get(URL, follow_redirects=True, timeout=120)
    resp.raise_for_status()
    digest = hashlib.sha256(resp.content).hexdigest()
    if digest != EXPECTED_SHA256:
        print(
            "SHA-256 mismatch — refusing to write.\n"
            f"  expected {EXPECTED_SHA256}\n"
            f"  got      {digest}\n"
            "eufy may have revised the document; record it as a NEW fixture revision.",
            file=sys.stderr,
        )
        return 1
    DEST.write_bytes(resp.content)
    print(f"wrote {DEST} ({len(resp.content)} bytes, sha256 verified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
