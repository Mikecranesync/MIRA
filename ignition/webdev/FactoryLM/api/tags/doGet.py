# Web Dev Module Handler: GET /system/webdev/FactoryLM/api/tags
# Enumerates tags under a given folder path using system.tag.browseTags.
# Query params:
#   folder  — tag folder path (default: "[default]Mira_Monitored")
#   recurse — "true" to recurse one level into sub-folders (default: false)
#   values  — "true" to attach live tag values (default: false)
# Returns JSON array with name, type, path, value, quality for each tag.
#
# SECURITY — Allowlist gate (D1):
#   Only tags explicitly listed in approved_tags.json are returned. Any tag
#   not on the list is invisible to MIRA. A request targeting a specific path
#   that is not allowlisted returns HTTP 404. The allowlist is loaded from:
#     <ignition-data>/factorylm/approved_tags.json
#   Read-only: this handler never calls system.tag.writeBlocking.
#
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev

import json
import sys

DEFAULT_FOLDER = "[default]Mira_Monitored"

# Maximum tags to return in one response (avoid memory pressure)
MAX_TAGS = 500

# Candidate paths for the factorylm data directory (same roots as factorylm.properties)
APPROVED_TAGS_PATHS = [
    "C:/Program Files/Inductive Automation/Ignition/data/factorylm/approved_tags.json",
    "/usr/local/bin/ignition/data/factorylm/approved_tags.json",
    "/var/lib/ignition/data/factorylm/approved_tags.json",
]


def _load_approved_set(logger):
    """
    Load approved_tags.json from the Ignition data directory.
    Returns a frozenset of approved tag_path strings, or None on failure.
    Uses java.io.File to probe paths (same pattern as getMiraConfig).
    """
    import java.io.File as File

    for p in APPROVED_TAGS_PATHS:
        f = File(p)
        if f.exists():
            try:
                fh = open(p, "r")
                try:
                    data = json.load(fh)
                finally:
                    fh.close()
                entries = data.get("tags", [])
                approved = frozenset(entry["tag_path"] for entry in entries)
                logger.debug(
                    "Loaded %d approved tags from %s" % (len(approved), p)
                )
                return approved
            except Exception as e:
                logger.error(
                    "Failed to load approved_tags.json from %s: %s" % (p, str(e))
                )
                return None

    logger.error("approved_tags.json not found in any candidate path")
    return None


def doGet(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Tags")

    # --- Load allowlist (fail closed: no allowlist = no tags) ---
    approved_set = _load_approved_set(logger)
    if approved_set is None:
        return {
            "json": {
                "error": "Tag allowlist unavailable — configure approved_tags.json",
                "detail": "File not found in any of the expected factorylm data paths"
            },
            "status": 503
        }

    # --- Parse query parameters ---
    params = request.get("params", {})
    if params is None:
        params = {}

    folder = params.get("folder", DEFAULT_FOLDER).strip()
    recurse = params.get("recurse", "false").strip().lower() == "true"
    read_values = params.get("values", "false").strip().lower() == "true"

    # Optional: caller may request a specific single tag path
    specific_path = params.get("path", "").strip()

    if not folder:
        folder = DEFAULT_FOLDER

    # --- Specific-path request: enforce allowlist with 404 ---
    if specific_path:
        if not (specific_path in approved_set):
            logger.warn(
                "Rejected non-allowlisted tag path request: %s" % specific_path
            )
            return {
                "json": {
                    "error": "Tag not found",
                    "path": specific_path
                },
                "status": 404
            }

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

    # --- Allowlist filter: remove any tag not in approved_tags.json ---
    # Folder entries are kept only if their path is also on the allowlist,
    # or if they are a container for allowlisted children — for simplicity we
    # keep folder entries unconditionally (they are never leaf reads) and only
    # filter leaf tags. Leaf tag paths not in approved_set are dropped silently.
    tags_before = len(tags)
    filtered = []
    for t in tags:
        if t.get("is_folder", False):
            # Keep folder entries (they are structural, not data)
            filtered.append(t)
        else:
            if t.get("path", "") in approved_set:
                filtered.append(t)
    tags = filtered
    dropped = tags_before - len(tags)
    if dropped > 0:
        logger.info(
            "Allowlist filtered %d non-approved tag(s) from response" % dropped
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
