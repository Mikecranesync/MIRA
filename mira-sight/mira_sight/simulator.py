"""Simulator adapter (PRD §6.2) — deterministic wearable for tests and demos.

Everything is injectable and reproducible: frame sequences, orientation playback,
button events, disconnects, and a caller-controlled monotonic clock. No network,
no hardware, no wall clock.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from .core import (
    CapabilityState,
    CapturedFrame,
    GlanceableCard,
    WearableCapabilities,
)

SIMULATOR_CAPABILITIES = WearableCapabilities(
    camera_photo=CapabilityState.SUPPORTED,
    camera_video=CapabilityState.UNSUPPORTED,
    camera_streaming_preview=CapabilityState.UNSUPPORTED,
    photo_resolutions=("640x480",),
    audio_input=CapabilityState.SUPPORTED,
    audio_output=CapabilityState.SUPPORTED,
    audio_activity_detection=CapabilityState.SUPPORTED,
    display_available=CapabilityState.SUPPORTED,
    display_type="monocular",
    display_resolution="256x256",
    spatial_anchors=CapabilityState.UNSUPPORTED,
    orientation=CapabilityState.SUPPORTED,
    raw_imu=CapabilityState.SUPPORTED,
    tap=CapabilityState.SUPPORTED,
    buttons=("single", "double", "long"),
    host_required=CapabilityState.SUPPORTED,
    custom_model_deployment=CapabilityState.UNKNOWN,
    capture_indicator=CapabilityState.SUPPORTED,
    local_processing=CapabilityState.SUPPORTED,
)


@dataclass
class SimulatedClock:
    """Deterministic monotonic time (PRD §6.2 'time control')."""

    now: float = 0.0

    def advance(self, seconds: float) -> float:
        self.now += seconds
        return self.now


class SimulatorDisconnected(RuntimeError):
    pass


@dataclass
class SimulatorAdapter:
    """Deterministic image sequences + synthetic events + failure injection."""

    frames: list[bytes] = field(default_factory=list)
    orientations: list[dict[str, float]] = field(default_factory=list)
    clock: SimulatedClock = field(default_factory=SimulatedClock)
    battery_pct: int = 100
    connected: bool = False
    _frame_cursor: int = 0
    _orient_cursor: int = 0
    shown_cards: list[GlanceableCard] = field(default_factory=list)
    _action_handlers: list = field(default_factory=list)
    _media: dict[str, bytes] = field(default_factory=dict)

    # -- identity -----------------------------------------------------------
    def device_id(self) -> str:
        return "sim-" + hashlib.sha256(b"mira-sight-simulator").hexdigest()[:12]

    def vendor(self) -> str:
        return "simulator"

    def model(self) -> str:
        return "sim-1"

    def capabilities(self) -> WearableCapabilities:
        return SIMULATOR_CAPABILITIES

    # -- session ------------------------------------------------------------
    def connect(self) -> None:
        self.connected = True

    def disconnect(self) -> None:
        self.connected = False

    def simulate_drop(self) -> None:
        """Failure injection: BLE drop mid-session."""
        self.connected = False

    def simulate_low_battery(self, pct: int) -> None:
        self.battery_pct = pct

    # -- capture ------------------------------------------------------------
    def capture_photo(self) -> CapturedFrame:
        if not self.connected:
            raise SimulatorDisconnected("capture_photo while disconnected")
        if not self.frames:
            raise SimulatorDisconnected("no frames loaded in simulator")
        data = self.frames[self._frame_cursor % len(self.frames)]
        self._frame_cursor += 1
        sha = hashlib.sha256(data).hexdigest()
        ref = f"sim://frame/{sha[:16]}"
        self._media[ref] = data
        self.clock.advance(0.4)  # BLE photo transfer is not free
        return CapturedFrame(
            observation_id=f"obs-{self._frame_cursor:04d}",
            captured_at_monotonic=self.clock.now,
            media_ref=ref,
            sha256=sha,
            quality={"bytes": float(len(data))},
        )

    def read_orientation(self) -> dict[str, float]:
        if not self.orientations:
            return {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}
        o = self.orientations[self._orient_cursor % len(self.orientations)]
        self._orient_cursor += 1
        return dict(o)

    # -- output -------------------------------------------------------------
    def show_card(self, card: GlanceableCard) -> None:
        if not self.connected:
            raise SimulatorDisconnected("show_card while disconnected")
        self.shown_cards.append(card)

    # -- events -------------------------------------------------------------
    def subscribe_user_actions(self, handler) -> None:
        self._action_handlers.append(handler)

    def press(self, button: str) -> None:
        """Synthetic button event: 'single' | 'double' | 'long' | 'tap'."""
        for h in list(self._action_handlers):
            h({"type": "button", "button": button, "at": self.clock.now})

    # -- retention plumbing --------------------------------------------------
    def purge_media(self, refs: list[str]) -> int:
        """Discard raw media for expired/discarded frames. Returns purge count."""
        n = 0
        for r in refs:
            if r in self._media:
                del self._media[r]
                n += 1
        return n
