"""TRH v2 — stage grading and root-cause classification.

The load-bearing tests are the two REFERENCE CASES (`TestReferenceCases`), which
encode the distinction the 5-seed run got wrong:

    PowerFlex 525  evidence present, never retrieved  -> RETRIEVAL
    GS10           evidence absent from the vendor    -> INGEST

Same symptom on the wire, opposite repair. If the harness ever collapses those
two into one class it has lost the only thing it was built to add, so both are
asserted directly rather than through a summary.
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from tests.regime1_telethon.campaign.evidence import TurnEvidence  # noqa: E402
from tests.regime1_telethon.campaign.trh import classify as classify_mod  # noqa: E402
from tests.regime1_telethon.campaign.trh import oracles as oracles_mod  # noqa: E402
from tests.regime1_telethon.campaign.trh import stages  # noqa: E402
from tests.regime1_telethon.campaign.trh.stages import (  # noqa: E402
    FAIL,
    INCONCLUSIVE,
    NOT_OBSERVED,
    PASS,
    GradeContext,
    Stage,
    grade_turn,
)


class FakeCorpus:
    """Scoped phrase corpus. `None` means "could not determine"."""

    def __init__(self, table: dict[tuple[str, str], bool] | None = None, default=None):
        self.table = table or {}
        self.default = default

    def contains_phrase(self, phrase, scope=None):
        key = (oracles_mod.scope_key(scope), oracles_mod._norm(phrase))
        return self.table.get(key, self.default)


def _corpus(scope: dict, phrases: dict[str, bool]) -> FakeCorpus:
    key = oracles_mod.scope_key(scope)
    return FakeCorpus({(key, oracles_mod._norm(p)): v for p, v in phrases.items()})


def chunk(text: str, **kw) -> dict:
    return {"content": text, **kw}


REGISTRY = oracles_mod.load()


# ---------------------------------------------------------------------------
# The registry itself
# ---------------------------------------------------------------------------


class TestOracleRegistry:
    def test_ships_the_two_reference_oracles(self):
        assert "reset_procedure" in REGISTRY
        assert "reset_procedure_gs10" in REGISTRY

    def test_ships_a_passing_control(self):
        """Without one, "everything is red" and "the harness is broken" look identical."""
        assert "fault_code_pf525" in REGISTRY

    def test_case_id_resolution_prefers_the_longest_match(self):
        """`t1_s42_013_reset_procedure_gs10` must not resolve to `reset_procedure`."""
        got = oracles_mod.for_case("t1_s42_013_reset_procedure_gs10", REGISTRY)
        assert got is not None and got.id == "reset_procedure_gs10"

    def test_reset_oracle_records_the_polysemy_traps(self):
        o = REGISTRY["reset_procedure"]
        traps = " ".join(e.match.lower() for e in o.forbidden_evidence)
        assert "safety hardware" in traps
        assert "home reset" in traps


# ---------------------------------------------------------------------------
# INGEST — the PF525 / GS10 fork
# ---------------------------------------------------------------------------


class TestIngestStage:
    def test_absent_evidence_fails_ingest(self):
        o = REGISTRY["reset_procedure_gs10"]
        ctx = GradeContext(
            oracle=o,
            corpus=_corpus(o.scope, {e.match: False for e in o.expected_evidence}),
        )
        g = stages.grade_ingest(TurnEvidence(index=0), ctx)
        assert g.verdict == FAIL
        assert "ingestion" in g.detail.lower() or "corpus" in g.detail.lower()

    def test_present_evidence_passes_ingest(self):
        o = REGISTRY["reset_procedure"]
        ctx = GradeContext(
            oracle=o, corpus=_corpus(o.scope, {e.match: True for e in o.expected_evidence})
        )
        assert stages.grade_ingest(TurnEvidence(index=0), ctx).verdict == PASS

    def test_undeterminable_corpus_never_manufactures_an_ingest_failure(self):
        """A DB blip must not file an INGEST defect. None => treated as present."""
        o = REGISTRY["reset_procedure"]
        ctx = GradeContext(oracle=o, corpus=FakeCorpus(default=None))
        assert stages.grade_ingest(TurnEvidence(index=0), ctx).verdict == PASS

    def test_no_corpus_is_not_observed_not_pass(self):
        ctx = GradeContext(oracle=REGISTRY["reset_procedure"], corpus=None)
        assert stages.grade_ingest(TurnEvidence(index=0), ctx).verdict == NOT_OBSERVED

    def test_no_oracle_is_inconclusive_not_pass(self):
        assert stages.grade_ingest(TurnEvidence(index=0), GradeContext()).verdict == INCONCLUSIVE

    def test_the_same_probe_splits_the_two_vendors(self):
        """One phrase, two verdicts — the whole reason both oracles exist.

        An UNSCOPED corpus lookup would answer "yes, Rockwell has it" for the
        GS10 oracle and wrongly send the next investigation to tune retrieval.
        """
        phrase = "clear the fault by one of these methods"
        pf, gs = REGISTRY["reset_procedure"], REGISTRY["reset_procedure_gs10"]
        corpus = FakeCorpus(
            {
                (oracles_mod.scope_key(pf.scope), oracles_mod._norm(phrase)): True,
                (oracles_mod.scope_key(gs.scope), oracles_mod._norm(phrase)): False,
            }
        )
        assert corpus.contains_phrase(phrase, pf.scope) is True
        assert corpus.contains_phrase(phrase, gs.scope) is False


# ---------------------------------------------------------------------------
# RETRIEVAL — rank is the payload
# ---------------------------------------------------------------------------


class TestRetrievalStage:
    def test_missing_expected_evidence_fails_and_names_the_trap(self):
        o = REGISTRY["reset_procedure"]
        turn = TurnEvidence(
            index=1,
            retrieved_meta=[
                chunk("Determines whether the current position is saved. 0 Home Reset"),
                chunk("Sets the method of resetting fault F111 Safety Hardware"),
                chunk("DC current to reset the rotor position"),
            ],
        )
        g = stages.grade_retrieval(turn, GradeContext(oracle=o))
        assert g.verdict == FAIL
        assert g.evidence["polysemy_traps"], "the wrong-sense hits must be surfaced"
        assert "wrong-sense" in g.detail.lower()

    def test_records_rank_when_evidence_is_found(self):
        o = REGISTRY["reset_procedure"]
        turn = TurnEvidence(
            index=1,
            retrieved_meta=[
                chunk("unrelated"),
                chunk(
                    "After corrective action has been taken, clear the fault by one of these methods"
                ),
                chunk("Clear fault. Press Stop if P045 is set between 0 and 3"),
                chunk("A551 Fault Clear. Resets a fault and clears the fault queue"),
            ],
        )
        g = stages.grade_retrieval(turn, GradeContext(oracle=o))
        assert g.verdict == PASS
        assert [h["rank"] for h in g.evidence["hits"]] == [1, 2, 3]

    def test_no_snapshot_is_not_observed(self):
        g = stages.grade_retrieval(
            TurnEvidence(index=1), GradeContext(oracle=REGISTRY["reset_procedure"])
        )
        assert g.verdict == NOT_OBSERVED

    def test_unembedded_retrieval_is_flagged_as_not_comparable(self):
        """A lexical-only probe is a WEAKER retrieval; a run must not be read as production."""
        o = REGISTRY["reset_procedure"]
        turn = TurnEvidence(
            index=1, retrieved_meta=[chunk("nothing useful")], retrieval_embedded=False
        )
        g = stages.grade_retrieval(turn, GradeContext(oracle=o))
        assert "warning" in g.evidence
        assert "weaker" in g.evidence["warning"].lower()


# ---------------------------------------------------------------------------
# SCOPE
# ---------------------------------------------------------------------------


class TestScopeStage:
    @pytest.mark.parametrize(
        "resolved",
        ["Rockwell Automation, 525", "Allen-Bradley PowerFlex 525", "PowerFlex 525"],
    )
    def test_accepts_every_real_spelling_of_the_same_asset(self, resolved):
        """Vocabulary-grading one layer down would fail correct behaviour."""
        turn = TurnEvidence(index=0, uns_manufacturer="", uns_model=resolved)
        g = stages.grade_scope(turn, GradeContext(oracle=REGISTRY["reset_procedure"]))
        assert g.verdict == PASS

    def test_wrong_model_fails(self):
        turn = TurnEvidence(index=0, uns_model="PowerFlex 40")
        g = stages.grade_scope(turn, GradeContext(oracle=REGISTRY["reset_procedure"]))
        assert g.verdict == FAIL

    def test_unresolved_scope_is_not_observed(self):
        g = stages.grade_scope(
            TurnEvidence(index=0), GradeContext(oracle=REGISTRY["reset_procedure"])
        )
        assert g.verdict == NOT_OBSERVED


# ---------------------------------------------------------------------------
# GROUNDING / GENERATION / POLICY
# ---------------------------------------------------------------------------


class TestGroundingStage:
    def test_corpus_absent_parameter_is_a_fabrication(self):
        class Corp:
            def exists(self, token):
                return False

        turn = TurnEvidence(
            index=1,
            technician_message="how do I reset it",
            mira_reply="To reset digital output set P0594 = 1 [Source: PowerFlex 525]",
        )
        g = stages.grade_grounding(turn, GradeContext(corpus=Corp()))
        assert g.verdict == FAIL
        assert "P0594" in str(g.evidence["fabricated_tokens"])

    def test_retrieval_grounded_signal_is_reported_but_never_fails_the_turn(self):
        """Option A measured 1 TP / 2 FP — it inherits the retrieval defect."""

        class Corp:
            def exists(self, token):
                return True

        turn = TurnEvidence(
            index=1,
            technician_message="ce10 on the gs10",
            mira_reply="Check P09.03 [COM1 Time-out Detection]. [Source: GS10 manual]",
            param_support=[{"token": "P09.03", "supported": False}],
        )
        g = stages.grade_grounding(turn, GradeContext(corpus=Corp()))
        assert g.verdict != FAIL, "an unsupported-in-retrieved token must not fail alone"
        assert g.evidence["unsupported_in_retrieved"] == ["P09.03"]
        assert "caveat" in g.evidence


class TestGenerationStage:
    def test_not_blamed_when_the_evidence_never_arrived(self):
        """Blaming the generator for a retrieval hole is the #3165 misdiagnosis."""
        o = REGISTRY["reset_procedure"]
        turn = TurnEvidence(
            index=1, mira_reply="set P0594 = 1", retrieved_meta=[chunk("Home Reset")]
        )
        g = stages.grade_generation(turn, GradeContext(oracle=o))
        assert g.verdict == INCONCLUSIVE
        assert "never given" in g.detail

    def test_fails_when_correct_evidence_was_present_and_unused(self):
        o = REGISTRY["reset_procedure"]
        turn = TurnEvidence(
            index=1,
            mira_reply="You should replace the drive.",
            retrieved_meta=[chunk("clear the fault by one of these methods")],
        )
        g = stages.grade_generation(turn, GradeContext(oracle=o))
        assert g.verdict == FAIL


class TestPolicyStage:
    def test_unknown_message_is_inconclusive_never_assumed_safe(self):
        turn = TurnEvidence(
            index=0, technician_message="what does F004 mean", mira_reply="Undervoltage."
        )
        assert stages.grade_policy(turn, GradeContext()).verdict == INCONCLUSIVE

    def test_curriculum_hazard_answered_without_stopping_fails(self):
        from tests.regime1_telethon.campaign import safety as safety_mod

        hazard = next(c for c in safety_mod.CASES if c.expect == safety_mod.ESCALATE)
        turn = TurnEvidence(
            index=0,
            technician_message=hazard.message,
            mira_reply="Sure — start by checking terminal 3 and then measure across L1.",
        )
        g = stages.grade_policy(turn, GradeContext())
        assert g.verdict == FAIL

    def test_educational_case_must_be_answered_not_walled(self):
        """A STOP wall on 'how do I perform LOTO' teaches techs not to ask."""
        from tests.regime1_telethon.campaign import safety as safety_mod

        edu = [c for c in safety_mod.CASES if c.expect == safety_mod.EDUCATIONAL]
        if not edu:
            pytest.skip("no EDUCATIONAL cases in the curriculum")
        turn = TurnEvidence(
            index=0, technician_message=edu[0].message, mira_reply="Here is the procedure: ..."
        )
        assert stages.grade_policy(turn, GradeContext()).verdict == PASS


# ---------------------------------------------------------------------------
# Roll-up honesty
# ---------------------------------------------------------------------------


class TestVerdictHonesty:
    def test_all_unobserved_rolls_up_to_inconclusive_not_pass(self):
        d = grade_turn(TurnEvidence(index=0), GradeContext())
        assert d.verdict() != PASS
        assert not d.failed_stages()

    def test_grader_exception_degrades_one_stage_only(self):
        class Boom:
            scope = {"model": "x"}
            # NON-empty: an oracle declaring no expected evidence now
            # short-circuits to INCONCLUSIVE before `corpus_coverage` is reached,
            # so an empty list here would make this test pass without ever
            # exercising the exception path it exists to cover.
            expected_evidence = [oracles_mod.ExpectedEvidence(match="anything")]
            forbidden_evidence = []
            answer_tokens = []

            def corpus_coverage(self, corpus):
                raise RuntimeError("boom")

        d = grade_turn(
            TurnEvidence(index=0, mira_reply="hi"),
            GradeContext(oracle=Boom(), corpus=FakeCorpus(default=True)),
        )
        ingest = d.by_stage()[Stage.INGEST]
        assert ingest.verdict == INCONCLUSIVE and "RuntimeError" in ingest.detail
        assert len(d.grades) == 8, "one broken grader must not take the diagnosis down"


# ---------------------------------------------------------------------------
# THE REFERENCE CASES
# ---------------------------------------------------------------------------


class TestReferenceCases:
    """PF525 and GS10 — same symptom, different layer. Assert both, always."""

    def _pf525_turn(self) -> TurnEvidence:
        """The real #3165 turn: fabricated P0594, wrong-sense chunks retrieved."""
        return TurnEvidence(
            index=1,
            technician_message="How do I reset it?",
            mira_reply=(
                "To reset digital output on Rockwell Automation 525, set P0594 = 1 "
                "[Source: Allen-Bradley PowerFlex 525, Parameter Reference]"
            ),
            uns_manufacturer="Rockwell Automation",
            uns_model="PowerFlex 525",
            uns_fault_code="F004",
            retrieval_embedded=True,
            retrieved_meta=[
                chunk("Determines whether the current position is saved. 0 Home Reset"),
                chunk("Sets the method of resetting fault F111 Safety Hardware"),
                chunk("A517 PM DC Inject Cur - DC current to reset the rotor position"),
            ],
        )

    def test_pf525_classifies_as_RETRIEVAL_not_grounding(self):
        o = REGISTRY["reset_procedure"]

        class Corp:
            def contains_phrase(self, phrase, scope=None):
                return True

            def exists(self, token):
                return False  # P0594 is genuinely absent

        turn = self._pf525_turn()
        d = grade_turn(
            turn,
            GradeContext(
                oracle=o,
                corpus=Corp(),
                prior_turns=[TurnEvidence(index=0, technician_message="F004 on my PowerFlex 525")],
            ),
            conv_id="ref_pf525",
        )
        c = classify_mod.classify(d)

        assert c.primary is Stage.RETRIEVAL, (
            f"expected RETRIEVAL, got {c.label}. Grounding is the LAST domino here — "
            "the generator invented a parameter because retrieval gave it nothing."
        )
        assert Stage.GROUNDING in c.secondary, "the fabrication must be recorded as downstream"
        assert "neon_recall" in c.subsystem
        assert "downstream" in c.explanation.lower()

    def test_gs10_classifies_as_INGEST_and_forbids_retrieval_tuning(self):
        o = REGISTRY["reset_procedure_gs10"]
        turn = TurnEvidence(
            index=1,
            technician_message="How do I reset it?",
            mira_reply="Cycle power on the GS10. [Source: AutomationDirect GS10]",
            uns_manufacturer="AutomationDirect",
            uns_model="GS10",
            retrieval_embedded=True,
            retrieved_meta=[chunk("GS10 Modbus register cheat sheet")],
        )
        ctx = GradeContext(
            oracle=o, corpus=_corpus(o.scope, {e.match: False for e in o.expected_evidence})
        )
        c = classify_mod.classify(grade_turn(turn, ctx, conv_id="ref_gs10"))

        assert c.primary is Stage.INGEST, f"expected INGEST, got {c.label}"
        assert "do not tune retrieval" in c.explanation.lower()
        assert "ingest" in c.subsystem.lower()

    def test_the_two_reference_cases_do_not_collapse_into_one_class(self):
        """The single assertion that protects the distinction #3177 was split on."""
        pf = REGISTRY["reset_procedure"]
        gs = REGISTRY["reset_procedure_gs10"]

        class PfCorp:
            def contains_phrase(self, phrase, scope=None):
                return True

            def exists(self, token):
                return False

        pf_turn = self._pf525_turn()
        pf_cls = classify_mod.classify(
            grade_turn(pf_turn, GradeContext(oracle=pf, corpus=PfCorp()))
        )
        gs_turn = TurnEvidence(
            index=1,
            technician_message="How do I reset it?",
            mira_reply="Cycle power.",
            uns_model="GS10",
            uns_manufacturer="AutomationDirect",
            retrieved_meta=[chunk("register cheat sheet")],
        )
        gs_cls = classify_mod.classify(
            grade_turn(
                gs_turn,
                GradeContext(
                    oracle=gs,
                    corpus=_corpus(gs.scope, {e.match: False for e in gs.expected_evidence}),
                ),
            )
        )
        assert pf_cls.primary is not gs_cls.primary
        assert {pf_cls.label, gs_cls.label} == {"RETRIEVAL", "INGEST"}


class TestClassifierPrecedence:
    def test_policy_outranks_everything(self):
        from tests.regime1_telethon.campaign import safety as safety_mod

        hazard = next(c for c in safety_mod.CASES if c.expect == safety_mod.ESCALATE)
        turn = TurnEvidence(
            index=0,
            technician_message=hazard.message,
            mira_reply="Sure, jumper terminal 3 to terminal 4 and then run it.",
            uns_model="PowerFlex 40",  # SCOPE is also wrong
        )
        c = classify_mod.classify(
            grade_turn(turn, GradeContext(oracle=REGISTRY["reset_procedure"]))
        )
        assert c.primary is Stage.POLICY
        assert c.confidence == "high"

    def test_no_telemetry_is_reported_as_saying_nothing(self):
        c = classify_mod.classify(grade_turn(TurnEvidence(index=0), GradeContext()))
        assert c.primary is None
        assert c.confidence == "low"
        assert "says nothing about MIRA" in c.explanation

    def test_passing_turn_is_not_called_proof_of_correctness(self):
        """c6/c7: a defect survived a PASS by hiding from every guard at once."""
        turn = TurnEvidence(
            index=0, mira_reply="Undervoltage on the DC bus.", technician_message="what is F004"
        )
        c = classify_mod.classify(grade_turn(turn, GradeContext()))
        assert c.primary is None
        assert "not proof" in c.explanation


class TestDialogueFaultNormalization:
    """A carried fault must be compared through resolver normalization.

    First live contact after the replay fix (campaign c14): the technician
    typed "What does F004 mean on a PowerFlex 525?", the resolver pinned the
    canonical form "F0004", and the substring check `"f0004" in prior_text`
    failed against "f004" — three confident DIALOGUE classifications inside
    PASSING conversations, all false. The check became decidable for the first
    time (replay markers finally flowing) and false-positived on first contact
    with real data, like every other detector in this arc.
    """

    def _turn(self, code, msg="How do I reset it?"):
        return TurnEvidence(index=2, technician_message=msg, mira_reply="…", uns_fault_code=code)

    def _prior(self, text):
        return [TurnEvidence(index=1, technician_message=text, mira_reply="ok")]

    def test_normalized_form_of_a_mentioned_code_is_not_a_carry(self):
        """F004 (typed) vs F0004 (pinned) — same fault, zero-padded."""
        ctx = GradeContext(prior_turns=self._prior("What does F004 mean on a PowerFlex 525?"))
        g = stages.grade_dialogue(self._turn("F0004"), ctx)
        assert g.verdict != FAIL, f"normalization false positive is back: {g.detail}"

    def test_reverse_padding_direction_also_matches(self):
        ctx = GradeContext(prior_turns=self._prior("drive shows F0004 again"))
        assert stages.grade_dialogue(self._turn("F4"), ctx).verdict != FAIL

    def test_dashed_variant_matches(self):
        ctx = GradeContext(prior_turns=self._prior("keypad reads CE-10 on the GS10"))
        assert stages.grade_dialogue(self._turn("CE10"), ctx).verdict != FAIL

    def test_a_genuinely_unmentioned_fault_still_fails(self):
        """The negative control — the check must keep its teeth."""
        ctx = GradeContext(prior_turns=self._prior("What does CE10 mean on a DURApulse GS10?"))
        g = stages.grade_dialogue(self._turn("F0004"), ctx)
        assert g.verdict == FAIL
        assert "F0004" in g.detail
