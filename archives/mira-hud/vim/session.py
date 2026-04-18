"""Technician session state machine (Layer 3).

Manages the lifecycle of a maintenance session: scanning → manifest building
→ component selection → procedure execution. Handles IoU-based deduplication,
stale detection, and manifest capping.

Usage:
    from vim.session import create_session, update_manifest, select_component
    from vim.config import SessionConfig

    session = create_session("tech-001", equipment_context="CH-46E")
    session = update_manifest(session, classifications, SessionConfig())
"""

from __future__ import annotations

import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .classifier import Classification
from .config import SessionConfig, SessionState
from .scene_scanner import BoundingBox

logger = logging.getLogger("vim-session")


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class Detection:
    """A tracked component in the manifest.

    Wraps a Classification with temporal tracking metadata for IoU
    deduplication and stale marking.
    """

    detection_id: str
    classification: Classification
    first_seen: float
    last_seen: float
    status: str = "active"  # "active" or "stale"
    tm_reference: str | None = None


@dataclass
class TechnicianSession:
    """Mutable session state for a single technician."""

    session_id: str
    technician_id: str
    start_time: datetime
    equipment_context: str | None
    current_state: SessionState
    component_manifest: list[Detection] = field(default_factory=list)
    selected_component: Detection | None = None
    active_procedure_steps: list[str] = field(default_factory=list)
    current_step_index: int = 0
    frame_history: deque = field(default_factory=lambda: deque(maxlen=10))
    rag_context: str | None = None
    session_log: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# IoU helper
# ---------------------------------------------------------------------------


def _iou(box_a: BoundingBox, box_b: BoundingBox) -> float:
    """Compute intersection-over-union for two axis-aligned bounding boxes."""
    x1 = max(box_a.x, box_b.x)
    y1 = max(box_a.y, box_b.y)
    x2 = min(box_a.x + box_a.w, box_b.x + box_b.w)
    y2 = min(box_a.y + box_a.h, box_b.y + box_b.h)

    inter_w = max(0, x2 - x1)
    inter_h = max(0, y2 - y1)
    intersection = inter_w * inter_h

    if intersection == 0:
        return 0.0

    area_a = box_a.w * box_a.h
    area_b = box_b.w * box_b.h
    union = area_a + area_b - intersection

    return intersection / union if union > 0 else 0.0


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


def _log_event(session: TechnicianSession, event_type: str, **kwargs) -> None:
    """Append a timestamped event to the session log."""
    entry = {"event": event_type, "timestamp": time.time(), **kwargs}
    session.session_log.append(entry)


def create_session(
    technician_id: str,
    equipment_context: str | None = None,
) -> TechnicianSession:
    """Create a new technician session in IDLE state."""
    session = TechnicianSession(
        session_id=str(uuid.uuid4()),
        technician_id=technician_id,
        start_time=datetime.now(timezone.utc),
        equipment_context=equipment_context,
        current_state=SessionState.IDLE,
    )
    _log_event(session, "session_created", technician_id=technician_id)
    logger.info("Session created: %s for %s", session.session_id[:8], technician_id)
    return session


def update_manifest(
    session: TechnicianSession,
    classifications: list[Classification],
    config: SessionConfig | None = None,
) -> TechnicianSession:
    """Update the component manifest with new detections.

    IoU dedup: overlap > iou_threshold AND class_name match → same component.
    Components absent > stale_timeout_s → status="stale".
    Max active (non-stale) items capped at max_manifest_items.
    """
    if config is None:
        config = SessionConfig()

    now = time.time()

    # Match new classifications against existing manifest via IoU
    matched_ids: set[str] = set()

    for cls in classifications:
        best_match: Detection | None = None
        best_iou = 0.0

        for det in session.component_manifest:
            if det.classification.class_name != cls.class_name:
                continue
            iou_val = _iou(det.classification.bbox, cls.bbox)
            if iou_val > config.iou_threshold and iou_val > best_iou:
                best_iou = iou_val
                best_match = det

        if best_match is not None:
            # Update existing detection
            best_match.last_seen = now
            best_match.classification = cls
            best_match.status = "active"
            matched_ids.add(best_match.detection_id)
        else:
            # New detection
            det = Detection(
                detection_id=str(uuid.uuid4()),
                classification=cls,
                first_seen=now,
                last_seen=now,
            )
            session.component_manifest.append(det)
            matched_ids.add(det.detection_id)

    # Mark stale: unmatched detections absent > stale_timeout_s
    for det in session.component_manifest:
        if det.detection_id not in matched_ids:
            if now - det.last_seen > config.stale_timeout_s:
                det.status = "stale"

    # Cap active items
    active = [d for d in session.component_manifest if d.status == "active"]
    if len(active) > config.max_manifest_items:
        # Keep most recently seen
        active.sort(key=lambda d: d.last_seen, reverse=True)
        overflow = active[config.max_manifest_items :]
        for d in overflow:
            d.status = "stale"

    # State transitions
    active_count = sum(1 for d in session.component_manifest if d.status == "active")
    if session.current_state == SessionState.IDLE and active_count > 0:
        session.current_state = SessionState.SCANNING
        _log_event(session, "state_transition", to=SessionState.SCANNING.value)
    elif session.current_state == SessionState.SCANNING and active_count > 0:
        session.current_state = SessionState.MANIFEST_READY
        _log_event(session, "state_transition", to=SessionState.MANIFEST_READY.value)

    return session


def select_component(
    session: TechnicianSession,
    detection: Detection,
) -> TechnicianSession:
    """Select a component from the manifest.

    Transitions MANIFEST_READY → COMPONENT_SELECTED.
    """
    session.selected_component = detection
    session.current_state = SessionState.COMPONENT_SELECTED
    _log_event(
        session,
        "state_transition",
        to=SessionState.COMPONENT_SELECTED.value,
        component=detection.classification.class_name,
    )
    logger.info("Component selected: %s", detection.classification.class_name)
    return session


def load_procedure(
    session: TechnicianSession,
    steps: list[str],
    rag_context: str | None = None,
) -> TechnicianSession:
    """Load a maintenance procedure.

    Transitions COMPONENT_SELECTED → PROCEDURE_ACTIVE.
    """
    session.active_procedure_steps = steps
    session.current_step_index = 0
    session.rag_context = rag_context
    session.current_state = SessionState.PROCEDURE_ACTIVE
    _log_event(
        session,
        "state_transition",
        to=SessionState.PROCEDURE_ACTIVE.value,
        step_count=len(steps),
    )
    logger.info("Procedure loaded: %d steps", len(steps))
    return session


def advance_step(session: TechnicianSession) -> TechnicianSession:
    """Advance to the next procedure step. Clamps at max index."""
    max_idx = max(0, len(session.active_procedure_steps) - 1)
    session.current_step_index = min(session.current_step_index + 1, max_idx)
    _log_event(session, "step_advanced", step=session.current_step_index)
    return session


def complete_session(session: TechnicianSession) -> TechnicianSession:
    """Complete the session.

    Transitions PROCEDURE_ACTIVE → IDLE. Logs total duration.
    """
    duration = (datetime.now(timezone.utc) - session.start_time).total_seconds()
    session.current_state = SessionState.IDLE
    session.selected_component = None
    session.active_procedure_steps = []
    session.current_step_index = 0
    _log_event(
        session,
        "state_transition",
        to=SessionState.IDLE.value,
        reason="completed",
        duration_s=round(duration, 1),
    )
    logger.info("Session completed: %.1fs", duration)
    return session


def reset_session(session: TechnicianSession) -> TechnicianSession:
    """Reset session to IDLE from any state."""
    previous = session.current_state.value
    session.current_state = SessionState.IDLE
    session.component_manifest = []
    session.selected_component = None
    session.active_procedure_steps = []
    session.current_step_index = 0
    session.rag_context = None
    _log_event(
        session,
        "state_transition",
        to=SessionState.IDLE.value,
        reason="reset",
        from_state=previous,
    )
    logger.info("Session reset from %s → IDLE", previous)
    return session
