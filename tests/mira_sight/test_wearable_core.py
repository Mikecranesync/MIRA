"""Phase 2 acceptance tests — wearable core + simulator (PRD §13 Phase 2).

Acceptance criteria under test:
- complete inspect flow works without physical glasses;
- disconnect/offline behavior is explicit;
- unsupported capabilities fail explicitly;
- no vendor logic leaks into the diagnostic core;
- unsaved episodes expire and their media is purged; saved episodes survive.
"""

from __future__ import annotations

import dataclasses
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "mira-sight"))

from mira_sight.core import (  # noqa: E402
    CapabilityNotSupported,
    CapabilityState,
    CaptureState,
    EpisodeStatus,
    GlanceableCard,
    IllegalTransition,
    InspectFlow,
    transition,
)
from mira_sight.simulator import (  # noqa: E402
    SIMULATOR_CAPABILITIES,
    SimulatorAdapter,
    SimulatorDisconnected,
)

FRAMES = [b"frame-a" * 100, b"frame-b" * 100, b"frame-c" * 100]
ORIENTS = [{"yaw": 10.0, "pitch": -2.0, "roll": 0.5}, {"yaw": 12.0, "pitch": -1.0, "roll": 0.4}]


def _sim() -> SimulatorAdapter:
    sim = SimulatorAdapter(frames=list(FRAMES), orientations=list(ORIENTS))
    sim.connect()
    return sim


def test_inspect_flow_end_to_end_without_hardware():
    sim = _sim()
    flow = InspectFlow(sim, burst_frames=5)
    episode = flow.inspect(trigger="double_click", now_monotonic=sim.clock.now)
    assert episode.status is EpisodeStatus.EPHEMERAL
    assert len(episode.observations) == 5
    assert all(f.sha256 and f.media_ref.startswith("sim://") for f in episode.observations)
    assert episode.observations[0].orientation["yaw"] == 10.0
    assert episode.adapter == "simulator"
    assert flow.state is CaptureState.IDLE  # burst returns to idle (power-save)
    # card round-trip
    card = GlanceableCard(
        title="PF525",
        status="FAULT F005",
        primary_instruction="Inspect DC bus",
        secondary="Expected 650-780 VDC",
        confidence=0.91,
        severity="warning",
    )
    sim.show_card(card)
    assert sim.shown_cards[-1].title == "PF525"
    assert "⚠ PF525" in card.render_text()


def test_unsupported_capability_fails_explicitly():
    sim = _sim()
    broken = dataclasses.replace(SIMULATOR_CAPABILITIES, camera_photo=CapabilityState.UNKNOWN)
    sim.capabilities = lambda: broken  # type: ignore[method-assign]
    flow = InspectFlow(sim)
    with pytest.raises(CapabilityNotSupported, match="camera_photo is unknown"):
        flow.inspect(trigger="double_click", now_monotonic=0.0)


def test_unknown_is_not_false():
    caps = SIMULATOR_CAPABILITIES
    assert caps.custom_model_deployment is CapabilityState.UNKNOWN
    assert caps.custom_model_deployment is not CapabilityState.UNSUPPORTED


def test_disconnect_mid_session_is_explicit():
    sim = _sim()
    flow = InspectFlow(sim, burst_frames=3)
    sim.simulate_drop()
    with pytest.raises(SimulatorDisconnected):
        flow.inspect(trigger="double_click", now_monotonic=sim.clock.now)


def test_episode_expiry_purges_rolling_media_saved_survives():
    sim = _sim()
    flow = InspectFlow(sim, burst_frames=2, ttl_seconds=60.0)
    ep1 = flow.inspect(trigger="double_click", now_monotonic=sim.clock.now)
    ep2 = flow.inspect(trigger="voice", now_monotonic=sim.clock.now, utterance="save this")
    ep2.save(authorized_by="tech-1")

    sim.clock.advance(120.0)
    assert ep1.expire_if_due(sim.clock.now) is True
    assert ep1.status is EpisodeStatus.EXPIRED
    assert all(f.retention == "discarded" and f.media_ref == "" for f in ep1.observations)
    assert ep2.expire_if_due(sim.clock.now) is False  # saved never expires
    assert ep2.retention_authorized_by == "tech-1"
    assert all(f.retention == "saved" for f in ep2.observations)


def test_capture_state_machine_guards():
    assert (
        transition(CaptureState.IDLE, CaptureState.INSPECTION_BURST)
        is CaptureState.INSPECTION_BURST
    )
    # privacy pause is reachable from anywhere...
    assert (
        transition(CaptureState.INSPECTION_BURST, CaptureState.PRIVACY_PAUSED)
        is CaptureState.PRIVACY_PAUSED
    )
    # ...but arbitrary jumps are not
    with pytest.raises(IllegalTransition):
        transition(CaptureState.IDLE, CaptureState.VERIFYING)


def test_privacy_pause_blocks_capture_until_resume():
    sim = _sim()
    flow = InspectFlow(sim, burst_frames=1)
    flow.privacy_pause()
    with pytest.raises(IllegalTransition):
        flow.inspect(trigger="double_click", now_monotonic=sim.clock.now)
    flow.resume()
    ep = flow.inspect(trigger="double_click", now_monotonic=sim.clock.now)
    assert len(ep.observations) == 1


def test_button_events_reach_subscribers():
    sim = _sim()
    seen: list[dict] = []
    sim.subscribe_user_actions(seen.append)
    sim.press("double")
    assert seen and seen[0]["button"] == "double"


def test_no_vendor_symbols_in_core():
    """PRD §4.1 / Phase 2 acceptance: the diagnostic core is vendor-free.

    Scans CODE tokens only (identifiers, strings-as-values excluded via tokenize
    NAME tokens) — docstrings may mention adapters by name; logic may not."""
    import io
    import tokenize

    src = (REPO_ROOT / "mira-sight/mira_sight/core.py").read_bytes()
    names = {
        tok.string.lower()
        for tok in tokenize.tokenize(io.BytesIO(src).readline)
        if tok.type == tokenize.NAME
    }
    for vendor_word in ("halo", "brilliant", "realwear", "vuzix", "openxr"):
        assert vendor_word not in names, f"vendor identifier leaked into core: {vendor_word!r}"
