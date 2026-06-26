# Hot Cache — 2026-06-23 — SimLab→UNS ingest: HTTP relay path turnkey (L1+L2)

Branch `feat/simlab-relay-ingest-emit` off `fix/heartbeat-docling-to-tika` (carries the proveit/cappy
commits). Built the two **no-infra** bricks the ingest roadmap named — **Gaps A/B/C now CLOSED**, the
HTTP relay path (SimLab → `live_signal_cache`, UNS-mapped) is turnkey.
- `fc5790f7` **L1 — emit wiring.** `RelayIngestPublisher` now carries a required `tenant_id` + two auth
  modes matching `mira-relay/auth.py`: **HMAC** (signs the four `X-MIRA-*` headers over the exact body
  bytes via httpx `content=`; relay treats `X-MIRA-Tenant` as authoritative) and **bench bearer**
  (tenant in body, needs `RELAY_LEGACY_BEARER=1`). `build_app` attaches it env-gated on
  `SIMLAB_RELAY_URL` (defaults tenant to reserved `SIMLAB_TENANT_ID`; `SIMLAB_RELAY_{HMAC_KEY,API_KEY,
  TENANT_ID}`). Additive; best-effort. 16 tests incl. a **real round-trip against `auth.py:verify_hmac`**
  + tamper-detection.
- `03971bbc` **L2 — `simulator` allowlist seed.** `tools/seeds/gen_approved_tags_simulator.py` →
  89-row `approved_tags_simulator.sql` (reserved `SIMLAB_TENANT_ID`, idempotent). Test pins the
  generator's normalizer to the authoritative `mira-relay/tag_ingest.normalize_tag_path` (fail-closed
  match can't drift) + a stale-seed guard.
- Full simlab suite **78 passed, 3 skipped**; ruff clean. No infra touched.
- **To land data now (Mike/infra):** apply `tools/seeds/approved_tags_simulator.sql` (staging first) →
  run `mira-relay` → `SIMLAB_RELAY_URL=$RELAY SIMLAB_RELAY_HMAC_KEY=… python -m simlab` + advance →
  rows appear in `tag_events` + `live_signal_cache`. **Remaining roadmap work:** Lane 3 (MQTT
  subscriber / foreign feed), Lanes 4–5 (Command Center value panel + prod engine bridge).
- Roadmap matrix updated: `docs/plans/2026-06-22-simlab-uns-ingest-roadmap.md`.

---

# Hot Cache — 2026-06-22 — ProveIt buildout (Cappy Hour import + sim-live)

Branch `feat/cappy-hour-import-engine` off main. Goal: contextualize the real ProveIt factory +
make the sim live. **7 commits, 214 tests green** (no infra needed; licensed corpus NEVER committed).
- `36adfd84` **Cappy Hour import engine** — `mira-plc-parser/parsers/ignition_json.py` + additive IR
  `NamespaceNode` → real `Enterprise B/tags.json` becomes 1 ent·1 site·4 areas·15 lines·**43 assets**·
  **4,090 signals** (4,154 nodes); i3x-export = 4,154 instances, single root, 0 dangling.
- `b67d3445` **MqttPublisher hardened** (3 bugs: frozen ts, get_event_loop(), GC'd task).
- `cfe42179` **SimEngine live feed** — `advance()` streams a snapshot; opt-in `SIMLAB_MQTT_HOST`.
- `cb97ae2e` **Pilot DB → 6,023 citable chunks** (`tools/proveit/pilot_db_chunks.py`, offline).
- `5e075b89` **batch inserter honors per-row `is_private`** — proveit corpus lands `is_private=true`
  (item 2's code precondition; OEM callers unchanged).
- `afa36872` **manual→chunks + end-to-end dry-run CLI** — `manual_chunks.py` (section chunks + lazy
  Docling PDF hook + Vessel-spec **Asset ID→UNS** roster) + `cli.py report`. Real dry-run: **6,198
  `knowledge_entries` rows** ready (3,000/6,000 WOs grounded to vat paths; 175 manual chunks), all
  `is_private`, unembedded, no DB writes.
- `0763992a` resume/handoff: `docs/RESUME_2026-06-22_proveit-buildout.md`.
**Agent-side Phase 2 DONE. Remaining = pure infra** (provision `proveit` tenant + Hub migrations &
ingestion endpoint, embed+insert the 6,198 rows, Mosquitto/Flexware broker stand-up; real PDF
optional — code path exists) — handed off in the resume doc. Dry-run:
`python tools/proveit/cli.py report "../proveit-factory/uns-docs/Enterprise B" --out /tmp/proveit`.
PR needs `--admin` (phantom Hub E2E check). `python -m simlab` already serves live.
**SimLab→UNS ingest roadmap:** `docs/plans/2026-06-22-simlab-uns-ingest-roadmap.md` — full emit→land→UNS→consume
pipeline (done-vs-needed matrix + 6 parallel-agent work-tree lanes + infra/ops checklist). Thesis: HTTP relay
path is ~90% built (one wire: `RelayIngestPublisher` not attached in `build_app` + no `simulator` allowlist seed);
MQTT path is emit-only (no subscriber = foreign-feed gap). Live values already cited via Hub `/api/mira/ask`.

---

# Hot Cache — 2026-06-21 — HubV3/i3x

**Migration head: 056** (contextualization + intake). Three Round 13 fix branches open:
- `fix/ctx-zipbomb-cap` — A13-1 zip-bomb decompression guard (unzip.ts + import/route.ts 413 pre-check)
- `fix/publish-gate-integration-test` — B12-1 batch-review route integration test
- `fix/ctx-signals-verified-only` — C12-1 ctx_enrichment verified-only (ENGINE CHANGE, needs staging gate)

---

# Hot Cache — 2026-06-12 — PLC laptop

## Session — 2026-06-13 (Trends V2 layer-1 CORRECTED — built on the REAL Prog_init)

**Mike caught a version mismatch mid-walkthrough; verified against the live CCW project.**
The deployed **Conv_Simple_1.8** runs **Prog1 (ladder I/O) + Prog_init (ST comms, V1.8) on
Channel 2** — NOT a monolithic "Prog2" ST on Channel 0. The repo `plc/Prog2.stf` /
`Micro820_v4.1.9_Program.st` are a dead pre-1.8 lineage. My 2026-06-12b "deployed = v5.0.0
Channel 0" claim was **backwards**; live is Channel 2 (serial_sniff 2026-05-26). Fixed the
`feedback_micro820_channel0` memory (was asserting Channel 0).

**Rebuilt layer 1 (commit after `35c0549b`):**
- `plc/Prog_init_ConvSimple_v1.9.st` — extends the REAL V1.8 POU. **Option C** tiered polling
  (researched industry standard — flowfuse/dpstele): one MSG per 500ms tick on shared Ch2, so
  monitor block keeps 2 of 3 read-ticks (~1.5s; faults+freq/current/DC-bus), torque/rpm + power
  interleaved (~6s); **writes unchanged ~1Hz**. Keeps bench-proven **Addr = wire+1** off-by-one.
  Splits 0x2100 → fault(low)/warn(high), captures 0x2102 freq-cmd echo, latches vfd_last_fault
  (operator clear coil 24).
- `plc/MbSrvConf_ConvSimple_v1.9.xml` — surgical superset of the LIVE map (Version 2.0, 13 coils
  + 5 HRs) + 8 new HRs (offsets 117-124 = HR_SPECS) + clear coil. Drops v4-lineage vars that may
  not exist in 1.8. Dry-run verified vs the live project.
- `plc/CCW_VARIABLES_ConvSimple_v1.9_DELTA.md` — real CCW types + the deploy sequence.
- Removed the wrong `Micro820_v5.1.0_Program.st` / `MbSrvConf_v5.1.xml` / v5.1.0 delta.
- Layers 2+3 unchanged (48 pytest / 41 node green; offsets line up). Historian left RUNNING.
- **Next:** Mike runs the delta-doc deploy sequence on Conv_Simple_1.8 (declare 17 vars → paste
  Prog_init V1.9 → build/download/Run), then live acceptance (freq-scale check).

## Session — 2026-06-12b (Trends V2 — SUPERSEDED by the 2026-06-13 correction above)

**Shipped (commits `215f0f2a` + `9cda0169`, branch `docs/plc-1668-feed-resume`):**
- **Layer 2 (historian):** `live_logger.py` HR_SPECS 117–124 (`vfd_status_word`/`error_code`/
  `warn_code`/`freq_cmd`÷100/`torque_pct`÷10/`motor_rpm`/`power_kw`÷1000/`last_fault`);
  `trend_accumulator.py` units + `torque_hi_pct` 150% threshold + rpm-lags-cmd slip note.
  48/48 pytest. Tags silently absent until reflash. ⚠ plan said power ÷100 — manual says
  X.XXX kW (÷1000); manual won.
- **Layer 3 (viewer):** `mira-trend-viewer/js/adapters/gs10.js` — REAL GS10 tables transcribed
  from `conveyor-evidence/manuals/GS10_UM.pdf` (faults p5-4, warning IDs ch6 — warn ids ≠ fault
  ids! CE10 warn=5 fault=58; SM2 bits p4-196). New WORD `fields` decode for the 2-bit packed
  enums (op_status, direction) → ENUM child lanes; single-bit decode would lie. 41/41 node tests.
- **Layer 1 PREP (flash-ready, Mike's CCW step remains):** `plc/Micro820_v5.1.0_Program.st` —
  based on DEPLOYED v5.0.0 `Prog2.stf` (Channel 0!), NOT the stale v4.1.9 .st (Channel 2 +
  bogus SM2 bit-13-fault comment). Step-1 read widened to 0x2100×7; SM1 byte-split feeds
  vfd_fault_code (red light finally live) + vfd_warn_code; last-fault latch w/ operator clear
  coil C24; steps 5/6 read torque/rpm (0x210B×2) + power (0x210F×1). `plc/MbSrvConf_v5.1.xml`
  24 coils + 25 HRs (vfd_* = Word per deployed CCW truth); `deploy_modbus_map.py` dry-run
  verified vs `CCW/MIRA_PLC/Conv_Simple_1.8`. Sequence: `plc/CCW_VARIABLES_v5.1.0_DELTA.md`.
- **Next:** Mike runs the delta-doc deploy sequence (stop historian → deploy map → declare vars
  → paste v5.1.0 → flash). Then live acceptance per the plan doc (freq-cmd-vs-actual scale
  check step 6!) + screenshots. Same flash wakes dormant A2/A12.

## Session — 2026-06-12 (trend-viewer v2 — last-fault + status-bit decode + Perspective embed)

**Shipped (commit `a55bf2f3`, branch `docs/plc-1668-feed-resume`, 33/33 node tests):**
- `mira-trend-viewer/` v2: per-VFD `last_fault` ENUM register (persists trip cause after
  `fault_code` resets — the intermittent-trip workhorse); status-word **bit decode** — a WORD
  tag declaring `bits:{0:"Running",5:"Faulted",…}` expands ONCE in the store (like scaling)
  into named boolean child tags, each an indented checkbox row + digital step lane, parent
  updates fan out with honest null/quality.
- **Perspective wiring:** `trend_historian.py` now mounts the viewer at `/viewer` (same origin
  as `/trends/summary` → no CORS, no extra server); `app.js` auto-targets the serving origin;
  `Trends/TrendPanel` embeds `/viewer/index.html?source=historian` alongside Ask MIRA (route
  `/trends` + NavBar TRENDS unchanged). Deploy to gateway: `ignition\deploy_ignition.ps1`.
- Verified: live browser check (Fault Code "No fault" + Last Fault "ocA"; 0x0007 →
  Running/At Speed/Ready ON) + smoke of `/viewer` mount on scratch port 8799; promo screenshots
  in `docs/promo-screenshots/2026-06-12_trend-viewer-v2-*`.
- **LIVE DEPLOY (same day, tagged `trends-v1` / MIRA_PLC `trends-hmi-v1`):** the real gateway
  project is **ConvSimpleLive** (NOT monorepo `ignition/project/` ConveyorMIRA — never loads on
  8.3.4; `ia.display.webBrowser` isn't a Perspective component, `ia.display.iframe` is).
  Shipped + browser-verified: `/trends` page + **≋ TRENDS toggle buttons** (Ask-MIRA popup
  pattern) on Conveyor + home; DC bus 321.6 V GOOD drawing live in the popup. Source:
  `CCW/MIRA_PLC/ignition/ConvSimpleLive` @ `a3f79b0`; deploy = `gsudo APPLY_TRENDS.cmd`.
- **Next: Trends V2 — full GS10 monitoring.** Plan: `docs/plans/2026-06-12-trends-v2-full-vfd-monitoring.md`;
  resume prompt: `plc/RESUME_TRENDS_V2.md`. Blocked on the slave-map reflash for layer 1;
  layers 2–3 (historian HR_SPECS/UNITS + viewer GS10 bits/fault tables) buildable now.

## ⭐ MASTER GTM CHECKLIST — `docs/gtm/go-to-market-hardening-checklist.md`

**The single doc the whole operation runs against** (created 2026-06-11, audited vs `origin/main`
@`7d3483cf`). Tracks every surface (website, quickstart, Hub, Slack, Telegram, engine, SimLab,
infra, revenue) with Status/Owner/Priority/Evidence. **3 P0 blockers to first dollar — all HUMAN:**
(1) Stripe in TEST mode (#1831 — flip Doppler `STRIPE_SECRET_KEY`→`sk_live_`); (2) DigitalOcean
billing; (3) NeonDB billing. Once those clear, a stranger can buy + get a grounded answer. P1 tail:
Gemini key 403 (#1830, tail-only), Google SSO redirect (#1756), bot liveness probes. Pairs with
`wiki/orchestrator/BETA_READINESS.md` (A–F lens scorecard).

## Session — 2026-06-08 (Path-to-Beta: upload→retrieval gate — #1592 reality check)

**Drift corrected:** PR #1592 (`feat(hub): folder = brain`) is **MERGED** to main
(`6758e7e6`, Slices 1–4 + e2e proof) — earlier hot.md/path-to-beta notes calling it
"DRAFT" are stale. It wired the upload→retrieval **write + plumbing** **on the Hub NodeChat
surface** (but the retrieval *query semantics* had a bug — found + fixed this session, below):

- `/api/namespace/node/[id]/files` POST → `ingestPdfToNode` (`mira-hub/src/lib/node-knowledge-ingest.ts`)
  chunks an attached PDF into `knowledge_entries` (`ingest_route='v2'`, generated `content_tsv`
  = BM25-citable immediately, page anchors, `metadata.node_id`). Pure in-Hub (unpdf + Neon) —
  does NOT depend on mira-ingest, so the "staging ingest disabled" constraint doesn't apply here.
- `retrieveNodeChunks` (`mira-hub/src/lib/manual-rag.ts`) reads exactly those rows, subtree-scoped
  via `uns_path <@ ltree`, keyed on `metadata->>'node_id'` (RLS-safe; `hub_uploads` has no RLS).
- `/api/namespace/node/[id]/chat` wires retrieve → `appendManualContext` → Groq→Cerebras→Gemini
  cascade, streaming SSE with `[n]` citations + `sources` chips. Write↔read↔chat↔UI all aligned.
- Full stranger flow EXISTS in UI: empty tenant → `EmptyState` "New Folder" → attach manual
  (`/namespace` page.tsx:251) → ask via `NodeChat`.

**🔴 Retrieval-semantics bug — found via execution proof, FIXED this session.** Inspection said
write↔read aligned; running the literal INSERT+SELECT against the real schema (ephemeral pg,
migrations 001/003/006/045 + kg_entities) showed the gate's OWN question returns **0 rows**:
`retrieveNodeChunks` used `plainto_tsquery`, which **AND-combines every term**, so a natural
question ("what does oC **mean**?") injects an off-vocabulary word no manual chunk contains →
empty retrieval → no citation. Proven: `plainto`(AND)=false, `websearch`=false (also ANDs),
OR-joined `to_tsquery`=true. **Fix:** `manual-rag.ts::retrieveNodeChunks` now runs the precise AND
query first, then falls back to an OR query (`' & '→' | '` rewrite of the sanitized plainto output)
only when AND returns nothing — precision kept, recall restored. Proven at SQL level + 4 vitest
tests (`mira-hub/src/lib/__tests__/manual-rag.test.ts`). **Sibling sweep (reuse-before-build):**
the **bot/engine path was already fixed** — `neon_recall.py::_recall_bm25` is OR-fanout
(`to_tsquery('t1 | t2 | …')`, bounded; PR #1382) and `rag_worker.py` just calls `recall_knowledge`,
so Telegram/scan/pipeline have **no** plainto AND bug (eval regime NOT needed). **`retrieveManualChunks`**
(Hub asset-chat + quickstart-ask, natural questions) DID have it → **fixed this PR** (same AND→OR
fallback). 15/15 vitest now. Out of scope, noted on #1808: `asset-intelligence.ts` (enrichment
*fallback*, keyword query — AND defensible) + `mira-scan-monday/vendor_rag.py` (legacy, not in compose).

**Gate still RED (do not declare beta-ready):** the gate is "an *unseen* manual on a *self-served*
node, zero Mike seeding" — a pre-seeded pass doesn't count. Remaining blockers to a green run:
1. **Harness contract (FIXED):** `tests/beta/_gate.py::_ask` posted JSON `{question}` but NodeChat
   needs a `messages` array + returns **SSE**. Added messages-body + SSE accumulation (back-compat
   with JSON surfaces) + `tests/beta/test_gate_harness.py` (7 unit tests, no env). Did NOT remove
   the `xfail(strict)` marker (gate not yet proven met end-to-end).
2. **Provisioning:** needs a dev/staging run with a real tenant + node. Hub auth is a **next-auth
   session cookie**, not the `BETA_GATE_API_KEY` bearer — provisioner must supply working auth.

**Still open (#1806, NOT a beta blocker):** the blind production upload doors
(`/api/uploads`, `folder`, `local`) still write OW-KB-only — only the deliberate node-attach door
reaches v2 `knowledge_entries`. Wire-or-deprecate is a separate change (research doc's
"two divergent ingest writers" warning). Branch `lane/upload-retrieval-gate`.

Refs: `docs/research/2026-06-07-upload-retrieval-gap-and-beta-path.md`, `tests/beta/README.md`.

---

# Hot Cache — 2026-06-04 — CLOUD

## Session — 2026-06-07 (Train-before-deploy audit — 7 lanes)

Verified whether MIRA supports **train before deploy** (Command Center builds+validates the
namespace; Ignition/HMI deploys *approved* asset agents). Branch `feat/train-before-deploy`
(worktree `/tmp/mira-tbd`, off `origin/feat/path-to-beta` so doctrine edits stack on that PR).

**Verdict: PARTIALLY ALIGNED.** The build half exists; the validate→approve→deploy half does not.

- ✅ **Command Center training surfaces all exist**: self-serve tenant create (`/api/auth/register`
  → `ensureUserAndTenant`), wizard (`/api/wizard/[step]` company/site/line), `/namespace`,
  `/assets/[id]` with `AssetChat.tsx` ("Ask MIRA" on an asset), `/proposals` (`ai_suggestions`),
  citation rendering, `/command-center` tree+display.
- ✅ **Retrieval is tenant-scoped** — `neon_recall.recall_knowledge` filters
  `WHERE tenant_id = :tid OR tenant_id = :shared_tid` (the shared OEM pool is the intentional
  Knowledge Cooperative; customer manuals do NOT leak cross-tenant). De-risks design-partner beta.
- ❌ **Gap 1 — upload→retrieval** (THE blocker, PR #1592 DRAFT): uploaded manuals not citable.
- ❌ **Gap 2 — no validation/approval loop, no per-asset agent lifecycle, no HMI deploy gate.**
  `ignition_chat.py` answers any asset-bound HMAC turn regardless of readiness. No "mark good/bad"
  in the Hub. No `asset_agent_status`.

**Shipped this session — CODE (read-path spine, commit `607a3cd6`):**
- `mira-hub/db/migrations/046_asset_agent_status.sql` — `asset_agent_status` + `asset_validation_qa`,
  RLS mirroring mig 027. NOT applied to any DB yet.
- `mira-bots/shared/asset_agent_transition.py` — pure state machine + `gate_decision()` (27 tests ✅).
- `mira-pipeline/ignition_chat.py` — HMI gate behind `ENFORCE_ASSET_AGENT_GATE` (default OFF; non-ready
  → clean refusal, audited, no engine call; DB error fails OPEN). 10 tests ✅; direct-connection 16/16 ✅.
- ⚠️ `_lookup_agent_state` resolver join (asset_id→kg_entities) is plausible but UNTESTED vs real schema
  (gate default-off; tests monkeypatch the lookup). Verify before enabling.
- Next PR: Validate UI (`/assets/[id]`) + approve endpoint + TS twin (write-path, where the helper gets a caller).

**Shipped this session — docs/doctrine:**
- `docs/specs/asset-agent-validation-spec.md` (LANE 4) — per-`kg_entity` lifecycle
  `draft→training→validating→approved→deployed`, two new tables (`asset_agent_status`,
  `asset_validation_qa`), composes `kg_entities.approval_state` + `ai_suggestions` + engine 1–5
  groundedness + `evidence_utilization`; HMI deploy gate `ignition_chat.py` consults behind
  `ENFORCE_ASSET_AGENT_GATE`. **Distinct from** namespace-level L0–L6 `health-score.ts`.
- `.claude/rules/train-before-deploy.md` (LANE 6) — the doctrine + the one new HMI-readiness rule
  (beta-gate + read-only already exist → cross-referenced, not restated).
- Root `CLAUDE.md` North Star + `.claude/CLAUDE.md` "What MIRA is" + rule/cross-ref lists.

**Already done by the path-to-beta session (verified, NOT rebuilt):** beta gate test
`tests/beta/beta_ready_upload_retrieval_citation.py`, Ignition runbook
`docs/runbooks/activate-ignition-ask-mira.md`, beta-gate doctrine in CLAUDE.md/NORTH_STAR.

**LANE 7 naming:** clean — no "generic chatbot/ChatGPT" copy in `mira-hub`/`mira-web` UI (only
test + blog files matched). `.claude/CLAUDE.md` already states "not a generic chatbot."

**Next 3 PRs:** (1) land #1592 (close upload→retrieval); (2) implement asset-agent-validation
spec (migrations + transition helpers + `/assets/[id]` Validate tab); (3) wire `ignition_chat.py`
deploy gate behind `ENFORCE_ASSET_AGENT_GATE` + hallucination-audit check.

---

## Session — 2026-06-07 (Path to Beta Testers — phase opened, 6 lanes)

New official phase: **Path to Beta Testers** (`docs/plans/2026-06-07-path-to-beta.md`).
Branch `feat/path-to-beta` (worktree `.claude/worktrees/path-to-beta`, off origin/main `4b9778c8`).

**🚦 BETA GATE:** stranger uploads their own manual → asks → gets a cited answer, with **no
manual fix**. Enforced by `tests/beta/beta_ready_upload_retrieval_citation.py` (xfail until met).

**Blockers (what stands between us and beta):**
1. **Upload→retrieval gap (THE blocker).** Hub/web uploads write the Open WebUI KB; chat
   retrieval (`neon_recall.recall_knowledge`) reads only `knowledge_entries`. Uploaded manuals
   are not citable. Fix = **PR #1592 `feat/hub-folder-brain` — still DRAFT** (18 files, +2037).
   Trace + minimal-close path: `docs/research/2026-06-07-upload-retrieval-gap-and-beta-path.md`.
2. **Graph stability — RESOLVED.** #1742 (`63c9b8e1`) merged to main (NaN-coord guard on
   GraphCanvas painters). Regression test added this session (`mira-hub/src/components/kg/__tests__/GraphCanvas.test.ts`, 4/4 pass). **Open: confirm it's deployed to prod.**
3. **Ignition Ask MIRA** — see Lane 5 status in HANDOFF; runbook at
   `docs/runbooks/activate-ignition-ask-mira.md`. (HMAC key presence + WebDev deploy = ops.)

**Reuse-before-build finds:** demo seeds already exist (`tools/seeds/` — `factorylm-garage-conveyor.sql`,
`gs10-vfd-knowledge.sql`, `demo-conveyor-001.sql`, `run_demo_seed.py`, commit `68574f1d`). Lane 3
extends, does not rebuild.

**Readiness:** internal demo ✅ (pre-seeded tenant) · design partner ❌ (gap #1) · public beta ❌ (gate red).

---

## Session — 2026-06-06 (AskMira / kiosk fix cycle + runbook)

PR #1620 closed (wrong stack). MIRA_PLC#25 merged (`f67adb43`) — AskMira view textarea race + per-click `session_id` ms suffix. PR #1754 merged (`e5dabe7f`) — engine Q1/Q2/Q5/Q7 + H4 enforcer + `tests/test_askmira_regression.py` (9 tests). PR #1755 merged — H4 stock admission uses scorer-recognized phrase + `--- Sources ---` block normalizer (+2 tests = 11). Two `deploy-vps.yml -f services=mira-ask` dispatches; auto-deploy default `TARGETS` did NOT include `mira-ask` — surfaced + closed in this session.

**Prod after 3rd bake:** 9/10 hard pass. Remaining RED is Q1 length (165w > 145 cap) — content correct, verbosity only. Recommended next: prompt-engineering pass or kiosk-scoped post-process trim. Separate focused PR.

**New runbook:** `docs/runbooks/kiosk-askmira-deploy-and-verify.md`. CLAUDE.md Pointers updated. CHANGELOG entry `ops/kiosk-runbook (2026-06-06)`. `.github/workflows/deploy-vps.yml` line 199 — added `mira-ask` to default TARGETS so future Smoke Test → auto-deploy includes the kiosk path.

**Tester skill** (user-scope) `~/.claude/skills/askmira-tester/` — Mode A direct `/ask` bake + Mode B Playwright MCP view drive + scorer + PDF builder. Triggers on "test AskMira", "rerun the 10 questions", "regression check the conveyor chat".

## Session — 2026-06-04 run 4 (autonomous gap-closure routine — epic #1666)

> **Parallel stream (DT-2026 gate-monitor, 2026-06-04 ~19:35Z):** all 7 gates green
> (#1676/#1657/#1674 merged, migs 032–037 on main, #1677 decisions explicit, head=037).
> Phase 1 resumed → **PR #1710** opened: migrations **038** (relationship_type CHECK +4
> asset-graph edges) + **039** (`kg_entities.source_object_id` FK-by-convention + partial idx).
> Preserved migration 032's 3 inferred types (live=31, +4 new = 35 — doc §5's 28-value list was
> pre-032). No prod touched; CI/`apply-migrations.yml --dry-run` must verify on staging.
> **Next:** migrations **040–042** source-preservation layer (incl. `source_object_versions`
> per Mike's #1677 override). **Follow-up:** MaintainX "store raw → map → remap, zero re-fetch"
> proof. Gate-monitor routine **disabled**. Durable record: comments on #1666 + #1677.

## Session — 2026-06-02→04 (promo-director: HMI walkthrough videos, private YouTube)

**Status: Merge conflict resolved + CI green. PR #1657 now clean and ready for human review.**

- `apply-and-verify` CI: ✅ **GREEN** (conclusion: success, completed 10:13:12Z). The `source_system` column idempotency guard fix (commits `e1951da`/`5c15048` by earlier sessions) landed and passed.
- Merge conflict in PR #1657: resolved in this session. 3 files conflicted (`docs/plans/current-state-gap-closure-plan.md`, `tests/regime7_ignition/test_webdev_handlers.py`, `wiki/hot.md`). Resolutions: full audit plan (branch version), `mira_gateway_configured` fixture (main version), wiki merged both sessions.
- 2-PR cap: still at limit. PR #1657 + PR #1674 both open. No new PRs opened.
- **Next action (human):** Review and merge PR #1657. Once merged, PR #1674 needs base changed to `main` → rebase → CI → merge. After both merged, agent can start #1658 (Phase 6) or #1662 (Phase 3).

---

## Session — 2026-06-04 (autonomous gap-closure routine — epic #1666)

**Preflight:** `origin/main` @ `1b535a7`. 2 open gap-closure PRs: **#1657** (`feat/dt2026-gap-closure`) and **#1674** (`feat/dt2026-rls-verification-1664`, stacked on #1657). 2-PR limit applies — no new PRs until one merges.

**Action taken (merge conflict resolution):**
PR #1657 was `mergeable_state: dirty` with 41 new commits on main since its last merge. Conflicts were trivial: all 4 conflicted files (ci.yml, code-review.yml, deepeval-ci.yml, smoke-test.yml) had only comment-text differences above identical `concurrency:` blocks. Took origin/main's comment text in all 4. docker-compose.saas.yml auto-merged cleanly.

**Pushed:** commit `f92d6d9` on `feat/dt2026-gap-closure`. CI fired. All prior idempotency fixes intact (citations_present, event_timestamp, tag_path in migrations 032/033). No feature content changed.

**Previous fix inventory (still on branch):**
- `a4df7a3`: citations_present guard in 032_decision_traces
- `e0f9206`: tag_path DO-block guard in 033_tag_events  
- `49bf0f1`: event_timestamp DO-block guard in 033_tag_events

**Pending (CI gate — stop condition):** Wait for Staging Gate + Migration Verify to go green on `f92d6d9`. If both green → PR #1657 ready for human review. If any fail → next routine run fixes and pushes.

**Next work when unblocked:** #1658 (Phase 6 direct_connection UNS bypass on Ignition chat path). Requires reading `.claude/rules/direct-connection-uns-certified.md` + running `codegraph_impact` on `_should_fire_uns_gate` before touching engine.py.

---

## Session — 2026-06-04 run 2 (autonomous gap-closure routine — epic #1666)

**CI failure found on PR #1657:** `apply-and-verify` failing — migration 033 `tag_events_real_idx` at line 149 uses `WHERE simulated = false` but the `simulated` column didn't exist in the idempotency `DO $$` block. On staging NeonDB branches where `tag_events` was created by a prior CI run (before `simulated` was added), `CREATE TABLE IF NOT EXISTS` skips recreation → column never added → partial index creation fails.

**Fix pushed:** commit `455e443` on `feat/dt2026-gap-closure`. Added `simulated` column existence guard to the `DO $$` block, matching the pattern of the existing `tag_path` and `event_timestamp` guards.

**E2E smoke failure:** `app.factorylm.com/api/health` returning 502 in CI. This is a production infra issue independent of the PR content. Not fixable from this PR.

**CI now pending** on commit `455e443`. Stop condition per routine.

**Status sync:** `docs/plans/current-state-gap-closure-plan.md` Status header updated to reflect 2026-06-04 fix.

---

# Hot Cache — 2026-06-03 — CLOUD

## Session — 2026-06-03 (autonomous gap-closure driver — epic #1666)

**Preflight status:**
- `origin/main` @ `db0a926`
- 2 open gap-closure PRs: **#1657** (`feat/dt2026-gap-closure`, Phases 0–5) and **#1674** (`feat/dt2026-rls-verification-1664`, stacked on #1657)
- **2 PR limit reached** — no new implementation PRs until one merges.

**Fix 1 (commit `a4df7a3` → pushed earlier):**
- Root cause: `032_decision_traces.sql` `citations_present` column missing on staging; index `WHERE citations_present = false` errored.
- Fix: `ALTER TABLE … ADD COLUMN IF NOT EXISTS citations_present`.

**Fix 2 (commit `e0f9206` → pushed 2026-06-03 this session):**
- Root cause: `033_tag_events.sql` index `tag_events_tag_time_idx` on `(tenant_id, tag_path, event_timestamp DESC)` failed because the staging `tag_events` table was created by a prior run BEFORE `tag_path` was added to the schema. `CREATE TABLE IF NOT EXISTS` skips re-creation; the subsequent index errors with `column "tag_path" does not exist`.
- Fix: extended the idempotency DO block to add `tag_path TEXT NOT NULL DEFAULT 'backfilled'` when missing, then drop the default. Identical pattern to the `event_timestamp` fix.
- No engine/bot/UNS-gate/KG code touched. No prod psql.

**E2E smoke failure (PR #1657):** `E2E smoke (factorylm.com + app.factorylm.com)` also failing — checks production URLs. Prod was healthy (see 2026-06-02 incident fix). This is likely a flaky prod-health check or a check for content that changed since the check was written. NOT caused by this PR's code. Needs separate investigation.

**CI current state on #1657 (as of this session):**
- `Eval Offline` → queued (new run, pending)
- `Docker Build Check` → queued (new run, pending)
- `apply-and-verify` → failure from OLD run (fix 2 above addresses this; new `apply-and-verify` run will fire on migration file change)
- E2E smoke → failure from OLD run (pre-existing prod-health issue)
- All other checks: passing

**Next run:** Wait for `Eval Offline` + `Docker Build Check` + new `apply-and-verify` to complete. If all green → advance to #1658 (Phase 6 direct_connection UNS bypass). If 2 PRs still open + green → stop (human review). E2E smoke needs human decision: make non-blocking or fix prod content check.
---

## Session — 2026-06-04 (autonomous gap-closure driver — epic #1666)

**Routine run result: STATUS SYNC ONLY — CI pending, merge-conflict rebase required before any new work.**

### Open gap-closure PRs (both blocked)

| PR | Branch | Status | Blocker |
|---|---|---|---|
| **#1657** | `feat/dt2026-gap-closure` | open, CI pending | Merge conflict with main — **migration number collision** |
| **#1674** | `feat/dt2026-rls-verification-1664` | open, CI pending, stacked on #1657 | Same — stacked, needs #1657 to resolve first |

### Critical blocker: migration numbering collision

Main landed PR #1688 (`feat/kg-knowledge-graph-stack`) which added Hub migrations **030, 031, 032, 033** (KG graph / proposal types / reasoning traces). The gap-closure branch (#1657) has its own migrations **032–037** (`decision_traces`, `tag_events`, `flaky_input_signals`, `approved_tags`, `current_tag_state`, `tag_event_diffs`). **Numbers 032 and 033 collide.**

Resolution required before #1657 can merge:
1. Rename gap-closure migrations to 034–039 (or whatever `ls mira-hub/db/migrations/ | tail` shows on a fresh `origin/main` checkout).
2. Update all references to these migration numbers in the PR.
3. Resolve `.github/workflows/ci.yml` concurrency conflict (main added concurrency guard in #1692; gap-closure branch added the same guard independently in commit `1c3310a`).
4. Resolve `wiki/hot.md` three-way merge (main has 2026-06-03 CHARLIE session; gap-closure branch has CLOUD session entries).
5. After rebase, push — this will trigger CI fresh.

### Gap-closure issue backlog (in priority order per epic #1666)

| Issue | Phase | Label | Blocker |
|---|---|---|---|
| #1664 | RLS verification | **done** (PR #1674) | blocked on #1657 merge |
| #1665 | Deploy migrations to staging→prod | ready-for-human | human action needed |
| **#1658** | Phase 6: direct_connection UNS bypass | ready-for-agent | blocked until #1657 merges |
| **#1659** | Phase 7: citation enforcement + session lifecycle | ready-for-agent | depends on #1658 |
| **#1662** | Phase 3: kg_writer proposal-transition helper | ready-for-agent | unblocked (no Phase 6 dep) |
| **#1663** | /proposals must render ai_suggestions | ready-for-agent | depends on #1662 |
| #1660 | Phase 8: DecisionTraceWriter + /decision-traces | ready-for-agent | blocked on #1657 merge |
| #1661 | Phase 9: flaky-input detector | ready-for-agent | blocked on #1657 merge |

### Next agent action

Once the rebase is done and #1657 CI goes green:
- If 2 PRs still open → stop (human review/merge needed).
- Once 1 merges → pick **#1658** (Phase 6) or **#1662** (Phase 3 — unblocked now).

### What was NOT done this run

- No new implementation PRs (CI gate: both `feat/dt2026*` PRs are `state:pending`; 2-PR cap reached).
- No engine/bot/UNS-gate/KG code touched.
- No production systems touched.


# Hot Cache — 2026-05-29 — ALPHA

## Session — 2026-06-03 (CHARLIE) — prod pipeline outage + CI prevention

- **Prod chat outage (2026-06-02), resolved.** Merging #1593 (Command Center + Ignition-Module umbrella) crash-looped `mira-pipeline-saas` on `ModuleNotFoundError` (the Ignition cutover added `ignition_chat.py`/`ignition_audit.py` but `mira-pipeline/Dockerfile` used per-file `COPY` and didn't list them). Fixed: `COPY mira-pipeline/*.py .` (#1667 → #1670). Prod healthy: `app.factorylm.com` 200, `/api/health` 200, pipeline Up/healthy. Full writeup: `docs/incidents/2026-06-02-prod-pipeline-deploy.md`.
- **Deploy hotfix-bypass was itself broken** — its audit `gh issue create` failed (token lacks `issues:write`) and aborted every hotfix deploy. Fixed by making issue-creation **non-fatal** (#1673) — **not** by broadening token permissions.
- **CI prevention (this work):** `docker-build-check` in `ci.yml` now **builds `mira-pipeline` + runs an `import main` smoke-test** (a successful build alone does NOT catch a missing imported module — it crashes at startup). Verified locally: passes on fixed main, fails (`ModuleNotFoundError`) on the pre-incident Dockerfile.

## Session — 2026-06-02 (Walker DT gap closure — Phases 5–9, CHARLIE)

Branch `feat/dt2026-gap-closure` (worktree `/Users/charlienode/MIRA-gapclose`). Built the engine/intelligence layer on top of the Phase 0–4 storage+ingest foundation. **6 commits, 52 new tests, all green; engine changes non-regressive (18 golden + 57 eval dry-run).** Full handoff: `HANDOFF_2026-06-02_P5-9.md`.

- **P5 TagDiffLogger** (`mira-relay/tag_diff_logger.py` + mig `037_tag_event_diffs.sql`) — raw `tag_events` → meaningful changes (edges / threshold crossings / quality / fault windows). Store-injection pattern.
- **P6 UNS reconciliation** (`mira-crawler/ingest/uns_topic_map.py` + `config/bench_uns_map.json`) — flat bench/MQTT topics → ISA-95 paths via `uns.py` builders only (tests assert resolver==builder). Plus ignition_chat stamps `source="direct_connection"` and `_should_fire_uns_gate` now honors it (no "which machine?" on certified connections).
- **P7+P8 FlakyInputDetector** (`mira-relay/flaky_detector.py` + `config/flaky_rules.json`) — real `tag_events` transition counting w/ peer isolation → `flaky_input_signals` (real `evidence_event_ids`) → `relationship_proposals`+evidence+`ai_suggestions` (status `proposed`, NEVER verified, ADR-0017).
- **P9 DecisionTraceWriter** (`mira-bots/shared/decision_trace.py`) — `decision_traces` row per turn, fire-and-forget after reply (mirrors `conversation_logger.py`), captures uns_context/manual+tag evidence/citations; never blocks the reply.

**Watch:** mig 037 + the 3 Neon store SQL paths only ran vs in-memory doubles — verify via `migration-verify.yml` on push. Runtime triggers (cron/worker calling the loggers on the live window) are documented follow-ups, not wired. Bot tests run from REPO ROOT with the 3.12 `.venv` (`mira-bots/email/` shadows stdlib `email`).

## Session — 2026-06-03 (gap-closure driver) — 2-PR limit stop + merge conflict resolution

- **2 open gap-closure PRs (#1657, #1674) → at the 2-PR limit.** No new implementation PRs opened.
- **PR #1657 had `mergeable_state=dirty`** (3-file conflict with main). Resolved: `docker-compose.saas.yml` and `mira-bots/shared/engine.py` auto-merged; `wiki/hot.md` conflict resolved by combining both prepended session entries (CHARLIE 2026-06-03 first, Walker DT 2026-06-02 second). Pushed merge commit to `feat/dt2026-gap-closure`.
- **Status sync** `docs/plans/current-state-gap-closure-plan.md` updated to reflect main HEAD `596591d`, PR status, and next ready-for-agent issues.
- **Next work (after ≥1 PR merges):** #1662 (kg_writer proposal helper, independent) → #1658 (direct_connection bypass) → #1659 (citation enforcement).

## Session — 2026-05-29 (printing-press toolchain bootstrap + Linear/Stripe CLIs)

Work spanned 2026-05-10 → 2026-05-29; landing now as one continuity entry. Local `main` was 447 commits behind origin when commit happened — reset to origin/main, re-applied this block on top of current hot.md.

- **Installed `mksglu/context-mode` Claude Code plugin** (user scope). Registers `PreToolUse`/`PostToolUse`/`PreCompact`/`SessionStart` hooks + 11 `ctx_*` MCP tools. Intercepts large-output `WebFetch`/`Bash` calls and routes through a sandbox + FTS5 KB. v1.0.111 on disk; v1.0.118+ available.
- **Installed Go 1.26.3** via `brew install go`; added `export PATH="$HOME/go/bin:$PATH"` to `~/.zprofile`.
- **Installed `mvanhorn/cli-printing-press` v4.2.2** generator at `~/go/bin/printing-press`. 9 skills under `~/.claude/skills/printing-press*`. Drives `/printing-press <api>` slash command. MIT.
- **Installed `linear-pp-cli` 1.0.0** via `npx -y @mvanhorn/printing-press install linear`. Local SQLite at `~/.local/share/linear-pp-cli/data.db` — hydrated (290 items in 3.16s: 1 team `CRA` / 2 users / 11 workflow states / 6 labels / 13 projects / 0 cycles / 257 issues). `doctor` green; `me` = `mike @ Cranesync (Admin)`.
- **Installed `stripe-pp-cli` 1.0.0** same orchestrator. Local SQLite at `~/.local/share/stripe-pp-cli/data.db` — NOT hydrated yet (recommend `sync --dry-run` first; event volume could be large). `doctor` 5/5 green via Doppler-injected `STRIPE_SECRET_KEY`; live `balance` call confirmed `meta.source: "live"`.
- **Canonical invocation pattern**: `doppler run --project factorylm --config prd -- <api>-pp-cli <cmd>`. Both CLIs honor `auth_source: env:<KEY>` ahead of file auth — no plaintext on disk.
- **`~/.claude/CLAUDE.md` updated**: dropped the stale "`gh` CLI auth broken" line. Verified `gh 2.87.2` logged in as `Mikecranesync` via keyring (scopes: `gist`, `read:org`, `repo`, `workflow`); auth-required API calls succeed.

**Findings worth flagging:**

- **Linear workspace is at its free-tier issue cap.** Tried to file the session-handoff issue via `linear-pp-cli issues create` and the Anthropic-hosted Linear MCP — both refused: *"Usage limit exceeded — please upgrade or contact sales@linear.app"*. Workspace has 257 issues. Future sessions: don't try to create new Linear issues; comment on existing ones instead.
- **Two `linear-pp-cli` bugs for `/printing-press-retro` filing**: (1) `teams list` always calls GraphQL via GET → Linear rejects as CSRF; `--data-source local` short-circuits before fallback. Workaround: `sqlite3 ~/.local/share/linear-pp-cli/data.db`. (2) `issues create` response parser dies with `decoding graphql response: json: cannot unmarshal string into Go struct field .errors.extensions.userPresentableMessage of type bool` when Linear returns the usage-cap error — the CLI masks the real reason for failure.

**Pointers for continuity:**

- Plan file with full candidate analysis + tier rankings: `~/.claude/plans/polymorphic-hugging-parnas.md`
- Auto-memory: `~/.claude/projects/-Users-factorylm-mira/memory/project_printing_press_toolchain.md`

**Suggested next actions:**

- [ ] Bundle install Tier 1 backlog: `npx -y @mvanhorn/printing-press install openrouter digitalocean` (~90s, both have keys in Doppler).
- [ ] Hydrate Stripe local mirror: `doppler run … -- stripe-pp-cli sync --dry-run` (check scope first).
- [ ] Pick a Tier 3 fresh-print candidate: NeonDB (cleanest OpenAPI), Groq, Telegram Bot API, Atlassian — 30–60 min generation each.
- [ ] Upgrade Linear plan or archive stale issues to unblock future issue creation.
- [ ] File `/printing-press-retro` for the two `linear-pp-cli` bugs above.

---

# Hot Cache — 2026-05-28 — CHARLIE

## eval-fixer run — 2026-05-28
- Scorecard: **35/57 passing (61%)** — `tests/eval/runs/2026-05-28T0300-offline-text.md` (FRESH, nightly eval job is producing scorecards again)
- Action: filed #1576. 22 patchable failures across 3 file clusters — exceeds both single-patch hard limits (>15 failures, >1 file). No autopatch.
- **Major regression: 48/57 → 35/57 (-13 fixtures) since the last fresh scorecard on 2026-05-06.** Three clusters:
  - **A) UNS confirmation gate over-blocking (8 fixtures)** — fixtures stuck at `AWAITING_UNS_CONFIRMATION` when expected to progress to Q1/Q2/DIAGNOSIS. Likely caused by recent UNS-gate work (Namespace Builder Phase 1/2 — PRs #1330/#1332 and follow-ups).
  - **B) VFD documentation-request fixtures landing in diagnostic FSM (7 fixtures)** — `find_manual` / `find_datasheet` intent not routing to IDLE.
  - **C) Question-skip logic too conservative (5 fixtures)** — vendor+model+fault present but engine still asking Q1.
- See #1576 for full triage and suggested remediation order (A → B → C → smaller clusters).

## eval-fixer run — 2026-05-23
- Scorecard: 48/57 passing (84%) — `tests/eval/runs/2026-05-06T0833-offline-text.md` (17 days stale, unchanged since 2026-05-06)
- Action: filed #1506, closed as dup of still-open #1419. Same multi-cluster hard-stop (engine.py×7, guardrails.py×3, prompts/diagnose/active.yaml×3).
- **4th consecutive run dup-closing.** Nightly eval job has not produced a fresh scorecard in 17 days. Wiring problem, not a code problem. Action: either land a fix on one of the three #1419 clusters or restart the eval cron / regenerate manually (`doppler run --project factorylm --config prd -- python3 tests/eval/offline_run.py --suite text`).

## eval-fixer run — 2026-05-22
- Scorecard: 48/57 passing (84%) — `tests/eval/runs/2026-05-06T0833-offline-text.md` (16 days stale, unchanged since 2026-05-06)
- Action: filed #1487, closed as dup of still-open #1419. Same multi-cluster hard-stop (engine.py×7, guardrails.py×3, prompts/diagnose/active.yaml×3).
- **Nightly eval job stalled 16 days running.** Same failure set surfacing on every run. Either land a fix on one of the three #1419 clusters or regenerate the scorecard manually (`doppler run -- python3 tests/eval/offline_run.py --suite text`) — until then every eval-fixer run will keep dup-closing.


## 2026-05-19 — GS11 grounding test surface landed
Three-layer regression net for "embedding sidecar down → bot must still cite KB, not 'general industrial knowledge'." Installed after the 2026-05-18 GS11 demo failure (PR #1382 + #1379 + #1385 root cause chain).

- **Tests (offline, ~2s):**
  - DB: `mira-bots/tests/test_recall_no_embedding_fallthrough.py`
  - Gate: `tests/test_quality_gate_stream_aware.py`
  - Engine: `mira-bots/tests/test_engine_no_embedding_gs11.py` (new)
- **LLM judge (Groq):** `mira-bots/benchmarks/deepeval_suite.py` case `de-in-06-gs11-modbus`
- **One-shot invocation:** `/mira-test-bot-grounding`
- **Reference doc:** `wiki/references/bot-grounding-tests.md`
- **Auto-loading skill:** `.claude/skills/bot-grounding-tests/SKILL.md`
- **CI:** `.github/workflows/deepeval-ci.yml` runs all four layers on every PR touching `mira-bots/**`, `evals/**`, or `tests/golden_*.csv`.

**Mandatory before pushing** any change to `mira-bots/shared/{neon_recall.py, workers/rag_worker.py, engine.py}` recall path, `mira-bots/benchmarks/deepeval_suite.py`, or `tests/golden_gs11_conveyor.csv`.

Open ops follow-ups (deferred post-demo): fix Bravo Tailscale route from VPS; pull `nomic-embed-text` onto VPS localhost Ollama; migrate `evals/query_stub.py` live mode off Anthropic + onto the InferenceRouter Groq cascade.

## eval-fixer run — 2026-05-20
- Scorecard: 48/57 passing (84%) — `tests/eval/runs/2026-05-06T0833-offline-text.md` (14 days stale, unchanged since 2026-05-06)
- Action: filed #1453, closed as dup of still-open #1419. Same multi-cluster hard-stop (engine.py×7, guardrails.py×3, prompts/diagnose/active.yaml×3).
- **Nightly eval job stalled 14 days running.** No new signal. Action needed: either land a fix on one of the three #1419 clusters or regenerate the scorecard manually (`doppler run -- python3 tests/eval/offline_run.py --suite text`). Until then every eval-fixer run will continue to dup-close.

## eval-fixer run — 2026-05-19
- Scorecard: 48/57 passing (84%) — `tests/eval/runs/2026-05-06T0833-offline-text.md` (13 days stale, unchanged since 2026-05-06)
- Action: filed #1419 (multi-cluster hard-stop hit: engine.py×7, guardrails.py×3, prompts/diagnose/active.yaml×3). Prior canonical #1217 is now closed, so #1419 stands open instead of being closed as a dupe.
- **Nightly eval job still stalled — same scorecard for 13 days.** No new signal. Action needed: regenerate scorecard (`doppler run -- python3 tests/eval/offline_run.py --suite text`) or land a fix on one of the open clusters before the next eval-fixer run can produce new signal.

## eval-fixer run — 2026-05-18
- Scorecard: 48/57 passing (84%) — `tests/eval/runs/2026-05-06T0833-offline-text.md` (12 days stale, unchanged since 2026-05-06)
- Action: filed #1373 (multi-cluster hard-stop hit), then closed as duplicate of #1217. Prior dupes: #1144, #1170, #1187, #1217, #1329.
- **Nightly eval job still stalled** — same scorecard, same 9 fixtures, same 3 file_clusters (engine.py×7, guardrails.py×3, prompts×3). No new signal. Action needed: regenerate scorecard (`doppler run -- python3 tests/eval/offline_run.py --suite text`) or land a fix on one of the open issues before the next eval-fixer run will produce signal.

## eval-fixer run — 2026-05-16
- Scorecard: 48/57 passing (84%) — `tests/eval/runs/2026-05-06T0833-offline-text.md` (10 days stale, unchanged since 2026-05-10)
- Action: filed #1329, then closed it as duplicate of #1217. Prior dupes: #1144, #1170, #1187, #1217, #1329.
- **Nightly eval job is still stalled** — no new scorecard since 2026-05-06. Next eval-fixer run on this scorecard should suppress before opening an issue; today's CLI agent missed the wiki note. Action needed: regenerate the scorecard (run `doppler run -- python3 tests/eval/offline_run.py --suite text`) or land a fix on one of the open clusters in #1217.

## Session — 2026-05-15 (Maintenance Namespace Builder doctrine + spec + plan landed)

- **NEW PRIMARY DOCTRINE — read first for any feature work:**
  - `docs/THEORY_OF_OPERATIONS.md` — what MIRA is, how it works, why. Establishes "MIRA turns everyday maintenance activity into an AI-ready factory namespace" as the primary product framing. Promoted above `mira-component-intelligence-architecture.md` (which is now positioned as implementation-level architecture).
  - `docs/specs/maintenance-namespace-builder-spec.md` — technical contract for the product surface (UNS Location-Confirmation Gate, `ai_suggestions` + `approvals` queue, L0–L6 AI Readiness score, namespace tree editor, onboarding wizard, photo + tag ingestion API).
  - `docs/plans/2026-05-15-maintenance-namespace-builder.md` — phased execution plan (Phase 0 docs done; Phases 1–6 across ≈14 weeks). Integrates with the 90-day MVP plan rather than replacing it.
- **CLAUDE.md pointers updated** (root + `.claude/CLAUDE.md`) — North Star points to TOO doc as primary; the broken `uns-message-resolver-spec.md` reference is replaced by a pointer to the namespace-builder spec's UNS gate section.
- **CORRECTION** (after `git fetch origin main` mid-session): the local main was 19+ commits behind. The UNS resolver + Stage-1 confirmation gate are **already merged** (PRs #1220, #1280, #1295, #1314). `mira-bots/shared/uns_resolver.py` + `uns_paths.py` exist on origin/main; `engine.py` calls `resolve_uns_path()` in 14+ places; the gate is at engine.py line 1316. The existing scope is **vendor / model / fault-code**; Phase 1 extends it to full **site / area / line / machine / asset / component** plant hierarchy. The TOO doc, spec, and plan were corrected mid-session to reflect this — they now describe an additive extension, not a from-scratch build. **Always run `git log main..origin/main --oneline` before claiming any UNS-related work.**
- **In-flight coordination:** Phase 0 is doc-only and runs on `main`. Phases 1+ live on new `feat/mnb-phase-N-*` branches. The active 90-day MVP units (`feat/mvp-unit-4-exports`, `feat/mvp-unit-9a-landing`) are **not** paused — they fold into Phases 2 + 4 respectively.
- **Marketing repositioning queued for Phase 4** (Weeks 7–8): new homepage H1 candidate "Turn your maintenance data into an AI-ready factory namespace." + new landing pages `/namespace-builder`, `/ignition`, `/ai-readiness-scan`. Coordinate with Unit 9a's branch before any merge to `mira-web/`.
- **Open decision (resolve before Phase 1):** KG schema canonicalization — Hub `001_knowledge_graph.sql` vs. NeonDB `004_kg_entities.sql + 007_uns_path.sql`. The new spec assumes the latter (per CLAUDE.md).

**To resume:**
1. Read the three new docs in order (TOO → spec → plan).
2. `git fetch origin main && git log main..origin/main --oneline` to see how far behind local is.
3. Read `docs/specs/uns-message-resolver-spec.md` (the existing spec on origin/main — describes the Stage-1 gate that's already shipped).
4. Read `mira-bots/shared/uns_resolver.py` and the engine.py UNS hook (line ~1316 on origin/main).
5. Then coordinate with the 90-day plan's in-flight section before any code change.

## eval-fixer run — 2026-05-15
- Scorecard: 48/57 passing (84%) — `tests/eval/runs/2026-05-06T0833-offline-text.md` (9 days stale, unchanged since 2026-05-10)
- Action: no-op (suppressed duplicate issue — #1217 from 2026-05-13 still covers this exact scorecard; prior dupes: #1144, #1170, #1187)
- Same 9 fixtures, same 3 file_clusters (engine.py×7, guardrails.py×3, prompts×3). No new signal — nightly eval job is stalled. Action needed: regenerate scorecard or land a fix on one of the open issues before the next eval-fixer run will produce signal.

# Hot Cache — 2026-05-14 — CHARLIE

## eval-fixer run — 2026-05-14
- Scorecard: 48/57 passing (84%) — source: `tests/eval/runs/2026-05-06T0833-offline-text.md` (unchanged since 2026-05-12, now 8 days stale)
- Action: issue-filed (autopatch skipped — 3 file_clusters, hard stop)
- Issue: https://github.com/Mikecranesync/MIRA/issues/1269 (third repeat — see #1217, #1187 — same scorecard, no fresh eval run)
- Same 9 fixtures still failing across `engine.py`, `guardrails.py`, `prompts/diagnose/active.yaml`. Nightly eval job is almost certainly dead — needs human investigation, not another auto-issue.

# Hot Cache — 2026-05-13 — CHARLIE

## eval-fixer run — 2026-05-13
- Scorecard: 48/57 passing (84%) — source: `tests/eval/runs/2026-05-06T0833-offline-text.md` (unchanged since 2026-05-12)
- Action: issue-filed (autopatch skipped — 3 file_clusters, hard stop)
- Issue: https://github.com/Mikecranesync/MIRA/issues/1217 (duplicates pattern from #1187 — same scorecard, no new run)
- Same 9 fixtures failing as 2026-05-12; scorecard has not refreshed. Nightly eval job may be stalled — check.

# Hot Cache — 2026-05-12 — CHARLIE

## eval-fixer run — 2026-05-12
- Scorecard: 48/57 passing (84%) — source: `tests/eval/runs/2026-05-06T0833-offline-text.md`
- Action: issue-filed (autopatch skipped — 3 file_clusters, hard stop)
- Issue: https://github.com/Mikecranesync/MIRA/issues/1187
- 4 failure clusters: (A) FSM state-progression regression — 6 fixtures stuck at wrong states in `engine.py`; (B) `/reset` not re-entering Q1 — spans engine.py + guardrails.py + active.yaml; (C) GS20 cross-vendor contamination — "PowerFlex" leaking into GS20 response; (D) CMMS WO creation not emitting confirmation text

# Hot Cache — 2026-05-10 — ALPHA

## Session — 2026-05-10 (printing-press toolchain bootstrap + Linear/Stripe CLIs)

- **Bootstrapped `mksglu/context-mode` Claude Code plugin** (user scope). `/plugin marketplace add mksglu/context-mode` → `/plugin install context-mode@context-mode`. Registers `PreToolUse`/`PostToolUse`/`PreCompact`/`SessionStart` hooks + 11 ctx_* MCP tools. Now intercepts `WebFetch`/`Bash` large-output calls and routes through `ctx_execute` + FTS5 sandbox. Healthy v1.0.111 → v1.0.118 patch updates available; non-urgent.
- **Installed Go 1.26.3** via `brew install go` and added `export PATH="$HOME/go/bin:$PATH"` to `~/.zprofile` (line 2, after `brew shellenv`).
- **Printing Press generator installed** (`mvanhorn/cli-printing-press` v4.2.2). Binary at `~/go/bin/printing-press`; 9 skills under `~/.claude/skills/printing-press*`. Drives `/printing-press <api>` slash command. MIT-licensed.
- **Linear CLI installed via the npm orchestrator** (`npx -y @mvanhorn/printing-press install linear`). Binary `linear-pp-cli` 1.0.0; skill `pp-linear` symlinked from `~/.agents/skills/pp-linear`. Local SQLite mirror path: `~/.config/linear-pp-cli/store.db` (not hydrated yet — `sync` will pull it). Auth: env-only via `LINEAR_API_KEY` already in Doppler `factorylm/prd`. `doctor` 4/4 green; `me` returned `mike @ Cranesync (Admin)`.
- **Stripe CLI installed same orchestrator** (`stripe-pp-cli` 1.0.0). Skill `pp-stripe`. Local DB path: `~/.local/share/stripe-pp-cli/data.db` (XDG split — Stripe uses `share/`, Linear used `config/`). `doctor` 5/5 green via Doppler-injected `STRIPE_SECRET_KEY`. Live `balance` call returned `meta.source: "live"`. Sync NOT yet run (Stripe event volume could be large — recommend `--dry-run` first).
- **Doppler-wrapped invocation pattern is canonical for printed CLIs**: `doppler run --project factorylm --config prd -- <pp-cli> <cmd>`. Both CLIs honor `auth_source: env:<KEY>` ahead of file auth — no on-disk plaintext.
- **Updated `~/.claude/CLAUDE.md`**: removed stale "`gh` CLI auth is broken (keyring token invalid)" note. Verified `gh 2.87.2` logged in as `Mikecranesync` via keyring with `gist`, `read:org`, `repo`, `workflow` scopes; auth-required API calls succeed. CLAUDE.md `## Secrets` section now only mentions the real-remaining gotcha (`TS_AUTH_KEY`).
- **Plan file with full analysis**: `~/.claude/plans/polymorphic-hugging-parnas.md`. Current contents: cross-referenced Doppler × MIRA env-vars × printing-press registry → ranked candidate API list (3 tiers). Tier 1 prebuilt + key-in-Doppler: Stripe ✅ (installed), OpenRouter (backlog), DigitalOcean (backlog). Tier 3 fresh-print candidates: NeonDB, Groq, Telegram Bot API, Atlassian, Mautic, Monday, YouTube Data.

**To resume:** the plan file's "Recommended next install" and "Backlog" sections are the menu. Easiest next steps: bundle install (`npx -y @mvanhorn/printing-press install openrouter digitalocean`) or kick a fresh print (`/printing-press NeonDB`, 30–60 min). Stripe `sync --dry-run` and Linear `sync` are also pending if you want the local mirrors hydrated.

## Session — 2026-05-10 (Atlas seed data fixes + session handoff)

- **PR #1169 merged** (`fix/atlas-seed-data-cra248-cra249`): fixed CRA-248 + CRA-249
  - **CRA-248**: Removed 3 of 4 duplicate KG triples (`PowerFlex 755 → exhibited_fault → F005`) in `mira-hub/scripts/seed-synthetic-users.ts` — was causing 3 duplicate work orders in demo
  - **CRA-249**: Expanded PM_SCHEDULES from 3 → 8 entries: added PUMP-01 seal inspection (overdue -5d, critical), HVAC-02 filter (+30d, low), VFD-07 annual thermal (+60d, high), CONV-03 belt splice (+75d, medium), PUMP-01 annual overhaul (+85d, critical). Calendar now spans -5 to +85 days with 5 equipment covered.
- **PR #1168 closed** (superseded by #1167 — FSM + multipart CVE fixes already merged)
- **Eval Offline pre-existing fail**: `rich.errors.MarkupError` in pytest sessionfinish when `[/new]` bracket appears in output — pre-existing on main, not blocking merges. Track in known-issues.md.
- **PROGRESS.md updated** to 2026-05-10 state
- **Next (IMMEDIATE)**: Re-run `bun run scripts/seed-synthetic-users.ts` against staging NeonDB → reshoot Atlas CMMS demo screens (work orders list, PM calendar, asset list). Then CRA-250: wire MIRA chat interface into demo flow.

## Session — 2026-05-10 (PostHog PLG funnel + merge to main)

- **PostHog server-side telemetry shipped**: `mira-web/src/lib/posthog-server.ts` + 5 funnel events wired in `server.ts` (register_submitted, checkout_started, checkout_completed, activation_completed, chat_sent)
- **PR #1167** merged to main. Branch: `fix/mira-hub-lockfile`.
- ~~**Next**: fix Atlas seed data (CRA-248 — duplicate work orders) + CRA-249 (PM calendar empty) before demo reshoot~~ ✅ Done in PR #1169

## Session — 2026-05-10 (demo video story scripts + pipeline extension)

**Iteration 2 additions:**
- **`build_video_v2.py` extended** with `--storyboard`, `--story`, `--recordings`, `--dry-run` flags; full backwards-compatible with original `storyboard_v2.yaml`
- **Dry-run validated**: all 5 stories, 49 total beats, all screenshots resolve `✓` (zero missing)
- **`--recordings` mode**: reads `beat-01.mp3...beat-NN.mp3` from a folder; user records voice, pipeline assembles video without OpenAI TTS
- **`_compute_pivot()`**: replaces hardcoded shot-3 pivot with `shots[min(2, len(shots)-1)]` for story length safety
- **Per-story isolated `output/` cache dirs**: multiple stories don't clobber each other's renders
- **Image path resolution**: `docs/promo-screenshots/*` paths resolve from MIRA_ROOT, legacy `reference/*` paths still work

**To build immediately (TTS voice):**
```bash
cd marketing/comic-pipeline
doppler run --project factorylm --config prd -- \
  .venv/bin/python build_video_v2.py \
  --storyboard ../demo-videos/story-scripts.yaml \
  --story 60-second-setup --skip-verify
```

## Session — 2026-05-10 (demo video story scripts)

- **5 demo video story scripts written**: `marketing/demo-videos/story-scripts.yaml` + `README.md`
- **Stories**: 60-second-setup, fault-code-30s, qr-scan-to-diagnose, pm-scheduling-autopilot, your-team-your-manuals
- **Format**: storyboard_v2.yaml-compatible — real screenshots + user-recorded voiceover, Ken Burns focal points per beat
- **8 new screenshots captured**: homepage-hero, cmms-signin, pricing-page, qr-asset-sheet, atlas-cmms-login, security-page (all 2026-05-10, docs/promo-screenshots/)
- **Pipeline gap**: `build_video_v2.py` needs `--storyboard`, `--story`, `--recordings` flags added before user-recorded voice works. TTS mode works today via Option A (swap shots into storyboard_v2.yaml). See README for details.
- **Hub login**: app.factorylm.com uses Google OAuth only — no password login; Playwright can't automate auth. Authenticated screenshots (chat, upload, QR chooser) still needed — capture manually.

## eval-fixer run — 2026-05-11
- Scorecard: 48/57 passing (84%) — `tests/eval/runs/2026-05-06T0833-offline-text.md`
- Action: issue-filed (#1170 — added to Kanban)
- 9 failures across 3 file clusters (engine.py×7, guardrails.py×3, prompts×3); multi-file span blocked autopatch
- Dominant pattern: FSM stuck at Q-states / not advancing to DIAGNOSIS; also PowerFlex cross-vendor bleed + CMMS WO keyword miss

## eval-fixer run — 2026-05-10
- Scorecard: 48/57 passing (84%) — `tests/eval/runs/2026-05-06T0833-offline-text.md`
- Action: issue-filed (#1144 — added to Kanban)
- Hard-stop: 3 file_clusters keys (engine.py + guardrails.py + active.yaml). 9 failures: 7 FSM state advancement regressions in engine.py (Q1→Q2 and Q2→DIAGNOSIS gates too conservative, plus 3 IDLE fallback cases), 1 cross-vendor leak (GS20 PHL fixture returning PowerFlex content), 1 CMMS WO flow not surfacing keywords. Scorecard is fresher than prior runs (2026-05-06, 84% vs prior 77%). Suggested fix order: engine.py FSM first (unblocks 7/9), then guardrails+prompt.

## eval-fixer run — 2026-05-09
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md` (same stale scorecard, 10 days old)
- Action: issue-filed (#1103 — added to Kanban)
- Hard-stop: 3 file_clusters keys (engine.py + guardrails.py + active.yaml). Identical 13 failures as 2026-05-04/05/06/07/08 runs. Prior issues #985, #1017, #1044, #1074 still open. Scorecard hasn't been regenerated in 10 days — judge eval is badly overdue, or one of the prior issues needs to land a fix before signal returns.

## eval-fixer run — 2026-05-08
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md` (same stale scorecard, 9 days old)
- Action: issue-filed (#1074 — added to Kanban)
- Hard-stop: 3 file_clusters keys (engine.py + guardrails.py + active.yaml). Identical 13 failures as 2026-05-04/05/06/07 runs. Prior issues #985, #1017, #1044 still open. Underlying scorecard hasn't been regenerated in 9 days — fresh judge eval is overdue, or one of the prior issues needs to land a fix before another run will produce signal.

## eval-fixer run — 2026-05-07
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md` (same stale scorecard, 8 days old)
- Action: issue-filed (#1044 — added to Kanban)
- Hard-stop: 3 file_clusters keys (engine.py + guardrails.py + active.yaml). Identical 13 failures as 2026-05-04/05/06 runs. Prior issues #985 and #1017 still open. Underlying scorecard has not been regenerated for 8 days — judge eval needs to be re-run or one of the prior issues needs to land a fix before another run will produce signal.

# Hot Cache — 2026-05-06 — CHARLIE

## Session — 2026-05-06 (CHARLIE, CRA-8 Phase 0 re-baseline)

- **Fresh eval scorecard**: `tests/eval/runs/2026-05-06T0752-offline-text.md` — `40/57 (70%)` on `main` HEAD (`90df74d`). Stale was `44/57 (77%)` on `2026-04-29T0617`. **4 net new regressions** since the stale scorecard.
- **Cluster A (3 fixtures from spec) — RESOLVED on main**: `vfd_danfoss_02_aqua_drive_manual`, `vfd_mitsu_02_fr_e700_find_datasheet`, `vfd_siemens_02_micromaster_manual` all PASS now (commit `28aba78` did the work).
- **Cluster B residuals**: `pilz_manual_miss_11`, `distribution_block_forensic_36` still stuck in `MANUAL_LOOKUP_GATHERING`. `vfd_mitsu_03_a700_parameter` PASSES now.
- **Cluster C residuals**: `vague_opener_stuck_state_05` PASSES now; `vfd_danfoss_04_vlt_fc360_edge` still stalls at `Q1`.
- **NEW Q-state regressions (not in spec's 13)**: `pf525_f004_02`, `gs20_cross_vendor_03`, `asset_change_mid_session_08`, `reset_new_session_09`, `gs3_ground_fault_14`, `gs20_phase_loss_16`, `yaskawa_a1000_ov_23`, `yaskawa_ga700_encoder_26`, `vfd_abb_01_acs580_fault_2310`, `vfd_siemens_03_sinamics_cross_vendor`, `self_critique_low_instruction_35`. Mostly LLM-stochastic Q1↔Q2↔DIAGNOSIS stalls — Cluster C reword + Phase 2 hard FSM rule should mop these up.
- **Branch**: `fix/cra-8-fsm-eval-residual` (from `main` `90df74d`). Phase 1 (apply all clusters per Mike) starting next.

# Hot Cache — 2026-05-04 — CHARLIE

## Session — 2026-05-04 (CHARLIE, Stage 1 DST merge)

- **Stage 1 merged to main**: `feat/dialogue-state-tracker` → `main` fast-forward at `26b69ed`. No conflicts. 7 new files (dialogue_acts.py, dialogue_state.py, dialogue_tracker.py, 3 test files, +201 lines in engine.py).
- **Tests**: 115/115 pass (0.16s). Full suite: 470 pass, 52 pre-existing adapter import failures (unchanged from before merge — not regressions).
- **Flag-gated OFF**: `_DST_ENABLED = os.getenv("MIRA_USE_DST", "0") == "1"` — live behavior is **identical** to before until flag is enabled.
- **To enable DST**: add `MIRA_USE_DST=1` to Doppler `factorylm/prd` → restart `mira-bots` container on VPS.
- **After enabling**: run Mike's 5-question human test. Synthetic harness: `cd mira-bots && uv run pytest tests/test_dialogue_tracker.py tests/test_dialogue_acts_llm.py tests/test_engine_dst_integration.py -v`.
- **Also merged today**: CRA-20 (Open CMMS button on /m/:tag/* scan pages — PR #975), CRA-21/22 (magic-link JWT). PRs open: CRA-23 (PR #959 — Atlas→MIRA floating button), CRA-18 (PR #945 — landing page rewrite).

## Stage 2 — Next Actions (in order)

1. **[user-action]** Enable DST on VPS: `doppler secrets set MIRA_USE_DST=1 --project factorylm --config prd` → `docker compose restart mira-bots` → run 5-question human test
2. **[agent-action] Remove legacy `route_intent`** — once DST validated live, delete `mira-bots/shared/conversation_router.py` and all call sites except engine.py line 17 import (replace with DST-only path, remove `_DST_ENABLED` flag)
3. **[agent-action] Slot-fill ladder** — when DST classifies `answering_question`, extract answer into slot (equipment/fault_code/symptom) instead of re-embedding as RAG query. Lives in `dialogue_tracker.py` dispatch handler.
4. **[agent-action] Hard vendor filter on RAG** — if `SalientEntities.equipment_vendor = "Siemens"`, filter `recall_knowledge()` results to Siemens-sourced chunks only. Target: `neon_recall.py` WHERE clause + `dialogue_state.py` entity extraction.
5. **[agent-action] Conversation repair** — when DST detects `action_interrupt` mid-diagnosis, acknowledge + handle interrupt + prompt to resume original thread. Lives in `_maybe_dispatch_via_dst()`.
6. **[agent-action] CRA-11** — Source citations in RAG (extend `neon_recall.py:372-395`, inject `[Source:]` in `rag_worker.py:376`, compliance check in `engine.py Supervisor.process_full()`). Branch: `feat/mvp-unit-2-citations`.

## PRs Open (as of 2026-05-04)

| PR | Branch | What | Status |
|----|--------|------|--------|
| #975 | fix/cra-20-cmms-scan-buttons | Open CMMS button on scan pages | Open, ready to merge |
| #959 | fix/cra-23-open-mira-from-cmms | "Open MIRA →" float on CMMS | In Review |
| #945 | feat/unit-9a-landing | Landing page $97/mo rewrite | In Review |

# Hot Cache — 2026-05-03 — BRAVO

## Session — 2026-05-03 (BRAVO, eval recovery engine fixes)

- **Fix 1 (FSM stuck in MANUAL_LOOKUP_GATHERING)**: In `engine.py` ~line 736, before falling through to `_enter_manual_lookup_gathering()`, added a KB pre-check when `mfr` is already known. If `kb_has_coverage()` returns True, routes directly to `_do_documentation_lookup()` instead. Targets 5 failing fixtures where FSM was stuck gathering vendor info we already had.
- **Fix 2 (canned "documentation indexed" vs vendor URL)**: In `_do_documentation_lookup()` ~line 2459, updated the `kb_covered` reply to include the vendor name and URL if available (`f"I have {mfr} documentation indexed. Official source: {url} Ask about fault codes, specs, or wiring."`). Targets 3 failing fixtures expecting vendor name/model keywords in the response.
- **Tests**: 345 passed, 0 new failures (excluding 5 pre-existing import/isolation issues: slack_relay, teams_adapter, email_adapter, telegram_adapter x2).
- **Eval status**: fixes address 8 of the 13 failures from the 2026-04-30 run (77%→estimated ~91%). Remaining 5 are thin-diagnosis content — active.yaml tuning if needed.
- **Branch**: `feat/multi-tenant-telegram` — not yet committed.

# Hot Cache — 2026-04-30 — CHARLIE

---

# Hot Cache — 2026-05-03 — CHARLIE

## Session — 2026-05-03 (CHARLIE, Marketing Director audit)

**What was done:**
- Full marketing audit: MIRA + FactoryLM repos, Linear board (Cranesync), all open PRs
- **PR #941 merged** — competitor analysis refresh (COMPETITOR_ANALYSIS.md)
- **PR #927 merged** — gitignore audio/video outputs in marketing/videos
- **PR #945 opened** — Unit 9a landing page rewrite (feat/mvp-unit-9a-landing) — 1,516-line index.html, three features above fold, $97/mo pricing
- **PR #946 opened** — LinkedIn 6-part series + warm outreach DM templates (feat/marketing-content-clean)
- **feature-cartoons.js** — already on main via PR #931, no action needed
- **PR #790** — promo director playbook v1.0.0 — CI re-triggered (pushed YAML change), pending pass

**New files:**
- `marketing/content/linkedin-series-2am-vfd-problem.md` — 6 posts, weekly from 2026-05-10
- `marketing/content/warm-outreach-dm-templates.md` — 6 DM templates + tracking sheet

**Critical path (first paid demo May 4):**
- Unit 9a: PR #945 open, CI pending, needs Lighthouse ≥90 + Stripe test charge
- Unit 2 (citations): CRA-11, branch feat/mvp-unit-2-citations — TODO
- Unit 6 (hybrid retrieval): CRA-15 — TODO

## Next Actions (2026-05-03 priority order)

1. **Merge PR #790** — watch CI on feat/promo-director-playbook; merge when lint green
2. **Merge PR #946** — markdown-only, CI will skip, can merge now
3. **Merge PR #945** — needs Lighthouse ≥90 + Stripe test charge
4. **Start LinkedIn Post 1** — schedule "The 2 AM Call" for Tue 2026-05-10, 7-9 AM Eastern
5. **HubSpot API key** — add `HUBSPOT_API_KEY` to Doppler `factorylm/prd` to unlock 330-prospect import
6. **Unit 2 + 6** — needed for first paid demo May 4

---

# Hot Cache — 2026-05-02 — CHARLIE

## Just Finished

- **Linear board fully operational** — Cranesync workspace, 3 projects (MVP Build / Sales & GTM / Ops & Infra), 15 issues (CRA-5 through CRA-19), all labeled with `user-action` / `agent-action`. All 4 custom statuses created (Shaping, Reviewed, Ready to Deploy, Pending Deployed). Board cleaned up: FactoryLM stale project cancelled, all 3 active projects set to In Progress.
- **Linear MCP plugin confirmed installed** — HTTP transport → `https://mcp.linear.app/mcp`. Config: `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/linear/.mcp.json`. Zero config changes needed.
- **YouTube transcript researcher skill shipped** — `tools/youtube_transcript.py` + global skill `.claude/skills/youtube-transcript.md`. Triggers when YouTube URL is pasted and WebFetch would fail.
- **Promo screenshots** — captured to `docs/promo-screenshots/` for video pipeline.
- **Memory snapshot committed** — `docs/memory-snapshots/2026-05-02/` + tag `memory-rollback-2026-05-02`.

## Machine State

- **CHARLIE (this machine):** `main` @ `4c90bf1` — memory snapshot + wiki update. YouTube transcript skill + promo screenshots at `3ede8ef`.
- **VPS:** last known `main` @ `eeb9a4b` (mira-bot-telegram) — not touched this session.
- **Alpha / Bravo:** no changes this session.

## Blocked

- **"In Review" status** — Linear Settings → Workflow → delete it manually. The API cannot manage workflow states; this default status conflicts with the custom "Reviewed". One-minute manual fix.
- **Eval FSM 77%** — CRA-8 (Ops & Infra). Same 13-failure cluster (engine.py + guardrails.py + active.yaml) has run 4 days without progress. Needs human triage — manual-lookup misroute is the highest-leverage fix.

## Next (any machine)

**All active work is tracked in Linear → linear.app/cranesync**

Quick orientation:
- `agent-action` issues = Claude can execute autonomously
- `user-action` issues = needs Mike
- Urgent/blocked: CRA-5 (SPF/DKIM DNS), CRA-6 (NEXTAUTH_SECRET to Doppler), CRA-8 (eval FSM fix)
- In-flight branches: `feat/mvp-unit-4-exports` (CRA-13), `feat/mvp-unit-9a-landing` (CRA-18)

---

## Recent Eval-Fixer Runs (context for eval debugging)

### eval-fixer run — 2026-05-03
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md` (stale for 5th day; no new run)
- Action: issue-filed (#932)
- Same 13-failure pattern persists. Issue groups failures into Cluster A (FSM, 5) and Cluster B (keyword/content, 8) with B1–B4 sub-patterns. B1 (manual-lookup canned "I already have documentation indexed" deflection, 4 fixtures) flagged as highest-leverage fix in `engine.py`. → **CRA-8**

### eval-fixer run — 2026-05-02
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md` (stale for 4th day; no new run)
- Action: issue-filed (#918)
- Same 13-failure pattern as #884/#916 — engine.py FSM stuck (5) + guardrails/active.yaml content (8). Cluster spread blocks autopatch. Manual-lookup misroute first (3 fixtures get canned "documentation indexed" deflection instead of vendor URL + IDLE state). → **CRA-8 in Linear**

### eval-fixer run — 2026-05-01
- Scorecard: 44/57 passing (77%) — same stale scorecard
- Action: issue-filed (#916)

### eval-fixer run — 2026-04-30
- Scorecard: 44/57 passing (77%) — `tests/eval/runs/2026-04-29T0617.md`
- Action: issue-filed (#884)
- 13 failures spanning 3 files — exceeds single-file autopatch limit. FSM stuck (5), manual-lookup canned reply (3), cross-vendor RAG bleed (1), thin diagnosis (4).

## eval-fixer run — 2026-04-29
- Scorecard: 0/57 passing (0%) — `tests/eval/runs/2026-04-27T0455.md` (stale, same scorecard as 2026-04-28 — no new run produced)
- Action: issue-filed (#854)
- Third day in a row of the same systemic infra failure (#753, #803, now #854). Every fixture returns 0-char responses — `cp_pipeline_active` fails universally, 0 patchable. No upstream eval has produced a fresh scorecard since 2026-04-27 04:55 UTC. Engine/cascade still silent.

## eval-fixer run — 2026-04-28
- Scorecard: 0/57 passing (0%) — `tests/eval/runs/2026-04-27T0455.md`
- Action: issue-filed (#803)
- Same systemic failure as 2026-04-27 (#753): all 57 fixtures returned 0-char responses; `cp_pipeline_active` fails for every fixture, so 0 patchable. Engine is silent — infra/cascade still broken. Last fresh scorecard is the 2026-04-27 04:55 UTC run.

## eval-fixer run — 2026-04-27
- Scorecard: 0/57 passing (0%) — `tests/eval/runs/2026-04-27T0103.md`
- Action: issue-filed (#753)
- All 57 fixtures failed `cp_pipeline_active` with 0-char responses — pipeline silent across the board, infra/cascade issue, not patchable. State stayed IDLE because no response was ever generated.

## Session — 2026-04-27 (CHARLIE, PM end-to-end demo)

- **PM Work Order Auto-Generator shipped**: `pm_scheduler.py` + `/api/pm/generate-work-orders` in mira-pipeline. Generates WOs from due `pm_schedules`, mirrors to Atlas CMMS, runs at UTC midnight via asyncio task. Fixed enums: `auto_pm` (sourcetype), `PM` (routetype), `user_id='pm_scheduler'`, equipment_id FK via `_resolve_equipment_id()`.
- **26 PMs extracted** across 8 equipment models (Yaskawa, Rockwell, Allen-Bradley, Danfoss, Siemens). 43 WOs in mike tenant, 3 auto-generated (Auto-PM source).
- **Hub WO page**: now fetches live from NeonDB via new `/api/work-orders` route. Auto-PM badge (Sparkles), Telegram badge, source citations, parts preview. Fixed basePath URL bug: `fetch("/hub/api/...")` not `fetch("/api/...")`.
- **Hub Schedule page**: fetches 26 real PMs via `/hub/api/pm-schedules`. "26 AI-extracted" badge. Calendar shows live data.
- **STRATEGY.md + NORTH_STAR.md** committed to repo root. CLAUDE.md updated with screenshot rule.
- **Auto-trigger PM extraction**: `_maybe_trigger_pm_extraction()` in mira-ingest fires after `ingest_document_kb` success.
- **PR #732 merged** (5 UX fixes — #688 #719 #720 #721 #722).
- **Promo screenshots** (8): schedule + WO pages at desktop+mobile. In `docs/promo-screenshots/`.
- **NEXTAUTH_SECRET**: hardcoded in `/opt/mira/docker-compose.hub.yml` on VPS (not in Doppler — add it!).
- **Issue #690** (SPF/DKIM): DNS check shows no SPF/DMARC configured. Action plan in issue comments. Manual DNS work for Mike.

## Next Actions (2026-04-27 priority order)

1. **#690 SPF/DKIM** — Mike adds SPF+DMARC+DKIM CNAMEs to DNS registrar (5 records, manual). Documented in issue.
2. **NEXTAUTH_SECRET** — add to Doppler `factorylm/prd` so it survives hub rebuilds (current hardcode in docker-compose.hub.yml will be lost on next git pull on VPS).
3. **WO detail page** — rewrite to fetch real WO from NeonDB (currently hardcoded fallback); add `/api/work-orders/[id]` route.
4. **PM scheduler midnight run** — confirm it ran overnight (check mira-pipeline-saas logs morning of 2026-04-28).
5. **Branch cleanup** — `feat/hub-741-login-gate` has all hub work; PR + merge to main.

# Hot Cache — 2026-04-25 — BRAVO

## Session — 2026-05-01 (BRAVO, development status orientation)

- **Repo/GitHub orientation only**: no code changes beyond this hot-cache note.
- **Current local branch**: `feat/multi-tenant-telegram`, with `24` local commits ahead and `260` commits behind `origin/main`; working tree also has a pre-existing modification in `marketing/prospects/hardening-alerts.jsonl`.
- **Latest `origin/main`**: `9d3ac48` after PR #915 (`feat(cmms): WO completion validation + PM multi-trigger scheduling`) and PR #914 (`feat(security+export): /security page + data export API`).
- **MVP plan drift**: `docs/plans/2026-04-19-mira-90-day-mvp.md` still lists only Unit 6 as in-flight, but commits/env docs show Unit 3 magic inbox, Unit 4 exports, and Unit 6 hybrid retrieval have landed or partially landed. The plan file needs a sync before new unit work is claimed.
- **Open PR focus from `gh pr list`**: security/site-hardening PRs #890, #891, #892 plus plan #888 remain open; #885 is a post-sweep status update; large non-MVP branches remain open (#879 synthetic Rico, #836 RealWear, #790 promo director) plus Dependabot PRs.
- **Open issue focus from GitHub connector**: #913 says main CI has 3 failing workflows; #884 reports eval at 44/57 with 13 patchable failures; #880 Telegram inbound is blocked by a competing CHARLIE poller; #881 KB growth is blocked by missing `mira-docling` on VPS; #889/#877 are engine/RAG security findings.
- **Coordination note**: start new work from fresh `origin/main`, not the current local branch, unless intentionally continuing `feat/multi-tenant-telegram`.

## Session — 2026-05-01 (BRAVO, ingest latency tracking)

- **Added local ingest latency utility**: `mira-crawler/metrics/latency.py` writes append-only JSONL records; `mira-crawler/tools/record_ingest_latency.py` wraps arbitrary parser/ingest commands.
- **Instrumented local folder watcher path**: `mira-crawler/main.py` now records `read`, `dedup`, `parse`, `chunk`, `embed`, and `store` timings for dropped-file ingestion.
- **Documented usage**: `docs/developer/ingest-latency.md`; default log is `mira-crawler/data/ingest_latency.jsonl`, override with `MIRA_INGEST_LATENCY_LOG`.
- **VPS side script deployed**: copied recorder files to `/opt/mira/mira-crawler/{metrics,tools}` and smoke-tested writes to `/var/log/mira-agents/ingest_latency.jsonl`.
- **VPS cron wrapped**: KB-growth crontab line now runs `record_ingest_latency.py --parser docling --source-id kb_growth` around `/opt/mira/mira-crawler/cron/kb_growth_cron.py`, logging latency JSONL plus normal output to `kb_growth.log`.
- **#881 status discovered**: `mira-docling-saas` is deployed and healthy, but the PowerFlex-525 queue item still fails with `Docling: timed out`; next fix is parser timeout/split behavior in `mira-crawler/tasks/full_ingest_pipeline.py` on the current `origin/main`/VPS code path.
- **#881 parser hotfix applied on VPS**: `full_ingest_pipeline.py` now splits large PDFs before Docling sync and falls back to `pypdf` if Docling times out or returns empty text; `kb_growth_cron.py` now exits nonzero when an item fails.
- **Verification**: direct CompactLogix-L1 ingest succeeded after patch (`20,842` chars, `8` KB chunks, `1` equipment entity, `1` fault-code entity). Wrapped KB-growth run then processed MicroLogix-1400 successfully (`62,624` chars, `9` KB chunks, `1` equipment entity); latency JSONL recorded `199,415 ms`.
- **Queue after verification**: `3 done`, `1 failed`, `31 pending`; remaining failed item is PowerFlex-525 from the pre-hotfix run and should be retried or reset after confirming dedup behavior.
- **Git preservation**: created local worktree `/tmp/mira-issue-881-patch` on branch `fix/kb-growth-parser-fallback-881` with the VPS parser/cron patch plus ingest latency utility files staged as working-tree changes.

## Session — 2026-05-01 (BRAVO, KB library dashboard PRD)

- **PRD/spec added**: `docs/superpowers/specs/2026-05-01-kb-library-dashboard-design.md` defines a public FactoryLM KB Library page plus an authenticated Hub KB Ops dashboard.
- **Dashboard indicators chosen**: ingest latency, parse success rate, queue freshness, and coverage quality; includes status/actions for retry, fallback reparse, quarantine, parser restart, publish/unpublish, and log review.
- **Schema proposed**: `kb_documents`, `kb_ingest_runs`, and `kb_ingest_events` to stop inferring manuals from chunks and to make ingest self-diagnosing.
- **OSS research outcome**: use existing Hub stack first (`recharts` already installed); compatible candidates include Apache ECharts, TanStack Table, shadcn/ui patterns, Docling, and Unstructured. Avoid Grafana/Metabase OSS because AGPL violates the current Apache/MIT-only rule.
- **Live ingest note**: second watched KB-growth run for Allen-Bradley 100-C later failed after the 900s wrapper timeout. Latency JSONL recorded `status=error`, `returncode=1`, `delivery_to_done_ms=900132`; queue became `4 done`, `2 failed`, `29 pending`. Treat this as a dashboard requirement: show slow-but-progressing separately from timed-out/stuck, and surface command-level timeout as a distinct failure category.

## Session — 2026-04-26 (BRAVO, marketing landing-page recon)

- **Recon artifact added**: `docs/recon/marketing-landing-pages-2026-04-26/recon-notes.md` compares public `factorylm.com` and `factorylm.com/cmms` against public Factory AI (`f7i.ai`) plus current competitor references.
- **Screenshots captured**: homepage/pricing/trial screenshots saved in `docs/recon/marketing-landing-pages-2026-04-26/screenshots/` for FactoryLM, Factory AI, MaintainX, UpKeep, Limble, and Fiix.
- **Key finding**: FactoryLM's product thesis is strong, but the first viewport lacks trust proof and the `/cmms` beta form asks for too much too early.
- **Highest-leverage recommendation**: make `/cmms` the tester funnel with passwordless magic-link entry, ask only for email first, and land users in a seeded sample workspace or guided first diagnostic.
- **Competitor patterns to borrow**: Factory AI page sequencing, UpKeep hero composition, MaintainX free-trial clarity, Limble dark-theme polish, Fiix credibility stacking.
- **Safety**: no public forms submitted, no emails sent, no beta signups created.

## Session — 2026-04-25 (BRAVO, repo sync baseline)

- **Repo sync baseline implemented**: switched from stale `feat/lsp-claude-code` to fresh `codex/repo-sync-baseline` tracking `origin/main` at `ca3c54a`.
- **Preserved old branch tip**: local branch `codex/preserve-lsp-claude-code-20260425` points at the previous LSP checkout; it was 44 commits ahead / 204 behind `origin/main`.
- **Local untracked work preserved**: `.agents/`, `AGENTS.md`, `.playwright-mcp/page-2026-04-12*.yml`, and `marketing/prospects/hardening-alerts.jsonl` remain present.
- **Baseline note added**: `docs/developer/repo-sync-baseline-2026-04-25.md` records current branch, preserved work, coordination check, collaboration map, and verification results.
- **Coordination check**: open PRs include #637 Unit 9a landing, #635 CI billing/auth skip, #634 hub auth secret, #610 Anthropic runtime removal. MVP plan currently shows Unit 6 hybrid retrieval claimed by `agent-claude`; avoid `neon_recall.py` / migration 006 until coordinated.
- **Verification**:
  - `pytest mira-bots/tests/test_citation_gate.py -v` passed: 25/25.
  - `pytest tests/ -m "not network and not slow"` still blocked during collection after network rerun: missing `hypothesis`, broken local `starlette` import for FastAPI, and `shared.session_memory` import resolution.
  - `cd mira-web && bun test` failed on existing environment/dependency issues: `@neondatabase/serverless` missing named `Client`, missing `NEON_DATABASE_URL` for QR tracker, and Stripe network behavior in account deletion test.

## Session — 2026-04-25 (BRAVO, Factory AI / Hub recon)

- **Recon artifact added**: `docs/recon/factory-ai-hub-2026-04-25/recon-notes.md` compares signed-in Factory AI (`app.f7i.ai`) against signed-in FactoryLM Hub (`app.factorylm.com/hub/*`) for layout, styling, functions, flows, and bootstrap recommendations.
- **Screenshots captured**: 43 PNGs in `docs/recon/factory-ai-hub-2026-04-25/screenshots/`, including Factory AI registry/assets/work orders/inventory/purchasing/knowledge/settings/AI tour and FactoryLM feed/event-log/conversations/knowledge/channels/workorders.
- **Key design takeaway**: Factory AI's polish comes from a consistent shell, persistent right-side AI rail, dense table tooling, skeletons, and finished empty states; FactoryLM has stronger industrial content but needs route reliability and shell polish.
- **Hub issues found live**: `/hub/assets` bounced to login from a signed-in page, `/hub/usage` failed with a browser load error even after reload, and New Work Order step 1 labels the progression button `Save` despite a 3-step wizard.
- **No live records changed**: no submit/save/delete/acknowledge/dismiss/connect actions were completed; upload/file-picker flows were inspected without selecting files.

# Hot Cache — 2026-04-22 — CHARLIE

## eval-fixer run — 2026-04-23
- Scorecard: 0/57 passing (0%) — `tests/eval/runs/2026-04-20T1011.md` (stale 3+ days)
- Action: issue-filed — #525 (57 failures, 0 patchable; pipeline produced 0-char responses on every fixture)
- Systemic pipeline failure, not single-file patchable. Still no fresh scorecard since 2026-04-20 — upstream eval job on Alpha still appears stuck (see #474).

## eval-fixer run — 2026-04-22
- Scorecard: 0/57 passing (0%) — `tests/eval/runs/2026-04-20T1011.md` (unchanged from 2026-04-21)
- Action: issue-commented — #474 re-flagged (dup #484 closed)
- Same scorecard as yesterday; watchdog has not ingested a fresh eval in 2+ days. Escalation added to #474: check Alpha Celery beat + `mira_eval_tasks.py` logs — hourly eval may have stopped producing scorecards.

## Session — 2026-04-22 (CHARLIE, tech debt sprint)

- **Tech debt sprint complete** — 6 issues closed: #508 (shell injection), #509 (hardcoded IPs), #510 (:latest tags), #511 (PLCWorker dead code), #512 (dup env vars), #513 (zero unit tests)
- **Conversation stability fixes shipped** (PR #514 merged): formatted reply stored in history, `active_alarm` anchor, photo role split (user caption vs system OCR), `_strip_memory_block` combined
- **Cascade fix**: router.py now logs unconditionally when all providers fail (commit b463dbe) — fixes #474
- **CD pipeline live** (#392 closed): `.github/workflows/deploy-vps.yml` auto-deploys on push to main; VPS SSH key in GitHub secrets
- **Eval baseline**: 47/57 passing (82.5%) — `tests/eval/runs/2026-04-22T0828-offline-text.md`. Closed #474, #399.
- **V1000 ingest**: `pdf_stored=false` reset for id=266; pdfplumber extracted 2923 chunks; Ollama embedding in progress (background, pid 5740). Closes #383 once complete.
- **VPS**: healthy post-deploy (PR #515 auto-triggered CD), all 8 containers up. Last deploy: `06e8e82`.

## Session — 2026-04-20 (CHARLIE, QR pipeline ship)

- **v3.6.0 tagged + pushed** — QR asset-tagging pipeline complete: scan → pipeline → asset-aware chat + channel chooser + guest reports.
- **PR #412 merged** (`feat/qr-asset-tagging`): QR MVP — 66 tests, migrations 003 applied to NeonDB prod. Conflicts resolved: `Supervisor` rename + format fix.
- **PR #423 merged** (closes #408): `lookup_scan_context` with LEFT JOIN — saves ~200-300ms per scan-to-chat turn.
- **PR #424 merged** (closes #409): Reset wins over pending scan (Option B). `Set-Cookie: mira_pending_scan=; Max-Age=0` on `/reset`.
- **PR #421 merged** (`feat/qr-channel-chooser`): channel chooser + guest form + admin channel config. Migrations 004+005 applied to NeonDB prod.
- **PR #425 merged** (closes #407): `NOT_FOUND_HTML` extracted to `src/views/scan-not-found.html`.
- **PR #426 merged** (closes #408-guardrails): `"was live"` + `"while live"` added to `SAFETY_KEYWORDS`.
- **Issue #410 done**: `PLG_JWT_SECRET` synced to Doppler `factorylm/dev` config.
- **NeonDB migrations applied**: 003 (asset_qr_tags + qr_scan_events), 004 (tenant_channel_config), 005 (guest_reports).

## Session — 2026-04-20 (BRAVO)

- **PR #421 opened (draft)**: `feat/qr-channel-chooser` → `main` — Phase 1 QR channel chooser + guest form + admin config. **52/52 tests pass**. Commit `a675cf6`.
- **feat/qr-channel-chooser branch**: full Phase 1 implementation shipped. See PR #421 for acceptance checklist.
- **Phase 1 summary**:
  - DB: `tenant_channel_config` + `guest_reports` migrations (004, 005)
  - `/m/:tag` now auth-optional; unauthed scans route to chooser / guest form / direct channel via cookie
  - `/m/:tag/choose` — tenant-ordered channel buttons, sets 30-day HMAC cookie on pick
  - `/m/:tag/report` — guest fault-report form + `POST /api/m/report` (no Atlas WO auto-created)
  - `/admin/channels` — per-tenant channel config (admin-gated)
- **Kanban board**: needs `gh auth refresh -h github.com -s read:project` to add PR #421. Run this in terminal then add: `gh project item-add 4 --owner Mikecranesync --url https://github.com/Mikecranesync/MIRA/pull/421`
- **GitHub auth scope fix needed**: token is missing `read:project`. Run: `gh auth refresh -h github.com -s read:project`

## Machine State (as of 2026-04-20 BRAVO)

- **BRAVO (this machine):** `feat/qr-channel-chooser` branch — `a675cf6`, pushed to origin
- **VPS (165.245.138.91):** still on `main` — `1997a0d`. PR #421 not yet merged/deployed.
- **Bravo Ollama (100.86.236.11):** :11434 OK
- **PLC Laptop (100.72.2.99):** PLC at 192.168.1.100 unreachable — physical check needed

## Next Actions (priority order)

1. **Fix GitHub auth scope** → `gh auth refresh -h github.com -s read:project` then add PR #421 to kanban
2. **Review + merge PR #421** — Phase 1 QR chooser. Deploy checklist in PR body.
3. **After PR #421 merge**: apply migrations 004 + 005 on VPS NeonDB, rebuild `mira-web`
4. **Fix #378** — `guardrails.rewrite_question` can return `""` — P1 safety bug (branch: `fix/hypothesis-rewrite-question-input` exists)
5. **Fix #377** — `test_crawler_type_is_valid` fails — Siemens `playwright:chrome` rename (branch: `fix/crawler-type-playwright-prefix` exists)
6. **VPS stash**: drop stale fixture stash from old `feat/training-loop-v1` session once eval confirms clean
7. **BFG git history cleanup** — purge old secrets from history
8. **HTTPS/TLS** — nginx config on VPS
9. **#392** — VPS CD pipeline (still manual SSH deploy)

## Open Issues (active)

- **#383** — V1000 chunks backfill — ingest running (2923 chunks being embedded)
- **#403** — 6 missing Rockwell publications (documentation gap, needs manual download)
- ~~**#338, #335, #377, #378, #399, #474, #392**~~ — all confirmed CLOSED as of 2026-04-22

## Key NeonDB Facts
```
Total chunks: ~68,000+
Rockwell Automation: 13,686 chunks (main KB)
ABB: 931 chunks — mostly NULL model_number
Siemens: 905 (SINAMICS) + 442 (other)
AutomationDirect: 2,250 chunks (GS10, PF525, etc.)
Yaskawa: 27 chunks (NULL model) + 1 (CIMR-AU4A0058AAA)
Danfoss: 2 chunks (VLT FC302 only)
Mitsubishi Electric: 16 chunks (NULL model)
```

## eval-fixer run — 2026-05-29
- Scorecard: 33/57 passing (58%) — `tests/eval/runs/2026-05-29T0058-offline-text.md`
- Action: issue-filed (#1583) — autopatch skipped (24 patchable > 15 limit AND 3 file clusters)
- Systemic FSM/UNS-gate regression band (64%→56%→58% over last 3 runs), not a single patchable cluster. Dominant symptoms: sessions stuck at AWAITING_UNS_CONFIRMATION (expect Q1/Q2/DIAGNOSIS) and find-manual fixtures landing in ASSET_IDENTIFIED instead of IDLE. NOTE: `last_response_snippet` empty for every failure — offline runner not capturing final response; fix that before diagnosing.

## eval-fixer run — 2026-05-31
- Scorecard: 34/57 passing (59%) — `tests/eval/runs/2026-05-31T0158-offline-text.md`
- Action: issue-filed (commented on canonical #1583, no new duplicate)
- Chronic FSM/UNS-gate regression band continues. 23 patchable failures, 3 file clusters → both autopatch hard-stops tripped (>15 failures; >1 file). Same A–E clusters as #1583.
- Key finding: ~15pt pass-rate swing across 5 runs on 2026-05-30 (49–64%) with no code changes → eval is non-deterministic; judge fixes against a multi-run mean, not one scorecard. Empty `last_response_snippet` is a watchdog parsing artifact (no transcript column in scorecard), NOT empty responses.
- Human decision still pending (#1583 step 1): are cluster-A/B fixtures stale vs the UNS gate, or did the gate regress?

## eval-fixer run — 2026-06-01
- Scorecard: 30/57 passing (53%) — new low in the FSM/UNS-gate band
- Action: issue-filed (commented on tracker #1583, not a duplicate)
- 27 patchable failures but both autopatch hard-stops tripped (>15 failures; 3 file clusters). Same clusters A–E as #1583. `last_response_snippet` still empty for all — transcript capture remains the #1 blocker.

## eval-fixer run — 2026-06-02
- Scorecard: 35/57 passing (61%)
- Action: issue-filed (#1640)
- 22 failures, all autopatch-blocked (>15 patchable AND 3 file clusters). Systemic FSM/UNS-gate regression — 21/22 point at engine.py. Clusters: gate stuck in AWAITING_UNS_CONFIRMATION, docs-requests landing in ASSET_IDENTIFIED instead of IDLE, over-qualifying (stuck Q1/Q2 vs DIAGNOSIS), CMMS WO not created, PowerFlex leaking on GS20. Needs human bisect.

## eval-fixer run — 2026-06-03
- Scorecard: 35/57 passing (61%) — runs/2026-06-03T0109-offline-text.md
- Action: issue-filed (#1678)
- 22 patchable failures but BOTH hard-stops tripped (>15 failures AND 3 file clusters: engine.py, guardrails.py, active.yaml). Broad FSM-routing regression — fixtures stuck in AWAITING_UNS_CONFIRMATION/Q1/IDLE or over-advancing to ASSET_IDENTIFIED. Needs human bisect of recent engine.py state-machine edits.
# Hot Cache - 2026-06-25 - Context spine unification audit

Read-only FactoryLM/MIRA context spine investigation completed in `C:\Users\hharp\.codex\worktrees\a113\MIRA`.
- Deliverables:
  - `docs/investigations/2026-06-25-context-spine-subagent-audit.md`
  - `docs/plans/2026-06-25-context-spine-unification-plan.md`
- Verdict: MIRA Hub is the canonical self-serve spine; FactoryLM should feed it as a read-only edge/demo/proof source, not become a parallel KG/approval/readiness product.
- Existing spine: Offline Contextualizer / PLC parser -> Hub contextualization staging -> human approve/reject -> UNS/KG + `knowledge_entries` -> readiness -> approved-context MIRA answers -> optional relay-approved telemetry -> SimLab proof.
- Main glue gaps: legacy bundle import vs JSON intake semantics, document chunks not consistently counted in readiness/approval, approved-only retrieval is flag-gated and not visibly enforced everywhere, `/api/mira/ask` relationship filtering needs verified-only proof, and SimLab/live proof is not yet one command.
- Smallest PR plan from the audit was docs/contract alignment first, then import review unification, approved-context readiness/answer gates, and SimLab proof runner.
- Follow-up implementation slice: legacy bundle import now computes a bundle SHA, upserts/returns `ctx_import_batches`, attaches `ctx_sources.import_batch_id`, updates batch counts, and treats same-bundle re-import as idempotent. Added `mira-hub/src/app/api/contextualization/import/__tests__/route.bundle.test.ts`; verified with focused Vitest + ESLint.

---
# Hot Cache - 2026-06-25 - Hub DB integration harness planned and partially implemented

Context spine work is in progress on the local worktree. Investigation and plan docs are present:
`docs/investigations/2026-06-25-context-spine-subagent-audit.md`,
`docs/plans/2026-06-25-context-spine-unification-plan.md`, and
`docs/superpowers/plans/2026-06-25-hub-db-integration-test-database.md`.

Sub-agent-driven DB harness status:
- Complete/reviewed: integration-only CMMS/RLS fixture at `mira-hub/db/integration-fixtures/000_base_cmms_rls.sql`.
- Complete/reviewed: disposable setup script at `mira-hub/scripts/setup-integration-db.mjs`.
- Complete/reviewed: `mira-hub` npm scripts `db:integration:setup` and `test:integration:db`, plus integration test headers.
- Added guarded Doppler-dev runner: `mira-hub/scripts/run-dev-integration-tests.mjs` and `npm run test:integration:dev`.
- Applied contextualization migrations 055/056 to Doppler `factorylm/dev` (guarded to `ep-lingering-salad`); before tables were missing, after `contextualization_projects` and `ctx_import_batches` exist.
- Green against real dev Neon: `doppler run --project factorylm --config dev -- npm run test:integration:dev -- src/app/api/contextualization/import/import.integration.test.ts "src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts"` -> 2 files, 9 tests passed, cleanup ran.
- Full dev integration still fails only on `src/lib/auth/__tests__/rls-deny.integration.test.ts`: shared dev lacks `cmms_areas`/`cmms_sites`, and the integration CMMS fixture assumes UUID `tenants.id` while dev's existing tenant schema is not compatible. Keep this suite on the disposable-branch path.
- Verified: package JSON parses; ESLint passes for touched scripts/tests; setup script refuses missing/unguarded DB env.

---

# Hot Cache - 2026-06-25 - Hub DB integration harness proven on disposable Neon

Continuation result:
- Created disposable Neon branch `br-super-cake-ahzi2o9f` from dev branch `br-fancy-firefly-aha05dz2`; branch was created with an 8-hour expiry.
- Created clean test database `hub_integration_test4` on that branch.
- `npm run test:integration:db` is green from empty schema: setup applied integration fixture plus allowlisted migrations `001`, `010`, `026`, `027`, `029`, `055`, `056`; smoke check passed; Vitest passed 3 files / 17 tests.
- The setup harness intentionally does not replay every Hub migration; earlier full replay failed on unrelated legacy dependencies (`knowledge_entries`, then `work_orders`). The allowlist is the current DB contract for the integration slice under test.
- Fixes made during proof: integration fixture handles missing app tenant settings with `NULLIF(..., '')::uuid`; RLS missing-context test now drops to `factorylm_app`; setup grants `factorylm_app` the KG table permissions needed by contextualization approval publishing.
- Verification after the pass: ESLint on touched DB scripts/tests passed, `package.json` parses, `git diff --check` passed with only normal CRLF warnings.
- Note: Node `pg` emits the current sslmode warning for Neon `ssl=require`; this is a dependency warning, not a test failure.

---
