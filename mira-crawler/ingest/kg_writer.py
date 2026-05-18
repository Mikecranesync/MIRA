"""Idempotent KG entity / relationship upserts.

All KG writes from any path (Celery worker, backfill, manual ingest CLI,
admin tools) must go through these helpers so the spec's invariants hold:

- `kg_entities` UNIQUE (tenant_id, entity_type, name) → ON CONFLICT DO NOTHING
  on insert, then SELECT to obtain the canonical id.
- `kg_relationships` UNIQUE (tenant_id, source_entity, target_entity,
  relation_type) → same pattern.
- Every entity carries a non-NULL `uns_path` (spec §3.1, Phase 3).
- Path grammar is enforced both at the application layer (uns.is_valid_path)
  and at the database layer (CHECK constraint added in migration 008).

The helpers accept an optional SQLAlchemy connection so a caller running
inside a transaction can keep the upserts in the same unit of work; if
omitted, the helpers manage their own connection + commit.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Generator
from contextlib import contextmanager
from uuid import UUID

from .uns import (
    equipment_unassigned_path,
    fault_code_path,
    is_valid_path,
    manual_path,
)

logger = logging.getLogger("mira-crawler.kg_writer")


# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------


def _engine():
    """Lazy-import the engine factory so this module is importable without
    NEON_DATABASE_URL set (e.g. during unit tests of pure-Python helpers)."""
    from .store import _engine as store_engine

    return store_engine()


@contextmanager
def _get_conn(conn=None) -> Generator:
    """Yield a connection. If the caller passed one, reuse it without
    committing — they own the transaction. Otherwise open one and commit
    on success."""
    if conn is not None:
        yield conn
        return
    with _engine().connect() as new_conn:
        try:
            yield new_conn
            new_conn.commit()
        except Exception:
            new_conn.rollback()
            raise


# ---------------------------------------------------------------------------
# Entity upserts
# ---------------------------------------------------------------------------


def upsert_entity(
    tenant_id: str,
    entity_type: str,
    name: str,
    uns_path: str,
    properties: dict | None = None,
    source_chunk_id: str | UUID | None = None,
    conn=None,
) -> str | None:
    """Insert (or fetch existing) a kg_entities row. Returns the entity id
    as a string, or None on hard failure.

    Idempotent: re-calling with the same (tenant_id, entity_type, name)
    returns the original id. Properties are merged on conflict — existing
    keys win unless this call provides a non-NULL replacement.
    """
    from sqlalchemy import text

    if not name or not entity_type:
        logger.debug("upsert_entity skipped: empty name or type")
        return None

    if not is_valid_path(uns_path):
        logger.warning(
            "upsert_entity rejected invalid uns_path=%r for %s/%s",
            uns_path,
            entity_type,
            name,
        )
        return None

    props_json = json.dumps(properties or {})
    src_chunk = str(source_chunk_id) if source_chunk_id else None

    try:
        with _get_conn(conn) as c:
            row = c.execute(
                text("""
                    INSERT INTO kg_entities
                        (tenant_id, entity_type, name, properties,
                         source_chunk_id, uns_path)
                    VALUES
                        (:tenant_id, :entity_type, :name,
                         cast(:properties AS jsonb),
                         cast(:source_chunk_id AS uuid),
                         cast(:uns_path AS ltree))
                    ON CONFLICT (tenant_id, entity_type, name) DO UPDATE
                        SET properties = COALESCE(kg_entities.properties, '{}'::jsonb)
                                       || EXCLUDED.properties
                    RETURNING id
                """),
                {
                    "tenant_id": tenant_id,
                    "entity_type": entity_type,
                    "name": name,
                    "properties": props_json,
                    "source_chunk_id": src_chunk,
                    "uns_path": uns_path,
                },
            ).first()
            return str(row[0]) if row else None
    except Exception as e:
        logger.error("upsert_entity failed for %s/%s: %s", entity_type, name, e)
        return None


def upsert_relationship(
    tenant_id: str,
    source_entity: str | UUID,
    target_entity: str | UUID,
    relation_type: str,
    confidence: float = 1.0,
    properties: dict | None = None,
    source_chunk_id: str | UUID | None = None,
    conn=None,
) -> str | None:
    """Insert (or fetch existing) a kg_relationships row. Returns the
    relationship id as a string, or None on hard failure."""
    from sqlalchemy import text

    if not source_entity or not target_entity or not relation_type:
        return None
    if str(source_entity) == str(target_entity):
        logger.debug("upsert_relationship skipped self-edge %s", source_entity)
        return None

    props_json = json.dumps(properties or {})
    src_chunk = str(source_chunk_id) if source_chunk_id else None

    try:
        with _get_conn(conn) as c:
            row = c.execute(
                text("""
                    INSERT INTO kg_relationships
                        (tenant_id, source_entity, target_entity,
                         relation_type, properties, confidence,
                         source_chunk_id)
                    VALUES
                        (:tenant_id, :source, :target, :rel,
                         cast(:properties AS jsonb), :confidence,
                         cast(:source_chunk_id AS uuid))
                    ON CONFLICT
                        (tenant_id, source_entity, target_entity, relation_type)
                    DO UPDATE SET
                        confidence = GREATEST(kg_relationships.confidence,
                                              EXCLUDED.confidence)
                    RETURNING id
                """),
                {
                    "tenant_id": tenant_id,
                    "source": str(source_entity),
                    "target": str(target_entity),
                    "rel": relation_type,
                    "properties": props_json,
                    "confidence": confidence,
                    "source_chunk_id": src_chunk,
                },
            ).first()
            return str(row[0]) if row else None
    except Exception as e:
        logger.error(
            "upsert_relationship failed %s -[%s]-> %s: %s",
            source_entity,
            relation_type,
            target_entity,
            e,
        )
        return None


# ---------------------------------------------------------------------------
# High-level convenience: register an equipment + its manual together
# ---------------------------------------------------------------------------


def register_equipment_and_manual(
    tenant_id: str,
    manufacturer: str,
    model: str,
    manual_title: str | None = None,
    manual_url: str | None = None,
    family: str | None = None,
    source_chunk_id: str | UUID | None = None,
    conn=None,
) -> tuple[str | None, str | None]:
    """Upsert an `equipment` entity (the catalog/model node in the
    knowledge_base branch), a `manual` entity, and a HAS_MANUAL edge.
    All idempotent. Returns (equipment_id, manual_id).

    Per the broadened spec, the equipment node lives at
        enterprise.knowledge_base.{mfr}.{family?}.{model}
    NOT at enterprise.unassigned.* — equipment learned from manuals
    permanently lives in the manufacturer-organized catalog. Site-side
    instances are linked back to this catalog node via INSTANCE_OF when
    the user assigns the model to a physical location.
    """

    eq_path = equipment_unassigned_path(manufacturer, model, family=family)
    eq_id = upsert_entity(
        tenant_id=tenant_id,
        entity_type="equipment",
        name=model,
        uns_path=eq_path,
        properties={
            "manufacturer": manufacturer,
            "family": family,
            "catalog_node": True,
        },
        source_chunk_id=source_chunk_id,
        conn=conn,
    )
    if not eq_id:
        return None, None

    title = manual_title or f"{manufacturer} {model} Manual"
    # Manuals live as children of the model node; encode the title slug
    # so two distinct manuals (user manual + service manual) don't
    # collide on the parent collection node.
    from .uns import slug as _slug

    man_id = upsert_entity(
        tenant_id=tenant_id,
        entity_type="manual",
        name=title,
        uns_path=manual_path(
            manufacturer, model, family=family, manual_slug=_slug(title)
        ),
        properties={
            "manufacturer": manufacturer,
            "family": family,
            "model": model,
            "source_url": manual_url,
        },
        source_chunk_id=source_chunk_id,
        conn=conn,
    )

    if man_id:
        upsert_relationship(
            tenant_id=tenant_id,
            source_entity=eq_id,
            target_entity=man_id,
            relation_type="has_manual",
            confidence=0.95,
            source_chunk_id=source_chunk_id,
            conn=conn,
        )

    return eq_id, man_id


def register_fault_code(
    tenant_id: str,
    equipment_id: str | UUID,
    manufacturer: str,
    fault_code: str,
    model: str | None = None,
    family: str | None = None,
    confidence: float = 0.85,
    source_chunk_id: str | UUID | None = None,
    conn=None,
) -> str | None:
    """Upsert a `fault_code` entity tied to an existing `equipment` via a
    HAS_FAULT edge. Returns the fault entity id.

    The fault lives under its model in the kb tree when model is
    provided, otherwise directly under the manufacturer (a model-agnostic
    fault). Either way, the HAS_FAULT edge ties it to the specific
    equipment entity that was the carrier of this extraction so the bot
    can ask "what faults exist on PowerFlex 525?" via graph traversal.
    """
    name = f"{manufacturer} / {fault_code}".strip(" /")
    fc_id = upsert_entity(
        tenant_id=tenant_id,
        entity_type="fault_code",
        name=name,
        uns_path=fault_code_path(manufacturer, fault_code, model=model, family=family),
        properties={
            "manufacturer": manufacturer,
            "family": family,
            "model": model,
            "code": fault_code,
        },
        source_chunk_id=source_chunk_id,
        conn=conn,
    )
    if not fc_id:
        return None

    upsert_relationship(
        tenant_id=tenant_id,
        source_entity=equipment_id,
        target_entity=fc_id,
        relation_type="has_fault",
        confidence=confidence,
        source_chunk_id=source_chunk_id,
        conn=conn,
    )
    return fc_id


# ---------------------------------------------------------------------------
# Bridge: stamp a knowledge_entries row with its equipment_entity_id
# ---------------------------------------------------------------------------


def link_chunk_to_equipment(
    chunk_id: str | UUID,
    equipment_entity_id: str | UUID,
    conn=None,
) -> bool:
    """Set knowledge_entries.equipment_entity_id. Returns True on success."""
    from sqlalchemy import text

    try:
        with _get_conn(conn) as c:
            c.execute(
                text("""
                    UPDATE knowledge_entries
                       SET equipment_entity_id = cast(:eid AS uuid)
                     WHERE id = cast(:cid AS uuid)
                       AND equipment_entity_id IS DISTINCT FROM cast(:eid AS uuid)
                """),
                {"eid": str(equipment_entity_id), "cid": str(chunk_id)},
            )
        return True
    except Exception as e:
        logger.error("link_chunk_to_equipment failed: %s", e)
        return False
