"""Campaign runner — executes tiers against the staging bot, ledgered + resumable.

Tier 1/2: seeded deterministic scripts, graded expect/forbid per turn.
Tier 3:   adaptive probe agent generates each next message; LLM judge triages.
Tier 8:   persona-driven adaptive conversations (same loop, persona overlay).

Rails inherited from uat_driver: staging bot hardwired, >=2 s send gap, 90 s
reply timeout, text only. FAIL/SUSPECT conversations are frozen (full
transcript + meta) for the offline defect loop; the campaign continues.

Usage (chunked; resumable — completed conv ids are skipped):
  doppler run -p factorylm -c stg -- py -3 -m tests.regime1_telethon.campaign.runner \
      --campaign c1 --tier 1 --count 20 --seed 41 --deploy-sha <sha>
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import os
import sys
from pathlib import Path

from telethon import TelegramClient

sys.path.insert(0, str(Path(__file__).parents[3]))  # repo root

from tests.regime1_telethon.campaign import judge as judge_mod
from tests.regime1_telethon.campaign import ledger
from tests.regime1_telethon.campaign import probe as probe_mod
from tests.regime1_telethon.campaign.personas import PERSONAS

uat = importlib.import_module("tests.regime1_telethon.uat_driver")

STAGING_BOT = uat.STAGING_BOT
MAX_ADAPTIVE_TURNS = 9


async def scripted_conversation(client, scenario, args) -> tuple[bool, list[dict]]:
    """Tier 1/2: run a generated script, grade per turn."""
    transcript = []
    last = await client.get_messages(STAGING_BOT, limit=1)
    min_id = last[0].id if last else 0
    await client.send_message(STAGING_BOT, "/new")
    _, min_id = await uat.collect_reply(client, STAGING_BOT, min_id)
    await asyncio.sleep(uat.SEND_GAP_S)

    passed = True
    for i, turn in enumerate(scenario["turns"], 1):
        await client.send_message(STAGING_BOT, turn["send"])
        transcript.append(dict(role="tech", text=turn["send"]))
        ledger.turn(args.campaign, scenario["id"], args.tier, i, "tech", turn["send"])
        reply, min_id = await uat.collect_reply(client, STAGING_BOT, min_id)
        transcript.append(dict(role="mira", text=reply))
        ok, notes = uat.grade_turn(reply, turn.get("expect", []), turn.get("forbid", []))
        ledger.turn(
            args.campaign,
            scenario["id"],
            args.tier,
            i,
            "mira",
            reply,
            grade="PASS" if ok else "FAIL",
            notes="; ".join(notes),
        )
        if not ok:
            passed = False
        await asyncio.sleep(uat.SEND_GAP_S)
    return passed, transcript


async def adaptive_conversation(
    client, conv_id, args, persona: str = ""
) -> tuple[dict, list[dict]]:
    """Tier 3/8: probe agent drives; judge triages at the end."""
    style = PERSONAS[persona]["style"] if persona else ""
    opener = PERSONAS[persona]["opener"] if persona else ""
    transcript = []
    used: dict[str, int] = {}

    last = await client.get_messages(STAGING_BOT, limit=1)
    min_id = last[0].id if last else 0
    await client.send_message(STAGING_BOT, "/new")
    _, min_id = await uat.collect_reply(client, STAGING_BOT, min_id)
    await asyncio.sleep(uat.SEND_GAP_S)

    for i in range(1, MAX_ADAPTIVE_TURNS + 1):
        if i == 1:
            if opener:
                move = dict(
                    action="ask", strategy=f"persona:{persona}", message=opener, reason="opener"
                )
            else:
                move = probe_mod.next_move(
                    [
                        dict(
                            role="mira",
                            text="(fresh conversation — open with a plant-floor problem or question)",
                        )
                    ],
                    used,
                    style,
                )
        else:
            move = probe_mod.next_move(transcript, used, style)
        if move["action"] == "end" or not move.get("message"):
            ledger.turn(args.campaign, conv_id, args.tier, i, "probe_end", move.get("reason", ""))
            break
        used[move["strategy"]] = used.get(move["strategy"], 0) + 1
        await client.send_message(STAGING_BOT, move["message"])
        transcript.append(dict(role="tech", text=move["message"]))
        ledger.turn(
            args.campaign, conv_id, args.tier, i, "tech", move["message"], strategy=move["strategy"]
        )
        reply, min_id = await uat.collect_reply(client, STAGING_BOT, min_id)
        transcript.append(dict(role="mira", text=reply))
        ledger.turn(args.campaign, conv_id, args.tier, i, "mira", reply)
        await asyncio.sleep(uat.SEND_GAP_S)

    v = judge_mod.judge(transcript)
    return v, transcript


async def amain(args) -> int:
    api_id = int(os.environ["TELEGRAM_TEST_API_ID"])
    api_hash = os.environ["TELEGRAM_TEST_API_HASH"]
    client = TelegramClient(args.session, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        print("FATAL: session not authorized")
        return 3
    me = await client.get_me()
    done = ledger.completed_convs(args.campaign)
    print(
        f"campaign={args.campaign} tier={args.tier} as @{me.username} — {len(done)} convs already done"
    )

    n_pass = n_fail = n_skip = 0
    meta = dict(deploy_sha=args.deploy_sha, seed=args.seed, telegram=str(me.username))

    if args.tier in (1, 2):
        gen = importlib.import_module(
            "tests.regime1_telethon.campaign." + ("mutators" if args.tier == 1 else "state_attacks")
        )
        scenarios = gen.generate(args.seed, args.count)
        for sc in scenarios:
            if sc["id"] in done:
                n_skip += 1
                continue
            ok, transcript = await scripted_conversation(client, sc, args)
            ledger.verdict(
                args.campaign,
                sc["id"],
                args.tier,
                "PASS" if ok else "FAIL",
                category="" if ok else "UNTRIAGED",
                **meta,
            )
            if ok:
                n_pass += 1
            else:
                n_fail += 1
                p = ledger.freeze(args.campaign, sc["id"], transcript, dict(scenario=sc, **meta))
                print(f"FROZEN: {p.name}")
            print(f"{'PASS' if ok else 'FAIL'}  {sc['id']}")
    elif args.tier in (3, 8):
        personas = list(PERSONAS) if args.tier == 8 else [""]
        for i in range(args.count):
            persona = personas[i % len(personas)] if args.tier == 8 else ""
            conv_id = f"t{args.tier}_{args.seed}_{i:03d}" + (f"_{persona}" if persona else "")
            if conv_id in done:
                n_skip += 1
                continue
            v, transcript = await adaptive_conversation(client, conv_id, args, persona)
            ledger.verdict(
                args.campaign,
                conv_id,
                args.tier,
                v["verdict"],
                category=v.get("category", ""),
                notes=v.get("reason", ""),
                evidence=v.get("evidence", ""),
                **meta,
            )
            if v["verdict"] == "PASS":
                n_pass += 1
            else:
                n_fail += 1
                p = ledger.freeze(args.campaign, conv_id, transcript, dict(judge=v, **meta))
                print(f"FROZEN: {p.name}  [{v.get('category')}] {v.get('reason')}")
            print(f"{v['verdict']}  {conv_id}")
    else:
        print(f"tier {args.tier} not implemented in this runner version")
        return 2

    print(f"DONE tier={args.tier}: {n_pass} pass, {n_fail} fail/suspect, {n_skip} skipped (resume)")
    await client.disconnect()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--tier", type=int, required=True)
    ap.add_argument("--count", type=int, default=10)
    ap.add_argument("--seed", type=int, default=41)
    ap.add_argument("--deploy-sha", default="")
    ap.add_argument("--session", default="tests/regime1_telethon/uat_account.session")
    return asyncio.run(amain(ap.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
