"""Tier 6 — UNS gate DEPTH: what happens AFTER the first identity prompt.

Tier 1 grades that the gate FIRES. Nothing grades what happens next, and
everything expensive lives next. Every scenario here exists because of a live
UAT defect this program already paid for:

  CON-003   "thanks" silently consumed the pending confirmation, and the next
            real answer was handled as a cold start.
  CON-004   the identical prompt replayed word-for-word when the technician
            CHALLENGED the guess (campaign c8, conversation t8_41_002).
  CON-004c  the same no-candidate demand repeated turn after turn against the
            experienced and impatient personas (#3157 / #3158).
  D2        a technician who physically cannot read a worn nameplate, stonewalled
            forever by a gate whose entire justification is protecting them.
  CTX-005   MIRA discarding a real answer to re-demand a fault code supplied two
            turns earlier — defect A behind #3160, the unfixed half of #3156.

The unifying failure mode is a LOOP, and a loop is only visible ACROSS turns.
Hence the `conv_gates` list on a scenario: conversation-scoped gates that read
the whole transcript, applied by the runner after the last turn. They are NOT
interchangeable with turn gates — a turn gate takes `(reply, case_id)`, a
conversation gate takes a transcript, and registering one where the other
belongs fails mid-campaign after live Telegram traffic has already been spent.

Grading discipline inherited from the tiers before this one:

  * Behaviour, not vocabulary. The contracts live in `campaign/gates.py` as
    deterministic gate functions; the one place an `expect` list appears, the
    token is the TECHNICIAN'S OWN word from an earlier turn ("F004", "CE10",
    "PowerFlex"), because a correct adoption must name what it adopted.
  * Every `expect` list here is a single anchor. `uat_driver.grade_turn` matches
    ANY, not ALL, so a two-token list would silently grade as one.
  * Every turn asserts something. A turn with no gate, no expect and no forbid
    spends a live Telegram round-trip to buy a guaranteed PASS.

Wire-only, text-only, read-only: nothing here inspects engine internals,
dispatch kind, retrieved chunks or DB state, because the Telethon lane cannot
see them at grade time.
"""

from __future__ import annotations

# Each scenario: (name, capability_id, why, conv_gates, turns).
#
# `why` is the reason the scenario exists — kept in the data, not a comment, so
# a future reader can argue with the classification instead of guessing at it.
SCENARIOS: tuple[tuple, ...] = (
    (
        "confirm_yes_adopts_and_advances",
        "uns_confirm_yes_no",
        "A confirmed candidate must be PINNED and the conversation must advance. "
        "The failure is 'yes' classified as a greeting or an ambiguous non-answer: "
        "the confirmation handler never runs, the gate re-fires, and the "
        "technician is asked to confirm the thing they just confirmed — the loop "
        "in its shortest possible form.",
        ("identity_ask_varies",),
        [
            dict(send="my powerflex 525 keeps tripping", gate="identifying_question"),
            # "PowerFlex" is the technician's own word from turn 1. A correct
            # adoption names what it adopted; the gate decides whether MIRA
            # actually moved on or re-fired the identity ask.
            dict(send="yes", expect=["PowerFlex"], gate="moves_past_identity"),
        ],
    ),
    (
        "confirm_no_reasks_correctly",
        "uns_confirm_yes_no",
        "Here the identifying-question gate expresses the CORRECT behaviour "
        "rather than the defect: a 'no' MUST produce another identifying "
        "question. Its absence means MIRA started troubleshooting a machine the "
        "technician had just told it was wrong — the worst way to lose the gate, "
        "because the technician explicitly said no.",
        (),
        [
            dict(
                send="my drive keeps faulting and I can't clear it",
                gate="identifying_question",
            ),
            dict(send="no", gate="identifying_question"),
        ],
    ),
    (
        "con003_thanks_does_not_consume_gate",
        "uns_confirm_conversational_hold",
        "CON-003. An acknowledgement is not an answer. The contract is the SAME "
        "gate on turn 2: a reply that acknowledges the thanks AND restates the "
        "pending ask passes; one that drops the ask fails. Turn 3 then proves the "
        "session did not have to start over. The conversation gate is declared on "
        "purpose: restating is required, but restating VERBATIM is the loop, and "
        "an acknowledgement is what makes the restatement a different reply.",
        ("identity_ask_varies",),
        [
            dict(send="My conveyor keeps stopping randomly", gate="identifying_question"),
            dict(send="thanks", gate="identifying_question"),
            dict(
                send="ok it's a DURApulse GS10 and it shows CE10",
                expect=["CE10"],
                gate="moves_past_identity",
            ),
        ],
    ),
    (
        "con004_challenge_gets_provenance",
        "uns_confirm_reword_provenance",
        "CON-004, recorded live in campaign c8 t8_41_002: the technician "
        "challenged the guess and got the identical prompt back, word for word. "
        "Byte-similarity between two consecutive identity asks is computable from "
        "the transcript alone, so this needs no judge — and no in-engine repeat "
        "guard can catch it, because this lane never passes through the "
        "correction path that hosts CTX-004.",
        ("identity_ask_varies",),
        [
            dict(
                send="the rockwell drive on line 3 is acting up again",
                gate="identifying_question",
            ),
            dict(
                send="How do you know it's that? Earlier we were talking about a GS10.",
                gate="identifying_question",
            ),
        ],
    ),
    (
        "con004c_second_ask_offers_other_routes",
        "uns_confirm_no_candidate_escalation",
        "CON-004c, #3157 / #3158 — the experienced and impatient personas were "
        "handed the same no-candidate demand turn after turn. Re-asking is "
        "allowed; re-asking THE SAME WAY is asking the same question twice and "
        "expecting a different answer. The second ask should change shape: admit "
        "it cannot tell, refuse to guess, and offer three routes to the same fact "
        "(photo, make and model, asset tag).",
        ("identity_ask_varies",),
        [
            dict(send="something is wrong with a machine", gate="identifying_question"),
            dict(send="it's still broken", gate="identifying_question"),
        ],
    ),
    (
        "d2_symptom_first_after_exhaustion",
        "uns_gate_symptom_first",
        "D2. A technician who physically cannot supply what MIRA wants must not "
        "be stonewalled. As soon as they say the nameplate is unreadable, MIRA "
        "should announce degraded mode ONCE, drop the identity demand, and work "
        "the symptom at lower confidence. A third identity demand is the worst "
        "outcome of a gate whose entire justification is that it protects the "
        "person now stuck behind it.",
        ("identity_ask_varies",),
        [
            dict(send="my drive keeps tripping", gate="identifying_question"),
            dict(
                send="I can't read the nameplate, it's worn off",
                gate="moves_past_identity",
            ),
            dict(
                send="it still trips as soon as I hit start",
                gate="moves_past_identity",
            ),
        ],
    ),
    (
        "ctx005_never_reask_supplied_fault",
        "self_critique_ctx005_suppression",
        "CTX-005 — defect A behind #3160 and the unfixed half of #3156. The "
        "technician typed F004 in turn 1; any later turn asking what fault code "
        "the equipment is showing discards a real answer to re-demand supplied "
        "information. The vendor half of the same failure is covered by the "
        "existing reasks_supplied_info gate, declared here alongside it.",
        ("no_refault_ask", "reasks_supplied_info"),
        [
            dict(send="PowerFlex 525 showing F004", expect=["F004"]),
            dict(send="How do I reset it?", expect=["reset"]),
            dict(
                send="and what would cause it to come back?",
                gate="citation_or_gap",
            ),
        ],
    ),
    (
        "q_trap_commits_to_assessment",
        "fsm_q_trap_commit",
        "The Q-trap. A technician who answers three questions and gets a fourth "
        "has been failed regardless of how well each question reads — it is the "
        "most common reason a tool gets abandoned mid-shift. By turn 5 MIRA has "
        "the machine, the symptom and the speed dependence; it must force-commit "
        "to a likely cause and a next check. A reply that is nothing but "
        "questions asserts nothing.",
        ("identity_ask_varies", "repeated_answer"),
        [
            dict(send="the gearbox on line 2 is making noise", gate="identifying_question"),
            # From here the machine is named, so a reply that is SOLELY another
            # identity demand is the loop, not progress.
            dict(send="it's a SEW Eurodrive gearmotor", gate="moves_past_identity"),
            dict(send="just a whine, no fault code anywhere", gate="moves_past_identity"),
            dict(send="same whine at every speed", gate="moves_past_identity"),
            dict(send="so what do you think it is?", gate="commits_to_assessment"),
        ],
    ),
    (
        "manual_gathering_explicit_escape",
        "manual_lookup_gathering_state",
        "The manual-lookup subroutine advertises its own escape hatch — 'You can "
        "also say back to troubleshooting anytime' — in the same breath as the "
        "slot it is filling. A subroutine that prints an escape hint and then "
        "ignores it traps the technician inside it. The forbidden string is the "
        "gathering state's own model-number demand.",
        (),
        [
            dict(send="I need the manual for the safety relay", gate="identifying_question"),
            dict(
                send="back to troubleshooting",
                forbid=["exact model number"],
                gate="moves_past_identity",
            ),
        ],
    ),
    (
        "manual_gathering_fault_escape",
        "manual_lookup_gathering_state",
        "The same subroutine, escaped implicitly. A fault description should drop "
        "the manual search silently — and F004 is the technician's own token, so "
        "it must be engaged. Asking for the exact model number of a safety relay "
        "while the technician is standing in front of a faulted drive is the "
        "defect, verbatim.",
        (),
        [
            dict(send="I need the manual for the safety relay", gate="identifying_question"),
            dict(
                send="actually forget it, it's throwing F004 on a PowerFlex 525 right now",
                expect=["F004"],
                forbid=["exact model number"],
                gate="moves_past_identity",
            ),
        ],
    ),
)


def generate(seed: int, count: int = 0) -> list[dict]:
    """Campaign-runner scenarios (tier 6).

    Same shape as tier 1/2 so the existing runner drives it unchanged:
    `id` / `contract` / `seed` / `turns`, plus `conv_gates` for the
    conversation-scoped contracts and `capability_id` for the scorecard.

    `count` SLICES (like tier 9) rather than cycling modulo the template list.
    Cycling would re-send the same live turns under different ids and report the
    duplicates as independent evidence; `--count 20` against ten scenarios runs
    ten, not twenty. Ids are seed-scoped because the ledger resumes on conv id —
    an unseeded id from a second seed would be skipped as "already done".
    """
    scenarios = SCENARIOS if not count else SCENARIOS[:count]
    out: list[dict] = []
    for i, (name, capability_id, why, conv_gates, turns) in enumerate(scenarios):
        out.append(
            dict(
                id=f"t6_s{seed}_{i:03d}_{name}",
                contract=f"Tier6 UNS-gate depth ({capability_id})",
                seed=seed,
                capability_id=capability_id,
                why=why,
                conv_gates=list(conv_gates),
                # Copy each turn so a caller cannot mutate the module-level
                # template, and carry EVERY declared key — a generator that
                # rebuilds turns from an allow-list of three keys is how tier 1
                # silently dropped its behavioural gate.
                turns=[dict(t) for t in turns],
            )
        )
    return out
