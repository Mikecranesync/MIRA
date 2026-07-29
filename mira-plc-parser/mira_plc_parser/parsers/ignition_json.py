"""Ignition tag-export JSON parser -- the Cappy Hour / ProveIt import engine.

An Ignition tag export is a nested tree of three node kinds:
  * `Folder`       -- structural containment (enterprise / site / area / line)
  * `UdtInstance`  -- a UDT instance; the FIRST one under a folder, typically typed
                      `Models/Equipment/Process/<X>`, is an EQUIPMENT asset; nested UdtInstances
                      below it are just grouping for signals
  * `AtomicTag`    -- a leaf data point (the real signal), often with an `engUnit`

We map that onto an explicit ISA-95 `NamespaceNode` hierarchy (enterprise/site/area/line/asset/
signal). Folder depth selects the ISA-95 level (root->enterprise, then site/area/line, deeper
folders clamp to line). The asset boundary is the first UdtInstance reached under the folder chain;
everything below it is a signal whose name is the dotted path from the asset (`ProductionRun.Running`).

MES bindings (`parameters.MesTagPath`/`TagPath`) and CESMII nameplate (a `MachineIdentification`
group's Manufacturer/Model/SerialNumber atomics) are lifted onto the asset node. Engineering units
ride along on each signal.

Read-only, stdlib-only (`json`). This parser fills `PLCProject.namespace`; it leaves `controllers`
empty (there is no ladder logic in a tag export). It is purely additive -- the L5X/CSV/ST paths are
untouched. Output is the same vendor-neutral IR every other parser targets.
"""
from __future__ import annotations

import json

from ..ir import Confidence, NamespaceLevel, NamespaceNode, PLCProject, Provenance

# Folder depth -> ISA-95 container level. Anything deeper than `line` clamps to line (a sub-line is
# still line-level containment); the asset/signal levels come from the node kind, not folder depth.
_FOLDER_LEVELS = (
    NamespaceLevel.ENTERPRISE.value,
    NamespaceLevel.SITE.value,
    NamespaceLevel.AREA.value,
    NamespaceLevel.LINE.value,
)

# CESMII MachineIdentification atomic names -> the asset field they populate.
_NAMEPLATE = {
    "manufacturer": "manufacturer",
    "model": "model",
    "serialnumber": "serial",
    "serial": "serial",
}


def _folder_level(depth: int) -> str:
    return _FOLDER_LEVELS[min(depth, len(_FOLDER_LEVELS) - 1)]


def _param_value(node: dict, key: str) -> str:
    """Read a UdtInstance parameter string value, e.g. parameters.MesTagPath.value."""
    p = (node.get("parameters") or {}).get(key)
    if isinstance(p, dict):
        v = p.get("value")
        return v if isinstance(v, str) else ""
    return v if isinstance(p, str) else ""


def parse(text: str, source_file: str = "") -> PLCProject:
    proj = PLCProject(source_format="ignition_json",
                      source_files=[source_file] if source_file else [])
    try:
        root = json.loads(text)
    except (ValueError, TypeError) as exc:
        proj.warnings.append("not valid JSON: %s" % exc)
        return proj
    if not isinstance(root, dict) or "tagType" not in root:
        proj.warnings.append("not an Ignition tag export (no root tagType/tags)")
        return proj

    nodes: list[NamespaceNode] = []
    _walk(root, folder_chain=[], asset=None, signal_prefix=[], depth=0,
          nodes=nodes, source_file=source_file)
    proj.namespace = nodes
    if not nodes:
        proj.warnings.append("Ignition tag export parsed but produced no namespace nodes")
    return proj


def _prov(source_file: str, path: list[str]) -> Provenance:
    return Provenance(source_file=source_file, source_format="ignition_json",
                      locator="/".join(path), confidence=Confidence.HIGH)


def _walk(node: dict, folder_chain: list[str], asset: NamespaceNode | None,
          signal_prefix: list[str], depth: int, nodes: list[NamespaceNode],
          source_file: str) -> None:
    if not isinstance(node, dict):
        return
    kind = node.get("tagType")
    name = node.get("name") or ""
    children = node.get("tags") or []

    if kind == "Folder":
        chain = folder_chain + [name]
        nodes.append(NamespaceNode(name=name, level=_folder_level(depth), path=chain,
                                   provenance=_prov(source_file, chain)))
        for child in children:
            _walk(child, chain, asset=None, signal_prefix=[], depth=depth + 1,
                  nodes=nodes, source_file=source_file)
        return

    if kind == "UdtInstance":
        if asset is None:
            # the equipment/asset boundary: first UdtInstance under the folder chain
            apath = folder_chain + [name]
            anode = NamespaceNode(
                name=name, level=NamespaceLevel.ASSET.value, path=apath,
                udt_type=node.get("typeId") or "",
                mes_path=_param_value(node, "MesTagPath"),
                tag_path=_param_value(node, "TagPath"),
                provenance=_prov(source_file, apath),
            )
            nodes.append(anode)
            for child in children:
                _walk(child, folder_chain, asset=anode, signal_prefix=[], depth=depth,
                      nodes=nodes, source_file=source_file)
        else:
            # a nested grouping UdtInstance below an asset -> part of the dotted signal name
            for child in children:
                _walk(child, folder_chain, asset=asset, signal_prefix=signal_prefix + [name],
                      depth=depth, nodes=nodes, source_file=source_file)
        return

    if kind == "AtomicTag":
        if asset is None:
            # an atomic directly under a folder (rare) -> a signal sitting under the line
            spath = folder_chain + [name]
            nodes.append(NamespaceNode(name=name, level=NamespaceLevel.SIGNAL.value, path=spath,
                                       data_type=node.get("dataType") or "",
                                       unit=node.get("engUnit") or "",
                                       provenance=_prov(source_file, spath)))
            return
        dotted = ".".join(signal_prefix + [name])
        spath = list(asset.path) + [dotted]
        nodes.append(NamespaceNode(name=dotted, level=NamespaceLevel.SIGNAL.value, path=spath,
                                   data_type=node.get("dataType") or "",
                                   unit=node.get("engUnit") or "",
                                   provenance=_prov(source_file, spath)))
        # CESMII nameplate: lift Manufacturer / Model / SerialNumber onto the owning asset
        field = _NAMEPLATE.get(name.lower())
        if field and isinstance(node.get("value"), str) and node["value"]:
            if not getattr(asset, field):
                setattr(asset, field, node["value"])
        return

    # unknown tagType: descend through any children so we don't silently drop a subtree
    for child in children:
        _walk(child, folder_chain, asset=asset, signal_prefix=signal_prefix, depth=depth,
              nodes=nodes, source_file=source_file)
