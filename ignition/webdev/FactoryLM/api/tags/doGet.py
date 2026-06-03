# Web Dev Module Handler: GET /system/webdev/FactoryLM/api/tags
# Enumerates tags under a given folder path using system.tag.browseTags.
# Query params:
#   folder  — tag folder path (default: "[default]Mira_Monitored")
#   recurse — "true" to recurse one level into sub-folders (default: false)
#   values  — "true" to read live tag values (default: false)
# Returns JSON array with name, type, path, value, quality for each tag.
# Only tags in approved_tags.json are visible (fail-closed: 503 if allowlist missing).
# Jython 2.7 — runs inside Ignition Gateway JVM.
# Ref: https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev

import json
import os

DEFAULT_FOLDER = "[default]Mira_Monitored"

# Maximum tags to return in one response (avoid memory pressure)
MAX_TAGS = 500

# Path to the allowlist file, relative to the Ignition data/projects directory.
# Resolved at request time so restarts pick up edits without a gateway restart.
_ALLOWLIST_FILENAME = "approved_tags.json"


def _load_allowlist():
    """
    Locate and load approved_tags.json from the project directory.

    Resolution strategy (Jython 2.7, Ignition Gateway JVM):
      1. Try the project resource path next to this script (works in dev on disk).
      2. Try system.util.getProjectName() to build the Ignition project data path.
      3. Try a hardcoded fallback for the standard Linux Ignition install path.

    Returns a set of approved tag path strings on success.
    Raises IOError / ValueError with a descriptive message on failure so the
    caller can return HTTP 503 (fail-closed, never fail-open).
    """
    candidates = []

    # 1. Same directory as this script (works on-disk dev layout).
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidates.append(os.path.join(script_dir, _ALLOWLIST_FILENAME))
    except Exception:
        pass

    # 2. Ignition project data directory (standard runtime path).
    try:
        project_name = system.util.getProjectName()
        # Standard Ignition install: /usr/local/bin/ignition/data/projects/<project>/
        ignition_projects = "/usr/local/bin/ignition/data/projects"
        candidates.append(
            os.path.join(ignition_projects, project_name, _ALLOWLIST_FILENAME)
        )
        # Windows Ignition install fallback
        candidates.append(
            os.path.join(
                "C:\\Program Files\\Inductive Automation\\Ignition\\data\\projects",
                project_name,
                _ALLOWLIST_FILENAME,
            )
        )
    except Exception:
        pass

    # 3. Sibling to the project.json in ignition/project/ (repo layout).
    try:
        # Walk up from this file's directory to find ignition/project/
        script_dir = os.path.dirname(os.path.abspath(__file__))
        repo_root = script_dir
        for _ in range(6):
            candidate = os.path.join(repo_root, "ignition", "project", _ALLOWLIST_FILENAME)
            if os.path.isfile(candidate):
                candidates.insert(0, candidate)
                break
            repo_root = os.path.dirname(repo_root)
    except Exception:
        pass

    last_error = "No candidate paths resolved"
    for path in candidates:
        try:
            with open(path, "r") as fh:
                data = json.load(fh)
            tags = data.get("tags", None)
            if not isinstance(tags, list):
                raise ValueError("'tags' key missing or not a list in %s" % path)
            return set(tags)
        except IOError as e:
            last_error = "IOError reading %s: %s" % (path, str(e))
        except ValueError as e:
            last_error = "ValueError parsing %s: %s" % (path, str(e))

    raise IOError("approved_tags.json not found or unreadable. %s" % last_error)


def doGet(request, session):
    logger = system.util.getLogger("FactoryLM.Mira.Tags")

    # --- Load allowlist (fail-closed: 503 if unavailable) ---
    try:
        allowlist = _load_allowlist()
    except Exception as e:
        logger.error("Allowlist unavailable — denying all tag access: %s" % str(e))
        return {
            "json": {
                "error": "allowlist unavailable",
                "detail": str(e)
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

    if not folder:
        folder = DEFAULT_FOLDER

    logger.debug(
        "Tags request — folder: %s, recurse: %s, read_values: %s, allowlist_size: %d"
        % (folder, recurse, read_values, len(allowlist))
    )

    # --- Browse tags ---
    tags = []
    folders_found = []

    try:
        results = system.tag.browseTags(parentPath=folder)

        for tag in results:
            tag_path = str(tag.fullPath)
            is_folder = str(tag.type).lower() in ("folder", "udtinst")

            # Allowlist enforcement: folders pass through (structural);
            # leaf tags must be in the allowlist.
            if not is_folder and tag_path not in allowlist:
                logger.debug("Tag blocked by allowlist: %s" % tag_path)
                continue

            tag_info = {
                "name": str(tag.name),
                "path": tag_path,
                "type": str(tag.type),
                "data_type": str(tag.dataType) if hasattr(tag, "dataType") else "unknown"
            }

            if is_folder:
                folders_found.append(tag_path)
                tag_info["is_folder"] = True
            else:
                tag_info["is_folder"] = False

            tags.append(tag_info)

        logger.debug(
            "Browsed %d allowlisted tags in %s (%d sub-folders)"
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
                    tag_path = str(tag.fullPath)
                    is_folder = str(tag.type).lower() in ("folder", "udtinst")

                    # Allowlist enforcement in sub-folders
                    if not is_folder and tag_path not in allowlist:
                        logger.debug(
                            "Sub-folder tag blocked by allowlist: %s" % tag_path
                        )
                        continue

                    tags.append({
                        "name": str(tag.name),
                        "path": tag_path,
                        "type": str(tag.type),
                        "data_type": str(tag.dataType) if hasattr(tag, "dataType") else "unknown",
                        "is_folder": is_folder
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
        "Tags response — folder: %s, tag_count: %d, allowlist_enforced: true"
        % (folder, len(tags))
    )

    return {
        "json": {
            "folder": folder,
            "tags": tags,
            "count": len(tags),
            "truncated": len(tags) >= MAX_TAGS,
            "allowlist_enforced": True,
            "allowlist_size": len(allowlist)
        }
    }
