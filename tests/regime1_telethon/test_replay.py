"""Replay executes CURRENT MIRA logic — not stored assistant text.

That distinction is the whole point of `campaign/replay.py`, and it is easy to
lose: `offline_lab.py` also consumes ledgers, but it only rescans recorded
replies. These tests pin the difference with evidence a transcript scan could
never produce — engine log markers, FSM transitions, and state mutated between
turns by the engine itself.

The last test is the load-bearing one: it MUTATES a deterministic state
behaviour and proves the replay notices. A replay that cannot fail when the
engine changes is decoration.

Ledger-backed tests skip when `ledger/` is absent — it is gitignored and
local-only, so CI has no campaign data. Everything that verifies the replay
ENGINE runs on synthetic turns and therefore runs everywhere.
"""

from __future__ import annotations

import pytest

from tests.regime1_telethon.campaign import replay
from tests.regime1_telethon.campaign.evidence import ConversationEvidence

# A dead-thread conversation shaped like the live c6/c7 pivot scenario. Written
# out rather than loaded, so these run in CI where ledgers do not exist.
PIVOT_TURNS = [
    {"i": 1, "text": "What does F004 mean on a PowerFlex 525?"},
    {"i": 2, "text": "How do I reset it?"},
    {"i": 3, "text": "Actually forget that — my conveyor keeps stopping."},
]


@pytest.mark.asyncio
async def test_replay_executes_the_engine_rather_than_reading_stored_text():
    """Three independent proofs that MIRA actually ran.

    None of these can come from a ledger: markers are emitted by engine.py at
    runtime, FSM transitions are computed by the FSM, and the reply is the
    stub fixture — NOT the historical text that ledger conversation contains.
    """
    conv = await replay.replay_conversation(PIVOT_TURNS, conv_id="pivot")

    assert isinstance(conv, ConversationEvidence)
    assert conv.backend == "replay"
    assert len(conv.turns) == 3

    # 1. Engine markers exist at all.
    assert conv.markers(), "no engine markers — nothing executed"

    # 2. The FSM advanced, which only the FSM can do.
    assert conv.turns[0].fsm_before == "IDLE"
    assert conv.turns[0].fsm_after in {"Q1", "Q2", "Q3", "DIAGNOSIS"}

    # 3. The replies are the STUB, not the historical MIRA text.
    assert all(t.mira_reply in replay.DEFAULT_STUB_REPLIES for t in conv.turns), (
        "replay returned something other than the stub — is inference really stubbed?"
    )
    assert not any("UnderVoltage" in t.mira_reply for t in conv.turns), (
        "historical assistant text leaked into the replay"
    )


@pytest.mark.asyncio
async def test_state_is_preserved_between_turns_by_the_engine():
    """Turn 1 resolves the drive; turn 2 must still see it.

    The Supervisor persists session state to its own store between calls — the
    same mechanism production uses. If each turn started clean, this fails.
    """
    conv = await replay.replay_conversation(PIVOT_TURNS, conv_id="state")

    assert conv.turns[0].uns_model, "turn 1 did not resolve a model"
    assert conv.turns[1].uns_model == conv.turns[0].uns_model, (
        "state was not carried into turn 2 — every turn started fresh"
    )
    assert conv.turns[1].fsm_before == conv.turns[0].fsm_after, (
        "turn 2 did not start where turn 1 ended"
    )


@pytest.mark.asyncio
async def test_the_pivot_fires_and_clears_the_dead_fault():
    """CTX-001d, executed against the historical turn sequence.

    'Actually forget that — my conveyor keeps stopping.' must start a fresh
    thread and drop the carried F004, which is the defect #3160 named.
    """
    conv = await replay.replay_conversation(PIVOT_TURNS, conv_id="pivot-fires")
    last = conv.turns[-1]

    assert "CTX_FRESH_THREAD_PIVOT" in last.engine_markers, "the pivot did not fire"
    assert last.uns_fault_code is None, "the dead fault survived the pivot"
    assert conv.turns[1].uns_fault_code is not None, (
        "control: the fault must be present BEFORE the pivot, or this proves nothing"
    )


@pytest.mark.asyncio
async def test_replay_detects_a_deliberate_change_to_deterministic_state_logic():
    """MUTATION TEST — the one that makes the rest trustworthy.

    Add Q1 to PIVOT_EXEMPT_STATES and the pivot must stop firing. If the replay
    still reported the same result, it would be reading stored output rather
    than executing the engine, and every assertion above would be theatre.
    """
    import shared.engine as engine

    baseline = await replay.replay_conversation(PIVOT_TURNS, conv_id="mutation-baseline")
    assert "CTX_FRESH_THREAD_PIVOT" in baseline.markers()

    mutated_exempt = frozenset(engine.PIVOT_EXEMPT_STATES | {"Q1"})
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(engine, "PIVOT_EXEMPT_STATES", mutated_exempt)
        mutated = await replay.replay_conversation(PIVOT_TURNS, conv_id="mutation-applied")

    assert "CTX_FRESH_THREAD_PIVOT" not in mutated.markers(), (
        "the replay did not notice a deterministic state-logic change — it is "
        "not executing the engine"
    )
    assert mutated.turns[-1].uns_fault_code is not None, (
        "with the pivot suppressed the dead fault must survive"
    )


@pytest.mark.asyncio
async def test_evidence_transcript_feeds_the_existing_detectors():
    """The unification point: replayed output must be consumable by the gates
    that already exist, with no adapter."""
    from tests.regime1_telethon.campaign import gates

    conv = await replay.replay_conversation(PIVOT_TURNS, conv_id="detectors")
    transcript = conv.transcript()

    assert [t["role"] for t in transcript[:2]] == ["tech", "mira"]
    gates.check_conversation(transcript, conv.conv_id)  # must not raise


def test_technician_turns_never_load_historical_assistant_text():
    """Feeding old replies back would silently turn replay into inspection."""
    campaign, conv_id = "c7", "t2_000_pivot_after_fault"
    if not (replay.LEDGER_DIR / f"{campaign}.jsonl").exists():
        pytest.skip("ledgers are gitignored and local-only")

    turns = replay.technician_turns(campaign, conv_id)
    assert turns, "no technician turns extracted"
    assert all(t["text"] for t in turns)
    assert not any("UnderVoltage" in t["text"] for t in turns), (
        "an assistant turn was loaded as a technician turn"
    )
    assert [t["i"] for t in turns] == sorted(t["i"] for t in turns), "turns out of order"


def test_a_missing_campaign_fails_loudly():
    with pytest.raises(FileNotFoundError):
        replay.technician_turns("no-such-campaign", "whatever")
