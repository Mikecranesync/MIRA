# tests/ignition/test_allowlist.py
# Pytest suite for the MIRA Ignition tag allowlist logic.
# Tests the pure allowlist helpers in isolation from all Ignition I/O (no system.* calls).
# Run: cd /Users/charlienode/MIRA && python3 -m pytest tests/ignition/test_allowlist.py -v

import json
import os
import sys

import pytest

# Make allowlist.py importable from standard Python 3 pytest without Ignition's JVM.
_ALLOWLIST_MODULE_DIR = os.path.join(
    os.path.dirname(__file__),
    "..", "..",
    "ignition", "webdev", "FactoryLM", "api", "tags",
)
sys.path.insert(0, os.path.abspath(_ALLOWLIST_MODULE_DIR))

from allowlist import (  # noqa: E402
    AllowlistError,
    filter_tags_by_allowlist,
    load_allowlist,
    resolve_allowlist_path,
    tag_in_allowlist,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_SAMPLE_TAGS = [
    "[default]Conveyor/Motor_Running",
    "[default]Conveyor/Conv_State",
    "[default]Mira_Monitored/conveyor_demo/State",
]


@pytest.fixture()
def allowlist_file(tmp_path):
    """Write a minimal approved_tags.json to a temp directory and return its path."""
    data = {"version": 1, "description": "test", "tags": list(_SAMPLE_TAGS)}
    p = tmp_path / "approved_tags.json"
    p.write_text(json.dumps(data))
    return str(p)


@pytest.fixture()
def loaded_allowlist(allowlist_file):
    """Return the set produced by load_allowlist() from the temp file."""
    return load_allowlist(allowlist_file)


# ---------------------------------------------------------------------------
# load_allowlist — file I/O and parsing
# ---------------------------------------------------------------------------


class TestLoadAllowlist:
    def test_loads_all_tags(self, allowlist_file):
        result = load_allowlist(allowlist_file)
        assert result == set(_SAMPLE_TAGS)

    def test_returns_set(self, allowlist_file):
        result = load_allowlist(allowlist_file)
        assert isinstance(result, set)

    def test_missing_file_raises_allowlist_error(self):
        with pytest.raises(AllowlistError, match="Cannot read"):
            load_allowlist("/nonexistent/path/approved_tags.json")

    def test_malformed_json_raises_allowlist_error(self, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text("{not valid json")
        with pytest.raises(AllowlistError, match="not valid JSON"):
            load_allowlist(str(bad))

    def test_missing_tags_key_raises_allowlist_error(self, tmp_path):
        bad = tmp_path / "notags.json"
        bad.write_text(json.dumps({"version": 1}))
        with pytest.raises(AllowlistError, match="missing 'tags' key"):
            load_allowlist(str(bad))

    def test_tags_not_a_list_raises_allowlist_error(self, tmp_path):
        bad = tmp_path / "wrongtype.json"
        bad.write_text(json.dumps({"tags": {"a": 1}}))
        with pytest.raises(AllowlistError, match="not a list"):
            load_allowlist(str(bad))

    def test_root_not_object_raises_allowlist_error(self, tmp_path):
        bad = tmp_path / "array.json"
        bad.write_text(json.dumps(["tag1", "tag2"]))
        with pytest.raises(AllowlistError, match="not a JSON object"):
            load_allowlist(str(bad))

    def test_empty_tags_list_gives_empty_set(self, tmp_path):
        f = tmp_path / "empty.json"
        f.write_text(json.dumps({"version": 1, "tags": []}))
        result = load_allowlist(str(f))
        assert result == set()


# ---------------------------------------------------------------------------
# tag_in_allowlist — membership checks
# ---------------------------------------------------------------------------


class TestTagInAllowlist:
    def test_tag_in_allowlist_returns_true(self, loaded_allowlist):
        assert tag_in_allowlist("[default]Conveyor/Motor_Running", loaded_allowlist) is True

    def test_tag_not_in_allowlist_returns_false(self, loaded_allowlist):
        assert tag_in_allowlist("[default]Conveyor/BLOCKED_SECRET", loaded_allowlist) is False

    def test_empty_allowlist_returns_false(self):
        assert tag_in_allowlist("[default]Conveyor/Motor_Running", set()) is False

    def test_sub_tree_match_exact(self, loaded_allowlist):
        # Exact sub-tree path that is in the allowlist
        assert (
            tag_in_allowlist(
                "[default]Mira_Monitored/conveyor_demo/State", loaded_allowlist
            )
            is True
        )

    def test_sub_tree_partial_path_not_matched(self, loaded_allowlist):
        # A path that is a prefix of an allowlisted path is NOT itself allowed
        assert (
            tag_in_allowlist(
                "[default]Mira_Monitored/conveyor_demo", loaded_allowlist
            )
            is False
        )

    def test_non_set_allowlist_raises(self):
        with pytest.raises(AllowlistError, match="must be a set"):
            tag_in_allowlist("[default]Conveyor/Motor_Running", list(_SAMPLE_TAGS))

    def test_case_sensitive(self, loaded_allowlist):
        # Tag paths are case-sensitive in Ignition
        assert (
            tag_in_allowlist("[default]conveyor/motor_running", loaded_allowlist) is False
        )


# ---------------------------------------------------------------------------
# filter_tags_by_allowlist — list filtering
# ---------------------------------------------------------------------------


class TestFilterTagsByAllowlist:
    def _make_tags(self, entries):
        """Build tag dicts from (path, is_folder) tuples."""
        return [{"path": p, "is_folder": f, "name": p.split("/")[-1]} for p, f in entries]

    def test_returns_only_allowlisted_leaf_tags(self, loaded_allowlist):
        tags = self._make_tags(
            [
                ("[default]Conveyor/Motor_Running", False),
                ("[default]Conveyor/BLOCKED", False),
                ("[default]Conveyor/Conv_State", False),
            ]
        )
        result = filter_tags_by_allowlist(tags, loaded_allowlist)
        paths = [t["path"] for t in result]
        assert "[default]Conveyor/Motor_Running" in paths
        assert "[default]Conveyor/Conv_State" in paths
        assert "[default]Conveyor/BLOCKED" not in paths

    def test_folders_always_pass_through(self, loaded_allowlist):
        # Folders are structural — they pass through even if not in the allowlist
        tags = self._make_tags(
            [
                ("[default]Conveyor", True),
                ("[default]Conveyor/Motor_Running", False),
                ("[default]Conveyor/BLOCKED", False),
            ]
        )
        result = filter_tags_by_allowlist(tags, loaded_allowlist)
        paths = [t["path"] for t in result]
        assert "[default]Conveyor" in paths
        assert "[default]Conveyor/Motor_Running" in paths
        assert "[default]Conveyor/BLOCKED" not in paths

    def test_empty_allowlist_blocks_all_leaf_tags(self):
        tags = self._make_tags(
            [
                ("[default]Conveyor/Motor_Running", False),
                ("[default]Conveyor/Conv_State", False),
            ]
        )
        result = filter_tags_by_allowlist(tags, set())
        # All leaf tags should be blocked; no folders here so result is empty
        assert result == []

    def test_empty_tag_list_returns_empty(self, loaded_allowlist):
        assert filter_tags_by_allowlist([], loaded_allowlist) == []

    def test_all_tags_in_allowlist_all_pass(self, loaded_allowlist):
        tags = self._make_tags([(p, False) for p in _SAMPLE_TAGS])
        result = filter_tags_by_allowlist(tags, loaded_allowlist)
        assert len(result) == len(_SAMPLE_TAGS)


# ---------------------------------------------------------------------------
# resolve_allowlist_path — env-var override
# ---------------------------------------------------------------------------


class TestResolveAllowlistPath:
    def test_env_var_override_wins(self, allowlist_file, monkeypatch):
        monkeypatch.setenv("MIRA_ALLOWLIST_PATH", allowlist_file)
        result = resolve_allowlist_path()
        assert result == allowlist_file

    def test_env_var_nonexistent_falls_through(self, monkeypatch):
        monkeypatch.setenv("MIRA_ALLOWLIST_PATH", "/does/not/exist.json")
        # Should fall through to other candidates (returns None or a real path)
        result = resolve_allowlist_path()
        # We can't assert a specific path here since it depends on the environment;
        # just assert it doesn't crash and returns None or a string.
        assert result is None or isinstance(result, str)

    def test_repo_relative_path_found(self):
        # The actual approved_tags.json in the repo should be discoverable
        # when running tests from within the repo tree.
        result = resolve_allowlist_path()
        if result is not None:
            assert os.path.isfile(result)
            data = json.loads(open(result).read())
            assert "tags" in data
