"""Scan loop orchestrator (Layer 4).

Coordinates the two-layer vision pipeline (scanner + classifier) with the
session state machine. Manages camera sources, scan cadence, and event
emission for downstream consumers (HUD overlay, RAG query builder).

Usage:
    from vim.orchestrator import VIMOrchestrator
    from vim.config import VIMConfig
    from vim.session import create_session

    config = VIMConfig()
    orch = VIMOrchestrator(
        config.scanner, config.classifier, config.session, config.orchestrator
    )
    session = create_session("tech-001", "CH-46E")
    event = orch.process_frame(frame, session)
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass

import cv2
import numpy as np

from .classifier import load_model, scan_and_classify
from .config import (
    CameraSourceType,
    ClassifierConfig,
    OrchestratorConfig,
    ScannerConfig,
    SessionConfig,
)
from .session import Detection, TechnicianSession, update_manifest

logger = logging.getLogger("vim-orchestrator")


# ---------------------------------------------------------------------------
# Event dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ManifestUpdateEvent:
    """Emitted after each frame scan + manifest update."""

    session_id: str
    detections: list[Detection]
    manifest_size: int
    timestamp: float


@dataclass(frozen=True)
class ProcedureQueryEvent:
    """Emitted when a technician selects a component for procedure lookup."""

    session_id: str
    query_string: str
    selected_component: Detection
    equipment_context: str | None
    timestamp: float


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


class VIMOrchestrator:
    """Coordinates scan loop, classification, and session updates."""

    def __init__(
        self,
        scanner_config: ScannerConfig | None = None,
        classifier_config: ClassifierConfig | None = None,
        session_config: SessionConfig | None = None,
        orchestrator_config: OrchestratorConfig | None = None,
    ):
        self._scanner_config = scanner_config or ScannerConfig()
        self._classifier_config = classifier_config or ClassifierConfig()
        self._session_config = session_config or SessionConfig()
        self._orch_config = orchestrator_config or OrchestratorConfig()

        self._model = None
        self._capture: cv2.VideoCapture | None = None
        self._running = False
        self._loop_task: asyncio.Task | None = None

    # -------------------------------------------------------------------
    # Model loading (lazy)
    # -------------------------------------------------------------------

    def _ensure_model(self):
        """Load YOLO model on first use."""
        if self._model is None:
            self._model = load_model(self._classifier_config)
        return self._model

    # -------------------------------------------------------------------
    # Camera source
    # -------------------------------------------------------------------

    def _open_capture(self) -> cv2.VideoCapture:
        """Open video capture based on source type."""
        src = self._orch_config.source_type

        if src == CameraSourceType.FILE:
            cap = cv2.VideoCapture(self._orch_config.video_file_path)
        elif src == CameraSourceType.WEBCAM:
            cap = cv2.VideoCapture(self._orch_config.camera_device_index)
        elif src == CameraSourceType.RTSP:
            cap = cv2.VideoCapture(self._orch_config.rtsp_url)
        elif src == CameraSourceType.API:
            raise NotImplementedError("API source requires frame queue (stub)")
        else:
            raise ValueError(f"Unknown source type: {src}")

        if not cap.isOpened():
            raise RuntimeError(f"Failed to open capture: {src.value}")

        self._capture = cap
        return cap

    def _get_frame(self) -> np.ndarray | None:
        """Read a single frame from the capture source.

        Returns BGR numpy array or None if no frame available.
        """
        if self._capture is None:
            self._open_capture()

        ret, frame = self._capture.read()
        if not ret:
            return None
        return frame

    def _release_capture(self) -> None:
        """Release the video capture resource."""
        if self._capture is not None:
            self._capture.release()
            self._capture = None

    # -------------------------------------------------------------------
    # Frame processing
    # -------------------------------------------------------------------

    def process_frame(
        self,
        frame: np.ndarray,
        session: TechnicianSession,
    ) -> ManifestUpdateEvent:
        """Run the two-layer pipeline on a frame and update the session manifest.

        Args:
            frame: BGR image (HxWx3 uint8).
            session: Current technician session.

        Returns:
            ManifestUpdateEvent with updated detections.
        """
        model = self._ensure_model()

        # Run scanner + classifier
        scan_result, class_result = scan_and_classify(
            frame,
            model,
            scanner_config=self._scanner_config,
            classifier_config=self._classifier_config,
        )

        # Update session manifest
        update_manifest(session, class_result.classifications, self._session_config)

        active = [d for d in session.component_manifest if d.status == "active"]

        return ManifestUpdateEvent(
            session_id=session.session_id,
            detections=active,
            manifest_size=len(active),
            timestamp=time.time(),
        )

    # -------------------------------------------------------------------
    # Component selection -> RAG query
    # -------------------------------------------------------------------

    def on_component_selected(
        self,
        session: TechnicianSession,
        detection: Detection,
    ) -> ProcedureQueryEvent:
        """Build a RAG query string for the selected component.

        Query format:
            "{class_name} {tm_reference} {equipment_context} maintenance procedure"
        Collapses multiple spaces. No "None" in output.
        """
        parts = [
            detection.classification.class_name,
            detection.tm_reference or "",
            session.equipment_context or "",
            "maintenance procedure",
        ]
        query = " ".join(parts)
        # Collapse multiple spaces
        query = re.sub(r"\s+", " ", query).strip()

        return ProcedureQueryEvent(
            session_id=session.session_id,
            query_string=query,
            selected_component=detection,
            equipment_context=session.equipment_context,
            timestamp=time.time(),
        )

    # -------------------------------------------------------------------
    # Async scan loop
    # -------------------------------------------------------------------

    async def start(self, session: TechnicianSession) -> None:
        """Start the async scan loop."""
        self._running = True
        self._ensure_model()
        self._open_capture()

        logger.info(
            "Scan loop started: interval=%.1fs, source=%s",
            self._orch_config.scan_interval_s,
            self._orch_config.source_type.value,
        )

        self._loop_task = asyncio.current_task()

        try:
            while self._running:
                frame = self._get_frame()
                if frame is None:
                    # Loop video for file source
                    if self._orch_config.source_type == CameraSourceType.FILE:
                        self._capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        frame = self._get_frame()
                    if frame is None:
                        break

                self.process_frame(frame, session)
                await asyncio.sleep(self._orch_config.scan_interval_s)
        finally:
            self._release_capture()

    def stop(self) -> None:
        """Stop the scan loop."""
        self._running = False
        logger.info("Scan loop stop requested")
