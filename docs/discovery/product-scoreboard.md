# FactoryLM/MIRA Product Scoreboard — Data Model Audit

**Author:** Agent E (Data Model / Scoreboard) · **Date:** 2026-07-03 · **Repo state:** `mira-integration` @ `9a3c6f80`
**Scope:** define the COMPLETE, read-only NeonDB scoreboard for the "connect → map → attach → approve → outcome" product loop
(`docs/discovery/2026-07-03-product-discovery-sweep.md` §9). Reuses what `.github/workflows/db-inspect.yml` already probes
(lines 306–381 as of #2403: 038-presence, total `tag_events`, `tag_events` by tenant/source/day, `machine_run` by
tenant/uns/day, `run_diff` by severity/tag/day, `kg_relationships` by type, NULL `uns_path` count+list), adds what's
missing, and flags what cannot be measured from the schema as it exists today.

**Method:** every column/table name below is verified against the migration that created it (cited inline). No SQL here
has been executed — this file is a spec for a `db-inspect.yml` run, not a result. Where a metric needs schema that
doesn't exist, that is stated as a gap with a smallest-addition proposal (a `db-inspect.yml`/migration author's job to
land, not this file's).

**Environments:** run against `staging` first (`factorylm/stg`), then `prod` (`factorylm/prd`) via the existing
`workflow_dispatch` input — never psql prod directly (root `CLAUDE.md` § Environments).

---

## 1. The full SQL scoreboard (copy-paste runnable via `db-inspect.yml`'s psql heredoc pattern)

This is one `psql "$DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=0 <<'SQL' … SQL` block, in the same style as the existing
steps in `.github/workflows/db-inspect.yml`. Queries already present in the workflow are marked **[EXISTING]** and
included only for completeness/ordering — don't duplicate them if wiring this into the workflow, see §3 for the diff to
apply instead.

```sql
-- ══════════════════════════════════════════════════════════════════════════
-- METRIC 1 — tag_events volume + freshness (033/020/036)
-- Loop stage: CONNECT (raw ingest exists and is fresh)
-- ══════════════════════════════════════════════════════════════════════════

\echo === [EXISTING] total tag_events ===
SELECT count(*) AS total_tag_events FROM tag_events;

\echo === [EXISTING] tag_events by tenant / source_system / day (last 14 days) ===
SELECT tenant_id, source_system, date_trunc('day', event_timestamp) AS day, count(*) AS n
  FROM tag_events
 WHERE event_timestamp > now() - interval '14 days'
 GROUP BY 1,2,3 ORDER BY day DESC, n DESC;

\echo === [NEW] tag_events freshness — most recent event per tenant, age vs now() ===
SELECT tenant_id,
       max(event_timestamp) AS latest_event,
       now() - max(event_timestamp) AS age
  FROM tag_events
 GROUP BY 1 ORDER BY latest_event DESC NULLS LAST;

\echo === [NEW] live_signal_cache freshness_status counts (020 base table + 036 freshness columns) ===
SELECT tenant_id, freshness_status, count(*) AS n
  FROM live_signal_cache
 GROUP BY 1,2 ORDER BY 1, n DESC;

\echo === [NEW] live_signal_cache: stale/unknown tags with their last-seen age ===
SELECT tenant_id, plc_tag, uns_path::text, freshness_status,
       now() - last_seen_at AS age_since_last_seen
  FROM live_signal_cache
 WHERE freshness_status IN ('stale', 'unknown')
 ORDER BY age_since_last_seen DESC NULLS LAST
 LIMIT 50;

-- ══════════════════════════════════════════════════════════════════════════
-- METRIC 2 — approved tag count by tenant + by uns_path subtree (035)
-- Loop stage: MAP (customer-safe allowlist is the gate before ingest is trusted)
-- ══════════════════════════════════════════════════════════════════════════

\echo === [NEW] approved_tags total + by tenant (enabled only) ===
SELECT tenant_id, count(*) AS n_enabled
  FROM approved_tags
 WHERE enabled = true
 GROUP BY 1 ORDER BY n_enabled DESC;

\echo === [NEW] approved_tags by uns_path subtree (top 3 ltree labels — e.g. enterprise.site.area) ===
SELECT tenant_id,
       subltree(uns_path, 0, LEAST(nlevel(uns_path), 3)) AS subtree,
       count(*) AS n
  FROM approved_tags
 WHERE enabled = true AND uns_path IS NOT NULL
 GROUP BY 1,2 ORDER BY n DESC;

\echo === [NEW] approved_tags with NO resolved uns_path yet (approved but unmapped) ===
SELECT tenant_id, source_system, count(*) AS n_unmapped
  FROM approved_tags
 WHERE enabled = true AND uns_path IS NULL
 GROUP BY 1,2 ORDER BY n_unmapped DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- METRIC 3 — machine memory rows: machine_run/run_step/run_baseline/run_diff/
--            machine_state_window (038/040)
-- Loop stage: OUTCOME (run-centric fault detection — the "difference engine")
-- ══════════════════════════════════════════════════════════════════════════

\echo === [EXISTING] 038 machine-memory tables present? ===
SELECT t.name AS table_name,
       EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name = t.name) AS present
  FROM (VALUES ('machine_run'),('run_step'),('run_baseline'),('run_diff'),
               ('machine_state_window')) AS t(name);

\echo === [NEW] machine-memory row counts, all 5 tables in one place (038 + 040) ===
SELECT 'machine_run' AS tbl, count(*) AS n FROM machine_run
UNION ALL SELECT 'run_step', count(*) FROM run_step
UNION ALL SELECT 'run_baseline', count(*) FROM run_baseline
UNION ALL SELECT 'run_diff', count(*) FROM run_diff
UNION ALL SELECT 'machine_state_window', count(*) FROM machine_state_window
ORDER BY tbl;

\echo === [EXISTING] machine runs by tenant / uns_path / day / status ===
SELECT tenant_id, uns_path::text AS uns_path, date_trunc('day', started_at) AS day, status, count(*) AS n
  FROM machine_run GROUP BY 1,2,3,4 ORDER BY day DESC, n DESC;

\echo === [NEW] latest machine_run per (tenant, uns_path) — "is this asset running right now" ===
SELECT DISTINCT ON (tenant_id, uns_path)
       tenant_id, uns_path::text, status, started_at, stopped_at, duration_seconds
  FROM machine_run
 ORDER BY tenant_id, uns_path, started_at DESC;

\echo === [NEW] latest machine_state_window per (tenant, uns_path) — "what state is the idle/faulted asset in" ===
SELECT DISTINCT ON (tenant_id, uns_path)
       tenant_id, uns_path::text, state, started_at, ended_at
  FROM machine_state_window
 ORDER BY tenant_id, uns_path, started_at DESC;

\echo === [EXISTING] run_diffs by severity / tag_path / day ===
SELECT tenant_id, severity, tag_path, date_trunc('day', event_timestamp) AS day, count(*) AS n
  FROM run_diff GROUP BY 1,2,3,4 ORDER BY day DESC, n DESC;

\echo === [NEW] run_diff split: statistical baseline-deviation (diff_type NULL, pre-040) vs typed A0-A12 anomaly (040) ===
SELECT tenant_id,
       CASE
         WHEN diff_type IS NULL       THEN 'statistical_baseline_deviation'
         WHEN diff_type LIKE 'anomaly_%' THEN 'typed_anomaly'
         ELSE diff_type
       END AS diff_class,
       severity,
       count(*) AS n
  FROM run_diff
 GROUP BY 1,2,3 ORDER BY 1, n DESC;

\echo === [NEW] typed anomalies by rule id (diff_type LIKE 'anomaly_%'), most-fired first ===
SELECT tenant_id, diff_type, count(*) AS n
  FROM run_diff
 WHERE diff_type LIKE 'anomaly_%'
 GROUP BY 1,2 ORDER BY n DESC;

\echo === [NEW] run_diff parentage sanity — should be 100% (run_id XOR window_id per 040 CHECK) ===
SELECT
  count(*) FILTER (WHERE run_id IS NOT NULL AND window_id IS NULL)  AS run_parented,
  count(*) FILTER (WHERE run_id IS NULL AND window_id IS NOT NULL)  AS window_parented,
  count(*) FILTER (WHERE run_id IS NOT NULL AND window_id IS NOT NULL) AS both_set_investigate,
  count(*) FILTER (WHERE run_id IS NULL AND window_id IS NULL)      AS neither_set_should_be_zero
  FROM run_diff;

-- ══════════════════════════════════════════════════════════════════════════
-- METRIC 4 — KG relationship counts by type + canonical-vs-drift fold (001/029)
-- Loop stage: ATTACH/APPROVE (the graph IS the connective tissue between docs
--             and live signals — see 2026-07-03 discovery sweep §10)
-- Canonical fold source: mira-hub/src/lib/knowledge-graph/canonical-relationship-type.ts
--   LOWERCASE_TO_CANONICAL_DISPLAY_TYPE (display-layer only; NOT the write-path
--   canonicalizer — see that file's header for the distinction).
-- ══════════════════════════════════════════════════════════════════════════

\echo === [EXISTING] kg_relationships by RAW type (drift is visible here: mixed case, e.g. has_component + HAS_COMPONENT) ===
SELECT relationship_type, count(*) AS n FROM kg_relationships GROUP BY 1 ORDER BY n DESC;

\echo === [NEW] kg_relationships folded to canonical display type (mirrors canonicalizeRelationshipType()) ===
SELECT
  CASE relationship_type
    WHEN 'has_component'  THEN 'HAS_COMPONENT'
    WHEN 'located_at'     THEN 'LOCATED_IN'
    WHEN 'has_manual'     THEN 'HAS_DOCUMENT'
    WHEN 'documented_in'  THEN 'HAS_DOCUMENT'
    WHEN 'has_fault_code' THEN 'HAS_FAILURE_MODE'
    WHEN 'has_work_order' THEN 'HAS_WORK_ORDER'
    WHEN 'instance_of'    THEN 'INSTANCE_OF'
    -- NOTE: 'parent_of' is deliberately NOT folded here (canonical fold requires
    -- a source/target flip a type-only CASE can't express — see the .ts header).
    -- 'CONTROLS' is out-of-vocabulary and passes through unchanged.
    ELSE relationship_type
  END AS canonical_type,
  count(*) AS n
FROM kg_relationships
GROUP BY 1 ORDER BY n DESC;

\echo === [NEW] kg_relationships by approval_state (029: proposed/verified/rejected/needs_review) ===
SELECT tenant_id, approval_state, count(*) AS n
  FROM kg_relationships
 GROUP BY 1,2 ORDER BY 1, n DESC;

\echo === [NEW] kg_relationships case/name DRIFT detector — same canonical concept, two+ raw spellings ===
-- A canonical_type with >1 distinct raw relationship_type feeding it is drift
-- the enum-drift enforcement layer should be catching (2026-07-03 sweep finding).
WITH folded AS (
  SELECT relationship_type,
         CASE relationship_type
           WHEN 'has_component'  THEN 'HAS_COMPONENT'
           WHEN 'located_at'     THEN 'LOCATED_IN'
           WHEN 'has_manual'     THEN 'HAS_DOCUMENT'
           WHEN 'documented_in'  THEN 'HAS_DOCUMENT'
           WHEN 'has_fault_code' THEN 'HAS_FAILURE_MODE'
           WHEN 'has_work_order' THEN 'HAS_WORK_ORDER'
           WHEN 'instance_of'    THEN 'INSTANCE_OF'
           ELSE relationship_type
         END AS canonical_type
    FROM kg_relationships
)
SELECT canonical_type, count(DISTINCT relationship_type) AS raw_spellings,
       array_agg(DISTINCT relationship_type) AS spellings
  FROM folded
 GROUP BY 1
HAVING count(DISTINCT relationship_type) > 1
 ORDER BY raw_spellings DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- METRIC 5 — causal / non-document edges: count + by tenant (001/029/043)
-- Loop stage: ATTACH/APPROVE — "is the graph anything beyond a card catalog?"
-- Document-attachment family excluded: HAS_DOCUMENT, has_manual, documented_in
-- (the ingest-time doc→entity edge, ~87% of kg_relationships per the 2026-07-03
-- sweep — see docs/discovery/2026-07-03-product-discovery-sweep.md §10).
-- ══════════════════════════════════════════════════════════════════════════

\echo === [NEW] total non-document ("causal"/topology/CMMS/signal) edges ===
SELECT count(*) AS non_document_edges
  FROM kg_relationships
 WHERE relationship_type NOT IN ('HAS_DOCUMENT', 'has_manual', 'documented_in');

\echo === [NEW] non-document edges by tenant ===
SELECT tenant_id, count(*) AS n
  FROM kg_relationships
 WHERE relationship_type NOT IN ('HAS_DOCUMENT', 'has_manual', 'documented_in')
 GROUP BY 1 ORDER BY n DESC;

\echo === [NEW] non-document edges by canonical type (the "is the graph the connective tissue" breakdown) ===
SELECT
  CASE relationship_type
    WHEN 'has_component'  THEN 'HAS_COMPONENT'
    WHEN 'located_at'     THEN 'LOCATED_IN'
    WHEN 'has_fault_code' THEN 'HAS_FAILURE_MODE'
    WHEN 'has_work_order' THEN 'HAS_WORK_ORDER'
    WHEN 'instance_of'    THEN 'INSTANCE_OF'
    ELSE relationship_type
  END AS canonical_type,
  count(*) AS n
FROM kg_relationships
WHERE relationship_type NOT IN ('HAS_DOCUMENT', 'has_manual', 'documented_in')
GROUP BY 1 ORDER BY n DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- METRIC 6 — entities with NULL uns_path (010/025) + trend note
-- Loop stage: MAP (UNS compliance — .claude/rules/uns-compliance.md)
-- ══════════════════════════════════════════════════════════════════════════

\echo === [EXISTING] kg_entities NULL uns_path — count + list ===
SELECT count(*) AS null_uns_path_entities FROM kg_entities WHERE uns_path IS NULL;
SELECT id, tenant_id, entity_type, name FROM kg_entities WHERE uns_path IS NULL ORDER BY entity_type, name LIMIT 50;

\echo === [NEW] NULL uns_path breakdown by tenant + entity_type (trend tracking — is it growing or shrinking?) ===
SELECT tenant_id, entity_type, count(*) AS n
  FROM kg_entities
 WHERE uns_path IS NULL
 GROUP BY 1,2 ORDER BY n DESC;

\echo === [NEW] UNS-compliance rate by tenant (pct with a resolved uns_path — the trend line to watch) ===
SELECT tenant_id,
       count(*) AS total_entities,
       count(*) FILTER (WHERE uns_path IS NULL) AS null_uns_path,
       round(100.0 * count(*) FILTER (WHERE uns_path IS NOT NULL) / NULLIF(count(*), 0), 1) AS pct_compliant
  FROM kg_entities
 GROUP BY 1 ORDER BY pct_compliant ASC NULLS LAST;

-- ══════════════════════════════════════════════════════════════════════════
-- METRIC 7 — work orders created FROM machine memory / anomalies
-- Loop stage: OUTCOME (close the loop: detection -> action)
-- STATUS: NOT MEASURABLE YET — see §4 gap report. No linkage column exists
-- anywhere in the chain (work_orders, mira-mcp cmms_create_work_order args,
-- or the mira-bots wo_outbox SQLite table). The query below is a template for
-- AFTER the smallest-addition proposal (§4.1) lands; it will 42703 today.
-- ══════════════════════════════════════════════════════════════════════════

\echo === [FUTURE — will error until source_run_diff_id exists, see §4.1] work orders traced to a run_diff/anomaly ===
-- SELECT wo.tenant_id, count(*) AS wo_from_anomaly,
--        count(*) FILTER (WHERE wo.created_at - rd.event_timestamp < interval '1 hour') AS within_1h_of_detection
--   FROM work_orders wo
--   JOIN run_diff rd ON rd.diff_id = wo.source_run_diff_id
--  GROUP BY 1 ORDER BY wo_from_anomaly DESC;
SELECT 'NOT MEASURABLE — work_orders has no anomaly/run_diff linkage column (see product-scoreboard.md §4.1)' AS note;

-- ══════════════════════════════════════════════════════════════════════════
-- METRIC 8 — Ask MIRA groundedness: decision_traces (032) / kg_query_traces (033)
-- Loop stage: OUTCOME (grounded, cited answers — the North Star wedge)
-- MIRA_ENFORCE_APPROVED_RETRIEVAL / MIRA_ENFORCE_APPROVED_ASK is an ENV VAR
-- (mira-hub/src/lib/approved-context.ts approvedAskEnforcementEnabled()),
-- not a DB column — cannot be queried; noted as a gap in §4.2.
-- ══════════════════════════════════════════════════════════════════════════

\echo === [NEW] decision_traces — citation-presence rate by tenant/day (proxy for "grounded", not "approved-context") ===
SELECT tenant_id, date_trunc('day', ts) AS day,
       count(*) AS turns,
       count(*) FILTER (WHERE citations_present) AS cited_turns,
       round(100.0 * count(*) FILTER (WHERE citations_present) / NULLIF(count(*), 0), 1) AS pct_cited
  FROM decision_traces
 GROUP BY 1,2 ORDER BY day DESC, tenant_id;

\echo === [NEW] decision_traces — outcome distribution (resolved/handoff/kb_gap/gate_fired/engine_error) ===
SELECT tenant_id, outcome, count(*) AS n
  FROM decision_traces
 GROUP BY 1,2 ORDER BY 1, n DESC;

\echo === [NEW] decision_traces — technician confirmation rate (UNS gate closing the loop) ===
SELECT tenant_id,
       count(*) FILTER (WHERE technician_confirmed IS NOT NULL) AS asked,
       count(*) FILTER (WHERE technician_confirmed = true) AS confirmed,
       count(*) FILTER (WHERE technician_confirmed IS NULL) AS never_asked
  FROM decision_traces
 GROUP BY 1 ORDER BY asked DESC;

\echo === [NEW] kg_query_traces — how often an /api/mira/ask answer actually traversed the KG (non-empty entity_ids) ===
SELECT tenant_id,
       count(*) AS traces,
       count(*) FILTER (WHERE array_length(entity_ids, 1) > 0) AS traversed_kg,
       round(100.0 * count(*) FILTER (WHERE array_length(entity_ids, 1) > 0) / NULLIF(count(*), 0), 1) AS pct_kg_grounded
  FROM kg_query_traces
 GROUP BY 1 ORDER BY traces DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- METRIC 9 — baseline coverage: run_baseline rows per uns_path vs approved_tags
-- Loop stage: OUTCOME (can the difference engine even detect a deviation?
--             a baseline requires N normal runs BEFORE it can flag anything)
-- ══════════════════════════════════════════════════════════════════════════

\echo === [NEW] run_baseline rows per (tenant, uns_path) — how many tags have a learned baseline ===
SELECT tenant_id, uns_path::text, count(*) AS baselined_tags,
       sum(sample_count) AS total_samples, avg(sample_count)::numeric(10,1) AS avg_samples_per_tag
  FROM run_baseline
 GROUP BY 1,2 ORDER BY baselined_tags DESC;

\echo === [NEW] baseline coverage ratio — baselined tags vs approved (enabled) tags, per tenant ===
WITH approved AS (
  SELECT tenant_id, count(*) AS approved_n
    FROM approved_tags WHERE enabled = true
   GROUP BY 1
),
baselined AS (
  SELECT tenant_id, count(DISTINCT (uns_path, tag_path)) AS baselined_n
    FROM run_baseline
   GROUP BY 1
)
SELECT COALESCE(a.tenant_id, b.tenant_id) AS tenant_id,
       COALESCE(a.approved_n, 0) AS approved_tags,
       COALESCE(b.baselined_n, 0) AS baselined_tags,
       round(100.0 * COALESCE(b.baselined_n, 0) / NULLIF(a.approved_n, 0), 1) AS pct_baseline_coverage
  FROM approved a
  FULL OUTER JOIN baselined b USING (tenant_id)
 ORDER BY pct_baseline_coverage ASC NULLS LAST;

\echo === [NEW] baselines with near-zero samples (not yet statistically meaningful; k_sigma gate is unreliable below ~5) ===
SELECT tenant_id, uns_path::text, tag_path, sample_count, k_sigma
  FROM run_baseline
 WHERE sample_count < 5
 ORDER BY sample_count ASC;
```

---

## 2. Metric → loop stage → baseline → target

Baselines below are the numbers already established in
`docs/discovery/2026-07-03-product-discovery-sweep.md` §10 (prod, `db-inspect.yml` runs 28666022597/28666024200) plus
the task's stated same-morning approved-tags reseed. Targets are directional, not contractual — they exist so a future
scoreboard run has something to compare against.

| # | Metric | Loop stage | Current baseline (prod, 2026-07-03) | Target |
|---|---|---|---|---|
| 1 | `tag_events` volume/freshness | CONNECT | **28 rows total, ever** (sweep §10); staging 89. No conveyor row has ever landed. `live_signal_cache` freshness not yet sampled — table exists (mig 020/036), row count unknown. | 1,000+/day from ≥1 physical connector (Ignition tag-stream, P0-4); `freshness_status='live'` for every approved tag |
| 2 | approved tags by tenant/subtree | MAP | **285** (227 baseline + today's +58 seed, per task framing); staging 158 | ≥1 approved subtree with `uns_path IS NOT NULL` for every tenant that has a namespace built |
| 3 | machine-memory rows (038/040) | OUTCOME | **038 tables = 0 rows** (`machine_run`/`run_step`/`run_baseline`/`run_diff` all empty in prod per sweep §10 correction; 040's `machine_state_window` not yet probed — new table, presumed 0) | First `machine_run` + `run_diff` row from a real (non-SimLab) tenant; ≥1 typed anomaly (`diff_type LIKE 'anomaly_%'`) persisted from a live A0–A12 firing |
| 4 | KG relationship counts + canonical fold | ATTACH/APPROVE | **308** total; **269 (87%) `has_manual`** (doc-attachment); non-doc types are single digits (`CAUSES`=1, `WIRED_TO`=1, `TRIGGERS`=1, `CONTROLS`=1, `MAPS_TO`=1, `POWERED_BY`=1, `DRIVES`=2, `USED_IN_LOGIC`=2, `has_fault_code`=5, `has_work_order`=1) | Non-document edges >10% of total; at least one canonical type with a real distribution (not a demo-seed singleton) |
| 5 | causal/non-document edges | ATTACH/APPROVE | **≈39** non-`has_manual`/`HAS_DOCUMENT`/`documented_in` edges (308 − 269) | Grows proportionally with live evidence — every approved manual/tag/fault should eventually propose ≥1 causal edge, not just a `has_manual` attach |
| 6 | NULL `uns_path` entities | MAP | **29 prod / 39 staging** | 0 — every `kg_entities` row UNS-compliant (`.claude/rules/uns-compliance.md`) |
| 7 | WO from anomaly | OUTCOME | **NOT MEASURABLE** — no linkage column anywhere (see §4.1); qualitatively "0 confirmed" per sweep §10 broken-link #4 (`create_work_order` has no anomaly caller) | ≥1 work order with a live `source_run_diff_id` after §4.1 ships |
| 8 | Ask MIRA groundedness | OUTCOME | Not yet sampled — `decision_traces` (mig 032) exists but no baseline row count captured in the 2026-07-03 sweep; `MIRA_ENFORCE_APPROVED_RETRIEVAL` defaults **false** (sweep P0-3) | `pct_cited` ≥90% on `decision_traces`; enforcement flag flipped on (product decision, tracked separately) |
| 9 | Baseline coverage | OUTCOME | **0%** — `run_baseline` is empty (038 = 0 rows), so 0 of the 285 approved tags have a learned baseline | ≥1 baselined tag per approved-tag subtree with ≥5 samples (statistically meaningful `k_sigma` gate) |

---

## 3. Suggested `db-inspect.yml` additions (exact SQL — no workflow file edited by this task)

Add these as new `\echo` blocks inside the existing **"Machine memory scoreboard (038 layer) — READ-ONLY"** step
(`.github/workflows/db-inspect.yml:341-381`), immediately after the existing `run_diff` block and before the
`kg_relationships by type` block, since that step already opens a `psql` heredoc against the same tables:

```sql
\echo === scoreboard: tag_events freshness (max event per tenant) ===
SELECT tenant_id, max(event_timestamp) AS latest_event, now() - max(event_timestamp) AS age
  FROM tag_events GROUP BY 1 ORDER BY latest_event DESC NULLS LAST;

\echo === scoreboard: live_signal_cache freshness_status counts ===
SELECT tenant_id, freshness_status, count(*) AS n
  FROM live_signal_cache GROUP BY 1,2 ORDER BY 1, n DESC;

\echo === scoreboard: approved_tags by tenant + by uns_path subtree ===
SELECT tenant_id, count(*) AS n_enabled FROM approved_tags WHERE enabled = true GROUP BY 1 ORDER BY n_enabled DESC;
SELECT tenant_id, subltree(uns_path, 0, LEAST(nlevel(uns_path), 3)) AS subtree, count(*) AS n
  FROM approved_tags WHERE enabled = true AND uns_path IS NOT NULL GROUP BY 1,2 ORDER BY n DESC;

\echo === scoreboard: 040 machine_state_window presence + row count ===
SELECT EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='machine_state_window') AS present;
SELECT count(*) AS machine_state_window_rows FROM machine_state_window;

\echo === scoreboard: run_diff statistical vs typed-anomaly split ===
SELECT CASE WHEN diff_type IS NULL THEN 'statistical' WHEN diff_type LIKE 'anomaly_%' THEN 'typed_anomaly'
            ELSE diff_type END AS diff_class, severity, count(*) AS n
  FROM run_diff GROUP BY 1,2 ORDER BY n DESC;

\echo === scoreboard: kg_relationships canonical fold (drift check) ===
SELECT CASE relationship_type
         WHEN 'has_component' THEN 'HAS_COMPONENT' WHEN 'located_at' THEN 'LOCATED_IN'
         WHEN 'has_manual' THEN 'HAS_DOCUMENT' WHEN 'documented_in' THEN 'HAS_DOCUMENT'
         WHEN 'has_fault_code' THEN 'HAS_FAILURE_MODE' WHEN 'has_work_order' THEN 'HAS_WORK_ORDER'
         WHEN 'instance_of' THEN 'INSTANCE_OF' ELSE relationship_type END AS canonical_type,
       count(*) AS n
  FROM kg_relationships GROUP BY 1 ORDER BY n DESC;

\echo === scoreboard: non-document ("causal") edges, total + by tenant ===
SELECT count(*) FROM kg_relationships WHERE relationship_type NOT IN ('HAS_DOCUMENT','has_manual','documented_in');
SELECT tenant_id, count(*) AS n FROM kg_relationships
  WHERE relationship_type NOT IN ('HAS_DOCUMENT','has_manual','documented_in') GROUP BY 1 ORDER BY n DESC;

\echo === scoreboard: kg_entities UNS-compliance rate by tenant ===
SELECT tenant_id, count(*) AS total,
       round(100.0 * count(*) FILTER (WHERE uns_path IS NOT NULL) / NULLIF(count(*),0), 1) AS pct_compliant
  FROM kg_entities GROUP BY 1 ORDER BY pct_compliant ASC NULLS LAST;

\echo === scoreboard: decision_traces citation-presence rate ===
SELECT tenant_id, count(*) AS turns, count(*) FILTER (WHERE citations_present) AS cited,
       round(100.0 * count(*) FILTER (WHERE citations_present) / NULLIF(count(*),0), 1) AS pct_cited
  FROM decision_traces GROUP BY 1 ORDER BY turns DESC;

\echo === scoreboard: run_baseline coverage vs approved_tags ===
WITH approved AS (SELECT tenant_id, count(*) AS n FROM approved_tags WHERE enabled = true GROUP BY 1),
     baselined AS (SELECT tenant_id, count(DISTINCT (uns_path, tag_path)) AS n FROM run_baseline GROUP BY 1)
SELECT COALESCE(a.tenant_id, b.tenant_id) AS tenant_id, COALESCE(a.n,0) AS approved, COALESCE(b.n,0) AS baselined,
       round(100.0 * COALESCE(b.n,0) / NULLIF(a.n,0), 1) AS pct_coverage
  FROM approved a FULL OUTER JOIN baselined b USING (tenant_id) ORDER BY pct_coverage ASC NULLS LAST;
```

Note: `machine_state_window` (mig 040) is not yet in the workflow's 038-presence probe (`.github/workflows/db-inspect.yml:352-356`
only lists `machine_run`/`run_step`/`run_baseline`/`run_diff`) — the addition above adds its own presence check rather
than editing that `VALUES(...)` list, to keep this a pure-addition diff.

---

## 4. Gaps that need schema to measure — smallest-addition proposals

These are **proposals only**. No migration is written or run by this task; they are sized so a future migration author
(or Mike) can decide in one read whether to take them.

### 4.1 Work-order ↔ anomaly linkage (Metric 7) — genuinely NOT MEASURABLE today

Traced the full chain and found no linkage column anywhere:

- `work_orders` (Hub NeonDB, base-created outside `mira-hub/db/migrations/` — first touched by
  `mira-hub/db/migrations/005_wo_pm_enhancements.sql:7-10`, `006_add_hub_ui_source.sql`, `007_atlas_sync_cols.sql:15-19`,
  `008_add_hub_routetype.sql`): columns confirmed = `tenant_id`(TEXT), `description`, `fault_description`, `resolution`,
  `closed_at`, `source`(enum `sourcetype`), `route_taken`(enum `routetype`), `atlas_id`, `cmms_synced_at`,
  `cmms_synced_etag`. **No `metadata`/JSONB column, no `run_diff_id`, no `machine_run_id`, no `anomaly_id`.**
- `mira-mcp/server.py:305-323` `cmms_create_work_order(title, description, priority, asset_id, category)` — no
  anomaly/run_diff parameter in the signature; a caller could only smuggle a link into the free-text `description`.
- `mira-bots/shared/integrations/wo_outbox.py:46-56` — a **separate, local SQLite** table (not NeonDB), columns
  `payload_json`/`attempts`/`atlas_wo_id`/etc. Even if a caller stuffed a `run_diff_id` into `payload_json`, this table
  isn't reachable by NeonDB SQL at all — it lives on the bot's disk (`MIRA_DB_PATH`).
- Confirms sweep finding: `docs/discovery/2026-07-03-product-discovery-sweep.md` broken-link #4 — "`cmms_create_work_order`
  exists (production) but nothing calls it from detection."

**Smallest addition (proposed, not applied):**

```sql
-- Proposed migration NNN_work_orders_run_diff_link.sql (NOT created by this task)
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS source_run_diff_id UUID REFERENCES run_diff(diff_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_source_run_diff
  ON work_orders (source_run_diff_id)
  WHERE source_run_diff_id IS NOT NULL;
```

Nullable, `ON DELETE SET NULL` (provenance back-link, not ownership — same pattern as `kg_relationships.relationship_proposal_id`
in migration 050). A real FK is safe here (unlike `tag_events.equipment_entity_id`'s soft-link pattern) because `run_diff.diff_id`
is a stable UUID PK and work orders are created well after the diff row exists. This single column makes Metric 7's
commented-out query in §1 real.

### 4.2 Ask MIRA "approved-context" groundedness rate (Metric 8) — partially measurable, precision gap

What's measurable today from `decision_traces` (mig 032): **citation-presence rate** (`citations_present` boolean) —
a real, useful proxy for "did this turn cite something." What's NOT measurable: whether the citation came from
**approved** context specifically, because `approvedAskEnforcementEnabled()`
(`mira-hub/src/lib/approved-context.ts:20-24`) reads `MIRA_ENFORCE_APPROVED_RETRIEVAL`/`MIRA_ENFORCE_APPROVED_ASK` from
`process.env` at request time and never persists the decision. `decision_traces.manual_evidence` is a JSONB array of
`{chunk_id, doc, page, score}` (mig 032 header) with no `verified`/`is_private` flag captured at write time, and
`approvedSourceCount` in the chat routes (`mira-hub/src/app/api/assets/[id]/chat/route.ts:344`) is computed from a
`.filter(s => s.verified)` over an in-memory list, also never persisted.

**Smallest addition (proposed, not applied):**

```sql
-- Proposed migration NNN_decision_traces_approved_context.sql (NOT created by this task)
ALTER TABLE decision_traces
  ADD COLUMN IF NOT EXISTS approved_context_enforced BOOLEAN,
  ADD COLUMN IF NOT EXISTS approved_source_count INTEGER;
```

Populate both at write time in the same code path that already builds `tag_evidence`/`manual_evidence`/`kg_evidence`
(wherever `decision_traces` rows are inserted) — `approved_context_enforced` = the env check's boolean result for that
request, `approved_source_count` = the same number `approved-context.ts` already computes and discards. Once landed:

```sql
SELECT tenant_id,
       count(*) FILTER (WHERE approved_context_enforced) AS enforced_turns,
       count(*) FILTER (WHERE approved_context_enforced AND approved_source_count > 0) AS grounded_in_approved
  FROM decision_traces GROUP BY 1;
```

### 4.3 `machine_state_window` not yet in the 038-presence probe (minor, not a schema gap)

`.github/workflows/db-inspect.yml:352-356` checks presence of `machine_run`/`run_step`/`run_baseline`/`run_diff` only;
migration 040 (`machine_state_window`) shipped after that probe was authored. Not a schema gap — the table exists in the
migration set — just an omission in the existing workflow step. Covered by the addition in §3.

---

## 5. Column/table citations (verify-before-guessing per `.claude/rules/debugging-conventions.md`)

| Table | Columns used above | Migration | Tenant-id type |
|---|---|---|---|
| `tag_events` | `tenant_id`, `uns_path`, `tag_path`, `event_timestamp`, `source_system`, `simulated` | `mira-hub/db/migrations/033_tag_events.sql:56-93` | UUID |
| `live_signal_cache` | `tenant_id`, `plc_tag`, `uns_path`, `freshness_status`, `last_seen_at` | `020_signal_cache_and_trends.sql:44-87` + `036_current_tag_state_freshness.sql:45-60` | UUID |
| `approved_tags` | `tenant_id`, `source_system`, `source_tag_path`, `uns_path`, `enabled` | `035_approved_tags.sql:39-70` | UUID |
| `machine_run` | `run_id`, `tenant_id`, `uns_path`, `status`, `started_at`, `stopped_at` | `038_machine_runs.sql:58-87` | UUID |
| `run_step` | `step_id`, `run_id`, `tenant_id`, `phase_name` | `038_machine_runs.sql:116-131` | UUID |
| `run_baseline` | `baseline_id`, `tenant_id`, `uns_path`, `tag_path`, `sample_count`, `k_sigma` | `038_machine_runs.sql:158-182` | UUID |
| `run_diff` | `diff_id`, `run_id`, `tenant_id`, `uns_path`, `tag_path`, `severity`, `diff_type`, `window_id` | `038_machine_runs.sql:209-232` + `040_machine_memory_windows.sql:40-59` | UUID |
| `machine_state_window` | `window_id`, `tenant_id`, `uns_path`, `state`, `started_at`, `ended_at` | `040_machine_memory_windows.sql:62-79` | UUID |
| `kg_entities` | `id`, `tenant_id`, `entity_type`, `name`, `uns_path`, `approval_state` | `001_knowledge_graph.sql:3-13` + `010_kg_uns_path.sql:11-12` + `029_kg_approval_state.sql:29-31` | UUID |
| `kg_relationships` | `id`, `tenant_id`, `source_id`, `target_id`, `relationship_type`, `approval_state`, `relationship_proposal_id` | `001_knowledge_graph.sql:15-26` + `029_kg_approval_state.sql:23-27` + `050_kg_relationships_proposal_id.sql:28-30` | UUID (NOTE: `docs/migrations/005_kg_relationships.sql` is a **PLANNED, never-run** legacy sketch with `relation_type TEXT`/tenant_id TEXT — the real live table is `001_knowledge_graph.sql`'s `relationship_type`; don't confuse the two) |
| `decision_traces` | `trace_id`, `tenant_id`, `citations_present`, `outcome`, `technician_confirmed`, `manual_evidence` | `032_decision_traces.sql:56-100` | UUID |
| `kg_query_traces` | `id`, `tenant_id`, `session_id`, `entity_ids` | `033_kg_query_traces.sql:21-32` | UUID |
| `work_orders` | `tenant_id`(TEXT), `description`, `source`, `atlas_id` | `005_wo_pm_enhancements.sql`, `006_add_hub_ui_source.sql`, `007_atlas_sync_cols.sql:15-19`, `008_add_hub_routetype.sql` (base `CREATE TABLE` predates the migrations/ directory) | **TEXT** — different family than kg/tag tables, per `.claude/rules/mira-hub-migrations.md` rule 1 |

Canonical fold source: `mira-hub/src/lib/knowledge-graph/canonical-relationship-type.ts:43-51`
(`LOWERCASE_TO_CANONICAL_DISPLAY_TYPE`) — explicitly display-layer-only per that file's own header; not the write-path
canonicalizer (`proposals-writer.ts`).
