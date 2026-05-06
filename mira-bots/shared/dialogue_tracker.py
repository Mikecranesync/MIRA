"""Dialogue Tracker — StateGraph-style orchestrator over the engine's
existing FSM and SQLite state.

Emulates LangGraph's `StateGraph` decomposition without the dependency:
each "node" is a *pure function* that takes a `DialogueState` and returns
the next `DialogueState` (plus a side-channel of work to do, modelled as
`DispatchPlan`). Composition happens in plain Python — no graph runtime,
no edges-as-config.

Why this is worth doing without LangGraph:
* The engine's existing `process_full` is ~600 lines of intent-routing
  if/elif/elif. Splitting it up makes the routing decision testable in
  isolation (no SQLite, no Groq, no RAG worker) — see
  `tests/test_dialogue_tracker.py`.
* The tracker stays subordinate to the existing FSM (Q1→Q2→Q3 etc.) and
  to the engine's existing handlers. It does not handle work itself; it
  produces a `DispatchPlan` that the engine executes. This is the pattern
  Mike asked for: "FSM tracks WHERE we are; dialogue acts track WHAT the
  user is doing right now."

Public surface:
* `track_turn(state, message, *, classifier=...)` — async, runs the
  classifier and returns a populated `(DialogueState, DispatchPlan)` pair.
* `decide_dispatch(state, turn)` — pure synchronous routing decision.
* `merge_entities(state, turn)` / `update_pending_question(state, turn)` —
  individual pure-function nodes, exposed for unit tests.

PLAN.md §2.3 — "New dispatch precedence in `Supervisor.process_full`".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from .dialogue_acts import classify_dialogue_act
from .dialogue_state import (
    ALWAYS_INTERRUPT_ACTIONS,
    AnswerAct,
    AskQuestionAct,
    ConfirmAct,
    DenyAct,
    DialogueState,
    DialogueTurn,
    DontKnowAct,
    GreetAck,
    InformAct,
    MetaControlAct,
    PendingQuestion,
    RequestActionAct,
    SafetyAct,
    SalientEntities,
)

logger = logging.getLogger("mira-gsd")

# ---------------------------------------------------------------------------
# DispatchPlan — what the engine should DO with this turn
# ---------------------------------------------------------------------------
#
# Pure data, returned by `decide_dispatch`. The engine consumes the `kind`
# and routes to the matching handler. Keeping this side of the boundary
# typed (vs. magic-string labels) means a typo in one place fails fast at
# import time instead of silently falling through.

DispatchKind = str  # one of:

DISPATCH_SAFETY = "safety"
DISPATCH_ACTION_INTERRUPT = "action_interrupt"
DISPATCH_ACTION = "action"
DISPATCH_SLOT_ANSWER = "slot_answer"
DISPATCH_SLOT_DONT_KNOW = "slot_dont_know"
DISPATCH_SLOT_CONFIRM = "slot_confirm"
DISPATCH_SLOT_DENY = "slot_deny"
DISPATCH_META = "meta"
DISPATCH_ASK_PROCEDURAL = "ask_procedural"
DISPATCH_ASK_GENERAL = "ask_general"
DISPATCH_GREET = "greet"
DISPATCH_DEFAULT_RAG = "default_rag"

ALL_DISPATCH_KINDS: frozenset[str] = frozenset(
    {
        DISPATCH_SAFETY,
        DISPATCH_ACTION_INTERRUPT,
        DISPATCH_ACTION,
        DISPATCH_SLOT_ANSWER,
        DISPATCH_SLOT_DONT_KNOW,
        DISPATCH_SLOT_CONFIRM,
        DISPATCH_SLOT_DENY,
        DISPATCH_META,
        DISPATCH_ASK_PROCEDURAL,
        DISPATCH_ASK_GENERAL,
        DISPATCH_GREET,
        DISPATCH_DEFAULT_RAG,
    }
)


@dataclass
class DispatchPlan:
    """The result of routing a single turn through the tracker.

    Engine code matches on `kind` and reads `payload` for any handler-
    specific parameters (action name for action dispatches, the slot for
    slot-answer dispatches, etc.). `reasoning` is for telemetry and human
    debugging — never user-visible."""

    kind: DispatchKind
    turn: DialogueTurn
    payload: dict[str, Any] = field(default_factory=dict)
    reasoning: str = ""

    @property
    def is_interrupt(self) -> bool:
        return self.kind in (DISPATCH_SAFETY, DISPATCH_ACTION_INTERRUPT, DISPATCH_META)


# ---------------------------------------------------------------------------
# Node 1 — entity merge (LangGraph "reducer" analogue)
# ---------------------------------------------------------------------------


def merge_entities(state: DialogueState, turn: DialogueTurn) -> DialogueState:
    """Merge any entities the classifier extracted into the state's salient
    map. Pure: returns a new DialogueState rather than mutating `state`."""
    new_entities = getattr(turn, "entities", None)
    if not isinstance(new_entities, SalientEntities):
        return state

    merged = state.salient_entities.merge(new_entities)
    if merged == state.salient_entities:
        return state

    return _replace(state, salient_entities=merged)


# ---------------------------------------------------------------------------
# Node 2 — pending-question lifecycle
# ---------------------------------------------------------------------------


def update_pending_question(state: DialogueState, turn: DialogueTurn) -> DialogueState:
    """Update the pending question based on the dialogue act.

    * `AnswerAct` / `DontKnowAct` / `ConfirmAct` / `DenyAct` against a real
      pending slot → clear the slot (the engine fills it / handles refusal)
    * `MetaControlAct` (cancel/reset) → clear the slot
    * `RequestActionAct` (interrupt) → keep the pending question; the engine
      snapshots and resumes it via `interrupted_thread`
    * `InformAct` / `AskQuestionAct` mid-slot → topic pivot, clear the slot
      (Rasa CALM "cancel_flow" pattern)
    * Otherwise leave the pending question untouched
    """
    pending = state.pending_question

    if not pending.is_pending:
        return state

    if isinstance(turn, (AnswerAct, DontKnowAct, ConfirmAct, DenyAct)):
        return _replace(state, pending_question=PendingQuestion())

    if isinstance(turn, MetaControlAct) and turn.command in ("cancel", "reset", "stop"):
        return _replace(state, pending_question=PendingQuestion())

    # Topic pivot — informational or new-question turn while a slot was open
    if isinstance(turn, (InformAct, AskQuestionAct)):
        return _replace(state, pending_question=PendingQuestion())

    return state


def set_pending_question(
    state: DialogueState,
    *,
    slot: str,
    raw_text: str,
    options: Optional[list[str]] = None,
    asked_at_turn: int = 0,
) -> DialogueState:
    """Engine helper: when a handler asks a new question, record it on the
    state so the next turn knows which slot is open. Use cases: `Q1` asks
    for the asset; `_handle_wo_request` asks for confirmation.

    Slot validation is lenient — unknown values are coerced to `none` by
    `PendingQuestion.from_dict`, which protects against typos but still
    surfaces the question text to the classifier prompt."""
    pq = PendingQuestion(
        slot=slot,  # type: ignore[arg-type]  # narrowed at runtime
        asked_at_turn=asked_at_turn,
        options=list(options or []),
        raw_text=raw_text[:200],
    )
    return _replace(state, pending_question=pq)


def clear_pending_question(state: DialogueState) -> DialogueState:
    return _replace(state, pending_question=PendingQuestion())


# ---------------------------------------------------------------------------
# Node 3 — interrupt snapshot / resume (Rasa FormPolicy pattern)
# ---------------------------------------------------------------------------


def snapshot_for_interrupt(state: DialogueState) -> DialogueState:
    """Stash the active flow before an interrupt action runs, so the engine
    can offer to resume after. Stage 1 only stores the snapshot; the resume
    prompt itself is wired in Stage 3."""
    if not state.pending_question.is_pending:
        return state

    snapshot: dict[str, Any] = {
        "fsm_state": state.fsm_state,
        "pending_question": state.pending_question.to_dict(),
    }
    return _replace(state, interrupted_thread=snapshot)


def consume_interrupt(state: DialogueState) -> tuple[DialogueState, Optional[dict[str, Any]]]:
    """Pop the interrupted thread, returning the snapshot for the engine to
    use in the resume prompt."""
    snapshot = state.interrupted_thread
    if snapshot is None:
        return state, None
    return _replace(state, interrupted_thread=None), snapshot


# ---------------------------------------------------------------------------
# Node 4 — dispatch decision (the routing backbone)
# ---------------------------------------------------------------------------


def decide_dispatch(state: DialogueState, turn: DialogueTurn) -> DispatchPlan:
    """The single routing decision for a turn.

    Priority order matches PLAN.md §2.3:
    1. Safety always wins
    2. Interrupt actions preempt with state preservation
    3. Slot-fill answers when MIRA has a pending question
       (Answer / DontKnow / Confirm / Deny)
    4. Meta-control commands (cancel / reset / skip / back / stop)
    5. Non-interrupt action requests (find_documentation, etc.)
    6. Question requests routed by question_kind
    7. Greetings in IDLE
    8. Default — fall through to the existing diagnostic RAG flow
    """

    # Priority 1 — safety
    if isinstance(turn, SafetyAct):
        return DispatchPlan(
            kind=DISPATCH_SAFETY,
            turn=turn,
            payload={"hazard_summary": turn.hazard_summary},
            reasoning="safety act always wins",
        )

    # Priority 2 — interrupt actions
    if isinstance(turn, RequestActionAct) and turn.action in ALWAYS_INTERRUPT_ACTIONS:
        return DispatchPlan(
            kind=DISPATCH_ACTION_INTERRUPT,
            turn=turn,
            payload={"action": turn.action},
            reasoning=f"interrupt action {turn.action} preempts active flow",
        )

    # Priority 3 — slot answers when there's a pending question
    if state.pending_question.is_pending:
        if isinstance(turn, AnswerAct):
            return DispatchPlan(
                kind=DISPATCH_SLOT_ANSWER,
                turn=turn,
                payload={
                    "slot": state.pending_question.slot,
                    "value": turn.slot_fill_value,
                },
                reasoning=f"answer to slot={state.pending_question.slot}",
            )
        if isinstance(turn, DontKnowAct):
            return DispatchPlan(
                kind=DISPATCH_SLOT_DONT_KNOW,
                turn=turn,
                payload={"slot": state.pending_question.slot},
                reasoning="user does not know the answer to pending question",
            )
        if isinstance(turn, ConfirmAct):
            return DispatchPlan(
                kind=DISPATCH_SLOT_CONFIRM,
                turn=turn,
                payload={"slot": state.pending_question.slot},
                reasoning="confirm yes/no slot",
            )
        if isinstance(turn, DenyAct):
            return DispatchPlan(
                kind=DISPATCH_SLOT_DENY,
                turn=turn,
                payload={"slot": state.pending_question.slot},
                reasoning="deny yes/no slot",
            )
        # Otherwise the user pivoted — fall through to non-pending dispatch.

    # Priority 4 — meta commands
    if isinstance(turn, MetaControlAct):
        return DispatchPlan(
            kind=DISPATCH_META,
            turn=turn,
            payload={"command": turn.command},
            reasoning=f"meta command {turn.command}",
        )

    # Priority 5 — non-interrupt actions
    if isinstance(turn, RequestActionAct):
        return DispatchPlan(
            kind=DISPATCH_ACTION,
            turn=turn,
            payload={"action": turn.action},
            reasoning=f"action {turn.action}",
        )

    # Priority 6 — questions
    if isinstance(turn, AskQuestionAct):
        if turn.question_kind == "procedural":
            return DispatchPlan(
                kind=DISPATCH_ASK_PROCEDURAL,
                turn=turn,
                payload={"question_kind": "procedural"},
                reasoning="procedural how-to question",
            )
        return DispatchPlan(
            kind=DISPATCH_ASK_GENERAL,
            turn=turn,
            payload={"question_kind": turn.question_kind},
            reasoning=f"general/{turn.question_kind} question",
        )

    # Priority 7 — greeting in IDLE
    if isinstance(turn, GreetAck) and state.fsm_state == "IDLE":
        return DispatchPlan(
            kind=DISPATCH_GREET,
            turn=turn,
            reasoning="greeting in IDLE state",
        )

    # Priority 8 — default to the existing diagnostic RAG flow.
    # InformAct, GreetAck-mid-flow, and any leftover act fall here.
    return DispatchPlan(
        kind=DISPATCH_DEFAULT_RAG,
        turn=turn,
        reasoning=f"default RAG flow for act={turn.act}",
    )


# ---------------------------------------------------------------------------
# Top-level entry point — `track_turn`
# ---------------------------------------------------------------------------


_ClassifierFn = Callable[
    [str, PendingQuestion, list[dict[str, str]], SalientEntities, str],
    Awaitable[DialogueTurn],
]


async def track_turn(
    state: DialogueState,
    message: str,
    *,
    classifier: Optional[_ClassifierFn] = None,
) -> tuple[DialogueState, DispatchPlan]:
    """Run one turn through the tracker pipeline.

    Steps (each a pure function above):
    1. Classify the user's act
    2. Merge any extracted entities into salient state
    3. Decide the dispatch plan
    4. Update the pending question lifecycle (after the decision is made,
       so the dispatch plan still sees the slot the engine was waiting on)

    Returns `(new_state, dispatch_plan)`. The new state is what the engine
    should persist; the dispatch plan is what it should execute.

    `classifier` is injected for testability — production callers leave it
    unset so we use `dialogue_acts.classify_dialogue_act`.
    """
    fn = classifier or classify_dialogue_act

    turn = await fn(
        message,
        state.pending_question,
        state.history_snippet,
        state.salient_entities,
        state.fsm_state,
    )

    state_after_entities = merge_entities(state, turn)
    plan = decide_dispatch(state_after_entities, turn)
    state_after_plan = state_after_entities

    # If the dispatch is an interrupt and there's a pending question, snapshot
    # it so a Stage-3 resume can offer to come back to the diagnosis later.
    if plan.is_interrupt and state_after_entities.pending_question.is_pending:
        state_after_plan = snapshot_for_interrupt(state_after_plan)

    state_final = update_pending_question(state_after_plan, turn)
    state_final = _replace(state_final, last_dialogue_act=turn.act)

    logger.info(
        "TRACKER act=%s dispatch=%s slot=%s fsm=%s msg=%r",
        turn.act,
        plan.kind,
        state.pending_question.slot,
        state.fsm_state,
        message[:80],
    )

    return state_final, plan


# ---------------------------------------------------------------------------
# Tiny helper — dataclasses.replace shim that's friendly to the typing model
# ---------------------------------------------------------------------------


def _replace(state: DialogueState, **changes: Any) -> DialogueState:
    """`dataclasses.replace` with explicit kwargs that we control here.
    Wrapped in a helper so static analysers track the field set without
    chasing the dataclasses library's internal `_FIELDS` dict."""
    from dataclasses import replace

    return replace(state, **changes)


__all__ = [
    "DispatchPlan",
    "DispatchKind",
    "DISPATCH_SAFETY",
    "DISPATCH_ACTION_INTERRUPT",
    "DISPATCH_ACTION",
    "DISPATCH_SLOT_ANSWER",
    "DISPATCH_SLOT_DONT_KNOW",
    "DISPATCH_SLOT_CONFIRM",
    "DISPATCH_SLOT_DENY",
    "DISPATCH_META",
    "DISPATCH_ASK_PROCEDURAL",
    "DISPATCH_ASK_GENERAL",
    "DISPATCH_GREET",
    "DISPATCH_DEFAULT_RAG",
    "ALL_DISPATCH_KINDS",
    "merge_entities",
    "update_pending_question",
    "set_pending_question",
    "clear_pending_question",
    "snapshot_for_interrupt",
    "consume_interrupt",
    "decide_dispatch",
    "track_turn",
]
