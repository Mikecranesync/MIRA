"""AR overlay instruction generator (Layer 5).

Produces pure data describing what the HUD should display. No rendering,
no display, no SDK calls. Output is an OverlayFrame dataclass consumed by
the Socket.IO bridge (mira_core.py) and the HUD frontend (hud.html).

Usage:
    from vim.ar_renderer import render_overlay

    frame = render_overlay(session, active_detections, rag_context)
    # frame.bounding_boxes, frame.hud_manifest, frame.warnings, etc.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .config import OverlayMode, SessionState
from .scene_scanner import BoundingBox
from .session import Detection, TechnicianSession

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_COLOR_WHITE = "#FFFFFF"
_COLOR_CYAN = "#00FFFF"
_COLOR_GRAY = "#888888"
_MAX_MANIFEST_ITEMS = 8


# ---------------------------------------------------------------------------
# Output dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AnnotatedBox:
    """A bounding box with display metadata for the HUD."""

    box: BoundingBox
    label: str
    confidence: float
    color: str
    selected: bool


@dataclass(frozen=True)
class OverlayFrame:
    """Complete overlay instructions for a single HUD frame."""

    mode: str
    bounding_boxes: list[AnnotatedBox]
    hud_manifest: list[str]
    procedure_step: str | None
    procedure_progress: str | None
    diagram_image: str | None
    warnings: list[str]
    cautions: list[str]
    mode_indicator: str


# ---------------------------------------------------------------------------
# WARNING / CAUTION extraction
# ---------------------------------------------------------------------------


def _extract_safety(rag_context: str | None) -> tuple[list[str], list[str]]:
    """Extract WARNING: and CAUTION: lines from RAG context text.

    Case-insensitive prefix match. Returns (warnings, cautions).
    """
    warnings: list[str] = []
    cautions: list[str] = []

    if not rag_context:
        return warnings, cautions

    for line in rag_context.splitlines():
        stripped = line.strip()
        if re.match(r"(?i)^warning:", stripped):
            warnings.append(stripped)
        elif re.match(r"(?i)^caution:", stripped):
            cautions.append(stripped)

    return warnings, cautions


# ---------------------------------------------------------------------------
# Mode derivation
# ---------------------------------------------------------------------------


def _derive_mode(state: SessionState) -> str:
    """Map session state to overlay display mode."""
    if state == SessionState.COMPONENT_SELECTED:
        return OverlayMode.FOCUSED.value
    if state == SessionState.PROCEDURE_ACTIVE:
        return OverlayMode.PROCEDURE.value
    return OverlayMode.SCANNING.value


# ---------------------------------------------------------------------------
# Manifest formatting
# ---------------------------------------------------------------------------


def _format_manifest_item(index: int, detection: Detection) -> str:
    """Format a single manifest entry."""
    name = detection.classification.class_name.replace("_", " ").title()
    conf = detection.classification.confidence
    return f"{index + 1}. {name} [{conf:.0%}]"


# ---------------------------------------------------------------------------
# Main render function
# ---------------------------------------------------------------------------


def render_overlay(
    session: TechnicianSession,
    detections: list[Detection],
    rag_context: str | None = None,
) -> OverlayFrame:
    """Generate AR overlay instructions from session state and detections.

    Args:
        session: Current technician session.
        detections: Active (non-stale) detections from the manifest.
        rag_context: Retrieved TM text for procedure/warnings.

    Returns:
        OverlayFrame with all display instructions.
    """
    mode = _derive_mode(session.current_state)
    warnings, cautions = _extract_safety(rag_context)

    selected_id = session.selected_component.detection_id if session.selected_component else None

    # Build annotated boxes based on mode
    boxes: list[AnnotatedBox] = []
    if mode == OverlayMode.SCANNING.value:
        for det in detections:
            boxes.append(
                AnnotatedBox(
                    box=det.classification.bbox,
                    label=det.classification.class_name.replace("_", " ").title(),
                    confidence=det.classification.confidence,
                    color=_COLOR_WHITE,
                    selected=False,
                )
            )
    elif mode == OverlayMode.FOCUSED.value:
        for det in detections:
            is_selected = det.detection_id == selected_id
            boxes.append(
                AnnotatedBox(
                    box=det.classification.bbox,
                    label=det.classification.class_name.replace("_", " ").title(),
                    confidence=det.classification.confidence,
                    color=_COLOR_CYAN if is_selected else _COLOR_GRAY,
                    selected=is_selected,
                )
            )
    elif mode == OverlayMode.PROCEDURE.value:
        # Only the selected component
        if session.selected_component:
            det = session.selected_component
            boxes.append(
                AnnotatedBox(
                    box=det.classification.bbox,
                    label=det.classification.class_name.replace("_", " ").title(),
                    confidence=det.classification.confidence,
                    color=_COLOR_CYAN,
                    selected=True,
                )
            )

    # Build manifest list (max 8 items)
    if mode == OverlayMode.PROCEDURE.value and session.selected_component:
        # Minimized: only the selected component
        manifest = [_format_manifest_item(0, session.selected_component)]
    else:
        manifest = [
            _format_manifest_item(i, det) for i, det in enumerate(detections[:_MAX_MANIFEST_ITEMS])
        ]

    # Procedure step info
    procedure_step: str | None = None
    procedure_progress: str | None = None
    if mode == OverlayMode.PROCEDURE.value and session.active_procedure_steps:
        idx = session.current_step_index
        total = len(session.active_procedure_steps)
        if idx < total:
            procedure_step = session.active_procedure_steps[idx]
        procedure_progress = f"Step {idx + 1} of {total}"

    return OverlayFrame(
        mode=mode,
        bounding_boxes=boxes,
        hud_manifest=manifest,
        procedure_step=procedure_step,
        procedure_progress=procedure_progress,
        diagram_image=None,
        warnings=warnings,
        cautions=cautions,
        mode_indicator=mode,
    )
