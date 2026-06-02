# MIRA Tag Allowlist — pure filter functions.
#
# This module contains NO Ignition system.* calls — it is importable by
# both the Jython 2.7 Gateway runtime (via doGet.py) and standard CPython
# unit tests (ignition/tests/test_allowlist.py) without a running gateway.
#
# Match semantics: EXACT tag_path match only. Prefix/subtree matching is
# intentionally not supported — "read-by-default, allowlist-only" means
# a tag must be explicitly named or it is invisible to MIRA.
#
# Jython 2.7 / CPython 3.x compatible: % formatting, no type hints, no f-strings.

import json


def load_approved_set(approved_tags_json_path):
    """
    Load approved_tags.json and return a frozenset of approved tag_path strings.

    Parameters
    ----------
    approved_tags_json_path : str
        Absolute filesystem path to the approved_tags.json file.

    Returns
    -------
    frozenset of str
        The set of approved tag_path values (exact strings, case-sensitive).

    Raises
    ------
    IOError / ValueError
        If the file cannot be read or parsed.
    """
    with open(approved_tags_json_path, "r") as fh:
        data = json.load(fh)
    entries = data.get("tags", [])
    return frozenset(entry["tag_path"] for entry in entries)


def is_allowlisted(tag_path, approved_set):
    """
    Return True if tag_path is in the approved set (exact match).

    Parameters
    ----------
    tag_path : str
        The full Ignition tag path, e.g. "[default]Mira_Monitored/Conveyor/MotorRunning".
    approved_set : frozenset or set of str
        The pre-loaded set returned by load_approved_set().

    Returns
    -------
    bool
    """
    return tag_path in approved_set


def filter_to_allowlist(tag_list, approved_set):
    """
    Filter a list of tag-info dicts to only those whose "path" key is allowlisted.

    Each dict must have a "path" key containing the full Ignition tag path. Folder
    entries (is_folder=True) whose path is not itself in the allowlist are removed
    unless at least one of their children would survive (caller's responsibility to
    flatten first; doGet browses one level at a time, so folder paths never appear
    as tag leaves in the list passed here).

    Parameters
    ----------
    tag_list : list of dict
        Each dict has at minimum a "path" key (str).
    approved_set : frozenset or set of str
        The pre-loaded set returned by load_approved_set().

    Returns
    -------
    list of dict
        Only dicts whose "path" is in approved_set.
    """
    return [t for t in tag_list if is_allowlisted(t.get("path", ""), approved_set)]
