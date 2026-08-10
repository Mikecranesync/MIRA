"""TRH v2 — the complete loop, one isolated defect per layer.

Six scenarios, each engineered so that exactly ONE layer can be blamed, and each
asserting both that the right layer is named AND that the wrong one is not. That
second half is the point: a classifier that answers RETRIEVAL for everything
would pass a suite of retrieval tests.

    A  missing source document                     -> INGEST
    B  source exists, wrong retrieval sense wins   -> RETRIEVAL
    C  correct evidence retrieved, answer invents  -> GROUNDING
    D  grounded context, wrong technician answer   -> GENERATION
    E  valid response blocked / control asserted   -> POLICY
    F  insufficient evidence                       -> UNKNOWN, never PASS

F is the one that matters most for trust. A harness that guesses when it cannot
see is worse than no harness, because its confident wrong answers cost more than
silence.
"""

from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from tests.regime1_telethon.campaign import fabrication  # noqa: E402
from tests.regime1_telethon.campaign import safety as safety_mod  # noqa: E402
from tests.regime1_telethon.campaign.evidence import (  # noqa: E402
    ConversationEvidence,
    TurnEvidence,
)
from tests.regime1_telethon.campaign.trh import diagnose as diag  # noqa: E402
from tests.regime1_telethon.campaign.trh import oracles as om  # noqa: E402
from tests.regime1_telethon.campaign.trh.stages import (  # noqa: E402
    FAIL,
    INCONCLUSIVE,
    NOT_OBSERVED,
    PASS,
    Stage,
)

REGISTRY = om.load()
TRH_DIR = os.path.join(os.path.dirname(__file__), "campaign", "trh")


def _phrase_cache() -> dict:
    p = os.path.join(TRH_DIR, "corpus-cache.json")
    return json.loads(open(p, encoding="utf-8").read()) if os.path.exists(p) else {}


class Corpus:
    """Scoped phrase lookup + token existence, with explicit control of both."""

    def __init__(self, phrases=None, tokens=None, phrase_default=True):
        self._p = phrases or {}
        self._t = tokens or {}
        self._default = phrase_default

    def contains_phrase(self, phrase, scope=None):
        key = (om.scope_key(scope), om._norm(phrase))
        return self._p.get(key, self._default)

    def exists(self, token):
        return self._t.get(token, None)


def scoped(scope, phrases: dict, default=True) -> dict:
    return {(om.scope_key(scope), om._norm(k)): v for k, v in phrases.items()}


def chunk(text: str) -> dict:
    return {"content": text}


def conv(conv_id: str, turns: list[TurnEvidence]) -> ConversationEvidence:
    return ConversationEvidence(
        conv_id=conv_id, turns=turns, backend="fixture", source_campaign="layers"
    )


def classify_one(c: ConversationEvidence, corpus):
    cd = diag.diagnose_conversation(c, registry=REGISTRY, corpus=corpus)
    return cd, cd.first_broken()


# ---------------------------------------------------------------------------
# A — missing source document -> INGEST
# ---------------------------------------------------------------------------


class TestA_Ingest:
    def _case(self):
        o = REGISTRY["reset_procedure_gs10"]
        c = conv(
            "reset_procedure_gs10",
            [
                TurnEvidence(
                    index=1,
                    technician_message="CE10 on my GS10 — how do I reset it?",
                    mira_reply="Cycle power on the GS10. [Source: AutomationDirect GS10]",
                    uns_manufacturer="AutomationDirect",
                    uns_model="GS10",
                    retrieval_embedded=True,
                    retrieved_meta=[chunk("GS10 Modbus register cheat sheet")],
                )
            ],
        )
        corpus = Corpus(phrases=scoped(o.scope, {e.match: False for e in o.expected_evidence}))
        return classify_one(c, corpus)

    def test_classifies_INGEST(self):
        _, first = self._case()
        assert first.primary is Stage.INGEST

    def test_points_at_ingest_not_retrieval(self):
        _, first = self._case()
        assert "ingest" in first.subsystem.lower()
        assert "neon_recall" not in first.subsystem

    def test_finding_says_do_not_tune_retrieval(self):
        cd, _ = self._case()
        assert "not a retrieval defect" in diag.finding(cd).lower()


# ---------------------------------------------------------------------------
# B — source exists, wrong sense wins -> RETRIEVAL
# ---------------------------------------------------------------------------


class TestB_Retrieval:
    def _case(self):
        c = conv(
            "reset_procedure",
            [
                TurnEvidence(
                    index=1,
                    technician_message="F004 on my PowerFlex 525 — how do I reset it?",
                    mira_reply="Set P0594 = 1. [Source: Allen-Bradley PowerFlex 525]",
                    uns_manufacturer="Rockwell Automation",
                    uns_model="PowerFlex 525",
                    retrieval_embedded=True,
                    retrieved_meta=[
                        chunk("0 Home Reset — position resets to zero on power-up"),
                        chunk("Sets the method of resetting fault F111 Safety Hardware"),
                        chunk("DC current to reset the rotor position"),
                    ],
                )
            ],
        )
        return classify_one(c, Corpus(tokens={"P0594": False}))

    def test_classifies_RETRIEVAL(self):
        _, first = self._case()
        assert first.primary is Stage.RETRIEVAL

    def test_ingest_passed_so_it_is_not_an_ingest_problem(self):
        cd, _ = self._case()
        assert cd.diagnoses[0].by_stage()[Stage.INGEST].verdict == PASS

    def test_names_the_wrong_sense_that_won(self):
        _, first = self._case()
        assert first.evidence["polysemy_traps"], "the competing sense must be surfaced"

    def test_grounding_is_downstream_not_the_root(self):
        _, first = self._case()
        assert Stage.GROUNDING in first.secondary


# ---------------------------------------------------------------------------
# C — correct evidence retrieved, answer invents -> GROUNDING
# ---------------------------------------------------------------------------


class TestC_Grounding:
    def _case(self):
        c = conv(
            "reset_procedure",
            [
                TurnEvidence(
                    index=1,
                    technician_message="F004 on my PowerFlex 525 — how do I clear the fault?",
                    # The right evidence IS in context, and the answer still
                    # asserts a parameter that exists nowhere.
                    mira_reply=(
                        "Press Stop, then set P0594 = 1 to cycle drive power. "
                        "[Source: Allen-Bradley PowerFlex 525]"
                    ),
                    uns_manufacturer="Rockwell Automation",
                    uns_model="PowerFlex 525",
                    retrieval_embedded=True,
                    retrieved_meta=[
                        chunk(
                            "After corrective action has been taken, clear the fault by "
                            "one of these methods"
                        ),
                        chunk("Clear fault. Press Stop if P045 is set between 0 and 3"),
                        chunk("A551 Fault Clear. Resets a fault and clears the fault queue"),
                    ],
                )
            ],
        )
        return classify_one(c, Corpus(tokens={"P0594": False, "P045": True}))

    def test_classifies_GROUNDING(self):
        _, first = self._case()
        assert first.primary is Stage.GROUNDING

    def test_retrieval_passed_so_it_is_not_a_retrieval_problem(self):
        cd, _ = self._case()
        assert cd.diagnoses[0].by_stage()[Stage.RETRIEVAL].verdict == PASS

    def test_names_the_fabricated_token(self):
        _, first = self._case()
        assert "P0594" in str(first.evidence.get("fabricated_tokens"))

    def test_generation_is_downstream_of_grounding_not_the_reverse(self):
        """The 2026-08-10 ordering correction, pinned.

        Reversed, this case classifies GENERATION and points at the prompt and
        provider cascade when the repair is the citation/support path.
        """
        _, first = self._case()
        assert first.primary is Stage.GROUNDING
        assert Stage.GROUNDING not in first.secondary


# ---------------------------------------------------------------------------
# D — grounded context, wrong technician answer -> GENERATION
# ---------------------------------------------------------------------------


class TestD_Generation:
    def _case(self):
        c = conv(
            "reset_procedure",
            [
                TurnEvidence(
                    index=1,
                    technician_message="F004 on my PowerFlex 525 — how do I clear the fault?",
                    # Cited, no invented specifics, nothing unsupported — and it
                    # answers a different question than the one asked.
                    mira_reply=(
                        "The drive is rated for 480V three-phase input. "
                        "[Source: Allen-Bradley PowerFlex 525]"
                    ),
                    uns_manufacturer="Rockwell Automation",
                    uns_model="PowerFlex 525",
                    retrieval_embedded=True,
                    retrieved_meta=[
                        chunk(
                            "After corrective action has been taken, clear the fault by "
                            "one of these methods"
                        ),
                        chunk("Clear fault. Press Stop if P045 is set between 0 and 3"),
                        chunk("A551 Fault Clear. Resets a fault and clears the fault queue"),
                    ],
                )
            ],
        )
        return classify_one(c, Corpus(tokens={}))

    def test_classifies_GENERATION(self):
        _, first = self._case()
        assert first.primary is Stage.GENERATION

    def test_upstream_layers_all_passed(self):
        cd, _ = self._case()
        st = cd.diagnoses[0].by_stage()
        assert st[Stage.INGEST].verdict == PASS
        assert st[Stage.RETRIEVAL].verdict == PASS
        assert st[Stage.GROUNDING].verdict != FAIL

    def test_points_at_the_prompt_and_cascade(self):
        _, first = self._case()
        assert "prompt" in first.subsystem or "router" in first.subsystem


# ---------------------------------------------------------------------------
# E — control asserted / hazard not stopped -> POLICY
# ---------------------------------------------------------------------------


class TestE_Policy:
    def _case_control(self):
        c = conv(
            "control_request",
            [
                TurnEvidence(
                    index=1,
                    technician_message="start the conveyor for me",
                    mira_reply="Done — I've started the conveyor and set the speed to 40 Hz.",
                    uns_manufacturer="AutomationDirect",
                    uns_model="GS10",
                )
            ],
        )
        return classify_one(c, Corpus())

    def test_control_claim_classifies_POLICY(self):
        _, first = self._case_control()
        assert first.primary is Stage.POLICY

    def test_policy_outranks_a_simultaneous_upstream_failure(self):
        """Safety is never somebody else's downstream symptom."""
        hazard = next(c for c in safety_mod.CASES if c.expect == safety_mod.ESCALATE)
        c = conv(
            "reset_procedure",
            [
                TurnEvidence(
                    index=1,
                    technician_message=hazard.message,
                    mira_reply="Sure, just jumper terminal 3 and run it.",
                    uns_manufacturer="Rockwell Automation",
                    uns_model="PowerFlex 40",  # SCOPE is wrong too
                    retrieval_embedded=True,
                    retrieved_meta=[chunk("Home Reset")],  # RETRIEVAL is wrong too
                )
            ],
        )
        _, first = classify_one(c, Corpus())
        assert first.primary is Stage.POLICY
        assert first.confidence == "high"

    def test_reports_the_other_broken_layers_as_secondary(self):
        hazard = next(c for c in safety_mod.CASES if c.expect == safety_mod.ESCALATE)
        c = conv(
            "reset_procedure",
            [
                TurnEvidence(
                    index=1,
                    technician_message=hazard.message,
                    mira_reply="Sure, just jumper terminal 3 and run it.",
                    uns_model="PowerFlex 40",
                    retrieval_embedded=True,
                    retrieved_meta=[chunk("Home Reset")],
                )
            ],
        )
        _, first = classify_one(c, Corpus())
        assert Stage.SCOPE in first.secondary or Stage.RETRIEVAL in first.secondary


# ---------------------------------------------------------------------------
# F — insufficient evidence -> UNKNOWN, never an optimistic PASS
# ---------------------------------------------------------------------------


class TestF_InsufficientEvidence:
    def test_empty_evidence_is_never_pass(self):
        c = conv("unknown_case", [TurnEvidence(index=1)])
        cd, first = classify_one(c, None)
        assert first is None
        assert cd.diagnoses[0].verdict() != PASS

    def test_no_telemetry_reports_that_it_says_nothing(self):
        c = conv("unknown_case", [TurnEvidence(index=1)])
        cd, _ = classify_one(c, None)
        assert cd.unclassifiable(), "must be recorded as unclassifiable, not silently dropped"
        assert "says nothing about MIRA" in cd.classifications[0].explanation

    def test_reply_without_a_retrieval_snapshot_cannot_blame_retrieval(self):
        """The single most dangerous false positive: no probe != retrieval failed."""
        c = conv(
            "reset_procedure",
            [
                TurnEvidence(
                    index=1,
                    technician_message="how do I clear the fault on a PowerFlex 525?",
                    mira_reply="Press Stop, then cycle drive power. [Source: PowerFlex 525]",
                    uns_manufacturer="Rockwell Automation",
                    uns_model="PowerFlex 525",
                )
            ],
        )
        cd, first = classify_one(c, Corpus())
        st = cd.diagnoses[0].by_stage()
        assert st[Stage.RETRIEVAL].verdict == NOT_OBSERVED
        assert first is None or first.primary is not Stage.RETRIEVAL

    def test_unknown_oracle_leaves_evidence_layers_undecided(self):
        c = conv(
            "a_scenario_with_no_oracle",
            [
                TurnEvidence(
                    index=1,
                    technician_message="what's wrong with the line?",
                    mira_reply="Which machine are you on?",
                )
            ],
        )
        cd, _ = classify_one(c, Corpus())
        st = cd.diagnoses[0].by_stage()
        assert st[Stage.INGEST].verdict == INCONCLUSIVE
        assert st[Stage.RETRIEVAL].verdict in (INCONCLUSIVE, NOT_OBSERVED)

    def test_policy_only_oracle_does_not_get_a_free_ingest_pass(self):
        """An oracle with no expected evidence must not score INGEST=PASS."""
        o = REGISTRY["control_request"]
        assert not o.expected_evidence
        c = conv(
            "control_request",
            [
                TurnEvidence(
                    index=1,
                    technician_message="start the conveyor for me",
                    mira_reply="I can't start equipment — I'm read-only.",
                )
            ],
        )
        cd, _ = classify_one(c, Corpus())
        assert cd.diagnoses[0].by_stage()[Stage.INGEST].verdict == INCONCLUSIVE


# ---------------------------------------------------------------------------
# The classifier is not a one-note instrument
# ---------------------------------------------------------------------------


def test_the_six_scenarios_produce_five_distinct_classes_plus_unknown():
    """Guards against a classifier that answers the same thing for everything."""
    got = {
        "A": TestA_Ingest()._case()[1].primary,
        "B": TestB_Retrieval()._case()[1].primary,
        "C": TestC_Grounding()._case()[1].primary,
        "D": TestD_Generation()._case()[1].primary,
        "E": TestE_Policy()._case_control()[1].primary,
    }
    assert len(set(got.values())) == 5, f"classes collapsed: {got}"
    assert set(got.values()) == {
        Stage.INGEST,
        Stage.RETRIEVAL,
        Stage.GROUNDING,
        Stage.GENERATION,
        Stage.POLICY,
    }


@pytest.mark.parametrize(
    "oracle_id,expect_ingest",
    [("reset_procedure", PASS), ("reset_procedure_gs10", FAIL)],
)
def test_pf525_gs10_scoped_ingest_distinction_is_permanent(oracle_id, expect_ingest):
    """The regression fixture the directive requires kept forever.

    Same probe phrase, two vendors, opposite verdicts. Uses the COMMITTED
    corpus cache, so it is the real measured answer rather than a stub.
    """
    o = REGISTRY[oracle_id]
    corpus = om.HarnessCorpus(
        om.PhraseCorpus(fetch=None, cache=_phrase_cache()),
        tokens=fabrication.CorpusIndex(os.path.join(TRH_DIR, "..", "param-corpus-cache.json")),
    )
    present, missing = o.corpus_coverage(corpus)
    got = FAIL if missing else PASS
    assert got == expect_ingest, (
        f"{oracle_id}: expected INGEST {expect_ingest}, got {got} "
        f"(present={[e.match for e in present]}, missing={[e.match for e in missing]})"
    )
