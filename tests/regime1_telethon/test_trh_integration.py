"""TRH v2 — runner integration: the ledger join and the live-run regressions.

Both classes here exist because the FIRST live run of the integration got them
wrong, on a real 30-conversation campaign, in opposite directions:

  * the probe join silently landed nothing, so RETRIEVAL read NOT_OBSERVED for a
    campaign that had been probed — an under-report that looks exactly like a
    legitimately un-probed run;
  * a v1 conversation gate with a known false-positive mode produced 6 confident
    DIALOGUE failures out of 30 — an over-report on correct MIRA behaviour.

Ledger-backed tests skip when the ledgers are absent (they are gitignored and
local-only), so CI still runs the synthetic half.
"""

from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from tests.regime1_telethon.campaign import gates  # noqa: E402
from tests.regime1_telethon.campaign.evidence import TurnEvidence  # noqa: E402
from tests.regime1_telethon.campaign.trh import assemble as A  # noqa: E402
from tests.regime1_telethon.campaign.trh import diagnose as diag  # noqa: E402
from tests.regime1_telethon.campaign.trh import oracles as om  # noqa: E402
from tests.regime1_telethon.campaign.trh import stages  # noqa: E402
from tests.regime1_telethon.campaign.trh.stages import NOT_OBSERVED, PASS, Stage  # noqa: E402

LIVE_CAMPAIGN = "c12s42"


def _has_ledger(campaign: str) -> bool:
    return (A.LEDGER_DIR / f"{campaign}.jsonl").exists()


live_only = pytest.mark.skipif(
    not _has_ledger(LIVE_CAMPAIGN), reason="campaign ledgers are gitignored / local-only"
)


# ---------------------------------------------------------------------------
# The ledger -> probe join
# ---------------------------------------------------------------------------


class TestLedgerJoin:
    """`TurnEvidence.index` must be the LEDGER's `i`, not a local counter."""

    def test_index_comes_from_the_ledger_record(self, tmp_path, monkeypatch):
        monkeypatch.setattr(A, "LEDGER_DIR", tmp_path)
        (tmp_path / "x.jsonl").write_text(
            "\n".join(
                json.dumps(r)
                for r in [
                    {"kind": "turn", "conv": "c", "i": 1, "role": "tech", "text": "q1"},
                    {"kind": "turn", "conv": "c", "i": 1, "role": "mira", "text": "a1"},
                    {"kind": "turn", "conv": "c", "i": 2, "role": "tech", "text": "q2"},
                    {"kind": "turn", "conv": "c", "i": 2, "role": "mira", "text": "a2"},
                ]
            ),
            encoding="utf-8",
        )
        conv, _ = A.from_ledger("x", "c")
        assert [t.index for t in conv.turns] == [1, 2], (
            "a local 0-based counter here silently breaks the retrieval-probe join"
        )

    def test_probe_records_merge_onto_the_matching_index(self, tmp_path, monkeypatch):
        monkeypatch.setattr(A, "LEDGER_DIR", tmp_path)
        monkeypatch.setattr(A, "RETRIEVAL_DIR", tmp_path)
        (tmp_path / "x.jsonl").write_text(
            json.dumps({"kind": "turn", "conv": "c", "i": 1, "role": "tech", "text": "q"})
            + "\n"
            + json.dumps({"kind": "turn", "conv": "c", "i": 1, "role": "mira", "text": "a"}),
            encoding="utf-8",
        )
        # retrieval file is named <campaign>.jsonl in RETRIEVAL_DIR
        (tmp_path / "x.jsonl.retrieval").write_text("", encoding="utf-8")
        conv, rep = A.from_ledger("x", "c")
        recs = {1: {"conv": "c", "i": 1, "retrieved": [{"content": "hit"}], "embedded": True}}
        monkeypatch.setattr(A, "_retrieval_records", lambda c, cid: recs)
        A.merge_retrieval(conv, rep)
        assert conv.turns[0].retrieved_meta == [{"content": "hit"}]
        assert rep.with_retrieval == 1

    def test_a_turn_with_no_probe_record_stays_unobserved(self, tmp_path, monkeypatch):
        """Never invent: no record must not become 'nothing was retrieved'."""
        monkeypatch.setattr(A, "LEDGER_DIR", tmp_path)
        (tmp_path / "x.jsonl").write_text(
            json.dumps({"kind": "turn", "conv": "c", "i": 1, "role": "tech", "text": "q"})
            + "\n"
            + json.dumps({"kind": "turn", "conv": "c", "i": 1, "role": "mira", "text": "a"}),
            encoding="utf-8",
        )
        conv, rep = A.from_ledger("x", "c")
        monkeypatch.setattr(A, "_retrieval_records", lambda c, cid: {})
        A.merge_retrieval(conv, rep)
        assert conv.turns[0].retrieved_meta == []
        assert not conv.turns[0].observed("retrieved_meta")
        assert any("NOT_OBSERVED" in n for n in rep.notes)

    @live_only
    def test_the_join_actually_lands_on_the_real_campaign(self):
        """The regression itself, against the real ledger + probe artifacts."""
        conv, rep = A.assemble(LIVE_CAMPAIGN, "t1_004_reset_procedure", use_replay=False)
        assert rep.turns >= 1
        assert rep.with_retrieval >= 1, (
            "probe records exist for this conversation; a coverage of 0 means the "
            "index join broke again"
        )
        assert conv.turns[0].retrieved_meta


# ---------------------------------------------------------------------------
# The asset-switch false positive
# ---------------------------------------------------------------------------


class TestAssetSwitchFalsePositive:
    """MIRA re-confirming identity after a technician switches machine is CORRECT."""

    def _switch_turns(self):
        return [
            TurnEvidence(index=1, technician_message="What does CE10 mean on a DURApulse GS10?"),
            TurnEvidence(index=2, technician_message="What does F004 mean on a PowerFlex 525?"),
        ]

    def test_detects_a_technician_asset_switch(self):
        prior = self._switch_turns()
        turn = TurnEvidence(index=3, technician_message="go back to the gs10", mira_reply="ok")
        assert stages.technician_switched_asset(prior, turn) is True

    def test_does_not_fire_when_the_technician_stays_on_one_machine(self):
        prior = [TurnEvidence(index=1, technician_message="F004 on my PowerFlex 525")]
        turn = TurnEvidence(index=2, technician_message="how do I reset the PowerFlex 525?")
        assert stages.technician_switched_asset(prior, turn) is False

    def test_switch_turn_does_not_score_a_dialogue_failure(self):
        prior = self._switch_turns()
        turn = TurnEvidence(
            index=3,
            technician_message="go back to the gs10",
            mira_reply="Before I diagnose, confirm the equipment: **AutomationDirect, GS10**",
        )
        ctx = stages.GradeContext(
            prior_turns=prior,
            conversation_violations=[
                gates.Violation("reasks_supplied_info", "c", "asked for equipment identity")
            ],
        )
        g = stages.grade_dialogue(turn, ctx)
        assert g.verdict == PASS
        assert g.evidence["suppressed_known_fp"] == ["reasks_supplied_info"]

    def test_a_REAL_reask_on_a_non_switch_turn_still_fails(self):
        """The negative control. Suppression must not swallow the real defect."""
        prior = [TurnEvidence(index=1, technician_message="F004 on my PowerFlex 525")]
        turn = TurnEvidence(
            index=2,
            technician_message="so how do I clear it?",
            mira_reply="What is the manufacturer and model?",
        )
        ctx = stages.GradeContext(
            prior_turns=prior,
            conversation_violations=[
                gates.Violation("reasks_supplied_info", "c", "asked for equipment identity")
            ],
        )
        assert stages.grade_dialogue(turn, ctx).verdict == stages.FAIL

    def test_a_repeated_answer_on_a_switch_turn_still_fails(self):
        """Suppression is scoped to ONE gate, not to the whole layer."""
        prior = self._switch_turns()
        turn = TurnEvidence(index=3, technician_message="go back to the gs10", mira_reply="x")
        ctx = stages.GradeContext(
            prior_turns=prior,
            conversation_violations=[
                gates.Violation("reasks_supplied_info", "c", "…"),
                gates.Violation("repeated_answer", "c", "turn 3 repeats turn 1"),
            ],
        )
        g = stages.grade_dialogue(turn, ctx)
        assert g.verdict == stages.FAIL
        assert "repeated_answer" in g.detail

    @live_only
    def test_the_real_campaign_has_no_fake_dialogue_failures(self):
        """c12s42 produced 6 of these on the first integration run."""
        cds = diag.diagnose_campaign(
            LIVE_CAMPAIGN, use_replay=False, persist_records=False, corpus=None
        )
        dialogue = [
            (cd.conv_id, c.turn_index)
            for cd in cds
            for c in cd.classifications
            if c.primary is Stage.DIALOGUE
        ]
        offenders = [cid for cid, _ in dialogue if "asset_switch" in cid]
        assert not offenders, f"asset-switch false positives are back: {offenders}"


# ---------------------------------------------------------------------------
# End-to-end over a real campaign
# ---------------------------------------------------------------------------


@live_only
class TestLiveCampaignDiagnosis:
    def test_every_turn_is_graded_at_every_layer(self):
        cds = diag.diagnose_campaign(
            LIVE_CAMPAIGN, use_replay=False, persist_records=False, corpus=None
        )
        assert cds
        for cd in cds:
            for d in cd.diagnoses:
                assert len(d.grades) == 8, f"{cd.conv_id} turn {d.turn_index} under-graded"

    def test_no_turn_is_silently_dropped(self):
        cds = diag.diagnose_campaign(
            LIVE_CAMPAIGN, use_replay=False, persist_records=False, corpus=None
        )
        for cd in cds:
            assert len(cd.classifications) == len(cd.diagnoses)

    def test_unprobed_turns_report_retrieval_as_unobserved_not_failed(self):
        """The under-report guard: absent telemetry must not become a defect."""
        cds = diag.diagnose_campaign(
            LIVE_CAMPAIGN, use_replay=False, persist_records=False, corpus=None
        )
        for cd in cds:
            if cd.assembly and cd.assembly.with_retrieval == 0:
                for d in cd.diagnoses:
                    assert d.by_stage()[Stage.RETRIEVAL].verdict == NOT_OBSERVED

    def test_findings_name_a_subsystem(self):
        cds = diag.diagnose_campaign(
            LIVE_CAMPAIGN, use_replay=False, persist_records=False, corpus=None
        )
        for cd in cds:
            if cd.first_broken() is not None:
                assert "mira-" in diag.finding(cd)


class TestPersistenceShape:
    def test_diagnosis_records_carry_every_required_field(self, tmp_path, monkeypatch):
        """The directive's persistence contract, asserted field by field."""
        from tests.regime1_telethon.campaign import ledger as ledger_mod

        monkeypatch.setattr(ledger_mod, "LEDGER_DIR", tmp_path)
        from tests.regime1_telethon.campaign.evidence import ConversationEvidence

        c = ConversationEvidence(
            conv_id="reset_procedure",
            turns=[TurnEvidence(index=1, technician_message="q", mira_reply="a")],
            source_campaign="t",
        )
        cd = diag.diagnose_conversation(c, registry=om.load(), corpus=None)
        diag.persist("t", cd)
        rows = [
            json.loads(line)
            for line in (tmp_path / "t.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        assert rows
        r = rows[0]
        for key in (
            "kind",
            "conv",
            "i",
            "turn_verdict",
            "first_broken_stage",
            "downstream",
            "subsystem",
            "oracle",
            "confidence",
            "unobserved",
            "unclassifiable_reason",
            "stages",
            "evidence",
        ):
            assert key in r, f"diagnosis record is missing {key!r}"
        assert r["kind"] == "diagnosis"
        assert len(r["stages"]) == 8


class TestViolationLocalization:
    """A conversation-scoped violation is ONE defect, not one per turn.

    Measured on the real ledgers before this existed: a single violation in a
    9-turn conversation produced 8 DIALOGUE failures, and the campaign-wide
    count read 158 instead of 21. A report that inflates a layer 8x sends the
    next session to rewrite the wrong subsystem.
    """

    def _turns(self, n):
        return [
            TurnEvidence(index=i, technician_message=f"q{i}", mira_reply=f"a{i}")
            for i in range(1, n + 1)
        ]

    def test_one_violation_lands_on_exactly_one_turn(self):
        v = [gates.Violation("reasks_supplied_info", "c", "asked for identity again")]
        got = diag.localize_violations(v, self._turns(9))
        assert sum(len(x) for x in got.values()) == 1
        assert list(got) == [2], "unlocalizable violations go to the first eligible turn"

    def test_a_violation_that_names_its_turn_is_charged_there(self):
        v = [gates.Violation("repeated_answer", "c", "turn 5 repeats turn 1")]
        got = diag.localize_violations(v, self._turns(9))
        assert list(got) == [5]

    def test_a_named_turn_outside_the_conversation_falls_back(self):
        v = [gates.Violation("repeated_answer", "c", "turn 99 repeats turn 1")]
        got = diag.localize_violations(v, self._turns(3))
        assert list(got) == [2]

    def test_single_turn_conversation_carries_nothing(self):
        v = [gates.Violation("reasks_supplied_info", "c", "x")]
        assert diag.localize_violations(v, self._turns(1)) == {}

    @live_only
    def test_no_conversation_reports_more_dialogue_failures_than_violations(self):
        cds = diag.diagnose_campaign("c1", use_replay=False, persist_records=False, corpus=None)
        for cd in cds:
            fails = [
                d.turn_index
                for d in cd.diagnoses
                if d.by_stage()[Stage.DIALOGUE].verdict == stages.FAIL
            ]
            assert len(fails) <= 2, (
                f"{cd.conv_id}: {len(fails)} DIALOGUE failures — a conversation-scoped "
                "violation is being charged to every turn again"
            )


class TestReplayProducerIsActuallyCalled:
    """The replay producer must really run — stubs hid that it never did.

    Live campaign c13 logged `RuntimeWarning: coroutine 'replay_conversation'
    was never awaited` and reported `replay markers on 0/N` for every
    conversation, while all 462 tests passed. Every existing test either stubs
    `merge_replay` or skips it, so nothing exercised the real call.

    Root cause was NOT a missing await: `replay_ledger_conversation` correctly
    wraps `asyncio.run(...)`, but the runner invoked TRH from inside `amain()`,
    where a loop is already running. `asyncio.run` then raises and the coroutine
    built as its argument is orphaned — which is what the warning reports.

    These tests call the REAL producer, one of them from inside a running loop,
    because that is the condition that broke.
    """

    @live_only
    def test_real_replay_contributes_markers(self):
        conv, rep = A.assemble(LIVE_CAMPAIGN, "t2_000_pivot_after_fault", use_replay=True)
        assert not rep.replay_error, f"replay producer failed: {rep.replay_error}"
        assert rep.with_replay > 0, (
            "replay ran but contributed nothing to any turn — the producer is silently inert again"
        )

    @live_only
    def test_replay_works_from_inside_a_running_event_loop(self):
        """The exact live condition: diagnosis invoked from async code."""
        import asyncio

        async def _inner():
            return A.assemble(LIVE_CAMPAIGN, "t2_000_pivot_after_fault", use_replay=True)

        conv, rep = asyncio.run(_inner())
        assert "RuntimeError" not in (rep.replay_error or ""), (
            f"asyncio.run() called from a running loop again: {rep.replay_error}"
        )
        assert rep.with_replay > 0, "replay inert when called from within a loop"

    def test_runner_does_not_invoke_diagnosis_from_inside_the_async_body(self):
        """Structural guard: `_run_trh` must be called from `main`, not `amain`.

        Cheap and stub-free — reads the runner source. If diagnosis moves back
        inside the coroutine, `asyncio.run` breaks again in a way unit tests
        with stubbed producers cannot see.
        """
        import inspect

        from tests.regime1_telethon.campaign import runner as runner_mod

        amain_src = inspect.getsource(runner_mod.amain)
        assert "_run_trh" not in amain_src, (
            "_run_trh is called from inside amain(); a loop is already running "
            "there, so replay_ledger_conversation's asyncio.run() will raise"
        )
        assert "_run_trh" in inspect.getsource(runner_mod.main)
