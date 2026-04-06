# Gateway Tag Change Script — FSM Transition Monitor
# Watches: [default]Mira_Monitored/*/State  (wildcard path in Designer)
#
# Detects two anomaly types:
#   FORBIDDEN_TRANSITION — to_state not in learned FSM model
#   TIMING_DEVIATION     — dwell time outside N-sigma envelope
#
# On anomaly:
#   1. Writes JSON to [default]Mira_Alerts/{asset_id}/Latest (Memory tag)
#   2. Persists row to mira_anomalies table
#
# Configuration:
#   FSM_N_SIGMA   — sigma threshold for timing deviation (default: 2.5)
#   Loaded from factorylm.properties via getMiraConfig()
#
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/platform/scripting/scripting-in-ignition/gateway-event-scripts

logger = system.util.getLogger("FactoryLM.Mira.FSMMonitor")


# ---------------------------------------------------------------------------
# Config helper — reads factorylm.properties from well-known install paths
# ---------------------------------------------------------------------------

def getMiraConfig(key, default_value=""):
    """
    Read a property from factorylm.properties.
    Tries Windows and Linux Ignition install paths in order.
    Returns default_value if the file is not found or the key is absent.
    """
    import java.io.FileInputStream as FileInputStream
    import java.util.Properties as Properties
    import java.io.File as File

    paths = [
        "C:/Program Files/Inductive Automation/Ignition/data/factorylm/factorylm.properties",
        "/usr/local/bin/ignition/data/factorylm/factorylm.properties",
        "/var/lib/ignition/data/factorylm/factorylm.properties",
    ]

    for p in paths:
        f = File(p)
        if f.exists():
            props = Properties()
            fis = FileInputStream(f)
            try:
                props.load(fis)
                return props.getProperty(key, default_value)
            except Exception as load_err:
                logger.warn(
                    "Failed to load properties from %s: %s" % (p, str(load_err))
                )
            finally:
                fis.close()

    return default_value


# ---------------------------------------------------------------------------
# Anomaly persistence helpers
# ---------------------------------------------------------------------------

def _write_alert_tag(asset_id, anomaly_json):
    """Write anomaly JSON string to the asset's Mira_Alerts/Latest memory tag."""
    alert_tag = "[default]Mira_Alerts/%s/Latest" % asset_id
    try:
        system.tag.writeBlocking([alert_tag], [anomaly_json])
    except Exception as e:
        logger.warn(
            "Could not write alert tag for %s: %s" % (asset_id, str(e))
        )


def _persist_anomaly(anomaly):
    """Insert a row into mira_anomalies. Non-fatal on DB failure."""
    try:
        system.db.runPrepUpdate(
            "INSERT INTO mira_anomalies "
            "(asset_id, detection_type, severity, from_state, to_state, "
            " expected_ms, actual_ms, sigma, message, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
            [
                anomaly.get("asset_id", ""),
                anomaly.get("type", ""),
                anomaly.get("severity", ""),
                anomaly.get("from_state", ""),
                anomaly.get("to_state", ""),
                float(anomaly.get("expected_ms", 0) or 0),
                float(anomaly.get("actual_ms", 0) or 0),
                float(anomaly.get("sigma", 0) or 0),
                anomaly.get("message", "")
            ]
        )
    except Exception as e:
        logger.error(
            "DB insert failed for anomaly on asset %s: %s"
            % (anomaly.get("asset_id", "?"), str(e))
        )


# ---------------------------------------------------------------------------
# Tag Change callback
# Signature required by Ignition Gateway Tag Change Scripts.
# ---------------------------------------------------------------------------

def valueChanged(tag, tagPath, previousValue, currentValue, initialChange, missedEvents):
    # Skip the initial synthetic event fired on script load
    if initialChange:
        return

    # -----------------------------------------------------------------------
    # Extract asset_id from tag path.
    # Tag path format: [default]Mira_Monitored/conveyor_3/State
    # After stripping provider and leading slash: Mira_Monitored/conveyor_3/State
    # parts[0] = "Mira_Monitored", parts[1] = "conveyor_3", parts[2] = "State"
    # -----------------------------------------------------------------------
    path_str = str(tagPath)
    # Remove provider prefix e.g. "[default]"
    bracket_end = path_str.find("]")
    if bracket_end >= 0:
        path_str = path_str[bracket_end + 1:]
    parts = path_str.strip("/").split("/")

    if len(parts) < 3:
        logger.debug("Unexpected tag path structure: %s" % str(tagPath))
        return

    asset_id = parts[1]
    from_state = str(previousValue.value) if previousValue.value is not None else ""
    to_state = str(currentValue.value) if currentValue.value is not None else ""

    # Skip if state value is empty or unchanged (quality transition only)
    if not to_state:
        return
    if from_state == to_state:
        logger.debug(
            "Same-state transition on %s (quality change?): %s -> %s"
            % (asset_id, from_state, to_state)
        )
        return

    # -----------------------------------------------------------------------
    # Calculate transition dwell time in milliseconds
    # -----------------------------------------------------------------------
    delta_ms = 0
    try:
        prev_ts = previousValue.timestamp
        curr_ts = currentValue.timestamp
        if prev_ts is not None and curr_ts is not None:
            delta_ms = curr_ts.getTime() - prev_ts.getTime()
            if delta_ms < 0:
                delta_ms = 0
    except Exception as e:
        logger.warn(
            "Timestamp calculation failed for %s: %s" % (asset_id, str(e))
        )

    logger.debug(
        "State change on %s: %s -> %s in %d ms"
        % (asset_id, from_state, to_state, delta_ms)
    )

    # -----------------------------------------------------------------------
    # Load FSM model from database
    # SELECT most recent model for this asset
    # -----------------------------------------------------------------------
    try:
        fsm_json = system.db.runScalarQuery(
            "SELECT model_json FROM mira_fsm_models "
            "WHERE asset_id = ? "
            "ORDER BY created_at DESC LIMIT 1",
            [asset_id]
        )
    except Exception as e:
        logger.error(
            "DB query failed for FSM model of %s: %s" % (asset_id, str(e))
        )
        return

    if not fsm_json:
        logger.debug(
            "No FSM model for asset %s — skipping anomaly check" % asset_id
        )
        return

    import json

    try:
        fsm = json.loads(fsm_json)
    except Exception as e:
        logger.error(
            "Invalid FSM JSON for asset %s: %s" % (asset_id, str(e))
        )
        return

    # -----------------------------------------------------------------------
    # Load N-sigma threshold from properties (default 2.5)
    # -----------------------------------------------------------------------
    n_sigma_str = getMiraConfig("FSM_N_SIGMA", "2.5")
    try:
        n_sigma = float(n_sigma_str)
    except (ValueError, TypeError):
        logger.warn(
            "Invalid FSM_N_SIGMA value '%s', using default 2.5" % n_sigma_str
        )
        n_sigma = 2.5

    # -----------------------------------------------------------------------
    # Check transition validity
    # FSM structure: { "STATE_A": { "STATE_B": { mean_ms, stddev_ms, max_ms, ... } } }
    # -----------------------------------------------------------------------
    anomaly = None
    transitions = fsm.get(from_state, {})

    if to_state not in transitions:
        # FORBIDDEN_TRANSITION — this edge doesn't exist in the learned model
        anomaly = {
            "type": "FORBIDDEN_TRANSITION",
            "severity": "CRITICAL",
            "asset_id": asset_id,
            "from_state": from_state,
            "to_state": to_state,
            "expected_ms": 0,
            "actual_ms": delta_ms,
            "sigma": 0,
            "message": "Transition %s -> %s not in learned FSM model for asset %s"
                       % (from_state, to_state, asset_id)
        }
    else:
        envelope = transitions[to_state]

        # Skip timing check for accepting/terminal transitions where timing is irrelevant
        if not envelope.get("is_accepting", False):
            mean_ms = float(envelope.get("mean_ms", 0) or 0)
            stddev_ms = float(envelope.get("stddev_ms", 0) or 0)

            if stddev_ms > 0 and delta_ms > 0:
                sigma = abs(delta_ms - mean_ms) / stddev_ms

                if sigma > n_sigma:
                    # Severity escalation: > 5 sigma is CRITICAL, else WARNING
                    severity = "CRITICAL" if sigma > 5.0 else "WARNING"

                    anomaly = {
                        "type": "TIMING_DEVIATION",
                        "severity": severity,
                        "asset_id": asset_id,
                        "from_state": from_state,
                        "to_state": to_state,
                        "expected_ms": mean_ms,
                        "actual_ms": delta_ms,
                        "sigma": sigma,
                        "message": (
                            "Transition %s -> %s on %s: "
                            "%.0f ms vs expected %.0f ms (%.1f sigma)"
                            % (from_state, to_state, asset_id,
                               delta_ms, mean_ms, sigma)
                        )
                    }
            else:
                # Model exists but stddev is 0 or delta is 0 — not enough info to evaluate
                logger.debug(
                    "Skipping timing check for %s %s->%s: stddev=%.1f, delta=%d"
                    % (asset_id, from_state, to_state, stddev_ms, delta_ms)
                )

    # -----------------------------------------------------------------------
    # Publish anomaly if detected
    # -----------------------------------------------------------------------
    if anomaly:
        try:
            anomaly_json = json.dumps(anomaly)
        except Exception as e:
            logger.error(
                "Failed to serialize anomaly for %s: %s" % (asset_id, str(e))
            )
            return

        _write_alert_tag(asset_id, anomaly_json)
        _persist_anomaly(anomaly)

        logger.warn(
            "ANOMALY [%s] %s on %s: %s"
            % (anomaly["severity"], anomaly["type"], asset_id, anomaly["message"])
        )
    else:
        logger.debug(
            "Transition OK on %s: %s -> %s in %d ms"
            % (asset_id, from_state, to_state, delta_ms)
        )
