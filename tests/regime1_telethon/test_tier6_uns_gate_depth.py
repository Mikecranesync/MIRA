"""Tier 6 — UNS gate DEPTH: what happens AFTER the first identity prompt.

Tier 1 grades that the gate FIRES. Nothing grades what happens next, and
everything expensive lives next. Every scenario in `campaign/uns_gate_depth.py`
exists because of a live UAT defect this program already paid for:

  * CON-003  — "thanks" silently consuming the pending confirmation.
  * CON-004  — the identical prompt replayed word-for-word when the technician
               CHALLENGED the guess (campaign c8, t8_41_002).
  * CON-004c — the same no-candidate demand repeated turn after turn against the
               experienced and impatient personas (#3157 / #3158).
  * D2       — a technician who cannot read a worn nameplate, stonewalled forever.
  * CTX-005  — MIRA re-demanding a fault code supplied two turns earlier (the
               unfixed half of #3156).

The unifying failure mode is a LOOP, and a loop is only visible ACROSS turns.
That is why this tier leans on conversation-level gates, and why two of its four
new gates take a transcript rather than a reply.

These tests are written against **real replies lifted verbatim from the frozen
ledger corpus** (22 ledgers / 37 frozen transcripts / 1176 MIRA replies in the
local `qc` checkout). Lesson 2 of this program — every new gate false-positives
on first contact with real data — is honoured two ways here:

  1. Each gate carries a NEGATIVE CONTROL: a realistic CORRECT reply it must not
     flag, mutated in the test to prove the control has teeth.
  2. `TestLedgerSweep` runs every new gate over the whole corpus and requires a
     NON-ZERO fire count. A gate that fires zero times on a corpus known to
     contain the defect is this campaign's own "check that cannot fail".

Ledger-backed tests skip when `ledger/` is absent — it is gitignored and
local-only, so CI has no campaign data. Everything else runs everywhere.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from tests.regime1_telethon.campaign import gates  # noqa: E402
from tests.regime1_telethon.campaign import uns_gate_depth  # noqa: E402

# ── real renderings, copied verbatim out of the ledger corpus ────────────────

FOOTER = (
    "I don't have specific documentation indexed for this — consult the asset "
    "nameplate or vendor manual. [KB-gap: I do not have that specific information "
    "in the knowledge base — consult the asset nameplate or vendor manual.]"
)

# The no-candidate demand. Repeated VERBATIM turn after turn in c1/c2/c11 —
# defect CON-004c, issues #3157 / #3158.
NO_CANDIDATE_ASK = (
    "Before I diagnose, I need to know the equipment. Tell me the manufacturer "
    "and model (e.g., 'Allen-Bradley PowerFlex 525')."
)

# The candidate-confirmation prompt. Replayed word-for-word when challenged —
# defect CON-004, campaign c8 t8_41_002.
CANDIDATE_CONFIRM = (
    "Before I diagnose, confirm the equipment: **AutomationDirect, GS10** "
    "(confidence 70%). Reply 'yes' to confirm, or tell me the correct "
    "manufacturer and model."
)

# The groundedness clarifier that re-demands a fault code already supplied.
# Note the numbered MENU: it is what makes an "all sentences are questions"
# gate exempt itself from the very defect it exists to catch.
CTX005_CLARIFIER = (
    "Diagnosing...\n"
    "Before I can give you a confident diagnosis, could you share one more detail "
    "— what exact fault code, alarm number, or behaviour is the equipment showing "
    "right now?\n\n"
    "1. Fault/alarm code displayed (e.g. F001, AL-14, OC)\n"
    "2. Visible symptom (e.g. trips on start, runs slow, won't start)\n"
    "3. Sensor reading (e.g. pressure at 120 PSI, temp at 90°C)\n"
    "4. Other — describe what you're seeing\n\n" + FOOTER
)

# What a committed assessment actually looks like on the wire (c1 t2 turn 1).
GOOD_ASSESSMENT = (
    "F004 = UnderVoltage — the DC bus dropped below the minimum. Most common "
    "causes: low incoming line or a supply sag during start. Measure the incoming "
    "voltage at L1-L2-L3. [Source: Allen-Bradley PowerFlex 525, Fault Code Table]"
)

# Degraded mode: identity is mentioned, but the reply WORKS the symptom anyway.
# This is the D2 target behaviour and the hardest negative control in the file.
DEGRADED_MODE = (
    "No exact model identified — I'll work from the symptoms with general guidance "
    "(lower confidence). If you find a nameplate or model number later, tell me and "
    "I'll pull the exact documentation. F004 typically means UnderVoltage. What is "
    "the incoming voltage at L1-L2-L3?"
)

SWITCH_ACK = (
    "Got it — switching to a new asset. What equipment do you need help with?\n\n"
    "---\n*Describe the machine* | *Scan the QR code* | *Upload a nameplate photo*"
)

# A procedure STEP that mentions a fault code. Not a demand — the technician is
# being told where to look. Pinned as a negative control for no_refault_ask.
PROCEDURE_STEP = "Check the display for a fault code.\n" + FOOTER


def _t(*pairs):
    """Transcript in the shape the conversation gates consume."""
    return [{"role": r, "text": x} for r, x in pairs]


# The CTX-005 defect, lifted from frozen c1_t2_s42_000_pivot_after_fault.
CTX005_TRANSCRIPT = _t(
    ("tech", "What does F004 mean on a PowerFlex 525?"),
    ("mira", GOOD_ASSESSMENT),
    ("tech", "How do I reset it?"),
    ("mira", CTX005_CLARIFIER),
)

# The false positive the spec PREDICTED and the corpus confirmed (c1r3, c6, c7):
# the technician pivots to a different machine, so the earlier fault code no
# longer applies and asking for a new one is CORRECT.
PIVOT_TRANSCRIPT = _t(
    ("tech", "What does F004 mean on a PowerFlex 525?"),
    ("mira", GOOD_ASSESSMENT),
    ("tech", "Actually forget that — my conveyor keeps stopping."),
    ("mira", "What's the exact fault code or error message on the display?"),
)


class TestModuleShape:
    """The generator must match tier 1/2 exactly, or the runner cannot drive it."""

    def test_generate_returns_the_runner_contract(self):
        out = uns_gate_depth.generate(41, 10)
        assert out, "generated nothing"
        for sc in out:
            assert set(sc) >= {"id", "contract", "seed", "turns"}
            assert sc["seed"] == 41
            assert sc["turns"], f"{sc['id']} has no turns"

    def test_conversation_ids_are_seed_scoped(self):
        """Unseeded ids collide across seeds on resume — the ledger keys on the
        conv id, so a second seed would be skipped as 'already done'."""
        a = {sc["id"] for sc in uns_gate_depth.generate(41, 10)}
        b = {sc["id"] for sc in uns_gate_depth.generate(42, 10)}
        assert not (a & b), f"ids collide across seeds: {sorted(a & b)}"
        assert all(sc["id"].startswith("t6_s41_") for sc in uns_gate_depth.generate(41, 10))

    def test_generation_is_deterministic(self):
        assert uns_gate_depth.generate(41, 10) == uns_gate_depth.generate(41, 10)

    def test_count_slices_and_never_over_runs(self):
        """Explicit count semantics (slice, like tier 9). `--count 20` against a
        10-scenario module must not silently wrap and re-send the same turns."""
        assert len(uns_gate_depth.generate(41, 3)) == 3
        assert len(uns_gate_depth.generate(41, 999)) == len(uns_gate_depth.SCENARIOS)

    def test_every_turn_asserts_something(self):
        """A turn with no gate, no expect and no forbid spends a live Telegram
        round-trip to buy a guaranteed PASS."""
        ungraded = [
            (sc["id"], i)
            for sc in uns_gate_depth.generate(41, 99)
            for i, turn in enumerate(sc["turns"], 1)
            if not turn.get("gate") and not turn.get("expect") and not turn.get("forbid")
        ]
        assert not ungraded, f"turns that assert nothing: {ungraded}"

    def test_every_declared_turn_gate_is_registered(self):
        for sc in uns_gate_depth.generate(41, 99):
            for turn in sc["turns"]:
                if turn.get("gate"):
                    gates.resolve_turn_gate(turn["gate"])

    def test_every_declared_conversation_gate_is_registered(self):
        for sc in uns_gate_depth.generate(41, 99):
            for name in sc.get("conv_gates", []):
                gates.resolve_conversation_gate(name)

    def test_conversation_gates_are_never_declared_as_turn_gates(self):
        """The type error the spec review caught: turn gates take (reply,
        case_id), conversation gates take a transcript. Registering one where
        the other belongs fails MID-CAMPAIGN, after live traffic is spent."""
        for sc in uns_gate_depth.generate(41, 99):
            for turn in sc["turns"]:
                if turn.get("gate"):
                    assert turn["gate"] not in gates.CONVERSATION_GATES_BY_NAME, (
                        f"{sc['id']}: {turn['gate']!r} is conversation-scoped but was "
                        "declared as a turn gate"
                    )
            for name in sc.get("conv_gates", []):
                assert name not in gates.TURN_GATES, (
                    f"{sc['id']}: {name!r} is a turn gate but was declared as a conversation gate"
                )

    def test_commits_to_assessment_is_only_asked_of_a_late_turn(self):
        """A design contract, not an implementation detail.

        The gate fires on "What kind of conveyor and what's the fault code or
        symptom?" — correctly, because that reply commits to nothing. But that is
        the RIGHT reply to an opener, and it is the exact reply tier 1 exists to
        reward. Attaching this gate to a first turn would red the behaviour the
        campaign spent a lesson learning to protect.
        """
        for sc in uns_gate_depth.generate(41, 99):
            for i, turn in enumerate(sc["turns"], 1):
                if turn.get("gate") == "commits_to_assessment":
                    assert i >= 4, (
                        f"{sc['id']} turn {i}: MIRA is asked to commit before the "
                        "technician has supplied enough to commit ON"
                    )

    def test_every_scenario_names_the_capability_it_covers(self):
        for sc in uns_gate_depth.generate(41, 99):
            assert sc.get("capability_id"), f"{sc['id']} claims no capability"

    def test_the_loop_scenarios_carry_conversation_gates(self):
        """A loop is invisible per-turn. The scenarios written for CON-004,
        CON-004c, D2 and the Q-trap must declare the conversation gate that can
        actually see it."""
        by_cap = {sc["capability_id"]: sc for sc in uns_gate_depth.generate(41, 99)}
        for cap in (
            "uns_confirm_reword_provenance",
            "uns_confirm_no_candidate_escalation",
            "uns_gate_symptom_first",
            "fsm_q_trap_commit",
        ):
            assert "identity_ask_varies" in by_cap[cap].get("conv_gates", []), cap
        assert "no_refault_ask" in by_cap["self_critique_ctx005_suppression"]["conv_gates"]


class TestRegistries:
    """Turn gates and conversation gates take different arguments. Mixing them up
    is a TypeError raised mid-campaign, after live Telegram traffic has already
    been spent — so it has to fail offline instead."""

    def test_registries_are_disjoint(self):
        overlap = set(gates.TURN_GATES) & set(gates.CONVERSATION_GATES_BY_NAME)
        assert not overlap, f"the same name resolves to both kinds of gate: {sorted(overlap)}"

    def test_a_conversation_gate_name_does_not_resolve_as_a_turn_gate(self):
        for name in gates.CONVERSATION_GATES_BY_NAME:
            with pytest.raises(KeyError):
                gates.resolve_turn_gate(name)

    def test_a_turn_gate_name_does_not_resolve_as_a_conversation_gate(self):
        for name in gates.TURN_GATES:
            with pytest.raises(KeyError):
                gates.resolve_conversation_gate(name)

    def test_an_unknown_conversation_gate_RAISES_rather_than_silently_passing(self):
        """Same reasoning as the turn-gate registry: a no-op return would let a
        typo disarm a scenario's own grading and read as green."""
        with pytest.raises(KeyError) as exc:
            gates.resolve_conversation_gate("gate_that_does_not_exist")
        assert "gate_that_does_not_exist" in str(exc.value)

    def test_every_registered_conversation_gate_takes_a_transcript(self):
        probe = _t(("tech", "my drive keeps faulting"), ("mira", NO_CANDIDATE_ASK))
        for name, fn in gates.CONVERSATION_GATES_BY_NAME.items():
            out = fn(probe, f"registry-probe-{name}")
            assert isinstance(out, list), f"{name} returned {type(out).__name__}"

    def test_every_registered_turn_gate_takes_a_reply(self):
        for name, fn in gates.TURN_GATES.items():
            out = fn(GOOD_ASSESSMENT, f"registry-probe-{name}")
            assert isinstance(out, list), f"{name} returned {type(out).__name__}"


class TestMovesPastIdentity:
    """Turn gate. The inverse of check_identifying_question, and it inherits the
    same lesson: assert the ABSENCE of an identity-ONLY reply, never vocabulary."""

    def test_fires_on_the_no_candidate_demand(self):
        v = gates.check_moves_past_identity(NO_CANDIDATE_ASK, "t6")
        assert v and v[0].gate == "moves_past_identity"

    def test_fires_on_the_candidate_confirmation_replay(self):
        assert gates.check_moves_past_identity(CANDIDATE_CONFIRM, "t6")

    def test_fires_when_only_the_boilerplate_footer_accompanies_the_demand(self):
        """The KB-gap footer rides on nearly every reply. If it counted as
        content, this gate could never fire — the corpus is 1176 replies deep in
        that footer."""
        assert gates.check_moves_past_identity(NO_CANDIDATE_ASK + "\n\n" + FOOTER, "t6")

    def test_silent_on_degraded_mode(self):
        """NEGATIVE CONTROL. Mentions the nameplate and the model, and still
        works the symptom — the exact D2 behaviour the tier wants."""
        assert not gates.check_moves_past_identity(DEGRADED_MODE, "t6")

    def test_silent_on_a_committed_assessment(self):
        assert not gates.check_moves_past_identity(GOOD_ASSESSMENT, "t6")

    def test_silent_when_there_is_no_identity_ask_at_all(self):
        assert not gates.check_moves_past_identity("Reset F004 by cycling power.", "t6")

    def test_a_diagnostic_question_is_not_an_identity_demand(self):
        """NEGATIVE CONTROL, found by sweeping the corpus (c1 t3_41_004).

        This gate PERMITS a diagnostic question — that is the whole distinction
        between it and check_commits_to_assessment. An over-broad "what kind of"
        clause swallowed this reply and would have reported narrowing questions
        as stonewalling.
        """
        assert not gates.check_moves_past_identity(
            "What type of sensor or detection method is used on your conveyor?", "t6"
        )
        # ...but asking what type of MACHINE it is remains an identity demand.
        assert gates.check_moves_past_identity(
            "What type of drive or control system is used on your conveyor?", "t6"
        )

    def test_the_negative_control_has_teeth(self):
        """Mutate the degraded-mode reply down to its identity demand alone and
        the gate must flip. A control that cannot flip proves nothing."""
        mutated = (
            "No exact model identified. Tell me the manufacturer and model and "
            "I'll pull the exact documentation."
        )
        assert not gates.check_moves_past_identity(DEGRADED_MODE, "t6")
        assert gates.check_moves_past_identity(mutated, "t6")


class TestCommitsToAssessment:
    """Turn gate. A reply that is nothing but questions asserts nothing."""

    def test_fires_on_the_ctx005_clarifier_including_its_menu(self):
        """THE load-bearing assertion.

        The naive form of this gate — "every sentence is a question" — exempts
        itself from this exact reply, because the numbered menu lines are
        declarative fragments. Strip the boilerplate and the option menu FIRST,
        then ask what is left.
        """
        v = gates.check_commits_to_assessment(CTX005_CLARIFIER, "t6")
        assert v, "the clarifier commits to nothing and must fire"
        assert v[0].gate == "commits_to_assessment"

    def test_fires_on_a_pure_question_reply(self):
        assert gates.check_commits_to_assessment("What's the drive's make and model?", "t6")

    def test_silent_on_a_committed_assessment(self):
        """NEGATIVE CONTROL — a real cited diagnosis."""
        assert not gates.check_commits_to_assessment(GOOD_ASSESSMENT, "t6")

    def test_silent_on_imperative_next_checks(self):
        reply = "Reset F004 by cycling power or using the Trip Reset function.\nCheck incoming voltage at L1-L2-L3."
        assert not gates.check_commits_to_assessment(reply, "t6")

    def test_silent_on_an_assessment_that_ends_with_a_question(self):
        """Committing and THEN asking one more thing is good technician talk."""
        assert not gates.check_commits_to_assessment(DEGRADED_MODE, "t6")

    def test_an_identity_demand_is_not_an_assessment(self):
        """ "Before I diagnose, I need to know the equipment." is a declarative
        sentence, but it commits to nothing about the machine."""
        assert gates.check_commits_to_assessment(NO_CANDIDATE_ASK, "t6")

    def test_the_negative_control_has_teeth(self):
        stripped = "What is the incoming voltage at L1-L2-L3?"
        assert not gates.check_commits_to_assessment(GOOD_ASSESSMENT, "t6")
        assert gates.check_commits_to_assessment(stripped, "t6")


class TestIdentityAskVaries:
    """Conversation gate. Re-asking is allowed; re-asking THE SAME WAY is not."""

    def test_fires_on_a_verbatim_replay_of_the_no_candidate_demand(self):
        """CON-004c / #3157 / #3158, verbatim from c1 and c2."""
        convo = _t(
            ("tech", "something is wrong with a machine"),
            ("mira", NO_CANDIDATE_ASK),
            ("tech", "it's still broken"),
            ("mira", NO_CANDIDATE_ASK),
        )
        v = gates.check_identity_ask_varies(convo, "t6")
        assert v and v[0].gate == "identity_ask_varies"

    def test_fires_when_only_the_boilerplate_differs(self):
        """The footer is ~200 characters of shared text on nearly every reply.
        Comparing raw replies would drown a real rewrite in boilerplate
        similarity; comparing only the ask CORE is what makes the ratio mean
        anything — and it must not let a replay hide behind a changed footer."""
        convo = _t(
            ("tech", "something is wrong with a machine"),
            ("mira", NO_CANDIDATE_ASK),
            ("tech", "it's still broken"),
            ("mira", "Diagnosing...\n" + NO_CANDIDATE_ASK + "\n\n" + FOOTER),
        )
        assert gates.check_identity_ask_varies(convo, "t6")

    def test_silent_when_the_second_ask_changes_shape(self):
        """NEGATIVE CONTROL — the CON-004c target behaviour: admit it cannot
        tell, refuse to guess, offer three routes to the same fact."""
        convo = _t(
            ("tech", "something is wrong with a machine"),
            ("mira", NO_CANDIDATE_ASK),
            ("tech", "it's still broken"),
            (
                "mira",
                "I still can't tell which machine this is, and I won't guess. Three ways "
                "to close that: send a photo of the nameplate, type the make and model, "
                "or give me the asset tag off the panel.",
            ),
        )
        assert not gates.check_identity_ask_varies(convo, "t6")

    def test_silent_on_a_repeat_across_an_acknowledged_asset_switch(self):
        """NEGATIVE CONTROL — after the technician moves to a different machine
        the FIRST ask is legitimately the first ask again."""
        convo = _t(
            ("tech", "my drive keeps faulting"),
            ("mira", NO_CANDIDATE_ASK),
            ("tech", "hang on, wrong machine — it's the mixer"),
            ("mira", SWITCH_ACK),
            ("tech", "yeah the mixer"),
            ("mira", NO_CANDIDATE_ASK),
        )
        assert not gates.check_identity_ask_varies(convo, "t6")

    def test_silent_on_a_single_ask(self):
        convo = _t(("tech", "my drive keeps faulting"), ("mira", NO_CANDIDATE_ASK))
        assert not gates.check_identity_ask_varies(convo, "t6")

    def test_a_conversational_hold_that_restates_is_not_a_replay(self):
        """CON-003's target behaviour. 'thanks' must NOT consume the pending ask,
        so restating it is correct — but the acknowledgement makes the reply a
        different reply. A verbatim replay is still a violation."""
        held = _t(
            ("tech", "My conveyor keeps stopping randomly"),
            ("mira", NO_CANDIDATE_ASK),
            ("tech", "thanks"),
            (
                "mira",
                "Anytime. I still need the manufacturer and model before I can diagnose "
                "that conveyor — what's on the drive's nameplate?",
            ),
        )
        assert not gates.check_identity_ask_varies(held, "t6")

    def test_the_negative_control_has_teeth(self):
        """Collapse the acknowledgement and the gate must flip."""
        replayed = _t(
            ("tech", "My conveyor keeps stopping randomly"),
            ("mira", NO_CANDIDATE_ASK),
            ("tech", "thanks"),
            ("mira", NO_CANDIDATE_ASK),
        )
        assert gates.check_identity_ask_varies(replayed, "t6")


class TestNoRefaultAsk:
    """Conversation gate. Once the technician has typed a fault code, no later
    MIRA turn may demand one — defect A behind #3160, the unfixed half of #3156."""

    def test_fires_on_the_real_ctx005_transcript(self):
        """POSITIVE CONTROL lifted verbatim from frozen
        c1_t2_s42_000_pivot_after_fault: F004 supplied in turn 1, re-demanded in
        turn 4."""
        v = gates.check_no_refault_ask(CTX005_TRANSCRIPT, "t6")
        assert v and v[0].gate == "no_refault_ask"

    def test_silent_when_no_fault_code_was_ever_supplied(self):
        convo = _t(
            ("tech", "my drive keeps tripping"),
            ("mira", "What's the exact fault code on the display?"),
        )
        assert not gates.check_no_refault_ask(convo, "t6")

    def test_silent_after_a_technician_pivot(self):
        """NEGATIVE CONTROL — the false positive the spec predicted and the
        corpus confirmed (c1r3 / c6 / c7). The technician abandoned the fault;
        asking for the new machine's code is correct."""
        assert not gates.check_no_refault_ask(PIVOT_TRANSCRIPT, "t6")

    def test_silent_after_an_acknowledged_asset_switch(self):
        convo = _t(
            ("tech", "PowerFlex 525 showing F004"),
            ("mira", GOOD_ASSESSMENT),
            ("tech", "different machine now, the mixer"),
            ("mira", SWITCH_ACK),
            ("tech", "it just stops"),
            ("mira", "What's the exact fault code on the mixer's display?"),
        )
        assert not gates.check_no_refault_ask(convo, "t6")

    def test_a_procedure_step_is_not_a_demand(self):
        """NEGATIVE CONTROL — 'Check the display for a fault code' tells the
        technician where to look. It is guidance, not a re-demand, and it occurs
        in the corpus inside otherwise-correct answers."""
        convo = _t(
            ("tech", "PowerFlex 525 showing F004"),
            ("mira", GOOD_ASSESSMENT),
            ("tech", "and what would cause it to come back?"),
            ("mira", PROCEDURE_STEP),
        )
        assert not gates.check_no_refault_ask(convo, "t6")

    def test_the_negative_control_has_teeth(self):
        """Turn the procedure step into a demand and the gate must flip."""
        demanded = _t(
            ("tech", "PowerFlex 525 showing F004"),
            ("mira", GOOD_ASSESSMENT),
            ("tech", "and what would cause it to come back?"),
            ("mira", "What is the exact fault code on the display right now?"),
        )
        assert gates.check_no_refault_ask(demanded, "t6")

    def test_the_menu_form_of_the_demand_is_caught(self):
        """The other rendering in the corpus: '1. **Exact code** — copy it
        exactly as it appears on the screen' (c1 t2_002_continuation_is_kept)."""
        convo = _t(
            ("tech", "What does CE10 mean on a DURApulse GS10?"),
            ("mira", "CE10 is a communication error. [Source: GS10 manual]"),
            ("tech", "is that fault serious?"),
            (
                "mira",
                "I couldn't find anything matching your description in my knowledge base. "
                "To look this up I need a bit more info: Equipment: AutomationDirect, GS10\n"
                "1. **Exact code** — copy it exactly as it appears on the screen\n"
                "2. **What were you doing** when it appeared?",
            ),
        )
        assert gates.check_no_refault_ask(convo, "t6")


class TestCitationOrGap:
    """Turn-scoped citation gate. `check_uncited_claim` already encodes this
    contract for a whole transcript; tier 6 needs it on ONE turn. Two
    implementations of one contract drift — so they share a body, and this test
    pins that they agree."""

    UNCITED = "F004 means undervoltage on that drive."
    CITED = "F004 means undervoltage. [Source: PowerFlex 525 Fault Table, p.12]"
    ADMITTED = (
        "F004 means undervoltage on that drive. I don't have specific documentation "
        "indexed for this — consult the asset nameplate or vendor manual."
    )

    def test_fires_on_an_uncited_technical_claim(self):
        assert gates.check_citation_or_gap(self.UNCITED, "t6")

    def test_silent_when_cited(self):
        assert not gates.check_citation_or_gap(self.CITED, "t6")

    def test_silent_when_the_gap_is_admitted(self):
        """NEGATIVE CONTROL — an honest 'I don't have documentation for this' is
        the behaviour the product wants, not a violation."""
        assert not gates.check_citation_or_gap(self.ADMITTED, "t6")

    def test_it_agrees_with_the_conversation_level_gate(self):
        """The drift guard. If these ever disagree on the same reply, one of the
        two is grading a contract nobody wrote down."""
        for reply in (self.UNCITED, self.CITED, self.ADMITTED):
            turn_level = bool(gates.check_citation_or_gap(reply, "t6"))
            conv_level = bool(gates.check_uncited_claim(_t(("mira", reply)), "t6"))
            assert turn_level == conv_level, reply


class TestIdentifyingQuestionInTheNewContexts:
    """Tier 6 reuses `check_identifying_question` far outside the tier-1
    symptom-opener it was tuned on — the manual-lookup gathering subroutine in
    particular phrases its slot-fill imperatively. Sweeping it over the corpus
    turned up real replies it wrongly failed; each is pinned here."""

    def test_the_manual_lookup_gathering_prompt_passes(self):
        """Real reply, c1 t3_41_000."""
        assert not gates.check_identifying_question(
            "I want to find that manual for you. What's the **brand or manufacturer**? "
            "(You can also say 'back to troubleshooting' anytime.)"
        )

    def test_a_declarative_identity_request_passes(self):
        """Real reply, c9 t8_41_001_experienced — an identity request with no
        interrogative prefix at all. The un-broadened regex failed it."""
        assert not gates.check_identifying_question(
            "You mentioned the fault code F004 earlier. To assist further, I need the "
            "manufacturer and model of the CV200."
        )

    def test_an_imperative_identity_request_passes(self):
        assert not gates.check_identifying_question("Send me the brand and model number.")
        assert not gates.check_identifying_question("I'll need the make and model of that drive.")

    def test_the_kb_gap_footer_alone_does_NOT_satisfy_the_gate(self):
        """THE guard on the broadening. The footer mentions the nameplate and the
        vendor manual and rides on ~every reply in the corpus. If it satisfied
        the gate, every tier-1 symptom scenario would become unfailable — which
        is the exact bug class this whole tier was written after."""
        assert gates.check_identifying_question(FOOTER)
        assert gates.check_identifying_question("I have reset the drive.\n\n" + FOOTER)

    def test_the_tier1_lesson_is_preserved(self):
        """The reply that started all of this: better than the expect-list
        wanted, and it must still pass."""
        assert not gates.check_identifying_question(
            "What kind of conveyor and what's the fault code or symptom?"
        )

    def test_a_generic_question_still_fails(self):
        assert gates.check_identifying_question("Are you having a good day?")

    def test_the_no_question_detail_is_preserved(self):
        """`test_safety_curriculum.py` asserts this exact detail string."""
        v = gates.check_identifying_question("I have reset the drive.")
        assert v and "neither asked nor requested" in v[0].detail


def _grade_offline(scenario, replies):
    """Grade a scenario against canned replies exactly as the runner does.

    Mirrors `runner.scripted_conversation`: expect/forbid via the real
    `uat_driver.grade_turn` (ANY-match, which is why every expect list in this
    tier is a single anchor), then the declared turn gate, then the declared
    conversation gates over the whole transcript.
    """
    from tests.regime1_telethon.uat_driver import grade_turn

    transcript: list[dict] = []
    notes: list[str] = []
    passed = True
    for turn, reply in zip(scenario["turns"], replies, strict=True):
        transcript.append({"role": "tech", "text": turn["send"]})
        transcript.append({"role": "mira", "text": reply})
        ok, why = grade_turn(reply, turn.get("expect", []), turn.get("forbid", []))
        if not ok:
            passed = False
            notes += why
        if turn.get("gate"):
            violations = gates.resolve_turn_gate(turn["gate"])(reply, scenario["id"])
            if violations:
                passed = False
                notes += [str(v) for v in violations]
    for name in scenario.get("conv_gates", []):
        violations = gates.resolve_conversation_gate(name)(transcript, scenario["id"])
        if violations:
            passed = False
            notes += [str(v) for v in violations]
    return passed, notes


class TestTheScenariosActuallyDiscriminate:
    """A pass is not a fix, and a green cell can hide a defect — so check the
    MECHANISM. Each scenario is graded twice offline, against the real defect
    transcript and against the behaviour the tier wants. A scenario that cannot
    tell them apart is decoration, however well its prose reads.
    """

    @staticmethod
    def _scenario(capability_id):
        return next(
            sc for sc in uns_gate_depth.generate(41, 99) if sc["capability_id"] == capability_id
        )

    def test_ctx005_fails_on_the_defect_and_passes_on_the_fix(self):
        sc = self._scenario("self_critique_ctx005_suppression")
        defective = [
            GOOD_ASSESSMENT,
            CTX005_CLARIFIER,  # discards the answer to re-demand F004
            CTX005_CLARIFIER,
        ]
        failed, notes = _grade_offline(sc, defective)
        assert not failed, "the CTX-005 scenario cannot see its own defect"
        assert any("no_refault_ask" in n for n in notes), notes

        fixed = [
            GOOD_ASSESSMENT,
            "To reset F004: clear the fault with the Stop/Reset key, then cycle "
            "power once the bus voltage is back in range. "
            "[Source: Allen-Bradley PowerFlex 525, Fault Reset]",
            "It comes back when the supply sags under load — check the incoming "
            "line under starting current. [Source: Allen-Bradley PowerFlex 525, "
            "Fault Code Table]",
        ]
        ok, notes = _grade_offline(sc, fixed)
        assert ok, notes

    def test_con004c_fails_on_the_replay_and_passes_on_the_escalation(self):
        sc = self._scenario("uns_confirm_no_candidate_escalation")
        failed, notes = _grade_offline(sc, [NO_CANDIDATE_ASK, NO_CANDIDATE_ASK])
        assert not failed
        assert any("identity_ask_varies" in n for n in notes), notes

        ok, _ = _grade_offline(
            sc,
            [
                NO_CANDIDATE_ASK,
                "I still can't tell which machine this is, and I won't guess. Three "
                "ways to close that: send a photo of the nameplate, type the make "
                "and model, or give me the asset tag off the panel.",
            ],
        )
        assert ok

    def test_the_q_trap_fails_on_a_fifth_question_and_passes_on_a_commitment(self):
        sc = self._scenario("fsm_q_trap_commit")
        engaged = "Got it — a SEW gearmotor on line 2. Does the whine change with load?"
        failed, notes = _grade_offline(
            sc,
            [
                NO_CANDIDATE_ASK,
                engaged,
                "Understood — no code, just noise. Is it constant or does it come and go?",
                "Noted. Is it louder at the input or the output end?",
                "What does the oil look like?",  # the fifth question — the Q-trap
            ],
        )
        assert not failed
        assert any("commits_to_assessment" in n for n in notes), notes

        ok, notes = _grade_offline(
            sc,
            [
                NO_CANDIDATE_ASK,
                engaged,
                "Understood — no code, just noise. Is it constant or does it come and go?",
                "Noted. Speed-independent narrows it.",
                "A whine that does not track speed points at the bearing rather than "
                "gear mesh. Check the input-shaft bearing temperature and the oil "
                "level next.",
            ],
        )
        assert ok, notes

    def test_d2_fails_when_the_technician_is_stonewalled(self):
        sc = self._scenario("uns_gate_symptom_first")
        failed, notes = _grade_offline(sc, [NO_CANDIDATE_ASK, NO_CANDIDATE_ASK, NO_CANDIDATE_ASK])
        assert not failed
        assert any("moves_past_identity" in n for n in notes), notes

        ok, notes = _grade_offline(
            sc,
            [
                NO_CANDIDATE_ASK,
                "No problem — I'll work from the symptoms at lower confidence and "
                "say so when it matters. Does it trip immediately on start, or after "
                "it has been running?",
                "Tripping on start points at load or supply rather than a thermal "
                "fault. Check the incoming voltage while someone hits start.",
            ],
        )
        assert ok, notes


class TestRunnerWiring:
    """A gate the runner never dispatches is decoration — the same failure the
    turn-gate registry was built to end. Tier 6 adds the conversation-gate half."""

    SRC = (REPO / "tests" / "regime1_telethon" / "campaign" / "runner.py").read_text(
        encoding="utf-8"
    )

    def test_the_runner_can_dispatch_tier_6(self):
        compact = self.SRC.replace(" ", "").replace("\n", "")
        assert '6:"uns_gate_depth"' in compact, (
            "tier 6 is not in the runner's generator map — `--tier 6` would print "
            "'not implemented' after the operator has already set up a run"
        )
        assert "args.tierin(1,2,6,9)" in compact, "tier 6 is not routed to the scripted path"

    def test_the_runner_applies_scenario_conversation_gates(self):
        assert "conv_gates" in self.SRC, (
            "the runner never applies scenario-declared conversation gates — the "
            "loop defects tier 6 exists for are invisible per-turn"
        )
        assert "resolve_conversation_gate" in self.SRC


class TestLedgerSweep:
    """Lesson 2, mechanised: run every new gate over the whole frozen corpus.

    A gate that fires ZERO times on 1176 real replies known to contain the
    defect is not evidence of health — it is a check that cannot fail. This test
    requires a non-zero fire count AND that the pinned negative controls stay
    silent.

    Skips in CI: `ledger/` and `frozen/` are gitignored and local-only. Point
    MIRA_CAMPAIGN_LEDGER_DIR at another checkout's ledger dir to sweep it.
    """

    @staticmethod
    def _corpus():
        from tests.regime1_telethon.campaign import ledger as ledger_mod

        led = Path(os.environ.get("MIRA_CAMPAIGN_LEDGER_DIR", ledger_mod.LEDGER_DIR))
        if not led.is_dir() or not any(led.glob("*.jsonl")):
            pytest.skip("ledgers are gitignored and local-only")
        import json

        convs: dict[str, list[dict]] = {}
        for p in sorted(led.glob("*.jsonl")):
            for line in p.read_text(encoding="utf-8").splitlines():
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if r.get("kind") != "turn" or r.get("role") not in ("tech", "mira"):
                    continue
                convs.setdefault(f"{p.stem}::{r.get('conv')}", []).append(
                    {"role": r["role"], "text": r.get("text") or ""}
                )
        return convs

    def test_every_new_gate_fires_on_the_real_corpus(self):
        convs = self._corpus()
        replies = [t["text"] for v in convs.values() for t in v if t["role"] == "mira"]
        assert replies, "corpus has no MIRA replies"

        fired = {
            "moves_past_identity": sum(
                1 for r in replies if gates.check_moves_past_identity(r, "sweep")
            ),
            "commits_to_assessment": sum(
                1 for r in replies if gates.check_commits_to_assessment(r, "sweep")
            ),
            "identity_ask_varies": sum(
                len(gates.check_identity_ask_varies(v, k)) for k, v in convs.items()
            ),
            "no_refault_ask": sum(len(gates.check_no_refault_ask(v, k)) for k, v in convs.items()),
        }
        print(f"\nsweep over {len(replies)} MIRA replies / {len(convs)} conversations: {fired}")
        for name, n in fired.items():
            assert n > 0, f"{name} fired 0 times on the real corpus — it cannot fail"

    def test_the_gates_do_not_fire_on_everything_either(self):
        """The other half. A gate that fires on EVERY reply is equally useless —
        it would red every scenario regardless of behaviour."""
        convs = self._corpus()
        replies = [t["text"] for v in convs.values() for t in v if t["role"] == "mira"]
        for name, fn in (
            ("moves_past_identity", gates.check_moves_past_identity),
            ("commits_to_assessment", gates.check_commits_to_assessment),
        ):
            rate = sum(1 for r in replies if fn(r, "sweep")) / len(replies)
            assert rate < 0.5, (
                f"{name} fires on {rate:.0%} of all replies — too blunt to mean anything"
            )
