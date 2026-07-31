# allowlist.py — Pure tag-allowlist logic (no system.* imports).
# Importable in standard Python 3 for unit tests, and from Jython 2.7 in doGet.py.
# Ref: docs/mira-ignition-secure-architecture.md §4.2, §9 D1

import json
import os


class AllowlistError(Exception):
    """Raised when the allowlist cannot be loaded or is malformed."""


# Module-level cache for is_allowed_tag() — populated lazily on first call.
_ALLOWLIST_CACHE = None
_ALLOWLIST_PATH = None

# THE authoritative runtime location of the allowlist, relative to the Ignition
# DATA directory. Deployment writes here; this loader reads here. One value,
# imported by both, so they cannot drift.
#
# Deliberately PROJECT-INDEPENDENT. The old list also searched
# `data/projects/factorylm/…`, which encodes a project named `factorylm` that
# does not exist anywhere: `deploy_ignition.ps1` installs the project as
# **ConveyorMIRA**, and the collector project on the bench gateway is
# **FactoryLMCollector**. A scripted deploy therefore wrote tags where the
# loader never looked, so every tag was dropped — correctly fail-closed, but for
# the wrong reason and with no way to tell the two apart. Keying off the data
# dir instead of a project name removes that class of mismatch entirely.
#
# `ignition/tools/webdev_build.py` imports RUNTIME_ALLOWLIST_RELPATH rather than
# repeating the string, and a test asserts the deploy target and this loader
# agree.
RUNTIME_ALLOWLIST_RELPATH = "factorylm/approved_tags.json"

# Well-known Ignition data directories, in priority order.
IGNITION_DATA_DIRS = [
    "C:/Program Files/Inductive Automation/Ignition/data",
    "/usr/local/bin/ignition/data",
    "/var/lib/ignition/data",
]

_DEFAULT_PATHS = [
    "%s/%s" % (d, RUNTIME_ALLOWLIST_RELPATH) for d in IGNITION_DATA_DIRS
]

# In-repo fallback for dev/test. Ignition's Jython script library does not
# define __file__ (module resources are exec'd, not loaded from a file), so
# guard it — on a gateway the absolute install paths above are the real ones.
try:
    _DEFAULT_PATHS.append(
        os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "..", "..", "..", "project", "approved_tags.json",
        )
    )
except NameError:
    pass  # __file__ undefined (Ignition script resource)


def resolve_allowlist_path():
    """
    Return the first allowlist path that exists, or None if none found.

    Order: MIRA_ALLOWLIST_PATH env > _DEFAULT_PATHS (Ignition install > repo dev).

    An EXPLICITLY CONFIGURED override that does not resolve raises
    AllowlistError — it does NOT fall through to the defaults. Falling through
    is the dangerous behaviour: an operator who points MIRA at a curated
    allowlist and typos the path would silently get a *different* allowlist (the
    install default, or the in-repo dev copy) and never learn that the file they
    authored was ignored. Tags would flow, just governed by the wrong list.
    Refusing is the only safe reading of "I told you which file to use."

    Callers map AllowlistError to an empty allowlist (fail-closed, no snapshot).
    """
    override = os.environ.get("MIRA_ALLOWLIST_PATH", "")
    if override:
        if os.path.isfile(override):
            return override
        raise AllowlistError(
            "MIRA_ALLOWLIST_PATH is set to %r but that file does not exist or is "
            "not readable. Refusing to fall back to a default allowlist — fix the "
            "path or unset the variable." % override
        )
    for candidate in _DEFAULT_PATHS:
        if os.path.isfile(candidate):
            return candidate
    return None


def load_allowlist(path):
    """
    Load the approved_tags.json allowlist from the given filesystem path.

    Returns a set of approved tag path strings.
    Raises AllowlistError if the file is missing, unreadable, or malformed.
    The caller maps AllowlistError -> HTTP 503 (fail-closed, not fail-open).
    """
    try:
        with open(path, "r") as fh:
            data = json.load(fh)
    except IOError as e:
        raise AllowlistError("Cannot read allowlist file %s: %s" % (path, str(e)))
    except ValueError as e:
        raise AllowlistError("Allowlist file is not valid JSON %s: %s" % (path, str(e)))

    if not isinstance(data, dict):
        raise AllowlistError("Allowlist root is not a JSON object: %s" % path)

    tags = data.get("tags")
    if tags is None:
        raise AllowlistError("Allowlist missing 'tags' key: %s" % path)
    if not isinstance(tags, list):
        raise AllowlistError("Allowlist 'tags' is not a list: %s" % path)

    return set(tags)


def tag_in_allowlist(tag_path, allowlist):
    """
    Return True if tag_path is in the allowlist set.

    Args:
        tag_path (str): The full Ignition tag path, e.g. "[default]Conveyor/Motor_Running"
        allowlist (set): Set of approved tag path strings (from load_allowlist).

    Returns:
        bool
    """
    if not isinstance(allowlist, set):
        raise AllowlistError("allowlist must be a set, got %s" % type(allowlist).__name__)
    return tag_path in allowlist


def filter_tags_by_allowlist(tags, allowlist):
    """
    Filter a list of tag dicts to only those whose 'path' is in the allowlist.
    Folders (is_folder=True) are always passed through — they are structural, not
    data-bearing. The subsequent leaf-level check handles any sub-tree filtering.

    Args:
        tags (list): List of tag dicts with at least a 'path' key.
        allowlist (set): Set of approved tag path strings.

    Returns:
        list: Filtered list of tag dicts.
    """
    result = []
    for tag in tags:
        if tag.get("is_folder", False):
            result.append(tag)
        elif tag.get("path", "") in allowlist:
            result.append(tag)
    return result


def _get_cached_allowlist():
    """Return the cached allowlist set; load on first access. Fail-closed on miss."""
    global _ALLOWLIST_CACHE, _ALLOWLIST_PATH
    if _ALLOWLIST_CACHE is not None:
        return _ALLOWLIST_CACHE
    try:
        path = resolve_allowlist_path()
    except AllowlistError:
        # A configured-but-unresolvable MIRA_ALLOWLIST_PATH. Fail-closed here
        # too: rejecting every tag is the same answer as "no allowlist", and it
        # is emphatically NOT "use some other allowlist instead".
        _ALLOWLIST_CACHE = set()
        _ALLOWLIST_PATH = None
        return _ALLOWLIST_CACHE
    if path is None:
        # Fail-closed: empty allowlist rejects every tag.
        _ALLOWLIST_CACHE = set()
        _ALLOWLIST_PATH = None
        return _ALLOWLIST_CACHE
    _ALLOWLIST_CACHE = load_allowlist(path)
    _ALLOWLIST_PATH = path
    return _ALLOWLIST_CACHE


def is_allowed_tag(tag_path):
    """
    Convenience: check a single tag path against the cached allowlist.

    Loads the allowlist on first call (cached for the process lifetime).
    Returns False if no allowlist file is available — fail-closed.
    """
    return tag_path in _get_cached_allowlist()


def reload_allowlist():
    """Invalidate the cache; the next is_allowed_tag() reloads from disk."""
    global _ALLOWLIST_CACHE, _ALLOWLIST_PATH
    _ALLOWLIST_CACHE = None
    _ALLOWLIST_PATH = None
