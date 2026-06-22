# RESUME — ProveIt 2027 buildout (2026-06-22)

Pick up exactly where this session left off. Companion to `Prompt.txt` (the original brief) and the
two canonical plans: `docs/plans/2026-06-22-proveit-factory-import-implementation-plan.md` and
`docs/plans/2026-06-22-proveit-2027-demo-runbook.md`.

## Where we are (branch `feat/cappy-hour-import-engine`, off `origin/main`)

Three committed, tested increments — both halves of the session goal ("all data points
contextualized" + "sim factory live") now stand on green code, at the layer reachable **without**
Mike's infra.

| Commit | What | Evidence |
|---|---|---|
| `36adfd84` | **Phase 1a — Cappy Hour import engine** (Ignition tag-JSON → ISA-95 namespace) | real `Enterprise B/tags.json`: 1 enterprise · 1 site · 4 areas · 15 lines · **43 assets** (UDT type + MES binding each) · **4,090 signals** (314 eng-unit) = **4,154 nodes**; i3X export = 4,154 instances, single root, **0 dangling parents**. 12 new tests; parser suite 128 green. |
| `b67d3445` | **MqttPublisher hardening** (3 bugs: frozen/mistyped ts, deprecated `get_event_loop()`, GC'd fire-and-forget task) | 4 regression tests via fake aiomqtt; simlab suite green. |
| `cfe42179` | **Live-feed wiring** — `SimEngine.advance()` streams a snapshot to attached publishers; `build_app` opt-in via `SIMLAB_MQTT_HOST` | 5 new tests; full simlab suite **68 passed, 3 skipped**; ruff clean. Additive — no publisher attached = byte-for-byte prior behavior. |
| `cb97ae2e` | **Phase 2 offline grounding** — Pilot DB → citable chunks (`tools/proveit/pilot_db_chunks.py`) | real export: 22 items · 33k lots · 6k WOs · 15 states → **6,023 citable chunks** (joined Item→Lot→WO→Asset + state glossary), all `is_private=true`, embed/insert deferred. 6 tests; ruff clean. |
| `5e075b89` | **Batch inserter honors per-row `is_private`/`verified`** (`mira-core/mira-ingest/db/neon.py`) | the inserter hardcoded `false,false`; now bound per-row, default `False` (every OEM caller unchanged), so the proveit per-tenant corpus lands `is_private=true`. **This is item 2's code precondition — DONE.** 2 mock-SQL tests; ruff clean. |
| `afa36872` | **Manual→chunks transform + end-to-end dry-run CLI** (`tools/proveit/manual_chunks.py`, `cli.py`) | `chunk_markdown` (section-aware; lazy Docling hook for a real vendor PDF) + `parse_asset_uns_table` (Vessel-spec **Asset ID → UNS Path** → asset roster, bridges WO grounding). `python tools/proveit/cli.py report <CORPUS>` runs all 3 transforms end-to-end, **no DB writes**, writes a dry-run report. 10 tests on synthetic fixtures. |

**Real-corpus dry-run (output not committed):** 1 ent · 1 site · 4 areas · 15 lines · 43 assets · 4090 signals; **6,198 `knowledge_entries` rows** (6,000 WOs, **3,000/6,000 grounded to a vat UNS path** via the 18-asset roster; 22 items; 1 state glossary; 175 manual chunks from 3 real Enterprise B specs) — all `is_private=true`, all unembedded.

**Consolidated regression: 214 passing** (128 parser + 68 simlab + 16 proveit + 2 new ingest batch tests; +3 skips), no regressions.

### What "done" means here
- **Contextualize:** `python -m mira_plc_parser analyze "<…>/Enterprise B/tags.json"` and
  `… i3x-export …` both explain the real factory structure offline (read-only, no DB). The licensed
  corpus stays in `../proveit-factory/` and is **never committed** (synthetic mini fixture only:
  `mira-plc-parser/tests/fixtures/ignition_cappy_hour_mini.json`).
- **Sim live:** `python -m simlab` serves on :8099; set `SIMLAB_MQTT_HOST=<broker>` to stream every
  tick to MQTT, read-only (publish-out only; no PLC writes).

## What remains — and why it is infra / human-gated (NOT autonomous)

These map to the import plan's later phases. Each needs an **Open input from Mike** (see `Prompt.txt`
and the plan's "Open inputs needed"). They are correctly **handed off**, not done blind, because they
cross environment / dependency / schema boundaries (`.claude/rules/session-discipline.md` §4,
`docs/environments.md`).

1. **Phase 1b — Hub bulk ingestion** (`mira-hub`): widen `/api/v1/ingestion/tag-import` to the
   parser IR/i3x JSON; create `kg_entities` (site/area/line/asset) + `ai_suggestions(type=tag_mapping)`
   as `proposed`; batch/subtree approve; paginated reconciliation UI. **Needs:** a provisioned
   `proveit` tenant (UUID `tenants` row) + DB migrations dev→staging→prod via `apply-migrations.yml`
   (`mira-hub-migrations.md` — TEXT-vs-UUID `tenant_id` discipline). **Gate:** `/namespace` renders
   the Cappy Hour tree; a human bulk-approves an asset subtree.
2. **Phase 2 — grounding** (cite the factory's own data): the **offline transforms are DONE** —
   Pilot DB (`cb97ae2e`) **and** the manual/spec path + asset-roster bridge + end-to-end dry-run CLI
   (`afa36872`), and the batch inserter now honors `is_private=true` (`5e075b89`). The dry-run shows
   **6,198 rows** ready (incl. 3,000 WOs grounded to real vat paths). **Remaining is pure infra:**
   embed each row (nomic-embed) + `insert_knowledge_entries_batch` into `knowledge_entries` (the
   **only** citable path — GUI/OW KB is non-citable; `knowledge-entries-tenant-scoping.md`). The
   inserter already honors the rows' `is_private=true`; the rows already carry deterministic
   content-hash ids (re-run de-dups). **Needs:** NeonDB + embedder (infra) + the `proveit` tenant.
3. **Phase 3 — live broker stand-up**: run **1 Mosquitto** (or the MIT Flexware EMQX sim) and point
   `SIMLAB_MQTT_HOST` at it; for the *foreign* feed, add a read-only subscriber (`mira-relay/
   mqtt_ingest/`) + topic→UNS normalizer + `live_signal_cache` landing. **Wiring is done on our side
   (commit `cfe42179`); the broker is Mike's to stand up** ("OK to stand up staging Mosquitto/
   Flexware").
4. **Phases 4–6** — visualize live values in `/command-center`; wire the **real Supervisor** into the
   SimLab self-scoring dashboard; full 20-min rehearsal arc. Depend on 1b/2/3.

## Exact next steps
- **No-infra bricks are DONE** (`5e075b89` + `afa36872`): the manual→chunks transform, the asset-roster
  bridge, the `is_private` inserter fix, and the end-to-end dry-run CLI all shipped + tested. The
  agent-side half of Phase 2 is complete — what's left is genuinely infra (below).
- **Run the dry-run to see exactly what would be ingested:**
  `python tools/proveit/cli.py report "../proveit-factory/uns-docs/Enterprise B" --tenant proveit --out /tmp/proveit`
  (writes `proveit-dry-run.{json,md}`; reads the licensed corpus locally, writes nothing back).
- **Open a PR** for this branch: `gh pr create` then `gh pr merge <n> --squash --admin` (phantom
  `Hub E2E` check blocks non-admin merges — `project_branch_protection_phantom_check`).
- **From Mike (the only remaining gates):**
  1. Provision the `proveit` tenant (UUID `tenants` row) + run the Hub migrations dev→staging→prod
     (item 1 — Hub bulk ingestion endpoint/UI still to author once the tenant exists).
  2. With NeonDB + the nomic embedder reachable: embed the 6,198 dry-run rows and
     `insert_knowledge_entries_batch` them (the inserter now honors `is_private=true`; rows de-dup by id).
  3. Stand up staging Mosquitto/Flexware and point `SIMLAB_MQTT_HOST` at it (wiring done, `cfe42179`).
  4. *(Optional)* drop a real Cappy Hour / Krones-style manual **PDF** in the corpus — the code path
     exists (`manual_chunks.chunk_pdf`, lazy Docling); 3 real Enterprise B markdown specs already chunk
     (175 chunks), so the manual-citation path is provable today without it.
  5. Decide ProveIt 2027 sponsorship (Bronze ~$7.5k → official spec ~mid-Oct 2026).

## Guardrails honored
Read-only OT throughout; licensed corpus never committed; UNS paths via `uns.slug`; additive IR (no
churn to L5X/CSV/ST or the 63-test simlab baseline); evidence-backed (real-file counts + green
suites), no faked confidence.
