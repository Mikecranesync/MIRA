"""Replay historical technician turns through the CURRENT MIRA engine.

This is a real replay, and the name is chosen carefully. `offline_lab.py` does
NOT replay anything — it rescans recorded assistant text. This module does the
other thing: it takes the technician turns from a historical ledger and drives
them through today's `shared.engine.Supervisor.process_full()`, preserving real
session state between turns, so the FSM, UNS gate, pivot, carryover, guards and
dispatch logic all execute against a real historical conversation path.

What it does NOT do, stated plainly so nobody reads more into it:

  * It does not reproduce MIRA's PROSE. Inference is stubbed deterministically,
    so the reply text is a fixture, not a model output. Detectors that grade
    wording are meaningless here; detectors that grade ORCHESTRATION are not.
  * It does not exercise retrieval. `recall_knowledge` needs NEON_DATABASE_URL
    and returns [] without it (neon_recall.py), so grounding cannot be verified
    offline. That is a ledger-telemetry gap, not a replay gap — see evidence.py.
  * It does not prove MIRA would answer the same way in production, because
    production's answer depends on the model it is standing in for.

What it DOES prove is the thing that was previously unprovable offline: given
the exact turns a real technician sent, does today's deterministic engine reach
the same states, fire the same gates, and take the same dispatch decisions as
the build that produced the ledger?

Requires no Telegram, no network, no API tokens.

Usage:
    py -3 -m tests.regime1_telethon.campaign.replay --campaign c7 \\
        --conv t2_000_pivot_after_fault
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import io
import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "mira-bots"))

from tests.regime1_telethon.campaign.evidence import (  # noqa: E402
    ConversationEvidence,
    TurnEvidence,
)

LEDGER_DIR = HERE / "ledger"

# Engine log lines that name a deterministic decision. These are the observable
# proof that current code executed — a stored transcript can never produce them.
MARKERS = (
    "CTX_FRESH_THREAD_PIVOT",
    "CTX_FRESH_THREAD",
    "UNS_CONFIRM_REQUEST",
    "DRIVE_PACK_CLAIMED",
    "REPEATED_ANSWER_DETECTED",
    "REPEATED_ANSWER_UNRESOLVED",
    "UNSUPPORTED_PARAM_CLAIM_DETECTED",
    "UNSUPPORTED_PARAM_CLAIM_UNRESOLVED",
    "SELF_CRITIQUE_TRIGGERED",
    "SELF_CRITIQUE_GROUNDEDNESS_ACCEPT",
    "SAFETY_ALERT",
    "PRINT_STATE_EXIT",
    "ROUTER",
    "H4_GAP_ADMISSION_SKIPPED",
)

# A ROTATING set of genuinely distinct replies, not one string with a counter
# appended. CTX-004 compares normalized replies with difflib at >= 0.9, so a
# fixed stub (or a stub differing by a two-character suffix) trips the
# repeated-answer guard on turn 2 of every replay. That is a fixture artifact,
# and worse, it would mask a REAL repeat. Distinct prose keeps the repetition
# signal meaningful. These are deliberately generic: the replay exercises
# ORCHESTRATION, and the wording is a fixture, never a claim about MIRA.
DEFAULT_STUB_REPLIES = (
    "Checked the drive and the incoming supply; the trip pattern points at the line side.",
    "Measured across the DC bus and logged the value against the last known baseline.",
    "Walked the conveyor mechanically and looked for a jam or a dragging roller.",
    "Reviewed the alarm history for anything correlated with the shutdown window.",
    "Confirmed the control wiring at the terminal block and reseated the connector.",
)
DEFAULT_STUB_REPLY = DEFAULT_STUB_REPLIES[0]


class _MarkerCapture(logging.Handler):
    """Collect engine markers emitted while one turn is processed."""

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover - trivial
        try:
            self.lines.append(record.getMessage())
        except Exception:
            pass

    def markers(self) -> list[str]:
        found: list[str] = []
        for line in self.lines:
            for m in MARKERS:
                if line.startswith(m) and m not in found:
                    found.append(m)
        return found

    def reset(self) -> None:
        self.lines.clear()


def technician_turns(campaign: str, conv_id: str) -> list[dict]:
    """The technician turns of one historical conversation, in order.

    Reads only `role == "tech"` records. MIRA's old replies are deliberately
    NOT loaded — feeding them back would make this a transcript inspection
    again, which is exactly the confusion this module exists to avoid.
    """
    path = LEDGER_DIR / f"{campaign}.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"no ledger for campaign {campaign!r}: {path}")
    turns: list[dict] = []
    for line in io.open(path, encoding="utf-8"):
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("kind") != "turn" or rec.get("conv") != conv_id:
            continue
        if rec.get("role") != "tech":
            continue
        turns.append(
            {
                "i": rec.get("i"),
                "text": rec.get("text") or "",
                "strategy": rec.get("strategy"),
                "tier": rec.get("tier"),
            }
        )
    turns.sort(key=lambda t: t["i"] or 0)
    return turns


def _stub_reply_json(reply: str, next_state: str) -> str:
    return json.dumps(
        {"reply": reply, "next_state": next_state, "options": [], "confidence": "MEDIUM"}
    )


@contextlib.contextmanager
def stubbed_supervisor(db_path: str | None = None):
    """A REAL Supervisor with every inference dependency stubbed.

    Identical construction to the engine test fixtures
    (mira-bots/tests/test_ctx_fresh_thread_pivot.py) — the workers are patched,
    the engine is not. Everything deterministic in `process_full` runs for real:
    FSM transitions, the UNS gate, CTX-001d's pivot, carryover clearing,
    CTX-004/004b repetition guards, CIT-006, citation compliance, dispatch.

    `router.enabled = False` keeps the self-critique deterministic: the scorer
    early-returns {} without a router (engine.py `_self_critique_diagnosis`),
    so no clarifier fires on a coin flip.
    """
    for key, value in (
        ("TELEGRAM_BOT_TOKEN", "replay-token"),
        ("OPENWEBUI_BASE_URL", "http://localhost:8080"),
        ("OPENWEBUI_API_KEY", ""),
        ("KNOWLEDGE_COLLECTION_ID", "replay-collection"),
    ):
        os.environ.setdefault(key, value)

    from shared.engine import Supervisor  # noqa: PLC0415 — after sys.path setup

    tmp = None
    if db_path is None:
        tmp = tempfile.TemporaryDirectory()
        db_path = str(Path(tmp.name) / "replay.db")

    try:
        with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
            with (
                patch("shared.engine.VisionWorker"),
                patch("shared.engine.NameplateWorker"),
                patch("shared.engine.RAGWorker"),
                patch("shared.engine.PrintWorker"),
                patch("shared.engine.PLCWorker"),
                patch("shared.engine.NemotronClient"),
                patch("shared.engine.InferenceRouter"),
            ):
                sv = Supervisor(
                    db_path=db_path,
                    openwebui_url="http://localhost:3000",
                    api_key="replay-key",
                    collection_id="replay-collection",
                )
        sv.rag = MagicMock()
        sv.router = MagicMock()
        sv.router.enabled = False
        yield sv
    finally:
        if tmp is not None:
            tmp.cleanup()


def _snapshot(state: dict) -> dict:
    ctx = (state or {}).get("context") or {}
    uns = ctx.get("uns_context") or {}
    sc = ctx.get("session_context") or {}
    return {
        "fsm": (state or {}).get("state"),
        "asset": (state or {}).get("asset_identified"),
        "manufacturer": uns.get("manufacturer"),
        "model": uns.get("model"),
        "fault_code": uns.get("fault_code"),
        "confidence": uns.get("confidence"),
        "pending_question": bool(sc.get("last_question")),
        "counters": {
            k: ctx.get(k)
            for k in ("uns_gate_attempts", "identity_ask_count", "diag_rev_count")
            if ctx.get(k) is not None
        },
    }


async def replay_conversation(
    turns: list[dict],
    *,
    conv_id: str = "replay",
    stub_replies: tuple[str, ...] | None = None,
    stub_next_state: str = "Q1",
    router_intent: str = "diagnose_equipment",
    source_campaign: str | None = None,
    chat_id: str | None = None,
) -> ConversationEvidence:
    """Drive `turns` through the current engine, one at a time, keeping state.

    Session state is persisted by the Supervisor itself between turns (its own
    SQLite store), so turn N sees exactly what turn N-1 left behind — the same
    mechanism production uses.
    """
    chat_id = chat_id or f"replay-{conv_id}"
    routed = {"intent": router_intent, "confidence": 0.9, "reasoning": "replay-stub"}

    capture = _MarkerCapture()
    logger = logging.getLogger("mira-gsd")
    prior_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(capture)

    conv = ConversationEvidence(conv_id=conv_id, backend="replay", source_campaign=source_campaign)

    try:
        with stubbed_supervisor() as sv:
            # The stub varies per turn ON PURPOSE. A fixed string trips
            # CTX-004's repeated-answer guard on turn 2 of every replay, which
            # is a fixture artifact rather than a MIRA defect — and it would
            # mask a REAL repeat, since the guard grants one retry either way.
            # Varying keeps the repetition signal meaningful.
            turn_no = {"n": 0}
            pool = list(stub_replies or DEFAULT_STUB_REPLIES)

            async def fake_rag(message, state, *args, **kwargs):
                reply = pool[turn_no["n"] % len(pool)]
                turn_no["n"] += 1
                return _stub_reply_json(reply, stub_next_state)

            sv.rag.process = fake_rag

            for turn in turns:
                before = _snapshot(sv._load_state(chat_id))
                capture.reset()
                with patch("shared.engine.route_intent", new=AsyncMock(return_value=routed)):
                    result = await sv.process_full(chat_id, turn["text"])
                after = _snapshot(sv._load_state(chat_id))

                conv.turns.append(
                    TurnEvidence(
                        index=turn.get("i") or (len(conv.turns) + 1),
                        technician_message=turn["text"],
                        mira_reply=(result or {}).get("reply", ""),
                        technician_strategy=turn.get("strategy"),
                        trace_id=(result or {}).get("trace_id"),
                        router_intent=router_intent,
                        dispatch_kind=(result or {}).get("dispatch_kind"),
                        fsm_before=before["fsm"],
                        fsm_after=after["fsm"],
                        asset_identified=after["asset"],
                        pending_question=after["pending_question"],
                        state_counters=after["counters"],
                        uns_manufacturer=after["manufacturer"],
                        uns_model=after["model"],
                        uns_fault_code=after["fault_code"],
                        uns_confidence=after["confidence"],
                        engine_markers=capture.markers(),
                        inference_backend="stub",
                    )
                )
    finally:
        logger.removeHandler(capture)
        logger.setLevel(prior_level)

    return conv


def replay_ledger_conversation(campaign: str, conv_id: str, **kw) -> ConversationEvidence:
    """Convenience: load a historical conversation and replay it."""
    turns = technician_turns(campaign, conv_id)
    if not turns:
        raise ValueError(f"no technician turns for {campaign}/{conv_id}")
    return asyncio.run(replay_conversation(turns, conv_id=conv_id, source_campaign=campaign, **kw))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--conv", required=True)
    ap.add_argument("--json", action="store_true", help="emit the evidence as JSON")
    args = ap.parse_args()

    conv = replay_ledger_conversation(args.campaign, args.conv)

    if args.json:
        print(
            json.dumps(
                {
                    "conv_id": conv.conv_id,
                    "backend": conv.backend,
                    "source_campaign": conv.source_campaign,
                    "turns": [t.__dict__ for t in conv.turns],
                },
                indent=2,
                ensure_ascii=False,
            )
        )
        return 0

    print(f"replayed {conv.conv_id} from {conv.source_campaign} ({len(conv.turns)} turns)")
    print(f"{'i':>2}  {'fsm before':<24} {'fsm after':<24} markers")
    print("-" * 100)
    for t in conv.turns:
        print(
            f"{t.index:>2}  {str(t.fsm_before):<24} {str(t.fsm_after):<24} "
            f"{','.join(t.engine_markers) or '-'}"
        )
        print(f"    tech: {t.technician_message[:88]}")
        if t.uns_fault_code or t.uns_model:
            print(
                f"    uns : model={t.uns_model!r} fault={t.uns_fault_code!r} "
                f"pending_q={t.pending_question} counters={t.state_counters}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
