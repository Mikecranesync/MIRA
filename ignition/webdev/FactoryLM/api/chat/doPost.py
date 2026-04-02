# Web Dev Module Handler: POST /system/webdev/FactoryLM/api/chat
# Reads live tag snapshot for an asset, forwards query + context to RAG sidecar,
# persists result to mira_chat_history, returns answer + sources.
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev

def doPost(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Chat")

    # --- Parse request body ---
    # 'postData' is a dict when Content-Type is application/json
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
            # Browse all tags (OPC + Memory) in the asset folder
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
            # Non-fatal — proceed without snapshot; log for debugging
            logger.warn(
                "Tag read failed for asset %s: %s" % (asset_id, str(e))
            )

    # --- Forward to RAG sidecar ---
    import urllib2
    import json

    rag_payload = json.dumps({
        "query": query,
        "asset_id": asset_id,
        "tag_snapshot": snapshot,
        "context": extra_context
    })

    try:
        req = urllib2.Request(
            "http://localhost:5000/rag",
            rag_payload,
            {"Content-Type": "application/json"}
        )
        response = urllib2.urlopen(req, timeout=30)
        result = json.loads(response.read())
    except urllib2.HTTPError as e:
        body = ""
        try:
            body = e.read()
        except Exception:
            pass
        logger.error(
            "RAG sidecar returned HTTP %d: %s" % (e.code, body[:200])
        )
        return {
            "json": {
                "error": "RAG sidecar returned error",
                "http_status": e.code,
                "detail": body[:200]
            },
            "status": 502
        }
    except urllib2.URLError as e:
        logger.error("RAG sidecar unreachable: %s" % str(e))
        return {
            "json": {
                "error": "RAG sidecar unreachable",
                "detail": str(e)
            },
            "status": 503
        }
    except Exception as e:
        logger.error("Unexpected error calling RAG sidecar: %s" % str(e))
        return {
            "json": {
                "error": "Internal error",
                "detail": str(e)
            },
            "status": 500
        }

    # --- Persist to chat history ---
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
