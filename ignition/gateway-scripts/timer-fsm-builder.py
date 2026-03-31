# Gateway Timer Script — FSM Baseline Builder
# Configured in: Designer > Gateway Event Scripts > Timer Scripts
# Schedule: every 3600 seconds (1 hour)
#
# Logic per asset in [default]Mira_Monitored:
#   1. Count rows in mira_fsm_models for this asset
#   2. If no model exists AND the asset's history has >= MIN_CYCLES state transitions:
#      a. Query system.tag.queryTagHistory for the State tag
#      b. POST the history to RAG sidecar POST /build_fsm
#      c. Store returned FSM JSON in mira_fsm_models table
#   3. If a model already exists AND cycle count > REBUILD_THRESHOLD:
#      rebuild (update the model)
#
# Config keys (factorylm.properties):
#   FSM_MIN_CYCLES      — minimum cycle count before building model (default: 50)
#   FSM_REBUILD_CYCLES  — cycle count delta to trigger rebuild (default: 500)
#   FSM_HISTORY_HOURS   — hours of history to feed the sidecar (default: 168 = 7 days)
#
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/platform/scripting/scripting-in-ignition/gateway-event-scripts
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/appendix/scripting-functions/system-tag/system-tag-queryTagHistory

logger = system.util.getLogger("FactoryLM.Mira.FSMBuilder")


# ---------------------------------------------------------------------------
# Config helper (consistent with other gateway scripts)
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
# History query helper
# ---------------------------------------------------------------------------

def _query_state_history(asset_id, history_hours):
    """
    Query Ignition tag history for the State tag of an asset.
    Returns a list of dicts: [{"timestamp": ms, "value": "STATE_NAME"}, ...]
    sorted chronologically (oldest first).
    Raises on error.
    """
    import java.util.Date as Date

    tag_path = "[default]Mira_Monitored/%s/State" % asset_id

    end_date = Date()
    start_ms = end_date.getTime() - (long(history_hours) * 3600 * 1000)
    import java.util.Date as JavaDate
    start_date = JavaDate(start_ms)

    # queryTagHistory returns a Dataset
    # Params: paths, startDate, endDate, returnSize, aggregationMode, returnFormat
    # Use returnSize=0 for all raw values, aggregationMode="LastValue" for state changes
    history_ds = system.tag.queryTagHistory(
        paths=[tag_path],
        startDate=start_date,
        endDate=end_date,
        returnSize=0,
        aggregationMode="LastValue",
        returnFormat="Wide"
    )

    records = []
    if history_ds is None:
        return records

    row_count = history_ds.rowCount
    for row_idx in range(row_count):
        try:
            ts_obj = history_ds.getValueAt(row_idx, 0)  # column 0 = timestamp
            val_obj = history_ds.getValueAt(row_idx, 1)  # column 1 = tag value

            if ts_obj is not None and val_obj is not None:
                records.append({
                    "timestamp_ms": ts_obj.getTime(),
                    "value": str(val_obj)
                })
        except Exception as row_err:
            logger.debug(
                "Skipping history row %d for %s: %s"
                % (row_idx, asset_id, str(row_err))
            )

    # Sort chronologically
    records.sort(key=lambda r: r["timestamp_ms"])
    return records


def _count_cycles(history_records):
    """
    Count state-change cycles in a history list.
    A 'cycle' = one complete round trip back to the initial state.
    For simplicity we count total state transitions / 2 as a conservative proxy.
    """
    if len(history_records) < 2:
        return 0
    transitions = 0
    prev_val = history_records[0]["value"]
    for rec in history_records[1:]:
        if rec["value"] != prev_val:
            transitions += 1
            prev_val = rec["value"]
    return transitions / 2


# ---------------------------------------------------------------------------
# Sidecar call helper
# ---------------------------------------------------------------------------

def _call_build_fsm(asset_id, history_records):
    """
    POST history to RAG sidecar /build_fsm endpoint.
    Returns parsed JSON dict from sidecar, or raises on error.
    """
    import urllib2
    import json

    payload = json.dumps({
        "asset_id": asset_id,
        "history": history_records
    })

    req = urllib2.Request(
        "http://localhost:5000/build_fsm",
        payload,
        {"Content-Type": "application/json"}
    )
    # Building FSM can be slow on large history — generous timeout
    response = urllib2.urlopen(req, timeout=120)
    return json.loads(response.read())


# ---------------------------------------------------------------------------
# Model persistence
# ---------------------------------------------------------------------------

def _save_model(asset_id, model_json, cycle_count):
    """Insert a new FSM model row. Keeps history; latest is queried by ORDER BY."""
    try:
        system.db.runPrepUpdate(
            "INSERT INTO mira_fsm_models "
            "(asset_id, model_json, cycle_count, created_at) "
            "VALUES (?, ?, ?, NOW())",
            [asset_id, model_json, cycle_count]
        )
        logger.info(
            "FSM model saved for asset %s (%d cycles, %d bytes)"
            % (asset_id, cycle_count, len(model_json))
        )
    except Exception as e:
        logger.error(
            "Failed to save FSM model for %s: %s" % (asset_id, str(e))
        )
        raise


# ---------------------------------------------------------------------------
# Timer callback
# ---------------------------------------------------------------------------

def runScript():
    import json

    # --- Load configuration ---
    min_cycles_str = getMiraConfig("FSM_MIN_CYCLES", "50")
    rebuild_cycles_str = getMiraConfig("FSM_REBUILD_CYCLES", "500")
    history_hours_str = getMiraConfig("FSM_HISTORY_HOURS", "168")

    try:
        min_cycles = int(min_cycles_str)
    except (ValueError, TypeError):
        min_cycles = 50

    try:
        rebuild_threshold = int(rebuild_cycles_str)
    except (ValueError, TypeError):
        rebuild_threshold = 500

    try:
        history_hours = int(history_hours_str)
    except (ValueError, TypeError):
        history_hours = 168

    # --- Enumerate monitored assets ---
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

        logger.debug("FSM builder checking asset: %s" % asset_id)

        # ---------------------------------------------------------------
        # Check for existing model and its cycle count
        # ---------------------------------------------------------------
        existing_cycle_count = 0
        model_exists = False

        try:
            row = system.db.runScalarQuery(
                "SELECT cycle_count FROM mira_fsm_models "
                "WHERE asset_id = ? "
                "ORDER BY created_at DESC LIMIT 1",
                [asset_id]
            )
            if row is not None:
                model_exists = True
                existing_cycle_count = int(row)
        except Exception as e:
            logger.warn(
                "Could not query existing model for %s: %s" % (asset_id, str(e))
            )

        # ---------------------------------------------------------------
        # Query tag history to count current cycles
        # ---------------------------------------------------------------
        try:
            history_records = _query_state_history(asset_id, history_hours)
        except Exception as e:
            logger.warn(
                "Tag history query failed for %s: %s" % (asset_id, str(e))
            )
            continue

        if not history_records:
            logger.debug(
                "No history data for asset %s — skipping" % asset_id
            )
            continue

        current_cycles = _count_cycles(history_records)

        logger.debug(
            "Asset %s: model_exists=%s, existing_cycles=%d, current_cycles=%d"
            % (asset_id, model_exists, existing_cycle_count, current_cycles)
        )

        # ---------------------------------------------------------------
        # Decide whether to build / rebuild
        # ---------------------------------------------------------------
        should_build = False
        reason = ""

        if not model_exists and current_cycles >= min_cycles:
            should_build = True
            reason = "first build (%d cycles >= min %d)" % (current_cycles, min_cycles)

        elif model_exists and (current_cycles - existing_cycle_count) >= rebuild_threshold:
            should_build = True
            reason = "rebuild — %d new cycles since last build" % (
                current_cycles - existing_cycle_count
            )

        if not should_build:
            if not model_exists:
                logger.debug(
                    "Asset %s: %d cycles, need %d to build FSM"
                    % (asset_id, current_cycles, min_cycles)
                )
            else:
                logger.debug(
                    "Asset %s: FSM model up to date" % asset_id
                )
            continue

        logger.info(
            "Building FSM model for %s: %s" % (asset_id, reason)
        )

        # ---------------------------------------------------------------
        # Call sidecar to build FSM
        # ---------------------------------------------------------------
        try:
            sidecar_result = _call_build_fsm(asset_id, history_records)
        except Exception as e:
            logger.error(
                "Sidecar /build_fsm failed for %s: %s" % (asset_id, str(e))
            )
            continue

        fsm_model = sidecar_result.get("fsm_model")
        if not fsm_model:
            logger.warn(
                "Sidecar returned no fsm_model for %s" % asset_id
            )
            continue

        try:
            model_json = json.dumps(fsm_model)
        except Exception as e:
            logger.error(
                "Could not serialize FSM model for %s: %s" % (asset_id, str(e))
            )
            continue

        # ---------------------------------------------------------------
        # Persist model
        # ---------------------------------------------------------------
        try:
            _save_model(asset_id, model_json, current_cycles)
        except Exception:
            # Error already logged in _save_model
            continue

        logger.info(
            "FSM model built and stored for asset %s (%d states, %d transitions, %d cycles)"
            % (
                asset_id,
                sidecar_result.get("state_count", 0),
                sidecar_result.get("transition_count", 0),
                current_cycles
            )
        )
