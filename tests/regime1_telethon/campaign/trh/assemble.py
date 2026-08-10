"""Assemble `TurnEvidence` for a real campaign conversation.

The runner's Telethon lane is **wire-only** — it sees text, never routes, gates
or retrieved chunks. That is not a defect to route around; it is why the
producers exist. This module is the JOIN, not a fourth telemetry format:

    ledger.jsonl          wire text            (always present)
    retrieval/<c>.jsonl   retrieved chunks     (retrieval_probe, optional)
    replay                markers + FSM        (replay.py, optional)

## The one rule: a producer that said nothing contributes nothing

Every merge below only ever *fills* a field that is still unset. It never
invents, never defaults, and never guesses from a sibling turn. A turn the
probe never covered keeps `retrieved_meta == []`, which
`TurnEvidence.observed()` reports as unobserved and the grader turns into
NOT_OBSERVED — not PASS.

That direction is the whole point. An assembler that quietly substituted "no
record" for "nothing was retrieved" would manufacture RETRIEVAL failures on
un-probed turns and RETRIEVAL passes on turns where the probe returned nothing,
and both errors would look like MIRA's fault.

## Why replay is optional and best-effort

`replay.py` rebuilds a real Supervisor with the six workers patched. It needs
importable engine code and a writable state DB, neither of which is guaranteed
on a CI runner or a phone-tethered laptop. When it cannot run, its fields stay
unobserved and the DIALOGUE/SCOPE graders degrade honestly rather than the whole
diagnosis failing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..evidence import ConversationEvidence, TurnEvidence

CAMPAIGN_DIR = Path(__file__).resolve().parents[1]
LEDGER_DIR = CAMPAIGN_DIR / "ledger"
RETRIEVAL_DIR = CAMPAIGN_DIR / "retrieval"


@dataclass
class AssemblyReport:
    """What each producer actually contributed — printed with the diagnosis.

    Without this, a run with no probe records looks identical to a run where
    retrieval genuinely returned nothing, and the report's coverage section
    cannot tell the reader which one they are looking at.
    """

    conv_id: str
    turns: int = 0
    from_ledger: int = 0
    with_retrieval: int = 0
    with_replay: int = 0
    replay_error: str = ""
    notes: list[str] = field(default_factory=list)

    def coverage_note(self) -> str:
        bits = [f"`{self.conv_id}`: {self.turns} turn(s)"]
        bits.append(f"retrieval snapshot on {self.with_retrieval}/{self.turns}")
        if self.replay_error:
            bits.append(f"replay unavailable ({self.replay_error})")
        else:
            bits.append(f"replay markers on {self.with_replay}/{self.turns}")
        return " · ".join(bits)


# ---------------------------------------------------------------------------
# ledger -> wire text
# ---------------------------------------------------------------------------


def _ledger_path(campaign: str) -> Path:
    return LEDGER_DIR / f"{campaign}.jsonl"


def read_ledger(campaign: str) -> list[dict]:
    path = _ledger_path(campaign)
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue  # a truncated tail line must not kill the whole diagnosis
    return out


def conversations(campaign: str) -> list[str]:
    """Conversation ids present in a campaign ledger, in first-seen order."""
    seen: list[str] = []
    for rec in read_ledger(campaign):
        conv = rec.get("conv")
        if conv and conv not in seen:
            seen.append(conv)
    return seen


def from_ledger(campaign: str, conv_id: str) -> tuple[ConversationEvidence, AssemblyReport]:
    """Pair up tech/mira records into turns.

    A `tech` record opens a turn; the next `mira` record closes it. Probe/judge
    bookkeeping rows are skipped. A tech message with no reply still produces a
    turn — a dropped reply is a finding, not a row to discard.

    **`TurnEvidence.index` is the LEDGER's `i`, never a local counter.** The
    runner numbers turns from 1 within a scenario and `retrieval_probe` records
    against that same number. A locally-enumerated index looked right (0, 1, 2…)
    and silently joined nothing: every probe record missed, so RETRIEVAL read
    NOT_OBSERVED across a campaign that had been probed. The failure was
    invisible because NOT_OBSERVED is exactly what an un-probed run should show.
    """
    rep = AssemblyReport(conv_id=conv_id)
    turns: list[TurnEvidence] = []
    current: TurnEvidence | None = None
    fallback_idx = 0

    for rec in read_ledger(campaign):
        if rec.get("kind") != "turn" or rec.get("conv") != conv_id:
            continue
        role, text = rec.get("role"), rec.get("text") or ""
        if role == "tech":
            if current is not None:
                turns.append(current)
            raw_i = rec.get("i")
            if isinstance(raw_i, int):
                idx = raw_i
            else:
                idx = fallback_idx
                rep.notes.append(f"turn {fallback_idx} had no ledger index; probe join may miss")
            fallback_idx += 1
            current = TurnEvidence(index=idx, technician_message=text)
        elif role == "mira" and current is not None:
            # First reply wins: a retry that overwrote it would hide the
            # original, and the original is what the technician saw.
            if not current.mira_reply:
                current.mira_reply = text
                if rec.get("grade"):
                    current.state_counters["ledger_grade"] = rec["grade"]
    if current is not None:
        turns.append(current)

    rep.turns = len(turns)
    rep.from_ledger = len(turns)
    return (
        ConversationEvidence(
            conv_id=conv_id, turns=turns, backend="telethon", source_campaign=campaign
        ),
        rep,
    )


# ---------------------------------------------------------------------------
# retrieval probe -> retrieved chunks
# ---------------------------------------------------------------------------


def _retrieval_records(campaign: str, conv_id: str) -> dict[int, dict]:
    path = RETRIEVAL_DIR / f"{campaign}.jsonl"
    if not path.exists():
        return {}
    out: dict[int, dict] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("conv") != conv_id:
            continue
        # Later records win: the probe appends, so a re-probe supersedes.
        out[int(rec.get("i", 0))] = rec
    return out


def merge_retrieval(conv: ConversationEvidence, rep: AssemblyReport) -> None:
    """Fill retrieval fields from probe records. Absent record => untouched."""
    recs = _retrieval_records(conv.source_campaign or "", conv.conv_id)
    if not recs:
        rep.notes.append(
            "no retrieval probe records — RETRIEVAL/EVIDENCE will be NOT_OBSERVED "
            "(run `retrieval_probe` to make them decidable)"
        )
        return
    for turn in conv.turns:
        rec = recs.get(turn.index)
        if rec is None:
            continue
        turn.retrieval_query = rec.get("query") or turn.retrieval_query
        if rec.get("embedded") is not None:
            turn.retrieval_embedded = rec["embedded"]
        if rec.get("retrieved"):
            turn.retrieved_meta = rec["retrieved"]
        if rec.get("param_support"):
            turn.param_support = rec["param_support"]
        # The probe resolves the asset deterministically from technician text,
        # so it is a legitimate SCOPE source when replay is unavailable.
        turn.asset_identified = turn.asset_identified or rec.get("asset_identified")
        turn.uns_model = turn.uns_model or rec.get("uns_model")
        turn.uns_fault_code = turn.uns_fault_code or rec.get("uns_fault_code")
        rep.with_retrieval += 1


# ---------------------------------------------------------------------------
# replay -> engine markers + FSM
# ---------------------------------------------------------------------------


def merge_replay(conv: ConversationEvidence, rep: AssemblyReport) -> None:
    """Best-effort. A replay that cannot run leaves every field unobserved."""
    try:
        import asyncio
        import concurrent.futures

        from .. import replay as replay_mod

        # `replay_ledger_conversation` wraps `asyncio.run`, which REFUSES to run
        # while a loop is already active. The runner used to call diagnosis from
        # inside `amain()`, so it raised and the coroutine built as its argument
        # was orphaned. That surfaced only as `RuntimeWarning: coroutine
        # 'replay_conversation' was never awaited`, while `replay markers on 0/N`
        # read as an ordinary absence of telemetry — 462 tests passed around it
        # because every one of them stubbed or skipped this producer.
        #
        # The call site is fixed (diagnosis runs from `main`, after the loop
        # closes). The producer is hardened too, so a future async caller gets a
        # worker thread with its own loop rather than a silent no-op.
        try:
            asyncio.get_running_loop()
            in_loop = True
        except RuntimeError:
            in_loop = False

        if in_loop:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                replayed = pool.submit(
                    replay_mod.replay_ledger_conversation,
                    conv.source_campaign or "",
                    conv.conv_id,
                ).result()
        else:
            replayed = replay_mod.replay_ledger_conversation(
                conv.source_campaign or "", conv.conv_id
            )
    except Exception as exc:  # noqa: BLE001 - optional producer
        rep.replay_error = f"{type(exc).__name__}: {exc}"[:120]
        rep.notes.append("replay unavailable — DIALOGUE/SCOPE fall back to ledger + probe evidence")
        return

    by_index = {t.index: t for t in replayed.turns}
    for turn in conv.turns:
        src = by_index.get(turn.index)
        if src is None:
            continue
        # Replay does NOT reproduce prose (inference is stubbed) — never copy
        # mira_reply from it, only orchestration facts.
        turn.engine_markers = src.engine_markers or turn.engine_markers
        turn.fsm_before = turn.fsm_before or src.fsm_before
        turn.fsm_after = turn.fsm_after or src.fsm_after
        turn.asset_identified = turn.asset_identified or src.asset_identified
        turn.uns_manufacturer = turn.uns_manufacturer or src.uns_manufacturer
        turn.uns_model = turn.uns_model or src.uns_model
        turn.uns_fault_code = turn.uns_fault_code or src.uns_fault_code
        if src.state_counters:
            turn.state_counters = {**src.state_counters, **turn.state_counters}
        if src.engine_markers or src.fsm_after:
            rep.with_replay += 1


# ---------------------------------------------------------------------------
# the join
# ---------------------------------------------------------------------------


def assemble(
    campaign: str, conv_id: str, use_replay: bool = True
) -> tuple[ConversationEvidence, AssemblyReport]:
    """Full evidence for one conversation, plus what each producer contributed."""
    conv, rep = from_ledger(campaign, conv_id)
    if not conv.turns:
        rep.notes.append("no turns in the ledger for this conversation")
        return conv, rep
    merge_retrieval(conv, rep)
    if use_replay:
        merge_replay(conv, rep)
    else:
        rep.notes.append("replay skipped (--no-replay)")
    return conv, rep


def assemble_campaign(
    campaign: str, use_replay: bool = True, only: str | None = None
) -> list[tuple[ConversationEvidence, AssemblyReport]]:
    out = []
    for conv_id in conversations(campaign):
        if only and only not in conv_id:
            continue
        out.append(assemble(campaign, conv_id, use_replay=use_replay))
    return out


def coverage_summary(reports: list[AssemblyReport]) -> dict[str, Any]:
    """Aggregate producer coverage — feeds the report's limits section."""
    turns = sum(r.turns for r in reports)
    return {
        "conversations": len(reports),
        "turns": turns,
        "turns_with_retrieval": sum(r.with_retrieval for r in reports),
        "turns_with_replay": sum(r.with_replay for r in reports),
        "replay_failures": sum(1 for r in reports if r.replay_error),
    }
