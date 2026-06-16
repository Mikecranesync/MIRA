"""Tenant-scoped namespace resolver for the UNS Confirmation Gate.

Spec: docs/plans/2026-05-14-demo-backend-plan.md (Phase 6 of the
2026-05-15 PR).

The existing UNS resolver in `uns_resolver.py` is the right call for
generic diagnostic turns — it extracts manufacturer + model from message
text via alias tables and is shared across every tenant in production.
But the May 21 tablet demo asks for a more specific behavior:

    User: "I'm working on Conveyor 001 and PE-001 isn't reading"
    MIRA:  "Confirm: troubleshooting **Conveyor 001 / PE-001** at
            enterprise.demo.site.lake_wales..."

For that exact pattern, we want the gate to match against the *tenant's*
known assets and components — not the global vendor alias table. This
helper performs that lookup against `kg_entities` (for asset tags + names)
and `installed_component_instances` (for component names + aliases).

It is intentionally additive: `uns_resolver.py` is untouched. Engine code
calls this *before* the generic gate prompt, and only falls through to
the manufacturer/model prompt if no tenant-scoped hit is found.

Sync sqlalchemy with NullPool, never raises — matches the pattern in
`neon_recall.kb_has_coverage`.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import asdict, dataclass
from typing import Any

logger = logging.getLogger("mira-gsd")

# Asset / component tag pattern. Matches:
#   PE-001, MTR-001, VFD-001, PLC-001, PANEL-001, CV-001, etc.
# Two-to-five uppercase letters, optional dash, two-to-four digits.
# Case-insensitive at match time; normalized to upper for the DB lookup.
#
# Deliberately permissive — "ID-001", "OF24", etc. all match here. The
# DB lookup is the filter (no row → None) so false-positive candidates
# never reach the gate prompt. Don't tighten this without checking what
# real asset-tag conventions tenants use.
_TAG_RE = re.compile(r"\b([A-Z]{2,5}-?\d{2,4})\b", re.IGNORECASE)

# Common asset-name patterns ("Conveyor 001", "Line A", "Mixer 7").
# Matches title-cased noun + integer. Cheap heuristic; the DB filter is
# the source of truth.
_NAME_RE = re.compile(
    r"\b("
    r"Conveyor|Mixer|Pump|Compressor|Boiler|Chiller|Reactor|"
    r"Press|Mill|Lathe|Grinder|Saw|Welder|Robot|"
    r"Packer|Palletizer|Wrapper|Filler|Capper|Labeler|"
    r"Oven|Cooler|Freezer|Dryer|Heater|"
    r"Line|Cell|Station|Bay"
    r")\s+\d{1,4}\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class DemoNamespaceMatch:
    asset_id: str | None = None
    asset_name: str | None = None
    asset_tag: str | None = None
    component_id: str | None = None
    component_name: str | None = None
    component_plc_tag: str | None = None
    matched_terms: tuple[str, ...] = ()
    confidence: float = 0.0
    uns_path: str | None = None

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["matched_terms"] = list(self.matched_terms)
        return d


def _extract_candidates(message: str) -> tuple[list[str], list[str]]:
    """Return (tag_candidates, name_candidates) from the message.

    Tag candidates are normalized to uppercase. Name candidates are kept
    in their original case for ILIKE matching against `kg_entities.name`.
    """
    tags = sorted({m.group(1).upper() for m in _TAG_RE.finditer(message)})
    names = sorted({m.group(0) for m in _NAME_RE.finditer(message)})
    return tags, names


def resolve_demo_namespace(
    message: str,
    tenant_id: str | None,
) -> DemoNamespaceMatch | None:
    """Look up asset / component by tag or name mentioned in `message`.

    Returns None when:
      - no tenant_id (we never run this against the global pool),
      - no NEON_DATABASE_URL,
      - sqlalchemy is missing,
      - the query fails,
      - or no candidate tag/name appears in the message,
      - or no row matches.

    Match precedence:
      1. component_name / aliases exact (PE-001 → installed_component_instances)
      2. kg_entities asset_tag exact   (CV-001 → equipment row)
      3. kg_entities name ILIKE        ("Conveyor 001")

    When both an asset and a component are matched, both ids land on the
    return value so the engine can prefill the gate with the most specific
    context.
    """
    if not tenant_id or not message:
        return None
    if not os.environ.get("NEON_DATABASE_URL"):
        return None

    tags, names = _extract_candidates(message)
    if not tags and not names:
        return None

    try:
        from sqlalchemy import create_engine, text  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415
    except ImportError:
        logger.debug("DEMO_NAMESPACE sqlalchemy not installed")
        return None

    try:
        engine = create_engine(
            os.environ["NEON_DATABASE_URL"],
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.connect() as conn:
            # 1. Component by name or alias.
            component_row = None
            if tags:
                # Component names like "PE-001" sit in
                # installed_component_instances.component_name (or aliases).
                result = conn.execute(
                    text(
                        """
                        SELECT i.id, i.component_name, i.plc_tag, i.asset_id,
                               i.canonical_name,
                               asset.name AS asset_name,
                               asset.properties->>'asset_tag' AS asset_tag,
                               asset.uns_path::text AS uns_path
                          FROM installed_component_instances i
                          LEFT JOIN kg_entities asset ON asset.id = i.asset_id
                         WHERE i.tenant_id = :tid
                           AND (
                                UPPER(i.component_name) = ANY(:tags)
                             OR UPPER(i.canonical_name) = ANY(:tags)
                             OR EXISTS (
                                  SELECT 1 FROM unnest(i.aliases) a
                                   WHERE UPPER(a) = ANY(:tags)
                                )
                           )
                         LIMIT 1
                        """
                    ),
                    {"tid": tenant_id, "tags": tags},
                ).fetchone()
                if result:
                    component_row = dict(result._mapping)

            # 2. Asset by asset_tag (cheap exact match on properties JSONB).
            asset_row = None
            if component_row and component_row.get("asset_id"):
                asset_row = {
                    "id": component_row["asset_id"],
                    "name": component_row.get("asset_name"),
                    "asset_tag": component_row.get("asset_tag"),
                    "uns_path": component_row.get("uns_path"),
                }
            elif tags:
                ar = conn.execute(
                    text(
                        """
                        SELECT id, name,
                               properties->>'asset_tag' AS asset_tag,
                               uns_path::text AS uns_path
                          FROM kg_entities
                         WHERE tenant_id = :tid
                           AND entity_type = 'equipment'
                           AND UPPER(properties->>'asset_tag') = ANY(:tags)
                         LIMIT 1
                        """
                    ),
                    {"tid": tenant_id, "tags": tags},
                ).fetchone()
                if ar:
                    asset_row = dict(ar._mapping)

            # 3. Asset by name ILIKE (when nothing matched on tag).
            if asset_row is None and names:
                for candidate in names:
                    ar = conn.execute(
                        text(
                            """
                            SELECT id, name,
                                   properties->>'asset_tag' AS asset_tag,
                                   uns_path::text AS uns_path
                              FROM kg_entities
                             WHERE tenant_id = :tid
                               AND entity_type = 'equipment'
                               AND name ILIKE :name
                             LIMIT 1
                            """
                        ),
                        {"tid": tenant_id, "name": candidate},
                    ).fetchone()
                    if ar:
                        asset_row = dict(ar._mapping)
                        break
    except Exception as exc:  # noqa: BLE001 — never raise
        logger.info("DEMO_NAMESPACE lookup failed: %s", exc)
        return None

    if asset_row is None and component_row is None:
        return None

    matched: list[str] = []
    if component_row:
        matched.append(component_row.get("component_name") or "")
    if asset_row and asset_row.get("asset_tag"):
        if asset_row["asset_tag"] not in matched:
            matched.append(asset_row["asset_tag"])
    elif asset_row and asset_row.get("name"):
        if asset_row["name"] not in matched:
            matched.append(asset_row["name"])

    # Confidence:
    #   1.0 — exact tag match on component  AND its asset resolved
    #   0.9 — exact tag match on asset only
    #   0.8 — component matched (no parent asset somehow — defensive)
    #   0.7 — asset matched by name ILIKE
    if component_row and asset_row:
        conf = 1.0
    elif asset_row and tags:
        conf = 0.9
    elif component_row:
        conf = 0.8
    else:
        conf = 0.7

    return DemoNamespaceMatch(
        asset_id=(asset_row or {}).get("id"),
        asset_name=(asset_row or {}).get("name"),
        asset_tag=(asset_row or {}).get("asset_tag"),
        component_id=(component_row or {}).get("id"),
        component_name=(component_row or {}).get("component_name"),
        component_plc_tag=(component_row or {}).get("plc_tag"),
        matched_terms=tuple(t for t in matched if t),
        confidence=conf,
        uns_path=(asset_row or {}).get("uns_path"),
    )
