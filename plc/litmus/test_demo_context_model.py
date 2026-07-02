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


# --------------------------------------------------------------------------- #
# 6. capability matrix + generated test plan (derived only from mapped signals)
# --------------------------------------------------------------------------- #
def _caps_and_plan(fixture="cv101_idle_healthy"):
    r = demo.run_demo("replay", fixture, write=False)
    avail = {c["capability"] for c in r["capabilities"] if c["status"] == "available"}
    unavail = {c["capability"] for c in r["capabilities"] if c["status"] == "unavailable"}
    return r, avail, unavail


def test_capabilities_reflect_available_signals():
    _r, avail, unavail = _caps_and_plan()
    # present on the current 11-register map
    for cap in ("communication health", "command / run state", "VFD fault state",
                "DC bus health", "frequency / speed signal", "motor current (load proxy)"):
        assert cap in avail, "expected available: %s" % cap
    # honestly NOT on the current map / not an input -> must be reported unavailable, not faked
    for cap in ("torque", "motor RPM", "output power", "visual confirmation (webcam)"):
        assert cap in unavail, "expected unavailable: %s" % cap


def test_unavailable_capabilities_carry_a_reason():
    r, _avail, _unavail = _caps_and_plan()
    for c in r["capabilities"]:
        if c["status"] == "unavailable":
            assert c["basis"], "unavailable capability %s has no reason" % c["capability"]
    # torque/RPM/power cite the model's *declared* decline, not a generic guess
    torque = next(c for c in r["capabilities"] if c["capability"] == "torque")
    assert torque["basis"].startswith("declined:")


def test_test_plan_allows_supported_and_skips_unsupported():
    r, _avail, _unavail = _caps_and_plan()
    plan = r["test_plan"]
    allowed = {n for n, _ in plan["allowed"]}
    skipped = {n for n, _ in plan["skipped"]}
    assert "current-based load-proxy test" in allowed
    assert "electrical-vs-mechanical separation test" in allowed
    for s in ("torque / over-torque test", "RPM / slip test",
              "output-power magnitude/trend test", "visual (webcam) root-cause confirmation"):
        assert s in skipped, "expected skipped: %s" % s
    joined = " | ".join(plan["refusals"]).lower()
    assert "torque" in joined and "rpm" in joined and "visual" in joined


def test_no_timeseries_drift_claim_from_single_snapshot():
    r, _avail, _unavail = _caps_and_plan()
    plan = r["test_plan"]
    assert plan["is_timeseries"] is False
    skipped = {n for n, _ in plan["skipped"]}
    assert "load drift / spike detection test" in skipped
    assert any("drift" in ref.lower() for ref in plan["refusals"])


def test_comm_down_keeps_comm_capability_available_but_value_down():
    # the CAPABILITY (assess comms) is available because the signal is mapped;
    # its VALUE says comms are down. Availability != healthy.
    r, avail, _unavail = _caps_and_plan("cv101_comm_down")
    assert "communication health" in avail
    assert r["snap"][rules.T_COMM] is False


def test_capability_artifact_written(tmp_path):
    out = str(tmp_path / "cap_out")
    demo.run_demo("replay", "cv101_idle_healthy", out_dir=out, write=True)
    path = os.path.join(out, "capability_and_test_plan.md")
    assert os.path.isfile(path), "missing capability_and_test_plan.md"
    with open(path, "r", encoding="utf-8") as f:
        body = f.read()
    assert "Capability matrix" in body
    assert "UNAVAILABLE" in body
    assert "torque" in body.lower()


# --------------------------------------------------------------------------- #
# 7. dashboard JSON contract (the stable shape the Perspective adapter consumes)
# --------------------------------------------------------------------------- #
def _contract(fixture="cv101_idle_healthy"):
    return demo.run_demo("replay", fixture, write=False)["contract"]


def test_contract_producible_from_idle_with_all_sections():
    c = _contract()
    for key in ("asset_id", "source", "timestamp", "mapped_signals", "declined_signals",
                "trend_signals", "capability_matrix", "generated_tests", "skipped_tests",
                "claim_boundary", "answer"):
        assert key in c, "contract missing section: %s" % key
    assert c["asset_id"] == "CV-101"
    assert "replay" in c["source"].lower()


def test_contract_mapped_signals_have_values_and_units():
    c = _contract()
    by_name = {m["signal"]: m for m in c["mapped_signals"]}
    assert "vfd_dc_bus" in by_name
    assert by_name["vfd_dc_bus"]["value"] == pytest.approx(321.5)
    assert by_name["vfd_dc_bus"]["unit"] == "V"
    assert by_name["motor_current"]["unit"] == "A" if "motor_current" in by_name else True
    assert by_name["vfd_current"]["unit"] == "A"


def test_contract_declined_include_torque_rpm_power_with_reasons():
    c = _contract()
    declined = {d["signal"]: d for d in c["declined_signals"]}
    for sig in ("vfd/vfd101/torque_pct", "vfd/vfd101/motor_rpm", "vfd/vfd101/output_power_kw"):
        assert sig in declined, "declined signal missing: %s" % sig
        assert declined[sig]["reason"], "declined %s has no reason" % sig


def test_contract_trend_availability_derived_from_mapped():
    c = _contract()
    avail = {t["signal"] for t in c["trend_signals"]["available"]}
    unavail = {t["signal"] for t in c["trend_signals"]["unavailable"]}
    # real, mapped analog signals are available to trend
    assert {"vfd_dc_bus", "vfd_frequency", "vfd_current"} <= avail
    # torque/RPM/power/webcam are explicitly UNAVAILABLE (never silently hidden)
    assert {"torque", "motor RPM", "output power", "visual confirmation (webcam)"} <= unavail
    for t in c["trend_signals"]["unavailable"]:
        assert t["reason"], "unavailable trend %s must carry a reason" % t["signal"]


def test_contract_answer_summary_and_claim_boundary_present():
    c = _contract()
    assert "not being commanded to run" in c["answer"]["summary"].lower()
    assert c["answer"]["state"]["running"] is False
    assert any("torque" in b.lower() for b in c["claim_boundary"])
    assert any("drift" in b.lower() for b in c["claim_boundary"])


def test_contract_timestamp_is_deterministic_when_supplied():
    r = demo.run_demo("replay", "cv101_idle_healthy", write=False)
    c = demo.build_contract(r, timestamp=1234567890)
    assert c["timestamp"] == 1234567890


def test_contract_written_as_artifact(tmp_path):
    out = str(tmp_path / "contract_out")
    demo.run_demo("replay", "cv101_idle_healthy", out_dir=out, write=True)
    path = os.path.join(out, "dashboard_contract.json")
    assert os.path.isfile(path)
    import json as _json
    with open(path, "r", encoding="utf-8") as f:
        c = _json.load(f)
    assert c["asset_id"] == "CV-101" and c["trend_signals"]["unavailable"]
