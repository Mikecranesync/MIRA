"""UNS path builders — pure string helpers, no external deps.

In-bot copy of the path-builder subset of `mira-crawler/ingest/uns.py`. The
crawler module cannot be imported from `mira-bots/*` (architecture contract,
enforced by `tests/test_architecture.py::test_bots_cannot_import_crawler`),
so the resolver imports these helpers from here instead.

Keep this in sync with `mira-crawler/ingest/uns.py` if the UNS path grammar
changes. Both files MUST agree on the output of every helper they share —
the crawler writes UNS paths, the bot reads them, and a drift would put the
two on different addressing schemes.

The full UNS spec lives in `mira-crawler/ingest/uns.py` and
`docs/specs/uns-kg-unification-spec.md`. This file ships only what the
resolver needs: `slug`, `RESERVED_LABELS`, and the kb-branch path builders
(`manufacturer_path`, `model_path`, `manual_path`, `fault_code_path`).
"""

from __future__ import annotations

import re

_NON_LABEL_CHARS = re.compile(r"[^a-z0-9]+")

# Type-marker labels reserved for UNS structure — never used as a
# manufacturer / model / instance slug. The resolver checks against this
# set so a token like "fault_codes" never becomes the model component.
RESERVED_LABELS = frozenset(
    {
        "enterprise",
        "knowledge_base",
        "operations",
        "community",
        "site",
        "area",
        "line",
        "work_cell",
        "equipment",
        "component",
        "datapoint",
        "maintenance",
        "documentation",
        "manuals",
        "fault_codes",
        "pm_schedules",
        "pm_schedule",
        "fault_history",
        "work_orders",
        "parts_lists",
        "parts_inventory",
        "schematics",
        "procedures",
        "fleet",
        "shared_services",
        "utilities",
        "safety_systems",
        "environmental",
        "technicians",
        "inventory",
        "compliance",
        "common_faults",
        "mtbf_benchmarks",
        "resolution_patterns",
    }
)


def slug(value: str) -> str:
    """Normalize a free-form string into a single ltree label."""
    if not value:
        return ""
    lowered = value.strip().lower()
    cleaned = _NON_LABEL_CHARS.sub("_", lowered).strip("_")
    return cleaned


def _join(*parts: str) -> str:
    return ".".join(p for p in parts if p)


def kb_root() -> str:
    return "enterprise.knowledge_base"


def manufacturer_path(manufacturer: str | None) -> str:
    return _join(kb_root(), slug(manufacturer or ""))


def family_path(manufacturer: str | None, family: str | None) -> str:
    return _join(manufacturer_path(manufacturer), slug(family or ""))


def model_path(
    manufacturer: str | None,
    model: str | None,
    family: str | None = None,
) -> str:
    return _join(family_path(manufacturer, family), slug(model or ""))


def manual_path(
    manufacturer: str | None,
    model: str | None,
    family: str | None = None,
    manual_slug: str | None = None,
) -> str:
    return _join(model_path(manufacturer, model, family), "manuals", slug(manual_slug or ""))


def fault_code_path(
    manufacturer: str | None,
    code: str,
    model: str | None = None,
    family: str | None = None,
) -> str:
    if model:
        prefix = model_path(manufacturer, model, family)
    else:
        prefix = manufacturer_path(manufacturer)
    return _join(prefix, "fault_codes", slug(code))


# ── Operational / plant namespace (ISA-95 ltree) ─────────────────────────────
# These match the plant-side branch:
#   enterprise.{company}.site.{site}.area.{area}[.line.{line}[.work_cell.{wc}]].equipment.{eq}
# See `mira-crawler/ingest/uns.py::assigned_equipment_path` — this is the
# dep-free counterpart for use inside mira-bots. Keep in sync with that
# function; the crawler writes these paths, the bot reads them.


def _ops_root(company: str) -> str:
    return _join("enterprise", slug(company))


def site_ops_path(company: str, site: str) -> str:
    return _join(_ops_root(company), "site", slug(site))


def area_ops_path(company: str, site: str, area: str) -> str:
    return _join(site_ops_path(company, site), "area", slug(area))


def assigned_equipment_path(
    company: str,
    site: str,
    area: str,
    equipment: str,
    line: str | None = None,
    work_cell: str | None = None,
) -> str:
    """Build `enterprise.{company}.site.{s}.area.{a}[.line.{l}[.work_cell.{c}]].equipment.{eq}`.

    Mirrors ``mira-crawler/ingest/uns.py::assigned_equipment_path`` exactly.
    """
    prefix = area_ops_path(company, site, area)
    if line:
        prefix = _join(prefix, "line", slug(line))
        if work_cell:
            prefix = _join(prefix, "work_cell", slug(work_cell))
    return _join(prefix, "equipment", slug(equipment))
