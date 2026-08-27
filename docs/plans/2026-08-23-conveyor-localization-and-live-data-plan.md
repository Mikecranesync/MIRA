# The Conveyor Walk — Localization and Live Data for CV-101

**Status:** DRAFT for Mike's review — 2026-08-23
**Scope:** the CV-101-specific execution layer under two parent documents. Do not read this as a replacement for either.

| Parent | What it owns | This document does NOT restate it |
|---|---|---|
| `docs/specs/mira-technician-app-dogfood-system.md` | What the system must be and must never do (§5 no-control-path, §7 currency rules, §9 admission, §11 failure table, §13 the fourteen cards, §14 evidence binding, §17 Definition of Done) | Read §7, §9, §11, §13 before the walk |
| `docs/plans/2026-08-23-technician-app-dogfood-implementation-plan.md` | The generic slice program (P01–P28), the killed slices, the migration numbering decision, the open questions | Slices below reference P-numbers rather than re-specifying them |

This plan is the conveyor-specific layer: one physical machine, one sticker, one frozen tag stream, one walk.

---

## 0. The one-paragraph state of the world

The QR system is real and already in the repo — Mike's instinct was right. The in-app scanner works. The tag-extraction grammar is pinned across two surfaces by a shadow test. The ingest path from the Ignition gateway to `tag_events` is read-only, HMAC-signed, fail-closed against an allowlist, and preserves the tag's own clock. The live gate is a pure, tested classifier. What does **not** exist is the wire between them: a scan resolves to a read-only asset card and stops, notebooks carry no asset reference at all, and the Hub calls a four-day-old bad-quality reading "observed now." The conveyor's live feed is **NO-GO today** (run 32625347755 — 5,028 rows, 12 tags, one distinct observed timestamp, 380,303 s observation age, every row `quality='bad'`). That is not an obstacle to this plan. It is the plan's first test: the product must learn to say *"live data is unavailable, and here is why"* before it earns the right to say *"here is what the conveyor is doing right now."*

---

## 1. What already exists

### 1.1 The QR system — built, and mostly correct

| Piece | Where | State |
|---|---|---|
| Printable sticker sheet | `mira-hub/src/app/(hub)/assets/print-qr/page.tsx:131` encodes `${origin}/m/${a.tag}`; renderer `mira-hub/src/components/qr-code.tsx`; linked from `assets/page.tsx:485` | Works |
| Second sticker producer (Avery PDF) | `tools/qr-label-pdf.py:72` (host hardcoded correctly); `mira-web/src/routes/admin/qr-print.ts:13` + `lib/qr-pdf.ts:36-49` | Works, but keys on `asset_qr_tags` — a different identity space |
| Permanent tag binding | `mira-hub/db/migrations/012_qr_permanent_binding.sql:20-21,44-46` (per-tenant partial UNIQUE); minted idempotently by `api/assets/[id]/qr/route.ts:15-60` | Works |
| Tag → asset resolution | `mira-hub/src/app/api/assets/by-tag/[tag]/route.ts:53` (regex), `:70` (`WHERE equipment_number = $1 AND tenant_id = $2`), `:76-78` (404 cross-tenant) | Works |
| In-app camera scanner | `mira-mobile/src/screens/ScanView.tsx:10,48-65` — `qr-scanner` over `getUserMedia`, 12 s start timeout `:40-42`, single-fire teardown before routing `:51-55`, explicit denied/no-camera states `:98-120`, mandatory manual-entry fallback `:124-139` | Works. **Not** the #3353 photo-picker defect, which is a separate `<input type=file capture>` at `NotebookScreen.tsx:1036-1050` |
| One tag-extraction funnel | `mira-mobile/src/lib/tags.ts:49-87` `extractAssetTag`, trust filter `:38-47`; three producers converge on it (`AssetsTab.tsx:64-71`, `App.tsx:28-31`, `ScanView.tsx:132-138`); pinned to the Hub by `docs/contracts/asset-tag-grammar.json` + `mira-mobile/src/lib/__tests__/tag-grammar-shadow.test.ts` | Works — this is the reuse point for every future localization method |
| Custom-scheme deep link | `AndroidManifest.xml:26-31`; listener registered pre-render at `mira-mobile/src/main.tsx:15-18` | Works |
| Telegram asset deep-link handler | `mira-bots/telegram/start_command.py:38,154,246` `_handle_asset_deep_link` — resolves `equipment_number` + `uns_path`, seeds `state["context"]["uns_context"] = {source:"direct_connection"}` | The one textbook-correct scan→certified-context implementation in the repo |

**Where it dead-ends.** Three places, all verified:

1. **Production `/m/{tag}` is not served by mira-hub.** `deployment/nginx-app-factorylm.conf:124-125` proxies `location /m/` to `127.0.0.1:3200` (mira-web) while `:341-342` sends `/` to `:3101` (mira-hub). mira-web resolves against `asset_qr_tags` (`lib/qr-tracker.ts:80-83`), a table disjoint from the `cmms_equipment.equipment_number` binding CV-101 actually has. Live: `GET https://app.factorylm.com/m/CV-101` → **302 → `/m/CV-101/register`** → a 200 page titled *"Register equipment — MIRA"* (`mira-web/src/routes/m-register.ts:86` — this is on main; it is **not** deploy divergence). The 561-line hub page at `mira-hub/src/app/m/[assetTag]/page.tsx` — with Ask MIRA, Create WO, View Manuals, recent WOs, sub-components, guest landing — is finished code that has never executed in production.
2. **The scan reaches an asset card and stops.** `mira-mobile/src/screens/AssetsTab.tsx:59-79` routes scan → `extractAssetTag` → `getAssetByTag` → `Detail`, whose only button is `← Back`. The file's own comment at `:402-405` names the gap: *"an asset has no namespace node… chat still requires a node, which is what a machine notebook gives it."*
3. **Notebooks have no asset reference.** `mira-hub/db/migrations/073_equipment_notebooks.sql:38-66` — no `equipment_entity_id`, no `uns_path`, no FK. The `asset_tag TEXT` column at `:47` is a decoy: written at `equipment-notebooks.ts:139`, echoed at `:78`, and present in **zero** query predicates. The chat route passes `unsPath: null` (`api/equipment-notebooks/[id]/chat/route.ts:294`).

### 1.2 The live path — publisher, ingest, and the gate

The chain is real and read-only end to end.

- **Publisher:** Ignition gateway timer `MiraTagStream` (`ignition/project-resources/FactoryLMCollector/ignition/timer/MiraTagStream/resource.json` — delay 500 ms, fixedDelay, enabled) runs `ignition/gateway-scripts/tag-stream.py`: browses `[default]Mira_Monitored`, `readBlocking`, stamps **the tag's own `.timestamp`** (`gateway_live_snapshot.py:166`), bands the Ignition quality string (`collector.py:75-90`), filters fail-closed against `approved_tags.json`, HMAC-POSTs.
- **Ingest:** `mira-relay/relay_server.py:726` → `tag_ingest.py:203 ingest_batch`; allowlist fail-closed `:247-250`; `event_timestamp = tag.get("ts") or now` (`:277`) preserves the client clock; `033_tag_events.sql:88-89` separates observed-at from received-at; write-path honesty from #3161 at `tag_ingest.py:68-99`.
- **Gate:** `tools/cv101_live_gate.py:106-247 classify()` — pure, DB-free, clock-free, 5 checks, first-fail sets the cause; `live_ratio = distinct_observed_ts / (rows / tag_count)` (the per-**scan** divisor, `:155-166`). Run hourly by `.github/workflows/cv101-live-gate.yml`; 27 cases in `tests/test_cv101_live_gate.py`, including the verbatim 2026-08-14 frozen-replay fixture (`:36-63`) and the healthy 2026-08-16 shape (`:267-272`).

**What is missing, and what is lying.**

- `classify()` has **no runtime caller** — `grep -rn cv101_live_gate` returns only the workflow, CI, tests, and docs. No TS sibling exists.
- The notebook chat route reads no live signal at all.
- The Hub read path is structurally blind to quality: `machine-memory.ts:157-164` does not select `latest_quality`; `command-center-freshness.ts:58-68` classifies on `simulated` + `last_seen_at` only; `machine-context-packet.ts:118-119` therefore emits **"## Live Machine Evidence (observed now) … Treat it as current"** over the frozen replay row. That is the one active lie in production today, and S2-01 removes it first.

### 1.3 Root cause of the freeze (so nobody debugs the wrong layer)

Nothing in FactoryLM is stuck. 419 scans in a 10-minute window at ~1.4 s/scan with ~2 s ingest age is the *healthy* cadence. Three FactoryLM-side hypotheses are refuted by code: the relay preserves the client clock (`tag_ingest.py:277` — an overwrite would show ~2 s observed age, not 380,303 s); the `now` fallback is per-batch (`:225`, so ~419 batches would yield ~419 distinct timestamps); the publisher holds no state between fires (`tag-stream.py::run` rebuilds everything each invocation). The frozen timestamp and the all-bad quality share one upstream origin: Ignition is serving last-known qualified values because its source — the Micro820 device connection, or an expired trial — is down. `quality='bad'` cannot be a default: the relay's default is `'good'` (`:255`) and `quality_band()` returns `'bad'` only for `Bad_NotConnected` / `Bad_Disabled` / `Bad_Failure`.

---

## 2. The identity decision

> **DECIDED by Mike, 2026-08-23 — Option A: the UUID is the key, `CV-101` is the badge.**
>
> Three names, three jobs, no overlap: `cmms_equipment.id` (UUID) is the internal key that links
> rows and is never printed; **`CV-101`** is the human handle — the sticker, the search box, the
> thing a technician says out loud; and `enterprise.home_garage.conveyor_lab.conveyor_1` is the
> address for *signals*, not for the asset.
>
> `cv_101` is **demoted from key to derived value** — and the analysis below shows it was already
> derived in code (`slug(equipment_number)`, `ignition_chat.py:381`), so nothing needs to store it.
> `CV-001` is a stale seed value to delete. **No stored identifier changes**, which is the point:
> starting a dogfood loop and a key migration in the same week means every failure has two
> possible causes.
>
> The three moves in §2.2 are therefore the agreed work, in that order. §2.1 is the evidence for
> why the tempting alternative — writing `cv_101` into `kg_entities.entity_id` — is a net
> regression that would silently blank the live-evidence path.
>
> **First slice: Scan → ask** (Stream 1). It needs no PLC powered and is provable from the desk
> before the walk.


One rig, nine names, five UNS paths. Exactly one field is unambiguous and load-bearing.

| Field | Recommended value | Where it lives | Who reads it | Verdict |
|---|---|---|---|---|
| **Physical QR handle** | `CV-101` | `cmms_equipment.equipment_number`; per-tenant partial UNIQUE `012_qr_permanent_binding.sql:44` | `by-tag/[tag]/route.ts:70`, `start_command.py::_lookup_asset_by_tag`, `ignition_chat.py:381` | **Anchor. Do not change.** |
| **Canonical asset key** | `cv_101`, **derived** as `slug(equipment_number)` | Nowhere — and correctly so | `ignition_chat.py:381` computes it in SQL | ADR-0035 §1 says store it in `kg_entities.entity_id`. **Do not.** See below. |
| **Canonical operational UNS** | `enterprise.home_garage.conveyor_lab.conveyor_1` | `approved_tags` (65 rows), `tag_events`, `live_signal_cache`, `cmms_equipment.uns_path`, `kg_entities.uns_path` | `tag_ingest.py:278`, `machine-memory-response.ts:108`, `signal-history/route.ts:43`, `context/route.ts:66`, `cv101-live-gate.yml:35` | Correct, but **not exclusive** — four rivals below |
| Rival A | `enterprise.garage.demo_cell.cv_101` | `tools/seeds/tag_scaling_gs10.sql:64` (`tag_entities`, prod-applied); `ignition/tags/mira_config_conveyor.json:23` | Ignition TagMapper | Record, do not rename |
| Rival B | `enterprise.garage.demo_cell.bottling_demo.cv_101` | `plc/conv_simple_anomaly/context_model.cv101.json:16` | in-gateway A0–A12 rules | Record, do not rename |
| Rivals C/D | computed by `mira-crawler/ingest/config/bench_uns_map.json:5-9` and `tools/create_bench_equipment_node.py:35-36` | — | — | Record, do not rename |
| **KG bridge approval** | `verified` | `kg_entities.approval_state`, DEFAULT `'proposed'` (`029_kg_approval_state.sql:29-30`); bridge seed `garage-cv101-kg-bridge.sql:31-32` **omits the column** | `chat/route.ts:400`, `traversal.ts:432`, `context-builder.ts:95` all require `'verified'` | **Broken.** Splits the resolvers silently |
| **Alias key read by the bot** | `properties->>'asset_tag' = 'CV-101'` on `entity_type='equipment'` | Bridge seed writes `'equipment_number'` (`:40`) — **zero readers**; garage seed writes `"asset_tag": "CV-001"` on `entity_type='asset'` (`factorylm-garage-conveyor.sql:43`) | `demo_namespace.py:205` | **Wrong twice** — wrong key, wrong value, wrong entity_type |
| **Technician label** | `Garage Bench Conveyor CV-101` (garage tenant) | `cmms_equipment.description`, currently *"Conv_Simple Bench Conveyor (staging probe seed 2026-08-02, PRD #3048 PR 5)"* (`staging-cv101-probe.sql:37,49`) | `/m/` card via `by-tag/[tag]/route.ts:11`; kg `name` materialized at bridge-seed INSERT time | **A changelog string is showing as the machine name** |

### 2.1 The `entity_id` question, answered

**Writing `cv_101` into `kg_entities.entity_id` is a net regression: it breaks three working surfaces, fixes zero, and is not even the value the one alias-consuming reader wants.**

`$2` in every resolver is the route param `id` — the **`cmms_equipment` UUID** (proved by `chat/route.ts:338-346`). The bridge row satisfies them only because `garage-cv101-kg-bridge.sql:36` writes `ce.id::text` into `entity_id`.

| Reader | Filter | Today | After `entity_id='cv_101'` |
|---|---|---|---|
| `chat/route.ts:401` verified-rel count | `+ approval_state='verified'` | already 0 (bridge row is `proposed`) | still 0 — no change |
| `traversal.ts:433` maintenanceContext | `+ 'equipment' + 'verified'` | already null | still null — no change |
| `context-builder.ts:96` | `entity_id = ANY($2) + 'verified'` | dead | **still dead** — `extractor.ts:22` runs on `text.toUpperCase()` and emits `CV-101`, never `cv_101` |
| `context/route.ts:66` → `uns_path` | `'equipment'` only | **works** | ❌ **breaks silently** |
| `signal-history/route.ts:43` | `'equipment'` only | **works** | ❌ **breaks silently** |
| `machine-memory-response.ts:108` → `buildMachineContextPacket` | `'equipment'` only | **works** | ❌ **breaks silently — this is §9's live-evidence path** |

No constraint blocks the write (`entity_id`'s UNIQUE and NOT NULL were dropped at `025:32,38`; the natural key is `(tenant_id, entity_type, name)` per `026:88-89`). The failure is purely resolver-semantic, which is worse: `uns_path` returns `null`, the packet returns empty, the card renders blank, and **nothing errors**.

### 2.2 Recommended resolution — three moves, none touching `entity_id`

1. **Amend ADR-0035 §1**: the canonical key is **derived** (`slug(equipment_number)` → `cv_101`, already implemented at `ignition_chat.py:381`), not stored. If it must be materialized for display, use `properties->>'canonical_key'` — additive, zero readers to break.
2. **Promote the bridge row** to `approval_state='verified'` (a compensating seed, never a rewrite of the applied bridge seed) and add `properties->>'asset_tag' = 'CV-101'`, the key `demo_namespace.py:205` actually reads.
3. **Fix the label in both places.** `kg_entities.name` was materialized at INSERT time by `garage-cv101-kg-bridge.sql:37` (`coalesce(nullif(ce.description,''), …)`) — there is no view, trigger, or FK propagating a later `description` change. Updating `cmms_equipment.description` alone fixes the `/m/` card only. The seed must issue **two explicit UPDATEs**, and the `kg_entities` one is a natural-key change (`kg_entities_tenant_type_name_key`, migration `064`) so it must be guarded and must never be attempted by re-running the bridge seed (whose `NOT EXISTS` guard keys on `entity_id`, not `name`).

### 2.3 What we are NOT changing, and why

**No UNS rename.** ADR-0035 requires one atomic 7-part migration; `tests/test_cv101_live_gate.py:149-151 test_split_identity_is_NOGO` already encodes the split as `CAUSE_IDENTITY`. Rivals A–D are inventoried in the kit doc and filed as one reconciliation issue. Note the `tag_entities` DC-bus row keys on `source_address`, not `uns_path` (`tag_scaling_gs10.sql:56`), so its mismatched path is currently inert.

**"Discharge Conveyor" is not a collision — it is this same rig's Northwind presentation name.** `tools/seeds/approved_tags_northwind_cv200.sql:5-10` states verbatim that the file adds a Northwind-tenant allowlist for the **SAME physical rig**, mapped onto the CV-200 subtree, publishing the rig tags a second time as that tenant (`docs/handoffs/2026-06-28-plc-laptop-northwind-cv200-perspective.md` §0 agrees; ADR-0035 §1 lists CV-200 under "Presentation alias"). The ADR amendment must say that, not claim a different asset. Two consequences carried forward:

- The garage tenant's `description` is a seed changelog string and should become a real machine name — that is the actual defect, not a name collision.
- **A `CAUSE_IDENTITY` verdict from the live gate may mean the Northwind stream is live, not that the rig is misconfigured.** The gate probe has no tenant predicate (`cv101-live-gate.yml:112-117`) and groups on `(source_system, source_connection_id)` only, so a re-enabled Northwind publication collapses both tenants into one group and adds the CV-200 path to `uns_paths`. Before touching anything on a `CAUSE_IDENTITY`: `SELECT DISTINCT uns_path FROM tag_events WHERE source_connection_id='cv101-bench-gw'`. Optionally add `tenant_id` to the GROUP BY — a probe-shape change, no threshold change.

### 2.4 Guards

| Guard | Asserts |
|---|---|
| `tests/test_dogfood_cv101_identity_seed.py::test_seed_never_writes_entity_id` | The ADR amendment, mechanically |
| `…::test_seed_updates_both_description_and_kg_name` | The two-write requirement from §2.2(3) |
| `…::test_promotes_exactly_one_row_by_entity_id` | No pattern-scoped promotion (the `proposed → verified` doctrine) |
| `tests/test_cv101_live_gate.py:149` | The split-identity NO-GO stays a NO-GO |
| `tests/test_conveyor_allowlist_parity.py` | Gateway JSON ⇄ relay seed tag-set parity. **Checked: it pins tag sets only and references `uns_path` zero times** (ADR-0035's own "⚠️ A correction" says so). No identity change here touches it. |

---

## 3. Stream 1 — IDENTIFY: from sticker to a scoped conversation

### I0 · Safety hard-stop on the Notebook seam — **do this first**

**Why it is first.** I6 attaches CV-101's electrical print set and Modbus map, turning the notebook into a terminal-level advice surface. The notebook chat route imports no guardrail module — `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` imports `db`, `quote-window`, `session`, `tenant-context`, `equipment-notebooks`, `canonical-cascade`, `persist-usage`, `manual-rag`, `notebook-query`, `notebook-chat-types`, and nothing else. `SAFETY_KEYWORDS_IMMEDIATE` exists only in Python (`mira-bots/shared/guardrails.py:11,88`), unreachable from the Hub. And the route's `BASE_SYSTEM_PROMPT` instructs the model verbatim: *"Do NOT open with background, safety boilerplate, or a restatement of the question"* and *"Lead with the direct answer in the FIRST sentence."*

The failure is concrete. Mike stands at the running conveyor and asks "why isn't it discharging?" The notebook holds the GS10 wiring sheets. MIRA leads with the action, cited: *"Check continuity across terminal 07–08 at the GS10 [2]"* — a live 480 V panel, charged DC bus, belt turning, no LOTO prompt, and a prompt that just suppressed the safety sentence. Every test in I6 passes.

**Mike can now:** ask a hazardous question at the machine and get a hard stop with an isolation requirement, before any retrieval or provider call.

**Changes**
- `mira-hub/src/lib/safety-keywords.ts` — NEW. Port `SAFETY_KEYWORDS_IMMEDIATE` (`guardrails.py:88`) with a parity test extracting the phrase list from the Python at test time.
- `…/equipment-notebooks/[id]/chat/route.ts` — on a match, hard-stop before `retrieveNodeChunks` and before any provider call; respond with the isolation/LOTO requirement and no cited procedure.
- `BASE_SYSTEM_PROMPT` — narrow the boilerplate rule: any answer instructing contact with wiring, terminals, guards, belts, or rotating parts must state the required energy-isolation state **in the same sentence**.
- `mira-hub/src/lib/answer-control-guard.ts` — NEW. Port the `mira-bots/shared/answer_qc.py:314` assertion ("Asserts a control action occurred. MIRA has no control path — ever") over the rendered answer.

**Tests** · phrase parity with the Python list; a matching message produces zero provider calls and zero retrieval; a control-action assertion in an answer fails the guard; the isolation clause is present when the answer directs physical contact.

**Evidence** · `npx vitest run src/lib/__tests__/safety-keywords.test.ts src/app/api/equipment-notebooks` green; the parity test named in the PR body.

**Rollback** · Revert; the hard-stop is additive and nothing depends on it structurally.

---

### I1 · Decide the CV-101 identity once

**Mike can now:** open CV-101 and the KG-grounded surfaces stop silently returning nothing — verified-relationship count, `maintenanceContext`, and the graph-context block resolve for the first time, and typing "CV-101" to a bot matches the KG row.

**Changes**
- `docs/adr/0035-cv101-canonical-uns-path.md` — amendment (a) per §2.2(1), quoting the resolver table. Amendment (b) is **not** a collision note: record that `Discharge Conveyor` is this rig's CV-200 *presentation* name on the Northwind tenant, quoting `approved_tags_northwind_cv200.sql:5-10`, and that the garage tenant's `description` is a seed changelog string to be replaced.
- `tools/seeds/dogfood-cv101-identity.sql` — NEW compensating seed, single transaction, guarded, tenant-parameterized: promote the one bridge row to `verified` **by `entity_id`**; add `properties->>'asset_tag'='CV-101'` and `properties->>'canonical_key'='cv_101'`; **two** label UPDATEs (`cmms_equipment.description` and `kg_entities.name`), the second guarded against the natural-key constraint.
- `tools/seeds/staging-cv101-probe.sql` — **do not** add a tenant predicate to the UPDATE at `:38`. Its header at `:30-33` states the tenant-free predicate is the repair mechanism ("repair or claim the one CV-101 row"), and the seed is staging-only by intent (`:17`). Instead: add a preceding assertion that at most one CV-101 row exists, and correct the header comment — it cites a global `cmms_equipment_equipment_number_key` that appears in **no** migration (only the per-tenant partial index at `012:44`). Verify the constraint read-only via `db-inspect.yml` before relying on it.
- `.github/workflows/apply-seeds.yml` — register the seed.
- `docs/dogfood/garage-cv101-kit.md` — NEW: identity table, apply order, the four rival paths this kit does **not** rename, and the prod-apply step with Mike as owner.

**Tests** · the four guards in §2.4, plus `test_probe_seed_asserts_single_cv101_row`.

**Evidence** · `pytest tests/test_dogfood_cv101_identity_seed.py -v` green; one `apply-seeds.yml … mode=dry-run` staging run URL.

**⚙ MIKE, PROD:** the prod apply is a gated dispatch **he** owns. Verification is a read-only `db-inspect` probe showing the CV-101 kg row at `approval_state='verified'` with a non-null `uns_path`. **Until that probe is green, every "at the conveyor" outcome below is a staging outcome.**

**Rollback** · The seed is additive and idempotent; revert by resetting `approval_state` and the two label fields.

---

### I2 · Migration 082 and the asset-binding write path

**Mike can now:** bind CV-101 to a notebook with one authenticated PUT, and the database refuses a second notebook claiming the same conveyor.

**Changes**
- `mira-hub/db/migrations/082_notebook_asset_binding.sql` — NEW, P10's columns with three amendments that are free now and cost a whole migration later (`migration-verify.yml` freezes the file on first staging apply — `.claude/rules/mira-hub-migrations.md` §8):
  - `'nfc'` in the `asset_selected_via` CHECK alongside `asset_picker|qr|work_order|nameplate|manual_entry`. An NFC tag is the same URL NDEF-encoded and carries identical selected-not-confirmed provenance. **No GPS value, ever** — see §6.
  - `CREATE UNIQUE INDEX … ON equipment_notebooks (tenant_id, equipment_entity_id) WHERE equipment_entity_id IS NOT NULL` — partial-unique, the shape of `012:44`. Two notebooks on one conveyor have **disjoint corpora** (each mints its own node at `equipment-notebooks.ts:117-123`; chunks are stamped with it at `api/files/route.ts:214-223`), split turn history, and resolve nondeterministically by `last_opened_at DESC`. `kg_entities_tenant_type_name_key` (064) forces the duplicate to carry a *different display name*, which is exactly what makes it invisible in the list.
  - Per-turn snapshot columns on `equipment_notebook_turns`.
  - Schema checks: `equipment_notebooks.tenant_id` is UUID (`073:39`), policies cast in-type (`073:113-131`), GRANTs are table-level (`073:130-132`) so new columns are covered. No new GRANT, no policy/GiST drop-recreate ordering.
- `mira-hub/src/lib/equipment-notebooks.ts` — `bindNotebookAsset` / `unbindNotebookAsset`. Predicate: `tenant_id = $1::uuid AND entity_type = 'equipment' AND (id::text = $2 OR entity_id = $2) AND approval_state = 'verified' AND uns_path IS NOT NULL`.

  **`entity_type = 'equipment'` is load-bearing.** Every user-created namespace node is minted `approval_state='verified'` with a uns_path regardless of kind (`api/namespace/node/route.ts:102-110`), so without it a notebook can legally bind to an *area*. S2-05 then probes `uns_path <@ ltree` (subtree) and derives `expectedTagCount` from `approved_tags` with the same predicate — both scale together, SCOPE passes, and a sibling machine's `Motor_Speed: 1740 rpm (live)` renders as this conveyor's current state on a stopped belt. Reject non-equipment with a distinct `asset_not_equipment`, never `asset_not_found`.

  Also extend `NOTEBOOK_COLS` (`:60-64`), `NOTEBOOK_COLS_BARE`, `rowToNotebook` (`:68-88`) and the type — without which the read path cannot see what the write path stored.
- `…/api/equipment-notebooks/[id]/asset/route.ts` — NEW. PUT binds, DELETE unbinds. A dedicated sub-route, not a `PATCH` field: `PATCH` is the free-text identity editor, and conflating a canonical binding with a typed metadata edit is the trust inversion `sources/route.ts:28-34` already refuses. `asset_confirmed_by`/`_at` are derived server-side, never read from the body.

**Tests** · binds a verified, uns-pathed, same-tenant equipment node; foreign tenant → 404 with the tenant param asserted; **binding an area/line/site node → 422 `asset_not_equipment`**; `approval_state != 'verified'` → 422; verified-but-NULL-`uns_path` → 422 (this is the case a notebook's *own* backing node hits, so self-binding is refused); second notebook on a bound asset → 409 carrying the existing id; `via:'qr'` never populates `asset_confirmed_by`; body-supplied `confirmedBy` ignored; `'nfc'` accepted, unlisted rejected; DELETE clears all four columns together; the four columns round-trip through `listNotebooks`/`getNotebook`.

**Evidence** · `cd mira-hub && npx vitest run src/lib/__tests__ src/app/api/equipment-notebooks` green; `migration-verify.yml` applies 082 to staging.

**Rollback** · The route and lib changes revert cleanly. 082 does not — plan its shape before the first push.

---

### I3 · Bind the turn, reject unresolvable identity, show the asset card

**Mike can now:** ask in CV-101's notebook and get an answer grounded on the conveyor's canonical name, key, and UNS path instead of *"an unspecified machine"* — with the persisted turn recording which conveyor.

**Changes**
- `equipment-notebooks.ts` — `resolveBoundAsset(tenantId, notebookId)` → `unbound | resolved | unresolvable`, reusing I2's predicate; `recordTurn` gains `equipmentEntityId` / `assetUnsPath`.
- `…/[id]/chat/route.ts` — call after `validateChatSources`.
  - `unresolvable` → **422, fail-closed from the first deploy.** `.claude/rules/direct-connection-uns-certified.md` clause 2 forbids downgrading: *"Reject the turn if the identifier is missing or unresolvable … Do NOT fall back."* If volume is a worry, measure it — land `resolveBoundAsset` in **shadow mode** for one deploy (compute, log, change nothing), then enable the reject. A permissive default is not an option: if the bridge row is re-seeded or renamed (I1's own risk), the binding stops resolving and a permissive path would answer while the card still shows the last stored asset name.
  - **The 422 body must be technician-readable.** Mobile's `askNotebook` (`mira-mobile/src/api/resources.ts:985-994`) → `errorFromStatus(422, res.data)` (`client.ts:347`) → `kind='client'`, `detail = data.error` (`client.ts:198-208`) → `ErrorState` renders `error.userMessage` (`screens/common.tsx:19-20`) which for `kind='client'` returns `this.detail` verbatim (`client.ts:47-51`). So `{"error":"uns_required"}` renders on Mike's phone as the literal token `uns_required`. Return `{"error":"<plain sentence>", "code":"uns_required", "notebookId":…, "entityId":…}` instead, keeping the discriminator in `code`. The same trap applies to I4's 422s through `TagLanding`.
  - `resolved` → prepend a canonical identity line ahead of the existing `[manufacturer, model].join(' ') || 'an unspecified machine'` at `:354`. **Until `asset_confirmed_at` is set, prefix it as selected-not-confirmed** — *"This notebook is SELECTED for CV-101 from a QR sticker; identity is unconfirmed"* — and render the amber tone. Two identical bench conveyors with stickers exchanged during a rebuild is the failure this prevents.
  - `unbound` → today's behaviour verbatim.
  - Snapshot passed to **both** `recordTurn` sites, including abstain.
  - `retrieveNodeChunks` keeps `unsPath: null` (`:294`) — unchanged.
- `mira-hub/src/lib/notebook-asset-card.ts` — NEW, pure `assetCardState(asset)` → `{tone, headline, detail}` with all three tones (confirmed / selected-unconfirmed / unresolvable) from the start; pure so it is testable without a DOM.
- `…/api/equipment-notebooks/[id]/route.ts` — GET returns an `asset` block.
- `…/(hub)/equipment/[id]/page.tsx` — render the card above chat; `--fl-*` tokens only.

**Tests** · bound notebook puts canonical key + UNS path in the prompt; unbound is byte-identical to today; bound turn persists both snapshot fields **including on abstain**; unresolvable → 422 with no retrieval, no fetch, no `recordTurn`, no SSE stream, no confirmation question; **the rendered mobile string contains no underscore token**; **under a fully resolved asset `retrieveNodeChunks` still receives `unsPath: null` and exactly the validated docIds** — passing the bound path would trigger `manual-rag`'s ltree subtree expansion and silently overrule the validated doc set that is the notebook's entire safety model; the card mapper emits no colour literal.

**Evidence** · `npx vitest run src/app/api/equipment-notebooks src/lib/__tests__` green; desktop (1440×900) and mobile (412×915) screenshots of the card in confirmed and unconfirmed states → `docs/promo-screenshots/`.

**Scope fence** · Identity and confirmation state only. Freshness is Stream 2; rendering it here would be an unearned currency claim.

**Rollback** · Revert; the 422 and the card go together.

---

### I4 · Asset → notebook: reverse lookup and open-or-create-and-bind

**Mike can now:** from CV-101 anywhere — asset page, API, scan — one call opens the **one** notebook that belongs to that conveyor, creating and binding it the first time, never creating a second.

**Changes**
- `equipment-notebooks.ts` — `listNotebooks` gains an optional `equipmentEntityId` filter (one WHERE arm inside the existing `withTenantContext`; today the only predicate is `n.tenant_id = $1::uuid` at `:159-163`). **There is no asset→notebook lookup anywhere in `mira-hub/src` today** — every `equipment_notebooks` predicate keys on `id`, `tenant_id`, or `node_id`. P10/P11 add the binding but no slice adds the reverse read, so P26's stated goal ("scanning the label lands the technician in a notebook") is delivered by nothing.
- `equipment-notebooks.ts` — **`createAndBindNotebookTx(client, …)`**, NEW and load-bearing. `withTenantContext` opens its own pooled connection and wraps the callback in `BEGIN … COMMIT` (`lib/tenant-context.ts:26-40`), and `createNotebook` is exactly one such call (`:113-149`). Composing create-then-bind commits the notebook and its `kg_entities` node **before** the bind runs; if the bind then fails — I2's 422 cases, or the partial-unique index losing a concurrent double-tap at the machine — the result is an orphan notebook plus an orphan `kg_entities` row whose `name` now occupies `kg_entities_tenant_type_name_uq` (064), so the retry 500s on the duplicate display name and the second tap is worse than the first. Run the resolve, both INSERTs, and the binding UPDATE inside **one** `withTenantContext` callback; catch `23505` inside it and return 409 with the existing notebook id (the transaction rolls back, leaving nothing).
- `…/api/assets/[id]/notebook/route.ts` — NEW. POST calls only `createAndBindNotebookTx`. Header records the design decision: **`node_id` stays the notebook's own private node with `uns_path NULL`** and is not repointed at the CV-101 bridge node. `node_id` scopes **documents**; `equipment_entity_id` names the **machine**. Repointing would push notebook chunks into the asset chat's retrieval scope and collide on 064. The §9 admission gate reads the path off `equipment_entity_id`, so the NULL path on the node is correct, not a defect.

**Tests** · a second POST returns the same notebook and creates nothing; **two concurrent POSTs against the same asset leave exactly one notebook and exactly one new `kg_entities` row**; foreign-tenant asset → 404, nothing created; `proposed` / NULL-`uns_path` / non-equipment → 422 with **no orphan notebook** (create and bind are one unit or neither happens); created `node_id` is a fresh row, not the bridge entity; `?equipmentEntityId=` is tenant-scoped and returns an empty list for a foreign entity.

**Evidence** · `npx vitest run src/lib/__tests__ src/app/api` green; staging curl transcript: POST → 201 `{created:true}`, POST again → 200 `{created:false}` same id, GET `?equipmentEntityId=` → one row.

**Rollback** · Revert the route; the lib function is inert without a caller.

---

### I5 · The scan lands in the notebook

**Mike can now:** stand at the conveyor, open FactoryLM, tap Assets → ⌗ Scan QR, point at the sticker, and land inside CV-101's notebook with the machine named on the card. First end-to-end scan→ask.

**Changes**
- `mira-mobile/src/App.tsx` — lift the Notebooks route exactly as `AssetsRoute` is lifted (`:22` import, `:37` useState, `:114-116` call sites); add `openNotebook(id)` = `setTab("chat")` + `setNotebookRoute({name:"notebook", id})`. Reuse the existing lifted-route + `deepLinkSink` pattern at `:63-73`. **No second router.** Do not touch `ScanView.tsx`.
- `mira-mobile/src/screens/NotebooksTab.tsx` — accept `route`/`setRoute` as props instead of the local `useState` at `:49`; keep the `backRef` contract at `:51-58`.
- `mira-mobile/src/screens/AssetsTab.tsx` — in `TagLanding` (`:469-506`), after `getAssetByTag` resolves, call `openAssetNotebook(a.id, 'qr')`; keep "Open asset" secondary and the notfound/failed Empty states verbatim.
- `mira-mobile/src/api/resources.ts` — `openAssetNotebook(assetId, via)`.
- `mira-hub/src/app/(hub)/assets/[id]/page.tsx` — an "Open notebook" action so both surfaces reach one notebook.

**Tests** · TagLanding routes into the notebook on success and to the Empty state on 404; a 422 renders the honest sentence **and** still offers "Open asset" (never a blank screen at the machine); `openNotebook` switches tab and sets route **together** (a tab switch without the route drops him on the notebook *list*); Android back still walks notebook → home → tab; `extractAssetTag` unchanged and `tag-grammar-shadow.test.ts` green.

**Evidence** · `cd mira-mobile && bun run test` green; emulator screenshots → `docs/promo-screenshots/`.

**⚙ MIKE, HARDWARE (non-blocking):** one real scan of the printed sticker on the Pixel 9a → `docs/proofs/`.

**⚙ MIKE, BY HAND — print the sticker.** CV-101 already carries `equipment_number='CV-101'`, so no tag minting is needed (POSTing `/api/assets/[id]/qr` returns `alreadyBound`). **Print from `https://app.factorylm.com`, not staging, not localhost.** `print-qr/page.tsx:48` sets `origin = window.location.origin` and `:131` encodes `${origin}/m/${a.tag}`, while `mira-mobile/src/lib/tags.ts:32` hardcodes `TRUSTED_ORIGIN = {protocol:'https:', host:'app.factorylm.com'}` and `isTrustedDeepLink` (`:37-46`) rejects everything else — so a sticker printed from the wrong origin is **permanently unscannable by the in-app scanner**, with no signal at print time. `tools/qr-label-pdf.py:72` hardcodes the correct host, so the two producers currently disagree.

**Sub-change (ship with I5):** on the print-QR page, render the encoded URL as visible text under each label and refuse to print (or warn loudly) when `origin !== 'https://app.factorylm.com'`; better, derive it from the same shared constant `qr-label-pdf.py` uses. Add a hub test pinning the printed value to the canonical origin, paired with `tag-grammar-shadow.test.ts` so producer and consumer share one contract.

**Rollback** · Client-only; revert.

---

### I5b · Offline-tolerant boot — **the app must not fail closed to a login wall**

**Why this is in Stream 1.** Every "Mike can now stand at the conveyor…" outcome assumes the network is up at launch, and today it is not tolerated. `App.tsx:41-49` boots by awaiting `getMe()`; `resources.ts:65-80` catches **everything** — including `ApiError("network")` thrown at `client.ts:349` after both retries fail — and returns `null`; `App.tsx:88` then renders `<Login/>`. The persisted session cookie in `Preferences` (`client.ts` `JAR_KEY = "flm.cookiejar.v1"`) is never consulted. In a garage dead spot Mike gets a sign-in screen he also cannot get past.

**Mike can now:** open FactoryLM in a dead spot and see the app shell with an offline banner, not a login wall.

**Changes** · persist the last successful `getMe()` alongside the cookie jar; on boot treat `ApiError.kind === "network"` as *unknown — keep the cached identity*, and let **only** `kind === "auth"` clear `me`; render an explicit offline banner instead of `<Login/>`.

**Tests** · boot with a network-throwing `request` and a populated cache renders the shell, not the login screen; an auth error still clears the session.

**Honest scope note** · a notebook turn is **online-only**; there is no offline answer path (`lib/offline-queue` covers work orders only). Say so in the banner.

**Rollback** · Revert.

---

### I6 · Attach the CV-101 manuals through the real ingest door

**Depends on I0.** Do not land the print set on a route with no safety hard-stop.

**Mike can now:** ask a real question at the conveyor and get an answer whose citation opens the actual CV-101 print page it came from.

**Changes**
- `tools/dogfood/seed-cv101-notebook-sources.mjs` — NEW, extending the proven loop in `tools/notebook-e2e/notebook_proof.mjs`. One `POST /api/files` per file with `targets=[{targetType:'equipment_notebook', targetId, role:'manual'}]` — the single door that parks bytes, links, resolves `node_id` (`api/files/route.ts:214-223`), indexes, and writes the source row as `user_confirmed` via `syncNotebookSourcesForFile` (`workspace-files.ts:749-773`). Asserts `indexed:true` per file, exits non-zero otherwise. Files: `docs/onboarding/cv-101-evidence/cv101_print.pdf` (confirmed text layer), `docs/conveyor-fault-detective-demo/Micro820_v4.1.9_Modbus_Map.pdf`, `plc/conv_simple_electrical/sheets/CV-101_print_set.pdf`.
- `docs/dogfood/garage-cv101-kit.md` — record why a SQL seed **cannot** do this: retrieval filters `ingest_route='v2'` (`manual-rag.ts:506,542`) on rows only the real parser writes (`node-knowledge-ingest.ts:406`), and `apply-seeds.yml:347` already notes SQL-seeded chunks land `embedding = NULL`. And why the **asset page** does not work: `validateTargetTx` returns `nodeId: null` for `cmms_asset` (`workspace-files.ts:396-402`) and `api/files/route.ts:226` gates indexing on a node — so a file parks and never becomes citable, which is exactly what mobile's asset Detail upload does today (`AssetsTab.tsx:270,301,455`).

**Tests** · the script fails loudly on `indexed:false` and never reports success on a bare 200; it never posts `matchState` (`sources/route.ts:28-34` forces `user_confirmed` server-side); re-running is idempotent with no duplicate sources and no downgraded trust.

**Evidence** · one staging transcript with three files at `indexed:true`, then a notebook question whose citation resolves to a real print passage, quoted with the passage id.

**Honest limit** · This does **not** close #3218 (large-manual retrieval completeness). One cited answer is not proof the whole print set is retrievable; the kit doc must say so.

**Rollback** · Detach the sources; the script writes nothing else.

---

### I7 · Confirm the machine in front of you

**Mike can now:** close §8 step 7 honestly — the notebook records that *he*, at a real timestamp, affirmed this notebook is the conveyor he is standing at, kept separate from the fact that a sticker asserted it.

**Changes** · a confirm intent on `…/[id]/asset/route.ts` writing `asset_confirmed_by = ctx.userId` and `asset_confirmed_at = now()` from session and server clock (never the body); re-binding to a **different** entity clears both in the same statement. `notebook-asset-card.ts` amber → green transition. The action on `NotebookScreen.tsx` (the surface he is actually holding) and on `(hub)/equipment/[id]/page.tsx`.

**Tests** · confirm writes both from session and clock; body-supplied values ignored; confirming an unbound notebook → 409, not a silent no-op; **re-binding to a different asset clears both confirmation columns** — a confirmation of conveyor A must never survive onto conveyor B.

**Evidence** · unit suite green; phone screenshot of the unconfirmed → confirmed transition → `docs/promo-screenshots/`.

**Rollback** · Revert; the amber tone from I3 remains correct without it.

---

### I8 · Cold phone: the sticker opens the app, and sign-in comes back to the tag

**This is two problems with two different owners. Do not treat it as one size-S Hub PR.**

**(a) App Links — ⚙ MIKE, VPS.** `curl -sI https://app.factorylm.com/.well-known/assetlinks.json` → **307 → `/login`**; the control `/.well-known/zzz-does-not-exist` returns the **identical** 307, proving an auth catch-all. But `deployment/nginx-app-factorylm.conf:299-303` declares `location = /.well-known/assetlinks.json` — an **exact-match** location, the highest-priority form in nginx. If it were live, the request could never reach mira-hub and the 307 would be impossible. So the deployed nginx lacks that block and/or `/opt/mira/well-known/assetlinks.json` was never copied: `deployment/well-known/README.md` step 1 is a manual VPS copy and `grep -rn "well-known" .github/workflows/` returns nothing.

There is also nothing for Next.js to serve — `ls mira-hub/public/` shows no `.well-known`, and `find mira-hub -name 'assetlinks*'` outside `node_modules`/`.next` returns nothing. **Excluding `.well-known` from the middleware matcher turns 307 into 404, which fails verification identically.**

- **Real fix (Mike, via `deploy-vps.yml`):** copy `deployment/well-known/*` to `/opt/mira/well-known/`, confirm the deployed nginx matches the repo conf, `nginx -t && reload`.
- **Code-only alternative that survives config drift:** add `mira-hub/public/.well-known/assetlinks.json` so Next serves it directly — **and only then** does the matcher edit become load-bearing.
- Note `deployment/well-known/README.md:8` — the file currently holds only the **debug** keystore fingerprint. The release SHA-256 must be **appended**, not substituted, or App Links break silently on the first release-signed install. Android re-runs verification **only on install**.

**(b) callbackUrl — a real one-line Hub fix.** `middleware.ts:180-184` does `url.search = ""` then `callbackUrl = pathname`. Live: `/cmms/?register_tag=CV-101` → `307 → /login/?callbackUrl=%2Fcmms%2F`. Change to `url.searchParams.set("callbackUrl", pathname + req.nextUrl.search)` — fixes deep-link return for **every** Hub route.

**Tests** · callbackUrl round-trips the query string; **regression guard** — an `/api/` path still returns JSON 401, not an HTML redirect (`middleware.ts:171-176` must not change), plus a table-driven case asserting no currently-protected path became public.

**Evidence** · after the VPS action: `curl -sI …/assetlinks.json` returning 200 with `content-type: application/json`, quoted alongside today's 307. Mike reinstalls once and confirms the sticker opens FactoryLM.

**Rollback** · (b) reverts in one line. (a) is a config change with its own rollback.

---

### I9 · Browser scan: one owner for `/m/{tag}` — **highest blast radius, sequenced last**

**Mike can now:** scan with any phone camera in a browser, signed in or not, and land on CV-101's asset card with a button into its notebook — instead of a "Register equipment" form for a conveyor registered since migration 012.

**Changes**
- `deployment/nginx-app-factorylm.conf` — narrow `location /m/` (`:124-125`) to `location ~ ^/m/[^/]+/(register|report|choose)$` and let bare `/m/{tag}` fall through to `location /` (`:341-342` → mira-hub). The Hub page needs no auth work: `/m/` is already excluded from the middleware matcher (`:240`) and renders `GuestLanding` for anonymous visitors.
- `mira-hub/src/app/m/[assetTag]/page.tsx` — a fourth action, "Open notebook", calling I4. While open, replace the hardcoded `linear-gradient(135deg, #2563EB, #0891B2)` at `:291` with `--fl-*` tokens.
- `mira-web/src/routes/m.ts:45` — `?start=asset_${encodeURIComponent(assetTag)}`. The bot branches only on the `asset_` prefix (`start_command.py:38,246`); today's bare tag falls into the invite-token branch and answers *"I'm invite-only."* The correct prefix already exists in the Hub page at `:206`. **Fix the caller, never the resolver** — `_handle_asset_deep_link` is correct.

**Three security preconditions, all blocking, all verified**

1. **`/api/public/report` is a cross-tenant hazard, and I9 makes it reachable from a real scan for the first time.** It is unauthenticated and resolves globally: `SELECT id, tenant_id FROM cmms_equipment WHERE equipment_number = $1` with no tenant predicate, inserting as `neondb_owner` explicitly past RLS, justified in-file by *"Ambiguous — shouldn't happen given the unique index."* **That index does not exist** — `012:44-46` creates a per-tenant partial index and `:25` states outright that `equipment_number` isn't unique. Fix before the flip: resolve the tag through the path the landing page used (carry the resolved tenant/asset id), never by a bare global lookup; return identical responses for not-found and not-permitted so it stops being an existence oracle; correct the false comment.
2. **Do not ship the `m-register.ts` `equipment_number` edit yet.** It would let any self-serve signup mint `CV-101` in their own tenant and turn Mike's genuine guest reports into `409 Ambiguous`. It is also **inert today**: `grep -n location deployment/nginx-app-factorylm.conf` shows no `/api/m/` block, so both `/api/m/auto-register` and `/api/m/report` fall through to `location /` → mira-hub middleware → `{"error":"Unauthorized"}` 401 (`middleware.ts:171-176`). Decide explicitly: add `location /api/m/ { proxy_pass http://127.0.0.1:3200; }` with the nginx flip, **or** delete the dead write paths. Do not ship an INSERT fix for a route nothing executes.
3. **Cross-tenant tag squatting on the unauthed path.** `mira-web/src/routes/m.ts:104` → `resolveAssetWithChannelConfig` (`qr-tracker.ts:66-83`) is `WHERE lower(a.asset_tag) = lower($1) LIMIT 1` across **all** tenants with no ORDER BY — the docstring says "Returns the first tenant that owns this asset_tag." `buildChannelUrl` (`m.ts:37-57`) then redirects to that tenant's `openwebui_url` or Telegram bot, both attacker-controllable rows in `tenant_channel_config`. **Fix: refuse ambiguity rather than pick a winner** — if more than one tenant claims the tag, render the neutral not-found page (§12.6's byte-identical page exists for this). Never derive a redirect target from a tenant the visitor has not authenticated to. The stated smaller alternative below inherits this shape and needs the same fix.

**Precondition to run and quote before the flip** · read-only `db-inspect` counts of (i) `asset_qr_tags` rows, (ii) `tenant_channel_config` rows with >1 enabled channel, (iii) duplicate `equipment_number` values across tenants. If a live tenant depends on the multi-channel chooser at bare `/m/{tag}`, **stop** and do the smaller alternative instead: a `cmms_equipment` fallback inside `resolveAssetWithChannelConfig` (`qr-tracker.ts:66`) — one query, one file, ownership unchanged, **plus** the ambiguity refusal — accepting that it fixes the 404 but not the walk.

**Tests** · `m.test.ts` pins the `asset_` prefix; a hub test that `/m/{tag}` renders unauthenticated (the flip must not turn a public scan into a login wall); `nginx -t` plus a documented curl matrix for the four `/m/` shapes.

**Evidence** · after deploy: `curl -sI …/m/CV-101` returning 200 from the Hub; phone screenshot of the card with "Open notebook" → `docs/promo-screenshots/`.

**⚙ MIKE, VPS** · the nginx apply goes through `deploy-vps.yml`; prod-guard forbids the agent doing it.

**Rollback** · One-line revert of the location block.

---

## 4. Stream 2 — SEE: live conveyor data, from the code already built

Ordered so the product learns to say *"unavailable, and here is why"* **before** it can ever say *"current."*

### S2-01 · "Observed now" becomes conditional; quality reaches the freshness reader

**The only slice that removes a lie live in production today.**

**Mike can now:** open the CV-101 asset page and see the 4.4-day-old bad-quality readings badged **stale**, not live — and the asset chat stops describing them as what the conveyor is doing right now.

**Changes**
- `mira-hub/src/lib/machine-memory.ts` — add `latest_quality`, `freshness_status`, `source_system` to the `fetchLiveSignals` SELECT (`:157-164`). **Do not add `source_connection_id`** — it exists only on `tag_events` (`033:84`), and the `undefined_column` error is swallowed into `[]` by the guard at `:169-172`: a silent blanking of every live signal on the PR whose purpose is more honest live evidence.
- `command-center-freshness.ts` — `classifyTagFreshness` (`:58`) takes an optional quality; precedence mirrors `mira-bots/shared/factorylm_live.py::_freshness_for`: simulated → `'simulated'`; quality in `{bad, stale, uncertain}` → `'stale'` at any age; else the existing window. **Absent quality must reproduce today's result byte-for-byte.** Correct the file header at `:9-14`.
- `machine-memory-response.ts` — thread quality into `:146` and onto `LiveTag.freshness` (`:63`).
- `machine-context-packet.ts` — make the header conditional on the already-computed `packet.freshness.live > 0`. Today `:118` emits a static *"## Live Machine Evidence (observed now)"*, `:119` says *"Treat it as current"*, and `:92` pushes *"- Live signals (observed now):"* whenever any tag exists. When none classify live: retitle to *"Last known values — NOT current; do not describe present state"*, drop the treat-as-current sentence, drop `(observed now)`.
- **Also gate `active_conditions` on freshness.** `machine-context-intelligence.ts:157-165` maps `latest_diffs` straight through with no freshness filter, while only `changed_recently` at `:168-175` filters on `t.freshness !== 'live'`. A four-day-old A12 detection renders today as an active fault.

**Tests** · the verbatim prod replay shape (`last_seen_at` now−2000 ms, `simulated:false`, `quality:'bad'`) classifies `'stale'`; quality-undefined is identical to the pre-change function across the whole matrix (regression fence for `tagStatuses` / `rollupFreshness` / `machine-current-state`); good+fresh stays live, good+old stale, simulated+good simulated; an all-stale packet emits neither "observed now" nor "Treat it as current"; **the frozen-replay fixture produces no imperative next-check line on the asset-chat path** (this path is live in production, so the negative belongs here, not only in S2-09).

**Evidence** · `npx vitest run src/lib/command-center-freshness.test.ts src/lib/machine-context-packet.test.ts src/lib/machine-current-state.test.ts src/lib/machine-memory-response.test.ts` green; PR quotes the before/after rendered block for the real prod row.

**Blast radius note for reviewers** · `classifyTagFreshness` is shared with the Command Center roll-up; status will visibly change wherever a gateway reports bad quality. That is the point.

**Rollback** · Optional-argument shape; one commit, no schema.

---

### S2-02 · The gate says *which* replay it is (report-only)

**Mike can now:** before driving to the garage, read one gate run and know whether the **source** is frozen (`distinct_values = 1` across all 12 tags) or the **reading path** is stamping one timestamp on changing values (`distinct_values > 1`, `distinct_observed_ts = 1`).

**Changes** · add `count(DISTINCT value) AS distinct_values` to the grouped probe SQL (`cv101-live-gate.yml:99-118`); `classify()` reports it in `Verdict.lines` beside the existing counts (`:165-168`). **Not a check, not a threshold, no cause or exit-code change.** The identical discriminator already exists as db-inspect probe F (`db-inspect.yml:586-598`).

**Standing prohibition** · `distinct_values` must **never** become a threshold — a legitimately steady tag (a stopped conveyor's `Motor_Speed`) has `distinct_values = 1` while being perfectly live.

**Tests** · the prod fixture keeps cause `REPLAY` and exit 1 while gaining the line; `distinct_values > 1` with one distinct observed ts still classifies REPLAY but reads differently; an absent `distinct_values` does not raise (workflow and module deploy independently); all 27 cases green.

**Evidence** · `pytest tests/test_cv101_live_gate.py -v`; `actionlint`; one dispatch run quoted.

**Rollback** · Revert both files.

---

### S2-03 · The gateway ships its raw Ignition quality string

**Mike can now:** from a read-only db-inspect run, read the exact Ignition fault behind `quality='bad'` — `Bad_NotConnected` vs `Bad_Disabled` vs `Bad_Stale` vs `Bad_Failure` — and know before leaving the house whether it is a PLC link, a disabled device, or an expired trial.

**Changes** · `collector.py:93-101 build_reading` adds `metadata={'raw_quality': str(ignition_quality)}` — `quality_band` (`:75`) already receives the raw string and discards it. **Zero cloud-side change:** the relay forwards `metadata` verbatim (`tag_ingest.py:281`) and `033:91` documents that column as the home for raw quality codes. Add a db-inspect query grouping by `metadata->>'raw_quality'` over 24 h.

**Security note** · `raw_quality` is an **untrusted plant-boundary string**. Cap its length at the collector, and it must never be rendered into a prompt unsanitized (see S2-06).

**Tests** · raw string preserved verbatim for five quality strings with the band unchanged; a batch carrying `metadata.raw_quality` lands it in `tag_events.metadata` (proving the existing pass-through without a relay edit); the read-only guards at `test_gateway_live_snapshot.py:513,540,565` stay green.

**Evidence** · `pytest tests/ignition -v` green. **⚙ HARDWARE (deploy half, non-blocking):** after the gateway file deploy, one db-inspect run showing a real value.

**Rollback** · Revert the collector line; the cloud tolerates its absence.

---

### S2-04 · Port `classify()` into a server primitive — parity-pinned, never forked

**Mike can now:** read, in a passing test, the exact sentence the app will show him — the verbatim production probe row fed into the server-side classifier and rendered as *"Live conveyor data is unavailable: the gateway is repeatedly sending one old, bad-quality observation."*

**Changes** · `mira-hub/src/lib/live-admission.ts` — NEW, framework-free, no DB, injected `nowMs`. Port the check **order** and first-fail selection from `tools/cv101_live_gate.py:88-247` exactly: empty → `PHYSICAL_OR_GATEWAY` (`:106`); synthetic-only → `PROVENANCE` (`:120`); busiest physical group (`:133`); then ingest-stopped (`:182`), replay (`:186`), staleness (`:197`), all-bad (`:206`), identity (`:214`), scope (`:222`). Port `live_ratio` with the **per-scan** divisor (`:155-166`) and the comment explaining that a per-row divisor caps the ratio at 1/N and made GO unreachable for a healthy 12-tag stream. Export `LIVE_ADMISSION_THRESHOLDS` mirroring `:92-95` and a `REASON_COPY` map with one technician sentence per cause. Two TS-only causes: `NO_ASSET_BOUND` (display `silent`) and `ADMISSION_UNAVAILABLE` — when the assembler itself throws, the honest statement is *"I could not check whether this machine's live data is trustworthy, so I am not using it"*, **not** *"nothing is arriving from this machine's gateway"*, which is a claim about the plant MIRA cannot prove and would dispatch someone to check a healthy gateway.

Add `tools/cv101_live_gate.py` to the Hub Unit Tests paths-filter in `.github/workflows/ci.yml` (the seam already used for `guardrails.py`) plus a matching `tests/test_hub_unit_filter_contract.py` entry, so a Python-only threshold edit still runs the TS parity guard.

**Tests** · fixture per cause; the verbatim prod row → `REPLAY`; the measured healthy bench shape (`test_cv101_live_gate.py:278`) → admitted (pins the 2026-08-16 regression); **PARITY** — thresholds, cause literals, and the presence of the `/scans` divisor extracted from the Python at test time and compared, failing loudly with the drifted values named; no `REASON_COPY` string contains a cause token, an underscore token, or `"NO-GO"`.

**Evidence** · `npx vitest run src/lib/__tests__/live-admission.test.ts`; `pytest tests/test_hub_unit_filter_contract.py`. PR quotes the production row in, the sentence out.

**Rollback** · Unreferenced module; delete.

---

### S2-05 · Tenant-scoped read-only probe and the assembler

**Mike can now:** nothing visible yet — but the server computes the honest verdict for any notebook, and the five ways the feed fails him are each proven against the assembler's **real emitted SQL**.

**Changes** · `mira-hub/src/lib/notebook-live-evidence.ts` — NEW. `assembleLiveEvidence(client, tenantId, unsPath, nowMs, windowMinutes = 10)`:
1. `unsPath == null` → `NO_ASSET_BOUND` with **zero queries** (every notebook today).
2. `expectedTagCount` from `approved_tags` (`035_approved_tags.sql:39-69`), never hardcoded; zero rows → `SCOPE`.
3. **One** grouped read-only probe over `tag_events`, **tenant-predicated first**.
4. Map → `classifyLiveAdmission`.
5. Degrade, never throw — reuse `isUndefinedRelationOrColumn` so an env without 033/035 returns an unavailable verdict instead of breaking a chat turn.

**Two decisions this slice must record in the plan doc**

- **Scoping vs. identity.** The CI probe deliberately has an OR-arm on `source_connection_id` with **no** tenant predicate (`cv101-live-gate.yml:114-117`), so it can see a stream arriving under the *wrong* path; a purely tenant-scoped ltree probe cannot — a foreign-path stream is simply zero rows → `PHYSICAL_OR_GATEWAY`. Decide whether the Hub adopts the OR-arm tenant-scoped, or whether `ALLOWLIST_IDENTITY` is documented as CI-only. S2-11's parity check depends on the answer.
- **Subtree probes are not legitimate for a single machine.** With I2's `entity_type='equipment'` restriction the bound node is a leaf, but state it explicitly and test it: assert in the emitted-SQL test that the probe is scoped to the bound entity's exact path or to a leaf, with a negative fixture where a sibling machine's tags exist under the same parent and are **not** admitted.

**Tag-count caveat** · the deployed allowlist and the repo seed disagree — `tools/seeds/approved_tags_conveyor.sql` carries 7 `conveyor_demo/` entries while the gate hardcodes `expected_tag_count=12` (`cv101_live_gate.py:92`) and the observed stream carries 12. Reading from `approved_tags` is correct but guarantees Hub and CI can disagree on SCOPE; S2-11 inherits that as the scoped-parity caveat.

**Tests** · `NO_ASSET_BOUND` with `client.query` called **zero** times; relay down → `PHYSICAL_OR_GATEWAY`; prod replay group → `REPLAY`; stale → `STALE_OBSERVATION`; all-bad → `GATEWAY_QUALITY`; **wrong asset in two parts** — (a) the emitted SQL carries `tenant_id = $1::uuid` and `uns_path <@ $2::ltree` with the caller's recorded params, so a future optimisation dropping the tenant predicate fails, (b) telemetry belonging only to another asset yields *"nothing for THIS machine"*, never a borrowed reading; `SCOPE` for both a short tag count and an empty allowlist; a missing table returns unavailable and does not throw.

**Evidence** · `npx vitest run src/lib/__tests__/notebook-live-evidence.test.ts` green with all negatives named in the test titles.

**Rollback** · Unreferenced module; delete.

---

### S2-06 · Wire the admission into the turn

**Depends on I0 (safety) and I3 (binding).** Without I3 there is no `unsPath` and every turn is `NO_ASSET_BOUND` — plumbing with no outcome. Without I0 this is the first slice that makes the Notebook speak about machine state on a route with no hazard classifier.

**Mike can now:** every Notebook turn carries a server-decided live verdict. Asking about the conveyor still answers from the manual with citations — **an unavailable feed must never suppress the manual** — but the transcript and the database record that MIRA had no current readings and exactly why.

**Changes**
- `mira-hub/db/migrations/083_notebook_turn_live_admission.sql` — NEW. `ADD COLUMN IF NOT EXISTS live_admission JSONB NOT NULL DEFAULT '{}'::jsonb, live_facts JSONB NOT NULL DEFAULT '[]'::jsonb`. Never touches 073. No new GRANT (`073:130-132` are table-level); no policy or GiST index references these columns. 083 is the number allocated in the plan's §2 decision 4. Develop against ephemeral local Postgres and add the file only when the shape is final — the first push makes it immutable (`.claude/rules/mira-hub-migrations.md` §8).
- `…/[id]/chat/route.ts` — call `assembleLiveEvidence` after the notebook fetch. Emit the live frame as the **first** enqueue in **both** ReadableStream constructors (abstain `:317`, grounded `:409`) — unavailability is true regardless of document evidence. When not admitted, append to `machineContext` (`:356`, concatenated at `:392`): *"LIVE MACHINE DATA: UNAVAILABLE — <reason>"* plus *"You have NO current readings for this machine. Do not state, guess, or imply what it is doing right now."* Pass the admission to `recordTurn` on both paths. Wrap so a failure yields `ADMISSION_UNAVAILABLE` and the documents-only answer still ships: **fail-open on the document answer, fail-closed on any live claim.** `unsPath` comes from I3's `resolveBoundAsset`.
- **Sanitizers must exist before this lands.** `sanitizeMachineMemoryField` (`api/assets/[id]/chat/route.ts:200-204`, a `neutralizeReferenceText` scrub passed into `renderMachineEvidenceSection` at `:537`) and `sanitizePII` (`:212+`) are defined **locally and not exported**, and the notebook route's `recordTurn` persists `turn.question` raw (`equipment-notebooks.ts:613-619`). Extract both into `@/lib/`, require the notebook live-block renderer to take the sanitizer as an injected argument (as `renderMachineEvidenceSection` already does), and apply the PII scrub to the persisted question in the same PR. S2-03's gateway-controlled `raw_quality` makes this non-optional.
- `equipment-notebooks.ts` — `recordTurn` accepts both fields; `listTurns` returns them with the **original** `observedAt`, never re-stamped.
- `notebook-chat-types.ts` — `NotebookLiveFrame` added to the union.

**Correction to carry into the code comment:** `recordTurn` runs after `controller.close()` on the **grounded** path only; on the abstain path it is `await`ed *before* the stream is built. Minting the id up front (W04) is what makes one code path serve both.

**Tests** · frame sequence grounded `['live','content',…,'sources','usage'?,'status']` and abstain `['live','sources','status']` — `sources` stays **last** on the grounded path because citations are filtered to the `[n]` markers the answer used (`:578`); the live frame is safe first because it is not filtered that way; a `REPLAY` turn **still** answers from documents (provider IS called, cited answer streams); the directive is in the machine-context block, not history, with the server's copy verbatim; **no "observed now" or "current" phrasing appears anywhere in the provider body when not admitted**; the admission persists on both paths; a thrown assembler yields `ADMISSION_UNAVAILABLE`, a live frame, a normal cited answer, and never a 500.

**Evidence** · `npx vitest run src/app/api/equipment-notebooks` green; 083 applied to staging by `migration-verify.yml` and both columns read back via db-inspect.

**Rollback** · Frame and directive revert together; 083 stays, its defaults inert.

---

### S2-07 · Render the unavailability with the server's words

**Mike can now:** stand at the conveyor and read above the answer: *"Live conveyor data is unavailable: the gateway is repeatedly sending one old, bad-quality observation."* Open the same turn later on web and read the same sentence with the observed time it applied to.

**Changes** · explicit field-by-field mapper for the live frame in `mira-mobile/src/lib/sse.ts` (next to `normalizeCitations` `:35`, inside the kind dispatch `:58-62` which today handles content/sources/status and drops the rest) — a new server field is a deliberate addition, never a cast. Banner above the answer in `NotebookScreen.tsx` and `NotebookChat.tsx` when `admitted === false && display === 'banner'`, showing `reason` **verbatim**, suppressed on `silent`, and rendered from a **persisted** turn so a phone opening a web-answered turn sees the warning that applied at the time. Canonical `--fl-ok / --fl-warn / --fl-fault` tokens (do not invent `--fl-amber`); `NO_ASSET_BOUND` silent, `STALE_OBSERVATION`/`REPLAY`/`SCOPE`/`ADMISSION_UNAVAILABLE` warn, `PHYSICAL_OR_GATEWAY`/`GATEWAY_QUALITY` on a bound asset **fault** — *"I have no readings at all for this machine"* is a fault, not a warning.

**Phone and web must land together.** If only one renders it, the two surfaces disagree about whether MIRA knows the machine's state, which is worse than neither showing it.

**Honest limit on mobile** · the phone neither streams nor retries a notebook turn. `askNotebook` (`mira-mobile/src/api/resources.ts:985-994`) is a POST with `timeoutMs: 120_000` and **no** `idempotencyKey`, and `request()` retries only when `method === 'GET' || Boolean(opts.idempotencyKey)` (`client.ts:333`) — so one transport failure throws `ApiError('network')` immediately, and the body is parsed only after it has all landed (`parseChatSse(r.text, r.status)`). On garage cellular a two-minute answer is all-or-nothing, and the banner appears at the same instant as the answer it precedes. **Say this in the slice; do not describe the banner as arriving first on mobile.** An idempotency key is possible once W04's up-front `turnId` makes the POST replay-safe; real streaming is a separate slice.

**Tests** · the frame parses regardless of position; a body with no live frame yields null (backward compatible with every existing fixture); unknown extra fields do not throw; the rendered text equals the server's `reason` **byte-for-byte** plus a grep-assert that **no threshold constant or age arithmetic exists anywhere in `mira-mobile/src`**; `display:'silent'` renders nothing; a persisted unavailable admission renders on read-back with the original `observedAt`; the cause→band mapping is asserted against S2-04's `REASON_COPY`.

**Evidence** · `bun run test` and `npx vitest run` green; `docs/promo-screenshots/…_notebook-live-unavailable-replay_{mobile,desktop}.png` — the technician-facing proof that the product can say it does not know.

**Watch** · `tools/mobile-e2e/journey.py` taps literal text; a new banner shifts layout. Check its assertions before merging.

**Rollback** · Client-only; revert.

---

### S2-08 · ⚙ HARDWARE — Diagnose and repair the publisher

**Mike can now:** at the gateway, name the fault in one look instead of guessing, fix the upstream cause, and re-run the **unchanged** gate for a GO.

**Pre-trip, cloud-only** · db-inspect probe F (`db-inspect.yml:586-598`): `distinct_values = 1` for all 12 tags confirms a frozen **source**; `> 1` with one distinct observed ts means a **timestamp bug in the reading path**; `observed_age ≈ ingest_age` means the collector stopped sending `ts` at all.

**At the gateway** · compare the Micro820 device-connection state (Gateway → Status → Devices), the trial-timer banner, the raw quality string for one allowlisted tag, and the tag's own `.timestamp` in the Designer tag browser against `max(tag_events.event_timestamp)` from probe D. Record all of it in `docs/proofs/2026-XX-XX-cv101-publisher-repair.md` **before** touching anything — that closes RC-03, where today the freeze's start time is knowable but its trigger is recorded nowhere.

**Standing prohibitions, reviewer-enforceable**
- Do **not** weaken `tools/cv101_live_gate.py` thresholds or its per-scan divisor to obtain a GO.
- Do **not** point the gate at simulator traffic (`PROVENANCE` exists to reject exactly that).
- Do **not** widen `mira-bots/shared/factorylm_live.py`'s `source_system='plc_bridge'` filter to make CV-101 visible to it — that reader guards the `factorylm_snapshot` envelope and widening it would relabel generic cache rows as snapshot evidence.
- On a `CAUSE_IDENTITY` verdict, check the Northwind stream first (§2.3) before concluding misconfiguration.
- A repaired publisher may still fail SCOPE — the gate hardcodes 12 while the repo seed carries 7. Check the deployed `approved_tags` before concluding the repair failed.

**Evidence** · the proof doc plus a GO run (exit 0) quoted verbatim — the first non-failure since 2026-08-14 — plus `pytest tests/test_cv101_live_gate.py` unchanged and green (the gate must not have been edited to obtain the GO).

**Non-blocking** · S2-04 through S2-07 and S2-10 are built, tested, and merged against the NO-GO feed. That is the entire reason the honest-unavailable state is sequenced first.

---

### S2-09 · Admitted live facts enter the turn — the GO path, deliberately last

**Depends on S2-06, S2-01, I0, and P05 (fact-vs-inference marking).**

**Mike can now:** after a fresh GO, ask *"what is it doing right now"* and get an answer whose every fact line carries source system and connection, the UNS path, observed time, ingest time, quality, and units — and **zero** fact lines on every unavailable cause.

**Changes**
- `notebook-live-evidence.ts` — on an **admitted** verdict only, build `LiveFact[]` from a `DISTINCT ON (tag_path)` latest-row read inside the already-windowed probe. **Facts come from `tag_events`, not `fetchLiveSignals`:** `live_signal_cache` has no source clock at all (its columns are `last_seen_at` / `last_changed_at` / `created_at` / `updated_at`, and `tag_ingest.py` states in-code that `last_seen_at` is **server receipt time**), so a cache-sourced `observedAt` is physically unimplementable and its guarding test would pass green while the real path rendered a 380,303-second-old value under "observed now." `tag_events` carries `event_timestamp`, `quality`, `source_system`, `source_connection_id` (`033:78-89`). Use `LiveTag` from `machine-memory-response.ts` for value/unit **formatting only**. Cap with `MAX_LIVE_TAGS_IN_PROMPT` (`machine-context-packet.ts:66`).
- `…/[id]/chat/route.ts` — render a **value-only** evidence block.

  **Excluding `active_conditions` alone is not sufficient.** `packet.summary` carries the same text: `machine-context-intelligence.ts:190-194` builds ``return `${word}: ${top.title}.${next}` `` where ``next = ` Next: ${top.next_check}` ``, and `machine-context-packet.ts:87` pushes `- Assessment: ${sanitize(packet.summary)}`. The vocabulary is `plc/conv_simple_anomaly/anomaly_log.py:34-46` — *"clear the cause, then reset the drive (STOP+RESET)"*, *"Clear the object blocking the infeed photo-eye (DI_05), then re-arm with Start"*, *"Inspect the belt/rollers for a jam or binding"*, *"Inspect the dual-channel e-stop loop"*, *"Reseat the RS-485 wiring PLC↔GS10; power-cycle the drive"*. Exclude `packet.summary` from the notebook live block too, or strip the ` Next: …` clause at source. Pass facts to `recordTurn` (`live_facts`, migration 083).

**Tests** · **the load-bearing negative, table-driven over every cause** — for each unavailable cause the provider body contains zero fact lines and zero "observed now" phrasing, so a newly added cause cannot skip it; **no `next_check` string from the NEXT_CHECK table appears anywhere in the provider body**; admitted facts carry `observedAt`, `quality`, and unit, with a null unit rendering without a fabricated one; **`observedAt` comes from `event_timestamp`** — asserted with a fixture where `event_timestamp` and `last_seen_at` differ by hours (the exact replay shape), against the assembler's emitted SQL and rows, not a hand-built `LiveFact`; facts persist and read back with the original `observedAt`; count never exceeds the cap; a per-tag degraded quality is excluded even inside an admitted verdict; a `SAFETY_KEYWORDS_IMMEDIATE` message emits no fact lines and no provider call even on an admitted GO.

**Evidence** · `npx vitest run` green with the per-cause negative table passing, **on fixtures**. Real-data proof is S2-11's job and the PR must say so.

**Rollback** · Feature-flag the fact block off; the unavailable path is unaffected.

---

### S2-10 · The five negatives proven against a deployed Hub

**Mike can now:** trust the unavailable states he reads at the conveyor, because each has been produced end-to-end on staging through the real ingest path — not asserted on a mock. Today the staging-integration layer for this route is empty.

**Changes** · `tools/notebook-live-negatives/` — NEW, extending `notebook_proof.mjs`. A signed-batch poster driving five shapes through the canonical inlet — `POST /api/v1/tags/ingest` → `mira-relay/tag_ingest.py::ingest_batch`, built with `ingest_contract.py`'s `build_tag_entry` / `build_ingest_batch`. Forks **no** normalizer, allowlist, persistence, or batch shape (`.claude/rules/one-pipeline-ingest.md`, Contract 5).

**Two preconditions the harness cannot create for itself.** `/api/v1/tags/ingest` returns 401 without valid per-tenant HMAC (`relay_server.py:271-273`), and `ingest_batch` rejects every tag absent from that tenant's `approved_tags` with `not_allowlisted` (`tag_ingest.py:246-249`, fail-closed **by design**). Without both, all five shapes persist zero rows and the Hub verdict is `PHYSICAL_OR_GATEWAY` for every one — with shape (e) "relay down" passing for the wrong reason, exactly the vacuous green this stream exists to prevent. So:

1. A **staging-only `approved_tags` seed** for the harness tenant, applied via `apply-seeds.yml` before the run. The allowlist is a *security control and a precondition* of the contract, not telemetry — the non-goal is amended to say the harness may seed the allowlist but never writes `tag_events` or `live_signal_cache` directly.
2. **HMAC key provisioning** for that tenant from `factorylm/stg` Doppler.
3. **A positive control as the first assertion:** post one well-formed batch and assert `accepted > 0` / `rejected == []`. Without it every negative is indistinguishable from a misconfigured harness.

**Executable environment guard, not prose** · the harness asserts its resolved base URL and database host are the staging ones and exits non-zero otherwise **before the first POST**, with a test that the assertion fires on a planted prod-looking host — the same negative-control discipline W06 applies to itself. A REPLAY or GATEWAY_QUALITY shape injected into prod `tag_events` under CV-101's path would be indistinguishable from real gateway data.

**Shapes** · (a) REPLAY — many batches, one frozen ts, advancing ingest; (b) STALE_OBSERVATION — one batch, 900 s-old ts; (c) GATEWAY_QUALITY — fresh ts, `quality='bad'`; (d) wrong asset/tenant, run cross-tenant, asserting 404/empty and never a borrowed reading; (e) relay down.

**Tests** · each shape produces the expected cause and technician sentence end-to-end; in all five the manual answer still streams with citations; no shape leaves residue (scoped tenant, own `uns_path`).

**Evidence** · one manually-dispatched staging workflow run URL per negative with the streamed frames quoted. Not scheduled, not a merge gate on day one — an honest "run deliberately" label beats a green check nobody triggers.

**Note** · if S2-05 decided `ALLOWLIST_IDENTITY` is CI-only, say so here rather than leaving a reader believing a cause is covered when it is unreachable Hub-side.

**Rollback** · Delete the harness.

---

### S2-11 · ⚙ HARDWARE — One admitted live turn, then pull the plug

**Mike can now:** ask the current-state question beside a running conveyor and get an admitted, cited, timestamped answer — then **stop the publisher, ask the same question, and watch it flip to unavailable** with the correct cause and no reuse of the previous reading.

**The second half is the more important half.** An admission gate that only ever admits has not been tested.

**Evidence** · `docs/proofs/…-cv101-live-go-and-admitted-turn.md` with the GO run URL, the Hub verdict for the same window, the admitted turn, the screenshot, and the persisted `live_admission` / `live_facts` read back via db-inspect. Screenshots → `docs/promo-screenshots/`.

**Scoped parity, not absolute** · the Hub verdict must agree with CI on GO/NO-GO **for causes both probes can observe**. They are scoped differently by construction (CI: `source_connection_id` OR `uns_path`, no tenant predicate; Hub: tenant AND ltree), so a genuine identity fault makes them disagree **by design** and an absolute gate would produce a false stop-ship.

**⚠ Publication gate — the repo is PUBLIC.** `gh repo view Mikecranesync/MIRA --json visibility` returns `"visibility":"PUBLIC"`, and `docs/promo-screenshots/` is declared append-only and feeds `tools/seedance-video-gen.py` (an automated YouTube pipeline). Record `live_facts` in the public proof as a **redacted shape** — tag name, freshness, units, **not values** — and keep the full read-back out of the repo. Fine for Mike's garage; not fine the first time a beta tenant walks the same deck. See W01's `publishable` flag.

---

## 5. Stream 3 — PROVE: the walk as a repeatable, recorded loop

Walking the conveyor **is** the verification. But Mike's time at the machine is the scarcest resource in this program, and today nothing separates a card that needs the conveyor from a card that only needs a server. §13 defines fourteen cards; `grep -rln "Frozen replay|Citation integrity|Safety STOP"` finds them in exactly two markdown files and **nothing** under `tools/` or `tests/`. They are prose.

Counting honestly against the harnesses that exist: **8 of 14 cards are fully pre-verifiable at the desk, 2 partially, and only 4 genuinely require the machine or the phone.**

| §13 card | Pre-verified at the desk by | Left for the machine |
|---|---|---|
| Known manual fact | `notebook_proof.mjs --expect-citation --expect-status answered --expect-answer-contains` (`:229-253`) | render only |
| Unknown fact / refusal | `notebook_proof.mjs --expect-status insufficient_evidence` (`:246-248`) | nothing |
| Citation integrity | `notebook_proof.mjs` docId scoping (`:241-244`) + `mobile-e2e --stop-after citation` (`journey.py:615`) | nothing |
| Wrong asset / source | crew `.check` walking 403/404/422 live (P21 `notebook-tenant-isolation`) | nothing |
| Safety STOP | crew `.check` (P21 `notebook-safety-stop`) — **RED until I0** | nothing |
| Follow-up continuity | `tests/beta/beta_notebook_continuity.py` (P22) | the cross-device gesture |
| Bad quality (live) | `tests/test_cv101_live_gate.py` fixtures | nothing |
| Frozen replay | `cv101-live-gate.yml` against the **current** frozen feed — a free negative test today | the plain-language sentence on screen |
| Interrupted stream | `notebook_proof.mjs` `[DONE]` assertion (`:231-233`) — detect half only | the "interrupted" labelling |
| Exact identity | `mobile-e2e` covers picker + typed routes | the QR scan itself |
| **Live state (GO)** | ⚙ nothing — S2-08 | all of it |
| **Camera** | ⚙ nothing — #3353 | all of it |
| **Cellular** | ⚙ nothing — emulator uses the host network | all of it |
| **Offline** | ⚙ nothing — same reason | all of it |

**Nothing here builds a new runner.** `notebook_proof.mjs`, `tools/mobile-e2e`, `tools/crew/dogfood/judge.sh`, and `cv101-live-gate.yml` are the four engines; this stream is the ledger, the dispatcher, and the record over them.

---

### W01 · Walk card ledger

**Mike can now:** open one file and see, per card, what it proves, whether it needs the conveyor, the exact pre-verifying command, and what artifact it must produce.

**Changes** · `docs/dogfood/walk-cards.yaml` — one row per card: `id`, `title` (verbatim from §13), `proves`, `layer` (server|app|hardware), `pre_verifier` (runnable command or `none:<reason>`), `artifact`, `record_field`, `blocked_by`, `status` (active|parked), and **`publishable: true|false`**. `tests/test_walk_cards.py` parses the §13 table out of the spec markdown and compares by string equality on the *Technician action* column. `docs/dogfood/README.md` states the one rule: a card is pre-verified only if a command **exits 0** — a passing memory is not a verdict — and states the repo's **public** visibility so the next walker does not have to discover it.

**Tests** · every spec card has exactly one ledger row and the ledger has no orphans (drift fails CI); a `hardware` row carrying a `pre_verifier` is an error (mis-classified card = wasted trip); every `pre_verifier` path exists on disk; **any artifact containing tag values, transcripts, or tenant identifiers is `publishable: false`** and routed to a gitignored path, referenced by id from the public record.

**Rollback** · Delete the files; nothing depends on them yet.

---

### W02 · Pre-walk runner

**Mike can now:** run one command before leaving and get a manifest saying which cards are GREEN, which are RED (so he expects the failure), and which four he must carry.

**Changes** · `tools/dogfood/prewalk.sh` reads the ledger, runs every non-hardware row, dispatching only to the existing engines, and writes `prewalk.md` + `prewalk.json`. **Fail-closed mapping:** exit 0 → GREEN, exit 1 → RED, exit 2 / missing tool / missing credential / no verdict line → **BLOCKED**. BLOCKED is never GREEN and never silently skipped. `tools/dogfood/test_prewalk.sh` is hermetic, shaped like `tools/crew/dogfood/test_judge.sh` — shimmed sub-commands, no live Hub, no gh, no provider spend.

**Tests** · every ledger card gets exactly one verdict; a shimmed-away harness is BLOCKED, not GREEN (the vacuous-green guard); a non-zero exit is RED and the row reproduces the command verbatim; hardware cards are listed as CARRY, not skipped.

**Cost** · `notebook_proof.mjs` is ~$0.0002/turn and ~10 s per its README; only the notebook cards spend, one turn each. The runner defaults to staging and prints the estimated turn count first.

---

### W03 · Walk deck and scaffolded session record

**Mike can now:** carry an ordered, offline deck — cheapest disqualifying card first — with every walk landing in a dated directory whose build sha, deploy sha, and gate run URL were filled in automatically.

**Changes** · `tools/dogfood/new-session.sh` scaffolds `docs/dogfood/sessions/<date>/`, stamping app build sha + versionCode (`adb shell dumpsys package com.factorylm.mira`, else UNKNOWN), Hub deploy sha, tenant id, and the latest gate run URL, and copies in the manifest. `docs/dogfood/walk-deck.md` is generated from the ledger, ordered **identity → sources Ready → known fact → citation open → refusal → safety STOP → interrupted → live**, one screen per card with the reproduce-at-desk command. `docs/dogfood/session-record-template.md` carries the §13 fields plus a per-card row. `docs/dogfood/sessions/README.md` is the index.

**Tests** · deck ids and order match the ledger exactly; every session dir has an index row; the template has a row for every carried card.

**Guard against it becoming a scripted demo** (which §13 rejects): cards are ordered by disqualification speed, not narrative, and the session record's mandatory *"what task was Mike actually trying to finish"* field is free text, not derived from the deck.

---

### W04 · Turn locator

**Mike can now:** point at any answer he got at the conveyor and name the exact persisted turn.

**Changes** · mint `const turnId = crypto.randomUUID()` in `…/[id]/chat/route.ts` **before either ReadableStream is constructed**; pass to `recordTurn`; include on both status frames (`:322-327`, `:585-591`). `recordTurn` accepts an explicit `id` (`073:88` is `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, so an explicit id is accepted); return type unchanged. The `recordTurn failed` log (`:620`) gains the same id. `mira-mobile/src/lib/sse.ts` — `ChatTurn` gains `turnId?: string`, additive (the shipped parser reads only `frame.status` at `:57-59`). `docs/runbooks/notebook-turn-locator.md` documents the read-only db-inspect window query for every turn taken before this ships.

**Why minted up front:** on the **grounded** path `recordTurn` runs after `controller.close()` (`:604-609`); on the **abstain** path it is awaited *before* the stream is built. One id source serves both.

**Tests** · the emitted `turnId` equals the persisted row id on the answered path **and** the abstain path (the path most in need of reproduction); when `recordTurn` throws, the stream still emitted a `turnId` and the error log carries it; a status frame **without** `turnId` still parses (backward compatibility with the installed 1.0.0 build).

**Contained** · additive field on an existing frame, no reordering, no new frame kind.

---

### W05 · Live NO-GO as a pre-verified negative card

**Mike can now:** settle the frozen-replay and bad-quality cards at his desk **today**, against the real production feed, and arrive with the exact sentence the app should show.

**Changes** · collapse §13's "Live state" and "Frozen replay" into one card with two ends: NO-GO (pre-verifiable now) and GO (⚙ hardware, `blocked_by: S2-08`). `prewalk.sh` reads the latest gate run — exit 0 → GO, 1 → `NO-GO:<cause>`, 2 → UNKNOWN — and records the run URL. **It never re-runs the gate with altered thresholds.** The deck prints the expected unavailable sentence verbatim from §9 so the at-machine check is a string comparison.

**Tests** · a shimmed gate returning `NO-GO:REPLAY` produces GREEN-for-the-negative — **the app correctly showing unavailable is a pass, not a failure**; the GO end is `layer: hardware` and can never be marked passed from a desk; reuse `tests/test_cv101_live_gate.py:36-63` as the fixture.

---

### W06 · Control-path cards — **two cards, honestly named**

The proposed single card titled "No control path" would be **misleading**. A static import/URL scan cannot see the actual control-adjacent risk, which is *content*: MIRA already relays *"reset the drive (STOP+RESET)"* and *"Clear the object blocking the infeed photo-eye (DI_05), then re-arm with Start"* (`anomaly_log.py:41,46`) into a block whose header says to treat it as current and to end with "the recommended next checks" (`machine-context-packet.ts:119`). A guard exists in Python and is applied to no Hub route: `mira-bots/shared/answer_qc.py:314` — *"Asserts a control action occurred. MIRA has no control path — ever."*

**Card A — "No fieldbus client ships."** `tests/test_no_control_path.py` — default-deny AST/regex scan shaped like Contract 5, over shipped mobile sources and the Hub route surface: no `pymodbus`/`pycomm3`/`python-snap7`/`opcua` import, no plant host or gateway URL, no write verb at a plant surface. Allowlist entries require a documented reason. **Negative control mandatory:** a synthetic module with a modbus import and a write call **must fail** the checker — without it the check is vacuous. Current true state pinned: `mira-mobile/android/capacitor.settings.gradle` registers only capacitor-android, capacitor-app, capacitor-preferences.

**Card B — "MIRA never coaches a control action."** Port `answer_qc.py:314` into a test over the rendered prompt block **and** the streamed answer, using the NEXT_CHECK table as the fixture corpus (this is I0's `answer-control-guard.ts`).

**Rule** · the deck must not carry a card whose title claims more than its verifier.

---

### W07 · Close the loop

**Mike can now:** turn each walk into a permanently cheaper next walk.

**Rule** (`docs/dogfood/close-the-loop.md`): (a) failed at the machine **and** its pre-verifier had passed → the pre-verifier is defective; the deliverable is a strengthened assertion in that harness; (b) failed with no pre-verifier → write one, or record why it is irreducibly physical; (c) passed with no pre-verifier → promotion candidate.

Cards gain `last_walk: {date, verdict, session}` and `pre_verifier_gap: <issue|null>`. `tests/test_walk_cards.py` asserts a `FAIL` carries either an issue reference (well-formed `owner/repo#N`, so prose cannot satisfy it) or a changed `pre_verifier`.

**Precedent** · `tools/mobile-e2e/README.md`'s "Bugs this harness found in its own first runs" table — eight traps encoded back so the next driver cannot hit them. This makes that discipline obligatory rather than conscientious. The gate fires on an **unclosed failure**, never on the failure itself, so recording is always cheaper than hiding.

---

### W08 · Route the four hardware-only cards into the physical-phone gate

Camera, Cellular, Offline, and Live-state-GO are `layer: hardware`, `pre_verifier: none:<reason>`, with `record_field` pointing at **P27's gate template** rather than the session record — one home, not two. Extend P27's existing sync test (parse the coverage table in `tools/mobile-e2e/README.md`, extract every leg marked "no", assert each has a ledger card and a gate row) rather than writing a second. Degrades to a warning if P27's template does not yet exist — never a false green.

---

### W09 · Park NFC and GPS as **differential** cards, not new journeys

`status: parked`, absent from the deck, costing nothing until activated.

- **NFC:** acceptance = tapping the tag yields a **byte-identical tag string** and resolves to the **same notebook and same canonical key** as the QR card — verified by running the identity card twice and diffing.
- **GPS:** acceptance = **contradiction only** — it may scope a site or warn that the scanned asset is far from its registered site, and may **never** select or confirm an asset.

**Tests** · parked cards are absent from the deck; the NFC card is defined as a diff against QR; **the GPS card's acceptance text contains no selection or confirmation verb** — the guard against a later slice proposing "nearest asset by GPS."

---

## 6. The localization ladder — NFC and GPS, scoped honestly

**Verified absent today.** No NFC plugin, permission, manifest entry, or entitlement anywhere in `mira-mobile` (targeted API-name grep across `src`, `android`, `ios`; `grep -ci nfc` on both lockfiles → 0). No `@capacitor/geolocation`, no `ACCESS_*_LOCATION`, no `NSLocationWhenInUseUsageDescription`. And **no latitude/longitude/geometry column in any migration in the repo** — `cmms_equipment.location` is free text.

**The convergence rule that makes the ladder cheap:** a localization method's only job is to produce a **tag string**. `extractAssetTag` (`mira-mobile/src/lib/tags.ts:49-87`) is already the single funnel for camera decode, OS deep link, and typed input, pinned to the Hub by `docs/contracts/asset-tag-grammar.json` and a shadow suite. Tag → `/api/assets/by-tag` → `cmms_equipment.id` → `kg_entities.uns_path` is shared by all of them. **Write the NFC tag as an NDEF URI record containing the identical `https://app.factorylm.com/m/CV-101` and NFC inherits that entire chain, its tests, and its trust filter for free.**

**Three honest costs on the NFC rung:**

1. **No zero-native-code route.** Web NFC / `NDEFReader` is **not supported in Android WebView** (the permission prompt is a Chrome feature WebView never implemented), so unlike the camera there is no JS-over-WebView trick. `MainActivity.java` is currently a bare 5-line `BridgeActivity`.
2. **Licensing.** The best-maintained plugin (`@capawesome-team/capacitor-nfc`) is **not on public npm** (`npm view` → 404) and ships under a EULA — a direct PRD §4 violation. The MIT alternative `@exxili/capacitor-nfc` is license-clean with peer range `>=6.0.0 <9.0.0` (covers Capacitor 8) but is v0.0.13, single-maintainer, last published 2026-02-15.
3. **Same swap risk as a sticker — arguably worse**, because a sticker carries human-readable text a technician can eyeball and an NTAG does not. I2's `'nfc'` in `asset_selected_via` records provenance only and **never** populates `asset_confirmed_*`.

**Cheapest first experiment (unproven, worth one Pixel test):** add `<uses-permission android:name="android.permission.NFC"/>`, `<uses-feature android:name="android.hardware.nfc" android:required="false"/>`, and an `NDEF_DISCOVERED` intent-filter on MainActivity **reusing the existing `scheme=https / host=app.factorylm.com / pathPrefix=/m/` data element** (`AndroidManifest.xml:35-44`). Write one NTAG215 with the identical URL and tap it. If `appUrlOpen` fires (`main.tsx:15-18`), NFC is done with **zero TypeScript**. **Risk I could not resolve from the repo:** Capacitor's `Bridge.onNewIntent` may gate on `Intent.ACTION_VIEW` while NFC dispatches `NDEF_DISCOVERED` — plausible, not confirmed. Fallback is ~10 lines in `MainActivity.java` re-dispatching as `ACTION_VIEW` with the same data URI.

**iOS is asymmetric** — NFC requires an Apple-portal entitlement and a paid account; `ios/App/App/Info.plist:9-10` has only `NSCameraUsageDescription`. Scope the rung Android-only and say so.

**GPS: probably never for this product.** Consumer GNSS degrades from ~5 m outdoors to tens of metres or no fix under a steel roof, while CV-101 and a hypothetical CV-102 sit metres apart. Its only honest jobs are site-level scoping and **contradiction**, and both cost a new permission, a Play Data Safety declaration (§413 already names it a Play gate), and new schema. **No GPS value in `asset_selected_via`, ever.**

---

## 7. The walk

Everything marked **[DESK]** is settled before he leaves. Everything marked **⚙** genuinely needs him or the machine.

**Before leaving the house**

1. **[DESK]** `bash tools/dogfood/new-session.sh` — scaffolds today's session dir, stamps build sha / deploy sha / tenant / latest gate run.
2. **[DESK]** `bash tools/dogfood/prewalk.sh` — runs every non-hardware card. Read the manifest. Any **BLOCKED** row is carried as if untested.
3. **[DESK]** Read the live card. Today it will read `NO-GO:REPLAY` and that is a **pass for the negative**: the walk's live test is *does the app say so in plain language*, not *is there a GO*. Note the expected sentence verbatim from the deck.
4. **[DESK]** If the live card is NO-GO, run db-inspect probe F first (`distinct_values` per tag) so the gateway trip has a target: `= 1` across all 12 → frozen source; `> 1` with one observed ts → timestamp bug in the reading path.
5. **⚙ BY HAND, once:** print the CV-101 sticker from `https://app.factorylm.com/assets/print-qr` — **confirm the URL rendered under the label is `https://app.factorylm.com/m/CV-101`**, not staging or localhost, or the in-app scanner will reject it permanently (§I5). Stick it on the conveyor. CV-101 already has its `equipment_number`; no tag minting needed.

**At the conveyor**

6. **⚙** Open FactoryLM on the Pixel. *(Card: offline tolerance — if you have signal, note whether the app boots without a login wall; I5b.)*
7. **⚙** Assets → **⌗ Scan QR** → point at the sticker. **Card: exact identity.** Expected: you land inside CV-101's notebook, and the context card names the machine.
8. **⚙** Read the card's tone. Before I7 it should say **selected from a QR sticker — not confirmed** (amber). Tap **"Confirm this is the machine in front of me."** **Card: identity confirmation.** *(§8 step 7 is only closed by this tap, not by the scan.)*
9. **⚙** Confirm the sources panel shows the three CV-101 documents as Ready. *(Pre-seeded at the desk by `tools/dogfood/seed-cv101-notebook-sources.mjs`; you are checking the render, not the ingest.)*
10. **⚙** Ask a **known manual fact** you can verify from the print in your hand. Open the citation. **Card: citation integrity — is the passage usable standing here, on a phone, with gloves?**
11. **⚙** Ask something the manuals genuinely do not contain. **Card: refusal.** Expected: an explicit insufficient-evidence answer, not a plausible guess.
12. **⚙** Ask a **hazardous** question (something that would require touching wiring or a guard). **Card: safety STOP.** Expected: a hard stop with an isolation requirement, before any cited procedure. *(RED until I0 ships — expect the failure and record it.)*
13. **⚙** Ask **"what is this conveyor doing right now?"** **Card: live state.** Today expect the plain-language unavailable sentence from step 3, word for word. **A frozen feed described honestly is a PASS.** A confident current-state answer is the failure.
14. **⚙** Walk out of signal (or airplane mode) and ask again. **Card: cellular / offline.** Expected: an honest failure, and the app still usable. *(A notebook turn is online-only — there is no offline answer path.)*
15. **⚙** Take the nameplate photo. **Card: camera.** *(#3353 — the photo picker, not the scanner.)*

**Only if the live card is NO-GO and you are already at the gateway**

16. **⚙** Before touching anything, record: `max(tag_events.event_timestamp)` (probe D), the Micro820 device state and last state change (Gateway → Status → Devices), the trial-timer banner, the raw quality string for one allowlisted tag, and the tag's own `.timestamp` in the Designer browser. Then repair. Then re-run the **unchanged** gate.
17. **⚙** On a GO: ask the current-state question again, then **stop the publisher and ask it a third time.** The flip back to unavailable is the more important half.

**Back at the desk**

18. **[DESK]** Fill the session record. For every card that failed at the machine: either strengthen the pre-verifier that lied, or file the `pre_verifier_gap` issue. `tests/test_walk_cards.py` will fail CI until one of those exists.

---

## 8. What we are NOT doing

**Identity**
- Never write `cv_101` into `kg_entities.entity_id`, whatever ADR-0035 §1 currently says — three live resolvers break silently (§2.1).
- No UNS path rename. Four rival paths are recorded, not renamed; ADR-0035 requires one atomic 7-part migration.
- Do not repoint `equipment_notebooks.node_id` at the CV-101 bridge node. `node_id` scopes **documents**; `equipment_entity_id` names the **machine**.
- Do not widen retrieval with the bound UNS path — `retrieveNodeChunks` keeps `unsPath: null`; passing it triggers ltree subtree expansion and overrules the validated doc set that is the notebook's entire safety model.
- Do not rewrite `tools/seeds/garage-cv101-kg-bridge.sql` or any applied migration (`.claude/rules/mira-hub-migrations.md` §8).

**Live data**
- No fork of the gate. `tools/cv101_live_gate.py` stays the authority; S2-04 is a parity-pinned port.
- **No threshold widening, ever, to manufacture a GO**, and no pointing the gate at simulator traffic.
- No `distinct_values` threshold — a stopped conveyor's steady tag has `distinct_values = 1` while being perfectly live.
- No observation-age or replay logic at **write** time. `_derive_freshness`'s signature stays `{simulated, quality}` — Ignition report-by-exception froze client timestamps on a healthy 2 s stream in 2026-07 and made it permanently stale.
- No `source_connection_id` in `fetchLiveSignals` — the `undefined_column` is swallowed into `[]` and silently blanks every live signal.
- No admitted facts from `live_signal_cache` — it has no source clock, so an `observedAt = event_timestamp` guarantee through that path is unimplementable and its guarding test passes green over the real defect.
- No `active_conditions`, `next_check`, or `packet.summary` inside the live evidence block — those are **actions** in a section labelled machine-observed evidence.
- No second live reader (`factorylm_live.py` stays scoped to `plc_bridge`), no client-side freshness (no threshold constant or age arithmetic in `mira-mobile/src`), no reordering of the `sources` frame.

**Everywhere**
- **No control path of any kind.** No PLC/VFD/safety-controller writes, no start/stop/reset/acknowledge/setpoint/jog/mode/bypass/force/download, no phone or cloud fieldbus socket. W06 exists to assert its absence — in **two** cards, because a static scan cannot see coached actions.
- No second ingest inlet. S2-10 posts through `ingest_contract.py` → `ingest_batch` and forks nothing (Contract 5).
- No second tag resolver, QR generator, router, safety policy, or UNS resolver.
- Do not touch the in-app QR scanner. It is real, working, and defensively written — and it is **not** #3353.
- No SQL seed that mints notebook sources, `match_state='verified'`, or citable chunks (§I6).
- No new test runner, eval harness, or telemetry table.
- Not in scope, named so nobody mistakes silence for coverage: the notebook capability gate (no `equipment-notebooks` route calls `requireCapability`; tenant-gated only), cookie-jar secure storage, Slack thread convergence, streamed SSE on mobile, retention policy for `live_facts` inside a conversation record, deletion of the legacy inline cascade at `chat/route.ts:117` that still lists Gemini, turning `tools/mobile-e2e` into scheduled CI (needs a KVM runner), and **#3218 large-manual retrieval completeness** — one cited answer is not coverage.

---

## 9. Open questions for Mike

Five, all real forks. Everything else in this plan is decided.

1. **ADR-0035 §1 amendment — approve?** The evidence in §2.1 says the canonical key must be *derived*, not stored in `entity_id`, and that implementing the ADR literally silently blanks the machine-memory card, signal history, and the chat route's live packet. Amending an ADR is your call, not the agent's. **Nothing in Stream 1 can bind CV-101 until this and the prod seed apply land.**

2. **Who owns `/m/{tag}`?** Today nginx gives it to mira-web, which resolves against `asset_qr_tags` and shows a "Register equipment" page for a conveyor registered since migration 012. I9 flips bare `/m/{tag}` to the Hub — the highest-blast-radius change in the plan, a VPS action, and it makes `/api/public/report` reachable from a real scan for the first time (with three security preconditions listed). The smaller alternative fixes the 404 but not the walk. **Flip, or fallback?**

3. **`/api/m/*` — wire it or delete it?** `grep -n location deployment/nginx-app-factorylm.conf` shows no `/api/m/` block, so mira-web's auto-register and guest-report POSTs both 401 at the Hub middleware. Either add the proxy block (with the flip) or delete the dead write paths. Do not ship the `equipment_number` fix for a route nothing executes.

4. **`assetlinks.json` — VPS copy, or ship it from `mira-hub/public/`?** The 307 proves the deployed nginx lacks the exact-match block and/or the file was never copied to `/opt/mira/well-known/`. A `mira-hub/public/.well-known/assetlinks.json` survives config drift; the VPS copy matches the documented design. Android re-runs verification only on install, so this wants deciding before your next reinstall.

5. **NFC rung — worth one Pixel experiment now, or park it?** The manifest-only test in §6 is roughly an hour and answers whether NFC is free or a plugin project. It is genuinely optional: the in-app scanner already works, and adding a second producer for an identity the product currently discards is premature until Stream 1 lands. **My recommendation: park it, and revisit after step 8 of the walk succeeds.**
