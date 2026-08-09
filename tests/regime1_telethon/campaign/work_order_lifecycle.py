"""Tier 5 — work-order and CMMS action lifecycle.

MIRA's only WRITE surface, and it has never been driven live. Six capabilities
that no single-turn tier can reach compose into a small state machine: an
imperative request arms a draft, the NEXT turn is consumed by the pending
handler (yes / no / a field edit / unrecognised input), a fresh diagnostic
question must ESCAPE that handler rather than be eaten by it, and a completed
work order may arm a second pending lane for a preventive-maintenance
follow-up.

Two invariants carry the tier.

1. **MIRA never claims an action it did not perform.** No "work order created"
   without an identifier, no "added to documentation" with nothing to add, no
   "PM scheduled" when the CMMS call failed. Graded by
   `gates.check_no_unbacked_action_claim`, which encodes the conditional a
   forbid-list cannot express: a completed-write claim is allowed only when the
   same reply carries an identifier or admits the action failed.
2. **The auto-WO offer stays SCOPED.** It used to fire after every single
   diagnosis, uninvited. `t5_..._auto_wo_offer_stays_scoped` is a one-turn
   documentation lookup that must NOT draw an offer — a real negative control
   with a literal string (`engine.py:4422`) whose presence is the regression.

⚠️ **This tier writes real rows to the staging Atlas CMMS.** Staging only, and
expect residue: `t5_..._pm_followup_acceptance` confirms a work order on
purpose. Nothing here may ever be pointed at production.

Ordering and state hygiene
--------------------------
Tier 5 is the only tier that deliberately leaves `cmms_pending` /
`cmms_wo_draft` armed at the end of a conversation (the unrecognised-input
scenario ends with a live draft by design). That raised a contamination
question, and the answer was VERIFIED rather than assumed:
`runner.scripted_conversation` sends `/new` before every scenario, the Telegram
`/new` handler calls `Supervisor.reset()`, and `reset()` DELETEs the
`conversation_state` row outright — so no draft can survive into the next
scenario's first turn. Pinned by
`test_tier5_work_order_lifecycle.py::TestNewCommandDisarmsTheLane`, executed
against a real temporary engine DB. No disarm turns are spent on a risk that
does not exist.

Two related traps the scenarios are written around:

* `_CMMS_NO` substring-matches any decline word longer than three characters
  (`skip`, `cancel`, `abort`, `nope`, `never mind`). A message that merely
  CONTAINS one anywhere is read as a decline and silently discards the draft
  under test. Guarded by a test over every technician turn.
* `_is_fresh_question_during_wo` (engine.py:292) only treats a message as a
  fresh question when it contains `?`, a question word, or exceeds 40
  characters. `my compressor is overheating` satisfies none of the three — see
  the bypass scenario's note.

Precondition
------------
If the cold-imperative fast path does not arm a draft, the rest of the tier is
theatre: `check_no_unbacked_action_claim` passes vacuously on a failure
admission, so a tenant without CMMS write access would produce a full column of
GREEN cells for a lifecycle that was never exercised — the same
tenant-ground-truth hole that killed tiers 4-7 the first time. The first
scenario IS the precondition, and `should_abort()` tells the runner to stop the
tier rather than keep spending live turns on a verdict that cannot mean
anything.

Grading
-------
Wire-only, like every tier here: nothing below is graded on engine internals,
`dispatch_kind`, or DB state. Every verdict is visible in MIRA's Telegram reply
text. Where the contract is structural rather than lexical it is carried by a
gate in `campaign/gates.py`; where two tokens must BOTH survive a parse it is
carried by `expect_all` (a conjunction — plain `expect` is ANY-match and would
pass on either one alone).
"""

from __future__ import annotations

import copy

# The scenario whose failure aborts the tier. See "Precondition" above.
PRECONDITION = "wo_cold_imperative_fast_path"

ABORT_MESSAGE = (
    "TIER5 PRECONDITION FAILED — the cold-imperative fast path did not arm a "
    "work-order draft. Every later scenario would report on a lifecycle that "
    "never started, and the honesty gate passes vacuously on a failure "
    "admission, so the column would read GREEN. Fix CMMS access for the "
    "campaign tenant (or the fast path) before re-running tier 5."
)

# (name, capability_id, turns). Shape matches tiers 1/2/9: the runner reads
# send / expect / expect_all / forbid / gate, and nothing else.
SCENARIOS: list[tuple[str, str, list[dict]]] = [
    (
        # Does the imperative fast path short-circuit BEFORE the LLM router and
        # render a draft the technician can see? "Pump 7" and "leaking seal" are
        # anchors the TECHNICIAN supplied — if they do not survive into the
        # draft, _parse_asset_fault_from_message failed, and that is visible on
        # the wire with no DB access. expect_all, not expect: ANY-match would
        # pass on the asset alone and the fault anchor would be decoration.
        # The graceful fallback is forbidden outright — if the runtime quality
        # gate replaced a templated preview, the trusted-dispatch-kind bypass
        # failed.
        PRECONDITION,
        "wo_action_fast_path",
        [
            dict(
                send="create a work order for Pump 7 - leaking seal on discharge side",
                expect_all=["Pump 7", "leaking seal"],
                forbid=["rephrase your question"],
                gate="wo_confirmation_offer",
            ),
        ],
    ),
    (
        # A correction must UPDATE the draft and re-show it. The failure modes
        # are all silent: the edit read as unrecognised input (draft cancelled),
        # read as a "no" (draft discarded), or acknowledged without re-showing —
        # leaving the technician unable to see what they are about to log.
        "wo_field_edit_updates_draft",
        "cmms_pending_lane",
        [
            dict(
                send="create a work order for Pump 7 - leaking seal on discharge side",
                expect=["Pump 7"],
                gate="wo_confirmation_offer",
            ),
            dict(send="asset is Pump A3", expect=["Pump A3"], gate="wo_confirmation_offer"),
        ],
    ),
    (
        # Ambiguity must not destroy work. "no work order logged" is the exact
        # silent-cancel defect: treating unrecognised input as a decline throws
        # away a draft the technician spent a turn building. Its presence on
        # turn 2 IS the failure. (The same string is the CORRECT reply to a real
        # "no" — which is why it is forbidden here and expected in the decline
        # scenario, and why the honesty gate must not read it as a false claim.)
        "wo_unrecognised_input_reshows",
        "cmms_pending_lane",
        [
            dict(
                send="log a maintenance ticket for the infeed conveyor - belt tracking off",
                expect=["infeed conveyor"],
                gate="wo_confirmation_offer",
            ),
            dict(send="hmm", forbid=["no work order logged"], gate="wo_confirmation_offer"),
        ],
    ),
    (
        # "no" is the single most common answer in the lane. A declined draft
        # must produce neither a work-order number nor a bare creation claim,
        # and must not re-show the preview as though "no" were unrecognised.
        "wo_decline_creates_nothing",
        "cmms_pending_lane",
        [
            dict(
                send="create a work order for the mixer gearbox - bearing noise",
                expect=["mixer gearbox"],
                gate="wo_confirmation_offer",
            ),
            dict(send="no", gate="no_unbacked_action_claim"),
        ],
    ),
    (
        # The technician raised a DIFFERENT machine while a draft sat armed. The
        # WO confirmation prompt on that turn is a defect by construction:
        # verbatim at engine.py:4644.
        #
        # NOT forbidden: "Pump 7". A reply that says it set the Pump 7 draft
        # aside is BETTER than one that discards it silently, and forbidding the
        # abandoned asset name would fail the better behaviour while passing the
        # more dangerous one. The identifying-question gate carries the
        # "engaged the new machine" half of the contract.
        #
        # Predicted RED, with a named mechanism: `_is_fresh_question_during_wo`
        # requires `?`, a question word, or >40 characters. "my compressor is
        # overheating" is 28 characters, has no question mark and matches none
        # of `_NEW_QUESTION_RE`'s words — so the bypass will not fire and the
        # turn is eaten by `_handle_cmms_pending`. If that prediction is wrong,
        # the cell goes green and the analysis was wrong; either way the run
        # says something true.
        "wo_bypass_by_fresh_question",
        "cmms_pending_bypass",
        [
            dict(
                send="create a work order for Pump 7 - leaking seal on discharge side",
                expect=["Pump 7"],
                gate="wo_confirmation_offer",
            ),
            dict(
                send="my compressor is overheating",
                forbid=["Say **yes** to log this work order"],
                gate="identifying_question",
            ),
        ],
    ),
    (
        # The only scenario that deliberately WRITES. Turn 2 confirms the work
        # order; turn 3 answers whatever the PM lane proposes. Both are graded
        # by the honesty gate rather than by an expected success string, because
        # a CMMS failure that says so is a PASS and a success that cannot name
        # the row it created is a FAIL. If no PM proposal appears, turn 3's bare
        # "yes" still tests something worth knowing: whether a stray affirmative
        # is absorbed safely or silently re-arms a draft.
        "pm_followup_acceptance",
        "pm_suggestion_pending",
        [
            dict(
                send="create a work order for the mixer gearbox - bearing noise on the input shaft",
                expect=["mixer gearbox"],
                gate="wo_confirmation_offer",
            ),
            dict(send="yes", gate="no_unbacked_action_claim"),
            dict(send="yes", gate="no_unbacked_action_claim"),
        ],
    ),
    (
        # The cleanest kind of negative control: a one-turn documentation lookup
        # is not a diagnosis, and the offer string is a fixed literal
        # (engine.py:4422). Its presence means the scoping condition —
        # identified asset AND (a fault category OR three-plus exchanges) — has
        # regressed to firing after every reply, which is exactly the behaviour
        # that had to be scoped once already.
        "auto_wo_offer_stays_scoped",
        "resolved_auto_wo_prompt",
        [
            dict(
                send="What does CE10 mean on my DURApulse GS10 drive?",
                expect=["CE10"],
                forbid=["Would you like to log a work order"],
            ),
        ],
    ),
    (
        # The positive branch of the same capability, HARD-graded. An earlier
        # draft of this scenario designated "no offer appeared" as
        # informative-but-not-a-failure, which made a four-turn conversation buy
        # a verdict that was green no matter what MIRA did. A scenario whose
        # cell cannot go red is decoration, so the offer's presence is asserted:
        # after a real multi-turn diagnosis on an identified asset with a fault
        # category, turn 4 must carry a work-order preview with a confirm-or-
        # cancel choice. A red cell here means the scoping is tighter than the
        # atlas describes — a finding, recorded as one.
        "auto_wo_offer_after_real_diagnosis",
        "resolved_auto_wo_prompt",
        [
            dict(send="my PowerFlex 525 is tripping on start", expect=["PowerFlex"]),
            dict(send="F004 comes up on the display", expect=["F004"]),
            dict(
                send="the incoming voltage measures 458V on all three legs",
                gate="no_unbacked_action_claim",
            ),
            dict(
                send="ok that matches what you said - I think we found it",
                gate="wo_confirmation_offer",
            ),
        ],
    ),
    (
        # With no filing target and no prior extraction there is nothing to
        # store. "Added to" is the success-branch prefix (engine.py:7192); a
        # reply carrying it is claiming a persistence the wire can falsify.
        "store_doc_without_target",
        "store_documentation",
        [
            dict(
                send="add this to documentation",
                forbid=["Added to"],
                gate="no_unbacked_action_claim",
            ),
        ],
    ),
    (
        # The success branch reports a component and connection count
        # (engine.py:7179). With no schematic in the session that count cannot
        # exist, so its presence is a fabricated knowledge-graph write — visible
        # in the text. The correct replies are "who should I file this under"
        # or "I'll file the NEXT schematic under plant A".
        "store_doc_named_target_no_extraction",
        "store_documentation",
        [
            dict(
                send="add this to documentation for plant A",
                forbid=["components stored"],
                gate="no_unbacked_action_claim",
            ),
        ],
    ),
]


def should_abort(scenario_id: str, passed: bool) -> bool:
    """Stop the tier rather than keep spending live turns on a dead lifecycle.

    True only when the PRECONDITION scenario failed. A later failure is a
    finding — that is what the tier is for — and must not stop the run.
    """
    return not passed and scenario_id.endswith(PRECONDITION)


def generate(seed: int, count: int) -> list[dict]:
    """Runner scenarios. `count` slices the fixed list, like tier 9.

    Deterministic and seed-scoped: the ledger keys resume on the conversation
    id, so an unseeded id would make a second seed look already-done and skip
    the whole tier silently.
    """
    chosen = SCENARIOS[:count] if count else SCENARIOS
    out: list[dict] = []
    for i, (name, capability_id, turns) in enumerate(chosen):
        out.append(
            dict(
                id=f"t5_s{seed}_{i:03d}_{name}",
                contract=f"Tier5 work-order lifecycle ({capability_id}/{name})",
                seed=seed,
                turns=copy.deepcopy(turns),
            )
        )
    return out
