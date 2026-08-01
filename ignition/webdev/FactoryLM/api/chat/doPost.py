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
    #
    # ONE CREDENTIAL, ONE CONTRACT — plus a compatibility shim.
    # The two transports read DIFFERENT property names for the same two secrets:
    # this handler wanted MIRA_TENANT_ID / MIRA_IGNITION_HMAC_KEY, while
    # gateway-scripts/tag-stream.py wanted TENANT_ID / MIRA_HMAC_KEY. The
    # install guide and the activation handler (api/connect/doPost.py) only ever
    # wrote the stream's pair, so a freshly activated gateway streamed tags
    # correctly and returned HTTP 503 on EVERY chat turn. That is the same
    # defect shape this module exists to remove — two names for one thing —
    # one layer down, in the deployment contract instead of the tag payload.
    #
    # Canonical is the MIRA_-prefixed pair: it matches the cloud side's env vars
    # (docker-compose.saas.yml) and the relay's verifier. The legacy names are
    # still accepted so gateways already in the field keep working on upgrade.
    hmac_key = (getMiraConfig("MIRA_IGNITION_HMAC_KEY", "")
                or getMiraConfig("MIRA_HMAC_KEY", ""))
    tenant_id = (getMiraConfig("MIRA_TENANT_ID", "")
                 or getMiraConfig("TENANT_ID", ""))
    cloud_url = getMiraConfig(
        "MIRA_CLOUD_URL",
        "https://api.factorylm.com/api/v1/ignition/chat"
    )

    # Fail-fast: no unsigned requests permitted
    if not hmac_key:
        logger.error(
            "No HMAC key configured (looked for MIRA_IGNITION_HMAC_KEY, then the "
            "legacy MIRA_HMAC_KEY) in factorylm.properties — refusing to send an "
            "unsigned request. See docs/integrations/ignition-tag-collector.md."
        )
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

    # --- Read live tag snapshot via THE canonical adapter ---
    #
    # api/tags/gateway_live_snapshot.py is the single Gateway live-snapshot adapter, and
    # it renders the SAME typed readings that gateway-scripts/tag-stream.py
    # streams to mira-relay (both go through collector.build_reading). Do not
    # read tags inline here again.
    #
    # This replaced a local read that stringified every value (`str(qv.value)`),
    # forwarded the raw Ignition quality string unbanded, and applied the
    # allowlist inside `except ImportError: pass` — i.e. FAIL-OPEN, shipping an
    # unfiltered snapshot whenever that import failed. The adapter is fail-closed:
    # no resolvable allowlist means an EMPTY snapshot, never an unfiltered one.
    filtered_snapshot = {}
    try:
        import os.path as _osp
        import sys as _sys

        # `__file__` is UNDEFINED in an Ignition script resource — collector.py
        # documents the same trap and guards it the same way. No CPython test can
        # catch it, because `__file__` always exists under pytest (regime7 runs
        # this handler under CPython too), so the guard is asserted on the AST by
        # tests/ignition/test_gateway_live_snapshot.py.
        #
        # The consequence depends on where the dereference sits, and BOTH are real
        # in this file: here, inside the try, an unguarded NameError is swallowed
        # by `except Exception` below → warn + EMPTY snapshot, indistinguishable
        # from "this asset has no tags". At the signing path dance further down it
        # sits OUTSIDE any try → uncaught NameError → HTTP 500 on every turn. Do
        # not read this block as covering the class; each site needs its own guard.
        #
        # The sys.path dance is only needed for the repo source layout; on a
        # Gateway the module is a flat sibling on the script path.
        try:
            _api_dir = _osp.dirname(_osp.abspath(__file__))
            _tags_dir = _osp.join(_osp.dirname(_api_dir), "tags")
            if _tags_dir not in _sys.path:
                _sys.path.insert(0, _tags_dir)
        except NameError:
            pass  # script resource: flat sibling, no path setup required

        from gateway_live_snapshot import collect_live_snapshot

        def _browse(folder):
            return system.tag.browseTags(parentPath=folder)

        def _read(paths):
            return system.tag.readBlocking(paths)

        filtered_snapshot, snap_stats = collect_live_snapshot(
            _browse, _read, asset_id
        )
        if not snap_stats["allowlist_loaded"] and snap_stats["read"]:
            # Loud: the tags were readable but no allowlist resolved, so the
            # snapshot was dropped on purpose. Silence here would look like
            # "this asset has no tags".
            logger.error(
                "No approved_tags allowlist resolved — dropped all %d tag(s) for "
                "asset %s (fail-closed). Check approved_tags.json deployment."
                % (snap_stats["read"], asset_id)
            )
        elif snap_stats["dropped"]:
            logger.warn(
                "Allowlist filtered %d of %d tag(s) for asset %s"
                % (snap_stats["dropped"], snap_stats["read"], asset_id)
            )
        else:
            logger.debug(
                "Tag snapshot for %s: %d allowlisted tag(s)"
                % (asset_id or "(none)", snap_stats["allowed"])
            )
    except ImportError as e:
        # The adapter itself is not deployed/importable. That is a DEPLOYMENT
        # fault, not a transient tag-read failure: EVERY turn silently loses its
        # live evidence until it is fixed, so it is logged at ERROR, not warn.
        # Deploy gateway_live_snapshot.py + collector.py + allowlist.py together
        # — see docs/integrations/ignition-tag-collector.md.
        logger.error(
            "Canonical live-snapshot adapter not importable (%s) — no live tags "
            "will reach ANY chat turn on this Gateway" % str(e)
        )
        filtered_snapshot = {}
    except Exception as e:
        # Snapshot is best-effort evidence: the turn stays answerable from
        # documentation, without live tags, rather than failing the request.
        # Fail-closed — filtered_snapshot stays empty.
        logger.warn(
            "Live snapshot unavailable for asset %s: %s" % (asset_id, str(e))
        )
        filtered_snapshot = {}

    # --- Build and sign the outgoing request ---
    import urllib2
    import json
    import os.path as osp
    import sys

    # Ensure the signing helper (sibling module) is importable from Jython.
    # Same `__file__` trap as the adapter import above, and this one is WORSE:
    # it sits outside any try, so on an Ignition script resource the NameError is
    # uncaught and the endpoint returns HTTP 500 on EVERY turn — not a degraded
    # answer, no answer. Guarded identically; on a Gateway signing.py is a flat
    # sibling on the script path, so the import below resolves without the dance.
    try:
        _chat_dir = osp.dirname(osp.abspath(__file__))
        if _chat_dir not in sys.path:
            sys.path.insert(0, _chat_dir)
    except NameError:
        pass  # script resource: flat sibling, no path setup required

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
