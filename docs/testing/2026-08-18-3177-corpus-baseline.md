# Phase 0 Baseline — Corpus Candidate-Set Repair (#3177)

> **Status:** MEASURED (control-group gate **PASS**) with two sections explicitly
> **NOT YET MEASURED** (§7).
> **Measured:** 2026-08-19 01:30 UTC · **Target:** STAGING (`factorylm/stg`, Neon endpoint
> `ep-polished-hall-ahcqtcxe-pooler.c-3.us-east-1.aws.neon.tech/neondb`).
> **Production was not queried.** Read-only throughout (`SET TRANSACTION READ ONLY` + rollback).
> **PRD:** `docs/plans/2026-08-17-corpus-candidate-set-repair-prd.md` §7 Phase 0.
> **Instrument:** `tools/corpus_baseline_probe.py` (this document's tables are its verbatim output).
> **Raw query set (superset):** `docs/testing/sql/2026-08-18-phase0-candidate-set-baseline.sql`.
>
> **This file is the canonical Phase 0 baseline.** Its companion,
> `docs/testing/2026-08-18-phase0-candidate-set-baseline.md`, is the *first-pass forensic write-up*
> from the same staging measurement — keep it for the issue-text-vs-measured reproduction table
> (which probe number matches which figure quoted in #3177) and the per-model distributions. The
> two agree line for line; where they ever diverge, re-run §2 and trust the instrument.

The PRD's Phase 0 exit is a committed baseline: **no baseline, no claim of improvement.** This is
that baseline. Every number below is re-derivable by the command in §2 against staging.

---

## 1. Method

Two instruments, deliberately kept separate:

| | what it is | when to use it |
|---|---|---|
| `tools/corpus_baseline_probe.py` | the **repeatable** instrument — the per-manufacturer / per-product / blast-radius tables, printed as markdown, with a fail-closed production guard | every re-measure, including the Phase 5 after-shot |
| `docs/testing/sql/2026-08-18-phase0-candidate-set-baseline.sql` | the **raw psql query set** — a superset that also covers provenance (`P0.9`) and the per-model distributions (`P0.2`/`P0.3`) | one-off forensics by a human with `psql` |

**Read-only, by construction.** The probe asserts every statement starts with `SELECT`/`WITH`
before opening a connection, runs inside `SET TRANSACTION READ ONLY`, and rolls back. There is no
write path in the file.

**It cannot run against production.** `assert_not_production()` fails closed through three
independent layers, all of which must pass:

1. **Requested env** must be in `("stg", "dev", "dev_personal")`; `prd`/`prod`/`production` is
   refused by name.
2. **Provenance** — `DOPPLER_CONFIG` (injected by `doppler run`) must be present *and equal* the
   requested `--env`. A missing `DOPPLER_CONFIG` means the connection string's origin is
   unverifiable, which is a **refusal, not a pass** — that is the fail-closed half. A mismatch
   (`doppler run --config prd -- … --env stg`) is refused because the injected config is
   authoritative, so the guard cannot be fooled by a flag.
3. **Resolved endpoint** must not contain a known production Neon host fragment
   (`ep-purple-hall`, already documented in `docs/README.md`), and neither the host nor the
   database name may self-describe as production (`prd`, `production`).

All four refusal paths were exercised before this run; the observed output is in §6.

**Phrase sets are pinned.** `PHRASE_SETS` in the probe names two lists — `issue3177` (the five
phrasings quoted in the issue) and `broad`. A fault-clear count is meaningless without saying which
list produced it (see Correction B, §4). **Do not edit a set in place — add a new named set.**

## 2. Exact commands

```bash
# the baseline (staging, read-only) — produced every table in §3
doppler run --project factorylm --config stg -- py -3 tools/corpus_baseline_probe.py

# the same, with the broader phrase list (§4, Correction B)
doppler run --project factorylm --config stg -- py -3 tools/corpus_baseline_probe.py \
  --phrase-set broad

# dry run: prints the resolved config and the SQL, opens no connection
py -3 tools/corpus_baseline_probe.py --print-sql

# provenance + per-model distributions (a human with psql)
doppler run --project factorylm --config stg -- sh -c \
  'psql "$NEON_DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=1 \
     -f docs/testing/sql/2026-08-18-phase0-candidate-set-baseline.sql'
```

Never run any of these against `factorylm/prd`. Prod read-only inspection goes through
`.github/workflows/db-inspect.yml` (`docs/environments.md` hard rule #1) — and the probe would
refuse anyway.

## 3. Baseline — MEASURED on staging, 2026-08-19 01:30 UTC

Verbatim output of `tools/corpus_baseline_probe.py` (phrase set `issue3177`).

### 3.1 Per-manufacturer tagging health

| manufacturer | rows | blank model_number | % blank | tagged | distinct models | embedded | fault-clear rows |
|---|---|---|---|---|---|---|---|
| Rockwell Automation | 34,186 | 1,650 | 4.8% | 32,536 | 23 | 34,186 | 47 |
| AutomationDirect | 4,298 | 2,034 | 47.3% | 2,264 | 4 | 4,295 | 2 |
| Allen-Bradley | 2,706 | 1,046 | 38.7% | 1,660 | 7 | 2,703 | 0 |

### 3.2 Per-product candidate set (`_product_search` predicates)

| product | rows tagged | rows whose content mentions it | candidates | fault-clear rows under the tag |
|---|---|---|---|---|
| GS10 | 15 | 1,490 | 11 | 0 |
| PowerFlex 525 | 7,547 | 1,505 | 7,547 | 12 |

### 3.3 Corpus-wide blast radius

| bucket | rows | with `equipment_entity_id` | % with FK |
|---|---|---|---|
| tagged model_number | 66,733 | 45,834 | 68.7% |
| blank model_number | 17,599 | **0** | **0.0%** |

Corpus: **84,332** rows, **17,599** blank `model_number` (**20.9%**).

A perfect 0 / 17,599 is direct evidence for PRD §2.2 mechanisms 2–3: `store.py`'s
`if kg_writer is not None and manufacturer and model_number:` guard was False for *every* blank
row, so `link_chunk_to_equipment` (the FK) and the fault-code extractor never ran. Not one blank
row escaped. **Phase 4 (KG re-densification) is load-bearing, not optional.**

### 3.4 Provenance of the blank AutomationDirect rows (from the SQL set, `P0.9`)

All **2,034** blank-model AutomationDirect rows come from **one** `source_url` —
`https://cdn.automationdirect.com/static/manuals/gs30m/gs30m.pdf`
(`source_type=equipment_manual`) — and **all 2,034 carry `metadata->>'equipment_id' = 'GS30M'`**.

Two consequences the PRD does not currently state:

1. The model **was in hand at write time** and reached `metadata`, but not the column — the exact
   signature of the dropped `store_chunks(model_number=…)` argument.
2. **These blank rows are the GS30 manual, not a GS10 manual.** Backfilling them will tag them
   `GS30M` and will **not add a single GS10 candidate**. Phase 2 (backfill) and Phase 3 (content
   gap) are therefore **independent**, and the PRD §8 target "GS10 candidates 11 → all chunks of
   `gs10usermanual.pdf`" is reachable only through **Phase 3**.

## 4. The control-group gate — **PASS. Do not re-scope.**

The PRD stops and re-scopes if the control group is *also* mis-tagged. PowerFlex 525 was ingested
through a different path, so it is the control.

| outcome | what it MEANS | action |
|---|---|---|
| PF525 densely and correctly tagged (**observed: 7,547 rows tagged, 7,547 candidates**) | the defect is **path-specific** to `base_crawler.process()`; the blast radius is what the PRD assumed | **PASS — proceed with the PRD as written.** This is the observed outcome. |
| PF525 also blank / sparsely tagged | the defect is **not** path-specific — a second write path (or a later migration) is also dropping the model | **STOP. Re-scope**: find the shared cause before writing any backfill, or Phase 2 will paper over a live leak. |
| PF525 tagged but with a *filename-derived* tag (`520-UM001…`) | the model is being **guessed**, not declared — a different defect of the same family (PRD §2.4 tier-4 pollution) | **STOP.** Fix declaration before backfill; a backfill built on guesses is unfixable later. |

**Observed: PASS.** 7,547 rows carry `model_number = 'PowerFlex 525'` and all 7,547 survive the
`_product_search` candidate predicates. Contrast GS10: 15 tagged rows, 11 candidates, against
1,490 rows whose *content* mentions GS10.

### Corrections to the issue text (both material to PRD acceptance criteria)

**Correction A — "AutomationDirect rows with any fault-clear phrase = 0" is 2, not 0.** Neither is
usable GS10 procedure (one is a GS4-KPD keypad note inside `gs30m.pdf`; one is a Yaskawa-derived
`drives g vg 4 manual` page). The Phase 3 exit criterion "0 → >0" is **already satisfied by noise**
and must be restated **model-scoped**: under the `GS10` tag the `issue3177` phrases return **0**
(§3.2), which is the number worth moving.

**Correction B — the "PF525 has 113 fault-clear rows for comparison" figure does not reproduce.**

| phrase set | PF525-tagged rows | Rockwell Automation rows |
|---|---|---|
| `issue3177` (the five phrasings quoted in #3177) | 12 | 47 |
| `broad` | 65 | 394 |

Neither is 113, and the phrase list behind 113 was never written down. **Any Phase 5 before/after
delta must name its phrase set** (`--phrase-set`), or the delta is unfalsifiable. That is why the
lists are pinned in code rather than typed at the prompt.

## 5. What "improvement" will mean (the after-shot contract)

Re-run §2's first command after each phase and paste the output here as a new dated section. The
comparison is only valid if the phrase set and the manufacturer list match this run's
(`issue3177`; AutomationDirect / Rockwell Automation / Allen-Bradley).

| metric (this baseline) | value | moved by |
|---|---|---|
| AutomationDirect % blank `model_number` | 47.3% | Phase 2 (backfill) |
| corpus-wide blank `model_number` | 17,599 (20.9%) | Phase 2 |
| blank rows with an `equipment_entity_id` | 0 (0.0%) | Phase 4 (KG re-densification) |
| GS10 `_product_search` candidates | 11 | **Phase 3 only** (see §3.4) |
| GS10 fault-clear rows under the tag (`issue3177`) | 0 | Phase 3 |

## 6. Production-guard verification (2026-08-19, this box)

All four refusal paths observed before the measurement run; each exits `3` and opens no connection.

```
### T1 --env prd (refused by name)
REFUSED (production guard): refusing env='prd': this probe never runs against production.
  Prod read-only inspection goes through .github/workflows/db-inspect.yml
  (docs/environments.md hard rule #1).                                            rc=3

### T2 no DOPPLER_CONFIG (unverifiable provenance -> fail closed)
REFUSED (production guard): DOPPLER_CONFIG is not set, so the connection string's
  provenance cannot be verified. Failing closed.                                  rc=3

### T3 --env stg but DOPPLER_CONFIG=prd (flag mismatch)
REFUSED (production guard): env mismatch: --env='stg' but DOPPLER_CONFIG='prd'.
  The injected Doppler config is authoritative.                                   rc=3

### T4 stg-labelled but prod endpoint
REFUSED (production guard): resolved endpoint
  'ep-purple-hall-…-pooler.c-3.us-east-1.aws.neon.tech' matches the known
  production fragment 'ep-purple-hall'. Refusing.                                 rc=3
```

Statement-level read-only assertion, same session:

```
refused -> non-SELECT statement refused: 'UPDATE knowledge_entries SET x=1'
refused -> non-SELECT statement refused: 'DELETE FROM knowledge_entries'
refused -> non-SELECT statement refused: 'INSERT INTO t VALUES(1)'
SELECT 1 allowed
```

## 7. NOT YET MEASURED

Stated explicitly so nobody mistakes an absent number for a zero.

- **`retrieval_probe.py` replay of #3165's `P0594` turn** (PRD Phase 0 item 4) — **NOT YET
  MEASURED.** It needs the live engine (`neon_recall.recall_knowledge`) plus a reachable embedder,
  not a SQL probe; `tests/regime1_telethon/campaign/retrieval_probe.py` is the instrument, and its
  own docstring warns that without an embedding it is a *weaker* retrieval than production.
- **Tier 1/2/3/4 tag-quality distribution** (PRD D2) — **NOT YET MEASURED.** Needs the manifest
  builder that Phase 2 introduces. The raw material is visible today in the SQL set's `P0.2`
  (`drives g vg 4 manual` ×1,403 and `drives g mini manual` ×840 are document titles sitting in a
  model column — tier-4 pollution), but the classification itself does not exist yet.
- **Production corpus counts** — **NOT MEASURED, and deliberately so.** Every number here is
  staging. Prod may differ; if a prod figure is ever needed it goes through
  `.github/workflows/db-inspect.yml`, never a session.

## 8. Cross-references

- `docs/plans/2026-08-17-corpus-candidate-set-repair-prd.md` — the PRD this is Phase 0 of
  (branch `origin/fix/crawler-model-number-tagging`)
- `mira-crawler/crawler/base_crawler.py` — the defect site; `model_number=equipment_id` is the fix
- `mira-crawler/ingest/store.py` — `store_chunks`, where `model_number` is now a required
  keyword-only argument, and the `manufacturer and model_number` KG guard
- `mira-bots/shared/neon_recall.py` `_product_search` — the `model_number ILIKE` filter §3.2 mirrors
- `tests/test_architecture.py` Contract 16 — the guard that keeps every `store_chunks` caller
  stating its model
- `docs/environments.md` — dev/staging/prod doctrine the production guard implements
