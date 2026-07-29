"""
Anomaly-log harness -- exercise the Ask MIRA brain across the A0-A12 fault battery.
=================================================================================
The Ignition "Ask MIRA" button (MaintenancePanel -> runScript -> mira_diagnose ->
mira_diagnose_core.evaluate) is Jython and needs the live gateway. Its BRAIN, though,
is rules_core.evaluate() -- pure, dual Py2.7/3.12. This harness drives that exact brain
under CPython across one scenario per detectable rule, and LOGS what the button would
surface for each: state banner + card (severity/title/message/next-check/ask-text) +
the cited evidence topics.

It reproduces mira_diagnose's presentation layer (NEXT_CHECK, ask-text, state banner)
byte-for-byte so the log == what the panel shows. No PLC, no gateway, deterministic.

    python plc/conv_simple_anomaly/anomaly_log.py
    # -> prints a table; writes out/anomaly_log/anomaly_log.{md,csv,jsonl}
"""
import csv
import json
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import rules  # the A0-A12 brain (shim over rules_core); same object the button calls  # noqa: E402
from rules import (  # noqa: E402
    T_RUN, T_COMM, T_ESTOP, T_WIRING, T_CONTACTOR, T_DI00, T_DI01, T_DI02, T_DI03,
    T_FREQ, T_CUR, T_DCBUS, T_CMD, T_FAULT, T_FREQ_SP, T_PE_LATCH,
)

OUT = os.path.join(_HERE, "..", "..", "out", "anomaly_log")

# --- mira_diagnose presentation layer (mirrored so the log == the panel) ---
NEXT_CHECK = {
    "A0_OFFLINE": "Check the PLC bridge / Modbus link and that the gateway is polling the device.",
    "A1_COMM_STALE": "Reseat the RS-485 wiring PLC<->GS10; confirm baud/parity; power-cycle the drive.",
    "A2_VFD_FAULT": "Read the GS10 keypad fault, clear the cause, then reset the drive (STOP+RESET).",
    "A3_ESTOP_WIRING": "Inspect the dual-channel e-stop loop for a broken/shorted wire (DI_02 vs DI_03).",
    "A4_DIRECTION_FAULT": "Check the FWD/REV selector wiring -- both directions are commanded at once.",
    "A5_ILLEGAL_RUN": "Verify the safety interlock chain; the belt should not run while not permitted.",
    "A6_DRIVE_NOT_RESPONDING": "Confirm the GS10 is in remote/RUN-enabled mode and not faulted/locked.",
    "A7_FREQ_NOT_TRACKING": "Check for mechanical drag, a current-limit, or load -- drive can't hold speed.",
    "A8_OVERCURRENT": "Inspect the belt/rollers for a jam or binding; compare current to motor FLA.",
    "A9_DC_BUS": "Check incoming supply voltage and the GS10 DC-bus (low->Lvd, high->ovd).",
    "A10_FREQ_STUCK_ZERO": "Drive commanded RUN but 0 Hz out -- check enable, fault latch, output wiring.",
    "A12_PHOTOEYE_JAM": "Clear the object blocking the infeed photo-eye (DI_05), then re-arm with Start.",
}
_SEV_RANK = {"CRITICAL": 5, "HIGH": 4, "MEDIUM": 3, "LOW": 2, "INFO": 1}


def _ask_text(d):
    return ('The garage conveyor is showing "%s" (%s): %s What is the most likely cause and '
            "how do I clear it?") % (d["title"], d["rule_id"], d["message"])


def _running(snap):
    f = snap.get(T_FREQ)
    if isinstance(f, (int, float)) and f > 0.1:
        return True
    return snap.get(T_CMD) in rules.DEFAULT_CFG["run_cmd_values"]


def state_banner(snap, cards, offline):
    worst = max([_SEV_RANK.get(c["severity"], 1) for c in cards] + [0])
    worst_title = cards[0]["title"] if cards else ""
    if offline:
        return "COMMS LOST", "No good tag reads -- PLC / bridge link down."
    if worst >= 4:
        return "FAULT", worst_title
    if worst >= 2:
        return "WARNING", worst_title
    if _running(snap):
        return "RUNNING", "All systems nominal."
    return "STOPPED", "Belt stopped -- no active faults."


# --- the fault battery: one grounded scenario per detectable rule (+ 2 healthy) ---
# Each snap sets only the signals the rule reads; derived carries the temporal facts.
GRACE = rules.DEFAULT_CFG["cmd_run_grace_s"] + 1
FROZEN = rules.DEFAULT_CFG["freq_frozen_s"] + 1
SCENARIOS = [
    ("healthy_idle", "Belt idle, comms OK, no run command",
     {T_RUN: False, T_COMM: True, T_CMD: 1, T_DCBUS: 321.5, T_FAULT: 0, T_ESTOP: False}, {}, False),
    ("healthy_run", "Belt running fwd at speed, current nominal",
     {T_RUN: True, T_COMM: True, T_CMD: 18, T_FREQ: 30.0, T_CUR: 2.1, T_DCBUS: 330.0, T_FAULT: 0}, {}, False),
    ("A0_offline", "No fresh PLC data (bridge/link down)",
     {}, {"max_stale_s": 9999.0}, True),
    ("A1_comm_down", "GS10 RS-485 link down (vfd_comm_ok=0)",
     {T_COMM: False, T_RUN: False, T_CMD: 1}, {}, False),
    ("A2_vfd_fault_oL", "GS10 reports fault 21 (oL overload)",
     {T_COMM: True, T_FAULT: 21}, {}, False),
    ("A3_estop_wiring", "Dual-channel e-stop disagree (DI_02==DI_03)",
     {T_DI02: True, T_DI03: True}, {}, False),
    ("A4_direction", "FWD and REV both commanded",
     {T_DI00: True, T_DI01: True}, {}, False),
    ("A5_illegal_run", "Motor RUNNING while e-stop active",
     {T_RUN: True, T_ESTOP: True}, {}, False),
    ("A6_not_responding", "Commanded RUN 4s but motor not running",
     {T_COMM: True, T_CMD: 18, T_RUN: False}, {"cmd_run_for_s": GRACE}, False),
    ("A7_freq_not_tracking", "Commanded 30 Hz, output stuck at 10 Hz",
     {T_COMM: True, T_CMD: 18, T_FREQ_SP: 30.0, T_FREQ: 10.0, T_CUR: 4.5}, {"cmd_run_for_s": FROZEN}, False),
    ("A8_overcurrent", "Output 7.0 A over motor FLA 5.0 A (jam)",
     {T_COMM: True, T_CUR: 7.0}, {}, False),
    ("A9_dc_bus_low", "DC bus 230 V below 250 V floor",
     {T_COMM: True, T_DCBUS: 230.0}, {}, False),
    ("A10_freq_stuck_zero", "Commanded RUN 6s but output Hz = 0",
     {T_COMM: True, T_CMD: 18, T_FREQ: 0.0}, {"cmd_run_for_s": FROZEN}, False),
    ("A12_photoeye_jam", "Photo-eye latched a soft-stop (infeed blocked)",
     {T_PE_LATCH: True}, {}, False),
]

# Catalog rows that are LIVE-gated (rule fires here, but the live sparse map can't feed it yet).
REFLASH_GATED = {"A2_VFD_FAULT", "A12_PHOTOEYE_JAM"}  # need slave-map-v2 (DI_05 coil 23 / GS10 0x2100)


def run():
    rows = []
    for name, note, snap, derived, offline in SCENARIOS:
        anomalies = rules.evaluate(snap, derived)
        cards = []
        for a in anomalies:
            d = a.to_dict()
            cards.append({
                "ruleId": d["rule_id"], "severity": d["severity"], "title": d["title"],
                "message": d["message"], "nextCheck": NEXT_CHECK.get(d["rule_id"], "Inspect + cite the manual."),
                "askText": _ask_text(d),
                "evidence": ", ".join("%s=%s" % (e["topic"], e["value"]) for e in d["evidence"]),
            })
        state, sub = state_banner(snap, cards, offline)
        rows.append({"scenario": name, "note": note, "state": state, "state_sub": sub,
                     "count": len(cards), "cards": cards})
    return rows


def write(rows):
    os.makedirs(OUT, exist_ok=True)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
    # JSONL (one line per scenario)
    with open(os.path.join(OUT, "anomaly_log.jsonl"), "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    # CSV (one line per card / anomaly)
    with open(os.path.join(OUT, "anomaly_log.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "scenario", "state", "rule_id", "severity", "title",
                    "message", "next_check", "evidence", "reflash_gated"])
        for r in rows:
            if not r["cards"]:
                w.writerow([stamp, r["scenario"], r["state"], "", "", "(no anomaly)", r["state_sub"], "", "", ""])
            for c in r["cards"]:
                w.writerow([stamp, r["scenario"], r["state"], c["ruleId"], c["severity"], c["title"],
                            c["message"], c["nextCheck"], c["evidence"],
                            "yes" if c["ruleId"] in REFLASH_GATED else ""])
    # Markdown (readable log)
    with open(os.path.join(OUT, "anomaly_log.md"), "w", encoding="utf-8") as f:
        f.write("# CV-101 Anomaly Log -- Ask MIRA brain over the fault battery\n\n")
        f.write("_Deterministic offline run of `rules_core.evaluate` (the exact A0-A12 brain the "
                "Ignition Ask MIRA button calls). %s_\n\n" % stamp)
        f.write("| scenario | banner | rule | sev | what MIRA says | next check |\n")
        f.write("|---|---|---|---|---|---|\n")
        for r in rows:
            if not r["cards"]:
                f.write("| %s | **%s** | - | - | %s | - |\n" % (r["scenario"], r["state"], r["state_sub"]))
            for c in r["cards"]:
                gate = " *(reflash-gated live)*" if c["ruleId"] in REFLASH_GATED else ""
                f.write("| %s | **%s** | `%s`%s | %s | %s | %s |\n"
                        % (r["scenario"], r["state"], c["ruleId"], gate, c["severity"],
                           c["message"].replace("|", "\\|"), c["nextCheck"].replace("|", "\\|")))
        f.write("\n> Every message is generated from the approved signal(s) the rule read -- the "
                "`evidence` column in `anomaly_log.csv` lists the exact topics + values. Rules that "
                "need signals the live sparse map doesn't expose yet are marked *reflash-gated*.\n")
    return stamp


def main():
    rows = run()
    stamp = write(rows)
    fired = [c for r in rows for c in r["cards"]]
    coded = set(rid.split("_")[0] for rid in (c["ruleId"] for c in fired))
    print("=" * 92)
    print("CV-101 ANOMALY LOG  --  Ask MIRA brain (rules_core.evaluate) over %d scenarios" % len(rows))
    print("=" * 92)
    print("%-22s %-11s %-24s %-9s %s" % ("scenario", "banner", "rule", "sev", "MIRA says"))
    print("-" * 92)
    for r in rows:
        if not r["cards"]:
            print("%-22s %-11s %-24s %-9s %s" % (r["scenario"], r["state"], "-", "-", r["state_sub"]))
        for c in r["cards"]:
            gate = " [reflash]" if c["ruleId"] in REFLASH_GATED else ""
            msg = (c["message"][:66] + "...") if len(c["message"]) > 69 else c["message"]
            print("%-22s %-11s %-24s %-9s %s" % (r["scenario"], r["state"], c["ruleId"] + gate, c["severity"], msg))
    print("-" * 92)
    print("logged %d anomaly card(s) across %d scenarios; distinct coded rules fired: %d/12 (%s)"
          % (len(fired), len(rows), len(coded), ",".join(sorted(coded))))
    print("artifacts -> %s  (anomaly_log.md / .csv / .jsonl)" % os.path.normpath(OUT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
