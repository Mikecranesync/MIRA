"""Connector import endpoint — wires IgnitionMockConnector → import_and_propose → NeonDB.

Phase 2a of the Ignition tag-mapper plan.
Plan: docs/plans/2026-06-15-ignition-tag-mapper-implementation.md §Phase 2

A thin FastAPI router mounted in main.py. The Hub proxy route
(mira-hub/src/app/api/connectors/ignition/import/route.ts) calls this
endpoint, passing `tenant_id` from the authenticated session.

Route: POST /v1/connectors/ignition/import
Auth : None at this layer — callers are expected to be internal
       (Hub route validates sessionOr401 before proxying).
"""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("mira-connector-import")
router = APIRouter()

NEON_DATABASE_URL = os.getenv("NEON_DATABASE_URL", "")


class ConnectorImportRequest(BaseModel):
    tenant_id: str
    connector_type: str = "mock"
    record_types: list[str] = ["asset", "tag"]
    limit: int = 500


class ConnectorImportResponse(BaseModel):
    ok: bool
    provider: str
    proposals_created: int
    record_count: int
    relationship_count: int
    entity_suggestion_ids: list[str] = []
    edge_suggestion_ids: list[str] = []


@router.post("/v1/connectors/ignition/import", response_model=ConnectorImportResponse)
async def connector_ignition_import(body: ConnectorImportRequest) -> ConnectorImportResponse:
    """Import Ignition tags (mock or file-backed) and write pending ai_suggestions rows.

    Returns proposal counts. The connector writes proposals only — no KG writes.
    ADR-0017: every import-originated mapping lands as 'pending' for human review.
    """
    if not NEON_DATABASE_URL:
        raise HTTPException(status_code=503, detail="NEON_DATABASE_URL not configured")

    # Validate tenant_id is UUID-shaped (matches Hub session enforcement).
    import re

    if not re.match(r"^[0-9a-f-]{36}$", body.tenant_id, re.I):
        raise HTTPException(status_code=400, detail="tenant_id must be a UUID")

    try:
        from mira_connectors.base import ConnectorConfig
        from mira_connectors.canonical import RecordType
        from mira_connectors.confirmation_gate import ConnectorConfirmationGate
        from mira_connectors.mocks.ignition_mock import IgnitionMockConnector
        from mira_connectors.service import import_and_propose
        from mira_connectors.store import PostgresProposalStore
    except ImportError as exc:
        logger.error("mira-connectors package not installed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="mira-connectors not installed in this environment",
        )

    # Map string record-type names to RecordType enum values.
    rt_by_value = {rt.value: rt for rt in RecordType}
    record_types = [rt_by_value[rt] for rt in body.record_types if rt in rt_by_value]
    if not record_types:
        raise HTTPException(
            status_code=400,
            detail=f"no valid record_types; valid values: {list(rt_by_value)}",
        )

    config = ConnectorConfig(tenant_id=body.tenant_id)
    connector = IgnitionMockConnector(config)
    store = PostgresProposalStore(NEON_DATABASE_URL)
    gate = ConnectorConfirmationGate(store)

    try:
        result = await import_and_propose(
            connector,
            gate,
            record_types=record_types,
            tenant_id=body.tenant_id,
            limit=body.limit,
        )
    except Exception as exc:
        logger.error("import_and_propose failed for tenant %s: %s", body.tenant_id, exc)
        raise HTTPException(status_code=500, detail=f"import failed: {exc}")

    entity_ids: list[str] = []
    edge_ids: list[str] = []
    if result.propose:
        entity_ids = result.propose.entity_suggestion_ids
        edge_ids = result.propose.edge_suggestion_ids

    proposals_created = len(entity_ids) + len(edge_ids)
    logger.info(
        "connector_import tenant=%s provider=%s records=%d proposals=%d",
        body.tenant_id,
        result.provider,
        result.record_count,
        proposals_created,
    )

    return ConnectorImportResponse(
        ok=True,
        provider=result.provider,
        proposals_created=proposals_created,
        record_count=result.record_count,
        relationship_count=result.relationship_count,
        entity_suggestion_ids=entity_ids,
        edge_suggestion_ids=edge_ids,
    )
