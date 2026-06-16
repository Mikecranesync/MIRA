# MIRA Ignition Exchange — Gateway Startup Script
#
# Add this script to: Gateway → Config → Gateway Events → Startup
# Or paste into a project Gateway Event Script (Startup) — equivalent for project-scoped tags.
#
# Idempotent: re-running this script does not overwrite existing values.
# It only creates the tags if they don't already exist.

import system

MIRA_FOLDER_PATH = "[default]MIRA"

DEFAULT_TAGS = [
    {
        "name": "endpoint_url",
        "value": "https://app.factorylm.com",
        "documentation": "MIRA chat endpoint URL embedded in the ChatDock view's Web Browser. Override per-gateway as needed."
    },
    {
        "name": "scan_api_url",
        "value": "https://app.factorylm.com/api/scanbe",
        "documentation": "MIRA Scan backend base URL. The ScanWidget POSTs to <scan_api_url>/scan/extract."
    },
    {
        "name": "factorylm_onboard_url",
        "value": "https://factorylm.com/onboard",
        "documentation": "FactoryLM onboarding URL — opened from the upsell banner and the 'Add to FactoryLM' CTA."
    }
]


def _tag_exists(tag_path):
    """Return True if a tag already exists at the given path."""
    try:
        results = system.tag.exists(tag_path)
        if isinstance(results, (list, tuple)):
            return bool(results[0])
        return bool(results)
    except Exception:
        return False


def _ensure_folder(folder_path):
    """Create a Memory tag folder if missing. No-op if it already exists."""
    if _tag_exists(folder_path):
        return

    parent = folder_path.rsplit("/", 1)[0] if "/" in folder_path else folder_path.split("]")[0] + "]"
    folder_name = folder_path.rsplit("/", 1)[-1] if "/" in folder_path else folder_path.split("]")[-1]

    config = [{
        "name": folder_name,
        "tagType": "Folder"
    }]

    try:
        system.tag.configure(parent, config, "a")
    except Exception as e:
        system.util.getLogger("MIRA").warn("Failed to create folder %s: %s" % (folder_path, str(e)))


def _create_string_tag(folder_path, name, value, documentation):
    """Create a Memory tag of type String with the given default value."""
    tag_path = folder_path + "/" + name
    if _tag_exists(tag_path):
        return False

    config = [{
        "name": name,
        "tagType": "AtomicTag",
        "valueSource": "memory",
        "dataType": "String",
        "value": value,
        "documentation": documentation
    }]

    try:
        system.tag.configure(folder_path, config, "a")
        return True
    except Exception as e:
        system.util.getLogger("MIRA").error(
            "Failed to create tag %s: %s" % (tag_path, str(e))
        )
        return False


def main():
    logger = system.util.getLogger("MIRA")
    logger.info("MIRA Ignition Exchange — running startup script")

    _ensure_folder(MIRA_FOLDER_PATH)

    created = 0
    for tag in DEFAULT_TAGS:
        if _create_string_tag(MIRA_FOLDER_PATH, tag["name"], tag["value"], tag["documentation"]):
            logger.info("Created tag %s/%s = %s" % (MIRA_FOLDER_PATH, tag["name"], tag["value"]))
            created += 1
        else:
            logger.debug("Tag %s/%s already exists — skipping" % (MIRA_FOLDER_PATH, tag["name"]))

    logger.info("MIRA tag bootstrap complete — %d new tag(s) created" % created)


main()
