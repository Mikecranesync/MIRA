"""The component sublayer + generic failure-mode binding.

Introduces inferred components (photoeye / vfd / motor / sensor / ...) UNDER the Phase 1 assets so the
engine can say "the likely cause INSIDE Conveyor 3 is a photoeye". Components are NOT in the tag
export -- they are the maintenance sublayer MIRA reasons about -- so each is a `needs_review`
suggestion with evidence + confidence (same honesty discipline as Phase 1; nothing asserted as fact).

Generic binding: every asset is classified, then bound to the failure modes applicable to its class.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

_HERE = Path(__file__).resolve().parent          # causality/
_ROOT = _HERE.parent
_FC = _ROOT / "factory_context"
_PARSER = _ROOT / "mira-plc-parser"
for _p in (str(_HERE), str(_FC), str(_PARSER)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import failure_modes as fm  # noqa: E402
from mira_plc_parser.uns import slug  # noqa: E402
from model import ApprovalStatus, Evidence, Suggestion  # noqa: E402  (factory_context.model)

# raw class keyword -> canonical asset class used by the catalog. Anything unmatched -> "generic".
_CLASS_KEYWORDS = (
    "conveyor", "caploader", "capper", "filler", "labeler", "sealer", "packager",
    "palletizer", "robot", "tank", "vat",
)
_CLASS_ALIASES = {
    "washer": "caploader", "wrapper": "packager", "pallet": "palletizer",
    "workstation": "palletizer", "pump": "tank",
}


def classify_asset(node) -> str:
    """Map an asset node to a catalog asset class from its udt_type + name."""
    text = ("%s %s" % (getattr(node, "udt_type", ""), getattr(node, "name", ""))).lower()
    for kw in _CLASS_KEYWORDS:
        if kw in text:
            return kw
    for alias, canon in _CLASS_ALIASES.items():
        if alias in text:
            return canon
    return "generic"


@dataclass
class Component:
    asset_uns: str
    component_type: str
    name: str
    uns_path: str
    suggestion: Suggestion


@dataclass
class Binding:
    asset_uns: str
    asset_name: str
    asset_class: str
    component_type: str
    mode_id: str


@dataclass
class CausalityModel:
    context: object                          # factory_context FactoryModel
    components: list[Component] = field(default_factory=list)
    bindings: list[Binding] = field(default_factory=list)

    def assets(self) -> list:
        return self.context.by_level("asset")

    def line_of(self, asset_uns: str) -> str:
        return asset_uns.rsplit(".", 1)[0]

    def signals_under(self, asset_uns: str) -> list:
        pref = asset_uns + "."
        return [s for s in self.context.signals() if s.uns_path and s.uns_path.startswith(pref)]

    def bindings_for_asset(self, asset_uns: str) -> list[Binding]:
        return [b for b in self.bindings if b.asset_uns == asset_uns]

    def evidence_violations(self) -> list[str]:
        bad = []
        statuses = {s.value for s in ApprovalStatus}
        for c in self.components:
            s = c.suggestion
            if not s.evidence:
                bad.append("component %s has no evidence" % c.uns_path)
            if s.confidence not in ("high", "medium", "low", "review"):
                bad.append("component %s bad confidence" % c.uns_path)
            if s.status not in statuses:
                bad.append("component %s bad status" % c.uns_path)
            if not s.approval_needed.strip():
                bad.append("component %s no approval_needed" % c.uns_path)
        return bad


def build_causality(model) -> CausalityModel:
    """Bind every asset in the Phase 1 model to its applicable failure modes + inferred components."""
    cm = CausalityModel(context=model)
    seen: set[tuple[str, str]] = set()
    for asset in model.by_level("asset"):
        cls = classify_asset(asset)
        for mode in fm.modes_for_class(cls):
            cm.bindings.append(
                Binding(asset_uns=asset.uns_path, asset_name=asset.name, asset_class=cls,
                        component_type=mode.component_type, mode_id=mode.id)
            )
            key = (asset.uns_path, mode.component_type)
            if key in seen:
                continue
            seen.add(key)
            cm.components.append(
                Component(
                    asset_uns=asset.uns_path,
                    component_type=mode.component_type,
                    name="%s %s" % (asset.name, mode.component_type),
                    uns_path="%s.component.%s" % (asset.uns_path, slug(mode.component_type)),
                    suggestion=Suggestion(
                        kind="component",
                        statement="Inferred component '%s' under asset '%s' (maintenance sublayer; "
                        "not present in the tag export)." % (mode.component_type, asset.name),
                        confidence="medium",
                        approval_needed="Confirm asset '%s' has a %s." % (asset.name, mode.component_type),
                        evidence=[Evidence(
                            source_file="causality/failure_modes.py", source_format="failure_mode_catalog",
                            locator=mode.id,
                            detail="component inferred from asset class '%s'" % cls,
                        )],
                        status=ApprovalStatus.NEEDS_REVIEW.value,
                    ),
                )
            )
    return cm
