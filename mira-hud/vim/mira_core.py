"""Socket.IO client bridge — connects VIM Python to server.js.

Emits vision overlay data and manifest updates to the HUD frontend via
the server.js Socket.IO relay. Handles incoming techQuery and sessionReset
events from the HUD.

Usage:
    from vim.mira_core import VIMBridge

    bridge = VIMBridge("http://localhost:3000", orchestrator, session)
    await bridge.connect()
    await bridge.emit_vision_update(overlay_frame)
"""

from __future__ import annotations

import logging

import socketio

from .ar_renderer import OverlayFrame
from .orchestrator import VIMOrchestrator
from .session import (
    Detection,
    TechnicianSession,
    reset_session,
)

logger = logging.getLogger("vim-bridge")


class VIMBridge:
    """Socket.IO client bridge between VIM Python and server.js."""

    def __init__(
        self,
        server_url: str,
        vim_orchestrator: VIMOrchestrator,
        vim_session: TechnicianSession,
    ):
        self._server_url = server_url
        self._orchestrator = vim_orchestrator
        self._session = vim_session
        self._sio = socketio.AsyncClient(logger=False, engineio_logger=False)

        # Register event handlers
        self._sio.on("techQuery", self.on_tech_query)
        self._sio.on("sessionReset", self.on_session_reset)

    async def connect(self) -> None:
        """Connect to the server.js Socket.IO server."""
        logger.info("Connecting to %s", self._server_url)
        await self._sio.connect(self._server_url)
        logger.info("Connected: sid=%s", self._sio.sid)

    async def disconnect(self) -> None:
        """Disconnect cleanly."""
        if self._sio.connected:
            await self._sio.disconnect()
            logger.info("Disconnected from server")

    async def emit_vision_update(self, overlay_frame: OverlayFrame) -> None:
        """Emit vim_overlay event with overlay frame serialized to dict."""
        data = self._serialize_overlay(overlay_frame)
        await self._sio.emit("vim_overlay", data)

    async def emit_manifest(self, session: TechnicianSession) -> None:
        """Emit visionUpdate event with component manifest list."""
        manifest = []
        for det in session.component_manifest:
            if det.status == "active":
                manifest.append(
                    {
                        "detection_id": det.detection_id,
                        "class_name": det.classification.class_name,
                        "confidence": det.classification.confidence,
                        "bbox": {
                            "x": det.classification.bbox.x,
                            "y": det.classification.bbox.y,
                            "w": det.classification.bbox.w,
                            "h": det.classification.bbox.h,
                        },
                        "status": det.status,
                        "tm_reference": det.tm_reference,
                    }
                )
        await self._sio.emit(
            "visionUpdate",
            {
                "session_id": session.session_id,
                "manifest": manifest,
                "equipment_context": session.equipment_context,
            },
        )

    def on_tech_query(self, data: dict) -> None:
        """Handle techQuery event from HUD.

        If query text contains a known component class name, trigger
        component selection on the orchestrator.
        """
        query_text = data.get("query_text", "") if isinstance(data, dict) else str(data)
        logger.info("techQuery received: %s", query_text[:100])

        # Check if any active manifest component is mentioned in the query
        matched_detection: Detection | None = None
        query_lower = query_text.lower()

        for det in self._session.component_manifest:
            if det.status != "active":
                continue
            class_name = det.classification.class_name.lower()
            # Match on class name or human-readable version
            human_name = class_name.replace("_", " ")
            if class_name in query_lower or human_name in query_lower:
                matched_detection = det
                break

        if matched_detection:
            logger.info(
                "Component matched in query: %s", matched_detection.classification.class_name
            )
            self._orchestrator.on_component_selected(self._session, matched_detection)

    def on_session_reset(self, data: dict | None = None) -> None:
        """Handle sessionReset event — reset session to IDLE."""
        logger.info("sessionReset received")
        reset_session(self._session)

    @staticmethod
    def _serialize_overlay(frame: OverlayFrame) -> dict:
        """Serialize OverlayFrame to a plain dict for Socket.IO emission."""
        return {
            "mode": frame.mode,
            "bounding_boxes": [
                {
                    "box": {
                        "x": ab.box.x,
                        "y": ab.box.y,
                        "w": ab.box.w,
                        "h": ab.box.h,
                    },
                    "label": ab.label,
                    "confidence": ab.confidence,
                    "color": ab.color,
                    "selected": ab.selected,
                }
                for ab in frame.bounding_boxes
            ],
            "hud_manifest": frame.hud_manifest,
            "procedure_step": frame.procedure_step,
            "procedure_progress": frame.procedure_progress,
            "diagram_image": frame.diagram_image,
            "warnings": frame.warnings,
            "cautions": frame.cautions,
            "mode_indicator": frame.mode_indicator,
        }
