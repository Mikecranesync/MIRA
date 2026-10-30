"""tools/work-packet/build_packet.py — labeled Work Packet builder.

Uses the committed draft packet fixture (synthetic work order; public
manufacturer document references only). Mutation harness: WORK_PACKET_MODULE
may point at a deliberately broken copy (.claude/rules/prove-the-test-fails.md).
"""

from __future__ import annotations

import copy
import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = Path(
    os.environ.get("WORK_PACKET_MODULE", ROOT / "tools" / "work-packet" / "build_packet.py")
)
FIXTURE = ROOT / "tools" / "work-packet" / "fixtures" / "draft-packet-5cp6120.json"


def _load():
    spec = importlib.util.spec_from_file_location("build_packet", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["build_packet"] = mod
    spec.loader.exec_module(mod)
    return mod


bp = _load()


@pytest.fixture
def packet():
    return json.loads(FIXTURE.read_text())


def test_fixture_validates_and_counts_labels(packet):
    assert bp.validate(packet) == []
    s = bp.summarize(packet)
    assert (
        s["labels"]["verified"] >= 10
        and s["labels"]["proposed"] >= 10
        and s["labels"]["unknown"] >= 4
    )
    assert s["approved_for_use"] is False
    assert s["isolation_signoff"] == "required"


def test_verified_without_source_is_rejected(packet):
    bad = copy.deepcopy(packet)
    bad["measurements"][0].pop("source")
    assert any("verified without a source" in p for p in bp.validate(bad))


def test_unknown_with_value_and_bad_label_are_rejected(packet):
    bad = copy.deepcopy(packet)
    bad["job"]["serial"]["value"] = "SN-123"
    bad["steps"]["items"][0]["label"] = "approved"
    probs = bp.validate(bad)
    assert any("unknown but carries a value" in p for p in probs)
    assert any("label 'approved'" in p for p in probs)


def test_generated_isolation_steps_are_rejected(packet):
    bad = copy.deepcopy(packet)
    bad["safety"]["isolation"]["generated_steps"] = ["open breaker"]
    assert any("isolation is site-owned" in p for p in bp.validate(bad))


def test_edits_set_confirm_strike_and_review_state(packet):
    edits = [
        {
            "path": "job.seal_material_suffix",
            "action": "set",
            "value": "NBR (standard)",
            "by": "Demo Technician",
            "at": "2026-10-30T14:00:00Z",
            "note": "nameplate has no suffix",
        },
        {
            "path": "measurements[1]",
            "action": "confirm",
            "by": "Demo Technician",
            "at": "2026-10-30T14:01:00Z",
        },
        {
            "path": "steps.items[3]",
            "action": "strike",
            "by": "Demo Technician",
            "at": "2026-10-30T14:02:00Z",
            "note": "valves were replaced last month",
        },
    ]
    out = bp.apply_edits(copy.deepcopy(packet), edits)
    suffix = out["job"]["seal_material_suffix"]
    assert suffix["value"] == "NBR (standard)" and suffix["label"] == "proposed"
    assert suffix["review"] == {
        "by": "Demo Technician",
        "at": "2026-10-30T14:00:00Z",
        "action": "set",
    }
    assert out["measurements"][1]["review"]["action"] == "confirm"
    assert out["steps"]["items"][3]["struck"] is True
    rv = out["approval"]["technician_review"]
    assert rv["state"] == "reviewed" and rv["by"] == "Demo Technician" and len(rv["edits"]) == 3
    assert bp.validate(out) == []
    s = bp.summarize(out)
    assert s["struck"] == 1 and s["approved_for_use"] is False  # a review is not an approval


def test_edit_without_author_or_with_unknown_action_is_rejected(packet):
    with pytest.raises(ValueError):
        bp.apply_edits(
            copy.deepcopy(packet),
            [{"path": "steps.items[0]", "action": "confirm", "by": "", "at": "x"}],
        )
    with pytest.raises(ValueError):
        bp.apply_edits(
            copy.deepcopy(packet),
            [{"path": "steps.items[0]", "action": "approve", "by": "a", "at": "x"}],
        )


def test_html_marks_draft_isolation_and_labels(packet):
    html = bp.to_html(packet, ":root{--fl-ok:x}")
    assert "DRAFT — reviewed by a technician only when marked" in html
    assert "Isolation — site procedure required" in html
    assert "badge-unknown" in html and "badge-verified" in html and "badge-proposed" in html
    assert "870 in-lb" in html and "33628" in html
    assert "<script" not in html
    approved = copy.deepcopy(packet)
    approved["approval"]["supervisor_approval"].update(
        {"state": "approved", "by": "Demo Supervisor", "at": "2026-10-30"}
    )
    assert "DRAFT — reviewed" not in bp.to_html(approved, "")


def test_html_escapes_untrusted_text(packet):
    hot = copy.deepcopy(packet)
    hot["steps"]["items"][0]["text"] = "<img src=x onerror=alert(1)>"
    html = bp.to_html(hot, "")
    assert "<img src=x" not in html and "&lt;img src=x" in html


def test_markdown_has_steps_sources_and_signoff(packet):
    md = bp.to_markdown(packet)
    assert md.startswith("# Work Packet WO-DEMO-0001")
    assert "DRAFT — not approved for use." in md
    assert "14. Return to service" in md
    assert "- DS: CAT Pumps 5CP6120" in md
    assert "- supervisor approval: pending" in md


def test_cli_writes_all_outputs_and_fails_on_invalid(tmp_path, packet):
    out = tmp_path / "out"
    assert bp.main([str(FIXTURE), "--out", str(out)]) == 0
    for name in ("packet.reviewed.json", "packet.html", "packet.md", "summary.json"):
        assert (out / name).exists()
    bad = tmp_path / "bad.json"
    broken = copy.deepcopy(packet)
    broken["measurements"][0].pop("source")
    bad.write_text(json.dumps(broken))
    assert bp.main([str(bad), "--out", str(tmp_path / "out2")]) == 1
    assert not (tmp_path / "out2" / "packet.html").exists()
