# Phase 0 Baseline — Corpus Candidate-Set Repair (#3177)

> **Measured:** 2026-08-18 · **Target:** STAGING (`factorylm/stg`, Neon endpoint
> `ep-polished-hall-ahcqtcxe-pooler.c-3.us-east-1.aws.neon.tech/neondb`) · **Read-only**
> (`SET TRANSACTION READ ONLY`, `ROLLBACK`). Production was **not** queried.
> **PRD:** `docs/plans/2026-08-17-corpus-candidate-set-repair-prd.md` §7 Phase 0.
> **Query set:** `docs/testing/sql/2026-08-18-phase0-candidate-set-baseline.sql` (re-runnable).

Corpus at measurement time: **84,332** `knowledge_entries` rows.

---

## 1. CONTROL-GROUP GATE — **PASS. Do not re-scope.**

The PRD's stop-and-rescope gate asks: is PF525, ingested via a different path, correctly tagged?

| | rows tagged with the expected model | `_product_search` candidates |
|---|---|---|
| **PowerFlex 525** (control) | **7,547** (`model_number = 'PowerFlex 525'`) | **7,547** |
| **GS10** (treatment) | **14** under `AutomationDirect` (15 corpus-wide) | **11** |

PF525 is correctly and densely tagged. **The defect is confirmed path-specific.** The PRD's
scope holds; the blast radius is not larger than assumed.

## 2. The issue-text numbers are REPRODUCIBLE (with two corrections)

| #3177 probe | issue text | measured on staging | verdict |
|---|---|---|---|
| `manufacturer ILIKE '%AutomationDirect%'` | 4,295 | **4,298** | ✅ (+3, drift) |
| `model_number ILIKE '%GS10%'` | 11 | **15** raw / **11** as a `_product_search` candidate set | ✅ — the quoted 11 is the *candidate* count |
| `content ILIKE '%GS10%'` | 1,206 | **1,490** | ⚠️ drifted upward |
| AutomationDirect blank `model_number` | 2,034 | **2,034** | ✅ exact |
| AutomationDirect rows with any fault-clear phrase | 0 | **2** | ⚠️ **not zero** |
| PF525 fault-clear rows "for comparison" | 113 | **12** | ❌ **does not reproduce** |

**Correction A — "zero fault-clear content" is now 2, not 0.** Both rows are near-misses, not
usable GS10 procedure: one is a GS4-KPD keypad note inside `gs30m.pdf`
("To reset the fault codes press the Enter and R…"), one is a Yaskawa-derived
`drives g vg 4 manual` page. The PRD's Phase 3 target ("0 → >0") should be restated as a
*model-scoped* target — under the `GS10` tag the five canonical phrases still return **0**.

**Correction B — the PF525 = 113 comparison does not reproduce.** With #3177's own five phrases
(`clear the fault by`, `clears the fault queue`, `acknowledge the fault`, `to reset the fault`,
`resetting a fault`) PF525-tagged rows return **12**, and all of Rockwell Automation returns 47.
A broader probe (`reset the fault` / `fault reset` / `clear the fault` / `clear fault` /
`clears the fault`) returns 65 for PF525 and 394 for Rockwell — still not 113. Whatever phrase
set produced 113 was never written down. **Any Phase 5 before/after comparison must pin the
phrase list, or the delta is meaningless.**

## 3. Tagging health, treatment vs control

| manufacturer | rows | blank `model_number` | % blank | distinct models | embedded |
|---|---|---|---|---|---|
| Rockwell Automation | 34,186 | 1,650 | 4.8% | 23 | 34,186 |
| AutomationDirect | 4,298 | 2,034 | **47.3%** | 4 | 4,295 |
| Allen-Bradley | 2,706 | 1,046 | 38.7% | 7 | 2,703 |

AutomationDirect `model_number` distribution — the tag pollution of PRD §2.4, confirmed:

```
(blank)                 2034
drives g vg 4 manual    1403     <- document title in a model column (tier 4)
drives g mini manual     840     <- document title in a model column (tier 4)
GS10                      14
GS1-45P0                   7
```

## 4. Provenance of the blank set — a single document

All **2,034** blank-model AutomationDirect rows come from **one** `source_url`:
`https://cdn.automationdirect.com/static/manuals/gs30m/gs30m.pdf`
(`source_type=equipment_manual`, ingested 2026-05-03), and **all 2,034 carry
`metadata->>'equipment_id' = 'GS30M'`**.

Two consequences for the PRD:

1. The model *was in hand at write time* and was written to `metadata` (`store.py:117`) but not to
   the column — the exact signature of the dropped `store_chunks(model_number=…)` argument.
2. **The blank rows are the GS30 manual, not a GS10 manual.** GS10 has no manual in the corpus at
   all (Defect B, PRD §2.3). Backfilling these 2,034 rows will tag them `GS30M` and will **not**
   add a single GS10 candidate. Phase 2 and Phase 3 are therefore independent — Phase 2 cannot
   move the GS10 numbers, and the PRD's §8 target "GS10 candidates 11 → all chunks of
   `gs10usermanual.pdf`" is achievable only by Phase 3.

## 5. Blast-radius corroboration (mechanisms 2 and 3)

Corpus-wide: **17,599 / 84,332 (20.9%)** rows have a blank `model_number`.

| bucket | rows | with `equipment_entity_id` | % |
|---|---|---|---|
| tagged `model_number` | 66,733 | 45,834 | 68.7% |
| blank `model_number` | 17,599 | **0** | **0.0%** |

A perfect 0/17,599. This is direct evidence for PRD §2.2 rows 2–3: the
`if kg_writer is not None and manufacturer and model_number:` guard in `store.py:186` is False for
every blank row, so `link_chunk_to_equipment` (the FK) and the fault-code extractor never ran.
Not one blank row escaped. Phase 4 (KG re-densification) is therefore load-bearing, not optional.

## 6. Not measured here

- `retrieval_probe.py` reproduction of #3165's `P0594` turn (PRD Phase 0 item 4) — needs the
  live engine, not a SQL probe.
- Tier 1/2/3/4 distribution per D2 — needs the manifest builder from Phase 2.

## 7. How to re-run

```bash
doppler run --project factorylm --config stg -- sh -c \
  'psql "$NEON_DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=1 \
     -f docs/testing/sql/2026-08-18-phase0-candidate-set-baseline.sql'
```

Never run this against `factorylm/prd`. Prod read-only inspection goes through
`.github/workflows/db-inspect.yml` (`docs/environments.md` hard rule #1).
