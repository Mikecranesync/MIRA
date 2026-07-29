# ProveIt Factory — Import / Visualize / Connect / Prove — Implementation Plan

> **The buildout that makes the ProveIt demo real.** Goal: MIRA **imports** the real ProveIt factory
> namespace, **visualizes** it, **connects** to its live feed read-only, and **proves** a cited,
> scored diagnosis — exactly what it must do on the ProveIt! 2027 stage (Feb 9-12, Dallas).
> Drives `docs/plans/2026-06-22-proveit-2027-demo-runbook.md` (closes prereqs 1-12) and `NORTH_STAR.md`.
> Rehearsal data is in hand: `../proveit-factory/` (Cappy Hour Enterprise B, ~5,200 tags + pilot DB +
> MIT Flexware live sim). Grounded in the 2026-06-22 four-scout gap analysis.

## Preconditions & honest corrections (read first)
1. **Build on `origin/main`, NOT `feat/vfd-analyzer-auto-map`** (stale, far behind). The Why-MIRA panel,
   decision-trace routes (#2081), and the SimLab self-scoring dashboard (#2236) exist only on main.
2. **Citation correction:** the GUI/`/api/uploads` path lands manuals in **Open WebUI KB, which
   `recall_knowledge` never reads** — there is no OW->`knowledge_entries` sync. The **only reliable
   citable path is batch → `knowledge_entries` with embeddings.** The "beta gate MET (#2077)" claim is
   conditional (the gate test is still `xfail(strict)`); the demo grounds via the batch/script route.
3. **Read-only, always.** The MQTT subscriber subscribes only, never publishes (`fieldbus-readonly.md`,
   `train-before-deploy.md`). Honor `direct-connection-uns-certified.md` (certify or reject) and
   `uns-compliance.md` (build paths only via `uns.py` builders).

## What already exists (reuse — do NOT rebuild)
- **Receiving end of import:** `kg_entities` (ltree UNS) + `relationship_proposals`/`ai_suggestions` +
  the approve write path (`/api/proposals/[id]/decide` -> `applyHubProposalTransition` -> `kg_relationships`
  + `namespace_versions` audit) + the `/namespace` & `/command-center` tree render. Feed it in bulk.
- **Engine live-connect support:** `engine.process(uns_source=, live_tags=)` + gate-skip on
  `source="direct_connection"` + gate-guarded `live_snapshot` attach. The internals are done; needs an MQTT front door.
- **Live store:** `live_signal_cache` (+ freshness) + `mira-relay/tag_ingest.persist_batch` upsert shape.
- **Proof surfaces:** the **SimLab self-scoring dashboard** (`simlab/dashboard.html` + `/simlab/eval/*` +
  `evaluation.py`, 5 graded dimensions) and **"Why MIRA Thinks This"** (`WhyMiraThinksThis.tsx`, wired into
  `AssetChat`, decision-trace routes). Citation **enforcement** is real (engine H4 "cite or admit gap").

---

## Phase 0 — Foundation *(do first; small)*
**Goal:** a clean base + the test scaffolding everything else needs.
- Branch off `origin/main`. Provision a **`proveit` tenant** (UUID `tenants` row + Hub tenant/session).
- Add a trimmed `Enterprise B/tags.json` **fixture** (one site/area/line/equipment subtree) to the parser tests.
- **Gate:** tenant resolves on a real route; fixture loads. **Deps:** none.

## Phase 1 — IMPORT: Ignition tag tree → hierarchical context *(the "contextualize" showstopper)*
**Goal:** `tags.json` (5,286 nodes, UDT instances, MES bindings) becomes an approved Cappy Hour namespace
in `kg_entities`, rendering in `/namespace` + `/command-center`.
- **1a Parser PR (mira-plc-parser):** detect Ignition tag-export JSON (`"tagType"`+`"tags"` root; CESMII
  variant); add `parsers/ignition_json.py` (walk tree; Folder->path, `UdtInstance` w/ `Models/Equipment/*`
  typeId -> asset, atomics -> tags w/ engUnit + `MesTagPath`/`TagPath`; CESMII `MachineIdentification` ->
  manufacturer/model/nameplate). **Extend the IR for ISA-95 containment** (asset node w/ `parent_path`,
  `udt_type`, `mes_path`) — *the load-bearing change; keep additive so L5X/CSV/analyze are untouched*.
  Make `i3x.py` honor the real `enterprise.site.area.line.equipment` hierarchy. *(M-L; the IR extension is L.)*
- **1b Hub ingest PR:** build the spec's `/api/v1/ingestion/tag-import` as a **background, idempotent job**
  (widened to the parser IR/i3x JSON, not flat CSV): create `kg_entities` (site/area/line/asset) + signal
  `ai_suggestions(type=tag_mapping)`, all `proposed`. Add **batch/subtree approve** (not one POST/edge).
  `/tag-import` reconciliation UI with pagination for thousands of rows. *(L — the harder half; scale.)*
- **Gate:** `python -m mira_plc_parser analyze "Enterprise B/tags.json"` emits a correct hierarchy + UDT
  roles + MES paths; Hub imports it into `kg_entities` and `/namespace` renders the Cappy Hour tree; a
  human bulk-approves an asset subtree. **Closes runbook prereqs #3, #7.** **Deps:** P0.

## Phase 2 — GROUND: cite the factory's own data *(the "cited answer" half)*
**Goal:** MIRA cites the Pilot DB (work orders/lots/state) + a Cappy Hour manual in a fault answer.
- **JSON->`knowledge_entries` loader** for the Pilot DB: join Item->Lot->WO->Asset + State via the
  documented FKs; emit human-readable citable chunks (one per WO/asset: item, lot, asset, target qty,
  applicable state codes 101/201/202); chunk `Technical-Documentation.md` as a manual; embed
  (nomic-embed) + `insert_knowledge_entries_batch`; `is_private=true`, UNS-tagged, `proveit` tenant
  (honor `knowledge-entries-tenant-scoping.md` + `uns-compliance.md`). *(M-L)*
- **Local-PDF -> `knowledge_entries` citable path:** a `--file --tenant` entry point (ingest_manuals.py
  minus the URL queue: Docling chunk -> embed -> `knowledge_entries`). Supply a real Cappy Hour /
  Krones-style manual PDF (none in the repo). Do **NOT** use the GUI/`/ingest/document-kb` path (OW KB,
  non-citable). *(M)*
- **Verify:** a fault-style question for the `proveit` tenant returns ProveIt chunks via `recall_knowledge`
  and the reply carries a `[Source:]` tag (H4 enforced); add a golden case. **Closes prereq #2 (real
  grounding).** **Deps:** P0. *(parallel with P1, P3.)*

## Phase 3 — CONNECT: live read-only MQTT *(the on-stage hookup)*
**Goal:** MIRA subscribes read-only to the Flexware EMQX feed, lands live values, and the engine diagnoses
on them — the exact ProveIt connection.
- **New read-only MQTT subscriber** (revive `mira-connect` or `mira-relay/mqtt_ingest/`; do NOT extend the
  bench-locked `mira-bridge` or HTTP-only `mira-relay` core). Env-config broker/topics; `paho-mqtt`,
  **subscribe-only, never publish.** *(S)*
- **Topic->UNS normalizer** (`enterprise/site/area/line/cell/asset/metric` slash -> dot ltree via
  `uns.slug()`; handle flat `machine/asset/metric` + `enterprise/systems/*`). *(M)*
- **Live-value landing** (reuse `persist_batch` -> `live_signal_cache` + `tag_events`); **seed the
  fail-closed allowlist** (`approved_tags_flexware.sql`, staging first). *(M + S)*
- **Direct-connection engine bridge** (mirror `ignition_chat.py`: `source="direct_connection"`, reject
  turns missing a UNS identifier; `engine.process(..., live_tags=...)`); **resolver "trusted-path" entry**
  so a topic-derived UNS path is honored verbatim. *(M + S)*
- **Safety/audit:** assert no `publish()`; run `mira-run-hallucination-audit`; smoke-test vs the running
  Flexware sim. **Closes prereqs #4 (foreign UNS), #9 fence.** **Deps:** P0. *(parallel with P1, P2.)*

## Phase 4 — VISUALIZE: render the namespace live + values *(the "watch it" surface)*
**Goal:** the imported Cappy Hour namespace shows in the Hub with **live values**, not just freshness dots.
- **Live-value panel** in `command-center/page.tsx` right pane (currently a handoff link) reading
  `live_signal_cache` values + sparkline; ISA-101 muted-normal / color-for-abnormal. *(M)*
- **SimEngine -> `live_signal_cache` bridge** (so the SimLab rehearsal line also shows "live"). *(M)*
- **Groundedness 1-5 badge** in `WhyMiraThinksThis` (the engine self-critique score is computed + stored,
  never rendered). *(S)*
- **Gate:** `/command-center` shows the Cappy Hour tree with live values going red on a fault; an answer's
  Why-panel shows a "Groundedness 4/5" badge. **Closes prereqs #5, #6.** **Deps:** P1 (namespace) + P3 (values).

## Phase 5 — PROVE: real agent, self-scored, on stage *(the headline)*
**Goal:** the polished SimLab dashboard scores the **real Supervisor** (not the deterministic stand-ins),
and the full stage flow runs.
- **Wire the real-Supervisor answerer into the SimLab dashboard** — register a third `_ANSWERERS` entry in
  `simlab/api.py` calling the real engine (reuse `tests/simlab/supervisor_answerer.py` /
  `tests/simlab/runner.py`); dashboard gains a **"MIRA (live)"** toggle. *Highest-value reuse: an existing
  polished 5-dimension UI becomes proof of the real agent.* (staging-gated; offline keeps oracle/evidence). *(M)*
- **Stage replay flow:** one "demo" sequence — namespace renders -> live dots go red (replay a fault) ->
  Ask MIRA -> cited answer + Why-panel + groundedness -> dashboard composite score. *(S)*
- **Gate:** "MIRA (live)" scores a real diagnosis on the Cappy Hour / SimLab line against known truth, on
  the dashboard, end-to-end. **Closes prereqs #8, #12.** **Deps:** P2 + the dashboard (main).

## Phase 6 — REHEARSE: end-to-end on the ProveIt corpus *(prove it)*
**Goal:** run the full 20-minute arc against the real ProveIt factory data, repeatedly, to February.
- Static: import `Enterprise B/tags.json` -> contextualize -> ground in pilot WOs + manual -> cited
  diagnosis (P1+P2+P4+P5). Live: point the subscriber at the running Flexware sim (P3) -> live diagnosis.
- Capture the **recorded fallback**; rehearse cold; measure time/cost (the 4 ProveIt questions).
- **If sponsoring 2027:** swap in the official spec when it drops (~mid-Oct 2026), dry-run ~mid-Jan.
- **Gate:** the full arc runs unattended on foreign data. **Closes prereq #10.** **Deps:** P1-P5.

---

## Sequencing & execution
- **P0 first.** Then **P1, P2, P3 in parallel** (parser / grounding / MQTT — independent dirs).
- **P4** needs P1+P3; **P5** needs P2 + the dashboard; **P6** ties all.
- **Per phase:** a builder sub-agent (worktree-isolated where they mutate code in parallel) + an
  adversarial reviewer against the phase's safety/rules list, then a human verification gate, then commit.
  Same model as the SimLab oracle build.
- **Two load-bearing pieces** (do them well): the **IR ISA-95 hierarchy extension** (P1a) and the **bulk
  Hub ingestion job** (P1b). Everything in P4/P5 hangs off the namespace existing.

## Runbook prereq coverage
P1 -> #3,#7 · P2 -> #1,#2 · P3 -> #4,#9 · P4 -> #5,#6 · P5 -> #8,#12 · P6 -> #10 · (#11 isolation = existing).
When P1-P6 are green, the ProveIt demo arc is real and the beta gate is closed on *foreign* data.

## Open inputs needed from Mike
- A real **Cappy Hour / beverage-bottling equipment manual PDF** (none in the corpus) for P2.
- **Sponsor ProveIt 2027?** (Bronze ~$7.5k) — gets the official factory spec ~16 wks out for P6.
- Confirm the **`proveit` tenant** + a staging EMQX/Flexware deployment for P3 live tests.
