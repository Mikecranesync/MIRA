# Web Dev Module Handler: GET /system/webdev/FactoryLM/api/tags
# Enumerates tags under a given folder path using system.tag.browseTags.
# Query params:
#   folder  — tag folder path (default: "[default]Mira_Monitored")
#   recurse — "true" to recurse one level into sub-folders (default: false)
# Returns JSON array with name, type, path, value, quality for each tag.
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev

DEFAULT_FOLDER = "[default]Mira_Monitored"

# Maximum tags to return in one response (avoid memory pressure)
MAX_TAGS = 500


def doGet(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Tags")

    # --- Parse query parameters ---
    params = request.get("params", {})
    if params is None:
        params = {}

    folder = params.get("folder", DEFAULT_FOLDER).strip()
    recurse = params.get("recurse", "false").strip().lower() == "true"
    read_values = params.get("values", "false").strip().lower() == "true"

    if not folder:
        folder = DEFAULT_FOLDER

    logger.debug(
        "Tags request — folder: %s, recurse: %s, read_values: %s"
        % (folder, recurse, read_values)
    )

    # --- Browse tags ---
    tags = []
    folders_found = []

    try:
        results = system.tag.browseTags(parentPath=folder)

        for tag in results:
            tag_info = {
                "name": str(tag.name),
                "path": str(tag.fullPath),
                "type": str(tag.type),
                "data_type": str(tag.dataType) if hasattr(tag, "dataType") else "unknown"
            }

            # Collect sub-folder names for optional recursion
            if str(tag.type).lower() in ("folder", "udtinst"):
                folders_found.append(str(tag.fullPath))
                tag_info["is_folder"] = True
            else:
                tag_info["is_folder"] = False

            tags.append(tag_info)

        logger.debug(
            "Browsed %d tags in %s (%d sub-folders)"
            % (len(tags), folder, len(folders_found))
        )

    except Exception as e:
        logger.error(
            "Tag browse failed for folder %s: %s" % (folder, str(e))
        )
        return {
            "json": {
                "error": "Tag browse failed",
                "folder": folder,
                "detail": str(e)
            },
            "status": 500
        }

    # --- Optionally recurse one level into sub-folders ---
    if recurse and folders_found:
        for sub_folder in folders_found:
            if len(tags) >= MAX_TAGS:
                logger.warn(
                    "Tag response capped at %d — stopping recursion" % MAX_TAGS
                )
                break
            try:
                sub_results = system.tag.browseTags(parentPath=sub_folder)
                for tag in sub_results:
                    if len(tags) >= MAX_TAGS:
                        break
                    tags.append({
                        "name": str(tag.name),
                        "path": str(tag.fullPath),
                        "type": str(tag.type),
                        "data_type": str(tag.dataType) if hasattr(tag, "dataType") else "unknown",
                        "is_folder": str(tag.type).lower() in ("folder", "udtinst")
                    })
            except Exception as e:
                logger.warn(
                    "Tag browse failed for sub-folder %s: %s" % (sub_folder, str(e))
                )

    # --- Optionally read live values ---
    # Only read non-folder tags; batch the read for efficiency
    if read_values:
        readable_paths = [
            t["path"] for t in tags
            if not t.get("is_folder", False)
        ]

        if readable_paths:
            try:
                qvs = system.tag.readBlocking(readable_paths)
                # Build a lookup by path
                value_map = {}
                for i, path in enumerate(readable_paths):
                    qv = qvs[i]
                    value_map[path] = {
                        "value": str(qv.value),
                        "quality": str(qv.quality),
                        "timestamp": str(qv.timestamp)
                    }

                # Attach to tag dicts
                for tag_info in tags:
                    if tag_info["path"] in value_map:
                        tag_info.update(value_map[tag_info["path"]])

            except Exception as e:
                logger.warn("Bulk tag read failed: %s" % str(e))
                # Non-fatal — return tags without values

    logger.info(
        "Tags response — folder: %s, tag_count: %d" % (folder, len(tags))
    )

    return {
        "json": {
            "folder": folder,
            "tags": tags,
            "count": len(tags),
            "truncated": len(tags) >= MAX_TAGS
        }
    }
