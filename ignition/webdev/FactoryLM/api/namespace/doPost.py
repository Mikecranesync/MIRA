# Web Dev Module Handler: POST /system/webdev/FactoryLM/api/namespace
# Saves accepted namespace mapping decisions to persistent gateway tags.
# The NamespaceMapper Perspective view calls this after human review.
#
# Request body (JSON):
#   {
#     "folder":    "<tag folder that was mapped>",
#     "decisions": {"<tag_path>": "accepted"|"rejected"|"pending", ...},
#     "uns_map":   [<proposal objects for accepted tags>],
#     "i3x_map":   {<i3X skeleton: namespace, objectTypes, objectInstances>}
#   }
#
# Persistence targets (gateway Memory Tags):
#   [default]MIRA/namespace_map     -- JSON: aggregate UNS entries across all sessions
#   [default]MIRA/namespace_map_i3x -- JSON: aggregate i3X object instances
#
# Merge policy: new decisions for a tag_path overwrite any prior decision for
# that exact path. Tags not in this POST are left unchanged (additive, not replace).
#
# Returns: {saved, accepted_count, total_count, uns_map_size, i3x_map_size}
#
# Dual Python 2.7 + 3.12-clean. Jython 2.7 -- Ignition Gateway JVM.

import json


def _load_tag_json(tag_path, logger):
    """Read a gateway tag and parse its value as JSON. Returns {} on failure."""
    try:
        raw = str(system.tag.readBlocking([tag_path])[0].value).strip()
        if raw and raw not in ("null", "None", ""):
            return json.loads(raw)
    except Exception as exc:
        logger.warn("Could not read/parse %s: %s" % (tag_path, str(exc)))
    return {}


def doPost(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Namespace.Save")

    # ── Parse body ──────────────────────────────────────────────────────────
    try:
        body = request.get("data", None)
        if body is None:
            return {"json": {"error": "Empty request body"}, "status": 400}
        if isinstance(body, (str, bytes)):
            payload = json.loads(body)
        else:
            # Jython may deliver it as a Java map already
            try:
                payload = json.loads(str(body))
            except Exception:
                payload = dict(body)
    except Exception as exc:
        return {"json": {"error": "Invalid JSON: %s" % str(exc)}, "status": 400}

    folder        = str(payload.get("folder", "")).strip()
    decisions     = payload.get("decisions", {})
    uns_proposals = payload.get("uns_map",   [])
    i3x_data      = payload.get("i3x_map",   {})

    if not isinstance(decisions, dict):
        return {"json": {"error": "'decisions' must be an object"}, "status": 400}

    accepted_count = sum(1 for v in decisions.values() if v == "accepted")
    total_count    = len(decisions)

    logger.info("Namespace save -- folder: %s, accepted: %d/%d"
                % (folder, accepted_count, total_count))

    # ── Load existing maps ───────────────────────────────────────────────────
    existing_uns  = {}   # tag_path -> entry dict
    existing_i3x  = {}   # elementId -> instance dict

    uns_store = _load_tag_json("[default]MIRA/namespace_map", logger)
    for item in uns_store.get("entries", []):
        tp = str(item.get("tag_path", ""))
        if tp:
            existing_uns[tp] = item

    i3x_store = _load_tag_json("[default]MIRA/namespace_map_i3x", logger)
    for inst in i3x_store.get("objectInstances", []):
        eid = str(inst.get("elementId", ""))
        if eid:
            existing_i3x[eid] = inst

    # ── Merge new decisions ──────────────────────────────────────────────────
    for prop in uns_proposals:
        tag_path = str(prop.get("tag_path", ""))
        if not tag_path:
            continue
        decision = str(decisions.get(tag_path, "pending"))
        if decision == "accepted":
            existing_uns[tag_path] = {
                "tag_path":  tag_path,
                "tag_name":  str(prop.get("tag_name",  "")),
                "data_type": str(prop.get("data_type", "")),
                "roles":     list(prop.get("roles", [])),
                "uns_path":  str(prop.get("uns_path",  "")),
                "status":    "accepted",
                "folder":    folder,
            }
        elif decision == "rejected":
            existing_uns[tag_path] = {
                "tag_path": tag_path,
                "uns_path": str(prop.get("uns_path", "")),
                "status":   "rejected",
                "folder":   folder,
            }

    # Merge i3X instances — containers always, signal leaves only if accepted
    for inst in i3x_data.get("objectInstances", []):
        eid = str(inst.get("elementId", ""))
        if not eid:
            continue
        is_container = bool(inst.get("isComposition", False))
        if is_container:
            existing_i3x[eid] = dict(inst)
        else:
            tag_path = str(inst.get("metadata", {}).get("tagPath", ""))
            if str(decisions.get(tag_path, "pending")) == "accepted":
                existing_i3x[eid] = dict(inst)

    # ── Build merged output payloads ─────────────────────────────────────────
    uns_output = {
        "version":   "1.0",
        "generator": "MIRA NamespaceMapper",
        "entries":   list(existing_uns.values()),
    }

    i3x_output = {
        "namespace": i3x_data.get("namespace", {
            "namespaceUri": "urn:mira:ignition:uns",
            "displayName":  "MIRA Ignition Namespace",
            "version":      "1.0",
        }),
        "objectTypes":     list(i3x_data.get("objectTypes", [])),
        "objectInstances": list(existing_i3x.values()),
    }

    uns_json = json.dumps(uns_output)
    i3x_json = json.dumps(i3x_output)

    # ── Write to gateway tags ────────────────────────────────────────────────
    try:
        system.tag.writeBlocking(
            ["[default]MIRA/namespace_map", "[default]MIRA/namespace_map_i3x"],
            [uns_json, i3x_json],
        )
    except Exception as exc:
        logger.error("Tag write failed: %s" % str(exc))
        return {
            "json": {"error": "Gateway tag write failed: %s" % str(exc), "saved": False},
            "status": 500,
        }

    logger.info("Namespace map saved -- uns_entries: %d, i3x_instances: %d"
                % (len(uns_output["entries"]), len(i3x_output["objectInstances"])))

    return {
        "json": {
            "saved":          True,
            "accepted_count": accepted_count,
            "total_count":    total_count,
            "uns_map_size":   len(uns_output["entries"]),
            "i3x_map_size":   len(i3x_output["objectInstances"]),
        }
    }
