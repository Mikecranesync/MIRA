# ProveIt 2027 — Contextualized Factory Implementation Plan (Northstar-aligned)

> Source of truth for this plan: `northstar_prompt.txt` (2026-06-22). This plan turns that
> brief into a token-efficient, subagent-driven, phased build. Companion docs:
> `docs/plans/2026-06-22-simlab-industrial-flight-simulator-assessment.md` (architecture verdict),
> `docs/plans/2026-06-22-proveit-factory-import-implementation-plan.md` (import engine),
> the SimLab platform-oracle PRD, and the mandatory `/discovery_corpus/` (Discovery Recorder).

## Mission (verbatim intent)

A factory should not need months of engineering to become AI-ready. **FactoryLM reconstructs
industrial context directly from evidence already in the plant** (PLC exports, schematics, manuals,
nameplate/cabinet photos, tag DBs, alarm lists, OEE/MES exports, CMMS, procedures, maintenance
history). **MIRA uses that context to answer, diagnose, and assist — grounded in evidence, not
generic LLM reasoning.**

**Primary demo goal:** an Ignition Perspective HMI **"Ask MIRA"** button. User asks *"Why is this
line blocked?"* MIRA answers from contextualized evidence: asset, equipment hierarchy, relevant
tags, state transitions, manual citations, wiring references, known failure modes, recommended
technician actions.

## Operating principles (non-negotiable, from the brief)

1. **Code-first interrogation.** Every dataset is interrogated by **deterministic code first, LLM
   second.** Every investigation is recorded; every discovery becomes reusable code in
   `/discovery_corpus/`. (Discovery Recorder is MANDATORY.)
2. **Cappy is evidence, not the factory.** We discover its layer (MES/OEE/Production/State), its
   asset-hierarchy clues, and its hidden maintenance implications with automatic, deterministic
   workflows.
3. **Synthesizer-first.** Build a **deterministic Python factory synthesizer**, NOT 15 soft PLCs.
   Soft-PLC (OpenPLC/Modbus/OPC-UA) is a later **realism-only** track (Phase 6), not core.
4. **Hidden-cause maintenance layer.** Every synthesized event (blocked/starved/downtime/alarm)
   sits on a **hidden component cause** (failed sensor, jammed conveyor, VFD fault, motor overload,
   air-pressure fault, comms failure, interlock failure). That hidden layer is what MIRA diagnoses.
5. **Deterministic + replayable** everywhere (seeded; wall-clock only paces *when* ticks fire).
6. **Read-only OT.** No real PLC writes ever; the only "write" is a fault command into the *sim*.
   Licensed Cappy corpus is **never committed** — code + tests run on the synthetic mini fixture
   (`mira-plc-parser/tests/fixtures/ignition_cappy_hour_mini.json`).

## Subagent execution model (how this plan stays token-efficient)

The main loop holds only the plan + integration state; **file-heavy work is delegated**.

- **Per phase:** one or more **builder** subagents author code/tests; one **verifier** subagent
  adversarially reviews + runs the suite. Findings (counts, file lists, test lines) come back as
  short structured results — never file dumps.
- **Fan-out:** independent tasks within a phase run as a `parallel`/`pipeline` of subagents.
  Hand each subagent the *verified findings it needs* so it never re-derives (as Phase 0 did).
- **Integration:** the main loop wires module boundaries, commits, and runs the gate.
- **Verification gate** between phases: tests green + ruff clean + a verifier sign-off before the
  next phase starts. Evidence beats assertion.

## Architecture (target)

```
 EVIDENCE (Cappy export, manuals, specs, CMMS)
   │  Phase 0–1: deterministic interrogation + context reconstruction
   ▼
 CONTEXT MODEL  ── asset graph · UNS mappings · MES/OEE entities · signal archetypes
   │  Phase 2: synthesizer drives the model
   ▼
 SYNTHESIZER (deterministic)  ── production runs · counts · OEE · blocked/starved · downtime · alarms · states
   │        each surface event ⇒ HIDDEN component cause (Phase 2/3 maintenance layer)
   ▼
 LIVE FEED  ── per-line publishers → Mosquitto (MQTT) ; fault injection in (Phase 4)
   │
   ▼
 MIRA  ── reads live state + maintenance graph + cited evidence → grounded answer (Phase 5)
   │
   ▼
 IGNITION PERSPECTIVE "Ask MIRA"  ── "Why is this line blocked?"  (PRIMARY DEMO GOAL)
```

Code home: extend **`simlab/`** with a new decoupled `simlab/factory/` subpackage (per the
flight-sim assessment verdict — extend SimLab, add ONE Mosquitto, adopt no heavy platform). The
deterministic juice-bottling core and the parser stay untouched (parser is consumed read-only via
its i3x/JSON export).

---

## Phases

Each phase: **Goal → Tasks (subagents) → Deliverables → Acceptance → Success-criteria (SC#)**.

### Phase 0 — Discovery corpus + Cappy interrogation  `[SC 1,2]`  ✅ DONE (executable, not just docs)
**Goal:** stand up the mandatory Discovery Recorder as **executable, repeatable** infrastructure —
every useful discovery becomes deterministic code, a fixture, a test, a reproducible claim, and a
recorded session (with failed hypotheses).
- **Deliverables:** `/discovery_corpus/{sessions,playbooks,scripts,tests,fixtures,reports}` +
  `EVIDENCE_TYPES.md` (5 evidence classes) + `run_phase0.py` (one-command gate) + `make discovery-phase0`.
  - `scripts/interrogate_ignition_export.py` — deterministic interrogator: topology, area→line→asset
    hierarchy, signal-archetype histogram, discrete-vs-continuous family, **`assess_claims()` → 5
    reproducible claim verdicts (C1–C5)**.
  - `fixtures/synthetic_factory_export.json` — synthetic stand-in mirroring the real MES-UDT shape
    (fictional names/values); exercises every archetype + both families.
  - `tests/test_interrogate_ignition.py` — **18 pytest** re-deriving the taxonomy + the 5 claims +
    determinism. `reports/phase0_synthetic.{md,json}` — generated report.
  - `playbooks/`: `classifying-an-unknown-dataset-layer.md` (general) +
    `interrogating-ignition-mes-exports.md` (worked example).
  - `sessions/2026-06-22-session-001-…md` — full record incl. **failed hypotheses** H1–H5.
- **Reproducible claims (each backed by an executable check + test):** C1 MES/OEE-shaped not
  PLC-control · C2 has production counts + state · C3 implies asset/line/cell hierarchy · C4 no
  ladder/ST/control logic · C5 usable as upstream evidence for hidden maintenance causes.
- **Acceptance (one command, exits nonzero on failure):** `python discovery_corpus/run_phase0.py`
  (or `make discovery-phase0`) → interrogate synthetic fixture → write report → run pytest → all 5
  claims PASS + 18 tests green + 0 parser warnings. **No licensed evidence committed.**
- **Verified findings (feed every later phase):** layer = **Sepasoft MES-OEE UDT**; 4090 nodes ≈ a
  few hundred live values + static metadata; families **discrete-MES** / **continuous-process**;
  archetypes `static_metadata · live_bool · live_counter · live_state · live_analog`.

### Phase 1 — Evidence → contextual model → UNS draft → approval-ready suggestions  `[SC 2,3,4,5]`  ✅ DONE
**Higher goal (proven this phase):** `evidence export → contextual factory model → UNS draft →
approval-ready suggestions`. Built as a clean **`factory_context/`** package (synthesizer-free; the
simulator stays out of Phase 1). The model is **evidence- and approval-centric**, not a bare asset/tag
store.
- **Deliverables:** `factory_context/{model,build,uns_draft,report,run_phase1}.py` + `tests/` +
  generated `reports/phase1_context_model.{md,json}` + `reports/uns_draft.json`; `make context-phase1`.
  - **`model.py`** — every entity/signal/relationship is a `Suggestion` preserving **source evidence,
    confidence (high/medium/low/review), why it exists, the human approval needed, and status
    (suggested/approved/rejected/needs_review)**. `evidence_violations()` enforces *no fact without
    evidence*.
  - **`build.py`** — confidence policy: structural entities + `contains` = HIGH/suggested; inferred
    signal role = MEDIUM/suggested; **inferred `feeds` (upstream→downstream) + the cell layer =
    LOW/needs_review** (export order ≠ physical flow; no cell in evidence). Reuses Phase 0's
    `classify_signal` + the parser's `slug`/`Provenance`.
  - **`uns_draft.py`** — slugged UNS paths for enterprise→asset + categorized live signals
    (`live_bool`→`status`, `live_counter`→`production`, `live_state`→`status`, `live_analog`→`process`).
- **Honesty guarantee:** the machine **never auto-approves** (status is suggested/needs_review only);
  uncertain mappings are flagged, not asserted. Enforced by tests + the gate.
- **Acceptance (one command, nonzero on failure):** `python factory_context/run_phase1.py` (or
  `make context-phase1`) → runs Phase 0 → builds the model → writes the UNS draft + report → runs
  **15 Phase 1 tests** → enforces 0 facts-without-evidence + the success condition. Phase 0 (18) +
  Phase 1 (15) green; ruff clean. **No licensed evidence committed.**
- **Discovery Recorder:** session-002 (with failed hypotheses H1–H5) + the fixture extension
  (`CapLoader01` upstream of `Filler01`).
- **Note:** the `topics.py` UNS↔MQTT map moves to Phase 4 (it is a live-feed concern, not a
  contextualization one).

### Phase 2 — Deterministic maintenance-causality engine  `[SC 5,6,7 + the product]`  ✅ DONE
**Re-scoped (Mike, 2026-06-22): simulate CAUSES, not machines.** The product is MIRA's *explanation*,
not the simulation. The simulator is just a machine that creates realistic symptoms; the maintenance
layer is the actual product. Built as a clean **`causality/`** package on top of the Phase 1 model —
it never invents a factory. **No value-simulator runtime, no MQTT/broker/PLC/protocol.**
- **Deliverables:** `causality/{failure_modes,components,knowledge,explain,answer,run_phase2}.py` +
  `fixtures/maintenance_knowledge.json` + `tests/` + generated `reports/phase2_explanation_*.md`;
  `make causality-phase2`.
  - **`failure_modes.py`** — the 8 hidden causes (photoeye blocked, conveyor jam, VFD not enabled,
    motor overload, sensor drift, low air, failed interlock, comm loss); each = a **causal chain**
    (cause → effects → observable MES symptom) + symptom(s) + supporting-tag roles.
  - **`components.py`** — inferred component sublayer (photoeye/vfd/motor/sensor/…) under the Phase 1
    assets via **generic binding** by asset class; components are `needs_review` suggestions with
    evidence (not asserted — they aren't in the export).
  - **`explain.py`** — `inject` (forward: create symptoms, ground truth) + `explain` (reverse: **ranked
    likely causes**, each with chain + supporting tags + manual citations + technician checks) +
    `score` (top cause == injected). Output is **ranked hypotheses**, never "the cause".
  - **`fixtures/maintenance_knowledge.json`** — synthetic, citable manual pages + checks per mode.
- **Flagship (the magic):** inject photoeye-blocked on the conveyor → *"why is this line blocked?"* →
  MIRA's top cause = **photoeye on Conveyor01 (high)** + chain + tags + manuals + checks; #2 conveyor
  jam. Breadth: sensor drift on a tank → quality reject → top cause = sensor drift (proves generic
  binding).
- **Acceptance (one command, nonzero on failure):** `python causality/run_phase2.py` (or
  `make causality-phase2`) → runs Phase 1 → builds the causality model → runs both scenarios (top
  cause must match injected) → writes the Ask-MIRA answer → runs **9 tests** → enforces 0
  facts-without-evidence. Phase 0 (18) + Phase 1 (15) + Phase 2 (9) green; ruff clean. No licensed
  evidence committed.
- **Discovery Recorder:** session-003 (failed hypotheses H1–H5: simulator-not-product, signature-tag
  discrimination, ranked-not-asserted, components-inferred-not-fact, generic-binding-needed).
- **Note:** a *value* synthesizer (counters climbing, analog drift over time) is **deferred** — it is
  only needed once we drive live values (Phase 4). Phase 2 needs only the symptom→cause mapping.

### Phase 3 — Evidence grounding & explainability ("How do you know?")  `[SC 5,6,7]`  ✅ DONE
**Goal:** auditable reasoning — every Ask-MIRA answer exposes its **evidence chain** (supporting AND
contradicting), with citations. Built as a clean **`evidence_graph/`** package on Phases 0–2. Strictly
brain-side: **no MQTT/Sparkplug/OPC-UA/Modbus/Ignition/broker/live pipeline/PLC sim.**
- **Deliverables:** `evidence_graph/{models,citations,failure_library,history,procedures,builder,explainer,reports,run_phase3}.py`
  + `fixtures/{maintenance_history,procedures}.json` + `tests/` + `reports/phase3_explanation_report.{md,json}`;
  `make explainability-phase3`.
  - **`models.py`** — the evidence graph (Cause→Asset→Signal→UNS→Manual→Procedure→Historical Event→
    Failure Mode→Technician Action). **No anonymous facts:** every node carries source + evidence_ref +
    confidence + approval status; `violations()` enforces it.
  - **`explainer.explain_cause()`** — reads receipts from the graph: ranked hypotheses, each with
    supporting evidence (tag/asset/manual/history) **and contradicting evidence**, citations, recommended
    checks + procedures. Contradicting evidence **lowers confidence**.
  - **`citations.py`** — typed evidence (`[Tag]/[Asset]/[Manual]/[Procedure]/[History]/[Fixture]`).
  - **`failure_library.py`** — known-failure-mode library (Phase 2 catalog + contradicting roles +
    procedures + history key). **`history.py`** — synthetic maintenance history (the CMMS bridge).
  - **`answer_card.py`** (trust checkpoint before Phase 4) — the plain-language Ask-MIRA **answer card**:
    9 fields (most likely cause · confidence · why · evidence for · evidence against · manuals/procedures ·
    similar history · technician checks · **what needs human review**), friendly tag names, readable with
    no one explaining it. Emitted as `reports/phase3_answer_card.md`; the gate enforces all 9 sections.
- **Flagship answer (receipts):** photoeye-blocked on the conveyor → *"why is this line blocked?"* →
  **Photoeye blocked (High)** + Tag (PhotoeyeBlocked=TRUE, counts dropped to 0/min, State=Down) + Asset
  (hosts photoeye; feeds CapLoader01) + Manual (O&M p.42, p.11) + History (3×, last: cleaned lens) +
  checks + procedure. Contradiction demo: counts still rising → confidence **High→Medium** + *Evidence
  AGAINST*.
- **Acceptance (one command, nonzero on failure):** `python evidence_graph/run_phase3.py` (or
  `make explainability-phase3`) → Phase 2 (→1→0) → build graph → flagship + contradiction explanations →
  write report → **15 tests** → fail on unsupported claims / missing citations / non-determinism /
  evidence-graph violations. Phase 0 (18)+1 (15)+2 (9)+3 (15) green; ruff clean. No licensed evidence.
- **Discovery Recorder:** session-004 (failed hypotheses H1–H5: score-isn't-trust, contradicting-evidence,
  graph-is-the-source, no-anonymous-facts, history-now).

### Phase 4 — MQTT nervous system (transport preserves explainability)  `[SC 9/10 transport]`  ✅ DONE
**Re-scoped (Mike, 2026-06-23): the narrowest possible nervous-system path — MQTT is ONLY transport.**
Prove a deterministic event can travel through MQTT on a UNS topic and produce the **identical**
evidence-backed answer card. Built as `mqtt_uns/` on Phases 0–3; the brain is unchanged. **No Ignition/
OpenPLC/Modbus/OPC-UA/Sparkplug/PLC sim/historian/CMMS/dashboard/web UI/broker clustering.**
- **Transport decision:** an **in-process broker** (`broker.InMemoryBroker`) with real MQTT `+`/`#`
  topic semantics — deterministic, offline-testable; the same `Transport` seam accepts a real
  paho/aiomqtt client later with zero brain changes. (No external Mosquitto required for the gate.)
- **Deliverables:** `mqtt_uns/{schemas,broker,topics,publisher,subscriber,event_bridge,mqtt_reports,replay,run_phase4}.py`
  + `tests/` + `reports/{phase4_mqtt_report,phase4_replay_validation}.{md,json}`; `make mqtt-phase4`.
  - **`schemas.MaintenanceEvent`** — deterministic JSON carrying only the *observation* (type + UNS +
    abnormal/healthy signals); the subscriber re-runs the SAME `explain_cause` (the wire never carries
    the answer).
  - **`event_bridge`** — `event_from_scenario` (Phase 2→wire) / `observation_from_event` (wire→Phase 3) /
    `explain_event` (→ answer card). The only module that touches the brain.
- **Flow:** Phase 2 event → publish (UNS topic `…/conveyor01/events`) → subscribe → bridge →
  Phase 3 `explain_cause` → answer card == the offline + committed Phase 3 card, byte-for-byte.
- **Replay validation:** `phase4_replay_validation.{md,json}` — **420 replays** across fault types/assets/
  contradiction cases: **answer-card consistency 100%, determinism 100%, citation completeness 100%**,
  0 transport failures, 0 mismatches. Cause accuracy (37%) is **measured, not gated** (engine
  discriminability on the sparse fixture; both paths agree, so the card still survives transport).
- **Acceptance (one command, nonzero on failure):** `python mqtt_uns/run_phase4.py` (or `make mqtt-phase4`)
  → Phase 3 (→2→1→0) → round-trip flagship + contradiction → replay → message determinism → **13 tests**.
  Fails on transport failures / answer-card mismatches / unsupported claims / missing citations /
  non-determinism / evidence-graph violations. Phase 0 (18)+1 (15)+2 (9)+3 (21)+4 (13) = **76 tests**
  green; ruff clean; no licensed evidence.
- **Discovery Recorder:** session-005 (failed hypotheses H1–H4: in-process-broker-suffices, wire-carries-
  observation-not-answer, contradiction-must-keep-support, cause-accuracy-is-not-a-transport-metric).

### Phase 5 — Ask MIRA grounded answer + Ignition Perspective  `[PRIMARY GOAL; SC 6,7,8,10]`
**Goal:** *"Why is this line blocked?"* answered live, grounded, inside Ignition.
- **Tasks / subagents:** `[builder-A]` ingest path: read-only MQTT subscriber → topic→UNS normalize → `live_signal_cache` (the `source=direct_connection` certified surface). `[builder-B]` wire MIRA: live state + maintenance graph + evidence packet → grounded answer (the 8 fields); score against Phase-2 ground truth via the SimLab evaluation service. `[builder-C]` Ignition Perspective "Ask MIRA" panel calling `mira-pipeline /api/v1/ignition/chat` with the asset-bound UNS context (per `direct-connection-uns-certified.md`). `[verifier]` end-to-end: inject hidden cause → ask "why blocked?" → answer names the right asset + cause + cites evidence + ≥4/5 grounded.
- **Deliverables:** subscriber + normalizer, MIRA wiring, Perspective panel, e2e scored test, demo runbook (the 20-min arc).
- **Acceptance:** the demo question returns a grounded, cited answer identifying the hidden root cause and recommended action; scored pass via the eval service; screenshots saved to `docs/promo-screenshots/`.

### Phase 6 — (future) Soft-PLC showcase line  `[realism only — NOT core]`
**Goal:** one line on **OpenPLC + Modbus + OPC-UA** as a realism demonstration. Deferred until the
synthesizer demo passes. Explicitly out of the critical path per the brief.

---

## Success-criteria traceability (brief §SUCCESS CRITERIA 1–10 → phase)

| # | Criterion | Phase |
|---|---|---|
| 1 | Ingest industrial evidence | 0, 3 |
| 2 | Reconstruct factory context | 0, 1 |
| 3 | Build an asset graph | 1 |
| 4 | Build UNS mappings | 1 |
| 5 | Build maintenance relationships | 1, 3 |
| 6 | Explain failures | 3, 5 |
| 7 | Cite evidence | 3, 5 |
| 8 | Drive Ask MIRA responses | 5 |
| 9 | Deterministic replayable simulations | 2, 4 |
| 10 | Live contextual intelligence in Ignition | 5 |

## Guardrails

- `simlab/` core + `mira-plc-parser` untouched (new `simlab/factory/` subpackage; parser consumed
  read-only via its export). Additive — no churn to the simlab/parser test baselines.
- Deterministic + LLM-free synthesizer; licensed corpus never committed; tests on the mini fixture.
- Read-only OT; MQTT publish-out + sim-only fault commands; no real PLC writes.
- Every discovery → reusable code + a recorded `/discovery_corpus/` session (mandatory, ongoing).
- Doppler for any secrets; local-only `docker-compose.simfactory.yml` (never the prod VPS).

## Status

- **Phase 0:** seeded this session (worktree `feat/cappy-northstar-factory`).
- **Phases 1–5:** specified above; execute phase-by-phase with the builder+verifier subagent model
  and a green-gate between phases.
- **Phase 6:** deferred (realism track).
