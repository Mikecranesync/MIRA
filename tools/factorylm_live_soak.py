"""FactoryLM live-overlay soak — N deterministic turn-shaped runs, target 100%.

Born from the 2026-08-02 live probe: the first real phone turn missed because
nothing populated ``uns_context.uns_path`` for an equipment-name asset. This
soak drives the REAL engine seam (``Supervisor._build_factorylm_live_overlay``
→ ``uns_prefix_for_asset`` fallback → ``fetch_live_signal_cache`` →
``overlay_from_cache_rows``) plus the context fold
(``augment_with_live`` → ``manifest_of`` → ``live_prompt_block``) against the
real database, N times, and reports the pass rate. No LLM calls — the parts
that must be 100% are deterministic plumbing; prose variance is not measured
here.

Run (staging):
    doppler run --project factorylm --config stg -- \
        python tools/factorylm_live_soak.py --iterations 1000 --asset CV-101 \
        --tenant 78917b56-f85f-43bb-9a08-1bb98a6cd6c3

Celery: ``run_soak`` is a plain callable returning a JSON-safe dict — register
it on the Alpha worker with ``@app.task(name="factorylm.live_soak")(run_soak)``
if a scheduled soak is wanted; nothing here imports Celery.

Read-only: SELECTs only, no plant connection, no writes.
"""

from __future__ import annotations

import argparse
import asyncio
import concurrent.futures
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "mira-bots"))

# Engine flags are read at import time — set before importing shared.engine.
os.environ.setdefault("MIRA_FACTORYLM_LIVE", "1")
os.environ.setdefault("MIRA_CONTEXT_CONTRACT", "1")

_url = os.environ.get("NEON_DATABASE_URL", "")
if _url:  # Windows psycopg2 chokes on channel_binding — strip it (known gotcha)
    parts = urlsplit(_url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k != "channel_binding"]
    os.environ["NEON_DATABASE_URL"] = urlunsplit(parts._replace(query=urlencode(query)))


def _one_turn(tenant_id: str, asset: str) -> tuple[bool, str]:
    """One turn-shaped run. Returns (ok, failure_reason)."""
    from unittest.mock import MagicMock

    import shared.engine as engine
    from shared.technician_context import (
        augment_with_live,
        build_turn_context,
        live_prompt_block,
        manifest_of,
    )

    state = {"asset_identified": asset, "context": {"asset_tag": asset}}
    overlay = asyncio.run(
        engine.Supervisor._build_factorylm_live_overlay(MagicMock(), state, tenant_id)
    )
    if overlay is None:
        return False, "no_overlay"
    if len(overlay.tags) != 7:
        return False, f"tag_count_{len(overlay.tags)}"
    if not overlay.machine_state or overlay.machine_state == "unknown":
        return False, f"machine_state_{overlay.machine_state!r}"

    ctx, violations = build_turn_context(
        tenant_id=tenant_id,
        question="what is the current state of the conveyor?",
        uns_context={"uns_path": None, "source": "chat_resolver"},
        prior_decisions=[],
    )
    if ctx is None:
        return False, f"no_base_ctx:{violations}"
    combined, violations = augment_with_live(ctx, overlay)
    if combined is None:
        return False, f"augment_failed:{violations}"
    payload, sha = manifest_of(combined)
    if not payload.get("live") or len(payload["live"]["tags"]) != 7:
        return False, "manifest_missing_live"
    block = live_prompt_block(combined.live)
    if not block or "conv_simple.motor_run" not in block:
        return False, "live_block_not_rendered"
    payload2, sha2 = manifest_of(combined)
    if sha != sha2:
        return False, "manifest_nondeterministic"
    return True, ""


def run_soak(
    iterations: int = 1000,
    tenant_id: str = "",
    asset: str = "CV-101",
    workers: int = 8,
) -> dict:
    """Run the soak; returns a JSON-safe result dict. 100% or it isn't done."""
    if not tenant_id:
        raise SystemExit("tenant_id is required")
    started = time.time()
    reasons: Counter[str] = Counter()
    passed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_one_turn, tenant_id, asset) for _ in range(iterations)]
        for i, fut in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                ok, reason = fut.result()
            except Exception as exc:  # noqa: BLE001 — a crash is a failure, count it
                ok, reason = False, f"exception:{type(exc).__name__}"
            if ok:
                passed += 1
            else:
                reasons[reason] += 1
            if i % 100 == 0:
                print(f"  {i}/{iterations} — {passed} passed", flush=True)
    result = {
        "iterations": iterations,
        "passed": passed,
        "failed": iterations - passed,
        "pass_rate": round(100.0 * passed / iterations, 3),
        "failure_reasons": dict(reasons),
        "elapsed_s": round(time.time() - started, 1),
        "asset": asset,
    }
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--iterations", type=int, default=1000)
    ap.add_argument("--tenant", required=True)
    ap.add_argument("--asset", default="CV-101")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    out = run_soak(args.iterations, args.tenant, args.asset, args.workers)
    sys.exit(0 if out["pass_rate"] == 100.0 else 1)
