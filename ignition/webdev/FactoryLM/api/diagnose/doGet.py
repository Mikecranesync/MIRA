# Web Dev Module Handler: GET /system/webdev/FactoryLM/api/diagnose?asset=<tagFolder>
#
# Runs the A0-A12 anomaly rules IN-GATEWAY against a live, allowlisted Ignition tag snapshot
# and returns anomaly cards. This is the FREE detection wedge: offline, no cloud, no API key.
# Read-only (system.tag.readBlocking only) and allowlist-enforced (fail-closed).
#
# Jython 2.7 -- runs inside the Ignition Gateway JVM. The rules live in diagnose_core.py
# (vendored verbatim from plc/conv_simple_anomaly/rules_core.py; a parity test guards drift)
# and the tag-name -> snap-topic mapping in tag_topic_map.py (both siblings of this file).
#
# Phase 1 (stateless): the comm/safety/fault/direction rules (A0,A1,A2,A3,A4,A5,A8,A9,A12) all
# evaluate from a single snapshot and work here. The time-based rules (A6/A7/A10, which need
# "RUN commanded for N seconds") need a stateful poller (Phase 4 gateway timer script) and stay
# dormant in this stateless endpoint -- cmd_run_for_s is reported as 0.
#
# Ref: docs/plans warm-wadler Phase 1; docs/mira-ignition-secure-architecture.md (allowlist).

import os as _os
import sys as _sys


def _add_sibling_paths():
    """Make diagnose_core / tag_topic_map (here) and allowlist (../tags) importable,
    matching the chat handler's sys.path idiom for WebDev resources."""
    here = _os.path.dirname(_os.path.abspath(__file__))
    tags_dir = _os.path.join(here, "..", "tags")
    for d in (here, tags_dir):
        if d not in _sys.path:
            _sys.path.insert(0, d)


def doGet(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Diagnose")
    import json

    _add_sibling_paths()
    import diagnose_core
    import tag_topic_map
    import allowlist

    params = request.get("params", {}) or {}
    asset = params.get("asset", "") or "[default]Conveyor"
    asset = asset.rstrip("/")

    # --- fail-closed allowlist ---
    apath = allowlist.resolve_allowlist_path()
    if not apath:
        logger.warn("diagnose: allowlist unavailable -- failing closed")
        return {"json": {"asset": asset, "error": "allowlist_unavailable",
                         "anomalies": [], "tag_count": 0, "good_count": 0}}
    try:
        approved = allowlist.load_allowlist(apath)
    except Exception as e:
        logger.warn("diagnose: allowlist load failed: %s" % str(e))
        return {"json": {"asset": asset, "error": "allowlist_error",
                         "anomalies": [], "tag_count": 0, "good_count": 0}}

    # Only allowlisted tags under this asset whose leaf name the rules actually use.
    prefix = asset + "/"
    paths = [p for p in approved
             if p.startswith(prefix) and tag_topic_map.leaf_name(p) in tag_topic_map.LEAF_MAP]
    paths.sort()

    pairs = []
    good_count = 0
    if paths:
        try:
            qvs = system.tag.readBlocking(paths)
        except Exception as e:
            logger.warn("diagnose: readBlocking failed: %s" % str(e))
            qvs = []
        for i in range(len(qvs)):
            qv = qvs[i]
            is_good = True
            try:
                is_good = qv.quality.isGood()
            except Exception:
                is_good = True
            if not is_good:
                continue
            good_count += 1
            pairs.append((paths[i], qv.value))

    snap = tag_topic_map.build_snap(pairs)

    # Stateless derived facts: A0 fires only when NO tag reads good (device/connection down).
    # The time-based rules (A6/A7/A10) stay dormant until the Phase-4 stateful poller exists.
    offline = good_count == 0 and len(paths) > 0
    derived = {
        "max_stale_s": 9999.0 if offline else 0.0,
        "cmd_run_for_s": 0.0,
        "freq_frozen_s": 0.0,
    }

    anomalies = diagnose_core.evaluate(snap, derived)
    cards = [a.to_dict() for a in anomalies]

    logger.info("diagnose asset=%s tags=%d good=%d -> %d anomalies (%s)"
                % (asset, len(paths), good_count, len(cards),
                   ", ".join([c["rule_id"] for c in cards]) or "none"))

    return {"json": {
        "asset": asset,
        "tag_count": len(paths),
        "good_count": good_count,
        "anomaly_count": len(cards),
        "anomalies": cards,
        "snap": snap,   # included for debugging / the panel's state header; small + read-only
    }}
