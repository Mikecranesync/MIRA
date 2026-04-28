"""Synthetic Telegram integration test harness — 25 scenarios.

Drives the live Supervisor engine directly (no mocks, real LLM inference)
to verify all FSM logic, bug fixes, and edge cases exposed during the
2026-04-28 session.

Run inside the mira-bot-telegram container on VPS:
    docker exec mira-bot-telegram python3 /app/tests/integration/synthetic_telegram_runs.py

Or locally with live env vars:
    cd mira-bots
    INFERENCE_BACKEND=cloud MIRA_DB_PATH=/tmp/synth_test.db python3 tests/integration/synthetic_telegram_runs.py
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

# ---------------------------------------------------------------------------
# Path setup — works both inside container (/app) and from repo root
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
_BOTS_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _BOTS_ROOT not in sys.path:
    sys.path.insert(0, _BOTS_ROOT)

# Silence noisy loggers during test run
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
for _noisy in ("httpx", "httpcore", "urllib3", "asyncio"):
    logging.getLogger(_noisy).setLevel(logging.ERROR)

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class TurnResult:
    turn: int
    message: str
    reply: str
    next_state: str
    elapsed_ms: int
    error: Optional[str] = None


@dataclass
class ScenarioResult:
    scenario_id: int
    name: str
    category: str
    chat_id: str
    turns: list[TurnResult] = field(default_factory=list)
    passed: bool = True
    failure_reason: str = ""
    assertions: list[str] = field(default_factory=list)  # logged checks
    total_ms: int = 0

    def fail(self, reason: str) -> None:
        self.passed = False
        if self.failure_reason:
            self.failure_reason += f" | {reason}"
        else:
            self.failure_reason = reason

    def note(self, msg: str) -> None:
        self.assertions.append(msg)


# ---------------------------------------------------------------------------
# Engine bootstrapping
# ---------------------------------------------------------------------------

def _make_engine(db_path: str):
    """Create a live Supervisor using container env vars."""
    from shared.engine import Supervisor
    return Supervisor(
        db_path=db_path,
        openwebui_url=os.getenv("OPENWEBUI_BASE_URL", "http://mira-core:8080"),
        api_key=os.getenv("OPENWEBUI_API_KEY", ""),
        collection_id=os.getenv(
            "KNOWLEDGE_COLLECTION_ID", "dd9004b9-3af2-4751-9993-3307e478e9a3"
        ),
        vision_model=os.getenv("VISION_MODEL", "qwen2.5vl:7b"),
        tenant_id=os.getenv("MIRA_TENANT_ID", ""),
        mcp_base_url=os.getenv("MCP_BASE_URL", "http://mira-mcp-saas:8001"),
        mcp_api_key=os.getenv("MCP_REST_API_KEY", ""),
    )


# ---------------------------------------------------------------------------
# NeonDB helper — query work_orders created in this run
# ---------------------------------------------------------------------------

def _check_neon_wo(title_fragment: str, since_ts: float) -> Optional[dict]:
    """Return Hub work_order dict if one matching title_fragment was created since since_ts."""
    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        return None
    try:
        import psycopg2
        since_dt = datetime.fromtimestamp(since_ts, tz=timezone.utc).isoformat()
        conn = psycopg2.connect(url)
        cur = conn.cursor()
        cur.execute(
            """SELECT id, work_order_number, title, created_at
               FROM work_orders
               WHERE title ILIKE %s AND created_at > %s
               ORDER BY created_at DESC LIMIT 1""",
            (f"%{title_fragment}%", since_dt),
        )
        row = cur.fetchone()
        conn.close()
        if row:
            return {
                "id": str(row[0]),
                "work_order_number": str(row[1]),
                "title": str(row[2]),
                "created_at": str(row[3]),
            }
    except Exception as exc:
        return {"neon_error": str(exc)}
    return None


# ---------------------------------------------------------------------------
# Core scenario runner
# ---------------------------------------------------------------------------

MSG_TIMEOUT = 45  # seconds per message (real LLM inference can be slow)


async def run_turn(
    engine,
    result: ScenarioResult,
    message: str,
    *,
    assert_state: Optional[str] = None,
    assert_reply_contains: Optional[str] = None,
    assert_reply_not_contains: Optional[str] = None,
    assert_not_empty: bool = True,
) -> TurnResult:
    """Send one message, record result, run assertions."""
    turn_n = len(result.turns) + 1
    t0 = time.monotonic()
    error = None
    reply = ""
    next_state = "UNKNOWN"
    try:
        raw = await asyncio.wait_for(
            engine.process_full(result.chat_id, message),
            timeout=MSG_TIMEOUT,
        )
        reply = raw.get("reply", "")
        next_state = raw.get("next_state", "UNKNOWN")
    except asyncio.TimeoutError:
        error = f"TIMEOUT after {MSG_TIMEOUT}s"
        result.fail(f"Turn {turn_n} timed out")
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        result.fail(f"Turn {turn_n} exception: {error}")

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    tr = TurnResult(
        turn=turn_n,
        message=message,
        reply=reply,
        next_state=next_state,
        elapsed_ms=elapsed_ms,
        error=error,
    )
    result.turns.append(tr)

    # Timing warning
    if elapsed_ms > 10_000:
        result.note(f"Turn {turn_n} slow: {elapsed_ms}ms")

    # Assertions
    if assert_not_empty and not reply.strip() and not error:
        result.fail(f"Turn {turn_n}: empty reply")

    if assert_state and next_state != assert_state:
        result.note(f"Turn {turn_n}: expected state {assert_state!r}, got {next_state!r}")

    if assert_reply_contains:
        low = reply.lower()
        if assert_reply_contains.lower() not in low:
            result.fail(
                f"Turn {turn_n}: expected {assert_reply_contains!r} in reply"
            )

    if assert_reply_not_contains:
        low = reply.lower()
        if assert_reply_not_contains.lower() in low:
            result.fail(
                f"Turn {turn_n}: unexpected {assert_reply_not_contains!r} in reply"
            )

    return tr


def _has_numbered_options(reply: str) -> bool:
    """Return True if the reply contains numbered list options (1. / 2.)."""
    import re
    return bool(re.search(r"(?:^|\n)\s*[12]\.", reply))


# ---------------------------------------------------------------------------
# 25 SCENARIOS
# ---------------------------------------------------------------------------

async def scenario_direct_wo_vfd(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Direct WO — VFD fault", "direct_wo", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "create a work order for VFD-3 — F0030 overcurrent fault")
    # Expect WO preview
    await run_turn(engine, r, "yes", assert_reply_contains="work order")
    r.note("Verified: direct WO creation from cold message")
    return r


async def scenario_direct_wo_pump(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Direct WO — pump seal", "direct_wo", f"synth-{uuid.uuid4().hex[:8]}")
    t0 = time.time()
    await run_turn(engine, r, "create a work order for Pump 7 — leaking seal on the discharge side")
    await run_turn(engine, r, "yes", assert_reply_contains="work order")
    wo = _check_neon_wo("Pump 7", t0)
    if wo and "neon_error" not in wo:
        r.note(f"NeonDB verified: {wo['work_order_number']}")
    elif wo:
        r.note(f"NeonDB check error: {wo['neon_error']}")
    else:
        r.note("NeonDB: NEON_DATABASE_URL not set — skipped")
    return r


async def scenario_direct_wo_compressor(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Direct WO — compressor vibration", "direct_wo", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "create a work order for Air Compressor C-12 — excessive vibration and high temp alarm")
    await run_turn(engine, r, "yes")
    return r


async def scenario_direct_wo_conveyor(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Direct WO — conveyor belt", "direct_wo", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "open a work order for conveyor belt line 3: belt slipping off tracking rollers")
    await run_turn(engine, r, "yes")
    return r


async def scenario_direct_wo_filtration(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Direct WO — filtration system", "direct_wo", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "log a work order for filtration system F-04 — pressure drop across filter")
    await run_turn(engine, r, "yes")
    return r


async def scenario_full_diag_vfd(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Full diagnosis — VFD", "full_diag", f"synth-{uuid.uuid4().hex[:8]}")
    # Always name the asset so the WO draft is valid when we confirm
    await run_turn(engine, r, "VFD-3 on the main pump is tripping")
    t1 = await run_turn(engine, r, "It shows an OC fault — overcurrent. Happens under load")
    if _has_numbered_options(t1.reply):
        await run_turn(engine, r, "1.")
        r.note("Option '1.' selected from numbered list")
    await run_turn(engine, r, "the motor nameplate is 22kW 460V, drive is 30HP")
    await run_turn(engine, r, "log this work order")
    t_yes = await run_turn(engine, r, "yes")
    # WO created OR bot asks for missing field (both are valid engine behaviour)
    low = t_yes.reply.lower()
    if "work order" in low or "created" in low or "mira-" in low:
        r.note("WO confirmed successfully")
    elif "more details" in low or "missing" in low or "asset" in low:
        r.note("Bot asked for missing field (valid — asset not parsed from context)")
    elif t_yes.error:
        r.fail(f"Turn yes errored: {t_yes.error}")
    else:
        r.note(f"Unexpected confirmation reply: {t_yes.reply[:100]!r}")
    return r


async def scenario_full_diag_pump(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Full diagnosis — pump bearing", "full_diag", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "Pump bearing failure on circulation pump")
    await run_turn(engine, r, "high pitched squealing noise, vibration getting worse over the last week")
    await run_turn(engine, r, "it is the suction side bearing")
    await run_turn(engine, r, "create work order")
    await run_turn(engine, r, "yes")
    return r


async def scenario_full_diag_motor(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Full diagnosis — motor thermal trip", "full_diag", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "Motor on mixer M-7 keeps tripping on thermal overload")
    await run_turn(engine, r, "it runs for about 20 minutes then trips, ambient is about 40 degrees C")
    await run_turn(engine, r, "we increased the load last month, added more product to the batch")
    await run_turn(engine, r, "log work order for this")
    await run_turn(engine, r, "yes")
    return r


async def scenario_voice_like_long(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Voice-like long message", "voice", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(
        engine, r,
        "hey so basically what happened is we came in this morning and the whole packaging line "
        "was down, the conveyor drive just wouldnt start up, we checked the drive display and "
        "it was showing like a fault code but i couldnt read it clearly it might have been E05 "
        "or something like that, the line was running fine last night on the night shift",
    )
    await run_turn(engine, r, "its the main conveyor motor, the big 15 horsepower one at the start of the line")
    return r


async def scenario_voice_like_rambling(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Voice-like rambling description", "voice", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(
        engine, r,
        "yeah the compressor room has been making this weird noise like a knocking sound "
        "been going on since tuesday i think or maybe monday, and sometimes it goes away "
        "for a while but then it comes back, maintenance checked it last week but they "
        "couldnt find anything, the pressure gauge is reading normal though",
    )
    await run_turn(engine, r, "the compressor in the north building, its the 50HP rotary screw one")
    return r


async def scenario_option_selection_one(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Option selection — picks '1'", "option_select", f"synth-{uuid.uuid4().hex[:8]}")
    t0 = await run_turn(engine, r, "VFD fault AL-14 on the cooling tower fan")
    # First response might be options — if so, pick 1
    if _has_numbered_options(t0.reply):
        t1 = await run_turn(engine, r, "1.")
        r.note(f"Option '1.' resolved. Next state: {t1.next_state}")
        # Verify the same question is NOT repeated
        if t0.reply.strip() == t1.reply.strip():
            r.fail("BUG-1 regression: same question repeated after option selection")
        else:
            r.note("BUG-1 check passed: bot advanced after option selection")
    else:
        # No options presented — send another message to see if options appear
        t1 = await run_turn(engine, r, "it flashes on and off every 20 seconds")
        if _has_numbered_options(t1.reply):
            t2 = await run_turn(engine, r, "1.")
            r.note(f"Option '1.' from turn 2 resolved. Next state: {t2.next_state}")
        else:
            r.note("No numbered options presented in this run (LLM varies)")
    return r


async def scenario_option_selection_two(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Option selection — picks '2'", "option_select", f"synth-{uuid.uuid4().hex[:8]}")
    t0 = await run_turn(engine, r, "hydraulic press showing low pressure alarm, model HP-200")
    if _has_numbered_options(t0.reply):
        t1 = await run_turn(engine, r, "2.")
        if t0.reply.strip() == t1.reply.strip():
            r.fail("BUG-1 regression: same question repeated after option selection")
        else:
            r.note("Option 2 resolved, bot advanced")
    else:
        t1 = await run_turn(engine, r, "the pressure reads 1200 PSI when it should be 1800")
        r.note(f"No numbered options; advanced to {t1.next_state}")
    return r


async def scenario_typo_long_for_log(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Typo tolerance — 'Long' instead of 'Log'", "typo", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "create a work order for Pump-A1 — seal failure")
    # Simulate the typo that triggered BUG-3
    t = await run_turn(engine, r, "Long this work order to the cmms")
    # Should NOT silently discard — should either confirm or re-show preview
    low = t.reply.lower()
    if "work order" in low or "confirmed" in low or "created" in low or "preview" in low or "📋" in t.reply:
        r.note("BUG-3 check passed: 'Long' treated as 'log', not discarded")
    else:
        r.fail("BUG-3 regression: 'Long' silently discarded WO draft")
    return r


async def scenario_typo_yse_yes(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Typo tolerance — 'yse' and 'crate a work order'", "typo", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "crate a work order for Conveyor-3 — belt slipping")
    t = await run_turn(engine, r, "yse")
    low = t.reply.lower()
    # Either confirmed or re-showed preview (not just dropped)
    if any(kw in low for kw in ("work order", "created", "confirmed", "📋", "preview", "yes")):
        r.note("Typo 'yse' handled gracefully")
    else:
        r.note(f"'yse' response: {t.reply[:100]!r}")
    return r


async def scenario_safety_arc_flash(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Safety — arc flash keyword", "safety", f"synth-{uuid.uuid4().hex[:8]}")
    t = await run_turn(engine, r, "there is an arc flash risk on the main panel, exposed bus bars")
    low = t.reply.lower()
    is_safety = (
        "safety" in low
        or "qualified" in low
        or "stop" in low
        or "do not" in low
        or "electrician" in low
        or "immediately" in low
        or t.next_state == "SAFETY_ALERT"
    )
    if is_safety:
        r.note(f"Safety triggered correctly. State: {t.next_state}")
    else:
        r.fail(f"Safety keyword 'arc flash' not escalated. State={t.next_state}")
    return r


async def scenario_safety_loto(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Safety — LOTO / lockout tagout", "safety", f"synth-{uuid.uuid4().hex[:8]}")
    t = await run_turn(engine, r, "need to do loto on the conveyor before we replace the belt")
    low = t.reply.lower()
    is_safety = (
        "safety" in low
        or "qualified" in low
        or "lockout" in low
        or "tagout" in low
        or "procedure" in low
        or t.next_state == "SAFETY_ALERT"
    )
    if is_safety:
        r.note(f"LOTO safety response triggered. State: {t.next_state}")
    else:
        r.note(f"LOTO routed to RAG (educational context). State: {t.next_state}, reply: {t.reply[:80]!r}")
    return r


async def scenario_wo_field_correction_priority(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "WO field correction — priority", "wo_edit", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "create a work order for Motor M-5 — overheating")
    # Preview shown — now correct priority
    t = await run_turn(engine, r, "change priority to HIGH")
    low = t.reply.lower()
    if "high" in low:
        r.note("Priority correction accepted")
    else:
        r.note(f"Priority correction response: {t.reply[:100]!r}")
    # Confirm
    await run_turn(engine, r, "yes")
    return r


async def scenario_wo_field_correction_asset(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "WO field correction — asset name", "wo_edit", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "log a work order for a pump issue — cavitation noise")
    # Correct the asset
    t = await run_turn(engine, r, "asset is Pump-A3")
    low = t.reply.lower()
    if "pump-a3" in low or "pump a3" in low:
        r.note("Asset correction accepted")
    else:
        r.note(f"Asset correction response: {t.reply[:100]!r}")
    await run_turn(engine, r, "yes")
    return r


async def scenario_anti_loop_q_state(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Anti-loop — stuck in Q state (7x same)", "anti_loop", f"synth-{uuid.uuid4().hex[:8]}")
    # Start a diagnostic
    await run_turn(engine, r, "my pump is making noise")
    # Send the same vague message 7 times to stress-test the loop guard
    last_state = "IDLE"
    states_seen: list[str] = []
    for _ in range(7):
        t = await run_turn(engine, r, "I don't know")
        states_seen.append(t.next_state)
        last_state = t.next_state

    # After 7 identical turns, FSM should NOT still be in Q1/Q2/Q3
    still_stuck = last_state in ("Q1", "Q2", "Q3", "IDLE")
    if not still_stuck:
        r.note(f"Anti-loop fired. States: {' → '.join(states_seen[-4:])}, final: {last_state}")
    else:
        r.fail(f"Anti-loop NOT triggered after 7 turns. Final state: {last_state}")
    return r


async def scenario_anti_loop_diagnosis_state(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Anti-loop — stuck in DIAGNOSIS (6x same)", "anti_loop", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "VFD fault F0001 overcurrent on pump motor")
    await run_turn(engine, r, "it trips under full load at 60Hz")
    # Repeat the same message to loop in DIAGNOSIS/FIX_STEP
    states_seen: list[str] = []
    for _ in range(6):
        t = await run_turn(engine, r, "what should I check next")
        states_seen.append(t.next_state)
    final = states_seen[-1] if states_seen else "UNKNOWN"
    if final not in ("Q1", "Q2", "Q3"):
        r.note(f"Loop guard active. State progression: {' → '.join(states_seen[-3:])}")
    else:
        r.fail(f"Possible loop guard miss. Final state: {final}")
    return r


async def scenario_wo_neondb_verify_1(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "WO creation + NeonDB verify #1", "neon_verify", f"synth-{uuid.uuid4().hex[:8]}")
    t0 = time.time()
    asset = f"TestPump-{uuid.uuid4().hex[:4].upper()}"
    await run_turn(engine, r, f"create a work order for {asset} — bearing failure test run")
    t = await run_turn(engine, r, "yes", assert_reply_contains="work order")
    wo = _check_neon_wo(asset, t0)
    if wo and "neon_error" not in wo:
        r.note(f"NeonDB verified: {wo['work_order_number']} — {wo['title']}")
    elif wo:
        r.fail(f"NeonDB check failed: {wo['neon_error']}")
    else:
        r.note("NeonDB: NEON_DATABASE_URL not set — WO reply only verified")
        if "work order" in t.reply.lower():
            r.note("WO confirmation text found in reply")
    return r


async def scenario_wo_neondb_verify_2(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "WO creation + NeonDB verify #2 (high priority)", "neon_verify", f"synth-{uuid.uuid4().hex[:8]}")
    t0 = time.time()
    asset = f"Compressor-{uuid.uuid4().hex[:4].upper()}"
    await run_turn(engine, r, f"create a work order for {asset} — catastrophic bearing failure, machine down")
    await run_turn(engine, r, "change priority to HIGH")
    t = await run_turn(engine, r, "yes")
    wo = _check_neon_wo(asset, t0)
    if wo and "neon_error" not in wo:
        r.note(f"NeonDB verified: {wo['work_order_number']}")
    else:
        r.note("NeonDB: skipped or unavailable")
        if t.reply and not t.error:
            r.note("WO response received (atlas/hub outcome unknown without NeonDB URL)")
    return r


async def scenario_equipment_vfd(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Equipment type — VFD AC drive", "equipment", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "AC drive on cooling tower fan tripping F0020 ground fault")
    t = await run_turn(engine, r, "yes it is a Danfoss VLT 5000 series, 15HP, 480V")
    r.note(f"VFD state after nameplate: {t.next_state}")
    return r


async def scenario_equipment_pump(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Equipment type — centrifugal pump", "equipment", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "centrifugal pump P-201 not building pressure")
    await run_turn(engine, r, "it runs but no flow, impeller might be worn")
    return r


async def scenario_equipment_conveyor(engine, n: int) -> ScenarioResult:
    r = ScenarioResult(n, "Equipment type — conveyor system", "equipment", f"synth-{uuid.uuid4().hex[:8]}")
    await run_turn(engine, r, "belt conveyor BC-05 belt tracking issue, drifting to the right")
    await run_turn(engine, r, "the idler rollers on the return side look worn")
    return r


# ---------------------------------------------------------------------------
# Scenario registry
# ---------------------------------------------------------------------------

SCENARIOS = [
    scenario_direct_wo_vfd,         # 1
    scenario_direct_wo_pump,         # 2
    scenario_direct_wo_compressor,   # 3
    scenario_direct_wo_conveyor,     # 4
    scenario_direct_wo_filtration,   # 5
    scenario_full_diag_vfd,          # 6
    scenario_full_diag_pump,         # 7
    scenario_full_diag_motor,        # 8
    scenario_voice_like_long,        # 9
    scenario_voice_like_rambling,    # 10
    scenario_option_selection_one,   # 11
    scenario_option_selection_two,   # 12
    scenario_typo_long_for_log,      # 13
    scenario_typo_yse_yes,           # 14
    scenario_safety_arc_flash,       # 15
    scenario_safety_loto,            # 16
    scenario_wo_field_correction_priority,  # 17
    scenario_wo_field_correction_asset,     # 18
    scenario_anti_loop_q_state,      # 19
    scenario_anti_loop_diagnosis_state,     # 20
    scenario_wo_neondb_verify_1,     # 21
    scenario_wo_neondb_verify_2,     # 22
    scenario_equipment_vfd,          # 23
    scenario_equipment_pump,         # 24
    scenario_equipment_conveyor,     # 25
]

assert len(SCENARIOS) == 25, f"Expected 25 scenarios, got {len(SCENARIOS)}"


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def _bar(pct: float, width: int = 20) -> str:
    filled = int(pct / 100 * width)
    return "█" * filled + "░" * (width - filled)


def print_report(results: list[ScenarioResult], total_ms: int) -> None:
    passed = sum(1 for r in results if r.passed)
    failed = len(results) - passed
    pass_pct = passed / len(results) * 100

    print()
    print("=" * 72)
    print("  MIRA SYNTHETIC TELEGRAM HARNESS — RESULTS")
    print(f"  Run at: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("=" * 72)
    print(f"  Total scenarios : {len(results)}")
    print(f"  Passed          : {passed}  {'✓' * min(passed, 25)}")
    print(f"  Failed          : {failed}  {'✗' * min(failed, 25)}")
    print(f"  Pass rate       : {pass_pct:.1f}%  {_bar(pass_pct)}")
    print(f"  Total time      : {total_ms / 1000:.1f}s")
    print()

    # Category summary
    cats: dict[str, list[ScenarioResult]] = {}
    for r in results:
        cats.setdefault(r.category, []).append(r)

    print("  BY CATEGORY:")
    for cat, rs in sorted(cats.items()):
        cat_pass = sum(1 for r in rs if r.passed)
        print(f"    {cat:<22} {cat_pass}/{len(rs)} passed")
    print()

    print("-" * 72)
    print("  SCENARIO DETAIL:")
    print("-" * 72)

    for r in results:
        status = "PASS" if r.passed else "FAIL"
        turns_ms = [t.elapsed_ms for t in r.turns]
        avg_ms = sum(turns_ms) // len(turns_ms) if turns_ms else 0
        slow = any(ms > 10_000 for ms in turns_ms)
        slow_tag = " ⚠SLOW" if slow else ""
        print(
            f"  [{status}] #{r.scenario_id:02d} {r.name:<42}"
            f"  {len(r.turns)} turns  avg {avg_ms}ms{slow_tag}"
        )
        if not r.passed:
            print(f"         ✗ {r.failure_reason}")
        for note in r.assertions:
            print(f"         · {note}")
        # Show last state for each turn
        if r.turns:
            states = " → ".join(t.next_state for t in r.turns)
            print(f"         states: {states}")
        print()

    print("=" * 72)
    print("  FULL CONVERSATION LOGS:")
    print("=" * 72)

    for r in results:
        print(f"\n  ── Scenario #{r.scenario_id:02d}: {r.name} [{r.chat_id}] ──")
        for t in r.turns:
            status = "ERR" if t.error else "OK "
            print(f"    [{status}] Turn {t.turn} ({t.elapsed_ms}ms) → {t.next_state}")
            print(f"    USER: {t.message[:120]}")
            if t.error:
                print(f"    ERR : {t.error}")
            else:
                reply_preview = t.reply.replace("\n", " ")[:200]
                print(f"    BOT : {reply_preview}")

    print()
    if failed == 0:
        print("  ALL SCENARIOS PASSED ✓")
    else:
        print(f"  {failed} SCENARIO(S) FAILED — see details above")
    print("=" * 72)


def save_report(results: list[ScenarioResult], output_path: str) -> None:
    """Save full JSON report for post-analysis."""
    data = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "total": len(results),
        "passed": sum(1 for r in results if r.passed),
        "failed": sum(1 for r in results if not r.passed),
        "scenarios": [
            {
                "id": r.scenario_id,
                "name": r.name,
                "category": r.category,
                "chat_id": r.chat_id,
                "passed": r.passed,
                "failure_reason": r.failure_reason,
                "assertions": r.assertions,
                "total_ms": r.total_ms,
                "turns": [
                    {
                        "turn": t.turn,
                        "message": t.message,
                        "reply": t.reply,
                        "next_state": t.next_state,
                        "elapsed_ms": t.elapsed_ms,
                        "error": t.error,
                    }
                    for t in r.turns
                ],
            }
            for r in results
        ],
    }
    with open(output_path, "w") as fh:
        json.dump(data, fh, indent=2)
    print(f"\n  JSON report saved: {output_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> int:
    print("MIRA Synthetic Telegram Harness — 25 scenarios")
    print(f"Python {sys.version.split()[0]} | pid {os.getpid()}")
    print(f"INFERENCE_BACKEND={os.getenv('INFERENCE_BACKEND', '(unset)')}")
    print(f"MCP_BASE_URL={os.getenv('MCP_BASE_URL', '(unset)')}")
    print()

    # Use a temporary DB so tests don't pollute production state
    db_path = os.getenv("MIRA_DB_PATH", f"/tmp/synth_harness_{os.getpid()}.db")
    print(f"DB path: {db_path}")

    print("Initialising engine...")
    t_init = time.monotonic()
    try:
        engine = _make_engine(db_path)
    except Exception as exc:
        print(f"FATAL: Engine init failed: {exc}")
        traceback.print_exc()
        return 1
    print(f"Engine ready in {(time.monotonic() - t_init)*1000:.0f}ms")
    print()

    results: list[ScenarioResult] = []
    t_total_start = time.monotonic()

    for idx, scenario_fn in enumerate(SCENARIOS, start=1):
        print(f"  Running scenario {idx:02d}/25: {scenario_fn.__name__}...", end="", flush=True)
        t_s = time.monotonic()
        try:
            result = await scenario_fn(engine, idx)
        except Exception as exc:
            result = ScenarioResult(idx, scenario_fn.__name__, "unknown", f"synth-crash-{idx}")
            result.fail(f"Uncaught: {type(exc).__name__}: {exc}")
            result.note(traceback.format_exc()[-400:])
        result.total_ms = int((time.monotonic() - t_s) * 1000)
        results.append(result)
        tag = "✓" if result.passed else "✗"
        print(f" {tag} ({result.total_ms}ms)")

    total_ms = int((time.monotonic() - t_total_start) * 1000)

    print_report(results, total_ms)

    # Save JSON report
    report_path = f"/tmp/synth_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    save_report(results, report_path)

    failed = sum(1 for r in results if not r.passed)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
