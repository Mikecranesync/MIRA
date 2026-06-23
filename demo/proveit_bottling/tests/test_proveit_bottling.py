"""ProveIt bottling demo tests — sim/live behavior, Hub bundle, evidence preservation, honesty."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent                 # demo/proveit_bottling/
DEMO = PKG.parent                 # demo/
ROOT = DEMO.parent                # worktree root
for _p in (str(PKG), str(DEMO), str(ROOT / "mqtt_uns")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import bottling_demo as bd  # noqa: E402
import conv_simple_demo as cs  # noqa: E402
import hub_bundle as hb  # noqa: E402
import run_proveit_demo as rp  # noqa: E402

MANIFEST = bd.conv_simple_manifest()


# --- Conv_Simple must remain green (commit c4cabee7) -------------------------------------------

def test_conv_simple_demo_still_passes():
    r = subprocess.run([sys.executable, str(DEMO / "run_demo.py")],
                       cwd=str(ROOT), capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "DEMO: OK" in r.stdout


def test_conv_simple_card_unchanged_by_reuse():
    # the bottling pe101 scenario reuses the real Conv_Simple card — same most-likely-cause
    scen = next(s for s in bd.load_scenarios()["scenarios"] if s["id"] == "pe101_blocked")
    card = bd.build_card(scen, MANIFEST)
    assert card["most_likely_cause"] == cs.build_answer_card(cs.FLAGSHIP, MANIFEST).most_likely_cause
    assert "photoeye" in card["most_likely_cause"].lower()


# --- runner: sim-only / live-cell --------------------------------------------------------------

def test_sim_only_returns_ok_and_excludes_live():
    rc = rp.main(["--sim-only", "--no-mqtt"])
    assert rc == 0
    txt = (PKG / "reports" / "scenario_map.md").read_text(encoding="utf-8")
    assert "filler_jam" in txt and "run" in txt
    assert "skipped (sim-only)" in txt  # live scenarios skipped in sim-only


def test_live_cell_optional_supervised_and_degrades(monkeypatch):
    monkeypatch.delenv("CONV_SIMPLE_LIVE_CELL", raising=False)  # bench offline
    rc = rp.main(["--live-cell", "--no-mqtt"])
    assert rc == 0  # missing/offline live cell never fails the demo
    lc = (PKG / "reports" / "live_cell_report.md").read_text(encoding="utf-8")
    assert "OFFLINE" in lc and "requires_supervision: **true**" in lc and "runs_24_7: **false**" in lc


def test_live_cell_online_when_flagged(monkeypatch):
    monkeypatch.setenv("CONV_SIMPLE_LIVE_CELL", "1")
    assert bd.live_cell_available() is True
    rc = rp.main(["--live-cell", "--no-mqtt"])
    assert rc == 0


def test_missing_live_cell_does_not_fail_demo(monkeypatch):
    monkeypatch.delenv("CONV_SIMPLE_LIVE_CELL", raising=False)
    assert bd.live_cell_available() is False
    assert rp.main(["--live-cell", "--no-mqtt"]) == 0


# --- Hub bundle --------------------------------------------------------------------------------

def test_hub_bundle_builds_with_supervision_and_uns():
    b = hb.build_bundle()
    for key in ("assets", "scenarios", "uns_map", "supervision", "evidence_links"):
        assert b[key], key
    sup = b["supervision"]["conv_simple"]
    assert sup["mode"] == "live_supervised_bench"
    assert sup["requires_supervision"] is True and sup["runs_24_7"] is False
    # every asset has a UNS in the map
    assert all("uns" in v and "mqtt_topic" in v for v in b["uns_map"].values())


def test_hub_export_writes_bundle_file():
    detail = hb.export_for_hub()
    assert hb.BUNDLE_PATH.exists()
    assert detail["asset_count"] >= 12 and detail["scenario_count"] >= 4


# --- evidence links preserved, no duplication --------------------------------------------------

def test_evidence_links_resolve_in_real_manifest():
    ids = {e["id"] for e in MANIFEST["evidence"]}
    links = bd.load_evidence_links()
    for refs in links["asset_evidence"].values():
        for rid in refs:
            assert rid in ids, f"evidence ref {rid} not in real manifest"
    # references the existing folder, does not duplicate it
    assert links["conv_simple_evidence"]["manifest"] == "demo/evidence/evidence_manifest.json"


def test_scenario_evidence_refs_resolve():
    ids = {e["id"] for e in MANIFEST["evidence"]}
    for s in bd.load_scenarios()["scenarios"]:
        for rid in s.get("evidence_refs", []):
            assert rid in ids, f"{s['id']} references unknown evidence {rid}"


# --- honesty: no invented models ---------------------------------------------------------------

def test_no_invented_models():
    by_key = {a["key"]: a for a in bd.load_assets()["assets"]}
    for k, a in by_key.items():
        if a["layer"] == "simulated":
            assert a["model"] == "SIMULATED", k
    assert by_key["conv_simple.photoeye_pe101"]["model"] == "UNKNOWN_MODEL"
    assert by_key["conv_simple.conveyor_motor"]["model"] == "UNKNOWN_MODEL"


def test_cards_do_not_assert_fabricated_sensor_makers():
    for s in bd.load_scenarios()["scenarios"]:
        rendered = bd.render_card(bd.build_card(s, MANIFEST)).lower()
        for fake in ("omron e3z", "banner ", "sick ", "keyence"):
            assert fake not in rendered, f"{s['id']} asserts unverified maker {fake}"


def test_simulated_cards_admit_no_oem_manual():
    scen = next(s for s in bd.load_scenarios()["scenarios"] if s["id"] == "filler_jam")
    rendered = bd.render_card(bd.build_card(scen, MANIFEST))
    assert "no OEM manual" in rendered


# --- UNS topics exist for all assets -----------------------------------------------------------

def test_every_asset_has_uns_topic_derived_from_path():
    for a in bd.load_assets()["assets"]:
        assert a["mqtt_topic"], a["key"]
        assert rp.event_topic(a["uns"]) == a["mqtt_topic"], a["key"]


# --- MQTT round trip preserves the card --------------------------------------------------------

def test_mqtt_round_trip_preserves_cards():
    for sid in ("filler_jam", "pe101_blocked"):
        s = next(x for x in bd.load_scenarios()["scenarios"] if x["id"] == sid)
        rt = rp.mqtt_round_trip(s, MANIFEST)
        assert rt["delivered"] == 1 and rt["match"] is True
        assert rt["topic"].startswith("enterprise/proveit/bottling/plant1/")
