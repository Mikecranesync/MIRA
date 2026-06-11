"""UNS path helpers shared by the ingest pipeline, the backfill scripts,
and the Hub UNS browse API.

UNS schema (broadened 2026-05-07 per Mike — see
docs/specs/uns-kg-unification-spec.md §3.1)
================================================

The UNS is the canonical address space for every node MIRA knows about.
It uses ISA-95 segment naming literally as type-marker labels alternated
with instance labels — that makes the tree explorable: walk one level
deep and the segment alone tells you what kind of children to expect.

Two top-level branches under `enterprise`:

1. **Knowledge base** — manufacturer-organized, site-independent.
   Every model MIRA learns about from a manual lives here permanently,
   even after a customer assigns it to a site. Paths:

       enterprise.knowledge_base.{manufacturer}.{family?}.{model}
       enterprise.knowledge_base.{manufacturer}.{family?}.{model}.manuals[.{slug}]
       enterprise.knowledge_base.{manufacturer}.{family?}.{model}.fault_codes.{code}
       enterprise.knowledge_base.{manufacturer}.{family?}.{model}.pm_schedules[.{slug}]
       enterprise.knowledge_base.{manufacturer}.{family?}.{model}.parts_lists[.{slug}]
       enterprise.knowledge_base.community.{equipment_class}.{common_faults|mtbf_benchmarks|resolution_patterns}

2. **Per-company site hierarchy** — the ISA-95 physical model with the
   `work_cell` segment Mike asked us to add (was the one real ISA-95
   gap surfaced by the standards-compliance research). The literal
   markers `site`, `area`, `line`, `work_cell`, `equipment` alternate
   with dynamic instance labels:

       enterprise.{company}.site.{site}.area.{area}.line.{line}.work_cell.{cell}.equipment.{eq_id}

   Equipment can also live directly on a line (no cell) or in an area
   (no line) — the `line.{line}.work_cell.{cell}` segments are
   skippable. Each equipment node has four canonical sub-branches:

       .component.{component_name}
       .datapoint.{tag_name}                  # future Layer 4 telemetry
       .maintenance.{pm_schedule|fault_history|work_orders|parts_inventory}.{...}
       .documentation.{manuals|schematics|procedures}.{...}

   Plus site-level utility/safety/environmental branches and per-company
   `fleet` (mobile equipment) and `shared_services` siblings.

3. **Operations** — cross-cutting operational records:

       enterprise.operations.{work_orders|technicians|inventory|compliance}.{...}

When a customer assigns a knowledge-base model to a site, the catalog
entity stays in `enterprise.knowledge_base.{mfr}.{family}.{model}` and
a NEW instance entity is created at the site path. They are linked via
an `INSTANCE_OF` relationship — never moved. Same model, multiple sites.

Path grammar (validated by the `uns_path_format` CHECK constraint):
- Lowercase only, labels are `[a-z0-9_]+`
- `.` is the path separator
- ltree's natural depth limit (256 segments) is far above what we use
"""

from __future__ import annotations

import re

_LABEL_RE = re.compile(r"^[a-z0-9_]+$")
_PATH_RE = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)*$")
_NON_LABEL_CHARS = re.compile(r"[^a-z0-9]+")

# Type-marker labels that must never be used as a manufacturer / model
# / instance slug — they are reserved for UNS structure. The slug helper
# returns these unchanged so collisions are caught at validation time
# rather than silently corrupting the tree.
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


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------


def slug(value: str) -> str:
    """Normalize a free-form string into a single ltree label.

    Lowercase, collapse runs of non-alphanumeric to `_`, strip leading/
    trailing `_`. Returns empty string if nothing usable remains — the
    caller MUST treat that as a signal not to produce a path segment.
    """
    if not value:
        return ""
    lowered = value.strip().lower()
    cleaned = _NON_LABEL_CHARS.sub("_", lowered).strip("_")
    return cleaned


def is_valid_path(path: str) -> bool:
    """True iff `path` matches the spec's path grammar."""
    return bool(_PATH_RE.match(path))


def is_valid_label(label: str) -> bool:
    return bool(_LABEL_RE.match(label))


def _join(*parts: str) -> str:
    """Join non-empty parts with dots, preserving order."""
    return ".".join(p for p in parts if p)


# ---------------------------------------------------------------------------
# Knowledge-base branch (manufacturer-organized catalog)
# ---------------------------------------------------------------------------


def kb_root() -> str:
    return "enterprise.knowledge_base"


def manufacturer_path(manufacturer: str | None) -> str:
    """`enterprise.knowledge_base.{mfr_slug}` or just kb_root if missing."""
    return _join(kb_root(), slug(manufacturer or ""))


def family_path(manufacturer: str | None, family: str | None) -> str:
    """`enterprise.knowledge_base.{mfr}.{family}` (collapses if family
    missing)."""
    return _join(manufacturer_path(manufacturer), slug(family or ""))


def model_path(
    manufacturer: str | None,
    model: str | None,
    family: str | None = None,
) -> str:
    """`enterprise.knowledge_base.{mfr}.{family?}.{model}`.

    The family segment is omitted when `family` is missing — depth
    becomes inconsistent across the kb tree, but ltree tolerates that
    and the skeleton resolver in the Hub treats anything under a
    manufacturer as either a family or a model interchangeably.
    """
    return _join(family_path(manufacturer, family), slug(model or ""))


def equipment_unassigned_path(
    manufacturer: str | None,
    model: str | None,
    family: str | None = None,
) -> str:
    """The default address for an equipment entity that has been
    discovered from a manual but not yet assigned to a site.

    Equivalent to `model_path()` — the kb model node IS the equipment
    catalog entry. Site-side instances live elsewhere and link back via
    `INSTANCE_OF` (see assigned_equipment_path).

    Falls back to `enterprise.knowledge_base` if both manufacturer and
    model are empty (a kb-orphan that the operator should triage).
    """
    p = model_path(manufacturer, model, family)
    return p if p != kb_root() else "enterprise.knowledge_base"


def manual_path(
    manufacturer: str | None,
    model: str | None,
    family: str | None = None,
    manual_slug: str | None = None,
) -> str:
    """Address for a manual document.

    With `manual_slug`: a specific manual, e.g.
        enterprise.knowledge_base.allen_bradley.powerflex.powerflex_525.manuals.user_manual_v3
    Without: the manuals collection node, e.g.
        enterprise.knowledge_base.allen_bradley.powerflex.powerflex_525.manuals
    """
    return _join(model_path(manufacturer, model, family), "manuals", slug(manual_slug or ""))


def fault_code_path(
    manufacturer: str | None,
    code: str,
    model: str | None = None,
    family: str | None = None,
) -> str:
    """Address for a fault code under a model (or under just a
    manufacturer if model is unknown — model-agnostic faults).

    With model:
        enterprise.knowledge_base.allen_bradley.powerflex.powerflex_525.fault_codes.f004
    Without model:
        enterprise.knowledge_base.allen_bradley.fault_codes.f004
    """
    if model:
        prefix = model_path(manufacturer, model, family)
    else:
        prefix = manufacturer_path(manufacturer)
    return _join(prefix, "fault_codes", slug(code))


def pm_schedule_path(
    manufacturer: str | None,
    model: str | None,
    pm_slug: str,
    family: str | None = None,
) -> str:
    return _join(model_path(manufacturer, model, family), "pm_schedules", slug(pm_slug))


def parts_list_path(
    manufacturer: str | None,
    model: str | None,
    part_slug: str,
    family: str | None = None,
) -> str:
    return _join(model_path(manufacturer, model, family), "parts_lists", slug(part_slug))


def community_class_path(equipment_class: str, leaf: str | None = None) -> str:
    """`enterprise.knowledge_base.community.{equipment_class}[.{leaf}]`.

    `leaf` is one of the literal sub-branches: `common_faults`,
    `mtbf_benchmarks`, `resolution_patterns` (or empty for the class
    node itself)."""
    base = _join(kb_root(), "community", slug(equipment_class))
    return _join(base, leaf or "")


# ---------------------------------------------------------------------------
# Per-company site hierarchy (ISA-95)
# ---------------------------------------------------------------------------


def company_root(company: str) -> str:
    return _join("enterprise", slug(company))


def site_path(company: str, site: str) -> str:
    return _join(company_root(company), "site", slug(site))


def area_path(company: str, site: str, area: str) -> str:
    return _join(site_path(company, site), "area", slug(area))


def line_path(company: str, site: str, area: str, line: str) -> str:
    return _join(area_path(company, site, area), "line", slug(line))


def work_cell_path(
    company: str, site: str, area: str, line: str, work_cell: str
) -> str:
    return _join(line_path(company, site, area, line), "work_cell", slug(work_cell))


def assigned_equipment_path(
    company: str,
    site: str,
    area: str,
    equipment_id: str,
    line: str | None = None,
    work_cell: str | None = None,
) -> str:
    """Build the site-side equipment instance path.

    Equipment can attach at three depths per Mike's directive:
    - In a work cell:  ...area.{a}.line.{l}.work_cell.{c}.equipment.{eq}
    - On a line:       ...area.{a}.line.{l}.equipment.{eq}            (no cell)
    - In an area:      ...area.{a}.equipment.{eq}                     (no line)
    """
    if line and work_cell:
        prefix = work_cell_path(company, site, area, line, work_cell)
    elif line:
        prefix = line_path(company, site, area, line)
    else:
        prefix = area_path(company, site, area)
    return _join(prefix, "equipment", slug(equipment_id))


def equipment_subnode_path(equipment_path_value: str, *segments: str) -> str:
    """Append literal/instance segments under an equipment instance.

    Example:
        equipment_subnode_path(eq_path, "component", "bearing_nde")
        → ...equipment.{eq}.component.bearing_nde
        equipment_subnode_path(eq_path, "maintenance", "pm_schedule", "monthly_lube")
    """
    return _join(equipment_path_value, *(slug(s) for s in segments))


def datapoint_path(equipment_path_value: str, tag_name: str) -> str:
    """Address for a live current-value datapoint under an equipment instance:

        ...equipment.{eq}.datapoint.{tag_name}

    This is the Walker-style real-time LIVE-STATE branch — it holds *current
    state only* (a tag's latest value + clock provenance). It is deliberately
    SEPARATE from the maintenance/history branch built by
    ``equipment_subnode_path(eq, "maintenance", …)`` (fault_history, work_orders,
    pm_schedules): durable maintenance knowledge lives in the KG under
    ``.maintenance.*`` / ``.documentation.*``; live datapoints live here under
    ``.datapoint.*``. Telemetry VALUES are not stored on ``kg_entities`` (see
    ``docs/specs/uns-kg-unification-spec.md`` §3.4); this builder only addresses
    the node. See ``docs/specs/realtime-datapoint-and-clock-source.md``.
    """
    return equipment_subnode_path(equipment_path_value, "datapoint", tag_name)


# ---------------------------------------------------------------------------
# Operations branch
# ---------------------------------------------------------------------------


def operations_root() -> str:
    return "enterprise.operations"


def work_order_path(wo_number: str) -> str:
    """`enterprise.operations.work_orders.{wo_slug}`."""
    return _join(operations_root(), "work_orders", slug(wo_number))


def technician_path(tech_id: str) -> str:
    return _join(operations_root(), "technicians", slug(tech_id))


def inventory_path(inventory_slug: str) -> str:
    return _join(operations_root(), "inventory", slug(inventory_slug))


def compliance_path(compliance_slug: str) -> str:
    return _join(operations_root(), "compliance", slug(compliance_slug))
