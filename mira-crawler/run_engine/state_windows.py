"""Derive machine-state windows from mapped tag events (pure, no I/O).

A state window is a genuinely different concept from a run (see migration 040
header + docs/discovery/2026-07-03-machine-memory-buildout.md D2): it records
WHAT STATE the machine was in over an interval — including idle/fault intervals
where no run trigger ever rose and the 038 run layer records nothing.

State classification per snapshot (precedence order):

  comm_down  — vfd_comm_ok is explicitly False (the A1 condition; every VFD
               value downstream is stale, so comm_down outranks faulted).
  estopped   — e-stop active, OR the A3 e-stop condition (wiring-fault flag /
               dual-channel DI_02==DI_03 disagreement).
  faulted    — any other CRITICAL/HIGH anomaly is active on the snapshot.
  running    — motor reports running, or output Hz > 0.1.
  idle       — none of the above with at least one signal present.
  unknown    — snapshot has no mapped signals at all.

Windows open on the first event and close/reopen on each state transition; the
transition event is the FIRST event of the new window. ``from_event_id`` /
``to_event_id`` anchor each window to the first/last tag_events row observed
while in the state (the evidence pointers).
"""

from __future__ import annotations

from typing import Optional

from .anomaly_rules import (
    T_COMM,
    T_DI02,
    T_DI03,
    T_ESTOP,
    T_FREQ,
    T_RUN,
    T_WIRING,
    evaluate,
)
from .models import StateWindow
from .snapshot import MappedEvent

STATES = ("idle", "running", "faulted", "comm_down", "estopped", "unknown")


def classify_state(snap: dict, cfg: Optional[dict] = None) -> str:
    """Classify one snapshot into a machine_state_window state."""
    if not snap:
        return "unknown"
    if snap.get(T_COMM) is False:
        return "comm_down"
    di02, di03 = snap.get(T_DI02), snap.get(T_DI03)
    estop_wiring = snap.get(T_WIRING) is True or (
        di02 is not None and di03 is not None and di02 == di03
    )
    if snap.get(T_ESTOP) is True or estop_wiring:
        return "estopped"
    # Snapshot-only anomaly severities (temporal facts intentionally omitted:
    # per-event classification has no meaningful "for N seconds" yet).
    anomalies = evaluate(snap, {}, cfg)
    if any(a.severity in ("CRITICAL", "HIGH") for a in anomalies):
        return "faulted"
    freq = snap.get(T_FREQ)
    if snap.get(T_RUN) is True or (isinstance(freq, (int, float)) and freq > 0.1):
        return "running"
    return "idle"


def derive_state_windows(
    events: list[MappedEvent],
    *,
    tenant_id: str,
    uns_path: str,
    cfg: Optional[dict] = None,
) -> list[StateWindow]:
    """Walk events chronologically; open/close windows on state transitions.

    The final window is closed at the last event's timestamp with
    ``metadata.closed_by = 'batch_end'`` so re-processing the same batch is
    idempotent on the (tenant, uns, state, started_at) unique key.
    """
    if not events:
        return []

    windows: list[StateWindow] = []
    snap: dict = {}
    current: Optional[StateWindow] = None

    for e in events:
        snap[e.topic] = e.value
        state = classify_state(snap, cfg)
        if current is None:
            current = StateWindow(
                tenant_id=tenant_id,
                uns_path=uns_path,
                state=state,
                started_at=e.event_timestamp,
                from_event_id=e.event_id,
                to_event_id=e.event_id,
            )
        elif state != current.state:
            current.ended_at = e.event_timestamp
            current.metadata.setdefault("closed_by", "transition")
            windows.append(current)
            current = StateWindow(
                tenant_id=tenant_id,
                uns_path=uns_path,
                state=state,
                started_at=e.event_timestamp,
                from_event_id=e.event_id,
                to_event_id=e.event_id,
            )
        else:
            current.to_event_id = e.event_id

    assert current is not None
    current.ended_at = events[-1].event_timestamp
    current.metadata.setdefault("closed_by", "batch_end")
    windows.append(current)
    return windows


def window_events(
    events: list[MappedEvent], window: StateWindow
) -> list[MappedEvent]:
    """The mapped events belonging to a window (from_event_id..to_event_id).

    Index-based (not timestamp-based) so a transition event sharing a timestamp
    with the previous window's close is attributed unambiguously.
    """
    ids = [e.event_id for e in events]
    try:
        start = ids.index(window.from_event_id)
        end = ids.index(window.to_event_id, start)
    except ValueError:
        return []
    return events[start : end + 1]
