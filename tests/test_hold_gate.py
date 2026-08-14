"""Unit tests for the hold-gate decision function (tools/ci/hold_gate.py)."""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "hold_gate", Path(__file__).parent.parent / "tools" / "ci" / "hold_gate.py"
)
hold_gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hold_gate)
is_held = hold_gate.is_held


class TestTitleMarkers:
    def test_held_on_title_marker(self):
        for title in [
            "feat(hub): Equipment Notebook V1 [HELD / DO NOT MERGE]",
            "fix: something DO NOT MERGE yet",
            "chore: WIP experiment",
            "[Draft] new thing",
        ]:
            held, reason = is_held(title, [])
            assert held is True, title
            assert "title" in reason

    def test_not_held_on_normal_title(self):
        for title in [
            "fix(notebook): retrieval + answer corrective fixes",
            "feat: add the widget",
            "docs: update readme",
        ]:
            held, _ = is_held(title, [])
            assert held is False, title

    def test_marker_is_word_bounded_not_substring(self):
        # "upheld" contains "held" but must NOT trip the gate.
        held, _ = is_held("fix: rights upheld in the audit", [])
        assert held is False


class TestLabels:
    def test_held_on_hold_label(self):
        for labels in [["do-not-merge"], ["hold"], ["HELD"], ["WIP"], ["blocked"], ["Do Not Merge"]]:
            held, reason = is_held("normal title", labels)
            assert held is True, labels
            assert "label" in reason

    def test_not_held_on_unrelated_labels(self):
        held, _ = is_held("normal title", ["bug", "enhancement", "needs-review"])
        assert held is False

    def test_label_match_is_case_insensitive(self):
        held, _ = is_held("normal title", ["Do-Not-Merge"])
        assert held is True


class TestPrecedenceAndEdges:
    def test_label_wins_even_with_clean_title(self):
        held, reason = is_held("clean title", ["hold"])
        assert held is True and "label" in reason

    def test_empty_inputs_not_held(self):
        assert is_held("", [])[0] is False
        assert is_held(None, [])[0] is False

    def test_both_signals_present(self):
        held, _ = is_held("something DO NOT MERGE", ["do-not-merge"])
        assert held is True
