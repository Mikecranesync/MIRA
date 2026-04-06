-- Migration 001: knowledge_entries table
-- Status: ALREADY EXISTS in NeonDB (created ad-hoc, never versioned)
-- This file documents the as-built schema inferred from:
--   mira-core/mira-ingest/db/neon.py (insert_knowledge_entry, recall_knowledge)
--   mira-bots/shared/neon_recall.py (recall_knowledge, _like_search, _product_search)
--
-- Run: Only if recreating from scratch. Production table already has 25,219+ rows.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_entries (
    id              UUID PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    source_type     TEXT,
    manufacturer    TEXT,
    model_number    TEXT,
    equipment_type  TEXT,
    content         TEXT NOT NULL,
    embedding       vector(768),
    source_url      TEXT,
    source_page     INTEGER,           -- stores chunk_index, not PDF page number
    metadata        JSONB,
    is_private      BOOLEAN DEFAULT false,
    verified        BOOLEAN DEFAULT false,
    chunk_type      TEXT,
    created_at      TIMESTAMP DEFAULT now()
);

-- pgvector approximate nearest neighbor index
CREATE INDEX IF NOT EXISTS knowledge_entries_embedding_idx
    ON knowledge_entries USING ivfflat (embedding vector_cosine_ops);

-- Tenant scoping (all queries filter by tenant_id)
CREATE INDEX IF NOT EXISTS knowledge_entries_tenant_idx
    ON knowledge_entries (tenant_id);

-- Dedup guard used by knowledge_entry_exists()
CREATE INDEX IF NOT EXISTS knowledge_entries_dedup_idx
    ON knowledge_entries (tenant_id, source_url, source_page);
