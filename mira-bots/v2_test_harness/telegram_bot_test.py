#!/usr/bin/env python3
"""
telegram_bot_test.py — MIRA Telegram Path End-to-End Test
Phases 1-6: bot health → session check → GSD smoke test → manual photo instructions → release gate
Sequential execution only. No asyncio concurrency between phases.
"""

import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

_HERE = Path(__file__).parent
_BOTS_ROOT = _HERE.parent
_CORE_ROOT = _BOTS_ROOT.parent / "mira-core"
_TELEGRAM_DIR = _BOTS_ROOT / "telegram"
_ARTIFACTS_DIR = _BOTS_ROOT / "artifacts" / "latest_run"


def _load_env() -> None:
    env_path = _BOTS_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())


_load_env()

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
BOT_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

SMOKE_CASES = [
    ("smoke_vfd_01", "My GS10 VFD tripped on overcurrent this morning"),
    ("smoke_plc_02", "Micro820 PLC showing fault light, all outputs dead"),
    ("smoke_motor_03", "Motor running hot, bearing noise on drive end"),
    ("smoke_generic_04", "What should I check first on a tripped VFD?"),
    ("smoke_panel_05", "Panel breaker keeps tripping under load"),
]

# Answers to GSD clarifying questions — pushes FSM from Q1 into DIAGNOSIS
SMOKE_FOLLOWUPS = [
    "The overcurrent tripped on startup under full conveyor load",
    "The fault appeared after power was cycled this morning",
    "The noise started two weeks ago and is getting worse",
    "It is a GS10 drive on a conveyor motor, tripped code E-OC",
    "30A breaker feeding a panel of mixed motor loads",
]

# Condition patterns for 4-part GSD text scorer
_INDUSTRIAL_TERMS = [
    "vfd",
    "drive",
    "motor",
    "plc",
    "fault",
    "overcurrent",
    "overload",
    "bearing",
    "voltage",
    "current",
    "breaker",
    "circuit",
    "panel",
    "winding",
    "inverter",
    "contactor",
    "relay",
    "electrical",
    "tripped",
]
_ACTION_VERBS = [
    "check",
    "inspect",
    "verify",
    "measure",
    "reset",
    "test",
    "replace",
    "disconnect",
    "reconnect",
    "clean",
    "tighten",
    "remove",
    "install",
    "confirm",
    "ensure",
    "read",
]
_HALLUCINATION_TERMS = [
    "siemens",
    "allen-bradley",
    "rockwell",
    "ab plc",
    "mitsubishi melsec",
    "omron sysmac",
    "schneider modicon",
]


# ---------------------------------------------------------------------------
# Scorer
# ---------------------------------------------------------------------------


def _score_gsd_response(case_name: str, reply: str) -> dict:
    """4-condition scorer for GSD text responses (no vision)."""
    if not reply:
        return {
            "case": case_name,
            "passed": False,
            "conditions": {
                k: False for k in ["RELEVANCE", "READABILITY", "NO_HALLUCINATION", "ACTIONABILITY"]
            },
            "word_count": 0,
            "failed": ["RELEVANCE", "READABILITY", "NO_HALLUCINATION", "ACTIONABILITY"],
            "reply_snippet": "",
        }

    r = reply.lower()
    word_count = len(reply.split())

    relevance = any(t in r for t in _INDUSTRIAL_TERMS)
    readability = 10 <= word_count <= 150
    no_hallucination = not any(t in r for t in _HALLUCINATION_TERMS)
    actionability = any(v in r for v in _ACTION_VERBS)

    conditions = {
        "RELEVANCE": relevance,
        "READABILITY": readability,
        "NO_HALLUCINATION": no_hallucination,
        "ACTIONABILITY": actionability,
    }
    passed = all(conditions.values())
    failed = [k for k, v in conditions.items() if not v]

    return {
        "case": case_name,
        "passed": passed,
        "conditions": conditions,
        "word_count": word_count,
        "failed": failed,
        "reply_snippet": reply[:120],
    }


# ---------------------------------------------------------------------------
# Phase 1 — Bot Health Check
# ---------------------------------------------------------------------------


def phase1_bot_health() -> dict:
    print("\n=== PHASE 1: Bot Health Check ===")
    result: dict = {"healthy": False, "username": None, "bot_id": None, "recent_msgs": 0}

    # 1a. Docker container health
    try:
        r = subprocess.run(
            ["docker", "inspect", "mira-bot-telegram", "--format", "{{.State.Health.Status}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        status = r.stdout.strip()
        print(f"  Docker health: {status}")
        if status != "healthy":
            print("  ERROR: Container not healthy. Container logs (last 20 lines):")
            logs = subprocess.run(
                ["docker", "logs", "--tail", "20", "mira-bot-telegram"],
                capture_output=True,
                text=True,
            )
            print(logs.stdout[-1000:] or logs.stderr[-500:])
            return result
    except Exception as e:
        print(f"  docker inspect error: {e}")

    # 1b. getMe — confirm token and fetch username/id
    try:
        with httpx.Client(timeout=10) as client:
            r = client.get(f"{BOT_API}/getMe")
            data = r.json()
        if data.get("ok"):
            bot = data["result"]
            result["username"] = bot.get("username")
            result["bot_id"] = bot.get("id")
            print(f"  Bot: @{result['username']} (id={result['bot_id']})")
        else:
            print(f"  getMe failed: {data}")
            return result
    except Exception as e:
        print(f"  getMe error: {e}")
        return result

    # 1c. getUpdates — count recent activity
    try:
        with httpx.Client(timeout=10) as client:
            r = client.get(f"{BOT_API}/getUpdates", params={"limit": 20})
            data = r.json()
        updates = data.get("result", [])
        result["recent_msgs"] = len(updates)
        last_ts = None
        if updates:
            last_ts = updates[-1].get("message", {}).get("date")
        ts_str = f" | Last: {datetime.fromtimestamp(last_ts, tz=timezone.utc)}" if last_ts else ""
        print(f"  Recent updates: {len(updates)}{ts_str}")
    except Exception as e:
        print(f"  getUpdates error: {e}")

    result["healthy"] = True
    return result


# ---------------------------------------------------------------------------
# Phase 2 — Session Check
# ---------------------------------------------------------------------------


def phase2_session_check() -> dict:
    print("\n=== PHASE 2: Session Check ===")
    candidates = [
        _BOTS_ROOT / "telegram_test_runner" / "testaccount.session",
        _BOTS_ROOT / "telegram_test_runner" / "test.session",
        _BOTS_ROOT / "session" / "testaccount.session",
        Path.home() / ".mira_test.session",
    ]
    env_override = os.getenv("TELEGRAM_TEST_SESSION_PATH", "")
    if env_override:
        candidates.insert(0, Path(env_override))

    for p in candidates:
        if p.exists():
            print(f"  Session found: {p}")
            return {"session_found": True, "path": str(p)}

    # Check for Docker volumes with telegram in the name
    try:
        r = subprocess.run(["docker", "volume", "ls"], capture_output=True, text=True, timeout=10)
        tele_vols = [line for line in r.stdout.splitlines() if "telegram" in line.lower()]
        if tele_vols:
            print(f"  No .session file, but Docker volumes found: {tele_vols}")
    except Exception:
        pass

    print("  No Telethon session found → routing to Phase 3B (two-layer smoke test)")
    return {"session_found": False, "path": None}


# ---------------------------------------------------------------------------
# Phase 3B — Two-Layer Smoke Test
# ---------------------------------------------------------------------------


async def _run_gsd_engine_smoke() -> list[dict]:
    """5 smoke cases via GSDEngine direct. 2-turn exchange to push FSM into DIAGNOSIS."""
    sys.path.insert(0, str(_TELEGRAM_DIR))
    try:
        from gsd_engine import GSDEngine  # type: ignore
    except ImportError as e:
        print(f"  GSDEngine import failed: {e}")
        return []

    db_path = f"/tmp/mira_tg_smoke_{int(time.time())}.db"
    engine = GSDEngine(
        db_path=db_path,
        openwebui_url=os.getenv(
            "OPENWEBUI_BASE_URL",
            os.environ.get("MIRA_SERVER_BASE_URL", "http://localhost") + ":3000",
        ),
        api_key=os.getenv("OPENWEBUI_API_KEY", ""),
        collection_id=os.getenv("KNOWLEDGE_COLLECTION_ID", ""),
        vision_model=os.getenv("VISION_MODEL", "qwen2.5vl:7b"),
    )

    results = []
    for i, (case_name, fault_msg) in enumerate(SMOKE_CASES):
        print(f"  [{i + 1}/5] {case_name}")
        print(f"         → {fault_msg[:70]}")
        try:
            # Turn 1: fault description — FSM IDLE → Q1 (clarifying question)
            t0 = time.time()
            reply1 = await engine.process(f"smoke_{i}", fault_msg)
            t1_elapsed = round(time.time() - t0, 1)
            print(f"         Turn1 ({t1_elapsed}s): {str(reply1)[:80]}")

            # Turn 2: answer clarifying question — FSM Q1 → DIAGNOSIS
            followup = SMOKE_FOLLOWUPS[i]
            t1 = time.time()
            reply2 = await engine.process(f"smoke_{i}", followup)
            t2_elapsed = round(time.time() - t1, 1)
            print(f"         Turn2 ({t2_elapsed}s): {str(reply2)[:80]}")

            scored = _score_gsd_response(case_name, str(reply2))
            scored["elapsed"] = round(t1_elapsed + t2_elapsed, 2)
            status = "PASS" if scored["passed"] else f"FAIL {scored['failed']}"
            print(f"         → {status}")
            results.append(scored)

        except Exception as exc:
            print(f"         ERROR: {exc}")
            results.append(
                {
                    "case": case_name,
                    "passed": False,
                    "conditions": {},
                    "word_count": 0,
                    "failed": ["ERROR"],
                    "reply_snippet": str(exc)[:120],
                    "elapsed": 0,
                }
            )

    try:
        os.unlink(db_path)
    except OSError:
        pass

    return results


def _layer_b_bot_api(bot_info: dict) -> dict:
    """Layer B: confirm Bot API connectivity and optional sendMessage test."""
    print("\n  [Layer B] Bot API Connectivity")
    result: dict = {"chat_id_found": None, "send_tested": False, "send_ok": False}

    try:
        with httpx.Client(timeout=10) as client:
            r = client.get(f"{BOT_API}/getUpdates", params={"limit": 100})
            data = r.json()
        updates = data.get("result", [])

        # Find most recent non-bot user chat_id
        chat_id = None
        for u in reversed(updates):
            msg = u.get("message", {})
            if msg.get("from") and not msg.get("from", {}).get("is_bot", False):
                chat_id = msg["chat"]["id"]
                break
        result["chat_id_found"] = chat_id

        if chat_id:
            print(f"    User chat_id found: {chat_id} — testing sendMessage")
            with httpx.Client(timeout=10) as client:
                r2 = client.post(
                    f"{BOT_API}/sendMessage",
                    json={
                        "chat_id": chat_id,
                        "text": "[MIRA smoke test ping — ignore]",
                    },
                )
            send_ok = r2.json().get("ok", False)
            result["send_tested"] = True
            result["send_ok"] = send_ok
            print(f"    sendMessage: {'OK' if send_ok else 'FAILED'}")
        else:
            print(
                "    No user chat_id in recent updates — skipping sendMessage (informational only)"
            )

    except Exception as e:
        print(f"    Layer B error: {e}")

    return result


def phase3b_smoke_test(bot_info: dict) -> dict:
    print("\n=== PHASE 3B: Two-Layer Smoke Test ===")
    print("\n  [Layer A] GSDEngine Direct — 5 smoke cases")

    gsd_results = asyncio.run(_run_gsd_engine_smoke())

    passed = sum(1 for r in gsd_results if r.get("passed"))
    total = len(gsd_results)
    rate = passed / total if total > 0 else 0.0
    print(f"\n  Layer A result: {passed}/{total} passed ({rate:.0%})")

    layer_b = _layer_b_bot_api(bot_info)

    return {
        "gsd_results": gsd_results,
        "gsd_passed": passed,
        "gsd_total": total,
        "gsd_rate": rate,
        "layer_b": layer_b,
    }


# ---------------------------------------------------------------------------
# Phase 4 — Write Report + Manual Photo Instructions
# ---------------------------------------------------------------------------


def phase4_write_report_and_instructions(bot_info: dict, smoke: dict) -> None:
    print("\n=== PHASE 4: Report + Manual Photo Instructions ===")
    _ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    bot_username = bot_info.get("username") or "MIRABot"
    now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    lines = [
        f"# MIRA Telegram Smoke Test — {now}",
        "",
        "## Phase 1 — Bot Health",
        f"- Status: {'healthy' if bot_info.get('healthy') else 'UNHEALTHY'}",
        f"- Bot: @{bot_info.get('username')} (id={bot_info.get('bot_id')})",
        f"- Recent updates: {bot_info.get('recent_msgs', 0)}",
        "",
        "## Phase 3B Layer A — GSD Engine Smoke (5 cases)",
        "",
        f"Pass rate: **{smoke['gsd_passed']}/{smoke['gsd_total']} ({smoke['gsd_rate']:.0%})**",
        "",
        "| Case | Passed | Words | Failed Conditions | Snippet |",
        "|------|--------|-------|-------------------|---------|",
    ]
    for r in smoke["gsd_results"]:
        status = "PASS" if r.get("passed") else "FAIL"
        wc = r.get("word_count", "—")
        failed = ", ".join(r.get("failed", [])) or "—"
        snippet = r.get("reply_snippet", r.get("reason", ""))[:60].replace("|", "\\|")
        lines.append(f"| {r['case']} | {status} | {wc} | {failed} | {snippet} |")

    lb = smoke["layer_b"]
    lines += [
        "",
        "## Phase 3B Layer B — Bot API Connectivity",
        f"- chat_id found: {lb.get('chat_id_found')}",
        f"- sendMessage tested: {lb.get('send_tested')} | OK: {lb.get('send_ok')}",
        "",
        "## Phase 4 — Manual Photo Test",
        "_See instructions printed to console._",
        "_Run `python3 v2_test_harness/telegram_verify.py` after sending photo._",
    ]

    report_path = _ARTIFACTS_DIR / "report_telegram_smoke.md"
    report_path.write_text("\n".join(lines))
    print(f"  Report written: {report_path}")

    pad = 32 - len(bot_username)
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║           MANUAL PHOTO TEST REQUIRED                         ║
╠══════════════════════════════════════════════════════════════╣
║ From your phone:                                             ║
║  1. Open Telegram → search @{bot_username}{" " * max(0, pad)} ║
║  2. Send any nameplate photo of your GS10 or Micro820        ║
║  3. Caption: 'VFD tripped this morning, what is this and     ║
║              what do I check?'                               ║
║                                                              ║
║ When done, run:                                              ║
║    python3 v2_test_harness/telegram_verify.py                ║
╚══════════════════════════════════════════════════════════════╝""")


# ---------------------------------------------------------------------------
# Phase 5 — Telethon Setup Instructions
# ---------------------------------------------------------------------------


def phase5_telethon_instructions(bot_info: dict) -> None:
    print("\n=== PHASE 5: Optional Telethon Setup ===")
    bot_username = bot_info.get("username") or "MIRABot"
    print(f"""
OPTIONAL: Set up Telethon for full photo automation
 1. Get API credentials at: https://my.telegram.org/apps
 2. Add to ~/Mira/mira-bots/.env:
      TELEGRAM_TEST_API_ID=...
      TELEGRAM_TEST_API_HASH=...
      TELEGRAM_TEST_PHONE=+1...
      TELEGRAM_BOT_USERNAME=@{bot_username}
 3. docker compose run -it --rm telegram-test-runner python session_setup.py
 4. Then: python3 telegram_test_runner/run_test.py --all
""")


# ---------------------------------------------------------------------------
# Phase 6 — Smoke Results Checkpoint (no tag — gate lives in telegram_verify.py)
# ---------------------------------------------------------------------------


def phase6_write_smoke_results(smoke: dict) -> None:
    """Write GSD smoke results to JSON for telegram_verify.py to consume."""
    print("\n=== PHASE 6: Smoke Results Checkpoint ===")
    gsd_rate = smoke["gsd_rate"]
    _ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "gsd_passed": smoke["gsd_passed"],
        "gsd_total": smoke["gsd_total"],
        "gsd_rate": gsd_rate,
        "ts": datetime.now(tz=timezone.utc).isoformat(),
    }
    out = _ARTIFACTS_DIR / "smoke_results.json"
    out.write_text(json.dumps(payload, indent=2))
    print(f"  GSD smoke: {smoke['gsd_passed']}/{smoke['gsd_total']} ({gsd_rate:.0%})")
    print(f"  Saved: {out}")
    if gsd_rate >= 0.80:
        print("  Intelligence layer OK.")
        print("  Release gate is in telegram_verify.py — it tags only after the real")
        print("  Telegram photo path passes (phone → cloud → container → SQLite).")
        print("  Next:")
        print("    1. Send a nameplate photo from your phone to the bot")
        print("    2. python3 v2_test_harness/telegram_verify.py")
    else:
        print(f"  WARNING: GSD rate {gsd_rate:.0%} below 80%.")
        print("  Fix GSD engine failures before proceeding to photo test.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    print("MIRA Telegram Path End-to-End Test")
    print("=" * 50)

    if not BOT_TOKEN:
        print("ERROR: TELEGRAM_BOT_TOKEN not set. Check ~/Mira/mira-bots/.env")
        sys.exit(1)

    bot_info = phase1_bot_health()
    if not bot_info["healthy"]:
        print("\nPhase 1 FAILED — bot container not healthy. Stopping.")
        sys.exit(1)

    phase2_session_check()
    smoke = phase3b_smoke_test(bot_info)
    phase4_write_report_and_instructions(bot_info, smoke)
    phase5_telethon_instructions(bot_info)
    phase6_write_smoke_results(smoke)


if __name__ == "__main__":
    main()
