"""Durable job state machine for the synthetic flywheel (addendum §11).

A deterministic, replayable FSM. Every stage must run in order — **no stage may
silently skip a failed predecessor** (§11): only the transitions declared in
:data:`ALLOWED` are legal, and :func:`validate_transition` fail-closes on any
other. Terminal states never transition out. Maps onto the CLF
`state-machine.md` spec (idempotent-by-content-address, single-writer per
``work_key``); the queue (``queue.py``) provides the durability + leases.
"""

from __future__ import annotations

# States (§11), in nominal order.
DISCOVERED = "DISCOVERED"
SOURCE_ELIGIBILITY_PENDING = "SOURCE_ELIGIBILITY_PENDING"
INELIGIBLE = "INELIGIBLE"
QUESTION_PENDING = "QUESTION_PENDING"
QUESTION_READY = "QUESTION_READY"
TARGET_RUN_PENDING = "TARGET_RUN_PENDING"
TARGET_RUN_COMPLETE = "TARGET_RUN_COMPLETE"
CRITIC_PENDING = "CRITIC_PENDING"
CRITIC_COMPLETE = "CRITIC_COMPLETE"
RECONCILIATION_PENDING = "RECONCILIATION_PENDING"
HUMAN_REVIEW = "HUMAN_REVIEW"
APPROVED_GOLD = "APPROVED_GOLD"
APPROVED_EVAL_ONLY = "APPROVED_EVAL_ONLY"
REJECTED = "REJECTED"
EXPORTED = "EXPORTED"
DEAD_LETTER = "DEAD_LETTER"

ALL_STATES: frozenset[str] = frozenset(
    {
        DISCOVERED,
        SOURCE_ELIGIBILITY_PENDING,
        INELIGIBLE,
        QUESTION_PENDING,
        QUESTION_READY,
        TARGET_RUN_PENDING,
        TARGET_RUN_COMPLETE,
        CRITIC_PENDING,
        CRITIC_COMPLETE,
        RECONCILIATION_PENDING,
        HUMAN_REVIEW,
        APPROVED_GOLD,
        APPROVED_EVAL_ONLY,
        REJECTED,
        EXPORTED,
        DEAD_LETTER,
    }
)

# Terminal states — no outgoing transition (EXPORTED is the end of PR F's path;
# APPROVED_GOLD transitions only to EXPORTED).
TERMINAL: frozenset[str] = frozenset(
    {INELIGIBLE, APPROVED_EVAL_ONLY, REJECTED, EXPORTED, DEAD_LETTER}
)

# The ONLY legal transitions. DEAD_LETTER is reachable from any non-terminal
# state (retry exhaustion / unrecoverable error) and is added below.
ALLOWED: dict[str, frozenset[str]] = {
    DISCOVERED: frozenset({SOURCE_ELIGIBILITY_PENDING}),
    SOURCE_ELIGIBILITY_PENDING: frozenset({INELIGIBLE, QUESTION_PENDING}),
    QUESTION_PENDING: frozenset({QUESTION_READY}),
    QUESTION_READY: frozenset({TARGET_RUN_PENDING}),
    TARGET_RUN_PENDING: frozenset({TARGET_RUN_COMPLETE}),
    TARGET_RUN_COMPLETE: frozenset({CRITIC_PENDING}),
    CRITIC_PENDING: frozenset({CRITIC_COMPLETE}),
    # critic may route to reconciliation (correctable defect) or straight to review
    CRITIC_COMPLETE: frozenset({RECONCILIATION_PENDING, HUMAN_REVIEW}),
    RECONCILIATION_PENDING: frozenset({HUMAN_REVIEW}),
    # a human decides; REQUEST_CORRECTION may return it to reconciliation ONCE
    HUMAN_REVIEW: frozenset({APPROVED_GOLD, APPROVED_EVAL_ONLY, REJECTED, RECONCILIATION_PENDING}),
    APPROVED_GOLD: frozenset({EXPORTED}),
    APPROVED_EVAL_ONLY: frozenset(),
    INELIGIBLE: frozenset(),
    REJECTED: frozenset(),
    EXPORTED: frozenset(),
    DEAD_LETTER: frozenset(),
}
# Any non-terminal state may fail into DEAD_LETTER (retry exhaustion).
_DEAD_REACHABLE = ALL_STATES - TERMINAL - {APPROVED_GOLD}
ALLOWED = {s: (nxt | {DEAD_LETTER} if s in _DEAD_REACHABLE else nxt) for s, nxt in ALLOWED.items()}


class IllegalTransition(ValueError):
    """Raised when a transition is not in :data:`ALLOWED` — the fail-closed guard."""


def is_terminal(state: str) -> bool:
    return state in TERMINAL


def can_transition(src: str, dst: str) -> bool:
    return dst in ALLOWED.get(src, frozenset())


def validate_transition(src: str, dst: str) -> None:
    """Fail closed on any transition not declared legal (§11 'no stage may
    silently skip a failed predecessor')."""
    if src not in ALL_STATES:
        raise IllegalTransition(f"unknown source state {src!r}")
    if dst not in ALL_STATES:
        raise IllegalTransition(f"unknown destination state {dst!r}")
    if src in TERMINAL:
        raise IllegalTransition(f"{src} is terminal; no transition to {dst}")
    if not can_transition(src, dst):
        raise IllegalTransition(f"illegal transition {src} -> {dst}")
