#!/usr/bin/env python3
"""Populate the PrintSense corpus IMAGES dir from a configured source.

The corpus *graphs/rubrics* are committed under ``printsense/benchmarks/`` and drive
the free Layer-1 tests. The corpus *source photos* are deliberately NOT in git
(customer prints); the paid Layer-2 and live Layer-3 layers resolve them from the
directory named by ``$PRINTSENSE_CORPUS_IMAGES`` and verify each against the sha256
prefix pinned in ``corpus_manifest.json``.

This tool fills that directory from ONE of (checked in order):
  * ``$PRINTSENSE_CORPUS_DIR``  — a local/mounted directory to copy from, or
  * ``$PRINTSENSE_CORPUS_URL``  — a .tar.gz to download + extract.
It then verifies every manifest image is present with the right hash. If neither
source is set, it prints guidance and exits 0 — the paid/E2E layers SKIP cleanly
(they are gated on image availability), so this never breaks a run by its absence.

No secrets are embedded here; the source location is injected via env (Doppler).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from printsense.harness import corpus  # noqa: E402


def _dest() -> Path:
    root = os.getenv("PRINTSENSE_CORPUS_IMAGES")
    if not root:
        print("PRINTSENSE_CORPUS_IMAGES not set — nothing to sync into. Paid/E2E layers will skip.")
        raise SystemExit(0)
    d = Path(root)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _from_dir(src: Path, dest: Path) -> None:
    for c in corpus.cases():
        if not c.image_file:
            continue
        s = src / c.image_file
        if s.exists():
            shutil.copy2(s, dest / c.image_file)


def _from_url(url: str, dest: Path) -> None:
    tmp = dest / "_corpus.tar.gz"
    urllib.request.urlretrieve(url, tmp)  # noqa: S310 — operator-supplied trusted URL
    with tarfile.open(tmp) as tf:
        tf.extractall(dest, filter="data")
    tmp.unlink(missing_ok=True)


def main() -> int:
    require = "--require" in sys.argv  # fail-closed: no-source, any mismatch, or empty corpus → error
    dest = _dest()
    if src := os.getenv("PRINTSENSE_CORPUS_DIR"):
        _from_dir(Path(src), dest)
    elif url := os.getenv("PRINTSENSE_CORPUS_URL"):
        _from_url(url, dest)
    else:
        msg = "No corpus source (set PRINTSENSE_CORPUS_DIR or PRINTSENSE_CORPUS_URL)."
        if require:
            print(f"::error::{msg} --require given → failing closed.")
            return 2
        print(f"{msg} Paid/E2E layers will skip.")
        return 0

    missing, bad, ok = [], [], 0
    for c in corpus.cases():
        if not c.image_file:
            continue
        p = dest / c.image_file
        if not p.exists():
            missing.append(c.image_file)
            continue
        digest = hashlib.sha256(p.read_bytes()).hexdigest()
        if c.image_sha256_prefix and not digest.startswith(c.image_sha256_prefix):
            bad.append(c.image_file)
        else:
            ok += 1
    print(f"corpus sync: {ok} verified, {len(missing)} missing (skip cleanly), {len(bad)} hash-mismatch → {dest}")
    # Fail closed on tampering (present-but-wrong hash) ALWAYS. Under --require also fail
    # if the source yielded NO verified images (broken/empty source). Legitimately-absent
    # optional images (e.g. sheet16/sheet18, no source photo) are tolerated — they skip.
    if bad:
        print(f"::error::corpus image hash MISMATCH — not the pinned input, refusing to use: {bad}")
        return 1
    if require and ok == 0:
        print("::error::--require given but ZERO corpus images verified — source empty/broken.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
