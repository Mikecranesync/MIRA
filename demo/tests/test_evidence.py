"""Evidence folder is real, complete, and honest about unknown models."""
from __future__ import annotations

import json
import sys
from pathlib import Path

DEMO = Path(__file__).resolve().parents[1]
if str(DEMO) not in sys.path:
    sys.path.insert(0, str(DEMO))

EV = DEMO / "evidence"
ASSET_FOLDERS = ("vfd", "plc", "photoeye", "motor", "conveyor", "wiring-io")
VERIFIED_ASSET_KEYS = {"conveyor", "gs10_vfd", "micro820_plc", "photoeye_pe101", "conveyor_motor"}


def _manifest() -> dict:
    d = json.loads((EV / "evidence_manifest.json").read_text(encoding="utf-8"))
    d.pop("_comment", None)
    return d


def test_evidence_folder_and_readme_exist():
    assert EV.is_dir()
    assert (EV / "README.md").exists()


def test_every_asset_folder_has_notes():
    for f in ASSET_FOLDERS:
        assert (EV / f / "notes.md").exists(), f"missing demo/evidence/{f}/notes.md"


def test_known_models_have_official_manual_urls():
    assert (EV / "vfd" / "gs10-user-manual.url").exists()
    assert (EV / "vfd" / "gs10-fault-codes-ch06.url").exists()
    assert (EV / "plc" / "micro820-user-manual.url").exists()


def test_unknown_models_are_labeled_honestly():
    for f in ("photoeye", "motor"):
        text = (EV / f / "notes.md").read_text(encoding="utf-8")
        assert "UNKNOWN_MODEL" in text, f"{f} must be flagged UNKNOWN_MODEL, not fabricated"


def test_manifest_covers_all_verified_assets():
    m = _manifest()
    keys = {a["key"] for a in m["assets"]}
    assert keys == VERIFIED_ASSET_KEYS, keys
    # model_known flags match reality
    by_key = {a["key"]: a for a in m["assets"]}
    assert by_key["gs10_vfd"]["model_known"] is True
    assert by_key["micro820_plc"]["model_known"] is True
    assert by_key["photoeye_pe101"]["model_known"] is False
    assert by_key["conveyor_motor"]["model_known"] is False


def test_no_invented_part_numbers_for_unknown_models():
    m = _manifest()
    by_key = {a["key"]: a for a in m["assets"]}
    # the unknown-model assets must carry the honest marker, not a fabricated catalog number
    assert "UNKNOWN_MODEL" in by_key["photoeye_pe101"]["identity"]
    assert "UNKNOWN_MODEL" in by_key["conveyor_motor"]["identity"]


def test_every_evidence_item_points_at_a_real_asset_and_source():
    m = _manifest()
    keys = {a["key"] for a in m["assets"]}
    for e in m["evidence"]:
        assert e["asset"] in keys, e
        assert e["source"], e
        assert e["why_mira_uses_it"], e
        # local sources must actually exist in the repo
        if e["source_kind"] in ("local_repo", "local_note"):
            src = e["source"].rstrip("/")
            assert (DEMO.parent / src).exists(), f"local source missing: {src}"
