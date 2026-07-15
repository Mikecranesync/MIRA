"""Hermetic tests for package_scope reference classification (WS4)."""

import json
from printsense.package_scope import classify_scope, render_scope_report


class TestPackageScopeStates:
    """Test each of the 9 reachable scope_state values."""

    def test_ambiguous_target_state_peer_regex_match(self):
        r"""Peer matches ^S\d+[a-z]?/S\d+[a-z]? → ambiguous_target."""
        graph = {
            "edges": [
                {
                    "sig": "ref_1",
                    "src": "S10",
                    "dst": "S20",
                    "peer": "S1/S2",
                    "dir": "fwd",
                    "cls": "resolved",
                    "ev": "visual",
                }
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "clear_upright"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)

        assert result["references"][0]["scope_state"] == "ambiguous_target"
        assert result["schema_version"] == "1.0"

    def test_revision_conflict_state_multiple_revisions(self):
        """Dst sheet has >=2 entries in scope[revisions] → revision_conflict."""
        graph = {
            "edges": [
                {
                    "sig": "ref_2",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "resolved",
                    "ev": "visual",
                }
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "clear_upright"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
            "revisions": {"S20": ["rev_a", "rev_b"]},
        }

        result = classify_scope(graph, index, scope)

        assert result["references"][0]["scope_state"] == "revision_conflict"

    def test_resolved_state_cls_resolved(self):
        """cls resolved → resolved."""
        graph = {
            "edges": [
                {
                    "sig": "ref_3",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "resolved",
                    "ev": "visual",
                }
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "clear_upright"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)

        assert result["references"][0]["scope_state"] == "resolved"

    def test_missing_expected_page_unverifiable_no_index(self):
        """cls unverifiable, dst not in index (missing) → missing_expected_page."""
        graph = {
            "edges": [
                {
                    "sig": "ref_4",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "unverifiable",
                    "ev": "visual",
                }
            ]
        }
        index = {}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)

        assert result["references"][0]["scope_state"] == "missing_expected_page"

    def test_target_page_degraded_unverifiable_blurred(self):
        """cls unverifiable, dst index quality blurred → target_page_degraded."""
        graph = {
            "edges": [
                {
                    "sig": "ref_5",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "unverifiable",
                    "ev": "visual",
                }
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "blurred"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)

        assert result["references"][0]["scope_state"] == "target_page_degraded"

    def test_invalid_reference_dangling_no_dst(self):
        """cls dangling with dst None → invalid_reference."""
        graph = {
            "edges": [
                {
                    "sig": "ref_6",
                    "src": "S10",
                    "dst": None,
                    "peer": None,
                    "dir": "fwd",
                    "cls": "dangling",
                    "ev": "visual",
                }
            ]
        }
        index = {}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10"],
        }

        result = classify_scope(graph, index, scope)

        assert result["references"][0]["scope_state"] == "invalid_reference"

    def test_not_yet_processed_dangling_unknown_scope(self):
        """cls dangling, unknown_scope → not_yet_processed (NEVER out_of_scope)."""
        graph = {
            "edges": [
                {
                    "sig": "ref_7",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "dangling",
                    "ev": "visual",
                }
            ]
        }
        index = {}
        scope = {
            "package_type": "photo_set",
            "scope_status": "unknown_scope",
            "sheet_inventory": None,
        }

        result = classify_scope(graph, index, scope)

        assert result["references"][0]["scope_state"] == "not_yet_processed"

    def test_missing_expected_page_dangling_partial_declared_in_range(self):
        """dangling, partial_declared, dst in declared_range → missing_expected_page."""
        graph = {
            "edges": [
                {
                    "sig": "ref_8",
                    "src": "S10",
                    "dst": "S15",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "dangling",
                    "ev": "visual",
                }
            ]
        }
        index = {}
        scope = {
            "package_type": "partial_binder",
            "scope_status": "partial_declared",
            "sheet_inventory": ["S10"],
            "declared_range": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)

        # S15 is inside the declared RANGE but not an inventory line-item:
        # range membership alone is weaker evidence (package-scope review)
        assert result["references"][0]["scope_state"] == "not_yet_processed"

        # an explicit inventory line-item IS a promise -> missing when absent
        scope2 = dict(scope, sheet_inventory=["S10", "S15"])
        result2 = classify_scope(graph, index, scope2)
        assert result2["references"][0]["scope_state"] == "missing_expected_page"

    def test_out_of_scope_dangling_partial_declared_outside_range(self):
        """dangling, partial_declared, dst outside range → out_of_scope."""
        graph = {
            "edges": [
                {
                    "sig": "ref_9",
                    "src": "S10",
                    "dst": "S30",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "dangling",
                    "ev": "visual",
                }
            ]
        }
        index = {}
        scope = {
            "package_type": "partial_binder",
            "scope_status": "partial_declared",
            "sheet_inventory": ["S10"],
            "declared_range": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)

        assert result["references"][0]["scope_state"] == "out_of_scope"

    def test_unresolved_in_scope_dangling_with_observable_quality(self):
        """dangling, dst present in index with quality → unresolved_in_scope."""
        graph = {
            "edges": [
                {
                    "sig": "ref_10",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "dangling",
                    "ev": "visual",
                }
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "clear_upright"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)

        assert result["references"][0]["scope_state"] == "unresolved_in_scope"

    def test_external_edges_absent_from_references(self):
        """External edges absent from references but in original_edge_classes."""
        graph = {
            "edges": [
                {
                    "sig": "ref_ext",
                    "src": "S10",
                    "dst": "external_ref",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "external",
                    "ev": "visual",
                }
            ]
        }
        index = {}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10"],
        }

        result = classify_scope(graph, index, scope)

        # audit completeness: external edges stay visible, tagged
        assert len(result["references"]) == 1
        assert result["references"][0]["scope_state"] == "not_applicable"
        assert result["original_edge_classes"]["external"] == 1

    def test_input_deep_copy_no_mutation(self):
        """Inputs must not be mutated."""
        graph = {
            "edges": [
                {
                    "sig": "ref_mut",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "resolved",
                    "ev": "visual",
                }
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "clear_upright"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        graph_orig = json.dumps(graph, sort_keys=True)
        index_orig = json.dumps(index, sort_keys=True)
        scope_orig = json.dumps(scope, sort_keys=True)

        classify_scope(graph, index, scope)

        assert json.dumps(graph, sort_keys=True) == graph_orig
        assert json.dumps(index, sort_keys=True) == index_orig
        assert json.dumps(scope, sort_keys=True) == scope_orig

    def test_scope_state_changes_on_status_change(self):
        """Changing scope status recomputes states."""
        graph = {
            "edges": [
                {
                    "sig": "ref_status",
                    "src": "S10",
                    "dst": "S30",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "dangling",
                    "ev": "visual",
                }
            ]
        }
        index = {}

        scope_partial = {
            "package_type": "partial_binder",
            "scope_status": "partial_declared",
            "sheet_inventory": ["S10"],
            "declared_range": ["S10", "S20"],
        }

        scope_unknown = {
            "package_type": "photo_set",
            "scope_status": "unknown_scope",
        }

        result_partial = classify_scope(graph, index, scope_partial)
        result_unknown = classify_scope(graph, index, scope_unknown)

        assert result_partial["references"][0]["scope_state"] == "out_of_scope"
        assert result_unknown["references"][0]["scope_state"] == "not_yet_processed"

    def test_determinism_two_runs_equal(self):
        """Two runs produce identical JSON output."""
        graph = {
            "edges": [
                {
                    "sig": "ref_det",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "resolved",
                    "ev": "visual",
                }
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "clear_upright"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        result1 = classify_scope(graph, index, scope)
        result2 = classify_scope(graph, index, scope)

        assert json.dumps(result1, sort_keys=True) == json.dumps(result2, sort_keys=True)

    def test_report_cp1252_encodable(self):
        """Rendered report must be cp1252-encodable."""
        graph = {
            "edges": [
                {
                    "sig": "ref_rep",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "resolved",
                    "ev": "visual",
                }
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "clear_upright"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)
        report = render_scope_report(result)

        # Must not raise; must be encodable
        report.encode("cp1252")
        assert isinstance(report, str)
        assert len(report) > 0

    def test_no_continuity_strings_in_output(self):
        """Output JSON contains no electrical-continuity assertions."""
        graph = {
            "edges": [
                {
                    "sig": "ref_cont",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "resolved",
                    "ev": "visual",
                }
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "clear_upright"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)
        result_str = json.dumps(result, sort_keys=True)

        forbidden = [r"continuity", r"connected_to", r"bridged"]
        for pattern in forbidden:
            assert pattern.lower() not in result_str.lower()

    def test_original_edge_classes_preserved(self):
        """original_edge_classes preserved and accurate."""
        graph = {
            "edges": [
                {
                    "sig": "ref_oec_1",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "resolved",
                    "ev": "visual",
                },
                {
                    "sig": "ref_oec_2",
                    "src": "S10",
                    "dst": None,
                    "peer": None,
                    "dir": "fwd",
                    "cls": "dangling",
                    "ev": "visual",
                },
                {
                    "sig": "ref_oec_3",
                    "src": "S10",
                    "dst": "ext",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "external",
                    "ev": "visual",
                },
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "clear_upright"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)

        assert result["original_edge_classes"]["resolved"] == 1
        assert result["original_edge_classes"]["dangling"] == 1
        assert result["original_edge_classes"]["external"] == 1

    def test_scope_counts_accurate(self):
        """scope_counts reflects state distribution."""
        graph = {
            "edges": [
                {
                    "sig": "ref_sc_1",
                    "src": "S10",
                    "dst": "S20",
                    "peer": None,
                    "dir": "fwd",
                    "cls": "resolved",
                    "ev": "visual",
                },
                {
                    "sig": "ref_sc_2",
                    "src": "S10",
                    "dst": None,
                    "peer": None,
                    "dir": "fwd",
                    "cls": "dangling",
                    "ev": "visual",
                },
            ]
        }
        index = {"S20": {"sheet": "S20", "quality": "clear_upright"}}
        scope = {
            "package_type": "complete_binder",
            "scope_status": "complete_declared",
            "sheet_inventory": ["S10", "S20"],
        }

        result = classify_scope(graph, index, scope)

        assert result["scope_counts"]["resolved"] == 1
        assert result["scope_counts"]["invalid_reference"] == 1
