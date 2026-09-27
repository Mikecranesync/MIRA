"""Owner decision 2026-09-27: a safety-classified turn is answered under a
hazard banner. The banner names the specific hazard (mirrors hazardBanner() in
mira-hub/src/lib/safety-classifier.ts)."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from shared.guardrails import hazard_banner  # noqa: E402


def test_incident_in_progress_leads_with_get_clear():
    for msg in ("the drive is arcing", "smoke coming from the panel", "the gs10 is arc flashing"):
        assert hazard_banner(msg).startswith("⚠️ Possible active incident."), msg


def test_specific_hazard_classes():
    assert "Energized electrical work" in hazard_banner("can i open the 480v panel while live")
    assert "Confined space" in hazard_banner("entering the confined space under the tank")
    assert "Stored pressure" in hazard_banner("bleed the hydraulic accumulator")
    assert "Moving machinery" in hazard_banner("reach past the guard on the conveyor")


def test_unclassified_trigger_still_gets_a_flag():
    assert hazard_banner("something else entirely").startswith("⚠️ Safety flag.")
