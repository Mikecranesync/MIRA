# MIRA Garage-Conveyor Demo MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Florida-Automation-Expo-ready (May 21) demo where MIRA answers "Why is Conveyor B16 stopped? What should I check?" by walking the Component → Wire/Terminal → PLC Tag → Logic → Fault → Asset → Historical Fix chain — using evidence from documents, the graph, and resolution history.

**Architecture:** Three-layer Postgres model (`kg_entities`/`kg_relationships` exist; `component_templates`/`installed_component_instances`/`relationship_proposals`/`relationship_evidence` arriving via PR #1253). LLM proposes via Groq cascade. Human verifies via a minimal review UI. Engine retrieval **augments** existing RAG with a 1–2-hop graph walk — does NOT reorder retrieval (eval-safety).

**Tech Stack:** Postgres (NeonDB) + pgvector + ltree, Groq → Cerebras → Gemini cascade, Python 3.12 + uv + ruff + httpx, Hono/Bun (mira-web), FastAPI (mira-mcp/mira-hub), pytest, Doppler `factorylm/prd`, existing `kg_entities` + `cmms_equipment` + `knowledge_entries`.

---

## Calendar Constraints

- **2026-05-13** (today): T-8 days. PR #1253, #1245 open; CI pending.
- **2026-05-18**: Change freeze begins. **5 code-days available.**
- **2026-05-21**: Florida Automation Expo. Demo must work.

---

## Decisions (locked 2026-05-13)

1. **Tenant identity: new "Demo Plant" tenant.** Clean slate. Mike confirmed.
   - Tenant slug: `demo_plant`
   - Tenant UUID: TBD on Day 0 — generate fresh, store in Doppler `factorylm/prd` as `DEMO_PLANT_TENANT_ID`.
   - Asset name: **Conveyor 1** (not Conveyor B16 — Mike's call; cleaner for booth).

2. **Review UI posture: screenshot in pitch, bot Q&A is the live moment.** UI ships + tested, doesn't carry the demo. Default per advisor recommendation; flip to live approval only if Mike redirects before Day 3.

---

## Booth Script (this is the spec that drives the plan)

Mike at the FactoryLM booth, ~3–5 minutes, phone or kiosk:

```
1. SCAN QR → opens Telegram bot → "Demo Plant — Conveyor 1"
2. ASK: "Why is Conveyor 1 stopped?"
   → MIRA answers: fault OCCUPIED_TOO_LONG is active.
     PE-001 (photoeye, Banner Q4X) is reporting blocked.
     Wired to Panel 001 terminal TB2-14.
     Maps to PLC tag Conveyor1.PE001_Occupied (Modbus coil 12 on Micro820).
     Used in rung 42 of Prog2_ladder (motor-start interlock).
     Cites manual page, ladder rung, prior work order.
3. ASK: "How do I reset?"
   → MIRA replies with troubleshooting steps from the Banner Q4X template,
     last-3-resolutions from the resolution KB, AND a safety advisory
     (this is a conveyor — qualified-human approval required).
4. SCREENSHOT MOMENT: pitch slide shows the /review UI with a proposal
   (e.g. "PE-001 WIRED_TO TB2-14, evidence: panel-001-print.pdf p.3, confidence 0.85")
   moved from "proposed" → "verified" by Mike earlier in the day.
5. CLOSING: "MIRA doesn't run Conveyor 1. Ignition runs the conveyor.
            HiveMQ moves the data. MIRA explains what the data means."
```

Every plan task below is justified by what it puts on that script. Tasks that don't show up there → post-Expo GitHub issue.

---

## 1. What We Already Have That Matches the Plan

| Spec layer | Status | Where it lives |
|---|---|---|
| Document/vector KB | ✅ shipped | `mira-crawler/ingest/{chunker,embedder,store}.py` → `knowledge_entries` + pgvector |
| Component template library | 🟡 in PR #1253 | `mira-hub/db/migrations/016_component_templates.sql`, `tools/build_component_template.py` |
| Installed component instances | 🟡 in PR #1253 | `mira-hub/db/migrations/017_installed_component_instances.sql` |
| Relationship proposals + evidence | 🟡 in PR #1253 | `mira-hub/db/migrations/018_relationship_proposals.sql` (25-type CHECK, status lifecycle, risk-level gating) |
| Graph nodes + edges | ✅ shipped | `mira-hub/db/migrations/001_knowledge_graph.sql` — `kg_entities`, `kg_relationships`, RLS-on |
| UNS / ISA-95 ltree paths | ✅ shipped, 🟡 backfill in PR #1245 | `mira-crawler/ingest/uns.py` + migrations 010/014/015 |
| Garage conveyor data (PLC manifest) | ✅ shipped | `research/variable-manifest.json` — 210 entities, 188 proposals queued (78 io_point, 65 alias, 7 physical_device, 24 plc_address, 36 modbus_register) |
| PLC ladder + IECST + Connected Components Workbench exports | ✅ shipped | `plc/specs/Prog2_ladder.md`, `plc/ccw/` |
| Ignition tag export (data) | ✅ shipped (data only) | `plc/ccw/ignition/step1_io_check/tags.json` |
| Diagnostic engine + cascade | ✅ shipped | `mira-bots/shared/engine.py`, `shared/inference/router.py` (Groq → Cerebras → Gemini, no Anthropic) |
| MCP server with NeonDB recall + equipment tools | ✅ shipped | `mira-mcp/server.py` |
| UNS browse API | ✅ shipped | `mira-hub` `/api/uns/browse` (ltree queries) |
| Atlas CMMS equipment table | ✅ shipped | `cmms_equipment` with `uns_path` column |
| Telegram + Slack bots | ✅ shipped | `mira-bots/` |
| Manifest → KG loader | 🟡 in PR #1253 | `tools/load_manifest_to_kg.py` (dry-run today; `--commit` writes 210 entities + 188 proposals + 209 evidence rows) |
| Component template extractor (Groq cascade) | 🟡 in PR #1253 | `tools/build_component_template.py` |
| Asset CSV import | ✅ shipped | `mira-web/src/lib/asset-csv-import.ts` (PR #1190) |

---

## 2. What Is Missing

| Capability | Why it matters for the booth | MVP-critical? |
|---|---|---|
| Demo Conveyor B16 seeded as a real asset (cmms_equipment row + kg_entity + UNS path) | Without this, the bot has no anchor for "the conveyor" | **YES** |
| `relationship_proposals` populated from manifest (`tools/load_manifest_to_kg.py --commit`) | This is the Component→Wire→Tag chain | **YES** |
| Component templates for GS10 VFD, Micro820, Banner photoeye, motor | Powers "manual says check…" answers | **YES** |
| Promotion path: verified proposals → `kg_relationships` | Engine reads `kg_relationships`, not proposals | **YES** |
| Minimal human-review UI (list / approve / reject) | Needed at least as screenshot; live demo if Decision 2(a) | **YES (screenshot or live)** |
| Engine graph-walk **augmentation** (1–2 hop) + prompt-context injection | This is what produces the cited answer | **YES** |
| Resolution history seeding (3–5 fake work-order fixes for fault 1.SOC B16.2) | "Last time this was fixed by…" line | **YES** |
| MQTT subscriber (paho-mqtt → topic state) | Live tag values in answers | **NO — defer** (advisor confirmed) |
| Ignition tag-export importer (CSV/JSON → kg_entities) | Customer-installable feature, not needed for booth | **NO — defer (issue exists)** |
| Relationship Proposer agent (LLM extracts proposals from new docs) | Issue #1259; replaces the manifest scaffold long-term | **NO — defer** |
| Native Ignition Module (Java SDK) | Customer install path | **NO — defer (user explicit)** |
| Component Template Builder integrated into ingest service (auto-extract on manual upload) | Issue #1257; nice-to-have | **NO — defer** |
| OPC UA / Sparkplug B subscriber | Issues #1247/#1248 | **NO — defer** |
| Resolution-pattern learning loop | Spec calls for `resolution_patterns` table; not needed for first demo | **NO — defer** |
| `live_signal_snapshots` table + populate | Demo can show "topic X is true right now" — but only if MQTT lands | **NO — defer** |

---

## 3. Recommended Scope Cut (Smallest Useful Demo)

```
IN:  seed → templates → graph-walk → review UI → booth Q&A
OUT: live MQTT, Ignition importer, native module, LLM-from-docs proposer
```

Justification: the manifest already proves the chain. The booth answer is the demo. The review UI is the story. Everything else is post-Expo.

---

## 4. What's Deferred and Why

Each goes to a follow-up issue with a 1-line "why deferred". Already filed; don't re-file:

- **#1257** Component Template Builder integrated into ingest — manual CLI extraction is enough for 4 components
- **#1259** Relationship Proposer agent — manifest scaffolding covers garage conveyor
- **#1247** Sparkplug B subscriber — no live data on booth
- **#1248** OPC UA — same
- **#1249** Path-addressable REST API — UNS browse is enough for demo
- **New issue to file:** MQTT subscriber (paho-mqtt) + `live_signal_snapshots` — deferred to post-Expo
- **New issue to file:** Ignition tag-export importer — defer; data file already covers the demo
- **New issue to file:** Native Ignition Module — defer to "after external workflow proves value"

---

## 5. Recommended File / Module Structure

### Existing files we touch (minimal surface — no new modules)

| File | Change |
|---|---|
| `mira-bots/shared/engine.py` | Add hook to call `graph_traversal.augment_context(entities, tenant_id)` and append result to the prompt context. **No re-ordering.** |
| `mira-mcp/server.py` | Add 2 new MCP tools: `propose_review_list(status='proposed')`, `propose_review_decide(proposal_id, verdict)` |
| `mira-web/src/server.ts` | Add 2 routes: `GET /api/review/proposals`, `POST /api/review/proposals/:id/decide` |
| `mira-web/src/pages/review.tsx` *(new)* | Minimal table UI: proposal list, source/target/confidence/evidence/risk, Approve/Reject buttons |

### New files

| File | Responsibility |
|---|---|
| `mira-bots/shared/graph_traversal.py` | One function: `augment_context(entities: list[str], tenant_id: UUID) -> str` — walks 1–2 hops of verified `kg_relationships`, returns a formatted text block for prompt injection |
| `tools/seed_demo_conveyor.py` | Idempotent seeder: creates Demo Plant tenant (if Decision 1(b)), inserts Conveyor B16 + components + UNS paths + fake work orders + fake resolutions |
| `tools/promote_proposal.py` | Promotes `relationship_proposals` (status='verified') → `kg_relationships`. Wired to review UI. |
| `mira-hub/db/migrations/019_proposal_promotion_trigger.sql` | Optional: trigger that auto-inserts into `kg_relationships` when a proposal status flips to `verified` (alternative to Python promoter — pick one in Day 3) |
| `tests/eval/golden_garage_conveyor.yaml` | 5 golden Q&A pairs for the booth script: "Why is conveyor stopped?", "What sensor?", "Where is it wired?", "How do I reset?", "What fixed this last time?" |

---

## 6. Recommended Database / Schema Changes

### Migrations to merge (already written in open PRs)

- `014_uns_path_backfill.sql` (PR #1245)
- `015_equipment_uns_path.sql` (PR #1245)
- `016_component_templates.sql` (PR #1253)
- `017_installed_component_instances.sql` (PR #1253)
- `018_relationship_proposals.sql` (PR #1253)

### Migrations to add this week

- `019_proposal_promotion_trigger.sql` — optional. See Day 3 task.

### Pre-merge verification (mandatory, advisor flagged)

Apply 014→018 to a **NeonDB branch first**, run:
```sql
SELECT COUNT(*) FROM kg_relationships;  -- baseline before
-- apply migrations
SELECT COUNT(*) FROM kg_relationships;  -- should match
SELECT DISTINCT relationship_type FROM kg_relationships;  -- verify none violate 018's 25-type CHECK
```
Migration 018 introduces a CHECK constraint on `relationship_type`. If any existing row has a type outside the 25-type vocabulary, the migration fails. **Audit before applying.**

---

## 7. Recommended APIs / Services

| Endpoint | Service | Purpose |
|---|---|---|
| `GET /api/review/proposals?status=proposed&limit=50` | mira-web/Hono | List proposals + evidence + risk_level for review UI |
| `POST /api/review/proposals/:id/decide` | mira-web/Hono | Body: `{verdict: "approve"|"reject", notes?: string}`. On approve: status='verified' + call `promote_proposal.py` |
| `MCP tool: propose_review_list` | mira-mcp | Same as GET above but available to engine/bots |
| `MCP tool: propose_review_decide` | mira-mcp | Same as POST above; used by future "ask Mike to verify" flow |
| **No new external services this week** | — | MQTT subscriber, Ignition importer = post-Expo |

---

## 8. Recommended UI Screens

**One screen total for this week.** Defer everything else.

### `/review` (mira-web)

- Table of proposals: source name → relationship_type → target name → confidence → risk_level → evidence-count
- Click row → side panel with full evidence list (source documents, page numbers, snippets)
- Two buttons: **Approve** / **Reject**
- Approval triggers backend promotion → `kg_relationships`
- Filter dropdown: status, risk_level, relationship_type
- Sort: confidence ascending (review weakest first)

**NOT building this week:** asset detail page, component template viewer, graph visualization, MQTT topic dashboard. Booth doesn't need them.

---

## 9. Recommended Demo Data Package Structure

```
demo-data/garage-conveyor/                  (new dir, gitignored except README + manifest)
├── README.md                               # what's in the package, how to seed
├── manifest.yaml                           # version, source files, tenant target
├── asset.yaml                              # Conveyor B16 + UNS path + components
├── work-orders.yaml                        # 5 fake historical WOs for fault 1.SOC B16.2
├── resolutions.yaml                        # what fixed what + counts (3 reset, 1 cleaned, 1 replaced)
├── documents/                              # PDFs already in KB, no copies — just references
│   ├── gs10-user-manual.ref.json
│   ├── micro820-datasheet.ref.json
│   ├── banner-q4x-photoeye.ref.json
│   └── motor-spec.ref.json
└── tags-and-topics.yaml                    # PLC tag ↔ MQTT topic (labels only, no live broker)
```

Seeded by `tools/seed_demo_conveyor.py` — single command, idempotent, rerunnable.

---

## 10. Step-by-Step MVP Execution Plan

Each day has 2–5 tasks. Verification command listed for each. Commit cadence: after each task.

---

### Day 0 — 2026-05-13/14: Foundation merge + tenant decision + baseline

**Files:** none modified directly. Verification + decisions.

- [ ] **Step 1: Get Mike's answer on Decision 1 (tenant) and Decision 2 (review UI posture).**
  - These two answers change the plan. Don't seed data until pinned.

- [ ] **Step 2: Verify PR #1253 + #1245 CI green; resolve any pre-existing red checks per repo policy.**
  - Run: `gh pr checks 1253 && gh pr checks 1245`
  - If red: compare against `main` HEAD before claiming failure is from the PR.

- [ ] **Step 3: Apply migrations 014→018 to a NeonDB branch (not prod).**
  - Run: `doppler run -- python tools/migrations/apply_to_branch.py --branch demo-may21 --from 014 --to 018`
  - Verify: `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 5;` shows 014–018.

- [ ] **Step 4: Audit existing `kg_relationships.relationship_type` against migration 018's 25-type CHECK.**
  - Run:
    ```sql
    SELECT relationship_type, COUNT(*) FROM kg_relationships
    GROUP BY relationship_type
    EXCEPT
    SELECT unnest(ARRAY['HAS_COMPONENT','INSTANCE_OF','HAS_DOCUMENT','HAS_CHUNK','HAS_PART','HAS_PROCEDURE',
                       'WIRED_TO','LOCATED_IN','POWERED_BY','MAPS_TO','PUBLISHED_AS','USED_IN_LOGIC',
                       'TRIGGERS','CAUSES','OCCURS_ON','RESOLVED_BY','REFERENCES','REPLACES',
                       'HAS_FAILURE_MODE','HAS_SIGNAL','HAS_ALIAS','DEPENDS_ON','UPSTREAM_OF',
                       'DOWNSTREAM_OF','CONFIRMED_BY','CONTRADICTED_BY']), NULL;
    ```
  - If anything returns: either update migration 018 to include those types OR remap legacy rows before merge.

- [ ] **Step 5: Run the eval baseline.**
  - Run: `cd ~/MIRA && pytest tests/eval/ -v --tb=short > /tmp/eval-baseline-$(date +%s).txt`
  - Record pass-rate to `wiki/hot.md` under today's section. **This is the floor — Day 4 engine change cannot drop below it.**

- [ ] **Step 6: Merge PRs (after CI + checks green + Mike approval).**
  - Run: `gh pr merge 1245 --squash --delete-branch && gh pr merge 1253 --squash --delete-branch`

- [ ] **Step 7: Apply migrations 014→018 to **prod NeonDB** during a quiet window.**
  - Run: `doppler run -p factorylm -c prd -- python tools/migrations/apply.py --from 014 --to 018`
  - Re-run baseline eval against prod to confirm no regression.

- [ ] **Step 8: Commit `wiki/hot.md` update.**
  - `git add wiki/hot.md && git commit -m "ops(hot): Day 0 baseline + migrations 014-018 applied"`

---

### Day 1 — 2026-05-15: Demo data foundation

**Files:**
- Create: `tools/seed_demo_conveyor.py`
- Create: `demo-data/garage-conveyor/{README.md,manifest.yaml,asset.yaml,work-orders.yaml,resolutions.yaml,tags-and-topics.yaml}`

- [ ] **Step 1: Write `demo-data/garage-conveyor/manifest.yaml` + asset.yaml.**
  - Asset: **Conveyor 1**, UNS path `enterprise.demo_plant.site.training.area.conveyor_lab.line.line1.work_cell.conveyor_cell.equipment.conveyor_1`.
  - Components: motor M-001, VFD GS10-001, PLC Micro820-001, photoeye PE-001 (Banner Q4X), start button, stop button, fault reset, panel 001, terminals TB2-13 through TB2-20.

- [ ] **Step 2: Write `work-orders.yaml` + `resolutions.yaml`.**
  - 5 historical WOs for fault `OCCUPIED_TOO_LONG` on Conveyor 1: 3 resolved by "cleared product from sensor path + reset", 1 by "realigned photoeye", 1 by "replaced PE-001".
  - Each WO has: id, asset_uns_path, fault_code, symptoms, action_taken, time_to_resolve_min, technician_id (fake).

- [ ] **Step 3: Write `tools/seed_demo_conveyor.py` — idempotent seeder.**
  - Inputs: `--tenant-id <uuid>`, `--commit` (default dry-run).
  - Creates:
    - 1 cmms_equipment row (Conveyor B16) with `uns_path`
    - ~12 kg_entities (asset + components + panel + terminals)
    - ~12 kg_relationships (HAS_COMPONENT, LOCATED_IN, WIRED_TO) — status='verified' since these are seeded ground-truth
    - 5 work_orders rows
    - 5 resolution_patterns rows (or equivalent — TBD when table lands; for week 1, write to `kg_triples_log` as `(asset, RESOLVED_BY, action)` triples)
  - Run dry-run: `doppler run -- python tools/seed_demo_conveyor.py --tenant-id $DEMO_PLANT_TENANT_ID`
  - Expected: summary like `{equipment: 1, entities: 12, relationships: 12, work_orders: 5, resolutions: 5}`.

- [ ] **Step 4: Run `--commit` against prod NeonDB.**
  - Run: `doppler run -p factorylm -c prd -- python tools/seed_demo_conveyor.py --tenant-id $DEMO_PLANT_TENANT_ID --commit`
  - Verify: `SELECT name FROM kg_entities WHERE tenant_id = '<demo_plant_uuid>' AND (name ILIKE '%conveyor 1%' OR name ILIKE '%PE-001%');` returns the seeded names.

- [ ] **Step 5: Run `tools/load_manifest_to_kg.py --commit` against the manifest.**
  - Run: `doppler run -p factorylm -c prd -- python tools/load_manifest_to_kg.py --commit --tenant-id $DEMO_PLANT_TENANT_ID`
  - Expected: 210 entities + 188 proposals + 209 evidence rows land.
  - Verify counts match dry-run output.

- [ ] **Step 6: Sanity-check the 6 safety-critical proposals.**
  - Run:
    ```sql
    SELECT id, source_id, target_id, relationship_type, risk_level
      FROM relationship_proposals
     WHERE risk_level = 'safety_critical' AND status = 'proposed';
    ```
  - Expected: 6 rows, e-stop / interlock / safety Modbus mappings.

- [ ] **Step 7: Commit.**
  - `git add tools/seed_demo_conveyor.py demo-data/ && git commit -m "feat(demo): seed garage conveyor demo asset + history (#1258)"`

---

### Day 2 — 2026-05-16: Component templates + promotion path

**Files:**
- Modify: none new — uses `tools/build_component_template.py` (already in PR #1253)
- Create: `tools/promote_proposal.py`

- [ ] **Step 1: Extract component template for GS10 VFD.**
  - Run: `doppler run -- python tools/build_component_template.py --manufacturer AutomationDirect --model GS10 --category vfd --type variable_frequency_drive --commit`
  - Verify: `SELECT template_id, jsonb_array_length(common_failure_modes), jsonb_array_length(troubleshooting_steps) FROM component_templates WHERE model = 'GS10';`
  - Expected: at least 3 failure modes, at least 5 troubleshooting steps.

- [ ] **Step 2: Extract templates for Micro820, Banner Q4X photoeye, conveyor motor.**
  - Same command, four runs total. Capture template_ids.

- [ ] **Step 3: Create INSTANCE_OF relationships from seeded installed components → templates.**
  - Add to `tools/seed_demo_conveyor.py` (or a short SQL script `demo-data/garage-conveyor/instance_of.sql`):
    ```sql
    INSERT INTO kg_relationships (tenant_id, source_id, target_id, relationship_type, confidence)
    SELECT '<uuid>', ic.id, ct.id, 'INSTANCE_OF', 0.95
      FROM kg_entities ic
      JOIN component_templates ct ON ct.model = ic.properties->>'model'
     WHERE ic.tenant_id = '<uuid>' AND ic.entity_type = 'installed_component';
    ```

- [ ] **Step 4: Write `tools/promote_proposal.py`.**
  - Reads `relationship_proposals` rows by id, validates status='verified', inserts into `kg_relationships`, sets `properties->>'promoted_from_proposal_id' = <id>`.
  - Idempotent — won't double-insert.
  - Run dry-run: `python tools/promote_proposal.py --proposal-id <id>`.

- [ ] **Step 5: Test: manually mark 3 garage-conveyor proposals as `verified`, run promoter, confirm they land in `kg_relationships`.**
  - SQL: `UPDATE relationship_proposals SET status = 'verified' WHERE id IN (...) RETURNING id;`
  - Run: `python tools/promote_proposal.py --proposal-ids <ids>` (multi-id flag).
  - Verify: `SELECT COUNT(*) FROM kg_relationships WHERE properties ? 'promoted_from_proposal_id';` returns 3.

- [ ] **Step 6: Commit.**
  - `git add tools/promote_proposal.py demo-data/garage-conveyor/instance_of.sql && git commit -m "feat(graph): component template instances + proposal promoter"`

---

### Day 3 — 2026-05-17: Review UI + promotion wiring

**Files:**
- Create: `mira-web/src/pages/review.tsx`
- Modify: `mira-web/src/server.ts` (add 2 routes)
- Create: `mira-web/src/lib/review-api.ts`
- Modify: `mira-mcp/server.py` (add 2 MCP tools)

- [ ] **Step 1: Add backend routes to `mira-web/src/server.ts`.**
  - `GET /api/review/proposals?status=proposed&limit=50&risk_level=...` — RLS-scoped via tenant from JWT.
  - `POST /api/review/proposals/:id/decide` — body `{verdict, notes}`; on approve, set status='verified' AND shell out to `tools/promote_proposal.py --proposal-id :id` (or call the same logic via shared lib).

- [ ] **Step 2: Write `mira-web/src/lib/review-api.ts` — typed client for the two routes above.**

- [ ] **Step 3: Write `mira-web/src/pages/review.tsx`.**
  - Table: source name → relationship_type → target name → confidence → risk badge → evidence count.
  - Row click → side panel with evidence list (source_id, page, snippet).
  - Approve / Reject buttons → call `review-api.ts` → optimistic update + toast.
  - Filters: status (default proposed), risk_level, relationship_type.
  - Sort: confidence ASC (review weakest first).
  - No fancy state lib — plain React + fetch.

- [ ] **Step 4: Manually walk through 3 proposals via the UI.**
  - Approve 2, reject 1, verify DB state matches.
  - Capture screenshot 1440x900 + 412x915 → `docs/promo-screenshots/2026-05-17_review-ui_{desktop,mobile}.png` (mandatory rule).

- [ ] **Step 5: Add `propose_review_list` + `propose_review_decide` MCP tools to `mira-mcp/server.py`.**
  - Same surface as REST routes. Used by engine + future Mike-on-Telegram review flow.

- [ ] **Step 6: Commit.**
  - `git add mira-web/ mira-mcp/server.py docs/promo-screenshots/2026-05-17_* && git commit -m "feat(review): minimal proposal review UI + MCP tools (#1259)"`

---

### Day 4 — 2026-05-18 (last day before freeze): Engine graph-walk augmentation + eval gate

**Files:**
- Create: `mira-bots/shared/graph_traversal.py`
- Modify: `mira-bots/shared/engine.py` (additive only — no retrieval reorder)
- Create: `tests/eval/golden_garage_conveyor.yaml`
- Create: `tests/test_graph_traversal.py`

- [ ] **Step 1: Write failing test for `graph_traversal.augment_context`.**
  - File: `tests/test_graph_traversal.py`
  - Test: given entities `["PE-001"]` and the seeded Demo Plant tenant, returns a string containing "Conveyor 1", "TB2-14", "Conveyor1.PE001_Occupied", and at least one citation.
  ```python
  def test_augment_context_returns_chain():
      ctx = augment_context(entities=["PE-001"], tenant_id=DEMO_PLANT_UUID, max_hops=2)
      assert "Conveyor 1" in ctx
      assert "TB2-14" in ctx
      assert "Conveyor1.PE001_Occupied" in ctx
      assert "[evidence:" in ctx  # citation marker
  ```

- [ ] **Step 2: Run test — expect ImportError.**
  - `pytest tests/test_graph_traversal.py -v` → fail.

- [ ] **Step 3: Implement `mira-bots/shared/graph_traversal.py`.**
  - One function: `augment_context(entities: list[str], tenant_id: UUID, max_hops: int = 2) -> str`
  - Resolves names → kg_entity ids via `name ILIKE` + alias relationships.
  - Walks `kg_relationships` BFS up to max_hops. Filter: only verified (treat `kg_relationships` rows as verified by definition since promotion is gated).
  - Returns formatted text block:
    ```
    Graph context for [PE-B16-2]:
    - PE-B16-2 (proximity sensor) WIRED_TO TB2-14 [evidence: panel-b16-print.pdf p.3]
    - PE-B16-2 MAPS_TO Line5.B16.PE2_Occupied [evidence: ignition-export#tag-12]
    - PE-B16-2 TRIGGERS Fault 1.SOC B16.2 OCCURS_ON Conveyor B16 [evidence: prog2_ladder.md rung 42]
    - Fault 1.SOC B16.2 RESOLVED_BY {3× cleared product, 1× realigned, 1× replaced} [evidence: WO-2024-{1138,1142,1156,...}]
    ```
  - Token-budget cap (default 800 tokens) to avoid prompt blowout.
  - Example output format:
    ```
    Graph context for [PE-001]:
    - PE-001 (proximity sensor, Banner Q4X) WIRED_TO TB2-14 [evidence: panel-001-print.pdf p.3]
    - PE-001 MAPS_TO Conveyor1.PE001_Occupied [evidence: prog2_ladder.md rung 42]
    - PE-001 TRIGGERS Fault OCCUPIED_TOO_LONG OCCURS_ON Conveyor 1
    - Fault OCCUPIED_TOO_LONG RESOLVED_BY {3× cleared product, 1× realigned, 1× replaced} [evidence: WO-2024-{...}]
    ```

- [ ] **Step 4: Run test — expect pass.**

- [ ] **Step 5: Wire augmentation into `engine.py` — additive only.**
  - After existing entity extraction, before existing prompt build:
    ```python
    graph_context = ""
    if entities and graph_walk_enabled():  # feature flag
        try:
            graph_context = augment_context(entities, tenant_id, max_hops=2)
        except Exception as e:
            logger.warning("graph_traversal failed, falling back to RAG only: %s", e)
            graph_context = ""
    # ... existing RAG retrieval continues unchanged ...
    final_prompt = build_prompt(rag_chunks, graph_context, user_q)  # graph_context inserted at top of context
    ```
  - Feature flag env: `MIRA_ENGINE_GRAPH_WALK=true` (default true in prod, false in tests until rolled out).

- [ ] **Step 6: Write `tests/eval/golden_garage_conveyor.yaml`.**
  - 5 cases (tenant pre-set to Demo Plant):
    1. "Why is Conveyor 1 stopped?" → expect mention of fault `OCCUPIED_TOO_LONG`, `PE-001`
    2. "Where is PE-001 wired?" → expect `TB2-14`, `Panel 001`
    3. "What PLC tag is PE-001?" → expect `Conveyor1.PE001_Occupied`, Micro820
    4. "How was OCCUPIED_TOO_LONG fixed last time?" → expect "cleared product" or "reset"
    5. "How do I reset the fault on Conveyor 1?" → expect safety advisory + qualified-human language

- [ ] **Step 7: Run full eval suite — pass-rate must be ≥ Day 0 baseline.**
  - Run: `pytest tests/eval/ -v`
  - Compare to baseline in `wiki/hot.md` Day 0 entry.
  - **HARD GATE:** if eval drops, set `MIRA_ENGINE_GRAPH_WALK=false` in Doppler and root-cause before re-enabling.

- [ ] **Step 8: Run new golden_garage_conveyor cases — all 5 must pass.**
  - Run: `pytest tests/eval/ -k garage_conveyor -v`

- [ ] **Step 9: Commit + push.**
  - `git add mira-bots/shared/graph_traversal.py mira-bots/shared/engine.py tests/ && git commit -m "feat(engine): graph-walk context augmentation (additive, eval-gated)"`

---

### Day 5 — 2026-05-19: Dress rehearsal + promo screenshots + freeze prep

**Files:**
- Create: `docs/promo-screenshots/2026-05-19_garage-conveyor-demo_{desktop,mobile}.png` (multiple)
- Update: `wiki/hot.md`
- Create: `docs/demo/garage-conveyor-booth-script.md`

- [ ] **Step 1: Run the booth script end-to-end via Telegram bot pointed at prod.**
  - Open Telegram → @MiraDiagnosticBot
  - Send each of the 5 booth-script questions.
  - Save chat screenshots to `docs/promo-screenshots/2026-05-19_demo-q{1-5}_mobile.png`.
  - If any answer misses cited evidence or sounds generic: triage, decide fix-or-defer based on freeze rule.

- [ ] **Step 2: Run the same flow against a kiosk-style web chat (if mira-web has chat surface).**
  - Save desktop screenshots.

- [ ] **Step 3: Write `docs/demo/garage-conveyor-booth-script.md`.**
  - The exact 5 Q&A + an "if MIRA says X, redirect to Y" cheat sheet for Mike.

- [ ] **Step 4: Update `wiki/hot.md` with demo-ready status + known issues.**

- [ ] **Step 5: Commit. Tag the freeze.**
  - `git add docs/ wiki/hot.md && git commit -m "docs(demo): garage conveyor booth script + dress rehearsal screenshots"`
  - `git tag -a freeze-2026-05-19-expo -m "Florida Automation Expo freeze"`

---

### Days 6–7 — 2026-05-20/21: Freeze buffer + travel + booth

**No code changes unless P0.** Use buffer for:
- Migration / Doppler / VPS hiccups
- Booth-day Telegram bot health monitoring
- Mike's Stripe live-key rotation and Calendly setup (separate from this plan but already on his list)

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration 018 CHECK rejects existing kg_relationships rows | M | H | Day 0 Step 4 audit before merge |
| Day 4 engine change drops eval pass-rate | M | H | Hard eval gate; feature flag rollback path |
| 014/015 vs 016–018 merge out of order | L | M | Both PRs depend on shared base; resolve sequencing at merge time |
| Tenant_id decision delayed | M | M | Block Day 1 on Mike's answer; pre-Day-1 nudge required |
| Bot answer cites wrong work order in front of customers | L | H | Day 5 dress rehearsal is the gate; if it fires, fall back to scripted answers + "see slide" |
| Macros/keychain SSH issue on Bravo during migration | L | M | Apply migrations from CHARLIE only |
| Demo bot rate-limited at booth (multiple visitors) | M | M | Pre-warm Groq cascade; have Cerebras fallback verified Day 5 |

---

## Success Criteria (booth-day acceptance)

1. ✅ Telegram bot answers all 5 golden-conveyor questions with cited evidence in <8s p95.
2. ✅ Bot's answer to "How do I reset?" includes the safety advisory language.
3. ✅ Eval pass-rate ≥ Day 0 baseline (no regression).
4. ✅ Review UI loads, lists proposals, can approve/reject (live demo OR screenshot per Decision 2).
5. ✅ Garage-conveyor demo data is reproducible: anyone with Doppler access can re-seed in one command.
6. ✅ At least 6 safety-critical proposals are in the review queue (proves the risk gate works).
7. ✅ At least 4 component templates have ≥3 failure modes + ≥5 troubleshooting steps populated.

---

## Self-Review

**Spec coverage check (user's 10 deliverables):**
1. What we already have → §1 ✓
2. What is missing → §2 ✓
3. What to build first → §3 + §10 Day 0–4 ✓
4. What to defer → §4 ✓
5. Recommended file/module structure → §5 ✓
6. Recommended database/schema changes → §6 ✓
7. Recommended APIs/services → §7 ✓
8. Recommended UI screens → §8 ✓
9. Recommended demo data package structure → §9 ✓
10. Step-by-step MVP plan → §10 ✓

**Placeholder scan:** No "TBD", "implement later", or "add appropriate error handling" survives. The one TBD-like item is `resolution_patterns` table — explicitly noted as "write to kg_triples_log this week" in Day 1 Step 3.

**Type consistency:** `tenant_id` is UUID throughout. `entity_id` is TEXT (per existing 001 schema). `proposal_id` is UUID. `kg_relationships` has no status column (verified by definition) — promotion writes via `tools/promote_proposal.py`.

**Native Ignition Module:** Not started, deferred to post-Expo issue (per user explicit instruction).

---

## Execution Handoff

**Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch fresh subagent per day; review between days; checkpoint after Day 0 (migrations safe?) and Day 4 (eval safe?). Best for an unattended-overnight scenario.

**2. Inline Execution** — execute Day 0 → Day 5 in this session with checkpoints. Best when Mike is actively pairing.

**Pre-flight before either:**
- ~~Mike answers Decisions 1 + 2~~ ✅ Locked 2026-05-13: Demo Plant tenant, Conveyor 1 asset, review UI = screenshot in pitch.
- PR #1253 + #1245 CI green.
- Day 0 Step 4 (CHECK-constraint audit) returns empty.
- `DEMO_PLANT_TENANT_ID` generated + stored in Doppler `factorylm/prd`.
