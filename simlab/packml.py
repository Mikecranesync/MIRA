"""PackML / ISA-88 machine-state model for SimLab assets.

This is a pragmatic, deterministic subset of the ISA-88/PackML state model —
the ten states the SimLab spec calls for. It normalizes a *legitimate* industrial
concept (the PackML unit/machine state machine) into a MIRA-readable model; it
executes no proprietary PLC code.

States (value = the lowercase tag string MIRA sees on ``status.packml_state``):

    STOPPED, STARTING, IDLE, EXECUTE (running), HELD, SUSPENDED,
    ABORTED, CLEARING, RESETTING, COMPLETE

Transition philosophy
---------------------
PackML is command-driven. We model the *normal* command graph plus two
"any-active-state" escapes that real machines always have:

  - **Abort** (e-stop / critical fault) → ABORTED from any non-terminal state.
  - **Hold/Suspend** are only legal while EXECUTE.

Use :func:`can_transition` to validate a move and :func:`is_active` /
:func:`is_faulted` for engine logic. The engine drives these transitions; this
module only defines the legal graph.
"""

from __future__ import annotations

from enum import Enum


class PackMLState(str, Enum):
    STOPPED = "stopped"
    STARTING = "starting"
    IDLE = "idle"
    EXECUTE = "execute"  # a.k.a. Running / Producing
    HELD = "held"
    SUSPENDED = "suspended"
    ABORTED = "aborted"
    CLEARING = "clearing"
    RESETTING = "resetting"
    COMPLETE = "complete"


# Normal command-driven graph. ABORTED is reachable from any active state via
# Abort (handled in can_transition), so it is not duplicated into every set here.
LEGAL_TRANSITIONS: dict[PackMLState, frozenset[PackMLState]] = {
    PackMLState.STOPPED: frozenset({PackMLState.RESETTING}),
    PackMLState.RESETTING: frozenset({PackMLState.IDLE, PackMLState.STOPPED}),
    PackMLState.IDLE: frozenset({PackMLState.STARTING, PackMLState.STOPPED}),
    PackMLState.STARTING: frozenset({PackMLState.EXECUTE, PackMLState.STOPPED}),
    PackMLState.EXECUTE: frozenset(
        {
            PackMLState.HELD,
            PackMLState.SUSPENDED,
            PackMLState.COMPLETE,
            PackMLState.STOPPED,
        }
    ),
    PackMLState.HELD: frozenset({PackMLState.EXECUTE, PackMLState.STOPPED}),
    PackMLState.SUSPENDED: frozenset({PackMLState.EXECUTE, PackMLState.STOPPED}),
    PackMLState.COMPLETE: frozenset({PackMLState.RESETTING, PackMLState.STOPPED}),
    PackMLState.ABORTED: frozenset({PackMLState.CLEARING}),
    PackMLState.CLEARING: frozenset({PackMLState.STOPPED}),
}

# States in which the machine is doing productive or transitional work.
_ACTIVE = frozenset(
    {
        PackMLState.STARTING,
        PackMLState.EXECUTE,
        PackMLState.HELD,
        PackMLState.SUSPENDED,
        PackMLState.RESETTING,
        PackMLState.CLEARING,
        PackMLState.COMPLETE,
    }
)

# States a fault/abort puts the machine into (or holds it in).
_FAULTED = frozenset({PackMLState.ABORTED, PackMLState.CLEARING})


def can_transition(current: PackMLState, target: PackMLState) -> bool:
    """True if ``current → target`` is a legal PackML move.

    Abort is always legal from any non-terminal, non-aborted state (e-stop /
    critical fault). Otherwise the move must appear in :data:`LEGAL_TRANSITIONS`.
    """
    if current == target:
        return True
    if target == PackMLState.ABORTED and current not in (
        PackMLState.ABORTED,
        PackMLState.CLEARING,
    ):
        return True
    return target in LEGAL_TRANSITIONS.get(current, frozenset())


def is_active(state: PackMLState) -> bool:
    """True if the machine is producing or in a productive transition."""
    return state in _ACTIVE


def is_running(state: PackMLState) -> bool:
    """True only in EXECUTE (the steady producing state)."""
    return state == PackMLState.EXECUTE


def is_faulted(state: PackMLState) -> bool:
    """True if the machine is aborted or clearing a fault."""
    return state in _FAULTED


def run_state_label(state: PackMLState) -> str:
    """Human-readable label for the common ``run_state`` HMI tag."""
    return {
        PackMLState.EXECUTE: "Running",
        PackMLState.IDLE: "Idle",
        PackMLState.STOPPED: "Stopped",
        PackMLState.HELD: "Held",
        PackMLState.SUSPENDED: "Suspended",
        PackMLState.ABORTED: "Faulted",
        PackMLState.CLEARING: "Clearing",
        PackMLState.STARTING: "Starting",
        PackMLState.RESETTING: "Resetting",
        PackMLState.COMPLETE: "Complete",
    }[state]
