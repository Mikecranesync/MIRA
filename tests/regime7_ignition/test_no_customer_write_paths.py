"""Guard: the customer-shipped Ignition bundle must be read-only.

Doctrine: `docs/mira-ignition-secure-architecture.md` ("Read-only by default —
no WebDev or gateway-script path in MIRA's bundle calls system.tag.writeBlocking")
and `.claude/rules/fieldbus-readonly.md` (customer-shipped surfaces never write to
the plant). VFD control (speed setpoint, F/R/S, fault reset) is bench-only — it
lives in `plc/live_monitor.py` / the ConvSimpleLive bench project, never in the
shipped `ignition/project/` Perspective bundle.

This test fails if any shipped Perspective view re-introduces a plant write, so a
future edit can't silently turn the read-only HMI back into a control surface.
"""

from __future__ import annotations

import re
from pathlib import Path

# repo_root / tests / regime7_ignition / this_file  -> parents[2] == repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
SHIPPED_VIEWS = (
    REPO_ROOT / "ignition" / "project" / "com.inductiveautomation.perspective" / "views"
)

# Any Perspective tag-write API: writeBlocking / writeAsync / writeBlockingAsync / write
WRITE_CALL = re.compile(r"system\.tag\.write\w*")


def test_shipped_perspective_views_have_no_plant_write_paths() -> None:
    assert SHIPPED_VIEWS.is_dir(), f"shipped views dir missing: {SHIPPED_VIEWS}"

    offenders: list[str] = []
    for json_file in SHIPPED_VIEWS.rglob("*.json"):
        text = json_file.read_text(encoding="utf-8")
        if WRITE_CALL.search(text):
            offenders.append(str(json_file.relative_to(REPO_ROOT)))

    assert offenders == [], (
        "Customer-shipped Perspective views contain plant write paths "
        "(system.tag.write*). The shipped Ignition bundle is read-only; VFD "
        "control is bench-only (plc/live_monitor.py / ConvSimpleLive). "
        f"Offending files: {offenders}"
    )


def test_speed_control_view_is_not_shipped() -> None:
    """SpeedControl is a pure VFD control view; it must not be in the bundle."""
    assert not (SHIPPED_VIEWS / "SpeedControl").exists(), (
        "SpeedControl (VFD speed + F/R/S control) must not ship in the read-only "
        "customer bundle — it belongs on the bench."
    )
