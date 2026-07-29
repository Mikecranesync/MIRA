# Discovery — Machine Memory → Intelligence Bridge

**Date:** 2026-07-04
**Goal:** Make the live Machine Memory state (tag values, freshness, state, changes, anomalies)
a first-class **intelligence input** to MIRA — so "Ask MIRA" from an asset page reasons from
real machine evidence, not just static asset/document context.

**Method:** four parallel read-only discovery passes (UI, live-state DB schema, Ask-MIRA/engine
evidence flow, anomaly/state machinery + fixtures). This note records what already exists, the
precise gap, and the safest minimal build-on-what-exists path.

---

## 0. Premise corrections (verify-before-build)

> **Branch note (important):** the four discovery passes were run against the working checkout on
> `feat/hub-live-signal-polish`, which is ~11 commits behind `main`. Two of their findings were
> stale-branch artifacts and are **corrected below against `main`** (the branch this work targets).
> Lesson re-learned: verify premises against the branch you build on (`session-discipline.md` §1).

Correcting the task brief AND the stale-branch discovery, against `main`:

| Assumption | Reality on `main` |
|---|---|
| No shared `buildMachineMemoryResponse` builder (stale-branch finding) | **It EXISTS** — `mira-hub/src/lib/machine-memory-response.ts` (`buildMachineMemoryResponse(client, tenantId, id)`) already: resolves `uns_path` (kg_entities bridge) → `fetchMachineMemory` + `fetchLiveSignals` → `formatTagValue` decode → `classifyTagFreshness` → `deriveCurrentState` → returns `MachineMemoryResponse` with `live_tags`, `current_state`, `latest_diffs`, `evidence_window`. **This IS ~90% of the context packet.** |
| No SSE stream (stale-branch finding) | **It EXISTS** — `machine-memory/stream/route.ts`; `MachineMemoryCard.tsx` uses `EventSource` with a 750 ms poll fallback (#2463). |
| We may need a new `machine_events` table | **Do not build one.** `tag_events` (033) is the raw stream; `machine_state_window` (040) + `machine_run`/`run_diff` (038) already hold state windows + typed anomalies. 040's header says "This is NOT a machine_events table." |
| `approved_tags` carries tag meaning | **No.** `approved_tags` (035) is allow/deny only. The meaning map is `tag_entities` (025: `units`, `scaling`, `expected_envelope`, `component_instance_id`) — **not yet wired into the live path**; decode is `gs10-display.ts` for now. |

**Net:** the intelligence primitives largely **already exist** — and on `main`, the per-tag packet is
already assembled by `buildMachineMemoryResponse`. This task is *thin intelligence layer + bridge*,
not *build*. The confirmed gap is: **the asset chat route does not consume the live tag values**
(`approvedLiveSignalCount: 0` is hardcoded; it uses the older `fetchMachineMemory` +
`buildMachineMemorySection`, which omit `live_tags`).

---

## 1. Where Machine Memory gets its data now

### UI
- **`mira-hub/src/components/MachineMemoryCard.tsx`** — holds an `EventSource` to
  `GET /api/assets/{id}/machine-memory/stream` (SSE, #2463) with a 750 ms `GET
  /api/assets/{id}/machine-memory` poll fallback, plus a 15 s `GET /api/assets/{id}/signal-history`
  for sparklines. Renders: a Run pill, a State pill
  (`current_state.state ?? latest_window.state`), a per-tag live-signals grid (value + unit +
  freshness underline + "last seen Xs ago" + sparkline), an anomaly list (`latest_diffs`, deduped,
  with `next_check`), and an evidence line. **Recent-change flashing is client-side only** (diffing
  consecutive polls) — there is no server-side change signal.
- **`mira-hub/src/components/AssetChat.tsx`** — the asset page's **"Ask MIRA"** UI. Calls
  `POST /api/assets/{id}/chat`. Also used by `AssetValidateTab.tsx` (train-before-deploy validation).

### API / shared lib (`mira-hub/src/lib/`)
- **`machine-memory.ts`** — `fetchMachineMemory(client, tenantId, unsPath)` → `{latest_run,
  latest_window, latest_diffs, windows_available}` (reads `machine_run` 038, `machine_state_window`
  040, `run_diff` 038+040; `next_check` pulled from `run_diff.metadata`). `fetchLiveSignals(client,
  tenantId, unsPath)` → live rows from `live_signal_cache` (subtree-scoped by `uns_path <@ ltree`).
- **`machine-current-state.ts`** — pure `deriveCurrentState(latestWindow, freshness)` →
  `{state, since, fresh}` (running/faulted/comm_down/unknown, freshness-aware downgrade).
- **`command-center-freshness.ts`** — pure `classifyTagFreshness` (live/stale/simulated/unknown,
  60 s default window), `rollupFreshness` (subtree roll-up).
- **`gs10-display.ts`** — pure `formatTagValue(tagPath, raw)` → `{display, numeric, unit}`, incl.
  **VFD bitfield decode** (`vfd_status_word`, `vfd_cmd_word` STOP/RUN, `vfd_fault_code`→"OK"/code,
  `vfd_dc_bus`→V, `vfd_frequency`→Hz). Static `SCALE_BY_LEAF` map; the intended DB-driven home is
  `tag_entities.units/scaling` "but nothing writes it yet."
- **Consumers today:** `machine-memory/route.ts` (card), `context/route.ts` (UNS-gate card),
  `chat/route.ts` (asset chat — but **only `fetchMachineMemory`, NOT `fetchLiveSignals`**).
- All Hub reads go through `withTenantContext` (RLS `factorylm_app` role, dual `app.tenant_id` /
  `app.current_tenant_id` setting). Asset→uns_path is resolved via the `kg_entities` bridge
  (`entity_type='equipment'`), never a join (TEXT vs UUID tenant mismatch — see
  `.claude/rules/mira-hub-migrations.md`).

---

## 2. What backend APIs / reasoning already exist

- **Asset chat — `mira-hub/src/app/api/assets/[id]/chat/route.ts`** (self-contained TS; Groq→
  Cerebras→Gemini cascade, **not** the Python engine). Assembles: `cmms_equipment` row + manual
  RAG chunks (`manual-rag.ts`, hybrid `knowledge_entries`) + KG graph context + **machine memory**
  via `buildMachineMemorySection(memory)` (`## Live Machine Memory`, sanitized/capped). **Gap:** it
  injects runs/windows/anomaly-diffs but **not current live tag values**; `approvedLiveSignalCount`
  is hardcoded `0`. **This is the primary bridge target.**
- **General ask — `mira-hub/src/app/api/mira/ask/route.ts`** already reads `live_signal_cache` into
  a `## Current signal state` prompt section (cited `live_signal_cache`). Proves the live-injection
  pattern; not the asset-page surface, but a reference implementation to mirror.
- **Python engine — `mira-bots/shared/engine.py` `Supervisor.process(..., live_tags=…,
  tag_evidence=…)`.** `live_tags` → `_maybe_attach_live_snapshot` → **text preamble baked into the
  message** (gate-safe: only after `asset_identified` + active-diagnostic state). `tag_evidence` →
  **trace-only** (`decision_trace`), never reaches the LLM as structured evidence. The only
  structured evidence type the engine understands is the **RAG chunk dict**
  (`{content, manufacturer, model_number, …}`).
- **Direct-connection surfaces — `mira-pipeline/ignition_chat.py`, `mira-bots/ask_api/app.py`** call
  the Python engine, resolve `uns_source="direct_connection"`, and pass live tags as **text
  preamble only** (`live_snapshot.render_status_block`). `ignition_chat` already enriches with
  `tag_entities` semantics (units/data_type) for the preamble.

---

## 3. The intelligence layer that ALREADY exists (reuse, do not reinvent)

- **`plc/conv_simple_anomaly/rules_core.py`** — deterministic **A0–A12** rule engine:
  `evaluate(snap, derived, cfg) → list[Anomaly]`, each `{rule_id, severity, title, message,
  evidence:[{topic,value}], components, confidence}`. Covers comm-stale (A1), VFD fault (A2, 68
  GS10 codes), e-stop wiring (A3), commanded-but-not-running (A6), freq-not-tracking (A7),
  overcurrent (A8), DC-bus (A9), freq-stuck-zero (A10), photoeye jam (A12). VFD-analog rules are
  **trust-gated** on `vfd_comm_ok`. "**VFD healthy but stopped**" = no anomaly + not-running + cmd
  not a run-value. Vendored byte-identical to the Ignition WebDev endpoint, the Perspective project
  script, and `mira-crawler/run_engine/anomaly_rules.py` (parity-guarded except the last).
- **`mira-crawler/run_engine/`** (Celery worker over `tag_events`):
  - `state_windows.py::classify_state(snap)` → idle/running/faulted/comm_down/estopped/unknown.
  - `historize_machine_memory` orchestrates: segment runs (038) → derive state windows (040) → run
    `rules_core.evaluate()` → persist typed anomalies to `run_diff` (`diff_type='anomaly_<RULE_ID>'`,
    `window_id`, `from_event_id`/`to_event_id`, `metadata.next_check`).
  - `snapshot.py::CV101_TAG_TOPIC_MAP` — maps `normalized_tag_path` (the `approved_tags` key) →
    rules_core topic (`vfd/vfd101/comm_ok`). **The bridge from live_signal_cache paths to rules_core.**
- **`plc/conv_simple_anomaly/context_model.cv101.json`** — human-**approved** tag→signal→component→
  evidence model with an explicit `answer_strategy` for the healthy-but-stopped case and an
  `unmapped` list MIRA must not guess.
- **`mira-bots/shared/live_snapshot.py`** — Python VFD decode + `render_status_block` for engine
  preambles.
- **DB persistence:** `live_signal_cache` (live values + freshness), `machine_state_window` (040),
  `machine_run`/`run_diff` (038/040), `tag_event_diffs` (037), `flaky_input_signals` (034),
  `tag_entities` (025, the meaning map).

**Duplication risk to respect:** VFD fault tables exist in ≥4 places (rules_core 68 codes
authoritative; `live_snapshot.py` 10; `ask_api/machine_context.py` prose; run_engine vendored). **Do
not add a 5th.** The packet must *reuse* decoded output, not re-implement rule logic.

---

## 4. The precise gap

1. **No single normalized "machine context packet"** that unifies live values + decoded meaning +
   current state + freshness + recent-change + active anomalies + evidence refs. The pieces are
   scattered across `machine-memory/route.ts` (inline) and three ad-hoc consumers.
2. **The asset-page Ask MIRA can't see current live tag values.** `chat/route.ts` calls
   `fetchMachineMemory` but not `fetchLiveSignals`, so "why is this machine stopped?" has no VFD tag
   values, only persisted run/anomaly rows.
3. **No on-demand condition summary.** `rules_core` output only reaches the Hub if the Celery worker
   already historized it into `run_diff`; there's no cheap "here's the current condition from the
   live snapshot" surfaced at question time.
4. **On the Python engine, live tags dead-end** (text preamble / trace-only), never structured
   citable evidence.

---

## 5. Safest minimal integration path (the plan)

**Build location: Hub / TypeScript (Command Center), not the Python engine — for this PR.**
Rationale: (a) *train-before-deploy* doctrine puts validation in the Command Center (`mira-hub`),
which is exactly the asset-page "Ask MIRA" surface; (b) `chat/route.ts` is self-contained TS and
already has the `buildMachineMemorySection` pattern to mirror; (c) every pure builder primitive
(`fetchLiveSignals`, `deriveCurrentState`, `classifyTagFreshness`, `formatTagValue`) is already TS
with unit tests; (d) it avoids the heavier/riskier engine evidence-contract change and a 5th copy of
`rules_core`. The Python-engine structured-live-evidence work is the documented **next PR**.

### Phase 2 — the context packet, built ON `buildMachineMemoryResponse`
Two new files, both deterministic / no LLM:
- **`mira-hub/src/lib/machine-context-intelligence.ts`** — a PURE function
  `deriveContextIntelligence({machine_state, live_tags, latest_diffs, nowMs, recentChangeWindowS})`
  → `{ summary, active_conditions, changed_recently }`. No DB, no framework → fully unit-testable.
  This is the only genuinely new logic; it *composes* the already-decoded `live_tags` +
  `current_state` + `latest_diffs` (which are `rules_core` output persisted in `run_diff`) into a
  normalized inferred-condition view. It never re-implements the A0–A12 rules.
- **`mira-hub/src/lib/machine-context-packet.ts`** — `buildMachineContextPacket(client, tenantId,
  assetId)` = call the existing `buildMachineMemoryResponse` (reuse), run `deriveContextIntelligence`
  over its output, and return the normalized packet. Thin DB wrapper around the pure core.

Packet shape:
```
{
  asset_id, uns_path, tenant_id,
  machine_state: { state, since, fresh },              // deriveCurrentState
  freshness: { overall, live_count, stale_count },     // rollupFreshness + counts
  live_tags: [{ tag_path, label, value, display, unit, numeric, freshness,
                last_seen_at, last_changed_at, changed_recently }],
  active_conditions: [{ rule_id?, severity, title, tag_path, next_check,
                        evidence_event_ids }],          // from run_diff (rules_core output)
  evidence: { window, event_refs },                     // from evidence_window + diff anchors
  summary: <deterministic one-liner>                    // see below
}
```
`summary` is a **deterministic template**, NOT a re-implementation of the 12 rules: keyed on
`machine_state` + `active_conditions.length` + the already-decoded VFD signals in `live_tags`. E.g.
stopped + 0 active conditions + `vfd_fault_code`=OK + `vfd_comm_ok` live →
*"Machine stopped; no active fault detected (VFD comms OK, fault OK, DC bus present, 0 Hz output).
Likely command/permissive/interlock — not a drive fault."* This composes existing decoded output +
persisted anomaly presence; it never forks the rule engine.

### Phase 3 — bridge into `/api/assets/[id]/chat/route.ts`
Add `buildLiveEvidenceSection(packet)` next to `buildMachineMemorySection`, spliced into the system
prompt with a **`## LIVE MACHINE EVIDENCE (observed now)`** block (current tag values + decoded
meanings + `machine_state` + `active_conditions` + freshness), sanitized/capped exactly like the
machine-memory section. Prompt instructs MIRA to separate **live evidence / asset+doc context /
inference / recommended next checks**. Set `approvedLiveSignalCount` from the packet.

### Phase 4 — persistence (document the gap, do not build)
State windows + typed anomalies **already persist** via the `run_engine` worker; `decision_trace.py`
already records what evidence a turn had. Persisting *Ask-MIRA diagnostic snapshots* as a durable
record is **deferred to a follow-up** (would touch `decision_trace` / a new small table). No new
table in this PR.

### Phase 5 — minimal UI
Surface the packet's deterministic `summary` (inferred condition) on `MachineMemoryCard.tsx` and make
the existing "Ask MIRA" affordance carry live context. Keep it to a few lines — the loop is proven
server-side; do not redesign the card.

### Phase 6 — tests (pure, deterministic, no live DB)
1. Packet built from injected live-signal rows → `live_tags` populated.
2. Known tags → meaning (`formatTagValue` unit/display + VFD decode).
3. Stale tag flagged (old `last_seen_at` → `freshness="stale"`).
4. **VFD-healthy-but-stopped** → correct `machine_state="idle/stopped"` + empty `active_conditions` +
   the healthy-but-stopped `summary` (mirror the golden healthy snapshot: freq=30=sp, 0.6 A, 320 V,
   cmd=STOP, fault=0 from `tests/regime7_ignition/test_diagnose_parity.py`).
5. Ask MIRA path includes the packet (`buildLiveEvidenceSection` output present in the assembled
   prompt).
6. **No tag write path introduced** — builder + route are read-only (SELECT only); assert no
   INSERT/UPDATE to `tag_events`/`live_signal_cache`.

---

## 6. Risky assumptions / things to watch

- **UNS path inconsistency (real risk).** The relay/ingest side seeds garage CV-101 as
  `enterprise.home_garage.conveyor_lab.conveyor_1`, but the context-model/Litmus side uses
  `enterprise.garage.demo_cell.bottling_demo.cv_101`. The packet resolves `uns_path` from
  `kg_entities` (same bridge the card uses), so it will match whatever the card matches — but a
  test/fixture must use the **same** path the live rows carry, or `fetchLiveSignals` returns `[]`.
- **Component-level UNS granularity is not in the seeds yet** — `approved_tags_conveyor.sql` points
  every tag at one flat asset node; per-component (`gs10_vfd`/`micro820_plc`) mapping is a known
  follow-up. So "related component context (VFD/motor/photoeye/interlock)" comes from *tag-name
  decode* (`gs10-display.ts` / `signal_roles.py`) for now, not from UNS structure.
- **`tag_entities` is the right long-term meaning source but is unpopulated in the live path.** The
  packet uses the static `gs10-display.ts` decode for now (matches current card behavior); wiring
  `tag_entities.units/scaling` is a follow-up, not this PR.
- **Do not reintroduce a rules_core fork.** The packet reuses persisted `run_diff` anomalies +
  decoded values; on-demand `rules_core.evaluate()` from TS is impossible (Python) and a TS re-impl
  would be the 5th copy. If on-demand evaluation is wanted, it belongs in the Python-engine follow-up
  or a `run_engine` call, not a TS reimplementation.
- **`current_state` trusts a closed window only while freshness is live** (`deriveCurrentState`
  downgrades to `comm_down` when stale). The packet inherits this; a stale asset will read
  `comm_down`, which is correct behavior, not a bug.

---

## 7. Deliverables for the PR

1. This discovery note.
2. `buildMachineContextPacket` (deterministic TS builder) + its tests.
3. `buildLiveEvidenceSection` bridge into the asset-chat route + test that the packet reaches the
   prompt.
4. Minimal `MachineMemoryCard` surface for the inferred condition summary.
5. Persistence gap documented (§4 Phase 4).
6. PR summary: what was connected (live tag values → packet → asset-chat MIRA prompt), what live
   evidence MIRA now receives, what remains (Python-engine structured evidence; `tag_entities`
   meaning wiring; per-component UNS; Ask-MIRA snapshot persistence).
