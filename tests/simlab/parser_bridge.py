"""Bridge the read-only PLC-export parser (static structure -> IR) with SimLab
(live, labeled behavior).

This module lives in ``tests/`` on purpose: it is glue for the *test* that proves
the **train (parse tags) -> deploy (read live) -> diagnose** arc, NOT a product
surface. It must not be imported by ``mira-plc-parser/`` (which stays
stdlib-only, read-only, UNS-agnostic) or by ``simlab/`` (which stays free of any
LLM/parser dependency). The two packages only meet here.

Three seams (all deterministic, offline):

  * :func:`assetmodel_to_csv_export` — render a SimLab :class:`AssetModel` as a
    parser-ingestible tag CSV (``ValueType`` -> PLC IR data type). This is the
    "train" input: the structure a customer would export from their PLC.
  * :func:`reconcile_namespace` — hand the parser the SimLab asset's UNS path as
    its ``namespace_root`` so the parser's proposed signal namespace lands inside
    SimLab's canonical tree, and expose :func:`leaf_match` to compare a parser
    signal to a SimLab ``tag_path`` by *slugged leaf name* (the robust key —
    full paths diverge on root/category by construction).
  * :func:`snapshot_to_readings` — turn the engine's live ``{uns_path: value}``
    snapshot into parser :class:`vqt_attach.Reading` objects keyed by the *bare
    leaf tag name*, so ``attach_values(graph, readings, by="name")`` lights up
    the parser graph's VQT from live SimLab state. This is the "deploy / read
    live" step.

Importing the parser
--------------------
The parser ships its own package (``mira-plc-parser/``) with its own pyproject;
it is not installed into the SimLab environment. :func:`ensure_parser_on_path`
adds the package root to ``sys.path`` so ``import mira_plc_parser`` resolves.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

from simlab.uns import asset_path, slug

if TYPE_CHECKING:
    from simlab.models import AssetModel


# --- parser import bootstrap -------------------------------------------------

# tests/simlab/parser_bridge.py -> repo root is parents[2]; the parser package
# root is <repo>/mira-plc-parser (carries the importable ``mira_plc_parser``).
_PARSER_PKG_ROOT = Path(__file__).resolve().parents[2] / "mira-plc-parser"


def ensure_parser_on_path() -> None:
    """Put the ``mira-plc-parser`` package root on ``sys.path`` (idempotent)."""
    p = str(_PARSER_PKG_ROOT)
    if p not in sys.path:
        sys.path.insert(0, p)


# SimLab ValueType -> PLC IR data type. Mirrors how a real tag export labels
# types (Rockwell/CCW REAL/DINT/BOOL/STRING); the parser only needs a plausible
# type token, so an ENUM degrades to STRING.
_VALUE_TYPE_TO_PLC: dict[str, str] = {
    "float": "REAL",
    "int": "DINT",
    "bool": "BOOL",
    "string": "STRING",
    "enum": "STRING",
}


def _plc_type(value_type: Any) -> str:
    """Map a SimLab ``ValueType`` (enum or its ``.value`` string) to a PLC type."""
    key = getattr(value_type, "value", value_type)
    return _VALUE_TYPE_TO_PLC.get(str(key), "STRING")


def _csv_field(text: str) -> str:
    """Quote a CSV field iff it contains a comma, quote, or newline (csv-safe)."""
    s = "" if text is None else str(text)
    if any(ch in s for ch in (",", '"', "\n", "\r")):
        return '"' + s.replace('"', '""') + '"'
    return s


def assetmodel_to_csv_export(asset: "AssetModel") -> str:
    """Render a SimLab :class:`AssetModel` as a parser-ingestible tag CSV.

    Columns: ``name,datatype,description,unit`` — the generic dialect the
    parser's CSV reader understands. One row per :class:`TagDef`. The CSV is the
    "train" artifact: exactly the kind of tag export a customer hands MIRA.
    """
    header = "name,datatype,description,unit"
    rows = [header]
    for tag_def in asset.tags.values():
        rows.append(
            ",".join(
                _csv_field(x)
                for x in (
                    tag_def.name,
                    _plc_type(tag_def.value_type),
                    tag_def.description,
                    tag_def.unit,
                )
            )
        )
    return "\n".join(rows) + "\n"


def reconcile_namespace(asset: "AssetModel") -> str:
    """Return the parser ``namespace_root`` for a SimLab asset.

    The parser proposes an ISA-95 namespace under a caller-supplied root; passing
    SimLab's canonical asset path makes the parser's proposed signal namespace
    land *inside* SimLab's tree instead of the parser's generic ``enterprise/...``
    default. The parser stays UNS-agnostic — it just roots its proposal where we
    tell it to.
    """
    return asset_path(asset.asset_id)


def leaf_match(parser_signal_name: str, simlab_uns_path: str) -> bool:
    """Compare a parser signal to a SimLab ``tag_path`` by slugged leaf name.

    Full UNS paths diverge by design: the parser roots its proposal differently
    and inserts its own (inferred) asset/category segments, while SimLab uses the
    declared ``TagCategory``. The robust, stable join key is the *leaf*: the last
    path segment, slugged. So ``vfd_speed_hz`` (parser signal) matches
    ``enterprise.…​.filler01.motor.vfd_speed_hz`` (SimLab tag_path).
    """
    leaf = simlab_uns_path.split(".")[-1]
    return slug(parser_signal_name) == slug(leaf)


def _leaf(uns_path: str) -> str:
    """Bare leaf tag name (last UNS segment) of a canonical SimLab path."""
    return uns_path.split(".")[-1]


def scope_snapshot_to_asset(snapshot_dict: dict[str, Any], asset: "AssetModel") -> dict[str, Any]:
    """Keep only the snapshot entries under ``asset``'s canonical UNS subtree.

    The engine's ``snapshot_dict`` is line-wide; several assets share leaf tag
    names (e.g. ``motor_current_amps`` on every motor-driven machine). Scoping to
    the asset's own subtree is the correct "read live for THIS asset" semantic
    and avoids cross-asset leaf-name collisions collapsing onto one Signal node.
    """
    prefix = asset_path(asset.asset_id) + "."
    return {uns: v for uns, v in snapshot_dict.items() if uns.startswith(prefix)}


def snapshot_to_readings(snapshot_dict: dict[str, Any]) -> list[Any]:
    """Turn an engine ``{uns_path: value}`` snapshot into parser readings.

    Keyed by the **bare leaf tag name** so ``attach_values(graph, readings,
    by="name")`` matches the parser graph's Signal nodes (whose ``name`` is the
    bare PLC tag). Quality is left empty — ``attach_values`` derives "good" for a
    present value and "bad" for an empty/None value (the empty-string
    ``fault_code`` caveat). Returns ``vqt_attach.Reading`` objects.

    Pass an asset-scoped snapshot (:func:`scope_snapshot_to_asset`) to avoid
    cross-asset leaf-name collisions on a line-wide snapshot.
    """
    ensure_parser_on_path()
    from mira_plc_parser import vqt_attach  # noqa: PLC0415 — bootstrap-gated import

    return [vqt_attach.Reading(key=_leaf(uns), value=value) for uns, value in snapshot_dict.items()]


def signal_graph_from_report(report: Any) -> dict[str, Any]:
    """Build the minimal ``by="name"`` graph the parser's ``attach_values`` needs.

    ``attach_values(..., by="name")`` only reads Signal nodes (``type`` /
    ``name``) and ignores registers/edges, so the full compiler/correlate graph
    is unnecessary here — one Signal node per IR tag (from the analysis report's
    tag dictionary) is the exact, minimal shape. Read-only: nothing is mutated.
    """
    nodes = [
        {"id": "signal:%s" % t["name"], "type": "Signal", "name": t["name"]}
        for t in report.tag_dictionary
    ]
    return {"nodes": nodes, "edges": []}


# Tag categories whose values are non-numeric (string/enum) — excluded when a
# caller wants only the numeric VQT join (the parser coerces "" -> None -> bad,
# so an empty string tag is matched-but-unattached, not a numeric attach).
def numeric_readings(snapshot_dict: dict[str, Any], asset: "AssetModel") -> list[Any]:
    """Readings for the asset's FLOAT/INT tags only (drops string/enum/bool).

    Lets the arc test assert the clean numeric invariant — ``attached ==
    len(numeric readings)`` and zero unmatched — without the empty-string
    ``fault_code`` skewing the attached count.
    """
    ensure_parser_on_path()
    from mira_plc_parser import vqt_attach  # noqa: PLC0415

    numeric_types = {"float", "int"}
    numeric_leaves = {
        td.name
        for td in asset.tags.values()
        if str(getattr(td.value_type, "value", td.value_type)) in numeric_types
    }
    scoped = scope_snapshot_to_asset(snapshot_dict, asset)
    out = []
    for uns, value in scoped.items():
        leaf = _leaf(uns)
        if leaf in numeric_leaves:
            out.append(vqt_attach.Reading(key=leaf, value=value))
    return out
