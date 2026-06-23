"""Build the approval-ready FactoryModel from a parsed evidence export.

evidence export (PLCProject) -> FactoryModel (entities + signals + relationships, all suggestions).

Confidence policy (honest about what is fact vs inference):
  * entities (enterprise..asset)      -> HIGH   (structurally explicit: folders + typed UDT instances)
  * `contains` relationships          -> HIGH   (structural containment)
  * live signal role (archetype)      -> MEDIUM  (inferred from name/unit, not a typed tag)
  * unknown signals                   -> LOW + NEEDS_REVIEW
  * `feeds` (upstream/downstream)      -> LOW + NEEDS_REVIEW  (export order is NOT physical flow)
  * a proposed `cell` layer           -> LOW + NEEDS_REVIEW  (no cell in evidence; proposed only)

Reuses the Phase 0 archetype classifier (single source of the taxonomy) and the UNS draft helpers.
Deterministic, stdlib-only (+ the in-repo parser + the Phase 0 script). Read-only.
"""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_PARSER = _HERE.parent / "mira-plc-parser"
_PH0 = _HERE.parent / "discovery_corpus" / "scripts"
for _p in (str(_HERE), str(_PARSER), str(_PH0)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import interrogate_ignition_export as iie  # noqa: E402  (Phase 0 taxonomy -- single source)
import uns_draft  # noqa: E402
from model import (  # noqa: E402
    ApprovalStatus,
    Evidence,
    FactoryModel,
    FactoryNode,
    Relationship,
    Suggestion,
)

ENTITY_LEVELS = ("enterprise", "site", "area", "line", "asset")
_ROLE_DESC = {
    "live_bool": "a boolean run/interlock state (e.g. Running / Blocked / Starved)",
    "live_counter": "a production count (e.g. Counts.Infeed/Outfeed/Defect)",
    "live_state": "a machine state / state duration (PackML-style)",
    "live_analog": "a continuous-process analog (level / flow / temperature / pressure)",
    "live_fault": "a fault / alarm / trip bit (a diagnosable abnormal state)",
    "live_setpoint": "a setpoint / command / target (a desired value, not the measured PV)",
    "unknown": "an UNCLASSIFIED signal (archetype could not be inferred)",
}


def _evidence(node, source: str, detail: str) -> Evidence:
    prov = getattr(node, "provenance", None)
    return Evidence(
        source_file=(getattr(prov, "source_file", "") or source),
        source_format=(getattr(prov, "source_format", "") or "ignition_json"),
        locator=getattr(prov, "locator", "") or "/".join(getattr(node, "path", [])),
        detail=detail,
    )


def build_model(project, source: str) -> FactoryModel:
    model = FactoryModel(source=source)
    # ordered list of asset uns paths per line uns path, for feeds inference
    line_assets: dict[str, list[str]] = {}
    line_node_path: dict[str, list[str]] = {}
    cur_asset_path: list[str] | None = None

    for node in project.namespace:
        level = node.level

        if level in ENTITY_LEVELS:
            uns = uns_draft.entity_uns_path(node.path)
            if level == "asset":
                cur_asset_path = list(node.path)
                detail = (
                    "UdtInstance equipment boundary; typeId=%r, MesTagPath=%r"
                    % (node.udt_type or "(none)", node.mes_path or "(none)")
                )
            else:
                cur_asset_path = cur_asset_path if level != "line" else cur_asset_path
                detail = "Ignition Folder node (%s container)" % level
            sug = Suggestion(
                kind="entity",
                statement="%s '%s' is structurally present in the export."
                % (level.capitalize(), node.name),
                confidence="high",
                approval_needed="Confirm this %s and its placement in the namespace." % level,
                evidence=[_evidence(node, source, detail)],
            )
            model.nodes.append(
                FactoryNode(
                    uns_path=uns, name=node.name, level=level, suggestion=sug,
                    udt_type=node.udt_type, mes_path=node.mes_path,
                    equipment_type=(iie.infer_equipment_type(node.name, node.udt_type)
                                    if level == "asset" else ""),
                )
            )

            # contains relationship to the structural parent
            if len(node.path) > 1:
                parent_uns = uns_draft.entity_uns_path(node.path[:-1])
                model.relationships.append(
                    Relationship(
                        rel_type="contains", source_path=parent_uns, target_path=uns,
                        suggestion=Suggestion(
                            kind="relationship",
                            statement="'%s' contains '%s' (structural containment)." % (parent_uns, uns),
                            confidence="high",
                            approval_needed="Confirm the containment.",
                            evidence=[_evidence(node, source, "parent->child folder/UDT nesting")],
                        ),
                    )
                )

            if level == "line":
                line_assets.setdefault(uns, [])
                line_node_path[uns] = list(node.path)
            elif level == "asset" and len(node.path) > 1:
                parent_line_uns = uns_draft.entity_uns_path(node.path[:-1])
                line_assets.setdefault(parent_line_uns, []).append(uns)

        elif level == "signal":
            arch = iie.classify_signal(node.name, node.unit)
            asset_path = cur_asset_path or list(node.path[:-1])
            uns = uns_draft.signal_uns_path(asset_path, node.name, arch)
            if arch == "static_metadata":
                sug = Suggestion(
                    kind="signal",
                    statement="Signal '%s' is static UDT metadata (not a live signal)." % node.name,
                    confidence="high",
                    approval_needed="None (informational) -- excluded from the live signal set.",
                    evidence=[_evidence(node, source, "AtomicTag metadata leaf")],
                )
                model.nodes.append(
                    FactoryNode(uns_path="", name=node.name, level="signal", suggestion=sug,
                                archetype=arch, unit=node.unit)
                )
                continue
            conf = "low" if arch == "unknown" else "medium"
            status = ApprovalStatus.NEEDS_REVIEW.value if arch == "unknown" else ApprovalStatus.SUGGESTED.value
            appr = (
                "Classify this signal -- archetype could not be inferred from name/unit."
                if arch == "unknown"
                else "Confirm this is %s and accept its UNS mapping %s." % (_ROLE_DESC[arch], uns)
            )
            sug = Suggestion(
                kind="signal",
                statement="Signal '%s' inferred as %s (%s) from its name/unit."
                % (node.name, arch, _ROLE_DESC[arch]),
                confidence=conf, approval_needed=appr,
                evidence=[_evidence(node, source, "AtomicTag '%s' unit=%r" % (node.name, node.unit or ""))],
                status=status,
            )
            model.nodes.append(
                FactoryNode(uns_path=uns or "", name=node.name, level="signal", suggestion=sug,
                            archetype=arch, unit=node.unit,
                            dimension=iie.infer_dimension(node.name, node.unit))
            )

    # proposed cell layer -- NOT in evidence; one needs_review proposal per line
    for line_uns, lpath in line_node_path.items():
        cell_uns = "%s.%s_cell" % (line_uns, lpath[-1].lower().replace(" ", "_"))
        model.nodes.append(
            FactoryNode(
                uns_path=cell_uns, name="%s cell" % lpath[-1], level="cell",
                suggestion=Suggestion(
                    kind="entity",
                    statement="No cell layer is present in the evidence; assets attach directly to "
                    "line '%s'. A cell grouping is OPTIONALLY proposed for review -- not asserted." % lpath[-1],
                    confidence="low",
                    approval_needed="Decide whether line '%s' needs a cell layer; reject if assets "
                    "map directly to the line." % lpath[-1],
                    evidence=[Evidence(source_file=source, source_format="ignition_json",
                                       locator="/".join(lpath),
                                       detail="line node with no intermediate cell container")],
                    status=ApprovalStatus.NEEDS_REVIEW.value,
                ),
            )
        )

    # feeds (upstream -> downstream) inferred from asset order within a line
    for line_uns, assets in line_assets.items():
        for a, b in zip(assets, assets[1:]):
            model.relationships.append(
                Relationship(
                    rel_type="feeds", source_path=a, target_path=b,
                    suggestion=Suggestion(
                        kind="relationship",
                        statement="Inferred material flow '%s' -> '%s' from asset order within the "
                        "line (export order; physical flow NOT confirmed by evidence)." % (a, b),
                        confidence="low",
                        approval_needed="Confirm or correct the material-flow direction; export order "
                        "is not authoritative.",
                        evidence=[Evidence(source_file=source, source_format="ignition_json",
                                           locator=line_uns,
                                           detail="adjacency of two assets within line %s" % line_uns)],
                        status=ApprovalStatus.NEEDS_REVIEW.value,
                    ),
                )
            )

    return model
