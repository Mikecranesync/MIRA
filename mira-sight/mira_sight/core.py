"""MIRA Sight wearable core — device-independent contract (PRD §6–§9, Phase 2).

Vendor-neutral: nothing in this module may import or reference a specific device.
Adapters (simulator, phone, halo) implement `WearableDevice`; the diagnostic side
consumes normalized `ObservationEpisode`s and emits `GlanceableCard`s.

Capability honesty (PRD §6.1): a capability the vendor has not officially
documented is `UNKNOWN`, never `UNSUPPORTED` — the distinction is load-bearing
for adapter qualification (PRD §12) and hard gate 5 (no capability marked
supported without proof).
"""

from __future__ import annotations

import enum
import itertools
import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol


class CapabilityState(str, enum.Enum):
    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"
    UNKNOWN = "unknown"
    REQUIRES_ENROLLMENT = "requires_enrollment"
    REQUIRES_HARDWARE = "requires_hardware"
    REQUIRES_LICENSE = "requires_license"
    DEPRECATED = "deprecated"


@dataclass(frozen=True)
class WearableCapabilities:
    """Explicit, runtime-discovered-where-possible capability model (PRD §6.1)."""

    camera_photo: CapabilityState = CapabilityState.UNKNOWN
    camera_video: CapabilityState = CapabilityState.UNKNOWN
    camera_streaming_preview: CapabilityState = CapabilityState.UNKNOWN
    photo_resolutions: tuple[str, ...] = ()
    audio_input: CapabilityState = CapabilityState.UNKNOWN
    audio_output: CapabilityState = CapabilityState.UNKNOWN
    audio_activity_detection: CapabilityState = CapabilityState.UNKNOWN
    display_available: CapabilityState = CapabilityState.UNKNOWN
    display_type: str = "unknown"  # monocular | binocular | none | unknown
    display_resolution: str = "unknown"
    spatial_anchors: CapabilityState = CapabilityState.UNKNOWN
    orientation: CapabilityState = CapabilityState.UNKNOWN
    raw_imu: CapabilityState = CapabilityState.UNKNOWN
    tap: CapabilityState = CapabilityState.UNKNOWN
    buttons: tuple[str, ...] = ()
    host_required: CapabilityState = CapabilityState.UNKNOWN
    custom_model_deployment: CapabilityState = CapabilityState.UNKNOWN
    rugged_rating: str = "unverified"
    hazardous_location: str = "not_verified"
    capture_indicator: CapabilityState = CapabilityState.UNKNOWN
    local_processing: CapabilityState = CapabilityState.UNKNOWN

    def require(self, name: str) -> None:
        """Fail EXPLICITLY when a needed capability isn't SUPPORTED (PRD Phase 2
        acceptance: unsupported capabilities fail explicitly, never silently)."""
        state = getattr(self, name)
        if state is not CapabilityState.SUPPORTED:
            raise CapabilityNotSupported(f"{name} is {state.value}, not supported")


class CapabilityNotSupported(RuntimeError):
    pass


class CaptureState(str, enum.Enum):
    """Adaptive capture state machine (PRD §8.1)."""

    IDLE = "IDLE"
    PASSIVE_CONTEXT = "PASSIVE_CONTEXT"
    FOCUSED_VIEW = "FOCUSED_VIEW"
    INSPECTION_BURST = "INSPECTION_BURST"
    ACTIVE_REPAIR = "ACTIVE_REPAIR"
    VERIFYING = "VERIFYING"
    PRIVACY_PAUSED = "PRIVACY_PAUSED"
    OFFLINE = "OFFLINE"
    ERROR = "ERROR"


# Transitions that are always legal regardless of current state.
_ALWAYS_LEGAL_TARGETS = {CaptureState.PRIVACY_PAUSED, CaptureState.OFFLINE, CaptureState.ERROR}

_LEGAL_TRANSITIONS: dict[CaptureState, set[CaptureState]] = {
    CaptureState.IDLE: {CaptureState.PASSIVE_CONTEXT, CaptureState.INSPECTION_BURST},
    CaptureState.PASSIVE_CONTEXT: {
        CaptureState.IDLE,
        CaptureState.FOCUSED_VIEW,
        CaptureState.INSPECTION_BURST,
    },
    CaptureState.FOCUSED_VIEW: {
        CaptureState.IDLE,
        CaptureState.PASSIVE_CONTEXT,
        CaptureState.INSPECTION_BURST,
    },
    CaptureState.INSPECTION_BURST: {
        CaptureState.ACTIVE_REPAIR,
        CaptureState.FOCUSED_VIEW,
        CaptureState.IDLE,
    },
    CaptureState.ACTIVE_REPAIR: {CaptureState.VERIFYING, CaptureState.IDLE},
    CaptureState.VERIFYING: {CaptureState.IDLE, CaptureState.ACTIVE_REPAIR},
    CaptureState.PRIVACY_PAUSED: {CaptureState.IDLE},
    CaptureState.OFFLINE: {CaptureState.IDLE, CaptureState.ERROR},
    CaptureState.ERROR: {CaptureState.IDLE},
}


def transition(current: CaptureState, target: CaptureState) -> CaptureState:
    if target in _ALWAYS_LEGAL_TARGETS or target in _LEGAL_TRANSITIONS.get(current, set()):
        return target
    raise IllegalTransition(f"{current.value} -> {target.value}")


class IllegalTransition(RuntimeError):
    pass


@dataclass
class CapturedFrame:
    """One captured photo with provenance. Media stays a reference — the core
    never owns raw bytes longer than the episode's retention allows."""

    observation_id: str
    captured_at_monotonic: float
    media_ref: str
    sha256: str
    orientation: dict[str, float] = field(default_factory=dict)
    quality: dict[str, float] = field(default_factory=dict)
    retention: str = "rolling"  # rolling | saved | discarded


@dataclass
class GlanceableCard:
    """Glasses card contract (PRD §9.2) — one primary action, no paragraphs."""

    title: str
    status: str = ""
    primary_instruction: str = ""
    secondary: str = ""
    confidence: float | None = None
    severity: str = "info"  # info | warning | safety
    evidence_available: bool = False
    requires_phone: bool = False
    expires_in_seconds: int = 20

    def render_text(self) -> str:
        """Deterministic text rendering for displays and snapshot tests.
        Safety outranks troubleshooting (PRD §9.3): severity prefixes the title."""
        prefix = {"safety": "⚠SAFETY ", "warning": "⚠ "}.get(self.severity, "")
        lines = [f"{prefix}{self.title}"]
        if self.status:
            lines.append(self.status)
        if self.primary_instruction:
            lines.append(f"> {self.primary_instruction}")
        if self.secondary:
            lines.append(self.secondary)
        if self.confidence is not None:
            lines.append(f"confidence {self.confidence:.0%}")
        return "\n".join(lines)


class EpisodeStatus(str, enum.Enum):
    EPHEMERAL = "ephemeral"
    SAVED = "saved"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


@dataclass
class ObservationEpisode:
    """In-memory episode (PRD §7.2 shape). Field names deliberately mirror the
    VisualSession spine so Phase 4 persistence maps 1:1 (ADR-0033 decision 2).

    Time is injected (monotonic floats from a caller-owned clock) so expiry is
    deterministic and testable."""

    episode_id: str
    started_at_monotonic: float
    trigger: str
    ttl_seconds: float = 15 * 60.0
    status: EpisodeStatus = EpisodeStatus.EPHEMERAL
    ended_at_monotonic: float | None = None
    adapter: str = "unknown"
    device_id_hash: str = ""
    utterance: str | None = None
    observations: list[CapturedFrame] = field(default_factory=list)
    asset_candidates: list[dict[str, Any]] = field(default_factory=list)
    user_actions: list[dict[str, Any]] = field(default_factory=list)
    retention_authorized_by: str | None = None

    def add_frame(self, frame: CapturedFrame) -> None:
        if self.status is not EpisodeStatus.EPHEMERAL and self.status is not EpisodeStatus.SAVED:
            raise RuntimeError(f"cannot add frames to a {self.status.value} episode")
        self.observations.append(frame)

    def save(self, authorized_by: str) -> None:
        """Explicit retention (PRD §7.3): permanence requires an identified human."""
        self.status = EpisodeStatus.SAVED
        self.retention_authorized_by = authorized_by
        for f in self.observations:
            if f.retention == "rolling":
                f.retention = "saved"

    def expire_if_due(self, now_monotonic: float) -> bool:
        """Ephemeral episodes expire; saved/approved ones never do. Expiry discards
        rolling media references (the media itself is the adapter's to purge)."""
        if (
            self.status is EpisodeStatus.EPHEMERAL
            and (now_monotonic - self.started_at_monotonic) >= self.ttl_seconds
        ):
            self.status = EpisodeStatus.EXPIRED
            for f in self.observations:
                if f.retention == "rolling":
                    f.retention = "discarded"
                    f.media_ref = ""
            return True
        return False


class WearableDevice(Protocol):
    """The adapter contract (PRD §6). Synchronous for Phase 2 simplicity — the
    Halo adapter (Phase 3) decides whether an async variant is warranted and, if
    so, wraps rather than forks this contract."""

    def device_id(self) -> str: ...
    def vendor(self) -> str: ...
    def model(self) -> str: ...
    def capabilities(self) -> WearableCapabilities: ...
    def connect(self) -> None: ...
    def disconnect(self) -> None: ...
    def capture_photo(self) -> CapturedFrame: ...
    def read_orientation(self) -> dict[str, float]: ...
    def show_card(self, card: GlanceableCard) -> None: ...
    def subscribe_user_actions(self, handler: Any) -> Any: ...


def new_episode_id() -> str:
    return str(uuid.uuid4())


class InspectFlow:
    """The vendor-neutral 'inspect this' flow (PRD §2.3 steps 1–4 for Phase 2):
    create episode -> bounded burst -> record orientation -> return episode.

    Perception/retrieval/diagnosis (steps 5+) attach in Phases 4–5 through the
    existing MIRA stack; this class must stay free of vendor and model logic."""

    def __init__(
        self, device: WearableDevice, *, burst_frames: int = 6, ttl_seconds: float = 900.0
    ):
        self.device = device
        self.burst_frames = burst_frames
        self.ttl_seconds = ttl_seconds
        self.state = CaptureState.IDLE

    def inspect(
        self, *, trigger: str, now_monotonic: float, utterance: str | None = None
    ) -> ObservationEpisode:
        caps = self.device.capabilities()
        caps.require("camera_photo")
        self.state = transition(self.state, CaptureState.INSPECTION_BURST)
        episode = ObservationEpisode(
            episode_id=new_episode_id(),
            started_at_monotonic=now_monotonic,
            trigger=trigger,
            ttl_seconds=self.ttl_seconds,
            adapter=self.device.vendor(),
            device_id_hash=self.device.device_id(),
            utterance=utterance,
        )
        for _ in itertools.islice(itertools.count(), self.burst_frames):
            frame = self.device.capture_photo()
            frame.orientation = self.device.read_orientation()
            episode.add_frame(frame)
        self.state = transition(self.state, CaptureState.IDLE)
        return episode

    def privacy_pause(self) -> None:
        self.state = transition(self.state, CaptureState.PRIVACY_PAUSED)

    def resume(self) -> None:
        self.state = transition(self.state, CaptureState.IDLE)
