# HubV3 — The Hub is the System of Record

> Companion to `docs/plans/2026-06-20-hubv3-contextualization-intake-prd.md`. This explainer states
> the one architectural rule HubV3 enforces and maps the PRD §6 acceptance matrix to the code + tests
> that prove it.

## The rule

**There is one system of record — the FactoryLM Hub. Everything else is an ingest client.**

The offline Contextualizer (a technician's laptop on a dead-internet floor) and the Telegram thin
client both **propose**; neither owns truth. They compute a content fingerprint, attach asset/identity
hints, and submit the **same normalized intake contract** to the Hub. The Hub dedupes, matches against
existing assets, stages everything as **proposed**, and publishes to the project model / UNS / i3X /
MIRA KB **only after a human approves**.

```
offline bundle ─┐
telegram photo ─┼─▶  POST /api/contextualization/import  ─▶  import batch (proposed)
hub upload ─────┘        (one shared intake contract)            │
                                                                 ├─ dedupe sources by sha256
                                                                 ├─ match asset: strong│probable│none
                                                                 ├─ stage signals/faults/params/UNS/i3X
                                                                 ▼
                                                          Review queue ──(human approve)──▶ published
```

## Why this shape

- **No second truth store.** An offline tool that "owns" some assets and the Hub that owns others is
  two sources of record that drift. HubV3 has one; clients only propose.
- **No silent overwrite.** Imported proposals never overwrite `verified`/`deprecated` Hub data
  (`approval_state` guard). Re-importing the same bundle is a no-op (sha256 dedup), not a duplicate.
- **No auto-promotion.** `proposed → approved` is an admin action (ADR-0017). Matching never
  auto-verifies — even a strong asset match lands `proposed`.
- **Train before deploy.** Approved context is what reaches MIRA / the HMI. Field clients capture
  evidence; the Hub validates and approves it.

## The intake contract (§2)

`mira-hub/src/lib/contextualization/intake-contract.ts` — `validateIntakeContract(input)` is the single
gate. Every ingest route submits the same envelope (`contract_version`, `ingest_route ∈
{offline,telegram,hub_upload}`, `asset_hints`, `sources[]` with `source_sha256`, `proposed_signals`,
…). Identity is **UUID-first**; names/serials/models/UNS paths are *matching evidence*, never the sole
key.

## The lifecycle (where truth is gated)

| Stage | Code | Guarantee |
|---|---|---|
| Validate | `validateIntakeContract` | malformed envelope → 400 |
| Dedupe | `import/route.ts` `ON CONFLICT (tenant_id, source_sha256)` | same source → no duplicate |
| Match | `asset-matcher.ts` `classifyAsset` | strong→existing · probable→confirm · none→draft; never auto-verify |
| Stage | migration `056` (`ctx_import_batches`, `ctx_extraction_asset_matches`) | everything `proposed` |
| Review/approve | `approval.ts` (`decidePromotion`/`decidePublish`/`decideBatchReview`) | publish only on human approve; approved data never overwritten |

## PRD §6 acceptance matrix → where it's proven

| # | Acceptance test | Proven in |
|---|---|---|
| 1 | Hub accepts the intake contract | `intake-contract.test.ts`; `acceptance-matrix.test.ts` |
| 2 | Offline bundle imports as an import batch | `import/import.integration.test.ts` (DB) |
| 3 | Same source sha256 does not duplicate | `import/import.integration.test.ts` (DB) |
| 4 | Existing match stages under existing asset | `asset-matcher.test.ts`; `acceptance-matrix.test.ts` |
| 5 | No match creates a draft proposal | `asset-matcher.test.ts`; `acceptance-matrix.test.ts` |
| 6 | Probable match requires confirmation | `asset-matcher.test.ts`; `acceptance-matrix.test.ts` |
| 7 | Imports don't overwrite approved data | `approval.test.ts`; `acceptance-matrix.test.ts` |
| 8 | UNS/i3X stay proposed until approved | `approval.test.ts`; `acceptance-matrix.test.ts` |
| 9 | Telegram enters the same pipeline | `mira-bots/tests/test_telegram_hub_intake.py`; `acceptance-matrix.test.ts` (same validator) |
| 10 | Sanitized bundle has no raw documents | `mira-contextualizer/tests/test_bundle.py`, `test_demo_garage_conveyor.py` |
| 11 | Full bundle preserves provenance | `mira-contextualizer/tests/test_bundle.py`, `test_demo_garage_conveyor.py` |
| 12 | Conveyor demo imports → non-empty staged context | `test_demo_garage_conveyor.py` (offline) + `import.integration.test.ts` (Hub) |

`acceptance-matrix.test.ts` is the single traceable artifact: it runs one cohesive offline→Hub flow
(validate → map → match → approve) and pins every row above. Run it with `npm test`.

## Run the matrix

```bash
# Hub unit layer (rows 1, 4–9 + cohesive flow) — no DB
cd mira-hub && npm test -- src/lib/contextualization/acceptance-matrix.test.ts

# Offline contextualizer (rows 10/11 + demo offline half)
cd mira-contextualizer && python -m pytest tests/test_demo_garage_conveyor.py

# DB-backed rows (2, 3, 12 Hub half) — see docs/runbooks/garage-conveyor-demo.md
cd mira-hub && npm run test:integration   # requires TEST_DATABASE_URL (migrations 055+056)
```

See `docs/runbooks/garage-conveyor-demo.md` for the end-to-end Garage Demo / Micro820 Conveyor walk.
