"""
Garage conveyor CV-101 -- raw data -> approved context model -> maintenance answer.
=================================================================================
BENCH-ONLY demo driver. Read-only toward the PLC; no PLC writes; no Litmus DB edits;
no dependency on the internal Litmus read API (:8094). Zero third-party deps (stdlib
socket + json) so it runs under any python3.

The business thesis this proves:
  * Litmus gets live industrial data OUT of the machine (it polls CV-101 with 0 modbus
    exceptions -- shown in the DeviceHub UI, in parallel, NOT a code dependency here).
  * MIRA turns that same data into an APPROVED maintenance context model and answers a
    technician question with evidence -- and declines what it cannot ground.

Pipeline (three visible layers, matching the demo runbook):
  1. RAW: read the Micro820 registers (the "tag wall" -- what Litmus collects too).
  2. CONTEXT MODEL: map each raw register -> a named maintenance signal, using the
     approved model (scale/unit/component/evidence/approval). The model IS the mapping.
  3. ANSWER: run the A0-A12 machine-card rules and answer "Why is CV-101 stopped?",
     citing the signals used and refusing anything that needs an unmapped signal.

    # live (PLC connected on the bench LAN)
    python plc/litmus/demo_context_model.py --source plc
    # replay (no PLC -- deterministic fixture, good for a video / CI)
    python plc/litmus/demo_context_model.py --source replay --fixture cv101_idle_healthy
    python plc/litmus/demo_context_model.py --source replay --fixture cv101_comm_down

On top of the answer it also reports, honestly, from the SAME mapped/declined signals:
  * a capability matrix   -- which maintenance capabilities the current evidence supports,
  * a generated test plan -- which tests are honestly constructable now, which are skipped
    (and why), and the claim boundary MIRA must refuse to cross. It invents no signals:
    torque/RPM/output-power/visual are reported UNAVAILABLE until real evidence exists.

Artifacts (readable, screen-share ready) land in:
    out/demo/garage_conveyor_context_model/
      raw_values.json  context_model.json  maintenance_answer.md  demo_summary.md
      capability_and_test_plan.md
"""
import argparse
import json
import os
import socket
import struct
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_ANOMALY = os.path.join(_HERE, "..", "conv_simple_anomaly")
sys.path.insert(0, _ANOMALY)
import rules  # noqa: E402  -- the A0-A12 machine-card brain

DEFAULT_MODEL = os.path.join(_ANOMALY, "context_model.cv101.json")
REPLAY_DIR = os.path.join(_ANOMALY, "replay")
DEFAULT_OUT = os.path.join(_HERE, "..", "..", "out", "demo", "garage_conveyor_context_model")

PLC_HOST = os.getenv("PLC_HOST", "192.168.1.100")
PLC_PORT = int(os.getenv("PLC_PORT", "502"))
UNIT = 1
_SEV_RANK = {"CRITICAL": 5, "HIGH": 4, "MEDIUM": 3, "LOW": 2, "INFO": 1}

# Semantic maintenance capabilities, each derived ONLY from which mapped signals are
# actually present. availability = any candidate rules-topic present in the snapshot.
# The last four are deliberately listed so the matrix says UNAVAILABLE out loud (they are
# not on the current sparse Micro820 map / not an input to this CLI) -- no invention.
_VISUAL_TOPIC = "_visual/webcam"  # not a register; handled as "no camera input" below
CAPABILITY_SPEC = [
    ("communication health",         [rules.T_COMM]),
    ("command / run state",          [rules.T_CMD, rules.T_RUN]),
    ("VFD fault state",              [rules.T_FAULT]),
    ("DC bus health",                [rules.T_DCBUS]),
    ("frequency / speed signal",     [rules.T_FREQ]),
    ("motor current (load proxy)",   [rules.T_CUR]),
    ("safety / e-stop state",        [rules.T_ESTOP, rules.T_WIRING]),
    ("torque",                       ["vfd/vfd101/torque_pct"]),
    ("motor RPM",                    ["vfd/vfd101/motor_rpm"]),
    ("output power",                 ["vfd/vfd101/output_power_kw"]),
    ("visual confirmation (webcam)", [_VISUAL_TOPIC]),
]


# --------------------------------------------------------------------------- #
# model + raw sources
# --------------------------------------------------------------------------- #
def load_model(path=DEFAULT_MODEL):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _modbus(sock, fc, start, qty):
    pdu = struct.pack(">BHH", fc, start, qty)
    sock.sendall(struct.pack(">HHH", 1, 0, len(pdu) + 1) + bytes([UNIT]) + pdu)
    r = sock.recv(512)
    if r[7] & 0x80:
        return None  # Modbus exception (addr not in the live sparse map)
    return r[9:9 + r[8]]


def read_raw_plc(model, host=PLC_HOST, port=PLC_PORT):
    """Read exactly the registers the model declares. Returns {'holding':{addr:int},
    'coils':{addr:bool}} keyed by str(addr). Raw-socket Modbus -- no pymodbus dep."""
    raw = {"holding": {}, "coils": {}}
    s = socket.socket()
    s.settimeout(3)
    s.connect((host, port))
    try:
        for sig in model["signals"]:
            src = sig["source"]
            addr = int(src["address"])
            if src["register_class"] == "H":
                d = _modbus(s, 3, addr, 1)
                if d is not None:
                    raw["holding"][str(addr)] = struct.unpack(">H", d)[0]
            elif src["register_class"] == "C":
                d = _modbus(s, 1, addr, 1)
                if d is not None:
                    raw["coils"][str(addr)] = bool(d[0] & 1)
    finally:
        s.close()
    return raw


def load_replay(fixture):
    """Load a replay fixture by name (in the replay dir) or by explicit path."""
    path = fixture
    if not os.path.isfile(path):
        cand = os.path.join(REPLAY_DIR, fixture if fixture.endswith(".json") else fixture + ".json")
        path = cand
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {"holding": data.get("holding", {}), "coils": data.get("coils", {})}, data.get("label", fixture)


# --------------------------------------------------------------------------- #
# the context-model mapping (raw register -> named maintenance signal)
# --------------------------------------------------------------------------- #
def map_to_signals(model, raw):
    """Apply the approved model: raw register -> named signal value keyed by rules topic.
    Returns (snap, rows) where rows is the human-readable mapping table."""
    snap = {}
    rows = []
    for sig in model["signals"]:
        src = sig["source"]
        addr = str(int(src["address"]))
        bucket = "holding" if src["register_class"] == "H" else "coils"
        rawval = raw.get(bucket, {}).get(addr)
        row = {
            "signal": sig["name"], "topic": sig["topic"], "component": sig["component"],
            "source": "%s @%s (%s)" % (src["register_class"], addr, src["function"]),
            "raw": rawval,
            "confidence": sig["evidence"]["confidence"],
            "approval": sig.get("approval_status", "proposed"),
        }
        if rawval is None:
            row["value"] = None
            row["display"] = "unavailable"
            rows.append(row)
            continue
        scale = sig.get("scale", {})
        kind = scale.get("kind")
        if kind == "bool":
            val = bool(rawval)
            disp = str(val)
        elif kind == "divisor":
            div = float(scale.get("divisor", 1.0))
            val = (float(rawval) / div) if div != 1.0 else int(rawval)
            unit = scale.get("unit", "")
            disp = ("%.2f %s" % (val, unit)).strip() if isinstance(val, float) else ("%d %s" % (val, unit)).strip()
        else:
            val = rawval
            disp = str(rawval)
        # command-word / fault-code friendly decode for the report
        if "decode" in sig and str(int(val)) in sig["decode"]:
            disp = "%s (%s)" % (val, sig["decode"][str(int(val))])
        snap[sig["topic"]] = val
        row["value"] = val
        row["display"] = disp
        rows.append(row)
    return snap, rows


def build_derived(snap):
    """Single-snapshot derived facts. cmd_run_for_s is set past the grace so a standing
    RUN command is judged now (matches mira_on_litmus.diagnose)."""
    cmd_run = snap.get(rules.T_CMD) in rules.DEFAULT_CFG["run_cmd_values"]
    return {"now": time.time(), "max_stale_s": 0.0, "freq_frozen_s": 0.0,
            "cmd_run_for_s": (rules.DEFAULT_CFG["cmd_run_grace_s"] + 1) if cmd_run else 0.0}


# --------------------------------------------------------------------------- #
# the maintenance answer (grounded, accountable, refuses unmapped facts)
# --------------------------------------------------------------------------- #
def answer_question(model, snap, anomalies, source_label):
    q = model["maintenance_question"]["prompt"]
    running = bool(snap.get(rules.T_RUN))
    commanded_run = snap.get(rules.T_CMD) in rules.DEFAULT_CFG["run_cmd_values"]
    comm_ok = snap.get(rules.T_COMM)
    dcb = snap.get(rules.T_DCBUS)
    fault = snap.get(rules.T_FAULT)

    top = None
    if anomalies:
        top = sorted(anomalies, key=lambda a: _SEV_RANK.get(a.severity, 0), reverse=True)[0]

    if top is not None:
        cause = ("CV-101 is stopped and there IS an active condition: **%s** (%s). %s"
                 % (top.title, top.severity, top.message))
        if top.rule_id == "A1_COMM_STALE":
            cause += (" Because the drive link is down, every GS10 value (frequency, current, "
                      "DC bus, fault code) is STALE -- I will NOT diagnose them until comms are "
                      "restored. Fix the RS-485 link first, then re-read.")
    elif not running and not commanded_run:
        cause = ("CV-101 is stopped because it is **not being commanded to run** -- the GS10 "
                 "command word reads STOP and the motor-running signal is OFF. This is a normal "
                 "idle stop, **not a fault**: the PLC<->GS10 link is healthy%s, no GS10 fault is "
                 "active (fault_code = %s), and the e-stop is clear. Nothing is wrong with CV-101; "
                 "it simply has no run command."
                 % ((" (DC bus nominal at %.1f V)" % dcb) if isinstance(dcb, float) else "",
                    fault if fault is not None else "unknown"))
    elif commanded_run and not running:
        cause = ("CV-101 is commanded to RUN but the motor is not running, and no single rule "
                 "isolated the cause. Check the drive enable/permissive chain and the GS10 status "
                 "word next.")
    else:
        cause = ("CV-101 reports RUNNING. If you expected it stopped, verify the run command and "
                 "the motor-running signal at the source.")

    # refusals -- what MIRA will NOT assert because the signal is not in the approved map
    refusals = []
    for u in model.get("unmapped", []):
        refusals.append("%s: %s (%s)" % (u["component"], u["reason"], u["effect"]))

    return {
        "question": q,
        "source": source_label,
        "state": {
            "running": running, "commanded_run": commanded_run,
            "comm_ok": comm_ok, "dc_bus_v": dcb, "fault_code": fault,
        },
        "answer": cause,
        "anomalies": [a.to_dict() for a in anomalies],
        "refusals": refusals,
    }


# --------------------------------------------------------------------------- #
# capability matrix + generated test plan (derived from mapped/declined signals)
# --------------------------------------------------------------------------- #
def summarize_capabilities(model, snap, rows):
    """What maintenance capabilities does the CURRENT evidence support? Derived purely
    from which mapped signals are present -- unavailable ones say so, with the reason."""
    by_topic = {r["topic"]: r for r in rows}
    unmapped_by_topic = {u.get("signal"): u for u in model.get("unmapped", [])}
    caps = []
    for name, topics in CAPABILITY_SPEC:
        present = [t for t in topics if snap.get(t) is not None]
        if present:
            bases = []
            for t in present:
                r = by_topic.get(t)
                bases.append("%s=%s [%s]" % (r["signal"], r["display"], r["source"]) if r else t)
            caps.append({"capability": name, "status": "available", "basis": "; ".join(bases)})
            continue
        # unavailable -- explain WHY, honestly (declared decline > generic > visual)
        reason = None
        for t in topics:
            if t in unmapped_by_topic:
                reason = "declined: " + unmapped_by_topic[t].get("reason", "not in the approved map")
                break
        if reason is None:
            reason = ("no camera / visual input to this CLI" if _VISUAL_TOPIC in topics
                      else "no mapped signal; not in the approved context model")
        caps.append({"capability": name, "status": "unavailable", "basis": reason})
    return caps


def _is_timeseries(raw):
    """True only if the source actually carries multiple time points. The current
    single-snapshot fixtures / single PLC read do NOT -- so drift/spike tests stay honest."""
    return isinstance(raw, dict) and isinstance(raw.get("series"), list) and len(raw["series"]) > 1


def generate_test_plan(caps, is_timeseries):
    """Which tests can be HONESTLY built from the available signals, which are skipped
    (and why), and the claim boundary. Answers: what can we test, what must we refuse."""
    have = {c["capability"] for c in caps if c["status"] == "available"}
    allowed, skipped, refusals = [], [], []

    if "communication health" in have:
        allowed.append(("comm-trust / stale-suppression test",
                        "comm_ok present -> assert A1 fires and stale VFD rules are suppressed"))
    if "command / run state" in have:
        allowed.append(("idle-vs-commanded-run answer test",
                        "cmd_word + motor_running present -> assert idle vs drive-not-responding"))
    if {"VFD fault state", "DC bus health"} <= have:
        allowed.append(("electrical-vs-mechanical separation test",
                        "fault_code + DC bus present -> can EXCLUDE a VFD electrical fault"))
    if {"motor current (load proxy)", "frequency / speed signal"} <= have:
        allowed.append(("current-based load-proxy test",
                        "motor current + frequency present -> current is the available load proxy"))

    # mechanical/visual tests needing signals we do NOT have -> skipped + refusal
    for cap_name, test_name, refusal in [
        ("torque", "torque / over-torque test", "will not assert torque or over-torque"),
        ("output power", "output-power magnitude/trend test", "will not assert output-power magnitude or trend"),
        ("motor RPM", "RPM / slip test", "will not assert RPM or slip"),
        ("visual confirmation (webcam)", "visual (webcam) root-cause confirmation",
         "will not claim a visually-confirmed root cause"),
    ]:
        if cap_name not in have:
            skipped.append((test_name, "%s unavailable" % cap_name))
            refusals.append(refusal)

    if is_timeseries:
        allowed.append(("load drift / spike detection test",
                        "source carries a time-series -> can measure drift, spike-count, instability"))
    else:
        skipped.append(("load drift / spike detection test",
                        "source is a single snapshot -> no time-series to measure drift/spikes"))
        refusals.append("will not claim load DRIFT or SPIKES from a single snapshot")

    return {"allowed": allowed, "skipped": skipped, "refusals": refusals, "is_timeseries": is_timeseries}


# capabilities whose absence means a TREND signal is unavailable (never hidden).
_TREND_UNAVAILABLE_CAPS = {"torque", "motor RPM", "output power", "visual confirmation (webcam)"}


def build_contract(result, timestamp=None):
    """Stable, dashboard-facing JSON contract assembled from the SAME context/capability layer.
    No internal implementation details -- safe for a Perspective view to consume. Deterministic
    when `timestamp` is supplied (tests pass a fixed value)."""
    model, rows, ans = result["model"], result["rows"], result["answer"]
    caps, plan = result["capabilities"], result["test_plan"]
    ts = time.time() if timestamp is None else timestamp

    unit_by_name = {}
    for s in model["signals"]:
        sc = s.get("scale", {})
        unit_by_name[s["name"]] = sc.get("unit", "") if sc.get("kind") == "divisor" else ""

    mapped, missing = [], []
    for r in rows:
        if r.get("value") is None:
            missing.append({"signal": r["signal"], "component": r["component"],
                            "reason": "register in model but returned no value", "source": r["source"]})
            continue
        mapped.append({"signal": r["signal"], "topic": r["topic"], "component": r["component"],
                       "value": r["value"], "display": r["display"], "unit": unit_by_name.get(r["signal"], ""),
                       "source": r["source"], "confidence": r["confidence"], "approval": r["approval"]})

    declined = missing + [{"signal": u.get("signal"), "component": u.get("component"),
                           "reason": u.get("reason"), "effect": u.get("effect")}
                          for u in model.get("unmapped", [])]

    available_trend = [{"signal": m["signal"], "value": m["value"], "display": m["display"],
                        "unit": m["unit"], "topic": m["topic"], "component": m["component"],
                        "approved": m["approval"] == "approved"} for m in mapped]
    unavailable_trend = [{"signal": c["capability"], "status": "unavailable", "reason": c["basis"]}
                         for c in caps if c["status"] == "unavailable"
                         and c["capability"] in _TREND_UNAVAILABLE_CAPS]

    return {
        "asset_id": model["asset"]["id"],
        "asset_name": model["asset"].get("name"),
        "source": ans["source"],
        "source_mode": result.get("source_mode"),
        "timestamp": ts,
        "model_version": model.get("model_id", model.get("schema_version")),
        "mapped_signals": mapped,
        "declined_signals": declined,
        "trend_signals": {"available": available_trend, "unavailable": unavailable_trend},
        "capability_matrix": caps,
        "generated_tests": [{"name": n, "rationale": w} for n, w in plan["allowed"]],
        "skipped_tests": [{"name": n, "reason": w} for n, w in plan["skipped"]],
        "claim_boundary": plan["refusals"],
        "is_timeseries": plan["is_timeseries"],
        "answer": {"question": ans["question"], "summary": ans["answer"], "state": ans["state"],
                   "anomalies": ans["anomalies"], "refusals": ans["refusals"]},
    }


# --------------------------------------------------------------------------- #
# report rendering
# --------------------------------------------------------------------------- #
def _answer_md(model, rows, ans):
    L = []
    L.append("# MIRA maintenance answer -- CV-101\n")
    L.append("**Question:** %s  " % ans["question"])
    L.append("**Data source:** %s  " % ans["source"])
    L.append("**Asset:** %s (%s)\n" % (model["asset"]["id"], model["asset"]["name"]))
    L.append("## Answer\n")
    L.append(ans["answer"] + "\n")
    if ans["anomalies"]:
        L.append("## Active machine-card findings\n")
        for a in ans["anomalies"]:
            L.append("- **[%s] %s** (`%s`, confidence %.2f) -- %s"
                     % (a["severity"], a["title"], a["rule_id"], a["confidence"], a["message"]))
        L.append("")
    L.append("## Evidence used (approved context model)\n")
    L.append("| signal | value | source | confidence | approval |")
    L.append("|---|---|---|---|---|")
    for r in rows:
        L.append("| %s | %s | %s | %s | %s |"
                 % (r["signal"], r["display"], r["source"], r["confidence"], r["approval"]))
    L.append("")
    L.append("## What MIRA will NOT claim (unmapped signals)\n")
    if ans["refusals"]:
        for r in ans["refusals"]:
            L.append("- " + r)
    else:
        L.append("- (every signal this question needs is in the approved map)")
    L.append("")
    L.append("> Grounding rule: MIRA answers only from approved, evidence-backed signals. "
             "Raw tags alone are not enough -- the context model is what turns them into a "
             "technician-grade answer, and what stops MIRA from guessing about signals it does "
             "not have.\n")
    return "\n".join(L)


def _summary_md(model, ans, source_label):
    site = model["site"]
    L = []
    L.append("# Demo summary -- Litmus collects, MIRA contextualizes\n")
    L.append("**Asset:** %s / %s  " % (site["uns_path"], model["asset"]["name"]))
    L.append("**Data source (this run):** %s\n" % source_label)
    L.append("## The thesis, in one screen\n")
    L.append("1. **Litmus gets the data.** Litmus Edge / DeviceHub polls CV-101's Micro820 with "
             "**zero modbus exceptions** -- the same registers shown below, live in its UI.")
    L.append("2. **Raw tags are not enough.** A register wall (`H@109 = 3215`, `C@0 = false`) "
             "does not tell a technician what to do.")
    L.append("3. **MIRA adds the context model.** The approved CV-101 model maps each register to "
             "a named maintenance signal -- with scale, unit, component, evidence and a human "
             "approval on every mapping.")
    L.append("4. **MIRA answers, and refuses to guess.** It runs the A0-A12 machine-card rules and "
             "answers \"%s\" from grounded signals, and explicitly declines what it cannot ground."
             % model["maintenance_question"]["prompt"])
    L.append("")
    L.append("## This run\n")
    L.append("- **Answer:** %s" % ans["answer"])
    if ans["anomalies"]:
        L.append("- **Findings:** " + ", ".join("[%s] %s" % (a["severity"], a["rule_id"]) for a in ans["anomalies"]))
    else:
        L.append("- **Findings:** none active -- state is within all machine-card invariants.")
    L.append("- **Declined (unmapped):** %d signal(s) MIRA refused to assert." % len(ans["refusals"]))
    L.append("")
    L.append("## Honest gap\n")
    L.append("The **direct** Litmus-API read (`--source litmus`) is a deferred follow-up: the "
             "internal `loopedge-access :8094` read path needs a supported credential/route and is "
             "container-internal (see `docs/discovery/litmus_mira_demo_decision.md`). It does NOT "
             "block this proof -- MIRA reads the SAME live conveyor data over `--source plc`, and "
             "Litmus is demonstrably collecting it in parallel.\n")
    return "\n".join(L)


def _capability_md(model, rows, caps, plan, source_label):
    L = []
    L.append("# CV-101 capability + honest test plan\n")
    L.append("**Data source:** %s  " % source_label)
    L.append("**Asset:** %s (%s)\n" % (model["asset"]["id"], model["asset"]["name"]))
    L.append("Everything below is derived ONLY from the signals the context model actually "
             "mapped for this source. Nothing is assumed.\n")

    mapped = [r for r in rows if r.get("value") is not None]
    declined = [r for r in rows if r.get("value") is None]
    L.append("## 1. Discovered / mapped signals (%d)\n" % len(mapped))
    for r in mapped:
        L.append("- **%s** = %s  (`%s`, %s)" % (r["signal"], r["display"], r["topic"], r["source"]))
    L.append("")
    L.append("## 2. Declined / missing signals\n")
    if declined:
        for r in declined:
            L.append("- **%s** -- register present in model but returned no value (%s)" % (r["signal"], r["source"]))
    for u in model.get("unmapped", []):
        L.append("- **%s** (%s) -- %s" % (u.get("signal"), u.get("component"), u.get("reason")))
    L.append("")
    L.append("## 3. Capability matrix\n")
    L.append("| capability | status | basis |")
    L.append("|---|---|---|")
    for c in caps:
        mark = "available" if c["status"] == "available" else "UNAVAILABLE"
        L.append("| %s | %s | %s |" % (c["capability"], mark, c["basis"]))
    L.append("")
    L.append("## 4. Generated tests (honestly constructable now)\n")
    if plan["allowed"]:
        for name, why in plan["allowed"]:
            L.append("- **%s** -- %s" % (name, why))
    else:
        L.append("- (none supported by the current evidence)")
    L.append("")
    L.append("## 5. Skipped tests (and why)\n")
    for name, why in plan["skipped"]:
        L.append("- **%s** -- SKIPPED: %s" % (name, why))
    L.append("")
    L.append("## 6. Honest MIRA claim boundary\n")
    L.append("From this source, MIRA must refuse to:")
    for r in plan["refusals"]:
        L.append("- " + r)
    L.append("")
    L.append("> Time-series in this source: **%s**. Drift/spike/load-instability claims require a "
             "real time-series fixture; a single snapshot cannot support them.\n"
             % ("yes" if plan["is_timeseries"] else "no (single snapshot)"))
    return "\n".join(L)


def write_artifacts(out_dir, model, raw, rows, ans, source_label, caps=None, plan=None, contract=None):
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "raw_values.json"), "w", encoding="utf-8") as f:
        json.dump({"source": source_label, "raw": raw, "mapped": rows}, f, indent=2)
    with open(os.path.join(out_dir, "context_model.json"), "w", encoding="utf-8") as f:
        json.dump(model, f, indent=2)
    with open(os.path.join(out_dir, "maintenance_answer.md"), "w", encoding="utf-8") as f:
        f.write(_answer_md(model, rows, ans))
    with open(os.path.join(out_dir, "demo_summary.md"), "w", encoding="utf-8") as f:
        f.write(_summary_md(model, ans, source_label))
    if caps is not None and plan is not None:
        with open(os.path.join(out_dir, "capability_and_test_plan.md"), "w", encoding="utf-8") as f:
            f.write(_capability_md(model, rows, caps, plan, source_label))
    if contract is not None:
        with open(os.path.join(out_dir, "dashboard_contract.json"), "w", encoding="utf-8") as f:
            json.dump(contract, f, indent=2)
    return out_dir


# --------------------------------------------------------------------------- #
# orchestration
# --------------------------------------------------------------------------- #
def run_demo(source, fixture=None, model_path=DEFAULT_MODEL, out_dir=DEFAULT_OUT, write=True):
    model = load_model(model_path)
    if source == "plc":
        raw = read_raw_plc(model)
        source_label = "LIVE PLC (Modbus TCP %s:%d) -- no Litmus in the code path" % (PLC_HOST, PLC_PORT)
    else:
        raw, label = load_replay(fixture or "cv101_idle_healthy")
        source_label = "REPLAY fixture '%s' (deterministic, no PLC)" % label
    snap, rows = map_to_signals(model, raw)
    anomalies = rules.evaluate(snap, build_derived(snap))
    ans = answer_question(model, snap, anomalies, source_label)
    caps = summarize_capabilities(model, snap, rows)
    plan = generate_test_plan(caps, _is_timeseries(raw))
    result = {"model": model, "raw": raw, "snap": snap, "rows": rows,
              "anomalies": anomalies, "answer": ans,
              "capabilities": caps, "test_plan": plan, "source_mode": source}
    result["contract"] = build_contract(result)
    result["out_dir"] = (write_artifacts(out_dir, model, raw, rows, ans, source_label, caps, plan,
                                         result["contract"]) if write else None)
    return result


def main():
    ap = argparse.ArgumentParser(description="CV-101 raw -> context model -> maintenance answer demo")
    ap.add_argument("--source", choices=["plc", "replay"], default="plc")
    ap.add_argument("--fixture", default="cv101_idle_healthy",
                    help="replay fixture name (in plc/conv_simple_anomaly/replay/) or a path")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--no-write", action="store_true", help="print only; do not write artifacts")
    ap.add_argument("--contract", action="store_true",
                    help="print the dashboard JSON contract to stdout and exit (for the dashboard adapter)")
    args = ap.parse_args()

    try:
        r = run_demo(args.source, args.fixture, args.model, args.out, write=not args.no_write)
    except (OSError, socket.error) as e:
        print("ERROR: could not read the PLC over Modbus (%s). Use --source replay for an "
              "offline run:\n  python plc/litmus/demo_context_model.py --source replay "
              "--fixture cv101_idle_healthy" % e)
        return 2

    if args.contract:
        print(json.dumps(r["contract"], indent=2))
        return 0

    ans = r["answer"]
    print("=" * 74)
    print("CV-101  raw -> approved context model -> maintenance answer")
    print("  source : %s" % ans["source"])
    print("=" * 74)
    print("\n-- RAW TAG WALL (what Litmus collects too) --")
    for row in r["rows"]:
        print("  %-18s %-10s  <- %s" % (row["signal"], "(%s)" % row["raw"], row["source"]))
    print("\n-- MIRA ANSWER --")
    print("  Q: %s" % ans["question"])
    print("  A: %s" % ans["answer"].replace("**", ""))
    if ans["anomalies"]:
        print("  findings: " + ", ".join("[%s] %s" % (a["severity"], a["rule_id"]) for a in ans["anomalies"]))
    print("  declined (unmapped): %d signal(s)" % len(ans["refusals"]))

    print("\n-- CAPABILITY MATRIX (from mapped signals only) --")
    for c in r["capabilities"]:
        mark = "  available " if c["status"] == "available" else "UNAVAILABLE"
        print("  [%s] %s" % (mark, c["capability"]))
    plan = r["test_plan"]
    print("\n-- GENERATED TEST PLAN --")
    print("  allowed (%d):" % len(plan["allowed"]))
    for name, _why in plan["allowed"]:
        print("    + %s" % name)
    print("  skipped (%d):" % len(plan["skipped"]))
    for name, why in plan["skipped"]:
        print("    - %s  (%s)" % (name, why))
    print("  claim boundary -- MIRA will NOT:")
    for ref in plan["refusals"]:
        print("    x %s" % ref)

    if r["out_dir"]:
        print("\nartifacts -> %s" % os.path.normpath(r["out_dir"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
