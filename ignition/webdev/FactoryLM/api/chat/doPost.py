# Web Dev Module Handler: POST /system/webdev/FactoryLM/api/chat
# Reads live tag snapshot for an asset, forwards query + context to MIRA Cloud,
# persists result to mira_chat_history, returns answer + sources.
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev
#
# Configuration (factorylm.properties or Ignition gateway environment):
#   MIRA_CLOUD_URL         — chat endpoint (default: https://api.factorylm.com/api/v1/ignition/chat)
#   MIRA_TENANT_ID         — tenant UUID assigned in Hub admin
#   MIRA_IGNITION_HMAC_KEY — HMAC-SHA256 signing key (required; fail-closed if absent)
#
# Config is read via getMiraConfig() which loads factorylm.properties from the
# well-known Ignition install paths (same pattern as tag-stream.py / fsm-monitor.py).


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
                pass  # try next path
            finally:
                fis.close()

    return default_value


def doPost(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Chat")

    # --- Config: read HMAC key, tenant id, and cloud URL ---
    hmac_key = getMiraConfig("MIRA_IGNITION_HMAC_KEY", "")
    tenant_id = getMiraConfig("MIRA_TENANT_ID", "")
    cloud_url = getMiraConfig(
        "MIRA_CLOUD_URL",
        "https://api.factorylm.com/api/v1/ignition/chat"
    )

    # Fail-fast: no unsigned requests permitted
    if not hmac_key:
        logger.error("MIRA_IGNITION_HMAC_KEY is not configured — refusing unsigned request")
        return {
            "json": {"error": "MIRA HMAC key not configured"},
            "status": 503
        }

    # --- Parse request body ---
    data = request.get("postData", {})
    if data is None:
        data = {}

    query = data.get("query", "").strip()
    asset_id = data.get("asset_id", "").strip()
    extra_context = data.get("context", "")
    operator = data.get("operator", "")

    # Validate required field
    if not query:
        logger.warn("Chat request received with empty query")
        return {"json": {"error": "query is required"}, "status": 400}

    logger.debug(
        "Chat request — asset: %s, query: %.80s" % (asset_id or "(none)", query)
    )

    # --- Read live tag snapshot for this asset ---
    snapshot = {}

    if asset_id:
        tag_folder = "[default]Mira_Monitored/%s" % asset_id
        try:
            tag_results = system.tag.browseTags(parentPath=tag_folder)
            tag_paths = [str(t.fullPath) for t in tag_results]

            if tag_paths:
                tag_values = system.tag.readBlocking(tag_paths)
                for i, path in enumerate(tag_paths):
                    qv = tag_values[i]
                    snapshot[path] = {
                        "value": str(qv.value),
                        "quality": str(qv.quality),
                        "timestamp": str(qv.timestamp)
                    }
                logger.debug(
                    "Tag snapshot for %s: %d tags read" % (asset_id, len(snapshot))
                )
            else:
                logger.debug("No tags found under %s" % tag_folder)

        except Exception as e:
            logger.warn(
                "Tag read failed for asset %s: %s" % (asset_id, str(e))
            )

    # --- Apply allowlist filter to snapshot (D1 task owns allowlist.py) ---
    # Import defensively: if task D1 has created the allowlist module, use it;
    # otherwise pass the snapshot through unchanged.
    filtered_snapshot = snapshot
    try:
        import os.path as _osp
        import sys as _sys

        _api_dir = _osp.dirname(_osp.abspath(__file__))
        _tags_dir = _osp.join(_osp.dirname(_api_dir), "tags")
        if _tags_dir not in _sys.path:
            _sys.path.insert(0, _tags_dir)

        from allowlist import is_allowed_tag
        filtered_snapshot = {
            path: val for path, val in snapshot.items()
            if is_allowed_tag(path)
        }
        if len(filtered_snapshot) < len(snapshot):
            logger.warn(
                "Allowlist filtered %d tag(s) from snapshot for asset %s"
                % (len(snapshot) - len(filtered_snapshot), asset_id)
            )
    except ImportError:
        # Task D1 allowlist not yet present — pass through
        pass
    except Exception as e:
        logger.warn("Allowlist filter error (passing through): %s" % str(e))

    # --- Build and sign the outgoing request ---
    import urllib2
    import json
    import os.path as osp
    import sys

    # Ensure the signing helper (sibling module) is importable from Jython
    _chat_dir = osp.dirname(osp.abspath(__file__))
    if _chat_dir not in sys.path:
        sys.path.insert(0, _chat_dir)

    from signing import build_headers

    cloud_payload_str = json.dumps({
        "query": query,
        "asset_id": asset_id,
        "tag_snapshot": filtered_snapshot,
        "context": extra_context,
        "tenant_id": tenant_id,
    })

    # Jython 2.7: json.dumps returns a unicode str; encode to bytes for HMAC
    try:
        cloud_payload_bytes = cloud_payload_str.encode("utf-8")
    except AttributeError:
        cloud_payload_bytes = cloud_payload_str  # already bytes in some Jython builds

    try:
        headers = build_headers(hmac_key, tenant_id, cloud_payload_bytes)
    except ValueError as e:
        logger.error("HMAC signing failed: %s" % str(e))
        return {
            "json": {"error": "MIRA HMAC key not configured"},
            "status": 503
        }

    # --- POST to MIRA Cloud ---
    try:
        req = urllib2.Request(cloud_url, cloud_payload_bytes)
        for hdr_name, hdr_val in headers.items():
            req.add_header(hdr_name, hdr_val)

        response = urllib2.urlopen(req, timeout=30)
        result = json.loads(response.read())

    except urllib2.HTTPError as e:
        body = ""
        try:
            body = e.read()
        except Exception:
            pass

        if e.code == 401:
            # Specific: auth failure — guide operator to the key config
            logger.error(
                "MIRA Cloud auth failure (HTTP 401) for asset %s "
                "— check MIRA_IGNITION_HMAC_KEY in factorylm.properties" % asset_id
            )
            return {
                "json": {
                    "error": "Authentication failed — check MIRA_IGNITION_HMAC_KEY",
                    "http_status": 401
                },
                "status": 502
            }

        logger.error(
            "MIRA Cloud returned HTTP %d: %s" % (e.code, body[:200])
        )
        return {
            "json": {
                "error": "MIRA Cloud returned error",
                "http_status": e.code,
                "detail": body[:200]
            },
            "status": 502
        }

    except urllib2.URLError as e:
        logger.error("MIRA Cloud unreachable: %s" % str(e))
        return {
            "json": {
                "error": "MIRA Cloud unreachable",
                "detail": str(e)
            },
            "status": 503
        }

    except Exception as e:
        logger.error("Unexpected error calling MIRA Cloud: %s" % str(e))
        return {
            "json": {
                "error": "Internal error",
                "detail": str(e)
            },
            "status": 500
        }

    # --- Persist to chat history (audit trail — non-critical path) ---
    try:
        sources_json = json.dumps(result.get("sources", []))
        answer = result.get("answer", "")

        system.db.runPrepUpdate(
            "INSERT INTO mira_chat_history "
            "(asset_id, query, answer, sources_json, operator, created_at) "
            "VALUES (?, ?, ?, ?, ?, NOW())",
            [asset_id, query, answer, sources_json, operator]
        )
    except Exception as e:
        # Non-fatal — chat history is audit trail, not critical path
        logger.warn("Chat history save failed: %s" % str(e))

    logger.info(
        "Chat query completed — asset: %s, query: %.80s" % (asset_id, query)
    )

    return {"json": result}
