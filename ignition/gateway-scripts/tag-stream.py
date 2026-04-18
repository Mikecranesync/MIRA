# Gateway Timer Script — MIRA Connect Tag Streamer
# Schedule: Fixed Rate, 2000 ms (configurable via STREAM_INTERVAL_MS)
#
# Reads all tags under STREAM_TAG_FOLDER, packages as JSON, and POSTs
# to the MIRA cloud relay. This is what connects the factory floor to
# MIRA's diagnostic AI — live tag values flow into equipment_status,
# which the GSD Engine reads during fault diagnosis.
#
# On relay failure: logs a warning and continues next cycle. No local
# buffering — Ignition's tag history covers any gaps.
#
# Configuration:
#   RELAY_URL      — MIRA relay HTTP ingest endpoint
#   TENANT_ID      — tenant UUID from activation
#   STREAM_TAG_FOLDER — root tag folder to stream (default: [default]Mira_Monitored)
#   STREAM_INTERVAL_MS — poll interval in ms (default: 2000, set in timer schedule)
#
# Loaded from factorylm.properties via getMiraConfig().
#
# Jython 2.7 — runs inside Ignition Gateway JVM.

logger = system.util.getLogger("FactoryLM.Mira.TagStream")


# ---------------------------------------------------------------------------
# Config helper — shared with other MIRA gateway scripts
# ---------------------------------------------------------------------------

def getMiraConfig(key, default_value=""):
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
# Tag reading
# ---------------------------------------------------------------------------

def _browse_leaf_tags(folder):
    """Browse a tag folder and return paths of all non-folder (leaf) tags."""
    leaf_paths = []
    try:
        results = system.tag.browseTags(parentPath=folder)
        for tag in results:
            tag_type = str(tag.type).lower()
            if tag_type in ("folder", "udtinst"):
                sub_leaves = _browse_leaf_tags(str(tag.fullPath))
                leaf_paths.extend(sub_leaves)
            else:
                leaf_paths.append(str(tag.fullPath))
    except Exception as e:
        logger.warn("Browse failed for %s: %s" % (folder, str(e)))
    return leaf_paths


def _read_all_tags(folder):
    """Read all leaf tags under folder. Returns dict of {tag_name: {v, q, t}}."""
    paths = _browse_leaf_tags(folder)
    if not paths:
        return {}

    tag_data = {}
    try:
        qvs = system.tag.readBlocking(paths)
        for i, path in enumerate(paths):
            qv = qvs[i]
            tag_name = path.split("/")[-1] if "/" in path else path
            try:
                val = float(qv.value) if qv.value is not None else 0
            except (TypeError, ValueError):
                val = str(qv.value) if qv.value is not None else ""
            tag_data[tag_name] = {
                "v": val,
                "q": str(qv.quality),
                "t": str(qv.timestamp),
                "path": path,
            }
    except Exception as e:
        logger.warn("Bulk tag read failed: %s" % str(e))

    return tag_data


# ---------------------------------------------------------------------------
# Relay POST
# ---------------------------------------------------------------------------

def _post_to_relay(relay_url, tenant_id, tag_data):
    """POST tag data JSON to the MIRA relay. Returns True on success."""
    import system.net

    equipment_id = getMiraConfig("STREAM_EQUIPMENT_ID", "ignition-gateway")

    payload = {
        "type": "tags",
        "tenant_id": tenant_id,
        "agent_id": "ignition-%s" % system.net.getHostName(),
        "equipment": {
            equipment_id: tag_data
        }
    }

    try:
        client = system.net.httpClient()
        response = client.post(
            relay_url,
            data=system.util.jsonEncode(payload),
            headers={"Content-Type": "application/json"},
            timeout=5000
        )
        if response.statusCode == 200:
            return True
        else:
            logger.warn(
                "Relay returned %d: %s" % (response.statusCode, response.text[:200])
            )
            return False
    except Exception as e:
        logger.warn("Relay POST failed: %s" % str(e))
        return False


# ---------------------------------------------------------------------------
# Main timer entry point
# ---------------------------------------------------------------------------

relay_url = getMiraConfig("RELAY_URL", "")
tenant_id = getMiraConfig("TENANT_ID", "")
tag_folder = getMiraConfig("STREAM_TAG_FOLDER", "[default]Mira_Monitored")

if not relay_url or not tenant_id:
    pass
else:
    tag_data = _read_all_tags(tag_folder)
    if tag_data:
        ok = _post_to_relay(relay_url, tenant_id, tag_data)
        if ok:
            logger.trace("Streamed %d tags to relay" % len(tag_data))
    else:
        logger.trace("No tags found in %s" % tag_folder)
