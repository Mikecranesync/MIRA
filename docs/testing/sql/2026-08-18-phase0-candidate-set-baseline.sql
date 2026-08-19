-- Phase 0 baseline measurement for #3177 / docs/plans/2026-08-17-corpus-candidate-set-repair-prd.md
-- READ-ONLY. Run against STAGING ONLY (factorylm/stg). Never prod from a session
-- (docs/environments.md hard rule #1; prod read-only inspection goes through
-- .github/workflows/db-inspect.yml).
--
--   doppler run --project factorylm --config stg -- sh -c \
--     'psql "$NEON_DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=1 \
--        -f docs/testing/sql/2026-08-18-phase0-candidate-set-baseline.sql'

BEGIN;
SET TRANSACTION READ ONLY;

\echo === P0.0 connection identity + corpus size ===
SELECT current_user, current_database(), count(*) AS knowledge_entries_rows FROM knowledge_entries;

\echo
\echo === P0.1 per-manufacturer tagging health (treatment vs control) ===
SELECT
  manufacturer,
  count(*)                                                               AS total_rows,
  count(*) FILTER (WHERE model_number IS NULL OR btrim(model_number)='') AS blank_model,
  round(100.0 * count(*) FILTER (WHERE model_number IS NULL OR btrim(model_number)='')
        / nullif(count(*),0), 1)                                         AS pct_blank,
  count(DISTINCT nullif(btrim(model_number),''))                         AS distinct_models,
  count(*) FILTER (WHERE embedding IS NOT NULL)                          AS embedded_rows
FROM knowledge_entries
WHERE manufacturer IN ('AutomationDirect','Rockwell Automation','Allen-Bradley')
GROUP BY manufacturer
ORDER BY total_rows DESC;

\echo
\echo === P0.2 model_number distribution, AutomationDirect (treatment) ===
SELECT coalesce(nullif(btrim(model_number),''),'(blank)') AS model_number, count(*) AS rows
FROM knowledge_entries WHERE manufacturer='AutomationDirect'
GROUP BY 1 ORDER BY rows DESC;

\echo
\echo === P0.3 model_number distribution, Rockwell Automation (control) ===
SELECT coalesce(nullif(btrim(model_number),''),'(blank)') AS model_number, count(*) AS rows
FROM knowledge_entries WHERE manufacturer='Rockwell Automation'
GROUP BY 1 ORDER BY rows DESC;

\echo
\echo === P0.4 CONTROL-GROUP GATE: is PF525 correctly tagged? ===
SELECT
  count(*) FILTER (WHERE model_number ILIKE '%PowerFlex 525%') AS pf525_tagged_rows,
  count(*) FILTER (WHERE content     ILIKE '%PowerFlex 525%')  AS pf525_content_rows,
  count(*) FILTER (WHERE source_url  ILIKE '%520-um001%')      AS pf525_manual_url_rows
FROM knowledge_entries;

\echo
\echo === P0.5 GS10 tagging (treatment) ===
SELECT
  count(*) FILTER (WHERE model_number ILIKE '%GS10%') AS gs10_tagged_rows,
  count(*) FILTER (WHERE content     ILIKE '%GS10%')  AS gs10_content_rows,
  count(*) FILTER (WHERE source_url  ILIKE '%gs10%')  AS gs10_source_url_rows
FROM knowledge_entries;

\echo
\echo === P0.6 _product_search candidate-set counts (neon_recall.py:535-558 predicates) ===
SELECT 'GS10' AS product, count(*) AS candidates
FROM knowledge_entries
WHERE is_private = false AND embedding IS NOT NULL
  AND model_number ILIKE '%GS10%'
  AND NOT (model_number ~* '(^|[^0-9A-Za-z])GS10[0-9A-Za-z]')
UNION ALL
SELECT 'PowerFlex 525', count(*)
FROM knowledge_entries
WHERE is_private = false AND embedding IS NOT NULL
  AND model_number ILIKE '%PowerFlex 525%'
  AND NOT (model_number ~* '(^|[^0-9A-Za-z])PowerFlex 525[0-9A-Za-z]');

\echo
\echo === P0.7 fault-clear phrase probe (#3177 five canonical phrasings) ===
SELECT
  manufacturer,
  count(*) FILTER (WHERE content ILIKE '%clear the fault by%')     AS p_clear_the_fault_by,
  count(*) FILTER (WHERE content ILIKE '%clears the fault queue%') AS p_clears_fault_queue,
  count(*) FILTER (WHERE content ILIKE '%acknowledge the fault%')  AS p_acknowledge_the_fault,
  count(*) FILTER (WHERE content ILIKE '%to reset the fault%')     AS p_to_reset_the_fault,
  count(*) FILTER (WHERE content ILIKE '%resetting a fault%')      AS p_resetting_a_fault,
  count(*) FILTER (WHERE content ILIKE '%clear the fault by%'
                      OR content ILIKE '%clears the fault queue%'
                      OR content ILIKE '%acknowledge the fault%'
                      OR content ILIKE '%to reset the fault%'
                      OR content ILIKE '%resetting a fault%')      AS any_fault_clear_phrase
FROM knowledge_entries
WHERE manufacturer IN ('AutomationDirect','Rockwell Automation','Allen-Bradley')
GROUP BY 1 ORDER BY any_fault_clear_phrase DESC;

\echo
\echo === P0.8 fault-clear rows scoped to the PF525 model tag ===
SELECT count(*) AS pf525_fault_clear_rows
FROM knowledge_entries
WHERE model_number ILIKE '%PowerFlex 525%'
  AND (content ILIKE '%clear the fault by%'
    OR content ILIKE '%clears the fault queue%'
    OR content ILIKE '%acknowledge the fault%'
    OR content ILIKE '%to reset the fault%'
    OR content ILIKE '%resetting a fault%');

\echo
\echo === P0.9 provenance of the blank-model AutomationDirect rows ===
SELECT coalesce(source_url,'(null)') AS source_url, source_type, count(*) AS rows,
       count(*) FILTER (WHERE metadata ? 'equipment_id') AS has_meta_equipment_id,
       min(metadata->>'equipment_id')                    AS sample_meta_equipment_id
FROM knowledge_entries
WHERE manufacturer='AutomationDirect' AND (model_number IS NULL OR btrim(model_number)='')
GROUP BY 1,2 ORDER BY rows DESC LIMIT 12;

\echo
\echo === P0.10 blast-radius floor: corpus-wide blank model_number ===
SELECT count(*) AS total_rows,
       count(*) FILTER (WHERE model_number IS NULL OR btrim(model_number)='') AS blank_model,
       round(100.0*count(*) FILTER (WHERE model_number IS NULL OR btrim(model_number)='')
             /count(*),1) AS pct_blank
FROM knowledge_entries;

\echo
\echo === P0.11 mechanism 2/3 corroboration: blank model_number vs equipment_entity_id ===
SELECT
  CASE WHEN model_number IS NULL OR btrim(model_number)='' THEN 'blank model_number'
       ELSE 'tagged model_number' END AS bucket,
  count(*) AS rows,
  count(*) FILTER (WHERE equipment_entity_id IS NOT NULL) AS with_equipment_fk,
  round(100.0*count(*) FILTER (WHERE equipment_entity_id IS NOT NULL)/count(*),1) AS pct_with_fk
FROM knowledge_entries
GROUP BY 1 ORDER BY rows DESC;

ROLLBACK;
