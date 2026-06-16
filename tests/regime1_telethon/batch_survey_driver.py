"""Stateful Greeting Turing — Batch survey driver.

Reads survey_results.csv, drives the MIRA bot through a realistic multi-turn
conversation for each photo via Telethon, scores Turn 1 against the survey CSV
as ground truth, and auto-generates golden cases from PASS results.

Protocol per photo:
    Turn 0: /reset          → clear FSM state, wait 2 s
    Turn 1: send_file(photo)→ bot identifies equipment   → SCORED
    Turn 2: send_message()  → synthetic technician context (always)
    Turn 3: send_message()  → fault code injection       (only if has_fault_code)

Usage:
    # Dry-run (no Telethon)
    python -m tests.regime1_telethon.batch_survey_driver \\
      --csv ~/takeout_staging/survey_results.csv --dry-run --limit 20

    # 20-photo pilot
    doppler run --project factorylm --config prd -- \\
      python -m tests.regime1_telethon.batch_survey_driver \\
      --csv ~/takeout_staging/survey_results.csv --limit 20 --max-cost 0.50

    # Full sweep (resumable)
    doppler run --project factorylm --config prd -- \\
      python -m tests.regime1_telethon.batch_survey_driver \\
      --csv ~/takeout_staging/survey_results.csv --max-cost 50.0 --resume
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import logging
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

# Repo-relative imports — run from repo root as a module.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tests.scoring.contains_check import check_fault_cause, check_next_step, score_case
from tests.regime1_telethon.synthetic_replies import pick_turn2, turn3_message

logger = logging.getLogger("mira-survey-driver")

# ── Constants ─────────────────────────────────────────────────────────────────

EST_COST_PER_PHOTO = 0.006  # empirical: 3 turns × ~$0.002 (from survey test run)
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
RESULTS_CSV = Path.home() / "takeout_staging" / "survey_training_results.csv"
GOLDEN_YAML = (
    Path(__file__).parent / "golden_cases" / "v1" / "case_survey_auto.yaml"
)
SURVEY_PHOTOS_DIR = Path(__file__).parent / "photos" / "survey"

RESULTS_FIELDNAMES = [
    "filename", "equipment_type", "make", "condition", "has_fault_code",
    "t1_response", "t1_passed", "t1_failure_bucket", "t1_score",
    "t2_response", "t2_fault_cause_found", "t2_next_step_found",
    "t3_response", "t3_fault_code_referenced",
    "golden_case_written", "est_cost_usd", "latency_ms",
]


# ── CSV helpers ───────────────────────────────────────────────────────────────

def load_filtered_rows(csv_path: str, only_faults: bool) -> list[dict]:
    """Return survey rows eligible for batch driving."""
    rows = []
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            if row.get("is_equipment", "").lower() not in ("true", "1", "yes"):
                continue
            if row.get("mira_candidate", "").lower() == "no":
                continue
            if row.get("confidence", "").lower() == "low":
                continue
            if only_faults and row.get("has_fault_code", "").lower() not in ("true", "1"):
                continue
            rows.append(row)
    return rows


def load_already_done(results_csv: Path) -> set[str]:
    """Return filenames already written to results CSV."""
    if not results_csv.exists():
        return set()
    with open(results_csv, newline="") as f:
        return {row["filename"] for row in csv.DictReader(f)}


def _open_results_csv(results_csv: Path, resume: bool):
    """Open results CSV for appending (resume) or writing (fresh)."""
    mode = "a" if resume and results_csv.exists() else "w"
    f = open(results_csv, mode, newline="")  # noqa: SIM115
    writer = csv.DictWriter(f, fieldnames=RESULTS_FIELDNAMES, extrasaction="ignore")
    if mode == "w":
        writer.writeheader()
    return f, writer


# ── Scoring helpers ───────────────────────────────────────────────────────────

def build_case_from_row(row: dict, timeout: int) -> dict:
    """Build a score_case()-compatible case dict from a survey CSV row."""
    equipment_type = row.get("equipment_type", "").lower()
    make = row.get("make", "").strip()
    model = row.get("model", "").strip()
    condition = row.get("condition", "").lower()
    has_fault = row.get("has_fault_code", "").lower() in ("true", "1")
    fault_codes = [c.strip() for c in row.get("fault_codes", "").split("|") if c.strip()]

    must_contain: list[str] = []
    if equipment_type and equipment_type not in ("other", "unknown"):
        must_contain.append(equipment_type)
    if make:
        must_contain.append(make)

    require_fault_cause = condition in ("damaged", "fault_visible", "worn")

    return {
        "name": _make_id(row["filename"]),
        "must_contain": must_contain,
        "must_not_contain": ["I cannot", "I'm unable", "no image"],
        "expected": {
            "make": make or None,
            "model": model or None,
            "must_give_fault_cause": require_fault_cause,
        },
        "fault_cause_keywords": fault_codes if has_fault else [],
        "next_step_keywords": [],
        "max_words": 200,
        "speed_timeout": timeout,
        "adversarial": False,
    }


def _make_id(filename: str) -> str:
    stem = Path(filename).stem.replace("/", "_").replace(" ", "_")
    return f"survey_{stem}"


# ── Golden case helpers ───────────────────────────────────────────────────────

def make_golden_case(row: dict, t1_response: str, score_result: dict) -> dict:
    """Build a YAML-serializable golden case from a PASS conversation."""
    equipment_type = row.get("equipment_type", "").lower()
    make = row.get("make", "").strip()
    model = row.get("model", "").strip()
    filename = row["filename"]

    must_contain: list[str] = []
    if equipment_type and equipment_type not in ("other", "unknown"):
        must_contain.append(equipment_type)
    if make:
        must_contain.append(make)
    fault_cause_matched = score_result.get("extracted_facts", {}).get("fault_cause_found", [])
    must_contain.extend(fc for fc in fault_cause_matched[:2] if fc not in must_contain)

    return {
        "name": _make_id(filename),
        "image": f"tests/regime1_telethon/photos/survey/{Path(filename).name}",
        "caption": row.get("one_line_summary") or "Identify this industrial equipment.",
        "source": "survey_auto",
        "expected": {
            "make": make or None,
            "model": model or None,
            "equipment_type": equipment_type or None,
            "condition": row.get("condition") or None,
        },
        "must_contain": must_contain,
        "must_not_contain": ["I cannot", "I'm unable", "no image"],
        "fault_cause_keywords": fault_cause_matched[:5],
        "next_step_keywords": score_result.get("extracted_facts", {}).get("next_step_found", [])[:5],
        "max_words": 200,
        "speed_timeout": 60,
    }


def append_golden_cases(new_cases: list[dict], yaml_path: Path) -> None:
    """Append to case_survey_auto.yaml; create with header if absent. Idempotent."""
    if not new_cases:
        return
    yaml_path.parent.mkdir(parents=True, exist_ok=True)

    # Load existing
    existing_names: set[str] = set()
    existing_cases: list[dict] = []
    if yaml_path.exists():
        with open(yaml_path) as f:
            data = yaml.safe_load(f) or {}
        existing_cases = data.get("cases", []) or []
        existing_names = {c.get("name") for c in existing_cases}

    to_add = [c for c in new_cases if c.get("name") not in existing_names]
    if not to_add:
        return

    all_cases = existing_cases + to_add
    with open(yaml_path, "w") as f:
        yaml.dump({"cases": all_cases}, f, default_flow_style=False, allow_unicode=True)
    logger.info("Appended %d golden cases to %s", len(to_add), yaml_path)


# ── Telethon send helpers ─────────────────────────────────────────────────────

async def collect_reply(
    client, bot_entity, image_path: str, caption: str, timeout: int
) -> tuple[str | None, float]:
    """Send photo and collect reply via silence-detection.

    Copied from send_real_photos.py. Returns (reply_text, elapsed_sec).
    """
    t_start = time.monotonic()
    sent = await client.send_file(bot_entity, image_path, caption=caption)
    collected = []
    last_id = sent.id
    silence_ticks = 0
    elapsed = 0

    while elapsed < timeout:
        await asyncio.sleep(2)
        elapsed += 2
        new = []
        async for msg in client.iter_messages(bot_entity, limit=20, min_id=last_id):
            if not msg.out and msg.text:
                new.append(msg)
        new.sort(key=lambda m: m.id)
        if new:
            collected.extend(new)
            last_id = new[-1].id
            silence_ticks = 0
        else:
            silence_ticks += 1
            if collected and silence_ticks >= 3:
                break

    if not collected:
        return None, time.monotonic() - t_start
    substantive = [m for m in collected if len(m.text) > 50]
    reply = substantive[-1].text if substantive else collected[-1].text
    return reply, time.monotonic() - t_start


async def send_text_and_collect(
    client, bot_entity, text: str, last_id: int, timeout: int
) -> tuple[str | None, int]:
    """Send a text message and collect reply via silence-detection.

    Returns (reply_text, new_last_id).
    """
    sent = await client.send_message(bot_entity, text)
    collected = []
    cur_last_id = sent.id
    silence_ticks = 0
    elapsed = 0

    while elapsed < timeout:
        await asyncio.sleep(2)
        elapsed += 2
        new = []
        async for msg in client.iter_messages(bot_entity, limit=20, min_id=cur_last_id):
            if not msg.out and msg.text:
                new.append(msg)
        new.sort(key=lambda m: m.id)
        if new:
            collected.extend(new)
            cur_last_id = new[-1].id
            silence_ticks = 0
        else:
            silence_ticks += 1
            if collected and silence_ticks >= 3:
                break

    if not collected:
        return None, cur_last_id
    substantive = [m for m in collected if len(m.text) > 50]
    reply = substantive[-1].text if substantive else collected[-1].text
    return reply, cur_last_id


# ── Multi-turn conversation ───────────────────────────────────────────────────

async def run_conversation(
    client,
    bot_entity,
    row: dict,
    photo_path: Path,
    timeout: int,
    dry_run: bool,
) -> dict:
    """Execute reset → T1 → T2 → T3(conditional). Returns turn responses."""
    equipment_type = row.get("equipment_type", "other")
    has_fault = row.get("has_fault_code", "").lower() in ("true", "1")
    caption = row.get("one_line_summary") or "Identify this industrial equipment."

    if dry_run:
        return {
            "t1_response": f"[DRY RUN] I can see a {equipment_type} here. Let me ask some questions.",
            "t2_response": "[DRY RUN] Follow-up diagnostic question.",
            "t3_response": "[DRY RUN] Fault code explanation." if has_fault else None,
            "latency_ms": 0,
        }

    # Turn 0: reset
    await client.send_message(bot_entity, "/reset")
    await asyncio.sleep(2)

    # Turn 1: photo
    t1_response, elapsed = await collect_reply(client, bot_entity, str(photo_path), caption, timeout)
    latency_ms = int(elapsed * 1000)

    # Turn 2: synthetic technician context
    t2_reply_text = pick_turn2(equipment_type)
    last_id = 0  # send_text_and_collect will discover from T1 last message
    t2_response = None
    t3_response = None

    if t1_response:
        t2_response, last_id = await send_text_and_collect(
            client, bot_entity, t2_reply_text, last_id, timeout
        )

    # Turn 3: fault code injection (conditional)
    if has_fault and t1_response:
        fault_codes = row.get("fault_codes", "")
        if fault_codes.strip():
            t3_text = turn3_message(fault_codes)
            t3_response, _ = await send_text_and_collect(
                client, bot_entity, t3_text, last_id, timeout
            )

    return {
        "t1_response": t1_response,
        "t2_response": t2_response,
        "t3_response": t3_response,
        "latency_ms": latency_ms,
    }


# ── Main batch loop ───────────────────────────────────────────────────────────

async def run_batch(
    csv_path: str,
    photo_base_dir: str,
    bot_username: str = "@MIRABot",
    timeout: int = 60,
    limit: int | None = None,
    max_cost: float = 50.0,
    only_faults: bool = False,
    dry_run: bool = False,
    resume: bool = False,
) -> None:
    """Main loop: filter CSV → multi-turn FSM → score → write outputs."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    rows = load_filtered_rows(csv_path, only_faults)
    logger.info("Loaded %d eligible rows from %s", len(rows), csv_path)

    already_done: set[str] = set()
    if resume:
        already_done = load_already_done(RESULTS_CSV)
        logger.info("Resume: skipping %d already-processed photos", len(already_done))

    rows = [r for r in rows if r["filename"] not in already_done]
    if limit:
        rows = rows[:limit]
    logger.info("Processing %d photos (limit=%s, dry_run=%s)", len(rows), limit, dry_run)

    client = None
    bot_entity = None
    if not dry_run:
        try:
            from telethon import TelegramClient
        except ImportError:
            logger.error("telethon not installed — run inside telegram-test-runner container")
            sys.exit(1)

        api_id = int(os.environ["TELEGRAM_TEST_API_ID"])
        api_hash = os.environ["TELEGRAM_TEST_API_HASH"]
        session_env = os.environ.get("TELEGRAM_TEST_SESSION_PATH", "/session/test_account.session")
        session_path = session_env[: -len(".session")] if session_env.endswith(".session") else session_env
        bot_username = os.environ.get("TELEGRAM_BOT_USERNAME", bot_username)

        client = TelegramClient(session_path, api_id, api_hash)
        await client.start()
        bot_entity = await client.get_entity(bot_username)
        logger.info("Telethon connected → %s", bot_username)

    SURVEY_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    f_csv, writer = _open_results_csv(RESULTS_CSV, resume)

    total_cost = 0.0
    n_pass = 0
    n_fail = 0
    n_partial = 0
    golden_cases: list[dict] = []

    try:
        for i, row in enumerate(rows):
            filename = row["filename"]
            photo_path = Path(photo_base_dir) / filename

            if not photo_path.exists():
                logger.warning("Photo not found: %s — skipping", photo_path)
                continue

            logger.info("[%d/%d] %s", i + 1, len(rows), filename)

            conv = await run_conversation(
                client, bot_entity, row, photo_path, timeout, dry_run
            )

            # Score Turn 1
            case = build_case_from_row(row, timeout)
            t1_result = score_case(case, conv["t1_response"], conv["latency_ms"] / 1000)

            # Score T2 for analysis (not gating)
            t2_fault_cause, _ = check_fault_cause(conv["t2_response"] or "")
            t2_next_step, _ = check_next_step(conv["t2_response"] or "")

            # Score T3 fault reference
            t3_referenced = False
            if conv["t3_response"] and row.get("fault_codes"):
                first_code = row["fault_codes"].split("|")[0].strip()
                t3_referenced = bool(first_code and first_code.lower() in (conv["t3_response"] or "").lower())

            passed = t1_result["passed"]
            total_cost += EST_COST_PER_PHOTO
            golden_written = False

            if passed:
                n_pass += 1
                # Copy photo to test fixtures dir
                dest = SURVEY_PHOTOS_DIR / Path(filename).name
                if not dest.exists():
                    shutil.copy2(photo_path, dest)
                # Build golden case
                gc = make_golden_case(row, conv["t1_response"] or "", t1_result)
                golden_cases.append(gc)
                golden_written = True
            else:
                bucket = t1_result["failure_bucket"]
                if bucket == "TRANSPORT_FAILURE":
                    n_fail += 1
                elif t1_result["conditions"].get("IDENTIFICATION"):
                    n_partial += 1
                else:
                    n_fail += 1

            writer.writerow({
                "filename": filename,
                "equipment_type": row.get("equipment_type", ""),
                "make": row.get("make", ""),
                "condition": row.get("condition", ""),
                "has_fault_code": row.get("has_fault_code", ""),
                "t1_response": (conv["t1_response"] or "")[:500],
                "t1_passed": passed,
                "t1_failure_bucket": t1_result.get("failure_bucket") or "",
                "t1_score": round(t1_result.get("confidence", 0.0), 4),
                "t2_response": (conv["t2_response"] or "")[:300],
                "t2_fault_cause_found": t2_fault_cause,
                "t2_next_step_found": t2_next_step,
                "t3_response": (conv["t3_response"] or "")[:300],
                "t3_fault_code_referenced": t3_referenced,
                "golden_case_written": golden_written,
                "est_cost_usd": round(total_cost, 4),
                "latency_ms": conv["latency_ms"],
            })
            f_csv.flush()

            # Cost guard
            if max_cost > 0 and total_cost >= max_cost:
                logger.warning("Cost guard reached $%.2f — stopping", total_cost)
                break

    finally:
        f_csv.close()
        if client:
            await client.disconnect()

    # Append golden cases
    append_golden_cases(golden_cases, GOLDEN_YAML)

    # Summary
    total = n_pass + n_partial + n_fail
    print("\n" + "=" * 68)
    print("  Stateful Greeting Turing — Batch Run Summary")
    print("=" * 68)
    print(f"  Photos processed:       {total}")
    print(f"  PASS:                   {n_pass}  ({100*n_pass/max(total,1):.1f}%)")
    print(f"  PARTIAL:                {n_partial}  ({100*n_partial/max(total,1):.1f}%)")
    print(f"  FAIL:                   {n_fail}  ({100*n_fail/max(total,1):.1f}%)")
    print(f"  Golden cases written:   {len(golden_cases)}")
    print(f"  Estimated cost:         ${total_cost:.3f} / ${max_cost:.2f}")
    print(f"  Results CSV:            {RESULTS_CSV}")
    print(f"  Golden YAML:            {GOLDEN_YAML}")
    print("=" * 68 + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Stateful Greeting Turing batch driver")
    parser.add_argument(
        "--csv",
        required=True,
        help="Path to survey_results.csv from survey_equipment_photos.py",
    )
    parser.add_argument(
        "--photo-dir",
        default=str(Path.home() / "takeout_staging" / "ollama_confirmed"),
        help="Directory containing the surveyed photos",
    )
    parser.add_argument(
        "--bot-username",
        default=os.environ.get("TELEGRAM_BOT_USERNAME", "@MIRABot"),
    )
    parser.add_argument("--timeout", type=int, default=60, help="Seconds per turn")
    parser.add_argument("--limit", type=int, default=None, help="Max photos to process")
    parser.add_argument("--max-cost", type=float, default=50.0, help="Abort if estimated cost exceeds this")
    parser.add_argument("--only-faults", action="store_true", help="Only process photos with fault codes")
    parser.add_argument("--dry-run", action="store_true", help="Skip Telethon, use mock responses")
    parser.add_argument("--resume", action="store_true", help="Skip already-processed rows")
    args = parser.parse_args()

    asyncio.run(
        run_batch(
            csv_path=args.csv,
            photo_base_dir=args.photo_dir,
            bot_username=args.bot_username,
            timeout=args.timeout,
            limit=args.limit,
            max_cost=args.max_cost,
            only_faults=args.only_faults,
            dry_run=args.dry_run,
            resume=args.resume,
        )
    )


if __name__ == "__main__":
    main()
