"""
Tests for the CV-101 raw -> approved context model -> maintenance answer demo.

Proves the demo works offline (replay/fixture mode, no PLC), that the approved context
model loads and maps raw registers into named + scaled maintenance signals, that the
maintenance answer is grounded, and -- critically -- that MIRA REFUSES to assert facts
about signals that are not in the approved map. No test touches the internal Litmus
:8094 read path.

Run:  pytest plc/litmus/test_demo_context_model.py -q
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import demo_context_model as demo  # noqa: E402
import rules  # noqa: E402  (made importable by demo's sys.path insert)

REQUIRED_SIGNALS = {
    "motor_running", "vfd_comm_ok", "e_stop_active", "estop_wiring_fault",
    "vfd_frequency", "vfd_current", "vfd_voltage", "vfd_dc_bus",
    "vfd_cmd_word", "vfd_status_word", "vfd_fault_code",
}
REQUIRED_COMPONENTS = {"motor101", "vfd101", "estop", "belt", "photo_eye"}


@pytest.fixture(scope="module")
def model():
    return demo.load_model()


# --------------------------------------------------------------------------- #
# 1. model loads + required entities present
# --------------------------------------------------------------------------- #
def test_model_loads(model):
    for key in ("asset", "plc", "drive", "components", "signals", "unmapped", "maintenance_question"):
        assert key in model, "context model missing top-level key: %s" % key
    assert model["asset"]["id"] == "CV-101"
    assert model["approval"]["status"] == "approved"


def test_required_components_and_signals_present(model):
    comp_ids = {c["id"] for c in model["components"]}
    assert REQUIRED_COMPONENTS <= comp_ids, "missing components: %s" % (REQUIRED_COMPONENTS - comp_ids)
    sig_names = {s["name"] for s in model["signals"]}
    assert REQUIRED_SIGNALS <= sig_names, "missing signals: %s" % (REQUIRED_SIGNALS - sig_names)


def test_every_signal_carries_evidence_and_approval(model):
    for s in model["signals"]:
        assert s["topic"] and s["component"], "signal %s missing topic/component" % s["name"]
        assert s["source"]["register_class"] in ("H", "C")
        assert s["evidence"]["source_type"] and s["evidence"]["confidence"]
        assert s["approval_status"] in ("approved", "proposed")


# --------------------------------------------------------------------------- #
# 2. raw -> named signal mapping + scaling
# --------------------------------------------------------------------------- #
def test_raw_to_named_signal_mapping(model):
    raw, _ = demo.load_replay("cv101_idle_healthy")
    snap, rows = demo.map_to_signals(model, raw)
    # every provisioned register became a named topic
    assert rules.T_RUN in snap and rules.T_DCBUS in snap and rules.T_CMD in snap
    # bool coils mapped to bools
    assert snap[rules.T_RUN] is False
    assert snap[rules.T_COMM] is True
    # the mapping table records source + approval for accountability
    dcb_row = next(r for r in rows if r["signal"] == "vfd_dc_bus")
    assert dcb_row["approval"] == "approved"
    assert "@109" in dcb_row["source"]


def test_scaling_and_units_applied(model):
    raw, _ = demo.load_replay("cv101_idle_healthy")
    snap, _ = demo.map_to_signals(model, raw)
    # HR109 raw 3215, divisor 10 -> 321.5 V
    assert snap[rules.T_DCBUS] == pytest.approx(321.5)
    # HR106 raw 0, divisor 100 -> 0.0 Hz
    assert snap[rules.T_FREQ] == pytest.approx(0.0)
    # cmd_word divisor 1.0 stays an int (STOP = 1)
    assert snap[rules.T_CMD] == 1 and isinstance(snap[rules.T_CMD], int)


# --------------------------------------------------------------------------- #
# 3. grounded answer (idle) + refusal of unmapped facts
# --------------------------------------------------------------------------- #
def test_idle_answer_is_grounded_and_calls_it_not_a_fault():
    r = demo.run_demo("replay", "cv101_idle_healthy", write=False)
    assert r["anomalies"] == []
    ans = r["answer"]
    assert ans["state"]["running"] is False
    assert ans["state"]["commanded_run"] is False
    low = ans["answer"].lower()
    assert "not being commanded to run" in low
    assert "not a fault" in low


def test_refuses_to_assert_unmapped_photoeye():
    r = demo.run_demo("replay", "cv101_idle_healthy", write=False)
    ans = r["answer"]
    # MIRA must explicitly decline the photo-eye (unmapped), not silently omit it
    assert any("photo_eye" in ref for ref in ans["refusals"])
    # and it must not have fired the photo-eye rule from a missing signal
    assert not any(a["rule_id"] == "A12_PHOTOEYE_JAM" for a in ans["anomalies"])
    # the answer text must not claim a jam it cannot see
    assert "jam" not in ans["answer"].lower()


# --------------------------------------------------------------------------- #
# 4. comm-down fault: A1 fires, downstream VFD rules suppressed as stale
# --------------------------------------------------------------------------- #
def test_comm_down_flags_a1_and_suppresses_stale_vfd_rules():
    r = demo.run_demo("replay", "cv101_comm_down", write=False)
    anoms = r["answer"]["anomalies"]  # dict form (Anomaly.to_dict)
    rule_ids = {a["rule_id"] for a in anoms}
    assert "A1_COMM_STALE" in rule_ids
    top = [a for a in anoms if a["rule_id"] == "A1_COMM_STALE"][0]
    assert top["severity"] == "CRITICAL"
    # trust gate: with comm down, the VFD analog/fault rules must NOT fire on stale data
    assert "A9_DC_BUS" not in rule_ids
    assert "A2_VFD_FAULT" not in rule_ids
    assert "stale" in r["answer"]["answer"].lower()


# --------------------------------------------------------------------------- #
# 5. offline/replay works with no PLC, and no :8094 dependency anywhere
# --------------------------------------------------------------------------- #
def test_replay_runs_without_a_plc_and_writes_artifacts(tmp_path):
    out = str(tmp_path / "demo_out")
    r = demo.run_demo("replay", "cv101_idle_healthy", out_dir=out, write=True)
    assert r["snap"], "replay produced an empty snapshot"
    for fname in ("raw_values.json", "context_model.json", "maintenance_answer.md", "demo_summary.md"):
        assert os.path.isfile(os.path.join(out, fname)), "missing artifact: %s" % fname
    with open(os.path.join(out, "maintenance_answer.md"), "r", encoding="utf-8") as f:
        body = f.read()
    assert "Why is CV-101 stopped?" in body
    assert "REPLAY" in body  # data source clearly labeled, not claimed as Litmus ingestion


def test_no_internal_litmus_read_api_dependency():
    src_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo_context_model.py")
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    # The docstring may *mention* the blocked read path to document the non-dependency;
    # what must be absent is any functional use of the internal read route.
    assert "by-device" not in src, "demo must not call the blocked loopedge-access read route"
    assert "/api/tags" not in src, "demo must not call the internal Litmus tag-read API"
    assert "x-api-key" not in src and "apiKey" not in src, "demo must not use the Litmus read credential"
