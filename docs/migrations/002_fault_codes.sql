-- Migration 002: fault_codes table (Phase 3A)
-- Status: ALREADY EXISTS in NeonDB (created 2026-03-27 via psql)
-- Schema from: docs/wip/phase3-structured-retrieval/design.md
-- Read path:   mira-bots/shared/neon_recall.py (recall_fault_code)
-- Write path:  mira-core/scripts/extract_fault_codes.py (_insert_fault_code)

CREATE TABLE IF NOT EXISTS fault_codes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        TEXT NOT NULL,
    code             TEXT NOT NULL,
    description      TEXT NOT NULL,
    cause            TEXT,
    action           TEXT,
    severity         TEXT,
    equipment_model  TEXT,
    manufacturer     TEXT,
    source_chunk_id  TEXT,
    source_url       TEXT,
    page_num         INTEGER,
    created_at       TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, code, equipment_model)
);

CREATE INDEX IF NOT EXISTS fault_codes_tenant_code_idx
    ON fault_codes (tenant_id, code);

CREATE INDEX IF NOT EXISTS fault_codes_tenant_model_idx
    ON fault_codes (tenant_id, equipment_model);
