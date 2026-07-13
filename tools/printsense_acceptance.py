#!/usr/bin/env python3
"""Run the full PrintSense staging acceptance suite and emit one report.

Three layers, run in order:
  1. FREE deterministic render tests (always) — no model calls.
  2. PAID metamorphic matrix (only with PRINTSENSE_PAID=1 + corpus images).
  3. LIVE Telegram staging E2E (only with TELEGRAM_TEST_* creds present).
Then a concise Markdown + HTML acceptance report from the layer-3 records.

This is a *pre-release* command: it exercises the deployed STAGING bot; it never
deploys and never touches production secrets. Credentials come from the
environment (Doppler-injected) and are never printed.

Usage:
  py -3 tools/printsense_acceptance.py                 # free layer + report
  PRINTSENSE_PAID=1 py -3 tools/printsense_acceptance.py   # + paid metamorphic
  doppler run -p factorylm -c stg -- py -3 tools/printsense_acceptance.py  # + live E2E
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from printsense.harness import report, telethon_e2e  # noqa: E402

_E2E_DIR = _ROOT / "printsense" / "benchmarks" / "_e2e_out"
_OUT_DIR = _ROOT / "printsense" / "benchmarks" / "_acceptance_out"


def _run(label: str, argv: list[str]) -> tuple[int, str]:
    print(f"\n─── {label} ───", flush=True)
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", *argv, "-q"],
        cwd=str(_ROOT),
        capture_output=True,
        text=True,
    )
    tail = "\n".join((proc.stdout or "").strip().splitlines()[-8:])
    print(tail, flush=True)
    if proc.returncode not in (0, 5):  # 5 == pytest "no tests collected" (all skipped)
        print((proc.stderr or "").strip()[-1000:], flush=True)
    return proc.returncode, tail


def main() -> int:
    import os

    # Layer 1 — free deterministic (always).
    rc1, sum1 = _run("Layer 1 — free deterministic render", ["tests/printsense/test_render_corpus.py"])

    # Layer 2 — paid metamorphic (only if opted in).
    sum2 = "skipped (set PRINTSENSE_PAID=1 + PRINTSENSE_CORPUS_IMAGES)"
    rc2 = 0
    if os.getenv("PRINTSENSE_PAID") == "1":
        rc2, sum2 = _run("Layer 2 — paid metamorphic matrix", ["tests/printsense/test_metamorphic.py"])

    # Layer 3 — live staging E2E (only if creds present). Fresh records each run.
    rc3 = 0
    if telethon_e2e.creds_available():
        for stale in _E2E_DIR.glob("*.e2e.json"):
            stale.unlink()
        rc3, _ = _run("Layer 3 — live staging E2E", ["tests/printsense/test_staging_e2e.py"])
    else:
        print("\n─── Layer 3 — live staging E2E ───\nSKIPPED: TELEGRAM_TEST_* creds absent.", flush=True)

    report_path = report.write_report(
        _OUT_DIR,
        _E2E_DIR,
        layer1_summary=f"{'PASS' if rc1 in (0, 5) else 'FAIL'} — {sum1.splitlines()[-1] if sum1 else ''}",
        layer2_summary=sum2 if rc2 in (0, 5) else f"FAIL — {sum2}",
    )
    print(f"\n📄 acceptance report → {report_path}", flush=True)
    print(f"   ({report_path.with_suffix('.html')})", flush=True)

    # Free layer is the release-blocking floor; paid/E2E block only when they actually ran.
    return 0 if all(rc in (0, 5) for rc in (rc1, rc2, rc3)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
