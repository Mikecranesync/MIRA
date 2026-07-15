"""Package scope reference classification (WS4).

Deterministic, stdlib-only scope-state assignment for electrical print references.
Classifies each reference edge into one of nine scope_state categories based on:
  1. Peer pattern matching
  2. Revision conflicts
  3. Edge classification
  4. Index quality checks
  5. Scope status and declared range logic

No mutation of inputs. No LLM/network calls.
"""

import copy
import re


def classify_scope(graph: dict, index: dict, scope: dict) -> dict:
    """Classify reference edges into scope states.

    Args:
        graph: {"edges": [{"sig", "src", "dst", "peer", "dir", "cls", "ev"}, ...]}
        index: {sheet_id: {"sheet", "quality"}, ...}
        scope: {
            "package_type": str,
            "scope_status": str,
            "declared_range": [lo, hi] optional,
            "sheet_inventory": [ids] optional,
            "revisions": {sheet_id: [rev_ids]} optional,
            ...
        }

    Returns:
        {
            "schema_version": "1.0",
            "scope": <echo of scope>,
            "original_edge_classes": {resolved, unverifiable, dangling, external counts},
            "references": [<edge with scope_state added; external edges omitted>],
            "scope_counts": {scope_state: count},
        }

    Scope state rules (exact priority order):
        1. peer matches ^S\\d+[a-z]?/S\\d+[a-z]? -> "ambiguous_target"
        2. dst sheet has >=2 revisions -> "revision_conflict"
        3. cls resolved -> "resolved"
        4. cls unverifiable: quality missing -> "missing_expected_page"; blurred -> "target_page_degraded"
        5. cls dangling, dst None -> "invalid_reference"
        6. cls dangling, dst present with quality -> "unresolved_in_scope"
        7. cls dangling, scope_status unknown_scope -> "not_yet_processed" (NEVER out_of_scope)
        8. cls dangling, partial_declared: in-range -> "missing_expected_page", out -> "out_of_scope"
        9. cls dangling, complete_declared: in-range -> "missing_expected_page", out -> "invalid_reference"

    Inputs are not mutated.
    """
    # Deep copy inputs to avoid mutation
    graph = copy.deepcopy(graph)
    index = copy.deepcopy(index)
    scope = copy.deepcopy(scope)

    # Normalize the index: accept both the systemgraph/pageset shape
    # ({"sheets": [{"sheet": "21", "quality": ...}, ...]}) and a plain
    # {sheet_id: entry} lookup.
    if "sheets" in index:
        index = {str(s.get("sheet")).lower(): s for s in index["sheets"]}

    # Initialize counters
    edge_class_counts = {"resolved": 0, "unverifiable": 0, "dangling": 0, "external": 0}
    scope_state_counts = {}
    references = []

    # Process each edge
    for edge in graph.get("edges", []):
        cls = edge.get("cls")
        edge_class_counts[cls] = edge_class_counts.get(cls, 0) + 1

        # External edges are NOT page references, but they stay visible in
        # the output for audit completeness (package-scope review): a
        # vanished edge reads as a bug.
        if cls == "external":
            reference = copy.deepcopy(edge)
            reference["scope_state"] = "not_applicable"
            references.append(reference)
            scope_state_counts["not_applicable"] = \
                scope_state_counts.get("not_applicable", 0) + 1
            continue

        # Assign scope_state
        scope_state = _assign_scope_state(edge, index, scope)

        # Build reference record (echo original fields + scope_state)
        reference = copy.deepcopy(edge)
        reference["scope_state"] = scope_state
        references.append(reference)

        # Count this state
        scope_state_counts[scope_state] = scope_state_counts.get(scope_state, 0) + 1

    return {
        "schema_version": "1.0",
        "scope": scope,
        "original_edge_classes": edge_class_counts,
        "references": references,
        "scope_counts": scope_state_counts,
    }


def _assign_scope_state(edge: dict, index: dict, scope: dict) -> str:
    """Assign scope_state to a single edge (rules 1-9)."""
    peer = edge.get("peer")
    dst = edge.get("dst")
    cls = edge.get("cls")

    # Rule 1: peer pattern match
    if peer and re.match(r"^S\d+[a-z]?/S\d+[a-z]?$", peer):
        return "ambiguous_target"

    # Rule 2: revision conflict
    revisions = scope.get("revisions", {})
    if dst and dst in revisions and len(revisions.get(dst, [])) >= 2:
        return "revision_conflict"

    # Rule 3: cls resolved
    if cls == "resolved":
        return "resolved"

    # Rule 4: cls unverifiable
    if cls == "unverifiable":
        if dst not in index:
            return "missing_expected_page"
        quality = index.get(dst, {}).get("quality")
        if quality == "blurred":
            return "target_page_degraded"
        return "missing_expected_page"

    # Rule 5: cls dangling, dst None
    if cls == "dangling" and dst is None:
        return "invalid_reference"

    # Rule 6: cls dangling, dst present with observable quality
    if cls == "dangling" and dst in index and index.get(dst, {}).get("quality"):
        return "unresolved_in_scope"

    # Rule 7: cls dangling, unknown_scope -> NEVER out_of_scope
    scope_status = scope.get("scope_status", "unknown_scope")
    if cls == "dangling" and scope_status == "unknown_scope":
        return "not_yet_processed"

    # Rules 8-9: cls dangling with declared range / status
    if cls == "dangling" and dst is not None:
        sheet_inventory = scope.get("sheet_inventory")
        declared_range = scope.get("declared_range")

        def _num(sheet_id) -> int | None:
            m = re.match(r"S?(\d+)", str(sheet_id))
            return int(m.group(1)) if m else None

        inventory_hit = bool(sheet_inventory) and (
            dst in sheet_inventory
            or str(dst).lstrip("Ss") in {str(s).lstrip("Ss")
                                         for s in sheet_inventory})
        range_hit = False
        if declared_range and len(declared_range) >= 2:
            dn, lo, hi = _num(dst), _num(declared_range[0]), _num(declared_range[1])
            range_hit = None not in (dn, lo, hi) and lo <= dn <= hi

        if scope_status == "partial_declared":
            if inventory_hit:
                return "missing_expected_page"
            if range_hit:
                # range membership alone is weaker evidence than an explicit
                # inventory line-item (package-scope review): the page was
                # never individually promised, only bounded
                return "not_yet_processed"
            return "out_of_scope"
        elif scope_status == "complete_declared":
            return ("missing_expected_page"
                    if inventory_hit or range_hit else "invalid_reference")

    # Fallback (shouldn't reach here normally)
    return "not_yet_processed"


def render_scope_report(result: dict) -> str:
    """Render a human-readable ASCII report of scope classification results.

    Args:
        result: Output dict from classify_scope()

    Returns:
        ASCII/cp1252-safe string with counts and summary.
    """
    original_classes = result.get("original_edge_classes", {})
    scope_counts = result.get("scope_counts", {})
    reference_count = len(result.get("references", []))

    lines = [
        "=== Scope Classification Report ===",
        "",
        "Original Edge Classes (all edges):",
        f"  resolved:       {original_classes.get('resolved', 0)}",
        f"  unverifiable:   {original_classes.get('unverifiable', 0)}",
        f"  dangling:       {original_classes.get('dangling', 0)}",
        f"  external:       {original_classes.get('external', 0)}",
        "",
        f"References Processed (excluding external): {reference_count}",
        "",
        "Scope States:",
    ]

    for state_name in sorted(scope_counts.keys()):
        count = scope_counts[state_name]
        lines.append(f"  {state_name:30} {count:3d}")

    lines.append("")
    lines.append("End Report")

    report = "\n".join(lines)
    # Verify cp1252 encodability
    report.encode("cp1252")
    return report
