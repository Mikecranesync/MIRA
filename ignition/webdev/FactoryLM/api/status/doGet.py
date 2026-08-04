# Web Dev Module Handler: GET /system/webdev/FactoryLM/api/status
# Returns system health: gateway liveness, RAG sidecar status, monitored assets.
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev

_DEFAULT_TAG_FOLDER = "[default]Mira_Monitored"


def _is_not_found(err_msg):
    """True when a tag-browse error means the folder simply does not exist.

    Ignition raises `Bad_NotFound` when browseTags is pointed at an absent
    folder (e.g. this gateway streams `[default]MIRA_IOCheck`, not the
    hardcoded `Mira_Monitored`). That is a diagnosable configuration state,
    not a server error — callers use this to avoid reporting a 500.
    """
    m = str(err_msg).lower()
    return "not_found" in m or "notfound" in m


def _read_stream_tag_folder():
    """Resolve the monitored tag folder from factorylm.properties.

    Mirrors api/connect/doGet.py so all handlers agree on the folder name.
    Falls back to the historical default when the properties file is absent.
    """
    try:
        import java.io.FileInputStream as FileInputStream
        import java.util.Properties as Properties
        import java.io.File as File
    except Exception:
        return _DEFAULT_TAG_FOLDER

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
                return props.getProperty("STREAM_TAG_FOLDER", _DEFAULT_TAG_FOLDER)
            finally:
                fis.close()
    return _DEFAULT_TAG_FOLDER


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
    tag_folder = _read_stream_tag_folder()
    tag_folder_error = ""

    try:
        folders = system.tag.browseTags(
            parentPath=tag_folder,
            tagType="Folder"
        )
        for folder in folders:
            asset_name = str(folder.name)
            assets.append(asset_name)

            # Count tags inside each asset folder
            try:
                child_tags = system.tag.browseTags(
                    parentPath="%s/%s" % (tag_folder, asset_name)
                )
                asset_tag_counts[asset_name] = len(list(child_tags))
            except Exception as inner:
                logger.debug("Could not count tags for %s: %s" % (asset_name, str(inner)))
                asset_tag_counts[asset_name] = -1

    except Exception as e:
        # An absent folder (Bad_NotFound) is a diagnosable config state, not a
        # gateway failure — record it in the payload instead of silently
        # returning an empty asset list. The gateway itself is still "ok".
        tag_folder_error = str(e)
        if _is_not_found(tag_folder_error):
            logger.warn(
                "Monitored tag folder %s not found — reporting empty asset list."
                % tag_folder
            )
        else:
            logger.warn("Tag browse failed for %s: %s" % (tag_folder, tag_folder_error))

    # --- Build response payload ---
    payload = {
        "gateway": "ok",
        "rag_sidecar": sidecar_status,
        "doc_count": doc_count,
        "sidecar_version": sidecar_version,
        "monitored_assets": assets,
        "asset_tag_counts": asset_tag_counts,
        "asset_count": len(assets),
        "tag_folder": tag_folder
    }

    if sidecar_error:
        payload["sidecar_error"] = sidecar_error

    if tag_folder_error:
        payload["tag_folder_error"] = tag_folder_error
        payload["tag_folder_not_found"] = _is_not_found(tag_folder_error)

    logger.info(
        "Status check — gateway: ok, sidecar: %s, assets: %d, docs: %d"
        % (sidecar_status, len(assets), doc_count)
    )

    return {"json": payload}
