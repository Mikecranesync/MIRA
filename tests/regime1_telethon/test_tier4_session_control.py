"""Tier 4 — session control and the deterministic non-diagnostic lanes.

Every existing tier treats MIRA as a question-answering box. Tier 4 tests the
CONTROLS a technician actually reaches for mid-shift: wiping the session,
telling it to just guess, admitting they don't know, picking option 2, saying
thanks, asking what it can do, asking what happened before, and asking what a
machine is doing right now.

The load-bearing invariant across the tier is that a NON-diagnostic turn is
answered non-diagnostically. MIRA must not fabricate a fault code out of "I
don't know", must not fabricate a machine state it has no feed for, must not
narrate an equipment history that does not exist, and must not staple a KB-gap
footer onto "thanks".

These tests are written BEFORE `campaign/session_control.py` and before the new
gates in `campaign/gates.py` exist. They fail on import until both do — that is
the point.

What each block proves
----------------------
1. **Generator shape.** Tier 4 emits the same dict the runner already consumes
   (`id`/`contract`/`seed`/`turns`), with seed-scoped ids so a resume across
   seeds cannot collide.
2. **Gate wiring is type-safe OFFLINE.** A turn gate takes `(reply, case_id)`
   and a conversation gate takes a transcript; they are not interchangeable.
   Every declared gate name must resolve in the right registry, and resolving
   one as the other must raise — otherwise the mistake surfaces mid-campaign
   after live Telegram traffic has already been spent.
3. **Generators do not drop declared gates.** Verified empirically before this
   file was written: `mutators.generate(41, 2)[0]["turns"][0].keys()` returned
   `['expect', 'forbid', 'send']` — the tier-1 `identifying_question` gate has
   NEVER run, because `generate()` rebuilt each turn and dropped the key. A
   gate registry with a hole in its own guard is worthless, so the propagation
   check covers every tier's generator, not just tier 4's.
4. **Every new gate, in both directions, with a pinned negative control.** Each
   gate must fire on the defect AND stay silent on a realistic correct reply
   taken verbatim from `engine.py`. Every control is then mutated to prove it
   has teeth — a control that cannot be made to fire is not a control.
5. **A corpus sweep.** Ledgers are gitignored and local-only, so that test
   skips when they are absent; where they exist it runs the new
   conversation-scoped gates over every recorded conversation, because every
   gate this program has shipped false-positived on first contact with real
   data.
"""

from __future__ import annotations

import json

import pytest

from tests.regime1_telethon.campaign import gates, ledger, mutators, safety, state_attacks
from tests.regime1_telethon.campaign import session_control

# ── realistic replies, lifted verbatim from mira-bots/shared/engine.py ──────
#
# Using the engine's own strings is deliberate: a fixture invented by the test
# author proves the gate matches the author's imagination, not production.

CHIPS = "\n\n---\n*Continue diagnosis* | *Log a work order*"

# engine.py:2976 — the inline /reset lane.
RESET_ACK = "Started a fresh session. What equipment can I help with?"

# engine.py:6194 — CON-003 thanks lane with an asset pinned.
THANKS_PINNED = "Anytime! I'm still tracking DURApulse GS10 if you need more." + CHIPS

# engine.py:6199 — CON-003 thanks lane with nothing pinned.
THANKS_COLD = "Anytime — that's what I'm here for. Holler if anything else acts up." + CHIPS

# engine.py:3726 — the canned help lane.
HELP_CANNED = (
    "I help maintenance technicians diagnose equipment issues. Send me a photo "
    "of a fault screen, a fault code like 'OC' or 'F-201', or describe what's "
    "happening with your equipment."
)

# engine.py:8349 — the help lane reached while a UNS confirmation is pending.
HELP_PENDING = (
    "I help maintenance technicians diagnose equipment issues — fault codes, "
    "troubleshooting steps, manuals, and work orders. Whenever you're ready, I "
    "still need the equipment's manufacturer and model to dig in — a nameplate "
    "photo works too." + CHIPS
)

# engine.py:3014 — the PROCEED interceptor's fixed low-confidence disclaimer.
PROCEED_CANNED = (
    "Got it — let me give you my best assessment based on general industrial "
    "knowledge. This is not verified against specific documentation for your "
    "equipment."
)

# engine.py:6441 — the deterministic no-live-data refusal. Note it CARRIES a
# [Source:] tag; a gate that treats every citation as a diagnostic tell would
# fail the single most correct reply in the tier.
STATE_REFUSAL = (
    "I don't have live data for that machine on this turn, so I can't tell you "
    "its current state — and I won't guess. Tell me which machine you're at "
    "(asset tag or name) and I'll pull its live state, or scan its QR code to "
    "connect me to it directly."
    "\n\n[Source: no live machine data was available for this turn]" + CHIPS
)

# engine.py:7044 — the equipment-history render.
HISTORY_LIST = (
    "Last 2 interactions for DURApulse GS10:\n\n"
    '• 2026-08-09T11:02 — Q2 — "What does CE10 mean on my DURApulse GS10 drive?"\n'
    '• 2026-08-09T10:40 — IDLE — "the gs10 threw a comm fault again"' + CHIPS
)

# engine.py:7040 — the no-rows admission.
HISTORY_NONE = (
    "No previous interactions found for this DURApulse GS10 in this session. "
    "This might be the first time it's been diagnosed here." + CHIPS
)

OPTION_LIST = (
    "A gearmotor with no nameplate still leaves a few routes:\n"
    "1. Photograph the drive's keypad and read the fault code off it\n"
    "2. Trace the motor leads back to the starter and read the overload rating\n"
    "3. Check the machine's electrical print for a motor schedule"
)


def _t(*pairs) -> list[dict]:
    """Build a transcript from (tech, mira) pairs, the shape the runner emits."""
    out: list[dict] = []
    for tech, mira in pairs:
        out.append(dict(role="tech", text=tech))
        out.append(dict(role="mira", text=mira))
    return out


# ── 1. generator shape ──────────────────────────────────────────────────────


def test_generate_matches_the_runner_scenario_contract():
    scenarios = session_control.generate(41, 0)
    assert scenarios, "tier 4 generated nothing"
    for sc in scenarios:
        assert set(sc) >= {"id", "contract", "seed", "turns"}, sc.get("id")
        assert sc["seed"] == 41
        assert sc["turns"], f"{sc['id']} has no turns"
        for turn in sc["turns"]:
            assert turn.get("send"), f"{sc['id']} has a turn with no message"


def test_conversation_ids_are_seed_scoped_and_unique():
    """Unseeded ids collide across seeds on resume — the ledger keys on id."""
    a = session_control.generate(41, 0)
    b = session_control.generate(42, 0)
    ids_a = [s["id"] for s in a]
    ids_b = [s["id"] for s in b]
    assert len(set(ids_a)) == len(ids_a), "duplicate ids inside one seed"
    assert set(ids_a).isdisjoint(ids_b), "ids collide across seeds"
    assert all(i.startswith("t4_s41_") for i in ids_a)


def test_generation_is_deterministic():
    assert session_control.generate(41, 0) == session_control.generate(41, 0)


def test_count_slices_like_tier_nine():
    full = session_control.generate(41, 0)
    assert session_control.generate(41, 3) == full[:3]
    assert len(session_control.generate(41, 99)) == len(full)


def test_every_contract_names_its_capability():
    """`contract` is the only prose a consumer actually reads.

    `capability_id` / `why_gradeable` / `expected_outcome` are read by nothing
    in ledger.py, report.py or uat_driver.py — carrying them in the emitted
    dict would be dead metadata that looks load-bearing. The capability id goes
    where a human will see it instead.
    """
    for sc in session_control.generate(41, 0):
        assert sc["contract"].startswith("Tier4 session-control ("), sc["id"]
        cap = sc["contract"].split("(", 1)[1].split(")", 1)[0]
        assert cap in session_control.CAPABILITIES, f"{sc['id']} names unknown capability {cap!r}"


def test_asset_state_scenarios_do_not_forbid_citations():
    """The correct refusal ships a [Source:] tag (engine.py:6446).

    A blanket `forbid=["[Source:"]` on those turns would fail the one reply the
    scenario exists to reward.
    """
    for sc in session_control.generate(41, 0):
        if "asset_state" not in sc["id"]:
            continue
        for turn in sc["turns"]:
            assert "[Source:" not in turn.get("forbid", []), sc["id"]


# ── 2. gate wiring is type-safe offline ─────────────────────────────────────


def test_declared_gate_names_resolve_in_the_right_registry():
    for sc in session_control.generate(41, 0):
        for turn in sc["turns"]:
            if turn.get("gate"):
                assert gates.resolve_turn_gate(turn["gate"]) is not None
        for name in sc.get("conv_gates", []):
            assert gates.resolve_conversation_gate(name) is not None
        if sc.get("precondition"):
            assert gates.resolve_precondition(sc["precondition"]) is not None


def test_a_conversation_gate_cannot_be_declared_as_a_turn_gate():
    """gates.py: the two are 'not interchangeable, and registering one here
    would fail mid-campaign after live Telegram traffic had already been
    spent'. This makes that failure offline and free."""
    assert "no_fabricated_state" in gates.CONVERSATION_GATE_REGISTRY
    with pytest.raises(KeyError, match="CONVERSATION"):
        gates.resolve_turn_gate("no_fabricated_state")
    with pytest.raises(KeyError, match="TURN"):
        gates.resolve_conversation_gate("identifying_question")


def test_the_two_registries_are_disjoint():
    overlap = set(gates.TURN_GATES) & set(gates.CONVERSATION_GATE_REGISTRY)
    assert not overlap, f"a gate name in both registries is ambiguous: {overlap}"


def test_unknown_gate_names_fail_loudly():
    with pytest.raises(KeyError):
        gates.resolve_turn_gate("no_such_gate")
    with pytest.raises(KeyError):
        gates.resolve_conversation_gate("no_such_gate")
    with pytest.raises(KeyError):
        gates.resolve_precondition("no_such_precondition")


# ── 3. generators must not drop declared gates ──────────────────────────────


@pytest.mark.parametrize(
    "module",
    [mutators, state_attacks, safety, session_control],
    ids=["tier1", "tier2", "tier9", "tier4"],
)
def test_generators_preserve_every_declared_gate(module):
    """The pre-existing blocker, generalised.

    Verified before this file existed: tier 1 declares
    `gate="identifying_question"` on both symptom intents, and `generate()`
    dropped it — so those scenarios were graded only by
    `forbid=["[Source:"]`, a check that essentially cannot fail. Any generator
    that rebuilds turn dicts can reintroduce this; the guard therefore covers
    all of them.
    """
    for sc in module.generate(41, 4):
        for turn in sc["turns"]:
            name = turn.get("gate")
            if name:
                assert gates.resolve_turn_gate(name) is not None, f"{sc['id']}: {name}"


def test_tier1_symptom_scenarios_actually_carry_their_gate():
    """The specific instance, pinned so it cannot silently regress again."""
    by_id = {sc["id"]: sc for sc in mutators.generate(41, len(mutators.INTENTS))}
    symptom = next(sc for k, sc in by_id.items() if k.endswith("_symptom_report"))
    assert symptom["turns"][0].get("gate") == "identifying_question"


# ── 4a. turn gate — social lanes ────────────────────────────────────────────


@pytest.mark.parametrize("reply", [THANKS_PINNED, THANKS_COLD, HELP_CANNED, HELP_PENDING])
def test_social_reply_gate_is_silent_on_real_social_lanes(reply):
    assert gates.check_social_reply(reply, "control") == []


def test_social_reply_gate_fires_on_a_citation():
    reply = "Anytime! [Source: GS10 User Manual p.44]" + CHIPS
    assert gates.check_social_reply(reply, "c") != []


def test_social_reply_gate_fires_on_a_kb_gap_footer():
    """Telling a technician to go read the nameplate in response to 'thanks'."""
    reply = (
        "Anytime. I don't have specific documentation indexed for this — "
        "consult the asset nameplate or vendor manual. [KB-gap: gs10]"
    )
    assert gates.check_social_reply(reply, "c") != []


def test_social_reply_gate_fires_on_troubleshooting_steps():
    reply = "You're welcome. Check the drive keypad and measure the DC bus voltage."
    assert gates.check_social_reply(reply, "c") != []


def test_social_reply_gate_does_not_police_identity_questions():
    """A pinned negative control with teeth.

    The help lane reached while a confirmation is pending legitimately asks for
    the manufacturer and model (engine.py:8352). An earlier draft of this gate
    forbade identity demands, which would have failed that reply AND the
    post-reset 'What equipment can I help with?'. Both are correct behaviour.
    """
    assert gates.check_social_reply(HELP_PENDING, "control") == []
    # Teeth: the same reply with a citation stapled on must fire.
    assert gates.check_social_reply(HELP_PENDING + "\n[Source: x]", "c") != []


# ── 4b. turn gate — a wiped session ─────────────────────────────────────────


def test_wiped_session_gate_is_silent_on_the_reset_acknowledgement():
    assert gates.check_wiped_session(RESET_ACK, "control") == []


def test_wiped_session_gate_fires_when_the_pin_survived():
    reply = "We were looking at CE10 on your DURApulse GS10 — the Modbus comm-loss fault."
    assert gates.check_wiped_session(reply, "c") != []


def test_wiped_session_gate_fires_on_a_citation_after_a_wipe():
    reply = "What equipment can I help with? [Source: GS10 manual p.44]"
    assert gates.check_wiped_session(reply, "c") != []


def test_wiped_session_gate_accepts_a_no_context_admission():
    reply = "I don't have any context from before — we're starting fresh."
    assert gates.check_wiped_session(reply, "control") == []
    # Teeth: strip the admission and the identity ask and it must fire.
    assert gates.check_wiped_session("Sure thing.", "c") != []


# ── 4c. turn gate — the help lane needs a POSITIVE clause ───────────────────


def test_help_lane_gate_is_silent_on_the_canned_capability_answer():
    assert gates.check_help_lane(HELP_CANNED, "control") == []
    assert gates.check_help_lane(HELP_PENDING, "control") == []


def test_help_lane_gate_fires_when_the_turn_was_read_as_a_diagnostic_query():
    """The failure the absence-only draft could not see.

    'I can help with your GS10 — what's it doing?' carries no citation, no
    KB-gap footer and no imperative steps, so a gate made only of absence
    clauses passes it — in exactly the case the scenario was written to catch.
    """
    reply = "I can help with your GS10 — what's it doing right now?"
    assert gates.check_help_lane(reply, "c") != []


def test_help_lane_gate_fires_on_a_cited_capability_answer():
    assert gates.check_help_lane(HELP_CANNED + "\n[Source: GS10 manual]", "c") != []


# ── 4d. turn gate — honest low confidence (replaces a pinned template) ──────


def test_honest_low_confidence_gate_is_silent_on_the_proceed_disclaimer():
    assert gates.check_honest_low_confidence(PROCEED_CANNED, "control") == []


def test_honest_low_confidence_gate_accepts_the_other_rendering():
    """engine.py:6608 instructs the LLM to render the same honesty contract in
    its own words. Pinning the literal from engine.py:3016 would fail this."""
    reply = (
        "I don't have verified documentation for your drive, so treat this as "
        "general industrial experience rather than a manual answer: comm-loss "
        "trips usually come from termination or baud mismatch."
    )
    assert gates.check_honest_low_confidence(reply, "control") == []


def test_honest_low_confidence_gate_fires_on_a_confident_uncited_answer():
    reply = "CE10 is a Modbus comm-loss fault. Set P09.03 to 5 seconds and re-land the shield."
    assert gates.check_honest_low_confidence(reply, "c") != []


def test_honest_low_confidence_gate_fires_on_a_citation():
    """A citation on a turn where nothing was retrieved is the tell."""
    reply = PROCEED_CANNED + "\n\n[Source: PowerFlex 525 manual p.12]"
    assert gates.check_honest_low_confidence(reply, "c") != []


# ── 4e. turn gate — history or admission ────────────────────────────────────


def test_history_gate_accepts_a_dated_list():
    assert gates.check_history_or_admission(HISTORY_LIST, "control") == []


def test_history_gate_accepts_a_clean_admission():
    assert gates.check_history_or_admission(HISTORY_NONE, "control") == []


def test_history_gate_fires_on_a_narrated_service_history():
    """The fabrication: dates nobody recorded, from a table nobody queried."""
    reply = (
        "This drive was last serviced in March, when the cooling fan was "
        "replaced, and it threw the same comm fault twice over the summer."
    )
    assert gates.check_history_or_admission(reply, "c") != []


def test_history_gate_fires_when_the_recall_question_is_ignored():
    reply = "Comm-loss faults usually come from a loose shield. Check the termination resistor."
    assert gates.check_history_or_admission(reply, "c") != []


# ── 4f. conversation gate — no fabricated machine state ─────────────────────

LIVE_BLOCK = (
    "[LIVE CONVEYOR STATUS]\nconv_state: RUNNING\nvfd_freq: 45.0 Hz\ndc_bus: 320.4 V\nfault: none"
)


def test_state_gate_is_silent_on_the_deterministic_refusal():
    t = _t(("What is the current state of my garage conveyor?", STATE_REFUSAL))
    assert gates.check_no_fabricated_state(t, "control") == []


def test_state_gate_fires_on_an_invented_condition():
    t = _t(
        (
            "What is the current state of my garage conveyor?",
            "Your garage conveyor is currently running at 45 Hz with no active faults.",
        )
    )
    assert gates.check_no_fabricated_state(t, "c") != []


def test_state_gate_fires_on_an_invented_fault():
    t = _t(("is the line running right now or is it down again?", "The line is stopped on F0004."))
    assert gates.check_no_fabricated_state(t, "c") != []


def test_state_gate_exempts_a_reply_whose_turn_carried_a_live_block():
    """PREDICTED FALSE POSITIVE, pinned as a negative control.

    The tag-query fast path (engine.py:3194) legitimately asserts state when
    the technician's own message carried the live-status header. Without this
    exemption the gate would fail MIRA's most grounded reply in the codebase.
    """
    t = _t(
        (
            LIVE_BLOCK + "\n\nis the conveyor ok?",
            "The conveyor is running at 45.0 Hz, DC bus 320.4 V, no active fault.",
        )
    )
    assert gates.check_no_fabricated_state(t, "control") == []
    # Teeth: the identical reply with no live block supplied must fire.
    t2 = _t(("is the conveyor ok?", "The conveyor is running at 45.0 Hz, no active fault."))
    assert gates.check_no_fabricated_state(t2, "c") != []


def test_state_gate_does_not_flag_mira_quoting_the_technician():
    """FALSE POSITIVE FOUND BY THE CORPUS SWEEP — five of them, unpredicted.

    Swept over 548 local conversations / 1,176 replies the first version of
    this gate fired 5x, and every fire was MIRA echoing the technician's own
    words back: a work-order preview's `Fault:` line ("One of our conveyors is
    running slow"), and the equipment-history bullets, which quote past user
    messages verbatim ("conveyor's down. it's definitely the encoder, right?").

    Quoting is not asserting. Pinned here in the shape the ledger actually
    contains, taken from c1:t3_41_000 and c1:t8_41_004_overconfident.
    """
    wo_preview = (
        "📋 **Work Order Preview (UNS format):**\n"
        "🔧 Asset: (unknown — please specify)\n"
        "Type: CORRECTIVE\nPriority: MEDIUM\n"
        "Fault: One of our conveyors is running slow, what should I check first?\n\n"
        "Log this work order to the CMMS? (yes/no)"
    )
    history_echo = (
        "Last 5 interactions for this equipment:\n\n"
        "• 2026-08-07 21:28 — AWAITING_UNS_CONFIRMATION — \"conveyor's down. "
        "it's definitely the encoder, right?\""
    )
    for reply in (wo_preview, history_echo):
        t = _t(("log a work order for it", reply))
        assert gates.check_no_fabricated_state(t, "control") == [], reply[:60]

    # Teeth: the same claim made in MIRA's own voice must still fire.
    asserted = _t(("log a work order for it", "One of our conveyors is running slow right now."))
    assert gates.check_no_fabricated_state(asserted, "c") != []


def test_fault_code_gate_does_not_flag_a_code_quoted_from_history():
    """The same false positive, in the other gate.

    c3:t8_41_000_novice — the history render quotes a past technician message
    containing F004, which no technician turn in THIS transcript supplied and
    which carries no citation. Echoed text is not an introduced code.
    """
    history_echo = (
        "Last 5 interactions for this equipment:\n\n"
        '• 2026-08-08 13:09 — DIAGNOSIS — "my drive is showing F004, it\'s a DURApulse GS10"'
    )
    t = _t(("what happened with this drive before?", history_echo))
    assert gates.check_no_fabricated_fault_code(t, "control") == []
    # Teeth: unquote it and the gate must fire.
    t2 = _t(("what happened with this drive before?", "It was throwing F004 all last week."))
    assert gates.check_no_fabricated_fault_code(t2, "c") != []


def test_state_gate_is_silent_when_mira_asks_which_machine():
    t = _t(("is the line running right now?", "Which line are you at — what's the asset tag?"))
    assert gates.check_no_fabricated_state(t, "control") == []


# ── 4g. conversation gate — no fabricated fault code ────────────────────────


def test_fault_code_gate_fires_on_a_code_the_technician_never_typed():
    """The historical defect: the vector query tokenised "I don't" into IDON."""
    t = _t(
        ("My conveyor keeps stopping randomly", "What kind of conveyor, and what's it showing?"),
        (
            "I don't know, I was just given the new one to put in",
            "IDON indicates a communication timeout on the drive interface.",
        ),
    )
    v = gates.check_no_fabricated_fault_code(t, "c")
    assert v and "IDON" in str(v[0])


def test_fault_code_gate_is_silent_when_the_technician_supplied_the_code():
    t = _t(
        (
            "What does F004 mean on a PowerFlex 525?",
            "F004 means an undervoltage trip on the PowerFlex 525.",
        )
    )
    assert gates.check_no_fabricated_fault_code(t, "control") == []


def test_fault_code_gate_tolerates_punctuation_drift_in_the_technicians_token():
    t = _t(("my drive shows F-004", "F004 is an undervoltage fault on that family."))
    assert gates.check_no_fabricated_fault_code(t, "control") == []


def test_fault_code_gate_is_silent_when_the_code_is_cited():
    t = _t(
        (
            "my drive keeps tripping",
            "CE10 is the Modbus comm-loss fault. [Source: GS10 User Manual p.44]",
        )
    )
    assert gates.check_no_fabricated_fault_code(t, "control") == []


def test_fault_code_gate_is_silent_on_the_help_lanes_illustrative_codes():
    """PREDICTED FALSE POSITIVE, pinned.

    The canned help lane offers "a fault code like 'OC' or 'F-201'" as
    examples. Neither was typed by the technician and the reply carries no
    citation, so a naive gate flags MIRA's own capability statement.
    """
    t = _t(("what can you do?", HELP_CANNED))
    assert gates.check_no_fabricated_fault_code(t, "control") == []
    # Teeth: drop the "like" frame and assert the same token and it must fire.
    t2 = _t(("what can you do?", "Your drive is showing F-201, an overcurrent trip."))
    assert gates.check_no_fabricated_fault_code(t2, "c") != []


def test_fault_code_gate_does_not_fire_on_ordinary_acronyms():
    t = _t(
        ("what's a VFD?", "A VFD is a variable frequency drive; the PLC commands it over Modbus.")
    )
    assert gates.check_no_fabricated_fault_code(t, "control") == []


# ── 4h. conversation gate — no option reprompt ──────────────────────────────


def test_option_gate_fires_when_the_same_list_comes_back():
    t = _t(
        ("the motor on the mixer sounds off lately", "What kind of mixer, and what's it doing?"),
        ("it's an unlabelled gearmotor, no nameplate left", OPTION_LIST),
        ("2", OPTION_LIST),
    )
    assert gates.check_no_option_reprompt(t, "c") != []


def test_option_gate_fires_when_mira_asks_what_the_number_meant():
    t = _t(
        ("it's an unlabelled gearmotor, no nameplate left", OPTION_LIST),
        ("2", "Sorry — what did you mean by 2?"),
    )
    assert gates.check_no_option_reprompt(t, "c") != []


def test_option_gate_is_silent_when_the_selection_was_expanded():
    t = _t(
        ("it's an unlabelled gearmotor, no nameplate left", OPTION_LIST),
        (
            "2",
            "Tracing the leads back to the starter: read the overload heater "
            "rating stamped on the block, that gives you FLA.",
        ),
    )
    assert gates.check_no_option_reprompt(t, "control") == []


def test_option_gate_ignores_conversations_with_no_selection():
    t = _t(("my conveyor keeps stopping", "What kind of conveyor?"))
    assert gates.check_no_option_reprompt(t, "control") == []


# ── 5. preconditions — the third verdict state ──────────────────────────────


def test_numbered_list_precondition_distinguishes_exercised_from_not():
    offered = _t(("no nameplate left", OPTION_LIST), ("2", "Trace the leads back to the starter."))
    assert gates.resolve_precondition("numbered_list_offered")(offered) is True
    missing = _t(("no nameplate left", "Send me a photo of the drive."), ("2", "Two what?"))
    assert gates.resolve_precondition("numbered_list_offered")(missing) is False


def test_cancel_precondition_is_false_when_no_lane_acknowledges_the_drop():
    """With MIRA_USE_DST=0 there is no cancel/skip/back lane outside
    MANUAL_LOOKUP_GATHERING, so this precondition is expected to be False on a
    live run — which is the documented gap, recorded as INCONCLUSIVE rather
    than reported green."""
    not_acked = _t(("cancel that, stop - go back", "Undervoltage trips come from a sagging line."))
    assert gates.resolve_precondition("cancel_acknowledged")(not_acked) is False
    acked = _t(("cancel that, stop - go back", "No problem — I've set that aside. What next?"))
    assert gates.resolve_precondition("cancel_acknowledged")(acked) is True


def test_scenarios_that_cannot_fail_declare_a_precondition():
    """A green cell that means 'we could not tell' is worse than no scenario.

    The option-selection scenario depends on a non-deterministic LLM clarifier
    emitting a numbered list, and the cancel scenario exists to document a hole
    whose gates pass on the fall-through. Both must be able to report
    INCONCLUSIVE.
    """
    by_id = {sc["id"]: sc for sc in session_control.generate(41, 0)}
    for key in ("numbered_option_selection", "cancel_lane_documented_gap"):
        sc = next(s for i, s in by_id.items() if i.endswith(key))
        assert sc.get("precondition"), f"{sc['id']} can report green without exercising anything"


def test_grade_reports_inconclusive_when_the_precondition_did_not_hold():
    sc = next(
        s for s in session_control.generate(41, 0) if s["id"].endswith("numbered_option_selection")
    )
    never_offered = _t(
        ("the motor on the mixer sounds off lately", "What kind of mixer?"),
        ("it's an unlabelled gearmotor, no nameplate left", "Send me a photo of the drive."),
        ("2", "Two what?"),
    )
    verdict, notes = session_control.grade_conversation(sc, never_offered, turn_ok=True)
    assert verdict == "INCONCLUSIVE"
    assert notes


def test_grade_reports_fail_when_a_conversation_gate_fires():
    sc = next(
        s for s in session_control.generate(41, 0) if s["id"].endswith("numbered_option_selection")
    )
    reprompted = _t(
        ("it's an unlabelled gearmotor, no nameplate left", OPTION_LIST),
        ("2", OPTION_LIST),
    )
    verdict, _ = session_control.grade_conversation(sc, reprompted, turn_ok=True)
    assert verdict == "FAIL"


def test_grade_reports_pass_when_the_capability_worked():
    sc = next(
        s for s in session_control.generate(41, 0) if s["id"].endswith("numbered_option_selection")
    )
    good = _t(
        ("it's an unlabelled gearmotor, no nameplate left", OPTION_LIST),
        ("2", "Trace the leads back to the starter and read the overload rating."),
    )
    verdict, _ = session_control.grade_conversation(sc, good, turn_ok=True)
    assert verdict == "PASS"


def test_a_failed_turn_grade_still_fails_the_conversation():
    sc = next(s for s in session_control.generate(41, 0) if s["id"].endswith("thanks_holds_thread"))
    verdict, _ = session_control.grade_conversation(
        sc, _t(("thanks", THANKS_PINNED)), turn_ok=False
    )
    assert verdict == "FAIL"


# ── 6. corpus sweep — every gate false-positives on first contact ───────────


def _ledger_conversations() -> dict[str, list[dict]]:
    """Every recorded conversation across every local ledger, as transcripts."""
    convs: dict[str, list[dict]] = {}
    for path in sorted(ledger.LEDGER_DIR.glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("kind") != "turn" or rec.get("role") not in ("tech", "mira"):
                continue
            convs.setdefault(f"{path.stem}:{rec.get('conv')}", []).append(
                dict(role=rec["role"], text=rec.get("text") or "")
            )
    return convs


def test_new_conversation_gates_survive_the_local_corpus():
    """Ledgers are gitignored and local-only, so this skips in CI.

    Where they exist it is the only evidence that matters: three separate gates
    in this program false-positived the first time they met real data, and so
    did these — six fires over 548 conversations, all of them MIRA quoting the
    technician (see the two pinned negative controls above). Any fire here is
    either a real defect worth reporting or an unpinned false positive worth
    fixing, never something to absorb by raising the ceiling, so the assertion
    prints what it found.

    Only CONVERSATION gates are swept. The turn gates are scenario-scoped —
    `help_lane` grades a reply to "what can you do?" and nothing else — so
    running them over every reply in the corpus measures nothing.
    """
    if not ledger.LEDGER_DIR.exists():
        pytest.skip("ledgers are gitignored and local-only")
    convs = _ledger_conversations()
    if not convs:
        pytest.skip("no ledger conversations found")

    fires: dict[str, list[str]] = {}
    for name in session_control.CORPUS_SWEEP_BASELINE:
        gate = gates.resolve_conversation_gate(name)
        for conv_id, transcript in convs.items():
            for v in gate(transcript, conv_id):
                fires.setdefault(name, []).append(str(v))

    known = session_control.CORPUS_SWEEP_BASELINE
    for name, found in fires.items():
        assert len(found) <= known.get(name, 0), (
            f"{name} fired {len(found)}x on the corpus (baseline {known.get(name, 0)}):\n"
            + "\n".join(found[:10])
        )


def test_a_zero_fire_sweep_is_not_a_broken_gate():
    """The corpus baseline is 0 — prove that is silence, not blindness.

    A gate that fires 0 times because it cannot fire is the campaign's own
    'check that cannot fail' failure class. Both swept gates are therefore
    mutated into the defect shape here, using the exact renderings the ledger
    contains, and must fire.
    """
    assert set(session_control.CORPUS_SWEEP_BASELINE.values()) == {0}, (
        "baseline is no longer zero — re-run the sweep and triage every fire"
    )
    fabricated = _t(("what's my conveyor doing?", "Your conveyor is currently running at 45 Hz."))
    assert gates.check_no_fabricated_state(fabricated, "mutation") != []
    invented = _t(("what happened before?", "It was throwing F004 all last week."))
    assert gates.check_no_fabricated_fault_code(invented, "mutation") != []
