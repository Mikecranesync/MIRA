-- OEM manuals KB seed — garage devices (Micro820 / GS10 / RS-485)
-- Companion to tools/seeds/oem-manuals/chunks.jsonl + apply_oem_seed.py
--
-- WHAT THIS FILE IS:
--   Human-readable record of the chunks this seed will insert. The actual ingest
--   is performed by apply_oem_seed.py (because nomic-embed-text embeddings must
--   be computed against Bravo's Ollama at LAN 192.168.1.11:11434 — pure SQL can't
--   reach Ollama).
--
-- WHY NOT JUST RUN THIS SQL:
--   Each chunk's `embedding` column is NULL here. NULL embeddings are invisible
--   to vector_cosine_ops similarity search — the RAG retrieval would never
--   surface them. apply_oem_seed.py embeds each chunk before inserting.
--
-- WHEN TO USE THIS SQL DIRECTLY:
--   - You want to review the chunks in PR (this file is the human-readable form).
--   - You're operating in a disaster-recovery mode and need to backfill text-only
--     entries that will be re-embedded later via tools/kb_backfill_metadata.py.
--   - You're loading into a non-Neon test DB that doesn't have the vector extension.
--
-- AUDIT (2026-05-15) — what's already in NeonDB tenant 78917b56-…-6cd6c3:
--   Total chunks:               83,542
--   Rockwell PowerFlex series:  ~12,000 (full coverage)
--   AutomationDirect any:       ~3,500
--   GS10 model_number='GS10':   7 chunks, 0 embedded   ← INVISIBLE to RAG
--   GS11 model_number='GS11':   7 chunks, 0 embedded   ← INVISIBLE to RAG
--   Micro820 field-guide:       14 chunks, 0 embedded  ← INVISIBLE to RAG
--   Gaps confirmed via audit:
--     - GS10 fault oc-d (deceleration overcurrent)
--     - Micro800 MSG ErrorID 55 (timeout)
--     - Micro800 MSG ErrorID 255 (never-completed)
--     - CCW "embedded serial out of sync" troubleshooting
--     - CCW TCPIPObject download failure procedure
--
-- The 7 chunks below fill all 5 confirmed gaps and add depth on the wire-level
-- physical layer + decision tree for technicians at the panel.
--
-- Run via: doppler run -p factorylm -c prd -- \
--           python3 tools/seeds/oem-manuals/apply_oem_seed.py

BEGIN;

-- Chunk 1: GS10 complete fault code table
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number,
    content, embedding, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
    'oem_manual',
    'AutomationDirect',
    'GS10',
    chunks.content,
    NULL,  -- embedding deferred to apply_oem_seed.py
    'https://cdn.automationdirect.com/static/manuals/gs10m/ch6.pdf',
    0,
    chunks.meta::jsonb,
    false, true, 'fault_code_table', NOW()
FROM (VALUES (
    'See tools/seeds/oem-manuals/chunks.jsonl chunk_key=gs10-fault-codes-complete-2026-05-15 for full text. Loaded by apply_oem_seed.py.',
    '{"chunk_key":"gs10-fault-codes-complete-2026-05-15","document":"DURApulse GS10 AC Drive User Manual Ch6","applier":"tools/seeds/oem-manuals/apply_oem_seed.py"}'
)) AS chunks(content, meta)
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
      AND metadata->>'chunk_key' = 'gs10-fault-codes-complete-2026-05-15'
);

-- Chunk 2: GS10 Modbus RTU CE1-CE10 field fix matrix
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number,
    content, embedding, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
    'oem_manual',
    'AutomationDirect',
    'GS10',
    'See tools/seeds/oem-manuals/chunks.jsonl chunk_key=gs10-modbus-rtu-comm-faults-2026-05-15.',
    NULL,
    'https://cdn.automationdirect.com/static/manuals/gs10m/ch5.pdf',
    1,
    '{"chunk_key":"gs10-modbus-rtu-comm-faults-2026-05-15","document":"DURApulse GS10 AC Drive User Manual Ch5"}'::jsonb,
    false, true, 'troubleshooting', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
      AND metadata->>'chunk_key' = 'gs10-modbus-rtu-comm-faults-2026-05-15'
);

-- Chunk 3: Micro800 MSG_MODBUS ErrorID full table (covers 55 + 255 gaps)
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number,
    content, embedding, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
    'oem_manual',
    'Rockwell Automation',
    'Micro820',
    'See tools/seeds/oem-manuals/chunks.jsonl chunk_key=micro800-msg-modbus-errorid-table-2026-05-15.',
    NULL,
    'https://www.rockwellautomation.com/en-us/docs/factorytalk-design-workbench/1-00-00/ftdw-help-ditamap/micro800-controller/micro800-instruction-set/messaging-instructions/msg_modbus.html',
    2,
    '{"chunk_key":"micro800-msg-modbus-errorid-table-2026-05-15","document":"FactoryTalk Design Workbench Help — MSG_MODBUS","topic":"msg_modbus_errors"}'::jsonb,
    false, true, 'instruction_reference', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
      AND metadata->>'chunk_key' = 'micro800-msg-modbus-errorid-table-2026-05-15'
);

-- Chunk 4: Micro800 MODBUSLOCPARA / MODBUSTARPARA data type reference
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number,
    content, embedding, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
    'oem_manual',
    'Rockwell Automation',
    'Micro820',
    'See tools/seeds/oem-manuals/chunks.jsonl chunk_key=micro800-modbuslocpara-tarpara-2026-05-15.',
    NULL,
    'https://www.rockwellautomation.com/en-us/docs/factorytalk-design-workbench/1-00-00/ftdw-help-ditamap/micro800-controller/micro800-instruction-set/messaging-instructions/msg_modbus/modbuslocpara-data-type.html',
    3,
    '{"chunk_key":"micro800-modbuslocpara-tarpara-2026-05-15","document":"FactoryTalk Design Workbench Help — MODBUSLOCPARA + MODBUSTARPARA"}'::jsonb,
    false, true, 'instruction_reference', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
      AND metadata->>'chunk_key' = 'micro800-modbuslocpara-tarpara-2026-05-15'
);

-- Chunk 5: CCW "embedded serial out of sync" + TCPIPObject download failure
-- (covers BOTH remaining gaps)
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number,
    content, embedding, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
    'troubleshooting_playbook',
    'Rockwell Automation',
    'Micro820',
    'See tools/seeds/oem-manuals/chunks.jsonl chunk_key=ccw-embedded-serial-out-of-sync-2026-05-15.',
    NULL,
    'https://github.com/Mikecranesync/MIRA/blob/main/plc/RESUME_VFD_COMMISSIONING.md',
    4,
    '{"chunk_key":"ccw-embedded-serial-out-of-sync-2026-05-15","document":"MIRA Garage RS-485 Commissioning Blocker","topic":"ccw_download_failure"}'::jsonb,
    false, true, 'troubleshooting', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
      AND metadata->>'chunk_key' = 'ccw-embedded-serial-out-of-sync-2026-05-15'
);

-- Chunk 6: RS-485 wiring & termination (Micro820 ↔ GS10)
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number,
    content, embedding, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
    'field_guide',
    'AutomationDirect',
    'GS10',
    'See tools/seeds/oem-manuals/chunks.jsonl chunk_key=garage-rs485-wiring-and-termination-2026-05-15.',
    NULL,
    'https://github.com/Mikecranesync/MIRA/blob/main/plc/GS10_Integration_Guide.md',
    5,
    '{"chunk_key":"garage-rs485-wiring-and-termination-2026-05-15","topic":"rs485_physical_layer"}'::jsonb,
    false, true, 'wiring_reference', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
      AND metadata->>'chunk_key' = 'garage-rs485-wiring-and-termination-2026-05-15'
);

-- Chunk 7: Modbus RTU protocol quick reference
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number,
    content, embedding, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
    'protocol_spec',
    'Modbus Organization',
    'RTU',
    'See tools/seeds/oem-manuals/chunks.jsonl chunk_key=modbus-rtu-protocol-quick-reference-2026-05-15.',
    NULL,
    'https://modbus.org/docs/Modbus_over_serial_line_V1.pdf',
    6,
    '{"chunk_key":"modbus-rtu-protocol-quick-reference-2026-05-15","topic":"modbus_rtu_protocol"}'::jsonb,
    false, true, 'protocol_reference', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
      AND metadata->>'chunk_key' = 'modbus-rtu-protocol-quick-reference-2026-05-15'
);

-- Chunk 8: Garage commissioning decision tree (top-level entry point)
INSERT INTO knowledge_entries (
    id, tenant_id, source_type, manufacturer, model_number,
    content, embedding, source_url, source_page, metadata,
    is_private, verified, chunk_type, created_at
)
SELECT
    gen_random_uuid(),
    '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',
    'field_playbook',
    'MIRA',
    'Garage-RS485',
    'See tools/seeds/oem-manuals/chunks.jsonl chunk_key=garage-commissioning-decision-tree-2026-05-15.',
    NULL,
    'https://github.com/Mikecranesync/MIRA/blob/main/plc/GS10_Integration_Guide.md',
    7,
    '{"chunk_key":"garage-commissioning-decision-tree-2026-05-15","topic":"commissioning_triage"}'::jsonb,
    false, true, 'decision_tree', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_entries
    WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
      AND metadata->>'chunk_key' = 'garage-commissioning-decision-tree-2026-05-15'
);

COMMIT;

-- After running this SQL (which leaves embedding=NULL on all 8 rows), embeddings
-- must be computed:
--   doppler run -p factorylm -c prd -- \
--     python3 tools/seeds/oem-manuals/apply_oem_seed.py --skip-new --skip-backfill
-- OR (preferred — does everything in one pass with idempotency + dedup):
--   doppler run -p factorylm -c prd -- \
--     python3 tools/seeds/oem-manuals/apply_oem_seed.py
