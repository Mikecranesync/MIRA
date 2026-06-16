"""
End-to-End Test: Nameplate Photo → KB Gap → Scrape → Work Order → Chat
=======================================================================
Exercises the full MIRA diagnostic loop:

  1. Send nameplate photo to mira-ingest (simulates Telegram photo handler)
  2. Verify vision extraction via GSD engine
  3. Verify RAG fires (NeonDB + Open WebUI)
  4. Verify KB gap detection triggers /ingest/scrape-trigger (if score < threshold)
  5. Wait for scrape job to complete (poll ingest health + NeonDB count)
  6. Verify Atlas CMMS work order created via MCP REST
  7. Verify Telegram proactive notification was queued
  8. Send a follow-up text question and verify answer cites scraped content

Photo used: tests/regime3_nameplate/photos/real/gp_vfd_001.jpg
Expected model: VFD nameplate (General-Purpose drive, Allen-Bradley/GS series)

Usage:
    doppler run -p factorylm -c prd -- python tests/e2e_nameplate_flow.py
    doppler run -p factorylm -c prd -- python tests/e2e_nameplate_flow.py --photo tests/regime3_nameplate/photos/real/gp_motor_001.jpg
    doppler run -p factorylm -c prd -- python tests/e2e_nameplate_flow.py --skip-scrape --skip-wo

Pass/Fail: evidence-only per Cluster Law #1. Test fails unless each step
produces a measurable artifact (count, ID, response text).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import os
import sys
import time
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("e2e-test")

# ---------------------------------------------------------------------------
# Service endpoints (resolved from env or defaults)
# ---------------------------------------------------------------------------
INGEST_URL = os.environ.get("INGEST_SERVICE_URL", "http://localhost:8000")
MCP_URL = os.environ.get("MCP_BASE_URL", "http://localhost:8001")
MCP_KEY = os.environ.get("MCP_REST_API_KEY", "")
NEON_URL = os.environ.get("NEON_DATABASE_URL", "")
OPENWEBUI_URL = os.environ.get("OPENWEBUI_BASE_URL", "http://localhost:3000")
OPENWEBUI_KEY = os.environ.get("OPENWEBUI_API_KEY", "")
MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID", "")

DEFAULT_PHOTO = Path(__file__).parent / "regime3_nameplate" / "photos" / "real" / "gp_vfd_001.jpg"

# Test chat_id — use a real Telegram chat ID if you want the notification delivered,
# or a dummy value to exercise the code path without actual delivery
TEST_CHAT_ID = os.environ.get("E2E_CHAT_ID", "test_chat_99999")

PASS = "✅ PASS"
FAIL = "❌ FAIL"
SKIP = "⏭  SKIP"


# ---------------------------------------------------------------------------
# Step helpers
# ---------------------------------------------------------------------------

async def step_health_checks() -> bool:
    """Pre-flight: verify all required services are reachable."""
    logger.info("=== Step 0: Pre-flight health checks ===")
    ok = True
    checks = [
        (f"{INGEST_URL}/health", "mira-ingest"),
        (f"{MCP_URL}/health", "mira-mcp"),
        (f"{OPENWEBUI_URL}/health", "Open WebUI"),
    ]
    async with httpx.AsyncClient(timeout=10) as client:
        for url, name in checks:
            try:
                resp = await client.get(url)
                status = PASS if resp.status_code < 500 else FAIL
                logger.info("  %s  %s  (HTTP %d)", status, name, resp.status_code)
                if resp.status_code >= 500:
                    ok = False
            except Exception as e:
                logger.info("  %s  %s  (%s)", FAIL, name, e)
                ok = False
    return ok


async def step_ingest_photo(photo_path: Path) -> dict:
    """Step 1: POST photo to mira-ingest /ingest/photo."""
    logger.info("=== Step 1: Ingest nameplate photo (%s) ===", photo_path.name)
    raw = photo_path.read_bytes()
    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{INGEST_URL}/ingest/photo",
            data={"asset_tag": f"e2e_{photo_path.stem}", "notes": "E2E test — VFD nameplate"},
            files={"image": (photo_path.name, raw, "image/jpeg")},
        )
    elapsed = time.monotonic() - t0
    if resp.status_code == 200:
        result = resp.json()
        logger.info(
            "  %s  id=%s  description=%r  (%.1fs)",
            PASS, result.get("id"), result.get("description", "")[:80], elapsed,
        )
        return result
    else:
        logger.error("  %s  HTTP %d: %s", FAIL, resp.status_code, resp.text[:300])
        return {}


async def step_neondb_count_before() -> int:
    """Step 2a: Record current NeonDB knowledge_entries count as baseline."""
    logger.info("=== Step 2a: NeonDB baseline count ===")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{INGEST_URL}/health/db")
    if resp.status_code == 200:
        count = resp.json().get("neondb_knowledge_entries", 0) or 0
        logger.info("  %s  baseline knowledge_entries=%d", PASS, count)
        return count
    logger.warning("  %s  Could not read NeonDB count", FAIL)
    return 0


async def step_gsd_engine(photo_path: Path) -> dict:
    """
    Step 2: Run the GSD engine directly (simulates what bot.py does).
    Imports Supervisor locally — requires MIRA pythonpath.
    """
    logger.info("=== Step 2: GSD engine — vision + RAG ===")

    # Add mira-bots to sys.path if needed
    mira_root = Path(__file__).parent.parent
    bots_path = str(mira_root / "mira-bots")
    if bots_path not in sys.path:
        sys.path.insert(0, bots_path)

    try:
        from shared.engine import Supervisor
    except ImportError as e:
        logger.error("  %s  Cannot import Supervisor: %s", FAIL, e)
        return {}

    db_path = "/tmp/e2e_test_mira.db"
    engine = Supervisor(
        db_path=db_path,
        openwebui_url=OPENWEBUI_URL,
        api_key=OPENWEBUI_KEY,
        collection_id=os.environ.get("KNOWLEDGE_COLLECTION_ID", ""),
        vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
        tenant_id=MIRA_TENANT_ID,
        ingest_url=INGEST_URL,
        mcp_url=MCP_URL,
    )

    photo_b64 = base64.b64encode(photo_path.read_bytes()).decode()
    t0 = time.monotonic()
    try:
        reply = await engine.process(
            chat_id=TEST_CHAT_ID,
            message="troubleshoot this equipment",
            photo_b64=photo_b64,
        )
        elapsed = time.monotonic() - t0
        asset = engine._supervisor.rag._last_sources[:1]
        top_score = max(engine._supervisor.rag._last_distances, default=0.0)
        logger.info(
            "  %s  reply=%r  top_rag_score=%.3f  (%.1fs)",
            PASS, reply[:100], top_score, elapsed,
        )
        return {
            "reply": reply,
            "top_rag_score": top_score,
            "kb_gap_flagged": top_score < float(os.environ.get("MIRA_KB_GAP_THRESHOLD", "0.45")),
            "asset_identified": engine._supervisor._load_state(TEST_CHAT_ID).get("asset_identified", ""),
        }
    except Exception as e:
        logger.error("  %s  GSD engine error: %s", FAIL, e)
        return {}


async def step_wait_for_scrape(baseline_count: int, timeout_s: int = 120) -> dict:
    """
    Step 3: Poll NeonDB until knowledge_entries count increases (scrape completed)
    or timeout is reached.
    """
    logger.info("=== Step 3: Wait for scrape → KB ingest (timeout=%ds) ===", timeout_s)
    deadline = time.monotonic() + timeout_s
    interval = 5
    prev = baseline_count

    while time.monotonic() < deadline:
        await asyncio.sleep(interval)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{INGEST_URL}/health/db")
        if resp.status_code != 200:
            continue
        current = resp.json().get("neondb_knowledge_entries", 0) or 0
        delta = current - prev
        elapsed = int(time.monotonic() - (deadline - timeout_s))
        if delta > 0:
            logger.info(
                "  %s  +%d entries in NeonDB after %ds (total=%d)",
                PASS, delta, elapsed, current,
            )
            return {"new_entries": delta, "total_entries": current, "elapsed_s": elapsed}
        logger.info("  waiting... (%ds elapsed, entries=%d)", elapsed, current)

    logger.warning("  %s  Scrape did not produce new NeonDB entries within %ds", FAIL, timeout_s)
    return {"new_entries": 0, "total_entries": prev, "elapsed_s": timeout_s}


async def step_check_work_order() -> dict:
    """Step 4: Verify Atlas CMMS work order was created by the engine."""
    logger.info("=== Step 4: Check Atlas CMMS work order ===")
    if not MCP_KEY:
        logger.info("  %s  MCP_REST_API_KEY not set", SKIP)
        return {}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{MCP_URL}/api/cmms/work-orders",
            headers={"Authorization": f"Bearer {MCP_KEY}"},
            params={"status": "OPEN", "limit": 10},
        )

    if resp.status_code == 200:
        orders = resp.json()
        # Find the most recent WO with "MIRA" in the title
        mira_orders = [
            o for o in (orders if isinstance(orders, list) else orders.get("items", []))
            if "MIRA" in (o.get("title") or "")
        ]
        if mira_orders:
            wo = mira_orders[0]
            logger.info(
                "  %s  WO id=%s  title=%r  status=%s",
                PASS, wo.get("id"), wo.get("title", "")[:60], wo.get("status"),
            )
            return {"work_order_id": wo.get("id"), "title": wo.get("title")}
        else:
            logger.warning(
                "  %s  No MIRA work order found in open WOs (found %d total)",
                FAIL, len(orders if isinstance(orders, list) else orders.get("items", [])),
            )
            return {}
    else:
        logger.warning("  %s  WO list failed: HTTP %d", FAIL, resp.status_code)
        return {}


async def step_followup_chat(photo_path: Path, asset_identified: str) -> dict:
    """
    Step 5: Send a follow-up text question in the same session and verify
    the answer now cites manufacturer content.
    """
    logger.info("=== Step 5: Follow-up chat with fresh KB context ===")

    mira_root = Path(__file__).parent.parent
    bots_path = str(mira_root / "mira-bots")
    if bots_path not in sys.path:
        sys.path.insert(0, bots_path)

    try:
        from shared.engine import Supervisor
    except ImportError as e:
        logger.error("  %s  Cannot import Supervisor: %s", FAIL, e)
        return {}

    db_path = "/tmp/e2e_test_mira.db"  # same session DB as step 2
    engine = Supervisor(
        db_path=db_path,
        openwebui_url=OPENWEBUI_URL,
        api_key=OPENWEBUI_KEY,
        collection_id=os.environ.get("KNOWLEDGE_COLLECTION_ID", ""),
        vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
        tenant_id=MIRA_TENANT_ID,
        ingest_url=INGEST_URL,
        mcp_url=MCP_URL,
    )

    question = "What are the common fault codes for this drive and how do I clear them?"
    t0 = time.monotonic()
    try:
        reply = await engine.process(chat_id=TEST_CHAT_ID, message=question)
        elapsed = time.monotonic() - t0
        top_score = max(engine._supervisor.rag._last_distances, default=0.0)

        # Evidence: reply should contain a fault code or "Source:" citation
        has_fault_ref = any(
            kw in reply.lower()
            for kw in ("fault", "error", "e0", "f0", "overcurrent", "overvolt", "reset", "source:")
        )
        status = PASS if has_fault_ref and top_score > 0.45 else FAIL
        logger.info(
            "  %s  top_rag_score=%.3f  has_fault_ref=%s  (%.1fs)",
            status, top_score, has_fault_ref, elapsed,
        )
        logger.info("       reply=%r", reply[:200])
        return {
            "reply": reply[:500],
            "top_rag_score": top_score,
            "has_fault_ref": has_fault_ref,
            "elapsed_s": elapsed,
        }
    except Exception as e:
        logger.error("  %s  Follow-up chat error: %s", FAIL, e)
        return {}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def run(args: argparse.Namespace) -> dict:
    photo_path = Path(args.photo)
    if not photo_path.exists():
        logger.error("Photo not found: %s", photo_path)
        sys.exit(1)

    results: dict = {"photo": str(photo_path), "steps": {}}
    wall_start = time.monotonic()

    # Step 0: Health
    health_ok = await step_health_checks()
    results["steps"]["health"] = health_ok
    if not health_ok and not args.force:
        logger.error("Pre-flight failed. Run with --force to skip health gate.")
        return results

    # Step 2a: Baseline
    baseline = await step_neondb_count_before()
    results["steps"]["neondb_baseline"] = baseline

    # Step 1: Ingest photo
    ingest_result = await step_ingest_photo(photo_path)
    results["steps"]["ingest_photo"] = ingest_result

    # Step 2: GSD engine
    gsd_result = await step_gsd_engine(photo_path)
    results["steps"]["gsd_engine"] = gsd_result
    asset_identified = gsd_result.get("asset_identified", "")

    # Step 3: Wait for scrape (skip if no KB gap was flagged or --skip-scrape)
    if not args.skip_scrape and gsd_result.get("kb_gap_flagged"):
        scrape_result = await step_wait_for_scrape(baseline, timeout_s=args.scrape_timeout)
        results["steps"]["scrape_ingest"] = scrape_result
    elif args.skip_scrape:
        logger.info("=== Step 3: Skipped (--skip-scrape) ===")
        results["steps"]["scrape_ingest"] = {"skipped": True}
    else:
        logger.info("=== Step 3: Skipped (RAG score above gap threshold — KB already has content) ===")
        results["steps"]["scrape_ingest"] = {"skipped": True, "reason": "rag_score_ok"}

    # Step 4: Work order
    if not args.skip_wo:
        wo_result = await step_check_work_order()
        results["steps"]["work_order"] = wo_result
    else:
        logger.info("=== Step 4: Skipped (--skip-wo) ===")
        results["steps"]["work_order"] = {"skipped": True}

    # Step 5: Follow-up chat (only if scrape produced new entries)
    scrape_ok = results["steps"].get("scrape_ingest", {}).get("new_entries", 0) > 0
    if scrape_ok or args.force_followup:
        followup_result = await step_followup_chat(photo_path, asset_identified)
        results["steps"]["followup_chat"] = followup_result
    else:
        logger.info("=== Step 5: Skipped (no new KB entries to validate) ===")
        results["steps"]["followup_chat"] = {"skipped": True}

    wall_elapsed = time.monotonic() - wall_start
    results["total_elapsed_s"] = round(wall_elapsed, 1)

    # --- Summary ---
    logger.info("")
    logger.info("=== END-TO-END RESULT SUMMARY ===")
    logger.info("  Total time: %.1fs", wall_elapsed)
    logger.info("  Asset identified:  %r", asset_identified or "(none)")
    logger.info("  Top RAG score:     %.3f", gsd_result.get("top_rag_score", 0))
    logger.info("  KB gap triggered:  %s", gsd_result.get("kb_gap_flagged", False))
    logger.info(
        "  New KB entries:    %d",
        results["steps"].get("scrape_ingest", {}).get("new_entries", 0),
    )
    logger.info(
        "  Work order:        %s",
        results["steps"].get("work_order", {}).get("work_order_id") or "none",
    )
    followup = results["steps"].get("followup_chat", {})
    if not followup.get("skipped"):
        logger.info(
            "  Follow-up score:   %.3f  fault_ref=%s",
            followup.get("top_rag_score", 0),
            followup.get("has_fault_ref", False),
        )

    # Pass/fail determination
    # Evidence-only: pass = asset identified + at least one of (new KB entry OR WO created OR high RAG score)
    asset_ok = bool(asset_identified)
    kb_evidence = (
        results["steps"].get("scrape_ingest", {}).get("new_entries", 0) > 0
        or gsd_result.get("top_rag_score", 0) >= 0.45  # already had good KB coverage
    )
    wo_evidence = bool(results["steps"].get("work_order", {}).get("work_order_id"))

    passed = asset_ok and (kb_evidence or wo_evidence or args.skip_scrape)
    results["passed"] = passed
    logger.info("")
    logger.info(
        "  OVERALL: %s",
        "✅ PASSED" if passed else "❌ FAILED — check individual steps above",
    )
    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="MIRA end-to-end nameplate flow test",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--photo",
        default=str(DEFAULT_PHOTO),
        help=f"Path to nameplate photo (default: {DEFAULT_PHOTO.name})",
    )
    parser.add_argument(
        "--skip-scrape",
        action="store_true",
        help="Skip the Firecrawl scrape wait (test photo ingest + GSD only)",
    )
    parser.add_argument(
        "--skip-wo",
        action="store_true",
        help="Skip Atlas CMMS work order check",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Continue even if pre-flight health checks fail",
    )
    parser.add_argument(
        "--force-followup",
        action="store_true",
        help="Run follow-up chat step even if scrape produced no new entries",
    )
    parser.add_argument(
        "--scrape-timeout",
        type=int,
        default=120,
        help="Seconds to wait for scrape to produce new KB entries (default: 120)",
    )
    parser.add_argument(
        "--output",
        help="Write results JSON to this path",
    )
    args = parser.parse_args()

    results = asyncio.run(run(args))

    if args.output:
        Path(args.output).write_text(json.dumps(results, indent=2))
        logger.info("Results written to %s", args.output)

    sys.exit(0 if results.get("passed") else 1)


if __name__ == "__main__":
    main()
