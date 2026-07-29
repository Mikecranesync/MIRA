"""Unit tests for the VFD Analyzer auto-map pure modules.

Slice 1 of the auto-map phase (docs/specs/vfd-analyzer-auto-map-spec.md) decouples the
in-gateway analyzer from the hardcoded tag map by reading a per-asset config (Option A:
one Ignition Document/JSON tag). Two NEW pure, dual-Py (2.7 + 3.12-clean) modules carry
the logic:

  * signal_roles.py  -- the canonical signal-role catalog (single source of truth: the
    T_* topic constants in rules_core.py, plus display/kind/unit/divisor/requirement).
  * asset_config.py  -- load/validate the config JSON, build the read plan, and build the
    diagnose-core `snap` from the mapped tag values.

Following the standalone-module pattern already proven by rules_core.py / tag_topic_map.py
(neither imports the other; the gateway code.py wires them), asset_config does NOT import
signal_roles -- the catalog's valid/required key sets are passed in as params.

The headline guard is `test_seed_config_snap_equals_legacy_build_snap`: a config-driven
read of the live MIRA_IOCheck tags must produce the SAME snap the legacy LEAF_MAP path
produces -- so generalizing the seam cannot change behavior on the live conveyor.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
DIAG = REPO / "ignition" / "webdev" / "FactoryLM" / "api" / "diagnose"
SIGNAL_ROLES = DIAG / "signal_roles.py"
ASSET_CONFIG = DIAG / "asset_config.py"
TAG_TOPIC_MAP = DIAG / "tag_topic_map.py"


def _load(path, name):
    assert path.exists(), "missing module under test: %s" % path
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def sr():
    return _load(SIGNAL_ROLES, "signal_roles_uut")


@pytest.fixture(scope="module")
def ac():
    return _load(ASSET_CONFIG, "asset_config_uut")


@pytest.fixture(scope="module")
def legacy():
    return _load(TAG_TOPIC_MAP, "tag_topic_map_uut")


def _good_config():
    return {
        "schemaVersion": 1,
        "assetId": "drive3",
        "driveFamily": "GS10",
        "unsPath": "enterprise.garage.demo_cell.cv_101",
        "roles": {
            "vfd/vfd101/freq": {"tag": "[default]Plant/Line1/Drive3/AAA_Hz", "divisor": 100.0,
                                "source": "manual", "confidence": "verified"},
            "vfd/vfd101/current_a": {"tag": "[default]Plant/Line1/Drive3/AAA_I", "divisor": 100.0,
                                     "source": "manual", "confidence": "verified"},
            "vfd/vfd101/fault_code": {"tag": "[default]Plant/Line1/Drive3/AAA_Flt", "divisor": 1.0,
                                      "source": "manual", "confidence": "verified"},
        },
    }


# --------------------------- signal_roles.py ---------------------------

def test_required_keys_are_the_three_essentials(sr):
    assert set(sr.required_keys()) == {
        "vfd/vfd101/freq", "vfd/vfd101/current_a", "vfd/vfd101/fault_code"}


def test_valid_keys_cover_the_catalog(sr):
    vk = sr.valid_keys()
    assert "vfd/vfd101/freq" in vk
    assert "vfd/vfd101/dc_bus_v" in vk
    assert "totally/bogus/role" not in vk


def test_default_divisor_gs10(sr):
    assert sr.default_divisor("vfd/vfd101/freq", "GS10") == 100.0
    assert sr.default_divisor("vfd/vfd101/dc_bus_v", "GS10") == 10.0
    assert sr.default_divisor("vfd/vfd101/fault_code", "GS10") == 1.0


def test_default_divisor_generic_analog_is_unity(sr):
    # generic family assumes pre-scaled engineering tags -> analog divisor 1.0
    assert sr.default_divisor("vfd/vfd101/freq", "generic") == 1.0


def test_bool_role_default_divisor_is_none(sr):
    # comm_ok is a bool/passthrough role -> no scaling
    assert sr.default_divisor("vfd/vfd101/comm_ok", "GS10") is None


def test_role_lookup_carries_ui_fields(sr):
    r = sr.role("vfd/vfd101/freq")
    assert r["display"] == "Output frequency"
    assert r["kind"] == "analog"
    assert r["unit"] == "Hz"
    assert r["requirement"] == "required"
    assert r["rules"]  # non-empty list of consuming rules


# --------------------------- asset_config.py: load/validate ---------------------------

def test_load_accepts_dict(ac, sr):
    cfg = ac.load_config(_good_config(), valid_keys=sr.valid_keys())
    assert cfg["assetId"] == "drive3"
    assert "vfd/vfd101/freq" in cfg["roles"]


def test_load_accepts_json_string(ac, sr):
    cfg = ac.load_config(json.dumps(_good_config()), valid_keys=sr.valid_keys())
    assert cfg["assetId"] == "drive3"


def test_load_rejects_bad_schema_version(ac):
    bad = _good_config()
    bad["schemaVersion"] = 2
    with pytest.raises(ac.ConfigError):
        ac.load_config(bad)


def test_load_rejects_missing_asset_id(ac):
    bad = _good_config()
    del bad["assetId"]
    with pytest.raises(ac.ConfigError):
        ac.load_config(bad)


def test_load_rejects_unknown_role_key(ac, sr):
    bad = _good_config()
    bad["roles"]["totally/bogus/role"] = {"tag": "[default]X", "divisor": 1.0}
    with pytest.raises(ac.ConfigError):
        ac.load_config(bad, valid_keys=sr.valid_keys())


def test_load_rejects_role_missing_tag(ac):
    bad = _good_config()
    del bad["roles"]["vfd/vfd101/freq"]["tag"]
    with pytest.raises(ac.ConfigError):
        ac.load_config(bad)


def test_load_rejects_bad_divisor_type(ac):
    bad = _good_config()
    bad["roles"]["vfd/vfd101/freq"]["divisor"] = "lots"
    with pytest.raises(ac.ConfigError):
        ac.load_config(bad)


def test_load_allows_null_divisor_for_bool(ac):
    cfg = _good_config()
    cfg["roles"]["vfd/vfd101/comm_ok"] = {"tag": "[default]X/comm", "divisor": None}
    out = ac.load_config(cfg)
    assert out["roles"]["vfd/vfd101/comm_ok"]["divisor"] is None


def test_load_corrupt_json_raises_config_error(ac):
    with pytest.raises(ac.ConfigError):
        ac.load_config("{not valid json")


# --------------------------- asset_config.py: read plan + snap ---------------------------

def test_read_plan_parallel_and_deterministic(ac):
    cfg = ac.load_config(_good_config())
    paths, plan = ac.read_plan(cfg)
    assert len(paths) == len(plan) == 3
    # plan entries are (topic, divisor), parallel to paths
    topics = [t for (t, _d) in plan]
    assert topics == sorted(topics)  # deterministic ordering (by topic)
    # the path for the freq topic is the freq tag
    freq_i = topics.index("vfd/vfd101/freq")
    assert paths[freq_i] == "[default]Plant/Line1/Drive3/AAA_Hz"


def test_read_plan_only_includes_mapped_roles(ac):
    cfg = ac.load_config(_good_config())
    paths, plan = ac.read_plan(cfg)
    assert "vfd/vfd101/dc_bus_v" not in [t for (t, _d) in plan]


def test_build_snap_scales_by_divisor(ac):
    plan = [("vfd/vfd101/freq", 100.0), ("vfd/vfd101/cmd_word", 1.0),
            ("vfd/vfd101/comm_ok", None)]
    snap = ac.build_snap_from_plan(plan, [4730, 18, True])
    assert snap["vfd/vfd101/freq"] == 47.3
    assert snap["vfd/vfd101/cmd_word"] == 18      # 1.0 divisor = int passthrough
    assert snap["vfd/vfd101/comm_ok"] is True     # None divisor = bool passthrough


def test_build_snap_passes_none_value_through(ac):
    plan = [("vfd/vfd101/freq", 100.0)]
    snap = ac.build_snap_from_plan(plan, [None])
    assert snap["vfd/vfd101/freq"] is None


def test_required_unmapped_reports_gaps(ac, sr):
    cfg = _good_config()
    del cfg["roles"]["vfd/vfd101/fault_code"]
    loaded = ac.load_config(cfg)
    missing = ac.required_unmapped(loaded, sr.required_keys())
    assert missing == ["vfd/vfd101/fault_code"]


def test_required_unmapped_empty_when_all_present(ac, sr):
    loaded = ac.load_config(_good_config())
    assert ac.required_unmapped(loaded, sr.required_keys()) == []


# --------------------------- the headline no-regression guard ---------------------------

# Live MIRA_IOCheck/VFD leaves + representative raw values (counts) the bench publishes.
_LIVE_LEAVES = [
    "vfd_frequency", "vfd_current", "vfd_dc_bus", "vfd_freq_cmd",
    "vfd_cmd_word", "vfd_fault_code", "vfd_comm_ok",
]
_LIVE_VALUES = {
    "vfd_frequency": 4730, "vfd_current": 210, "vfd_dc_bus": 3240,
    "vfd_freq_cmd": 3000, "vfd_cmd_word": 18, "vfd_fault_code": 0, "vfd_comm_ok": True,
}


def test_seed_config_snap_equals_legacy_build_snap(ac, sr, legacy):
    """A config built from LEAF_MAP for the live tags must reproduce the legacy snap byte-for-byte.

    This is the proof that making the seam config-driven does NOT change behavior on the live
    ConvSimpleLive conveyor (the seed config = today's effective map)."""
    folder = "[default]MIRA_IOCheck/VFD"
    roles = {}
    for leaf in _LIVE_LEAVES:
        topic, divisor = legacy.LEAF_MAP[leaf]
        roles[topic] = {"tag": folder + "/" + leaf, "divisor": divisor,
                        "source": "seed", "confidence": "verified"}
    seed = {"schemaVersion": 1, "assetId": "conveyor", "driveFamily": "GS10",
            "unsPath": "enterprise.garage.demo_cell.cv_101", "roles": roles}

    cfg = ac.load_config(seed, valid_keys=sr.valid_keys())
    paths, plan = ac.read_plan(cfg)
    values = [_LIVE_VALUES[p.rsplit("/", 1)[1]] for p in paths]
    config_snap = ac.build_snap_from_plan(plan, values)

    legacy_snap = legacy.build_snap([(leaf, _LIVE_VALUES[leaf]) for leaf in _LIVE_LEAVES])

    assert config_snap == legacy_snap
