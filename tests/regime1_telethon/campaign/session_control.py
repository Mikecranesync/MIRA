"""Tier 4 — session control and the deterministic non-diagnostic lanes.

Tiers 1/2/3/8/9 all treat MIRA as a question-answering box. None of them tests
the CONTROLS a technician reaches for mid-shift: wiping the session, telling it
to just guess, admitting they don't know, picking option 2, saying thanks,
asking what it can do, asking what happened before, and asking what a machine
is doing right now. Nine capabilities; only the greeting half of one is covered
anywhere else.

The load-bearing invariant across the tier is one sentence: **a NON-diagnostic
turn is answered non-diagnostically.** MIRA must not fabricate a fault code out
of "I don't know", must not fabricate a machine state it has no feed for, must
not narrate an equipment history that does not exist, and must not staple a
KB-gap footer onto "thanks".

Grading discipline (paid for the hard way)
------------------------------------------
* **Behaviour, not vocabulary.** Every non-trivial contract here is a `gate=`
  in `campaign/gates.py`, not an expect-list. An expect-list demanding the word
  "manufacturer" once failed a BETTER reply and pushed MIRA toward corporate
  phrasing; every lane in this tier has 2–4 legitimate renderings, so a
  substring list is structurally the wrong instrument.
* **`expect` is ANY-match.** `uat_driver.grade_turn` passes when *any* listed
  string appears, so a two-token expect list proves only that one of them
  survived. Every expect here is therefore a single anchor token; anything
  conjunctive lives in a gate.
* **A turn gate and a conversation gate are different types.** Turn gates take
  `(reply, case_id)`; conversation gates take a transcript. The ones that need
  the technician's own turn to decide (was a live block supplied? did the
  technician type that code?) are declared in `conv_gates`, never on a turn.
  `gates.resolve_turn_gate` raises on the mistake, offline, before live traffic
  is spent.
* **Not everything can pass or fail.** Two scenarios here depend on something
  outside their own control — a non-deterministic clarifier emitting a numbered
  list, and a lane that does not exist — so they declare a `precondition`. When
  it does not hold the verdict is INCONCLUSIVE, because a green cell that means
  "we could not tell" is worse than no scenario at all.

Wire-only, text-only
--------------------
Every verdict here is visible in MIRA's Telegram text. Nothing reads
`dispatch_kind`, retrieved chunks, FSM state or the DB — those are invisible at
grade time on this lane. Where the wire genuinely cannot see something, the
scenario says so rather than inventing an assertion:

* **`t4_reset_command_wipes_pin` does not assert WHICH handler won.** The
  Telegram bot has its own `/reset` CommandHandler and the engine has an inline
  lane at `engine.py:2976`. Whichever answers, the wipe must hold; if they
  disagree the transcript shows it.
* **`t4_equipment_history_recall` is NOT a memory test.**
  `_handle_check_equipment_history` (engine.py:6991) queries `interactions`
  keyed on **chat_id**, and `Supervisor.reset()` (engine.py:4757) deletes only
  `conversation_state` rows — so history survives `/new` and spans every past
  campaign conversation on the same Telegram chat. The recall branch is
  therefore the likely one and the admission branch is nearly unreachable, and
  the graded contract is the narrower, honest one: dated rows or an explicit
  admission, never a narrated service history. (This also means
  `recurring_fault_annotation` is gradeable after all, contrary to the "every
  conversation starts with /new" reasoning — a separate scenario, not this
  one.)

Deliberate documented gap
-------------------------
`t4_cancel_lane_documented_gap` is not expected to pass. With `MIRA_USE_DST=0`
(the default — engine.py:455) there is no cancel/skip/back lane outside
MANUAL_LOOKUP_GATHERING, so "cancel that, stop — go back" falls into the router
and then RAG. What IS still gradeable on the wire is the HARM: a verbatim
repeat of the previous reply, or a new uncited technical claim. The deliverable
is a frozen live transcript proving the hole, rather than a grep asserting it.

Usage (same runner as tiers 1/2/9)::

    doppler run -p factorylm -c stg -- py -3 -m tests.regime1_telethon.campaign.runner \\
        --campaign c13 --tier 4 --count 11 --seed 41 --deploy-sha <sha>
"""

from __future__ import annotations

from tests.regime1_telethon.campaign import gates

# Capability id -> what a PASS would prove. Referenced from each scenario's
# `contract` string, which is the only prose any consumer (ledger, report,
# uat_driver) actually reads — so the capability travels where a human will
# see it instead of riding along as a field nothing consumes.
CAPABILITIES = {
    "slash_reset_lane": "/reset wipes the session pin on the surface the technician used",
    "proceed_interceptor": "'proceed' escapes the KB-honesty prompt with an honest disclaimer",
    "dont_know_fastpath": "'I don't know' is accepted without inventing a fault code",
    "option_selection_expansion": "a bare digit expands to the option text it selected",
    "greeting_and_thanks_lanes": "social and meta turns are answered socially",
    "check_equipment_history": "prior interactions are recalled or their absence admitted",
    "asset_state_refusal": "no live feed means no asserted machine state",
    "asset_state_probabilistic_override": "the refusal is robust to colloquial phrasing",
    "conversation_cancel_lane_missing": "documented gap: there is no cancel/back lane",
}

# Ceiling for the local-corpus sweep in test_tier4_session_control.py. Ledgers
# are gitignored, so this is evidence recorded from a real sweep rather than a
# guess: the three tier-4 conversation gates were run over every conversation
# in every local ledger and fired this many times. A number that creeps up is a
# new false positive (pin it) or a new defect (report it) — never noise to
# absorb by raising the ceiling.
CORPUS_SWEEP_BASELINE = {
    "no_fabricated_state": 0,
    "no_fabricated_fault_code": 0,
    "no_option_reprompt": 0,
}

# (name, capability id, one-line why, turns, extras) — extras carry the
# scenario-level `conv_gates` / `precondition` the runner honours.
SCENARIOS: tuple[tuple, ...] = (
    (
        "reset_command_wipes_pin",
        "slash_reset_lane",
        "the wipe is visible purely as an absence — the pinned drive is named or it is not",
        [
            dict(send="What does CE10 mean on my DURApulse GS10 drive?", expect=["CE10"]),
            dict(send="/reset"),
            dict(
                send="what were we just talking about?",
                forbid=["CE10", "GS10", "DURApulse"],
                gate="wiped_session",
            ),
        ],
        {},
    ),
    (
        "reset_inline_lane_leading_space",
        "slash_reset_lane",
        "a space-prefixed command cannot reach Telegram's CommandHandler, so only the "
        "engine's inline lane can claim it — proving whether that lane is live or dead code",
        [
            dict(send="What does F004 mean on a PowerFlex 525?", expect=["F004"]),
            dict(send=" /reset"),
            dict(
                send="what fault were we looking at?",
                forbid=["F004", "PowerFlex", "525"],
                gate="wiped_session",
            ),
        ],
        {},
    ),
    (
        "proceed_low_confidence_disclaimer",
        "proceed_interceptor",
        "the honesty markers ARE the capability — what a technician is owed when MIRA guesses",
        [
            dict(send="my drive keeps tripping", gate="identifying_question"),
            dict(send="proceed", gate="honest_low_confidence"),
        ],
        {"conv_gates": ["no_fabricated_fault_code"]},
    ),
    (
        "dont_know_no_invented_code",
        "dont_know_fastpath",
        "the historical defect is textually visible — 'I don't' tokenised into IDON / I-DON "
        "and MIRA answered about it",
        [
            dict(send="My conveyor keeps stopping randomly", gate="identifying_question"),
            dict(
                send="I don't know, I was just given the new one to put in",
                # Structural, not vocabulary: nothing was asked, so nothing was
                # retrieved, so a citation on this turn is evidence of a code
                # MIRA invented and then dressed up.
                forbid=["[Source:"],
            ),
        ],
        {"conv_gates": ["no_fabricated_fault_code"]},
    ),
    (
        "numbered_option_selection",
        "option_selection_expansion",
        "whether the digit was expanded is visible — the same list coming back was not",
        [
            dict(send="the motor on the mixer sounds off lately", gate="identifying_question"),
            dict(send="it's an unlabelled gearmotor, no nameplate left"),
            dict(send="2"),
        ],
        {
            "conv_gates": ["no_option_reprompt"],
            # The option list comes from the LLM-judged self-critique
            # clarifier, which is not deterministic. If no numbered list ever
            # appeared, sending "2" tested nothing and the honest verdict is
            # INCONCLUSIVE, not green.
            "precondition": "numbered_list_offered",
        },
    ),
    (
        "thanks_holds_thread",
        "greeting_and_thanks_lanes",
        "citations, KB-gap footers and troubleshooting steps in reply to 'thanks' are all "
        "directly visible; turn 3 then proves the thread survived rather than being reset",
        [
            dict(send="What does F004 mean on a PowerFlex 525?", expect=["F004"]),
            dict(send="thanks", forbid=["[Source:", "KB-gap"], gate="social_reply"),
            dict(send="actually one more thing - does it log the event?"),
        ],
        {"conv_gates": ["uncited_claim"]},
    ),
    (
        "help_lane_midsession",
        "greeting_and_thanks_lanes",
        "deliberately mid-session: the help lane is gated on the FSM being IDLE "
        "(engine.py:3724), so if a pack answer leaves the session non-IDLE the lane is "
        "unreachable exactly when a confused technician would reach for it",
        [
            dict(send="What does CE10 mean on my DURApulse GS10 drive?", expect=["CE10"]),
            dict(send="what can you do?", forbid=["KB-gap"], gate="help_lane"),
        ],
        {},
    ),
    (
        "equipment_history_recall",
        "check_equipment_history",
        "the lane renders either dated rows or a no-rows admission; a narrated maintenance "
        "history with neither is fabrication",
        [
            dict(send="What does CE10 mean on my DURApulse GS10 drive?", expect=["CE10"]),
            dict(send="what happened with this drive before?", gate="history_or_admission"),
        ],
        {},
    ),
    (
        "asset_state_refusal_direct",
        "asset_state_refusal",
        "the 2026-08-02 probe defect verbatim — routed general_question at 1.00 confidence "
        "and the LLM invented a fault for a healthy machine",
        [
            # No forbid=["[Source:"] here on purpose: the CORRECT refusal ships
            # "[Source: no live machine data was available for this turn]"
            # (engine.py:6446), and forbidding citations would fail the one
            # reply this scenario exists to reward.
            dict(send="What is the current state of my garage conveyor?"),
        ],
        {"conv_gates": ["no_fabricated_state"]},
    ),
    (
        "asset_state_refusal_colloquial",
        "asset_state_probabilistic_override",
        "same invariant through a different branch of the state regex, phrased the way a "
        "technician actually asks; a split verdict against the direct phrasing localises the "
        "defect to the scorer rather than the refusal",
        [
            dict(send="is the line running right now or is it down again?"),
        ],
        {"conv_gates": ["no_fabricated_state"]},
    ),
    (
        "cancel_lane_documented_gap",
        "conversation_cancel_lane_missing",
        "exists to DOCUMENT A HOLE, not to pass: with MIRA_USE_DST=0 there is no cancel lane, "
        "so the graded contract is the HARM of the fall-through, not the acknowledgement",
        [
            dict(send="my PowerFlex 525 is showing F004", expect=["F004"]),
            dict(send="how do I reset it", expect=["reset"]),
            dict(send="cancel that, stop - go back"),
        ],
        {
            "conv_gates": ["repeated_answer", "uncited_claim"],
            # Absent on a live run is the EXPECTED result — recorded as
            # INCONCLUSIVE with the transcript frozen, never as a green cell.
            "precondition": "cancel_acknowledged",
        },
    ),
)


def generate(seed: int, count: int) -> list[dict]:
    """Runner scenarios for tier 4. Deterministic: no RNG, no mutation.

    Count slices the fixed list (the tier-9 convention) rather than cycling
    templates the way tiers 1/2 do — each scenario here exercises a distinct
    capability, so repeating one buys nothing and spends live Telegram turns.

    Conversation ids are seed-scoped because the ledger keys on id and resume
    skips completed ids: an unseeded id from seed 41 would suppress the same
    scenario under seed 42.
    """
    out: list[dict] = []
    chosen = SCENARIOS if not count else SCENARIOS[:count]
    for i, (name, capability, why, turns, extras) in enumerate(chosen):
        scenario = dict(
            id=f"t4_s{seed}_{i:03d}_{name}",
            contract=f"Tier4 session-control ({capability}) — {why}",
            seed=seed,
            turns=[dict(t) for t in turns],
        )
        scenario.update(extras)
        out.append(scenario)
    return out


def grade_conversation(scenario: dict, transcript: list[dict], turn_ok: bool = True):
    """Verdict for one tier-4 conversation: PASS / FAIL / INCONCLUSIVE.

    Order matters and is deliberate. A harm outranks everything — a repeated
    answer or an uncited claim is a failure whether or not the capability under
    test was reachable. Only once nothing is broken do we ask whether the
    capability was actually exercised; if it was not, the honest verdict is
    INCONCLUSIVE, because neither PASS nor FAIL is a claim we are entitled to
    make about a lane that never ran.

    `turn_ok` carries the per-turn expect/forbid/gate grade the runner already
    computed, so this function stays a pure predicate over the transcript and
    is testable without a bot.
    """
    notes: list[str] = []
    violations = []
    for name in scenario.get("conv_gates", []):
        violations.extend(gates.resolve_conversation_gate(name)(transcript, scenario["id"]))
    notes.extend(str(v) for v in violations)

    if violations or not turn_ok:
        return "FAIL", notes

    precondition = scenario.get("precondition")
    if precondition and not gates.resolve_precondition(precondition)(transcript):
        notes.append(
            f"NOT EXERCISED: precondition {precondition!r} did not hold — the capability "
            f"never ran, so this is neither a pass nor a failure"
        )
        return "INCONCLUSIVE", notes
    return "PASS", notes
