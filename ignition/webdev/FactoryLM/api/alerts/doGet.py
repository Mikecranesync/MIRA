# Web Dev Module Handler: GET /system/webdev/FactoryLM/api/alerts
# Returns recent anomalies from mira_anomalies table.
# Query params:
#   asset  — filter by asset_id (optional, returns all assets if omitted)
#   limit  — max rows to return (default: 20, max: 200)
#   since  — ISO timestamp to filter from (optional)
#   unacked_only — "true" to return only unacknowledged alerts (optional)
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev

# Hard cap on rows returned per request
ABSOLUTE_MAX_LIMIT = 200
DEFAULT_LIMIT = 20


def doGet(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Alerts")

    # --- Parse query parameters ---
    params = request.get("params", {})
    if params is None:
        params = {}

    asset_id = params.get("asset", "").strip()
    unacked_only = params.get("unacked_only", "false").strip().lower() == "true"
    since_ts = params.get("since", "").strip()

    # Parse and clamp limit
    try:
        limit = int(params.get("limit", DEFAULT_LIMIT))
        if limit < 1:
            limit = DEFAULT_LIMIT
        elif limit > ABSOLUTE_MAX_LIMIT:
            limit = ABSOLUTE_MAX_LIMIT
    except (ValueError, TypeError):
        limit = DEFAULT_LIMIT

    logger.debug(
        "Alerts request — asset: %s, limit: %d, unacked_only: %s"
        % (asset_id or "(all)", limit, unacked_only)
    )

    # --- Build query dynamically ---
    # Base columns — map to dict keys for JSON serialization
    sql_base = (
        "SELECT id, asset_id, detection_type, severity, "
        "from_state, to_state, expected_ms, actual_ms, sigma, "
        "message, acknowledged, created_at "
        "FROM mira_anomalies"
    )

    conditions = []
    args = []

    if asset_id:
        conditions.append("asset_id = ?")
        args.append(asset_id)

    if unacked_only:
        conditions.append("acknowledged = 0")

    if since_ts:
        # Expect ISO format: 2026-03-31T14:00:00
        # The DB stores TIMESTAMP; comparison works for standard ISO strings
        conditions.append("created_at >= ?")
        args.append(since_ts)

    if conditions:
        sql = sql_base + " WHERE " + " AND ".join(conditions)
    else:
        sql = sql_base

    sql += " ORDER BY created_at DESC LIMIT ?"
    args.append(limit)

    # --- Execute query ---
    alerts = []

    try:
        dataset = system.db.runPrepQuery(sql, args)

        # system.db.runPrepQuery returns an Ignition Dataset object.
        # Iterate rows by index.
        row_count = dataset.rowCount
        col_names = [
            "id", "asset_id", "detection_type", "severity",
            "from_state", "to_state", "expected_ms", "actual_ms", "sigma",
            "message", "acknowledged", "created_at"
        ]

        for row_idx in range(row_count):
            row_dict = {}
            for col_idx, col_name in enumerate(col_names):
                val = dataset.getValueAt(row_idx, col_idx)
                # Convert Java types to Python-native for JSON serialization
                if val is None:
                    row_dict[col_name] = None
                else:
                    # Timestamps become strings; numerics stay numeric
                    row_dict[col_name] = str(val) if hasattr(val, "getTime") else val
            alerts.append(row_dict)

        logger.debug(
            "Alerts query returned %d rows for asset: %s"
            % (row_count, asset_id or "(all)")
        )

    except Exception as e:
        logger.error("Alerts DB query failed: %s" % str(e))
        return {
            "json": {
                "error": "Database query failed",
                "detail": str(e)
            },
            "status": 500
        }

    # --- Also read latest in-memory alert tag for each requested asset ---
    latest_tags = {}

    if asset_id:
        assets_to_check = [asset_id]
    else:
        # Only read latest tags when specific asset requested (avoid tag storm)
        assets_to_check = []

    for aid in assets_to_check:
        tag_path = "[default]Mira_Alerts/%s/Latest" % aid
        try:
            qv = system.tag.readBlocking([tag_path])[0]
            if qv.quality.isGood() and qv.value:
                latest_tags[aid] = str(qv.value)
        except Exception as e:
            logger.debug("Could not read alert tag for %s: %s" % (aid, str(e)))

    return {
        "json": {
            "alerts": alerts,
            "count": len(alerts),
            "asset_filter": asset_id or None,
            "latest_tags": latest_tags
        }
    }
