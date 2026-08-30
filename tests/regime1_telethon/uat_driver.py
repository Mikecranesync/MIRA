"""Telethon UAT driver — real-Telegram conversation scenarios against the bot.

PRD: docs/prd/2026-08-06-telethon-uat-loop.md. Sends scripted user turns to the
STAGING bot over a real Telegram user session, collects the full rendered reply
(text + inline button labels), and grades each turn with the same deterministic
semantics as the offline battery (expect = any-match substring, forbid =
hard-fail). FSM state is not observable over the wire — grading is reply-text
only, stated in the scorecard header.

Hard rails:
  - Default (and only unauthorized) target: @Mira_stagong_bot. Any other target
    requires BOTH --allow-other-bot and --auth "<explicit per-run authorization
    string from the owner>". There is no way to reach the prod bot by accident.
  - >= 2 s between sends; one scenario at a time; 90 s reply timeout.
  - Text lanes only (no photos, no media).

Usage:
  doppler run -p factorylm -c stg -- py -3 tests/regime1_telethon/uat_driver.py \
      --scripts tests/regime1_telethon/uat_scripts --report tests/eval/runs/uat_live.md
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml
from telethon import TelegramClient

STAGING_BOT = "@Mira_stagong_bot"
REPLY_TIMEOUT_S = 90
QUIET_S = 3.0
SEND_GAP_S = 2.0


def flatten_message(msg) -> str:
    parts = [msg.message or ""]
    markup = getattr(msg, "reply_markup", None)
    if markup and getattr(markup, "rows", None):
        for row in markup.rows:
            for btn in row.buttons:
                text = getattr(btn, "text", "")
                if text:
                    parts.append(f"[button: {text}]")
    return "\n".join(p for p in parts if p)


async def collect_reply(client, bot, min_id: int) -> tuple[str, int]:
    """Wait for bot messages newer than min_id until quiet or timeout."""
    deadline = time.time() + REPLY_TIMEOUT_S
    got: dict[int, str] = {}
    last_new = time.time()
    while time.time() < deadline:
        msgs = await client.get_messages(bot, min_id=min_id, limit=20)
        new = False
        for m in msgs:
            if m.out:
                continue
            if m.id not in got:
                got[m.id] = flatten_message(m)
                new = True
        if new:
            last_new = time.time()
        elif got and time.time() - last_new >= QUIET_S:
            # "Diagnosing..." is a progress stub, not the reply — keep waiting
            # for a substantive message before closing the window.
            substantive = [t for t in got.values() if t.strip() and t.strip() != "Diagnosing..."]
            if substantive:
                break
        await asyncio.sleep(0.7)
    ordered = [got[k] for k in sorted(got)]
    new_min = max(got) if got else min_id
    return "\n".join(ordered), new_min


def grade_turn(
    reply: str, expect: list, forbid: list, expect_all: list | None = None
) -> tuple[bool, list[str]]:
    """Grade one reply.

    `expect` is ANY-match (a disjunction of acceptable phrasings), which is the
    right semantics for "MIRA said this in one of several legitimate ways" and
    the WRONG semantics for "both of these tokens must survive". A two-token
    `expect` passes on either token alone, so the second anchor is dead weight —
    `expect_all` is the conjunction, for the case where each token came from the
    technician and dropping one is a visible failure.
    """
    low = reply.lower()
    notes = []
    ok = True
    if expect:
        if not any(str(e).lower() in low for e in expect):
            ok = False
            notes.append(f"expect miss: none of {expect}")
    for e in expect_all or []:
        if str(e).lower() not in low:
            ok = False
            notes.append(f"expect_all miss: {e!r} absent")
    for f in forbid or []:
        if str(f).lower() in low:
            ok = False
            notes.append(f"forbidden present: {f!r}")
    return ok, notes


async def run_scenario(client, bot, scenario: dict, report_lines: list) -> bool:
    sid = scenario.get("id", "unnamed")
    report_lines.append(f"\n### {sid} — {scenario.get('contract', '')}")
    last = await client.get_messages(bot, limit=1)
    min_id = last[0].id if last else 0

    if scenario.get("reset", True):
        await client.send_message(bot, "/new")
        _, min_id = await collect_reply(client, bot, min_id)
        await asyncio.sleep(SEND_GAP_S)

    passed = True
    for i, turn in enumerate(scenario.get("turns", []), 1):
        text = turn["send"]
        await client.send_message(bot, text)
        reply, min_id = await collect_reply(client, bot, min_id)
        ok, notes = grade_turn(reply, turn.get("expect", []), turn.get("forbid", []))
        mark = "PASS" if ok else "FAIL"
        report_lines.append(f"- T{i} `{text[:60]}` → **{mark}**")
        if not ok:
            passed = False
            for n in notes:
                report_lines.append(f"  - {n}")
            report_lines.append(f"  - reply: {reply[:400]!r}")
        await asyncio.sleep(SEND_GAP_S)
    return passed


async def amain(args) -> int:
    bot = args.bot
    if bot != STAGING_BOT:
        if not (args.allow_other_bot and args.auth):
            print(
                f"REFUSED: target {bot!r} is not the staging bot. "
                "Non-staging targets require --allow-other-bot AND --auth "
                "'<explicit per-run authorization from the owner>'."
            )
            return 2
        print(f"WARNING: non-staging target {bot} authorized: {args.auth!r}")

    scripts_path = Path(args.scripts)
    files = sorted(scripts_path.glob("*.yaml")) if scripts_path.is_dir() else [scripts_path]
    if args.only:
        files = [f for f in files if args.only in f.name]
    scenarios = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]
    print(f"{len(scenarios)} scenario(s): {[s.get('id') for s in scenarios]}")
    if args.dry_run:
        for s in scenarios:
            for t in s.get("turns", []):
                print(f"  {s['id']}: send {t['send']!r}")
        return 0

    api_id = int(os.environ["TELEGRAM_TEST_API_ID"])
    api_hash = os.environ["TELEGRAM_TEST_API_HASH"]
    session = args.session

    client = TelegramClient(session, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        print("FATAL: session not authorized — run uat_login.py first.")
        return 3
    me = await client.get_me()
    print(f"Connected as {me.first_name} (@{me.username or me.phone}) → target {bot}")

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    report_lines = [
        f"# Telethon UAT run — {stamp}Z",
        f"target: {bot} · deploy SHA: {args.deploy_sha or 'unrecorded'} · "
        "grading: reply text + button labels only (FSM state not observable)",
    ]
    results = {}
    for scenario in scenarios:
        ok = await run_scenario(client, bot, scenario, report_lines)
        results[scenario.get("id", "?")] = ok
        print(f"{'PASS' if ok else 'FAIL'}  {scenario.get('id')}")

    n_pass = sum(results.values())
    report_lines.insert(2, f"\n**{n_pass}/{len(results)} scenarios passed**")
    report_lines.append("\n## Summary")
    for k, v in results.items():
        report_lines.append(f"- {'PASS' if v else 'FAIL'} — {k}")
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text("\n".join(report_lines), encoding="utf-8")
    print(f"Report: {args.report}  ({n_pass}/{len(results)})")

    await client.disconnect()
    return 0 if n_pass == len(results) else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scripts", required=True)
    ap.add_argument("--bot", default=STAGING_BOT)
    ap.add_argument("--allow-other-bot", action="store_true")
    ap.add_argument("--auth", default="")
    ap.add_argument("--session", default="tests/regime1_telethon/uat_account.session")
    ap.add_argument("--report", default="tests/eval/runs/uat_live.md")
    ap.add_argument("--deploy-sha", default="")
    ap.add_argument("--only", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    return asyncio.run(amain(args))


if __name__ == "__main__":
    sys.exit(main())
