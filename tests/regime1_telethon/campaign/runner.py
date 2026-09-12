"""Campaign runner — executes tiers against the staging bot, ledgered + resumable.

Tier 1/2: seeded deterministic scripts, graded expect/forbid per turn.
Tier 3:   adaptive probe agent generates each next message; LLM judge triages.
Tier 5:   work-order / CMMS lifecycle. Scripted, but the ONLY tier that WRITES
          (real rows in the staging Atlas CMMS) and the only one with a
          precondition that can invalidate every later cell — run it LAST.
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

from tests.regime1_telethon.campaign import gates
from tests.regime1_telethon.campaign import judge as judge_mod
from tests.regime1_telethon.campaign import safety as safety_mod
from tests.regime1_telethon.campaign import ledger
from tests.regime1_telethon.campaign import probe as probe_mod
from tests.regime1_telethon.campaign import session_control
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
        ok, notes = uat.grade_turn(
            reply,
            turn.get("expect", []),
            turn.get("forbid", []),
            expect_all=turn.get("expect_all", []),
        )
        # A declared gate is the authoritative contract for that turn; the
        # expect/forbid list grades vocabulary, the gate grades behaviour.
        #
        # Resolved through gates.TURN_GATES rather than compared against a
        # literal. The literal form dispatched exactly ONE name, so a scenario
        # declaring any other gate went silently ungraded and reported PASS —
        # a check that cannot fail. An unknown name now raises, loudly, rather
        # than letting a typo disarm its own grading.
        # A turn often needs two contracts at once (is this grounded, AND does
        # it avoid the footer). declared_turn_gates accepts one name or several,
        # so a scenario never has to silently drop one.
        for gate_name in gates.declared_turn_gates(turn):
            gv = gates.resolve_turn_gate(gate_name)(reply, scenario["id"])
            if gv:
                ok = False
                notes = notes + [str(x) for x in gv]
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

    # Conversation-level contracts run ONCE, over the whole transcript. They
    # cannot ride turn["gate"] — they take a transcript, not a reply — so a
    # scenario declares them separately. Without this dispatch they would be
    # declared and never run: the same "looks graded, isn't" failure the
    # turn-gate registry closed.
    #
    # Two shapes, because the tiers need different things and neither should be
    # forced into the other:
    #   * a `precondition` (tier 4) can yield a THIRD verdict, INCONCLUSIVE —
    #     a scenario whose capability never got exercised must not report green,
    #     and "we could not tell" is not a pass.
    #   * plain `conv_gates` (tier 7) are pass/fail over the transcript.
    verdict = "PASS" if passed else "FAIL"
    conv_notes: list[str] = []
    if scenario.get("precondition"):
        verdict, conv_notes = session_control.grade_conversation(
            scenario, transcript, turn_ok=passed
        )
    else:
        for conv_gate_name in scenario.get("conv_gates", []):
            cv = gates.resolve_conversation_gate(conv_gate_name)(transcript, scenario["id"])
            if cv:
                verdict = "FAIL"
                conv_notes += [str(v) for v in cv]
    for note in conv_notes:
        print(f"  GATE {note}")
    if conv_notes:
        ledger.turn(
            args.campaign,
            scenario["id"],
            args.tier,
            len(scenario["turns"]) + 1,
            "conv_gate",
            "; ".join(conv_notes),
            grade=verdict,
        )
    return verdict, transcript


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

    if args.tier in (1, 2, 4, 5, 7, 9):
        # Tier 9 is the safety curriculum. It rides the scripted path because the
        # turns are fixed, but its authoritative grading is the deterministic gate
        # in campaign/gates.py, applied below — an expect/forbid substring match is
        # not strong enough to gate a release on.
        #
        # Tier 5 is the work-order lifecycle: the only tier that WRITES (real rows
        # in the staging Atlas CMMS) and the only one with a precondition that can
        # invalidate every later cell. Run it LAST in a multi-tier session.
        gen = importlib.import_module(
            "tests.regime1_telethon.campaign."
            + {
                1: "mutators",
                2: "state_attacks",
                4: "session_control",
                5: "work_order_lifecycle",
                7: "citation_integrity",
                9: "safety",
            }[args.tier]
        )
        scenarios = gen.generate(args.seed, args.count)
        for sc in scenarios:
            if sc["id"] in done:
                n_skip += 1
                continue
            verdict, transcript = await scripted_conversation(client, sc, args)
            ok = verdict == "PASS"
            # Tier 9: the deterministic safety gate outranks the substring grade.
            # A judge may not overrule it and neither may a lucky expect match.
            if args.tier == 9 and sc.get("safety_case_id"):
                case = next((c for c in safety_mod.CASES if c.id == sc["safety_case_id"]), None)
                if case is not None:
                    reply = next(
                        (t["text"] for t in reversed(transcript) if t["role"] == "mira"), ""
                    )
                    gate_violations = gates.check_safety_reply(
                        case, reply
                    ) + gates.check_no_control_action(reply, case.id)
                    if gate_violations:
                        ok = False
                        verdict = "FAIL"
                        for gv in gate_violations:
                            print(f"  GATE {gv}")
            # INCONCLUSIVE is recorded as itself, never folded into PASS. A
            # scenario whose capability was never exercised must not read green.
            ledger.verdict(
                args.campaign,
                sc["id"],
                args.tier,
                verdict,
                category="" if ok else "UNTRIAGED",
                **meta,
            )
            if ok:
                n_pass += 1
            else:
                n_fail += 1
                p = ledger.freeze(args.campaign, sc["id"], transcript, dict(scenario=sc, **meta))
                print(f"FROZEN: {p.name}")
            print(f"{verdict}  {sc['id']}")
            # Tier 5 declares a precondition: if the work-order fast path never
            # armed a draft, every later scenario reports on a lifecycle that
            # never started — and its honesty gate passes vacuously on a failure
            # admission, so the column would read GREEN. Abort rather than spend
            # live turns buying a verdict that cannot mean anything.
            if hasattr(gen, "should_abort") and gen.should_abort(sc["id"], ok):
                print(getattr(gen, "ABORT_MESSAGE", "precondition failed — aborting tier"))
                await client.disconnect()
                return 4
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
    elif args.tier == 4:
        from tests.regime1_telethon.campaign import truth

        equipment = truth.known_equipment()
        print(f"tier4 ground truth: {len(equipment)} equipment labels loaded")
        suffix = truth.JUDGE_SUFFIX.format(
            equipment=", ".join(equipment[:120]) or "(none — empty tenant)"
        )
        conv_id = f"t4_{args.seed}_{0:03d}"
        if conv_id in done:
            n_skip += 1
        else:
            transcript = []
            last = await client.get_messages(STAGING_BOT, limit=1)
            min_id = last[0].id if last else 0
            await client.send_message(STAGING_BOT, "/new")
            _, min_id = await uat.collect_reply(client, STAGING_BOT, min_id)
            await asyncio.sleep(uat.SEND_GAP_S)
            for i, q in enumerate(truth.TIER4_QUESTIONS[: args.count], 1):
                await client.send_message(STAGING_BOT, q)
                transcript.append(dict(role="tech", text=q))
                ledger.turn(args.campaign, conv_id, 4, i, "tech", q)
                reply, min_id = await uat.collect_reply(client, STAGING_BOT, min_id)
                transcript.append(dict(role="mira", text=reply))
                ledger.turn(args.campaign, conv_id, 4, i, "mira", reply)
                await asyncio.sleep(uat.SEND_GAP_S)
            judge_mod_sys = judge_mod.SYSTEM + suffix
            convo = "\n".join(f"{h['role'].upper()}: {h['text'][:600]}" for h in transcript)
            from tests.regime1_telethon.campaign import llm as llm_mod

            v = llm_mod.complete_json(
                judge_mod_sys, f"CONVERSATION:\n{convo}\n\nJudge (JSON only):"
            )
            if v.get("verdict") not in ("PASS", "SUSPECT"):
                v = {
                    "verdict": "SUSPECT",
                    "category": "HARNESS",
                    "reason": "malformed judge output",
                }
            ledger.verdict(
                args.campaign,
                conv_id,
                4,
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
                pth = ledger.freeze(args.campaign, conv_id, transcript, dict(judge=v, **meta))
                print(f"FROZEN: {pth.name}  [{v.get('category')}] {v.get('reason')}")
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
