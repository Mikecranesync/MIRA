# mira_diagnose -- Perspective project-library diagnose seam (Jython 2.7, Gateway scope).
#
# The FREE detection wedge, WITHOUT the WebDev module. The bench gateway has Perspective but
# NOT WebDev, so the A0-A12 anomaly rules run from a project script the MaintenancePanel binds
# to via runScript(...) -- no HTTP hop, offline, no cloud, no API key.
#
# It mirrors the /api/diagnose WebDev handler (ignition/webdev/FactoryLM/api/diagnose/doGet.py):
#   read allowlisted tags -> map leaf names to snap topics -> evaluate the rules -> cards JSON.
# The rule engine + tag map are VENDORED byte-identical as sibling script modules
# (mira_diagnose_core == plc/conv_simple_anomaly/rules_core.py;
#  mira_tag_map      == ignition/webdev/FactoryLM/api/diagnose/tag_topic_map.py),
# guarded by tests/regime7_ignition/test_diagnose_parity.py.
#
# READ-ONLY + bounded: reads ONLY <folder>/<leaf> for leaves in mira_tag_map.LEAF_MAP (the map IS
# the read allowlist) via system.tag.readBlocking. Never browses, never writes. Per
# .claude/rules/fieldbus-readonly.md + docs/mira-ignition-secure-architecture.md.
#
# Jython 2.7: no f-strings / annotations / dataclass; % formatting; ASCII only.
# Ref: docs/RESUME_2026-06-14_maintenance-intelligence-module.md Phase 2.

import mira_diagnose_core as _core
import mira_tag_map as _map

# Conveyor archetype default tag folders -- the live Conv_Simple tag sets. Phase 3 (auto-classify)
# will generate this per asset; the shape stays the same.
DEFAULT_FOLDERS = [
    "[default]MIRA_IOCheck/VFD",
    "[default]MIRA_IOCheck/Inputs",
    "[default]MIRA_IOCheck/Outputs",
    "[default]Conveyor",
]

# ISA-101 / high-performance-HMI palette: strong color is reserved for the abnormal state.
_SEV_COLOR = {
    "CRITICAL": "#f85149", "HIGH": "#f85149",   # red  -- fault / stop
    "MEDIUM": "#f0a90e", "LOW": "#f0a90e",       # amber -- warning
    "INFO": "#8b949e",                            # gray -- informational
}
_SEV_RANK = {"CRITICAL": 5, "HIGH": 4, "MEDIUM": 3, "LOW": 2, "INFO": 1}

# Per-rule "next check" -- the single most useful next action for the tech (the explain half).
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

# --- TTL cache: coalesce the panel's several runScript bindings into one evaluation per tick ---
_TTL_MS = 750
_cache = {}   # folders_key -> (expires_ms, payload)


def _now_ms():
    return system.date.now().getTime()


def _split_folders(folders):
    if folders is None or folders == "":
        return list(DEFAULT_FOLDERS)
    if isinstance(folders, (list, tuple)):
        items = list(folders)
    else:
        items = str(folders).split(",")
    out = []
    for it in items:
        it = str(it).strip().rstrip("/")
        if it:
            out.append(it)
    return out or list(DEFAULT_FOLDERS)


def _read_snap(folders):
    """Read ONLY <folder>/<leaf> for leaves in LEAF_MAP (the read allowlist). Read-only.
    Returns (snap, good_count, candidate_count)."""
    leaves = _map.RELEVANT_LEAVES
    paths = []
    for folder in folders:
        for leaf in leaves:
            paths.append(folder + "/" + leaf)
    pairs = []
    good = 0
    try:
        qvs = system.tag.readBlocking(paths)
    except Exception:
        qvs = []
    for i in range(len(qvs)):
        qv = qvs[i]
        try:
            if not qv.quality.isGood():
                continue
        except Exception:
            pass
        good += 1
        pairs.append((paths[i], qv.value))
    return _map.build_snap(pairs), good, len(paths)


def _running(snap):
    f = snap.get(_core.T_FREQ)
    if isinstance(f, (int, float)) and f > 0.1:
        return True
    return snap.get(_core.T_CMD) in _core.DEFAULT_CFG["run_cmd_values"]


def _ask_text(d):
    return ("The garage conveyor is showing \"%s\" (%s): %s What is the most likely cause and "
            "how do I clear it?") % (d["title"], d["rule_id"], d["message"])


def _compute(folders):
    snap, good, n = _read_snap(folders)
    offline = good == 0 and n > 0
    derived = {
        "max_stale_s": 9999.0 if offline else 0.0,   # A0 fires only when nothing reads good
        "cmd_run_for_s": 0.0,                          # time-based rules wait for the Phase-4 poller
        "freq_frozen_s": 0.0,
    }
    anomalies = _core.evaluate(snap, derived)
    cards = []
    worst = 0
    worst_title = ""
    for a in anomalies:
        d = a.to_dict()
        sev = d["severity"]
        cards.append({
            "ruleId": d["rule_id"],
            "severity": sev,
            "sevColor": _SEV_COLOR.get(sev, "#8b949e"),
            "title": d["title"],
            "message": d["message"],
            "nextCheck": NEXT_CHECK.get(d["rule_id"], "Inspect the affected component and cite the manual."),
            "askText": _ask_text(d),
        })
        r = _SEV_RANK.get(sev, 1)
        if r > worst:
            worst = r
            worst_title = d["title"]

    if offline:
        state = {"state": "COMMS LOST", "color": "#f85149",
                 "sub": "No good tag reads -- PLC / bridge link down."}
    elif worst >= 4:
        state = {"state": "FAULT", "color": "#f85149", "sub": worst_title}
    elif worst >= 2:
        state = {"state": "WARNING", "color": "#f0a90e", "sub": worst_title}
    elif _running(snap):
        state = {"state": "RUNNING", "color": "#1a7f37", "sub": "All systems nominal."}
    else:
        state = {"state": "STOPPED", "color": "#30363d", "sub": "Belt stopped -- no active faults."}

    return {"asset": "conveyor", "state": state, "cards": cards,
            "count": len(cards), "good": good, "candidates": n}


def _payload(folders):
    key = ",".join(folders)
    now = _now_ms()
    ent = _cache.get(key)
    if ent is not None and ent[0] > now:
        return ent[1]
    p = _compute(folders)
    _cache[key] = (now + _TTL_MS, p)
    return p


# ---- runScript entry points (bound from MaintenancePanel) ----
def diagnose_json(folders=None):
    """Full payload {state, cards, count, ...} -- the debug / one-call view."""
    return _payload(_split_folders(folders))


def cards_json(folders=None):
    """The anomaly-card array -> Flex Repeater 'instances' (keys == AnomalyCard params)."""
    return _payload(_split_folders(folders))["cards"]


def header_text(folders=None):
    return _payload(_split_folders(folders))["state"]["state"]


def header_color(folders=None):
    return _payload(_split_folders(folders))["state"]["color"]


def header_sub(folders=None):
    return _payload(_split_folders(folders))["state"]["sub"]


def count_text(folders=None):
    n = _payload(_split_folders(folders))["count"]
    if n == 0:
        return "No active anomalies"
    if n == 1:
        return "1 active anomaly"
    return "%d active anomalies" % n
