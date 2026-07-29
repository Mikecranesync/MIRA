# SimLab Platform Oracle — Phased Implementation Plan (ProveIt 2027)

> **Drives:** `docs/product/simlab-platform-oracle-proveit-prd.md` (the authoritative PRD).
> **Branch:** `feat/simlab-platform-oracle` (off `main`; worktree `../mira-simlab`).
> **Execution model:** each phase runs as a **builder sub-agent** (writes code + tests) followed by an
> **adversarial reviewer sub-agent** (read-only, checks the phase's risk list), then a human-run
> **verification gate** before the next phase. Phases P1/P2/P3 are independent of each other and can run
> concurrently (isolated worktrees) once **P0** lands. Grounded in the 2026-06-21 read-only scout
> reports (CI, beta-gate, conformance, parser-bridge) — file paths below are verified, not guessed.

## North Star (from the PRD)

End state: *"A stranger uploads industrial information and MIRA produces a cited diagnosis that can be
objectively scored against known truth."* SimLab is the **oracle** that holds, per scenario: expected
asset · root cause · evidence · citations · corrective actions · UNS mappings — and grades every layer
against them.

## Objective → Phase map

| PRD Objective | Deliverable | Phase |
|---|---|---|
| **5** CI Validation | SimLab CI Pipeline | **P0** (foundation) |
| **1** Mandatory eval layer | SimLab Evaluation Service | **P1** |
| **2** End-to-end Beta Gate | Beta Gate Harness | **P2** |
| **3** Parser ↔ SimLab | Parser → IR → SimLab Bridge | **P3** |
| **4** Difficulty framework | Scenario Mutation Engine | **P4** |
| (cross-cutting) | Cross-surface UNS conformance | **P2b** (folds into P1/P2) |
| ProveIt demo surface | Live self-scoring dashboard | **P5** |

---

## P0 — SimLab CI Pipeline *(Objective 5; foundation, do first)*

**Goal:** the deterministic, no-LLM grader runs on every PR; regressions block merge. Nothing else is
trustworthy until this exists.

- **Tasks:** add a `simlab-gate` job to `.github/workflows/ci.yml` (mirror `test-eval-offline`); add
  `tests/simlab/test_grader_gate.py` parametrized over scenarios A–F asserting `assemble_evidence()`
  surfaces abnormal tags + `grade()` passes the labeled answer; emit a machine-readable JSON scorecard
  artifact.
- **Gate:** job green on a clean runner; all 6 scenarios graded; <10s; no secrets.
- **Risks (reviewer):** run from **repo root** (import path — `simlab/` has no pyproject); install
  **only** pytest+pyyaml (**never chromadb** — it shadows `mira-bots/shared`); confirm no Doppler/broker.
- **Deps:** none. **Infra:** pure-offline (CI-safe today).
- **Evidence anchors:** `simlab/diagnostic.py` (`grade`, `assemble_evidence`), `tests/simlab/test_juice_bottling.py`,
  `.github/workflows/ci.yml` (`test-unit`, `test-eval-offline` job patterns).

## P1 — SimLab Evaluation Service *(Objective 1)*

**Goal:** a reusable scenario runner + scoring interface so *any* component is measured against
SimLab ground truth with one call, deterministically.

- **Tasks:** factor the scorecard out of `tests/simlab/runner.py` into a reusable
  `simlab/evaluation.py` (`run_scenario(scenario, answer_fn) -> ScenarioScore`) exposing the five
  graded dimensions (root-cause, evidence recall, citation, asset, corrective-action) + overall;
  stable JSON + markdown emitters; thread the real-Supervisor path (`tests/simlab/runner.py`,
  `juice_runner_adapter.py`, `source="direct_connection"`) behind the same interface as a deterministic
  stand-in. **No new answer logic — it scores, it does not answer.**
- **Gate:** the same `ScenarioScore` shape works for (a) a deterministic mock answerer (CI) and (b) the
  real Supervisor (staging, Doppler); identical scorecard schema.
- **Risks (reviewer):** keep `simlab/` LLM-free + deterministic; the real-Supervisor path stays
  staging-only (needs Doppler) and never blocks PR CI.
- **Deps:** P0. **Infra:** mock path offline; real path staging.

## P2 — Beta Gate Harness *(Objective 2; highest strategic value)*

**Goal:** "upload a manual → get a cited answer, scored against truth" as a deterministic test using
SimLab's 77 synthetic docs + scenario `expected_citations`.

- **Tasks:** `tests/beta/simlab_gate_harness.py` — seed a scenario's docs into `knowledge_entries`
  (reuse `tools/seeds/seed-simlab-docs.py` chunker) under a test tenant → `recall_knowledge()` on
  `scenario.question` → **deterministic mock answerer** that emits retrieved chunks with `[Source: …]`
  → score with the P1 service (assert `expected_citations ⊆ cited` + content). Parametrize A–F. Optional
  real-LLM variant behind a `network` marker.
- **Gate:** all 6 retrieve + cite their expected docs with the **mock** answerer (zero variance).
- **Risks (reviewer):** do **not** route around the real upload→retrieval gap — seed via the *same*
  `knowledge_entries` path retrieval reads (the #1592 / migration-049 path), not Open WebUI KB; needs
  NeonDB + `nomic-embed-text` (ephemeral-pg + local embed, or `network` mark).
- **Deps:** P0, P1. **Infra:** DB + embeddings (or marked).
- **Evidence anchors:** `tests/beta/beta_ready_upload_retrieval_citation.py`, `mira-bots/shared/neon_recall.py`
  (`recall_knowledge`), `tools/seeds/seed-simlab-docs.py`, `simlab/docs/<asset>/*`.

### P2b — Cross-surface UNS conformance *(cross-cutting; folds in here)*

One scenario → every ingestion surface → **identical UNS evidence.** `tests/simlab/test_cross_surface_conformance.py`:
InMemoryPublisher golden → RelayIngest (in-memory `InMemoryTagStore` + allowlist) → MQTT topic
round-trip (`to_mqtt_topic`/`from_mqtt_topic`) → Ignition `IgnitionChatRequest`
(`asset_context`→`resolve_uns_path`, assert `source="direct_connection"`, gate **skipped not
downgraded**). Fully mocked, no broker/secrets. Protects `.claude/rules/direct-connection-uns-certified.md`.

## P3 — Parser → IR → SimLab Bridge *(Objective 3; connects to the PLC-parser work)*

**Goal:** test the full **train (parse) → deploy (read live) → diagnose** arc against ground truth.
~70% of the plumbing already exists (`vqt_attach.attach_values(by="name")` is the live-value join seam).

- **Tasks:** `tests/simlab/parser_bridge.py` — `assetmodel_to_csv_export()` (SimLab `TagDef` → parser
  CSV), `reconcile_namespace()` (pass `simlab.uns.asset_path()` as the parser's `namespace_root`; match
  on slugged leaf name), `snapshot_to_readings()` (→ `vqt_attach.Reading`). Then
  `tests/simlab/test_parser_simlab_arc.py` over `vfd_motor` + `bottle_filler`: IR tags ⊇ SimLab tags,
  `vfd_signal_candidates` label `vfd_speed_hz`→frequency / `motor_current_amps`→current_a, VQT lights up
  from a 120-tick snapshot, and Supervisor diagnosis passes `grade()`.
- **Gate:** arc green for ≥2 baselines; VFD-signal classification matches SimLab's known roles.
- **Risks (reviewer):** **no SimLab import or canonical-UNS logic into `mira-plc-parser/`** (stays
  stdlib/read-only/UNS-agnostic per `i3x.py` doctrine); **no LLM/parser dep into `simlab/`**; don't bolt
  baselines onto the IR; target the `simlab/` package, not the `tests/simlab/` YAML system; preserve
  `source="direct_connection"`.
- **Deps:** P0 (parallel with P1/P2). **Infra:** offline (mock answerer) + staging (real Supervisor).
- **Evidence anchors:** `mira-plc-parser/mira_plc_parser/{ir,analyze,i3x,vqt_attach,correlate}.py`,
  `simlab/{uns,models}.py`, `simlab/baselines/{vfd_motor,bottle_filler}.py`,
  `tests/simlab/juice_runner_adapter.py` (reuse, don't reinvent).

## P4 — Scenario Mutation Engine *(Objective 4; robustness curve)*

**Goal:** measure *how MIRA degrades under stress*, not just pass/fail.

- **Tasks:** mutators over the deterministic scenario model (shift onset tick, inject a red-herring
  abnormal, dual simultaneous faults, vary noise seed, cascade depth) feeding the existing reasoning
  checkpoints (`cp_no_premature_blame`, `cp_isolation_evidence`, `cp_no_cross_component_confusion`) →
  a difficulty-curve scorecard via the P1 service. A **completeness-critic** sub-agent audits which MIRA
  surfaces still lack a SimLab regression.
- **Gate:** reproducible difficulty curve; critic gap-list triaged.
- **Deps:** P0–P3.

## P5 — Live self-scoring dashboard *(ProveIt demo surface; Must-Have)*

**Goal:** the on-stage surface where an attendee uploads → triggers a fault → asks MIRA → sees evidence
+ citations → watches the system score itself.

- **Tasks:** thin read-only view over the P1 service + `simlab/api.py` (FastAPI) rendering the five
  graded dimensions live; wires Phases 1–4. Build last, once the loop is proven by tests.
- **Deps:** P0–P3 (P4 optional). **Infra:** demo gateway.

---

## ProveIt deliverable traceability

| ProveIt deliverable | Phase |
|---|---|
| Upload industrial documentation · auto-contextualization | P2 (+ Parser/Contextualizer track) |
| Live telemetry · SimLab fault injection | existing `simlab/` engine + P4 |
| Root-cause analysis · evidence citations | P1 + P2 |
| Ground-truth scoring | P0 + P1 |
| Live dashboard | P5 |
| PLC-export ingestion · UNS generation · i3X | P3 |
| Human approval workflow | existing `simlab/approval.py`, surfaced in P5 |
| Multi-fault · robustness scoring (Nice-to-Have) | P4 |

## Sequencing & sub-agent dispatch

1. **P0 first**, solo (builder + reviewer) — the gate everything else relies on.
2. **P1** next (the scoring service P2/P3/P4 all call).
3. **P2, P2b, P3 in parallel** (independent dirs; isolated worktrees) once P1's `ScenarioScore`
   interface is frozen.
4. **P4 → P5** last.

Each phase: builder sub-agent → adversarial reviewer sub-agent (against the phase risk list) → human
gate (run the suite, read the diff) → commit → next. No phase merges to `main` without its gate green.

## Guardrails (apply to every phase)

- `simlab/` stays **deterministic + LLM-free**; `mira-plc-parser/` stays **stdlib + read-only +
  UNS-agnostic**. Bridges/harnesses live in `tests/simlab/` or `tests/beta/`, never inside those packages.
- Real-Supervisor / DB / embedding paths are **staging-gated**; PR CI runs the **deterministic** paths.
- Honor `.claude/rules/direct-connection-uns-certified.md`, `uns-compliance.md`, `train-before-deploy.md`.
- Screenshot rule for any P5 UI; evidence-only completion (run the gate, show numbers) per phase.
