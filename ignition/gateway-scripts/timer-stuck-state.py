# Gateway Timer Script — Stuck State Checker
# Configured in: Designer > Gateway Event Scripts > Timer Scripts
# Schedule: every 10 seconds
#
# For each asset in [default]Mira_Monitored:
#   1. Read the current State tag and its timestamp
#   2. Compute dwell_ms = now - timestamp
#   3. Load FSM model; find max_ms across all outgoing transitions from current_state
#   4. If dwell_ms > max_ms * STUCK_MULTIPLIER → write STUCK_STATE anomaly
#
# Config keys (factorylm.properties):
#   STUCK_MULTIPLIER  — multiplier on max_ms before declaring stuck (default: 3.0)
#   STUCK_MIN_MS      — minimum dwell before any stuck check fires (default: 5000 ms)
#
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/platform/scripting/scripting-in-ignition/gateway-event-scripts

logger = system.util.getLogger("FactoryLM.Mira.StuckState")


# ---------------------------------------------------------------------------
# Config helper (same pattern as tag-change-fsm-monitor.py)
# ---------------------------------------------------------------------------

def getMiraConfig(key, default_value=""):
    """Read a property from factorylm.properties."""
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
                logger.warn("Failed to load properties from %s: %s" % (p, str(load_err)))
            finally:
                fis.close()

    return default_value


# ---------------------------------------------------------------------------
# Timer callback — required signature for Ignition Gateway Timer Scripts
# ---------------------------------------------------------------------------

def runScript():
    import java.util.Date as Date
    import json

    # --- Load configuration ---
    multiplier_str = getMiraConfig("STUCK_MULTIPLIER", "3.0")
    min_ms_str = getMiraConfig("STUCK_MIN_MS", "5000")

    try:
        stuck_multiplier = float(multiplier_str)
    except (ValueError, TypeError):
        logger.warn(
            "Invalid STUCK_MULTIPLIER '%s', using default 3.0" % multiplier_str
        )
        stuck_multiplier = 3.0

    try:
        stuck_min_ms = float(min_ms_str)
    except (ValueError, TypeError):
        logger.warn(
            "Invalid STUCK_MIN_MS '%s', using default 5000" % min_ms_str
        )
        stuck_min_ms = 5000.0

    now_ms = Date().getTime()

    # --- Enumerate all monitored assets ---
    try:
        asset_folders = system.tag.browseTags(
            parentPath="[default]Mira_Monitored",
            tagType="Folder"
        )
    except Exception as e:
        logger.error("Could not browse Mira_Monitored: %s" % str(e))
        return

    for asset_folder in asset_folders:
        asset_id = str(asset_folder.name)
        state_path = "[default]Mira_Monitored/%s/State" % asset_id

        # ---------------------------------------------------------------
        # Read current state and its timestamp
        # ---------------------------------------------------------------
        try:
            qvs = system.tag.readBlocking([state_path])
            qv = qvs[0]
        except Exception as e:
            logger.debug(
                "Could not read State tag for %s: %s" % (asset_id, str(e))
            )
            continue

        # Skip bad-quality reads — tag may not exist yet
        if not qv.quality.isGood():
            logger.debug(
                "State tag quality not good for %s: %s" % (asset_id, str(qv.quality))
            )
            continue

        current_state = str(qv.value) if qv.value is not None else ""
        if not current_state:
            continue

        # Compute how long the asset has been in this state
        state_since = qv.timestamp
        if state_since is None:
            logger.debug("No timestamp on State tag for %s" % asset_id)
            continue

        dwell_ms = now_ms - state_since.getTime()

        if dwell_ms < stuck_min_ms:
            # Too early to declare stuck — normal transient
            continue

        logger.debug(
            "Asset %s in state '%s' for %.1f s"
            % (asset_id, current_state, dwell_ms / 1000.0)
        )

        # ---------------------------------------------------------------
        # Load FSM model for this asset
        # ---------------------------------------------------------------
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
            continue

        if not fsm_json:
            logger.debug(
                "No FSM model for asset %s — skipping stuck check" % asset_id
            )
            continue

        try:
            fsm = json.loads(fsm_json)
        except Exception as e:
            logger.error(
                "Invalid FSM JSON for asset %s: %s" % (asset_id, str(e))
            )
            continue

        # ---------------------------------------------------------------
        # Find the maximum allowed dwell time for current_state.
        # The FSM encodes max_ms per outgoing transition; we take the
        # maximum across all outgoing transitions as the overall budget.
        # ---------------------------------------------------------------
        outgoing = fsm.get(current_state, {})

        if not outgoing:
            # Terminal / unknown state — no timing constraint
            logger.debug(
                "No outgoing transitions for state '%s' on asset %s"
                % (current_state, asset_id)
            )
            continue

        max_ms_for_state = 0.0
        for next_state, envelope in outgoing.items():
            candidate_max = float(envelope.get("max_ms", 0) or 0)
            if candidate_max > max_ms_for_state:
                max_ms_for_state = candidate_max

        if max_ms_for_state <= 0:
            # Model exists but no max_ms data — skip
            logger.debug(
                "max_ms is 0 for all transitions from '%s' on asset %s"
                % (current_state, asset_id)
            )
            continue

        stuck_threshold_ms = max_ms_for_state * stuck_multiplier

        if dwell_ms > stuck_threshold_ms:
            # -------------------------------------------------------
            # STUCK_STATE detected — write alert tag and persist
            # -------------------------------------------------------
            anomaly = {
                "type": "STUCK_STATE",
                "severity": "CRITICAL",
                "asset_id": asset_id,
                "current_state": current_state,
                "from_state": current_state,
                "to_state": "",
                "dwell_ms": dwell_ms,
                "max_ms": max_ms_for_state,
                "expected_ms": max_ms_for_state,
                "actual_ms": dwell_ms,
                "sigma": 0,
                "message": (
                    "Asset %s stuck in state '%s' for %.1f s "
                    "(threshold: %.1f s)"
                    % (
                        asset_id,
                        current_state,
                        dwell_ms / 1000.0,
                        stuck_threshold_ms / 1000.0
                    )
                )
            }

            try:
                anomaly_json = json.dumps(anomaly)
            except Exception as e:
                logger.error(
                    "Failed to serialize stuck-state anomaly for %s: %s"
                    % (asset_id, str(e))
                )
                continue

            # Write Memory tag
            alert_tag = "[default]Mira_Alerts/%s/Latest" % asset_id
            try:
                system.tag.writeBlocking([alert_tag], [anomaly_json])
            except Exception as e:
                logger.warn(
                    "Could not write alert tag for %s: %s" % (asset_id, str(e))
                )

            # Persist to DB — avoid spamming; check if recent identical
            # alert already exists (within last 60 seconds)
            try:
                recent = system.db.runScalarQuery(
                    "SELECT COUNT(*) FROM mira_anomalies "
                    "WHERE asset_id = ? "
                    "AND detection_type = 'STUCK_STATE' "
                    "AND from_state = ? "
                    "AND created_at > (NOW() - INTERVAL 60 SECOND)",
                    [asset_id, current_state]
                )
                if not recent or int(recent) == 0:
                    system.db.runPrepUpdate(
                        "INSERT INTO mira_anomalies "
                        "(asset_id, detection_type, severity, from_state, to_state, "
                        " expected_ms, actual_ms, sigma, message, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
                        [
                            asset_id,
                            "STUCK_STATE",
                            "CRITICAL",
                            current_state,
                            "",
                            max_ms_for_state,
                            dwell_ms,
                            0.0,
                            anomaly["message"]
                        ]
                    )
                else:
                    logger.debug(
                        "Suppressed duplicate STUCK_STATE for %s in '%s'"
                        % (asset_id, current_state)
                    )
            except Exception as e:
                logger.error(
                    "DB insert failed for stuck-state anomaly on %s: %s"
                    % (asset_id, str(e))
                )

            logger.warn(
                "STUCK STATE [CRITICAL] %s in state '%s': %.1f s > threshold %.1f s"
                % (asset_id, current_state, dwell_ms / 1000.0, stuck_threshold_ms / 1000.0)
            )
