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

**Consolidated regression: 202 passing** (128 parser + 68 simlab + 6 proveit; +3 skips), no regressions.

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
2. **Phase 2 — grounding** (cite the factory's own data): the **offline transform is DONE**
   (`cb97ae2e`, `tools/proveit/pilot_db_chunks.py` → 6,023 citable chunks). **Remaining (infra):**
   embed each chunk (nomic-embed) + `insert_knowledge_entries_batch` into `knowledge_entries`
   (the **only** citable path — GUI/OW KB is non-citable; `knowledge-entries-tenant-scoping.md`), and
   a local **manual PDF → knowledge_entries** path. The batch inserter currently hardcodes
   `is_private=false` — it must honor the rows' `is_private=true` for this per-tenant corpus.
   **Needs:** NeonDB + embedder (infra), the `proveit` tenant, and a **real beverage-bottling manual
   PDF** (none in the corpus). To resolve WO `assetid`→UNS, pass the import engine's asset roster as
   `asset_uns_by_id`.
3. **Phase 3 — live broker stand-up**: run **1 Mosquitto** (or the MIT Flexware EMQX sim) and point
   `SIMLAB_MQTT_HOST` at it; for the *foreign* feed, add a read-only subscriber (`mira-relay/
   mqtt_ingest/`) + topic→UNS normalizer + `live_signal_cache` landing. **Wiring is done on our side
   (commit `cfe42179`); the broker is Mike's to stand up** ("OK to stand up staging Mosquitto/
   Flexware").
4. **Phases 4–6** — visualize live values in `/command-center`; wire the **real Supervisor** into the
   SimLab self-scoring dashboard; full 20-min rehearsal arc. Depend on 1b/2/3.

## Exact next steps
- **No-infra:** the next self-contained brick is the **local manual PDF → chunks** transform
  (Docling chunk, no embed) mirroring `pilot_db_chunks` — then a `proveit` CLI that runs both
  transforms + the import engine end-to-end and writes a dry-run report.
- **Open a PR** for this branch: `gh pr create` then `gh pr merge <n> --squash --admin` (phantom
  `Hub E2E` check blocks non-admin merges — `project_branch_protection_phantom_check`).
- **From Mike:** provision the `proveit` tenant; stand up staging Mosquitto/Flexware; supply a real
  Cappy Hour / Krones-style manual PDF; decide ProveIt 2027 sponsorship (Bronze ~$7.5k → official
  spec ~mid-Oct 2026).

## Guardrails honored
Read-only OT throughout; licensed corpus never committed; UNS paths via `uns.slug`; additive IR (no
churn to L5X/CSV/ST or the 63-test simlab baseline); evidence-backed (real-file counts + green
suites), no faked confidence.
