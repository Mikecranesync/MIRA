"""Typed identity relationships + Phase B migration (D11/D20).

Replaces flat alias grouping with typed, evidence-gated relationships.
``CONFIRMED_ALIAS_OF`` is NEVER emitted automatically (human-only). The
migration function reinterprets Phase B ``alias_variation`` findings WITHOUT
mutating the input graph — originals are evidence and stay untouched."""

from __future__ import annotations

import copy

from .decoder import decode

RELATIONSHIP_TYPES = (
    "SAME_EXACT_DESIGNATION", "SAME_BASE_DEVICE", "CHILD_CONNECTION_POINT_OF",
    "CONTACT_MEMBER_OF", "COIL_TERMINAL_OF", "PORT_OF", "CONNECTOR_PIN_OF",
    "NESTED_DEVICE_OF", "RELATIVE_REFERENCE_TO", "PROBABLE_ALIAS_OF",
    "CONFIRMED_ALIAS_OF", "PROJECT_EQUIVALENT_OF", "REVISION_VARIANT_OF",
    "AMBIGUOUS_WITH",
)

# connection-point kinds whose classification is backed by a sourced rule —
# only these justify a typed child relationship during migration
_SOURCED_KINDS = {"contact_terminal", "terminal", "connector_pin",
                  "conductor_core", "main_pole_terminal"}


def _child_relationship(decoded: dict) -> str | None:
    cp = decoded.get("connection_point")
    if not cp:
        return None
    if cp.get("role") == "coil_or_control_terminal":
        return "COIL_TERMINAL_OF"
    if cp.get("kind") == "connector_pin":
        return "CONNECTOR_PIN_OF"
    if cp.get("kind") == "port":
        return "PORT_OF"
    if cp.get("kind") in _SOURCED_KINDS:
        return "CHILD_CONNECTION_POINT_OF"
    return None  # unsourced suffix: never auto-promoted to a child point


def relate(d1: dict, d2: dict) -> list[dict]:
    """Typed relationships between two decoded designations."""
    rels: list[dict] = []
    a, b = d1["raw"], d2["raw"]
    if a == b:
        return [{"type": "SAME_EXACT_DESIGNATION", "from": a, "to": b}]
    base1, base2 = d1.get("base_designation"), d2.get("base_designation")
    if base1 and base1 == base2:
        rels.append({"type": "SAME_BASE_DEVICE", "from": a, "to": b,
                     "base": base1})
        cp1, cp2 = d1.get("connection_point"), d2.get("connection_point")
        if cp1 and cp2 and cp1.get("pair_key") and \
                cp1.get("pair_key") == cp2.get("pair_key"):
            rels.append({"type": "CONTACT_MEMBER_OF", "from": a, "to": b,
                         "group": f"{base1}:{cp1['pair_key']}",
                         "state_proof": "never"})
        for d, raw in ((d1, a), (d2, b)):
            child = _child_relationship(d)
            if child:
                rels.append({"type": child, "from": raw, "to": base1})
    elif d1.get("normalized") == d2.get("normalized"):
        rels.append({"type": "PROBABLE_ALIAS_OF", "from": a, "to": b,
                     "reason": "identical after whitespace/case normalization"})
    return rels


def migrate_alias_variations(graph: dict, profile: str = "eplan_iec") -> dict:
    """D20: reinterpret Phase B ``alias_variation`` findings with decoded
    structure. The input graph is NOT modified; the returned report carries
    a reinterpretation per finding plus classification counts. Nothing is
    deleted, nothing is auto-confirmed, unknowns stay unresolved."""
    findings = [c for c in graph.get("contradictions", [])
                if c.get("type") == "alias_variation"]
    reinterpretations: list[dict] = []
    counts = {"same_exact_designation": 0, "same_base_device": 0,
              "child_connection_point": 0, "probable_alias": 0,
              "unresolved": 0, "contradiction": 0}

    for finding in findings:
        forms = list(finding.get("forms", []))
        decoded = {f: decode(f, profile=profile) for f in forms}
        # anchor = the most common DECODED parent base among the members —
        # never the shortest raw form: a finding may contain only sibling
        # connection points with no bare parent form present (the canonical
        # A1/A2 case). Ties break to the shortest base string.
        base_counts: dict[str, int] = {}
        for d in decoded.values():
            base = d.get("base_designation")
            if base:
                base_counts[base] = base_counts.get(base, 0) + 1
        anchor = max(base_counts,
                     key=lambda b: (base_counts[b], -len(b))) \
            if base_counts else None
        members: list[dict] = []
        for form in forms:
            d = decoded[form]
            if anchor and form == anchor:
                rel = "SAME_EXACT_DESIGNATION"
                counts["same_exact_designation"] += 1
            elif anchor and d.get("base_designation") == anchor:
                child = _child_relationship(d)
                if child in ("COIL_TERMINAL_OF", "CHILD_CONNECTION_POINT_OF",
                             "CONNECTOR_PIN_OF", "PORT_OF"):
                    rel = child
                    counts["child_connection_point"] += 1
                else:
                    # same parent, unsourced suffix: related but unproven
                    rel = "AMBIGUOUS_WITH"
                    counts["unresolved"] += 1
            else:
                # different decoded base (truncation/expansion families like
                # a head vs a suffixed sibling): Phase B forms alone can NEVER
                # prove an alias (Safety law 7) — stays ambiguous, no guess.
                rel = "AMBIGUOUS_WITH"
                counts["unresolved"] += 1
            members.append({"form": form, "relationship": rel,
                            "target": anchor or form,
                            "state_proof": "never"})
        reinterpretations.append({
            "key": finding.get("key"),
            # deep copy: a shallow dict would share the nested forms/sheets
            # lists with the source graph — downstream mutation of the record
            # must never reach back into the legacy evidence
            "original": copy.deepcopy(finding),
            "anchor": anchor,
            "members": members,
            "sheets": list(finding.get("sheets", [])),
        })

    return {"schema_version": "1.0", "total": len(findings),
            "reinterpretations": reinterpretations, "counts": counts,
            "note": "originals retained; CONFIRMED_ALIAS_OF is human-only"}
