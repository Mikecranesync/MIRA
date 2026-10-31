# Atomic Machines → MIRA: Maintenance Compiler investigation and decision package

**Date:** 2026-10-18 · **Mode:** read-only investigation, no code, branches, PRs, infra or equipment touched · **Repo fact base:** `origin/main` @ `8ca0b52be` (2026-10-16) · **Governance treated as authoritative:** `docs/architecture/mira-sdlc-v1.md` (ratified 2026-10-03)

**Evidence labels used throughout:** **[FACT]** confirmed in source or in the repo · **[INFERENCE]** follows from facts but not stated by a source · **[ASSUMPTION]** needed for a calculation, stated so it can be challenged · **[SPECULATIVE]** opportunity, not evidence.

**Investigation limits, stated up front**
- The session's network policy blocks direct page fetches (proxy returns 403 on CONNECT to atomicmachines.com, businesswire.com, dealroom.co, justia.com, etc.). Every Atomic Machines fact below comes from web-search summaries of those pages, not from reading them. Where a summary quoted the source, the quote is kept; nothing is embellished. **Nobody should treat Phase 1 as a primary-source review.**
- Repo facts were gathered by three read-only exploration passes and spot-checked by me where they carry weight (the prompt rule forbidding step lists, the un-bannered PLC write script, the plan types with no producer, the missing `tests/bench/`, the evals HOLD report). Items marked "reported" were not independently re-read.
- No Atomic Machines architecture detail is invented. Where the public record is silent, the report says so.

---

## 1. Executive explanation: what Atomic Machines actually is

**In plain English.** Atomic Machines (Emeryville, CA; founder/CEO Jeff Holden, ex-Amazon tenth engineer and Uber's first CPO) spent six years building a factory for tiny electromechanical machines. The pitch: MEMS today is made by coaxing silicon chip fabs into building small machines, and every new device needs years of custom process development. Their "Matter Compiler" is a line of automated fabrication and measurement machines plus software that takes a digital design and turns it into the sequence of physical operations needed to build it, measuring after every operation and only letting a part advance if it is in spec. The first product is **PrimeSwitch PS-150**, a bistable power relay (50 µs open, 150 A, 200 µΩ, 1500 V isolation, 9.5 × 3 mm) for 800 V DC data-center power, now shipping to unnamed early-access customers. **[FACT, company-sourced]**

**What is demonstrated vs. claimed**

| Item | Status | Evidence |
|---|---|---|
| Company exists, $250M aggregate raised (OneIM, Gigafund, XTX, KAS, Valor, Sozo, UC Regents), out of stealth 2026-10-07 | [FACT] | BusinessWire release via Yahoo/StreetInsider summaries |
| PrimeSwitch specs | [FACT: company claim] | Same; Wevolver notes 50 µs is conditional on fault-current rise time; no third-party test data found |
| One physical product family shipped for evaluation | [FACT] | runtimewire, techaiwire summaries; customers, price, volume undisclosed |
| "Every operation followed by precision metrology; part proceeds only if in spec" | [FACT: company claim] | Holden X thread (via summaries) |
| "AI adapts to errors and runs its own hardware-in-the-loop experiments, generating training data continuously" | [FACT: company claim] | Holden X thread |
| "Builds what you design, measures what it built, carries what it learned into the next design" | [FACT: company claim] | atomicmachines.com/matter-compiler (summary) |
| "No per-product tooling, no process development" | [FACT: company claim]; **contradicted in part** | NYT profile (via The Star / Golden Era summary): "a chain of 13 automated machines… engineers still move parts from machine to machine and help assemble the final device" |
| Patents | [FACT] granted patents are on the **device** (US 12,469,659 MEMS power relay; 12,451,309 liquid-solid contact; 12,272,912 micromachined flexure contact; WO/2024/220292 magnetic-latching actuator). **No patent found describing the compiler, planner, process library or metrology loop.** | Justia, PitchBook, USPTO gazette summaries |
| Public demonstration video, independent test, yield or repeatability data | **Not found** | Multiple outlets note its absence |

**How it works, to the extent the record says** [FACT where quoted, otherwise INFERENCE]
1. *Digital objective → operations.* The company says the system is "driven entirely by symbolic instructions", built from "reusable manufacturing operations controlled by code" (The Rundown). How a design is decomposed into those operations, what the operation library contains, and whether "AI" here means an LLM, a learned planner or classical optimization is **not public**.
2. *Representation and sequencing.* Not public beyond "symbolic instructions" and "fabrication path".
3. *Metrology and verification.* Every operation is measured; the measurement is "fed back to the AI as an error term"; advance is gated on spec. This is the one architectural statement repeated consistently across sources.
4. *Uncertainty and failures.* "Adapts to errors"; corrects "before they compound". No detail on rework vs. scrap, confidence, or escalation.
5. *AI / control / human roles.* Simulation proposes, hardware experiments test (HIL loop); a human approves release to production (dealroom summary). The NYT detail that engineers still move parts between 13 machines says the physical loop is **not** closed end to end today.
6. *Learning.* Each build's measurements feed later designs ("training data continuously"). No published evidence of the learning effect.

**The transferable abstraction** [INFERENCE]. Strip the microfabrication away and five ideas remain: (a) a **finite library of typed unit operations**; (b) a **planner that composes them per objective** instead of per-product engineering; (c) **measurement after every operation, with an in-spec gate**; (d) **errors fed back as structured signals**, not free text; (e) **every run is a labeled record** that improves the next plan. Ideas (a), (c), (d) and (e) are decades old in process engineering (ISA-88 procedures/phases, SPC, FMEA-generated diagnostic trees, run records). Atomic Machines' contribution, if real, is doing them with closed-loop automation on hardware it fully controls. **MIRA does not control its executor.**

---

## 2. Architecture comparison: Atomic Machines vs. actual MIRA

| Layer | Atomic Machines (claimed) | MIRA today (repo-verified) | Gap class |
|---|---|---|---|
| **Objective intake** | Digital design file | Free-text technician turn; UNS location gate (`engine.py:3731–3781`, `uns_resolver.py`), `direct_connection` bypass for Ignition/QR | Equivalent in kind |
| **Operation library** | Reusable symbolic operations | **None.** Closest: drive-pack `DiagnosticCard.first_checks`/`likely_causes` (`mira-bots/shared/drive_packs/cards.py`), `component_templates.troubleshooting_steps` JSONB (mig 016, rendered only in `mira-hub/src/app/api/mira/ask/route.ts:383–386`), `KeypadNavigationCard.keypad_steps` ("display strings, never executable") | **Missing** |
| **Plan / sequence object** | Fabrication path | **None.** Active prompt v1.4 rule 6: "ONE ACTION STEP AT A TIME. Never give a numbered list" (`mira-bots/prompts/diagnose/active.yaml:31`). LLM reply JSON `{next_state, reply, options, confidence}` has no steps field. FSM `IDLE→Q1→Q2→Q3→DIAGNOSIS→FIX_STEP→RESOLVED` (`fsm.py:19`) is dialogue position, not a plan. UI types `DiagnosticPlan`/`PlanStep`/`Hypothesis` exist (`packages/factorylm-interaction/src/types.ts:254–273, 472–475`) with **no backend producer** | **Missing; UI contract waiting** |
| **Executor** | Company-owned machines | Human technician; PLC/VFD reads only. Writes exist solely in bench scripts (`plc/live_monitor.py` bannered; `plc/vfd_fix_attempts.py:157–160` writes coil+register **with no BENCH-ONLY banner**) | By design (read-only) |
| **Metrology after every step** | Instrumented, automatic | Partial and asymmetric: machine-readable for `READ_PLC_TAG` (`mira-relay/tag_ingest.py` → `tag_events`/`live_signal_cache`, fail-closed allowlist; Ignition `diagnose/doGet.py` A0–A12 read-only); **self-reported** for everything a human measures | Structural: MIRA cannot verify a multimeter reading |
| **In-spec gate / outcome** | Pass → advance | Hub `grounding_status` outcomes (retrieval × citation), H4 gap admission (`engine.py:1326`), `insufficient_evidence` refusal; `decision_traces.outcome ∈ {resolved, gate_fired, null}`. **No per-step PASS/FAIL/INCONCLUSIVE/BLOCKED/UNSAFE** | Partial |
| **Error feedback** | Error term → planner | Groundedness 1–5 LLM judge → one clarifying question, `DIAGNOSIS_REVISION` capped by `diag_rev_count` (`engine.py:4320, 5076`). Scores **not persisted** | Partial, one-shot |
| **Run record** | Every build logged | `decision_traces` (migs 032…094; both runtimes write it), `equipment_notebook_turns.evidence`, `troubleshooting_sessions` (mig 019), `asset_fix_records` (migs 095–098, **no reader into the prompt found**) | Exists; records prose, not typed actions |
| **Learning from outcomes** | Claimed continuous | `prior_decisions.py` recall behind `MIRA_CONTEXT_CONTRACT` (off; candidate trust only); `learning_ingester.py` thumbs-up → FAQ (no scheduler found); fine-tune lab `factorylm_ai/` NOT READY (180 records, 0 human review). **Nothing learns from repair success/failure** | **Missing** |
| **Human authorization** | Human approves release | Work-order creation only after technician "yes" (`engine.py:4496, 4665`); admin-only KG promotion (`api/proposals/[id]/decide/route.ts:88`); asset-agent gate code exists, `ENFORCE_ASSET_AGENT_GATE` off; two-step PLC write approval **doctrine only** (`docs/mira-ignition-secure-architecture.md §4.2`: "code path absent") | Adequate for read-only pilot |
| **Orchestration** | Proprietary | Celery (`mira-crawler/celeryconfig.py`), Trigger.dev Cloud, Node-RED; `workflow_runs` (mig 044) adopted only by `upload-pipeline.ts`; **Temporal: zero code**, doctrine in ADR-0029/materialized-evidence.md | Sufficient; no new engine needed |

**Duplications that any new layer must not add to** [FACT]: intent classification runs twice per turn (`guardrails.classify_intent` + LLM `route_intent`); retrieval exists twice (bots: 4-stream RRF with pgvector; Hub: BM25 only, `manual-rag.ts:23–25`); provider cascade twice (Hub legacy list still includes Gemini); citation formats differ (`[Source: …]` vs `[n]`); evidence stores twice (`materialized_evidence/` in-memory/file registry vs Hub `evidence_item`/`observation`/`answer_claim`, migs 063/065); kg migrations in two trees with drift (Hub 029 header vs `docs/migrations/008`).

---

## 3. Opportunity matrix: transferable principles, ranked

Score key: Impact H/M/L on the pilot outcome; Complexity in engineer-weeks; Confidence that the benefit materializes.

| # | Atomic Machines principle | Maintenance problem it maps to | How MIRA would apply it | Reuse | Expected benefit | Limits / safety | Simpler proven alternative? | Impact / Cx / Conf |
|---|---|---|---|---|---|---|---|---|
| 1 | Typed unit operations + in-spec gate after each | Technician steps return "done"; MIRA cannot tell observed from assumed | **Action contract** (your §2): target, preconditions, executor, instrument, expected, evidence, outcome ∈ {PASS, FAIL, INCONCLUSIVE, BLOCKED, UNSAFE}. Store as data (YAML), like drive packs | `drive_packs` loader pattern; `DiagnosticCard`; `types.ts` `PlanStep`; `grounding_status` outcome enum shape; `decision_traces` turn packet (mig 090) | Auditable evidence; stops advance on INCONCLUSIVE; the record you need for any later measurement | Human-reported values are unverifiable; contract records *who* verified, never asserts safety | Yes: ISA-88 phase model, FMEA→decision-tree generators (1990s). Use their shape, not their software | **H / 2–3 wk / High** |
| 2 | Composed plan (fabrication path) | Prose answers; "one step at a time" prompt rule hides the plan; no "unnecessary steps" metric possible | Plan object = ordered PlanSteps with hypotheses; still **present one step at a time** (keeps prompt rule 6) but persist the plan | UI parts `plan`/`plan_step`/`hypothesis` already renderable in `packages/factorylm-ui/src/parts.tsx:577`; notebook turns | Makes diagnostic efficiency measurable for the first time | Templates, not scripts; LLM proposes, contract validates (same pattern as FSM `advance_state`) | Yes: guided-troubleshooting trees. Keep LLM for *selection*, data for *structure* | **H / 3–4 wk / Med-High** |
| 3 | Error term fed back | One-shot `DIAGNOSIS_REVISION`; judge scores discarded | Persist groundedness + step outcome into the trace; `FAIL`/`INCONCLUSIVE` re-enters `SELECT_NEXT_TEST` | `_self_critique_diagnosis`, `decision_traces`, `prior_decisions.py` | Fewer repeated tests; learning signal exists at all | Must not loop; cap exists (`diag_rev_count`) | Yes: just persist the score (1-line SQL) | **M / <1 wk / High** |
| 4 | Machine metrology | Only `READ_PLC_TAG`/`READ_DRIVE_PARAMETER` can be machine-verified | Bind those two actions to `live_signal_cache`/Ignition `diagnose` reads with timestamp + source; mark everything else `self_reported` | `mira-relay` allowlist, `tag_events`, `diagnose/doGet.py` | The only "metrology" MIRA can honestly claim; distinguishes observed from reported | Read-only, allowlisted tags only; `approved_tags` fail-closed already | Already built; wiring only | **M / 1 wk / High** |
| 5 | Run record → next plan | `asset_fix_records` has no consumer; nothing learns from outcomes | Feed PASS/FAIL action records + confirmed fix back as `evidence_from_prior_decisions` (candidate trust) | `materialized_evidence/context_contract.py:771`, `technician_context.py` (flag off), `asset_fix_records` | Second occurrence of a fault starts from the last verified path | Candidate trust only; ADR-0017 promotion stays human | Yes: recall-first rules already written (`.claude/rules/materialized-evidence.md`) | **M / 2 wk / Med** |
| 6 | Universal constructor (one line, many products) | Workflow templates per fault family across OEMs | 3 templates (motor-won't-start, VFD fault, sensor fault) parameterized by UNS asset + drive pack | UNS resolver, drive packs, component_templates | Reuse across customers | Needs OEM-qualified keys per asset; AS-i case shows topology must come from the technician | Yes: this is what runbooks are | **H / 2 wk / Med** |
| 7 | Robot executor | Future robotic maintenance | `executor` field on the contract; nothing else now | — | Keeps the door open at zero cost | No robot, no actuation path, no write authority; `.claude/rules/fieldbus-readonly.md` | n/a | **L now / 0 / —** |
| 8 | HIL experiments on own hardware | CV-101 bench | Tier-1 inducible faults (A0, A1, A2 via CE10/oL, A4, A7, A12) as the physical test set, **human-induced, read-only observed** | `ANOMALY_CATALOG.md`, `rules_core.py`, `live_logger.py`, replay JSONs | Real-hardware credibility | Only 2 recorded datasets exist (`cv101_comm_down.json`, `cv101_idle_healthy.json`); `tests/bench/` from the June plan **does not exist** | n/a | **M / 1–2 wk / Med** |
| 9 | "Compile" design → process automatically | Generate workflows from manuals | LLM drafts PlanSteps from retrieved passages, human curates into templates | RAG, `component_template.py` extractor | Lower template authoring cost | Hallucinated steps; must stay proposed until reviewed (same as KG) | Yes: FMEA/fault-tree → tree generation literature; LLM is the cheaper authoring tool | **M / later / Low-Med** |

**Rejected as not transferable:** closed-loop actuation (no write authority, and MIRA's "Write to PLCs. Period." non-goal), proprietary process physics, per-step automated metrology for human actions, and anything requiring a new orchestration engine (Temporal is doctrine with zero code; a 12-action pilot does not need it).

---

## 4. The 30× hypothesis

### 4.1 What 30× would have to mean
A 30× improvement is a ratio on one named metric, for one named workflow class, measured the same way before and after, with correctness and safety held at or above baseline. Candidate metrics:

| Metric | Baseline exists in repo? | Can MIRA move it 30×? |
|---|---|---|
| Time to reach a correct, cited candidate cause | **No** — never measured; only latency per turn (AskMira 45 s → 2.3 s, PRs #1775–1785) | Only on the information-retrieval sub-step |
| Technician troubleshooting effort (minutes, walks, measurements) | **No** | No: physical steps dominate |
| Number of unnecessary diagnostic steps | **No** — impossible today, no step object | Plausibly large on specific faults |
| Workflow completion time | **No**; `reports/page.tsx:16` hard-codes "2.4h" MTTR | No |
| Verified first-time repair success | **No**; industry ~71–75% (Aquant via vendor glossary, 2025) | Bounded by 1.3–1.4× (ceiling 100%) |
| Engineering effort to create/maintain workflows | Partial (drive pack authoring) | Possibly, via LLM drafting + curation |
| Cost per resolved incident | **No** | Follows the above |

**[FACT]** No metric in this list has a measured baseline in the repository. The two answer-quality baselines that do exist point the other way on correctness: the May 2026 bench scored MIRA grounded 28.2/35 vs. 25.5 ungrounded (`docs/evaluations/runs/2026-05-23-v2/mira-bench-results.md`), and the September release gate recorded **technician score 56.4/100, grounded correctness 0.0% (target ≥90), correct abstention 33.3%, 1 dangerous answer in 10 safety cases, verdict HOLD** (`evals/reports/f06922ac6-cov100-final.txt`). The staging gate passes at mean 4.61/5 on 15 fixed questions, but its rubric is grounding/context/actionability/safety/tone, not diagnostic correctness against an OEM key.

### 4.2 Decomposition of a fault-to-fix episode [ASSUMPTION-heavy; every number is a placeholder to be replaced by measurement]
Take "VFD trips on fault code, technician at the panel with phone":

| Sub-step | Typical minutes (assumed) | What a Maintenance Compiler changes |
|---|---|---|
| Identify asset, read code | 2–5 | Already handled (UNS gate, drive-pack fault path) |
| Find the right manual passage | 5–30 | Already 10–30× faster **when retrieval is correct**; today's grounded correctness baseline is 0% on the release-gate set |
| Decide next test | 2–10 | Plan + `SELECT_NEXT_TEST` could cut repeat/unneeded tests |
| Safe access, LOTO/verify zero energy | 10–30 | **Unchanged by software**; MIRA only records qualified-person verification |
| Measure | 5–20 per measurement | Unchanged |
| Repair / restore / function test | 15–120 | Unchanged |
| Document | 5–15 | Structured record could cut to ~1 |

**[INFERENCE]** Even if every software-touchable sub-step went to zero, the human-physical steps (30–170 min) bound the whole-episode improvement to roughly **1.3–2.5×**. A 30× ratio is arithmetically available only on the sub-steps MIRA already owns: *time to a cited candidate cause* and *documentation time*. Those are legitimate, measurable, and where MIRA's existing wedge (cited answers) already lives, but they are not "time to fix".

### 4.3 Scenarios (conservative / expected / optimistic), stated as targets to measure, not results
| Metric | Conservative | Expected | Optimistic | Condition |
|---|---|---|---|---|
| Time from fault code to **correct** cited candidate cause (fault-coded VFD/PLC faults with manual in KB) | 2× | 5× | 30× (30 min → 1 min) | Correctness ≥ baseline human; measured against OEM-qualified key |
| Unnecessary diagnostic steps per episode | −20% | −50% | −80% | Needs step object (opportunity #2) to measure at all |
| Repeat measurements on recurrence of same fault | −30% | −60% | −90% | Needs run record → next plan (#5) |
| Whole-episode diagnosis time | 1.2× | 1.5× | 2.5× | Physical steps dominate |
| First-time-fix rate | +3 pts | +8 pts | +15 pts | Ceiling-bounded |
| Workflow authoring cost | 1× | 3× | 10× | LLM-drafted, human-curated templates |

**Verdict on 30×** [INFERENCE]: theoretically plausible for exactly one narrowly defined metric (fault code → correct cited cause, on faults whose manual is ingested), where MIRA already partly delivers it; **not plausible** for diagnosis time, technician effort, completion time, FTF or cost per incident. Today the binding constraint is **correctness** (0% grounded correctness, 33% abstention on the release-gate set), not speed; a faster path to a wrong cause is negative value. External evidence agrees: the best agent benchmark in the field (AssetOpsBench, KDD 2026) tops out at ~65% task completion, and no published field study compares technicians with and without an LLM copilot. **A 30× claim is not an accepted result and should not be a target; it should be replaced by the measurable targets above.**

---

## 5. Proposed architecture: the smallest thing that answers your research question

> **Research question (yours, adopted):** Can a small library of standardized technician actions, composed into verified diagnostic workflows, deliver a measurable improvement over MIRA's current conversational troubleshooting without a new compiler architecture?

**Design principle:** data, not code; one plan object, not a workflow engine; evidence records, not transcripts. Everything below reuses an existing seam.

### 5.1 Action library (12 core actions as data)
A YAML pack under the drive-pack loading pattern (`mira-bots/shared/drive_packs/` style, data-not-code, ADR-0025). Proposed 12 for the pilot, each with its existing MIRA anchor:

| Action | Existing anchor | Verification class |
|---|---|---|
| `IDENTIFY_ASSET` | UNS gate / `resolve_uns_path`; `direct_connection` | machine (UNS path) |
| `READ_FAULT` | drive-pack `answer_fault_code`; `GS10_FAULT_CODES` | self-reported or machine (`fault_code` HR 400119) |
| `OBSERVE_STATE` | A0–A12 `rules_core.evaluate`; `live_signal_cache` | machine where tags approved |
| `REVIEW_HISTORY` | `prior_decisions.py`, `asset_fix_records`, `cmms_get_fault_history` | machine |
| `ASSESS_HAZARDS` | `guardrails` energized-hazard detection; Hub `answer-validation.ts` SAFETY_STOP | MIRA flags; **never clears** |
| `VERIFY_AUTHORIZATION` / `CONFIRM_ISOLATION` | none (records only) | human attestation, named person |
| `READ_PLC_TAG` | `tag_events`/`live_signal_cache`; Ignition `diagnose/doGet.py` | **machine, timestamped** |
| `READ_DRIVE_PARAMETER` | GS10 register map; drive-pack `KeypadNavigationCard` | machine via PLC relay, else self-reported |
| `MEASURE` (voltage/resistance/current/continuity/temperature as `quantity`) | none | self-reported with instrument + test points |
| `COMPARE_TO_SPEC` | drive pack specs, manual passages (retrieval) | computed when both sides present |
| `SELECT_NEXT_TEST` | LLM (cascade) constrained to library + template | LLM proposes, contract validates |
| `RECORD_FINDING` / `ESCALATE` | `asset_fix_records`, H4 gap admission, `insufficient_evidence`, `cmms_create_work_order` (yes/no gated) | machine |

Outcome enum on every action: `PASS | FAIL | INCONCLUSIVE | BLOCKED | UNSAFE`. `UNSAFE` and `BLOCKED` terminate the plan without a diagnosis, by construction. Your table in §2 of the brief is the contract; the only addition I'd make is a `verification: machine | self_reported | attested` field, because that single field is what lets the later evaluation separate observed from claimed values.

### 5.2 Plan object and presentation
- Producer: the Hub notebook chat route (`equipment-notebooks/[id]/chat/route.ts`) emits `plan`, `plan_step`, `hypothesis` parts already typed in `packages/factorylm-interaction` and rendered by `packages/factorylm-ui`. No new UI package; this is the one place a producer is missing.
- Presentation keeps prompt rule 6: show **one** `plan_step` at a time; the plan is persisted, not dumped.
- Persistence: steps and outcomes into `equipment_notebook_turns.evidence` (same JSONB that carries `grounding_status`) and the `decision_traces` turn packet (mig 090). No new table for the pilot. If a dedicated table is later justified, follow `asset_fix_records` (append-only, SELECT/INSERT grant, never auto-promoted).
- Flag: `NOTEBOOK_DIAGNOSTIC_PLAN_ENABLED`, default 0, staging compose only, registered in `CAPABILITY_CLOSURE.yaml` as `implemented_unconnected` → `canary` (finish-capability skill applies).

### 5.3 Three workflow templates (data)
`motor_wont_start`, `vfd_fault`, `sensor_fault`, parameterized by UNS asset and drive pack; each a partial order of actions with hypotheses and the discriminating test per hypothesis. Authored by hand first (three templates is an afternoon each with an OEM manual open); LLM-drafted templates are opportunity #9 and come later, as `proposed` until curated.

### 5.4 What is explicitly **not** built
No compiler. No Temporal. No robot executor. No PLC/VFD write path (fieldbus rule; the un-bannered `plc/vfd_fix_attempts.py` should get its banner regardless of this decision). No second retrieval, cascade, citation or evidence store. No change to the bots' engine for the pilot; the notebook route is the single surface.

**Does this improve on what exists?** [INFERENCE] It does not improve retrieval or answer quality by itself. It makes diagnostic efficiency **observable** for the first time (steps, outcomes, repeats), terminates honestly on `INCONCLUSIVE/BLOCKED/UNSAFE`, and produces the typed records that every later improvement (recall of prior paths, template learning, training data) depends on. The honest expected payoff of the pilot is a measurement instrument plus a modest step-efficiency gain, not a 30× result.

---

## 6. Validation plan: establish value before infrastructure

### 6.1 Arms
- **A. Current MIRA**: notebook chat as deployed (flag off), fresh thread per case.
- **B. Minimal workflow improvements, no plan object**: same engine; add (i) persisted groundedness score, (ii) `READ_PLC_TAG` evidence line from `live_signal_cache` in the prompt, (iii) explicit `INCONCLUSIVE` refusal wording. Isolates "cheap plumbing" from "new structure".
- **C. Action library + plan object** (§5), flag on in staging.

### 6.2 Datasets and scenarios (all exist or are specified; none require control)
| Set | Source | Role | Leakage control |
|---|---|---|---|
| CV-101 Tier-1 inducible faults: A0 (Ethernet pulled), A1 (RS-485 pulled), A2 via CE10 / oL, A4 (both direction switches), A7 (belt drag), A12 (beam blocked, post-reflash) | `plc/conv_simple_anomaly/ANOMALY_CATALOG.md`, `rules_core.py` | Physical set; human induces, MIRA observes read-only via relay/Ignition | Golden healthy baseline (30 Hz, torque 66–77%, 878 rpm, DC bus 319 V, 0.56 A) must be captured into the missing `tests/bench/golden_conv_simple_healthy.json` **first** |
| CV-101 replays | `replay/cv101_comm_down.json`, `cv101_idle_healthy.json`, `mira-crawler/tests/fixtures/machine_memory/cv101_*.json` | Offline deterministic | Already fixtures |
| SimLab juice line, 6 scenarios A–F | `simlab/scenarios.py`, `tests/simlab/runner.py` checkpoints (no_premature_blame, isolation_evidence, subsystem_identified, no_cross_component_confusion, latency) | Multi-machine reasoning at scale | Deterministic; commit `runs/` outputs |
| **ASI-001** AS-i seat-slave case, 12-step routine | `docs/plans/2026-10-09-field-maintenance-acceptance.md` (anchors + critical vetoes per step), curriculum lessons 1–4 | Offline field case; tests topology correction (step 9), chronology, honest `INCONCLUSIVE` | Routine already forbids adding later facts to earlier questions; fresh thread per arm; photos hash-pinned; **no ride control or return-to-service authority** |
| PT100 / Klixon over-temperature | `printsense/fixtures/scu2/explanation.md` (EL3204 RTD, EL1722 Klixon loop), `docs/eval/visual-technician-corpus/hard_failures/oem_brake_stator.yaml` (ground-truth device list), MCQ items in `tests/benchmark/mira_mcq_benchmark.json` (12 PT100 mentions) | Offline overtemperature workflow; the `MEASURE_RESISTANCE` contract example | Confidential print is local-only, sha256-pinned; neutralized identifiers only |
| Release-gate technician/safety cases | `evals/BASELINE_TESTING_STANDARD.md` (30 + 10) | Regression floor; the current HOLD must not get worse | Existing keys; judge separate from generator |

### 6.3 Scoring (per case, per arm)
1. Correct cause identified vs. OEM-qualified key (binary) and **turn at which it was first stated**.
2. Steps proposed; steps judged unnecessary by a blinded reviewer with the key; repeated tests.
3. Outcome honesty: `INCONCLUSIVE/BLOCKED/UNSAFE` used when the key says the evidence is insufficient (ASI-001 is designed to end unresolved).
4. Citation applicability (passage supports the step), reusing the staging-gate grounding dimension and `cp_citation_groundedness`.
5. Dangerous-answer count (hard gate; one dangerous answer fails the arm, per `evals` §17.1).
6. Latency and token/cost per episode (existing `timings_ms`, provider usage mig 080).

### 6.4 Instrumentation and fairness
- Same clues, same order, fresh thread per arm; score from saved turns and turn IDs, never recollection (the ASI-001 routine already mandates this).
- Judge model ≠ generator; keys hash-pinned and held out; no template may quote a case's answer key.
- Paid judging under the existing `paid_gate.py` pattern (fixed checks, ≤$5, explicit go); generation on the free cascade (zero-token rule).
- Safety boundary: all CV-101 faults are human-induced by unplugging/loading, observed read-only; `--serial-bus-idle` discipline for any RS-485 sweep; no run/stop/reset words issued by MIRA (`is_control_action_request` refusal stays on).
- Misleading-claims control: every number reported with arm, case ID, head SHA, and judge version; "faster" only reported alongside correctness on the same cases.

### 6.5 Estimated cost
Engineering [ASSUMPTION]: B ≈ 1 week; C ≈ 4–6 weeks (library + 3 templates + route producer + persistence + tests + guard rationale, since the Hub route is a guarded path and R2/R3 review applies). Bench time: 2 days to capture the golden baseline and six Tier-1 faults. Inference: free cascade; judge ≤$5 per full run under the gate. Review: Codex exact-head GREEN required (R3 if migrations or safety wording change; otherwise R2 floor via `r2_signal_floor.py`).

---

## 7. Roadmap with go/no-go gates

| Phase | Scope | Exit evidence | Go / No-go |
|---|---|---|---|
| **R0 Research (this document)** | Understand, map, decide | This package | Mike decides §10 |
| **P1 Baseline first (1–2 wk)** | Capture CV-101 golden JSON; run arms A and B on all offline sets; persist groundedness score | Scorecards committed under `tests/eval/runs/` and `evals/reports/` for the exact head | **No-go if** A/B cannot be scored reproducibly; fix measurement before building |
| **P2 PoC C, offline only (4–6 wk)** | 12 actions, 3 templates, plan producer behind flag; ASI-001 + SimLab + PT100 sets | C ≥ B on correct-cause turn and unnecessary steps, with 0 dangerous answers and no drop in abstention honesty | **No-go if** C is not better than B on at least two metrics with 0 safety regressions — then the answer to the research question is "no" and the plan object is retired |
| **P3 Bench + device (2 wk)** | Six Tier-1 faults on CV-101, emulator + Pixel, `READ_PLC_TAG` machine-verified | `tools/mobile-e2e` journey extended; receipts; screenshots in `docs/promo-screenshots/` | Staging activation requires Mike |
| **P4 Pilot (customer, read-only)** | One asset family at one site; workflows as templates; records only | FTF/step metrics on real episodes vs. the site's own history | Production enablement requires Mike; migration gates per `docs/environments.md` |
| **Later / separate decisions** | LLM-drafted templates; recall of prior verified paths into context (ADR-0033 acceptance); robot executor | — | Each its own ADR |

---

## 8. Risk register

| Risk | Class | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Faster path to a **wrong** cause (correctness baseline is 0% grounded on the release set) | Product/safety | High | High | Correctness and dangerous-answer gates precede any speed claim; P1 before P2 |
| Self-reported measurements treated as verified | Safety/data | High | High | `verification` field; MIRA never asserts isolation/zero-energy; `ASSESS_HAZARDS` flags only |
| Plan object becomes a rigid script that overrides the technician | Product | Med | Med | Templates with hypotheses; LLM selection; technician can reject a step (`FAIL`/`BLOCKED`) |
| A second workflow engine / registry / evidence store | Architecture | Med | High | Reuse notebook turns + decision_traces; no Temporal; convergence registry check before any new table |
| Guarded-path churn (Hub route, mobile screens are lifecycle-guarded) | Governance | High | Med | Single surface (notebook route); rationale section; Codex exact-head GREEN |
| 30× becomes a marketing number before measurement | Product/credibility | Med | High | Report ratios only with arm, case set, correctness and SHA; retire the 30× framing now |
| Templates leak answer keys into evaluation | Measurement | Med | High | Held-out keys, hash-pinned; template authors blind to eval set |
| Bench write scripts reused unsafely (`plc/vfd_fix_attempts.py` un-bannered) | Safety | Low | High | Banner it; keep all pilot work read-only; `test_no_customer_write_paths` stays green |
| Atomic Machines analogy over-claimed externally | Positioning | Med | Low | Describe as "typed actions with per-step verification", cite ISA-88/FMEA lineage, not a compiler |
| Pilot consumes the field-maintenance qualification lane (ASI-001 owners, #4321/#4327–#4330) | Coordination | Med | Med | Reuse their routine as a dataset; do not take over their claims; multi-session protocol |

---

## 9. Recommendation

**Reject** adopting the Matter Compiler as an architecture or as a 30× program. The public record does not describe its planner, process library or learning loop; its one shipped product is company-tested only; the closed-loop that makes it interesting depends on owning the executor and sensors, which MIRA by doctrine and by law of the plant does not.

**Adapt** two of its principles, which are also forty-year-old process-engineering principles, as a small, data-first pilot that answers your research question directly: (1) a **typed action contract with a per-step outcome and a verification class**, and (2) **measurement after every step feeding a persisted record**. Build it as 12 actions, 3 templates, one producer in the notebook route behind a default-off flag, no new engine, no writes.

**Defer** LLM-drafted templates, recall of prior verified paths into the prompt (waits on ADR-0033), and any robot-executor work.

**Replace 30× with measurable targets:** turn-to-correct-cause, unnecessary steps, repeat tests, honest-termination rate, dangerous answers, all against OEM-qualified keys on SimLab, ASI-001, PT100/Klixon and six CV-101 Tier-1 faults. The expected outcome of the pilot is a working measurement instrument and a modest efficiency gain; if arm C does not beat arm B on two metrics with zero safety regressions, the answer to the research question is "no" and the plan object is retired.

**Smallest safe experiment that justifies further investment:** P1 alone, with no new code beyond persisting the groundedness score and the `READ_PLC_TAG` evidence line, run against SimLab + ASI-001 + PT100 on the current head. If arm B already moves correctness or honest termination, the plan object has a baseline worth beating; if nothing can be scored reproducibly, that is the finding.

---

## 10. Open decisions requiring your authorization

1. **Retire the 30× framing** in favor of the §4.3 target table, or keep it as an aspirational banner with the caveats attached.
2. **Authorize P1 (baseline-first)**: capture the CV-101 golden JSON (bench, read-only, human-induced faults only), run arms A/B offline, commit scorecards. Risk class R1/R2; no migrations.
3. **Authorize P2 (PoC C) design-and-build** under the SDLC: owning issue + PRD/ADR, `Risk:` line, Codex exact-head GREEN, flag default off, `CAPABILITY_CLOSURE.yaml` entry. Not authorizing staging activation or production.
4. **Approve the 12-action list and outcome enum** in §5.1 (or edit it) as the contract the pilot measures against.
5. **Confirm single surface**: notebook chat route only for the pilot (not the Telegram/Slack engine), to keep the diff inside one guarded path.
6. **Approve reuse of the ASI-001 routine as an evaluation dataset**, coordinated with its current owners (Oct 9 curriculum lanes), with photos staying local-only.
7. **Housekeeping, independent of this decision:** add the BENCH-ONLY banner to `plc/vfd_fix_attempts.py`; reconcile `.claude/rules/fieldbus-readonly.md`'s contradictory line about `live_monitor.py`; fix CLAUDE.md's dead reference to `agent_trace.py`; the staging-gate 10-vs-15 question drift.

Nothing in this package has been started. No code, branch, PR, dependency, infrastructure, PLC state or deployment was changed.

---

### Appendix A — Source list
Atomic Machines (via search summaries; direct fetch blocked): BusinessWire release 2026-10-07 (Yahoo Finance / StreetInsider mirrors); atomicmachines.com `/`, `/matter-compiler`, `/blog/atomic-machines-origin-story`, `/company`; Jeff Holden X thread 2026-10-08 (threadreaderapp mirror); Bloomberg "The Close" 2026-10-09 clip; dealroom.co talk summary; The Rundown; Glitchwire; explainx.ai; runtimewire; techaiwire; Wevolver PS-150 analysis; Golden Era summary of the NYT (Cade Metz) profile via The Star; Justia assignee page; PitchBook patent family; USPTO OG US 12,469,659; WO/2024/220292 notice.
Field/industry: AssetOpsBench (arXiv 2506.03828, KDD 2026); JFTA-Bench (arXiv 2603.22978); SysDiagBench (ABB); Aquant/TSIA FTFR figures via vendor glossaries; ISA-88 vendor material; FMEA→diagnostic-tree literature (AAAI 1997; Univ. Hamburg MAD).
Repository (origin/main @ 8ca0b52be): paths cited inline; governance `docs/architecture/mira-sdlc-v1.md`; closure `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`; baselines `docs/evaluations/runs/2026-05-23-v2/`, `evals/reports/f06922ac6-cov100-final.txt`, staging-gate comment on #4303 (mean 4.61, 15/15).

### Appendix B — Repo facts I verified directly vs. reported by exploration passes
Verified by me: `active.yaml:31` rule 6; `plc/vfd_fix_attempts.py` writes coil + register, zero BENCH banner lines; `types.ts:254–275, 472–475` plan types; `tests/bench/` absent; replay files present; `evals/reports/f06922ac6-cov100-final.txt` figures; `docs/evaluations/runs/2026-05-23-v2` aggregates; MCQ benchmark 100 items, 12 PT100 mentions, 0 Klixon; `live_check.py:28` PE-101 on DI_05; ASI-001 routine steps 8–12 and curriculum lanes on origin/main; SDLC §0–§2. Reported, spot-read only: engine line numbers, migration inventory, Celery beat profiles, mira-mcp tool list, fine-tune lab figures.
