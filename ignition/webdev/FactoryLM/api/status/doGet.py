# Web Dev Module Handler: GET /system/webdev/FactoryLM/api/status
# Returns system health: gateway liveness, RAG sidecar status, monitored assets.
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev

def doGet(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Status")

    # --- RAG sidecar health check ---
    sidecar_status = "error"
    doc_count = 0
    sidecar_version = "unknown"
    sidecar_error = ""

    try:
        import urllib2
        import json

        resp = urllib2.urlopen("http://localhost:5000/status", timeout=5)
        raw = resp.read()
        data = json.loads(raw)
        sidecar_status = data.get("status", "unknown")
        doc_count = data.get("doc_count", 0)
        sidecar_version = data.get("version", "unknown")
        logger.debug("Sidecar status: %s, docs: %d" % (sidecar_status, doc_count))
    except urllib2.URLError as e:
        sidecar_error = "Connection refused or timeout: %s" % str(e)
        logger.warn("RAG sidecar unreachable: %s" % sidecar_error)
    except Exception as e:
        sidecar_error = str(e)
        logger.warn("RAG sidecar check failed: %s" % sidecar_error)

    # --- Enumerate monitored assets ---
    assets = []
    asset_tag_counts = {}

    try:
        folders = system.tag.browseTags(
            parentPath="[default]Mira_Monitored",
            tagType="Folder"
        )
        for folder in folders:
            asset_name = str(folder.name)
            assets.append(asset_name)

            # Count tags inside each asset folder
            try:
                child_tags = system.tag.browseTags(
                    parentPath="[default]Mira_Monitored/%s" % asset_name
                )
                asset_tag_counts[asset_name] = len(list(child_tags))
            except Exception as inner:
                logger.debug("Could not count tags for %s: %s" % (asset_name, str(inner)))
                asset_tag_counts[asset_name] = -1

    except Exception as e:
        logger.warn("Tag browse failed for Mira_Monitored: %s" % str(e))

    # --- Build response payload ---
    payload = {
        "gateway": "ok",
        "rag_sidecar": sidecar_status,
        "doc_count": doc_count,
        "sidecar_version": sidecar_version,
        "monitored_assets": assets,
        "asset_tag_counts": asset_tag_counts,
        "asset_count": len(assets)
    }

    if sidecar_error:
        payload["sidecar_error"] = sidecar_error

    logger.info(
        "Status check — gateway: ok, sidecar: %s, assets: %d, docs: %d"
        % (sidecar_status, len(assets), doc_count)
    )

    return {"json": payload}
