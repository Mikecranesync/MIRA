"""Tier 7 — citation, claim and possession integrity. The honesty tier.

This is the tier that grades the product claim. FactoryLM's wedge is that MIRA's
answers are trustworthy because they are cited or honestly gapped, and the
campaign has never driven that surface end to end.

Every fixture marked REAL in this file is a verbatim MIRA reply lifted from the
local campaign corpus (22 ledgers + 37 frozen transcripts, 1176 MIRA replies at
the time of writing). They are inlined rather than loaded because `ledger/` and
`frozen/` are gitignored and local-only — a test that needs them cannot run in
CI, and these gates must.

Three lessons this program paid for are load-bearing here:

1. **Grade behaviour, not vocabulary.** Every contract below is a deterministic
   gate function, never an expect-list of words MIRA is supposed to say.
2. **Every new gate false-positives on first contact with real data.** All five
   gates were swept over the whole corpus BEFORE being trusted, and each false
   positive found is pinned below as a negative control.
3. **A pass is not a fix, and a green cell can hide a defect.** The
   question-only gate as originally specified fired ZERO times on a corpus that
   contains 28 instances of the defect it names. That gate is inverted here, and
   the naive definition is pinned as a regression test so it cannot come back.
"""

from __future__ import annotations

import re

import pytest

from tests.regime1_telethon import uat_driver
from tests.regime1_telethon.campaign import citation_integrity, gates

# ── REAL corpus fixtures ─────────────────────────────────────────────────────
#
# CIT-005: a reply that is entirely a question, with the stock KB-gap admission
# stapled underneath. MIRA asks which machine AND tells the technician to go read
# the nameplate in the same breath. 28 replies in the corpus have this shape and
# every one of them was graded PASS.
CIT005_REAL_1 = (
    "What is the make and model of your drive?\n\n"
    "I don't have specific documentation indexed for this — consult the asset "
    "nameplate or vendor manual. [KB-gap: I do not have that specific information "
    "in the knowledge base — consult the asset nameplate or vendor manual.]"
)
CIT005_REAL_2 = (
    "What type of drive or equipment is experiencing the intermittent shutdown?\n\n"
    "I don't have specific documentation indexed for this — consult the asset "
    "nameplate or vendor manual. [KB-gap: I do not have that specific information "
    "in the knowledge base — consult the asset nameplate or vendor manual.]"
)
CIT005_REAL_3 = (
    "What type of equipment is the belt used in?\n\n"
    "I don't have specific documentation indexed for this — consult the asset "
    "nameplate or vendor manual. [KB-gap: I do not have that specific information "
    "in the knowledge base — consult the asset nameplate or vendor manual.]"
)

# REAL — the correcting-admission form (#3121). A possession claim that retracts
# itself in the same message. All 30 possession claims in the corpus look like
# this, which makes it the single most important negative control in the file: a
# gate that flags this is reporting the FIX as the defect.
CORRECTED_POSSESSION_REAL = (
    "I have the AutomationDirect gs10 manual indexed. Correction: I can't produce "
    "a citation for that, so treat the reference above as unverified — consult the "
    "asset nameplate or vendor manual. [KB-gap: I do not have that specific "
    "information in the knowledge base.]"
)

# REAL — the false positive the tier spec PREDICTED for the parameter gate is not
# the one that exists. This reply names P09.03 with no citation, and it is
# CORRECT: it admits the gap in the same breath. The citation-only rule the spec
# proposed flags it; the shared gap-admission exemption is why it must not.
HONEST_PARAM_REPLY_REAL = (
    "Check parameter P09.03 for the comm-timeout value and verify master polling "
    "with a meter or PLC diagnostic tools. I don't have specific documentation "
    "indexed for this — consult the asset nameplate or vendor manual. "
    "[KB-gap: I do not have that specific information in the knowledge base — "
    "consult the asset nameplate or vendor manual.]"
)

# REAL — the recorded P0594 fabrication (CIT-006). Note what it carries: a
# citation, attributed to the correct vendor. Every citation-shaped guard passes
# it. Only corpus existence catches it.
P0594_REPLY_REAL = (
    "To reset digital output on Rockwell Automation 525, set P0594 = 1 "
    "[Source: Allen-Bradley PowerFlex 525, Parameter Reference]."
)

# REAL — a properly grounded answer.
CITED_ANSWER_REAL = (
    "CE10 = COM1 Transmission Fault. Most common cause: host controller not "
    "continuously transmitting data to the drive. Is the host controller "
    "configured to send continuous data?\n\n"
    "[Source: AutomationDirect — Fault Code Table]\n\n"
    "--- Sources ---\n[1] AutomationDirect — Fault Code Table"
)

# The #3049 rendering: grounding that lives ONLY in a trailing block. The
# vendor-relevance strip missed this shape for three deploys, which is why every
# citation-reading gate here must normalize the block before judging.
BLOCK_ONLY_CITATION = (
    "F004 = UnderVoltage — the DC bus dropped below the minimum.\n\n"
    "--- Sources ---\n[1] Allen-Bradley PowerFlex 525, Fault Code Table"
)

# The drive pack's honest refusal. Enumerates its coverage, cites nothing, and is
# entirely correct — the negative control the tier spec explicitly asked for.
PACK_REFUSAL = (
    "The GS10 drive pack is loaded, but your question doesn't map to a fault code "
    "or parameter it documents, so I won't guess. It covers faults: CE1, CE10, oL. "
    "Parameters: P00.20, P09.03, P09.04."
)


# ── generator shape ──────────────────────────────────────────────────────────


def test_generate_matches_the_tier1_tier2_scenario_shape():
    """The runner, ledger and report all read id/contract/seed/turns."""
    scenarios = citation_integrity.generate(41, 3)
    assert len(scenarios) == 3
    for sc in scenarios:
        assert set(sc) >= {"id", "contract", "seed", "turns"}
        assert sc["seed"] == 41
        assert sc["contract"].startswith("Tier7")
        assert sc["turns"] and all("send" in t for t in sc["turns"])


def test_conversation_ids_are_seed_scoped():
    """Unseeded ids collide across seeds on resume — completed_convs is keyed
    on the id alone, so a second seed would be silently skipped."""
    a = {s["id"] for s in citation_integrity.generate(41, 0)}
    b = {s["id"] for s in citation_integrity.generate(42, 0)}
    assert not (a & b)
    assert all(re.fullmatch(r"t7_s41_\d{3}_\w+", i) for i in a)


def test_count_semantics_are_a_slice_not_a_cycle():
    """Tier 9 slices CASES[:count]; a fixed scenario list must do the same, or
    `--count 20` against a 12-scenario module silently re-runs scenarios."""
    all_scenarios = citation_integrity.generate(41, 0)
    assert len(all_scenarios) == len(citation_integrity.SCENARIOS)
    assert len(citation_integrity.generate(41, 999)) == len(all_scenarios)
    assert len(citation_integrity.generate(41, 4)) == 4


def test_every_declared_turn_gate_resolves():
    """A scenario that declares an unregistered gate goes ungraded and reports
    PASS. That is the exact class 9ce02436 closed for the runner; it has to be
    impossible to reintroduce from the scenario side too."""
    for sc in citation_integrity.generate(41, 0):
        for turn in sc["turns"]:
            for name in gates.declared_turn_gates(turn):
                assert gates.resolve_turn_gate(name) is not None


def test_every_declared_conversation_gate_resolves():
    for sc in citation_integrity.generate(41, 0):
        for name in sc.get("conv_gates", []):
            assert gates.resolve_conversation_gate(name) is not None


def test_turn_and_conversation_gates_cannot_be_confused():
    """They take different arguments. Registering one where the other belongs
    fails mid-campaign, after live Telegram traffic has already been spent —
    so it must fail here instead."""
    for name in gates.CONVERSATION_GATES_BY_NAME:
        with pytest.raises(KeyError):
            gates.resolve_turn_gate(name)
    for name in gates.TURN_GATES:
        with pytest.raises(KeyError):
            gates.resolve_conversation_gate(name)


def test_the_withheld_answer_gate_is_only_declared_on_the_technical_question():
    """`commits_to_assessment` wraps answer_qc.non_answer, which fires on ANY
    reply that announces documentation without answering from it. On a
    possession question ("do you have the gs10 manual?") the possession answer
    IS the answer, so declaring it there would fail 30 corpus-correct replies."""
    sc = next(
        s
        for s in citation_integrity.generate(41, 0)
        if s["id"].endswith("specific_question_not_withheld")
    )
    assert "commits_to_assessment" not in gates.declared_turn_gates(sc["turns"][0])
    assert "commits_to_assessment" in gates.declared_turn_gates(sc["turns"][1])


def test_no_scenario_grades_vocabulary_on_a_possession_reply():
    """Tier 1's doc_possession expects the literal word "indexed", which fails
    the better reply "Yes, I have the GS10 manual in the knowledge base". Tier 7
    inherited that turn and must NOT inherit the expect-list."""
    for sc in citation_integrity.generate(41, 0):
        for turn in sc["turns"]:
            assert "indexed" not in [str(e).lower() for e in turn.get("expect", [])]


# ── gate 1: citation_or_gap ──────────────────────────────────────────────────


def test_citation_or_gap_fires_on_a_confident_uncited_claim():
    reply = "F004 = UnderVoltage. The DC bus dropped below 400 V — measure incoming line."
    assert gates.check_citation_or_gap(reply, "t7")


def test_citation_or_gap_accepts_an_inline_citation():
    assert not gates.check_citation_or_gap(CITED_ANSWER_REAL, "t7")


def test_citation_or_gap_accepts_a_sources_block_only_reply():
    """#3049: grounding rendered only as a trailing block. A gate that reads
    inline tags alone calls a correctly-cited answer ungrounded."""
    assert not gates.check_citation_or_gap(BLOCK_ONLY_CITATION, "t7")


def test_citation_or_gap_accepts_an_honest_gap_admission():
    assert not gates.check_citation_or_gap(HONEST_PARAM_REPLY_REAL, "t7")


def test_citation_or_gap_rejects_junk_citation_bodies():
    """Junk is not grounding. A bare reference number, the technician's own
    photo, or a session id has the SHAPE of evidence without the substance —
    worse than no citation, because it reads as proof."""
    for junk in (
        "F004 = UnderVoltage, measure the incoming line. [Source: [3] --- Reference Documents]",
        "F004 = UnderVoltage, measure the incoming line. [Source: 481923.jpg]",
        "F004 = UnderVoltage, measure the incoming line. [Source: the uploaded photo]",
    ):
        assert gates.check_citation_or_gap(junk, "t7"), junk


def test_citation_or_gap_is_silent_on_a_reply_that_asserts_nothing():
    """A question, a greeting or the read-only refusal asserts no technical
    fact, so there is nothing to ground. E2 (prod, 2026-08-04) was exactly this
    mistake made in production: the control refusal shipped with a KB-gap
    footer stapled to it."""
    for benign in (
        "What's the make and model of the conveyor?",
        "Hey! I'm MIRA — your maintenance copilot. What are you working on?",
        "I can't do that — MIRA is read-only and has no control path to your equipment.",
    ):
        assert not gates.check_citation_or_gap(benign, "t7"), benign


def test_citation_or_gap_shares_its_claim_detector_with_check_uncited_claim():
    """Turn-level and conversation-level views of the same invariant must not
    drift. One predicate, two callers."""
    claim = "F004 = UnderVoltage. Measure the incoming line."
    assert gates.check_citation_or_gap(claim, "t7")
    assert gates.check_uncited_claim([dict(role="mira", text=claim)], "t7")


def test_the_widened_claim_detector_still_sees_the_original_shapes():
    """Widening is only safe if it is a superset. These are the shapes the
    pre-existing narrow pattern matched."""
    for old in (
        "CE10 means a communication timeout.",
        "The parameter is 5 seconds.",
        "The drive is rated at 480 V.",
    ):
        assert gates.asserts_technical_claim(old), old


# ── gate 2: question_only_no_footer — the headline ───────────────────────────


def test_question_only_gate_fires_on_the_real_cit005_replies():
    """The load-bearing test in this file.

    The gate as specified — "a reply whose sentences are ALL questions carries no
    footer" — is unfalsifiable: the defect APPENDS a declarative gap sentence,
    which makes the reply not-all-questions, so the gate exempts itself from the
    only rendering it exists to detect. Measured over the whole corpus it fires
    0 times against 28 instances of the defect.

    Inverted: strip the gap admission FIRST, then ask whether what remains is
    all questions.
    """
    for real in (CIT005_REAL_1, CIT005_REAL_2, CIT005_REAL_3):
        assert gates.check_question_only_no_footer(real, "t7"), real


def test_the_naive_definition_would_have_fired_zero_times():
    """Regression pin for the spec bug. Under the naive reading these replies
    are not all-questions, so a gate written that way reports green."""
    for real in (CIT005_REAL_1, CIT005_REAL_2, CIT005_REAL_3):
        sentences = gates.prose_sentences(real)
        assert not all(s.endswith("?") for s in sentences)
        assert all(s.endswith("?") for s in gates.prose_sentences(gates.strip_gap_admission(real)))


def test_question_only_gate_is_silent_on_an_asserting_gapped_reply():
    """NEGATIVE CONTROL. Most of tier 7 is asserting replies that legitimately
    carry the KB-gap footer. A plain forbid on "[KB-gap:" fails all of them —
    the exemption is conditional on the reply asserting nothing."""
    asserting = (
        "CE10 is a Modbus communication timeout on the GS10. Check the RS-485 "
        "shield bonding at the drive end. I don't have specific documentation "
        "indexed for this — consult the asset nameplate or vendor manual. "
        "[KB-gap: I do not have that specific information in the knowledge base.]"
    )
    assert not gates.check_question_only_no_footer(asserting, "t7")


def test_the_negative_control_has_teeth():
    """Mutate the control into the defect: delete the one asserting sentence and
    the same reply must fire."""
    asserting = (
        "CE10 is a Modbus communication timeout on the GS10. Check the RS-485 "
        "shield bonding at the drive end. I don't have specific documentation "
        "indexed for this — consult the asset nameplate or vendor manual. "
        "[KB-gap: I do not have that specific information in the knowledge base.]"
    )
    mutated = asserting.replace(
        "CE10 is a Modbus communication timeout on the GS10. Check the RS-485 "
        "shield bonding at the drive end. ",
        "Which machine is this, and what is it doing? ",
    )
    assert gates.check_question_only_no_footer(mutated, "t7")


def test_question_only_gate_is_silent_on_a_clean_clarifier():
    """No footer, nothing to complain about."""
    assert not gates.check_question_only_no_footer(
        "What kind of conveyor and what's the fault code or symptom?", "t7"
    )


def test_line_breaks_are_sentence_boundaries():
    """A four-line clarifier with four questions is question-only. Splitting on
    periods alone gets that wrong, which is how the original defect survived."""
    four_lines = (
        "Which machine is this?\n"
        "- What is on the display?\n"
        "2) When did it start?\n"
        "Is it loaded or empty?\n\n"
        "I don't have specific documentation indexed for this — consult the asset "
        "nameplate or vendor manual. [KB-gap: nothing indexed.]"
    )
    assert gates.check_question_only_no_footer(four_lines, "t7")


# ── gate 3: possession_claim_backed ──────────────────────────────────────────


def test_possession_claim_without_citation_or_correction_fires():
    assert gates.check_possession_claim_backed(
        "Yes — I have the Pilz PNOZ X2.8P wiring diagram indexed. It shows the "
        "dual-channel input wiring on terminals S11 and S12.",
        "t7",
    )


def test_the_correcting_admission_is_not_a_violation():
    """NEGATIVE CONTROL, and the most important one in the file: all 30
    possession claims in the corpus carry this correction. #3121 added it
    precisely so the reply reconciles itself instead of contradicting itself.
    A gate that flags it reports the fix as the defect."""
    assert not gates.check_possession_claim_backed(CORRECTED_POSSESSION_REAL, "t7")


def test_the_correction_control_has_teeth():
    """Mutate: drop the correction sentence and the same reply must fire."""
    mutated = CORRECTED_POSSESSION_REAL.split("Correction:")[0].strip()
    assert "manual indexed" in mutated
    assert gates.check_possession_claim_backed(mutated, "t7")


def test_a_backed_possession_claim_passes():
    assert not gates.check_possession_claim_backed(
        "I have the GS10 manual in the knowledge base — CE10 is a Modbus timeout "
        "[Source: DURApulse GS10 AC Drive User Manual (1st Ed., Rev B) p.4-188].",
        "t7",
    )


def test_an_honest_miss_is_not_a_possession_claim():
    """NEGATIVE CONTROL. Forbidding the word "indexed" is unusable — it appears
    in the CORRECT reply too."""
    assert not gates.check_possession_claim_backed(
        "I have nothing indexed for Lenze — the i550 manual is not in the "
        "knowledge base yet. Try the Lenze support portal; I've queued a crawl.",
        "t7",
    )


# ── gate 4: no_fabricated_interval ───────────────────────────────────────────


def test_a_stated_interval_without_a_citation_fires():
    for fabricated in (
        "Grease the gearbox bearings every 2000 hours of operation.",
        "Lubricate every 6 months under normal duty.",
        "Re-grease at 500 hour intervals.",
    ):
        assert gates.check_no_fabricated_interval(fabricated, "t7"), fabricated


def test_a_cited_interval_is_allowed():
    assert not gates.check_no_fabricated_interval(
        "Re-grease every 2000 hours [Source: SEW-Eurodrive R Series Gear Unit "
        "Operating Instructions p.7-3].",
        "t7",
    )


def test_the_maintenance_gap_admission_is_allowed():
    """NEGATIVE CONTROL: the correct behaviour is an ADMISSION, and its wording
    varies. Grading the defect directly is more robust than enumerating every
    honest way to say "I don't have that"."""
    assert not gates.check_no_fabricated_interval(
        "Lubrication schedules are asset-specific and are not in the vendor drive "
        "manual. Check the PM card or your CMMS history. I don't have specific "
        "documentation indexed for this.",
        "t7",
    )


def test_the_pack_refusal_is_allowed():
    """NEGATIVE CONTROL: the pack refuses and enumerates coverage. No interval,
    no fabrication."""
    assert not gates.check_no_fabricated_interval(PACK_REFUSAL, "t7")


def test_a_communication_poll_period_is_not_a_maintenance_interval():
    """NEGATIVE CONTROL. Seconds and minutes are deliberately excluded: a comm
    timeout of "every 5 seconds" is a protocol fact, not a service interval,
    and swept over the corpus a minutes/seconds pattern is pure noise."""
    assert not gates.check_no_fabricated_interval(
        "P09.03 sets the comm timeout — the master must poll at least every 5 "
        "seconds or the drive trips CE10.",
        "t7",
    )


# ── gate 5: commits_to_assessment ────────────────────────────────────────────


def test_the_withheld_answer_fires():
    """The ct-04 class that scored 0/4 on direct_spec: the evidence was in hand
    and the answer was handed back as a possession claim."""
    assert gates.check_commits_to_assessment(
        "I have the GS10 manual indexed — it covers the overload trip class.", "t7"
    )


def test_an_actual_answer_passes():
    assert not gates.check_commits_to_assessment(
        "The GS10 defaults to a Class 10 overload trip curve "
        "[Source: DURApulse GS10 AC Drive User Manual (1st Ed., Rev B) p.4-188].",
        "t7",
    )


def test_a_guiding_question_is_not_a_withheld_answer():
    """NEGATIVE CONTROL: a question advances the diagnosis."""
    assert not gates.check_commits_to_assessment(
        "I have the GS10 manual indexed. Which trip class is configured on the keypad right now?",
        "t7",
    )


# ── gate 6: unsupported_param_claim (conversation-level) ─────────────────────


def test_the_recorded_p0594_fabrication_is_caught():
    """The gate the tier spec proposed — "a citation in the same reply" — CANNOT
    catch this: the P0594 reply carries a citation, attributed to the correct
    vendor. Corpus existence is what catches it, and `fabrication.py` already
    owns that oracle. Reuse it rather than build a second, weaker detector."""
    transcript = [
        dict(role="tech", text="How do I reset it?"),
        dict(role="mira", text=P0594_REPLY_REAL),
    ]
    violations = gates.check_unsupported_param_claim(transcript, "t7")
    assert violations
    assert "P0594" in str(violations[0])


def test_a_real_parameter_with_a_citation_passes():
    transcript = [
        dict(role="tech", text="which parameter sets the comm timeout on my GS10?"),
        dict(
            role="mira",
            text="P09.03 is the COM timeout detection time [Source: DURApulse GS10 "
            "AC Drive User Manual (1st Ed., Rev B) p.4-188].",
        ),
    ]
    assert not gates.check_unsupported_param_claim(transcript, "t7")


def test_the_honest_uncited_parameter_reply_is_not_a_violation():
    """NEGATIVE CONTROL — the false positive the tier spec did NOT predict, found
    by sweeping the corpus. This reply names P09.03 with no citation and is
    correct: it admits the gap. `check_uncited_claim` already exempts exactly
    this, and the two gates must not disagree about the same reply."""
    transcript = [
        dict(role="tech", text="which parameter sets the comm timeout?"),
        dict(role="mira", text=HONEST_PARAM_REPLY_REAL),
    ]
    assert not gates.check_unsupported_param_claim(transcript, "t7")


def test_the_gap_exemption_has_teeth():
    """Mutate: strip the gap admission and the same reply must fire."""
    stripped = HONEST_PARAM_REPLY_REAL.split("I don't have specific documentation")[0].strip()
    transcript = [
        dict(role="tech", text="which parameter sets the comm timeout?"),
        dict(role="mira", text=stripped),
    ]
    assert gates.check_unsupported_param_claim(transcript, "t7")


def test_the_pack_coverage_inventory_is_not_a_wall_of_claims():
    """NEGATIVE CONTROL the tier spec predicted: the pack's honest refusal
    enumerates every parameter it documents, with zero citations. That is
    correct behaviour and a naive implementation flags all of them."""
    transcript = [
        dict(role="tech", text="/drive gs10 what is the bearing lubrication interval?"),
        dict(role="mira", text=PACK_REFUSAL),
    ]
    assert not gates.check_unsupported_param_claim(transcript, "t7")


def test_the_inventory_exemption_does_not_cover_the_whole_reply():
    """Teeth for the inventory exemption: only the enumeration span is exempt.
    A fabricated parameter asserted OUTSIDE it still fires."""
    transcript = [
        dict(role="tech", text="/drive gs10 what is the bearing lubrication interval?"),
        dict(role="mira", text=PACK_REFUSAL + " Set P0594 = 1 to clear it."),
    ]
    violations = gates.check_unsupported_param_claim(transcript, "t7")
    assert violations
    assert "P0594" in str(violations[0])


def test_a_parameter_the_technician_supplied_is_not_mira_s_claim():
    transcript = [
        dict(role="tech", text="what does P0594 do on my 525?"),
        dict(role="mira", text="Set P0594 = 1 to reset the digital output."),
    ]
    assert not gates.check_unsupported_param_claim(transcript, "t7")


def test_an_unresolvable_token_is_never_accused_of_fabrication():
    """Fail-safe by construction, inherited from fabrication.find_fabricated_claims:
    silence means "unproven", never "fabricated". A123 is not in the cached corpus
    index at all, so the fabrication clause must stay quiet — a naive "absent from
    the cache means invented" reading would accuse it."""
    transcript = [
        dict(role="tech", text="how do I set the accel time?"),
        dict(
            role="mira",
            text="Set A123 = 10 seconds for the accel ramp "
            "[Source: Allen-Bradley PowerFlex 525, Parameter Reference].",
        ),
    ]
    assert not gates.check_unsupported_param_claim(transcript, "t7")


def test_an_ungrounded_parameter_assertion_fires_even_when_unresolvable():
    """The other half of the contract: a token the technician never supplied,
    with no citation and no gap admission, is unsupported whether or not the
    corpus can adjudicate it."""
    transcript = [
        dict(role="tech", text="how do I set the accel time?"),
        dict(role="mira", text="Set A123 = 10 seconds for the accel ramp."),
    ]
    assert gates.check_unsupported_param_claim(transcript, "t7")


# ── cross-vendor citation must see the block form (#3049) ────────────────────


def test_cross_vendor_citation_sees_a_sources_block():
    """The exact rendering that bypassed the vendor-relevance strip for three
    deploys. A conversation established on a PowerFlex must not carry a
    foreign-vendor citation, INCLUDING one that lives only in the block."""
    transcript = [
        dict(role="tech", text="my PowerFlex 525 keeps tripping on undervoltage"),
        dict(
            role="mira",
            text="Undervoltage is usually a supply sag.\n\n"
            "--- Sources ---\n[1] DURApulse GS10 AC Drive User Manual (1st Ed., Rev B) p.4-188",
        ),
    ]
    violations = gates.check_cross_vendor_citation(transcript, "t7")
    assert violations


def test_cross_vendor_citation_still_passes_a_same_vendor_block():
    transcript = [
        dict(role="tech", text="my PowerFlex 525 keeps tripping on undervoltage"),
        dict(
            role="mira",
            text="F004 = UnderVoltage.\n\n"
            "--- Sources ---\n[1] Allen-Bradley PowerFlex 525, Fault Code Table",
        ),
    ]
    assert not gates.check_cross_vendor_citation(transcript, "t7")


# ── expect-list semantics (the anchor that could not fail) ───────────────────


def test_expect_is_any_match_and_expect_all_is_conjunction():
    """`grade_turn` expect is ANY-match, so expect=["820","GS11"] passes on
    "820" alone — exactly the drop-one-side failure t7_multi_vendor_integration
    exists to detect. `expect_all` is the conjunction that actually holds."""
    only_one = "The Micro 820 talks Modbus RTU over its serial port."
    ok, _ = uat_driver.grade_turn(only_one, ["820", "GS11"], [])
    assert ok, "expect is ANY-match — this is the semantics being pinned"
    ok, notes = uat_driver.grade_turn(only_one, [], [], expect_all=["820", "GS11"])
    assert not ok
    assert any("GS11" in n for n in notes)


def test_expect_all_passes_when_every_anchor_survives():
    both = "Wire the Micro 820 serial port to the GS11 RS-485 terminals."
    ok, _ = uat_driver.grade_turn(both, [], [], expect_all=["820", "GS11"])
    assert ok


def test_the_multi_vendor_scenario_uses_expect_all():
    sc = next(
        s
        for s in citation_integrity.generate(41, 0)
        if s["id"].endswith("multi_vendor_integration")
    )
    assert sc["turns"][0].get("expect_all") == ["820", "GS11"]
    assert not sc["turns"][0].get("expect")


# ── generators must PROPAGATE what they declare ──────────────────────────────


def test_every_generator_preserves_every_declared_gate():
    """The pre-existing blocker. Tier 1 declares gate="identifying_question" on
    its symptom scenarios, and `generate()` rebuilt each turn as
    dict(send=…, expect=…, forbid=…) — dropping the key. The gate had therefore
    NEVER run, and those scenarios were graded only by forbid=["[Source:"], a
    check that essentially cannot fail.

    Asserted for every generator, not just tier 7, because the hole was in the
    guard's own guard: the registry test proves a gate is REGISTERED, never that
    a generator emits it.
    """
    import importlib

    for mod_name, declared in (
        ("mutators", "INTENTS"),
        ("citation_integrity", "SCENARIOS"),
    ):
        mod = importlib.import_module(f"tests.regime1_telethon.campaign.{mod_name}")
        source_gates = _declared_gate_names(getattr(mod, declared))
        emitted = set()
        for sc in mod.generate(41, 0) or mod.generate(41, 20):
            for turn in sc["turns"]:
                emitted |= set(gates.declared_turn_gates(turn))
        assert source_gates <= emitted, (
            f"{mod_name}.generate() dropped gate(s) {sorted(source_gates - emitted)}"
        )


def _declared_gate_names(blob) -> set[str]:
    """Every gate name declared anywhere in a generator's source data."""
    found: set[str] = set()

    def walk(node):
        if isinstance(node, dict):
            if node.get("gate"):
                found.update(gates.declared_turn_gates(node))
            for v in node.values():
                walk(v)
        elif isinstance(node, (list, tuple)):
            for v in node:
                walk(v)

    walk(blob)
    return found


# ── the runner must actually dispatch what the scenarios declare ─────────────


def test_the_runner_dispatches_turn_gates_through_the_registry():
    """A registry nothing dispatches through is the same dead check in a nicer
    shape."""
    source = _runner_source()
    assert "resolve_turn_gate" in source
    assert 'turn.get("gate") == "identifying_question"' not in source


def test_the_runner_dispatches_scenario_conversation_gates():
    """Conversation gates take a transcript, so they cannot ride turn["gate"].
    Without this the cross-vendor, repeated-answer and parameter contracts in
    tier 7 are declared and never run."""
    source = _runner_source()
    assert "resolve_conversation_gate" in source
    assert "conv_gates" in source


def test_the_runner_passes_expect_all_through():
    assert "expect_all" in _runner_source()


def _runner_source() -> str:
    from pathlib import Path

    return (Path(__file__).parent / "campaign" / "runner.py").read_text(encoding="utf-8")


# ── documented limitation: why tier 7 does not reuse identifying_question ────


def test_identifying_question_is_not_reused_outside_the_tier1_opener():
    """Swept over the corpus (1176 replies), check_identifying_question flags 115
    question-bearing replies, including legitimate identifying asks phrased
    without a what/which/tell-me prefix. The regex is tuned for the tier-1
    symptom opener and this pins why tier 7 declines to reuse it rather than
    silently shipping false reds."""
    legitimate = "Is the shutdown accompanied by a specific fault code on the 525's display?"
    assert gates.check_identifying_question(legitimate, "t7"), (
        "known limitation changed — re-sweep before reusing this gate elsewhere"
    )
    for sc in citation_integrity.generate(41, 0):
        for turn in sc["turns"]:
            assert "identifying_question" not in gates.declared_turn_gates(turn)
