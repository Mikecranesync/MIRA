# FactoryLM / MIRA Flight Recorder (Black Box) — Discovery

**Status:** discovery (2026-07-01). **No code written. Not committed.**
**Purpose:** find what already exists before defining the accountability layer, so we
extend rather than rebuild. Pairs with `docs/prd/factorylm_flight_recorder_black_box_prd.md`.

> **Headline finding:** the "Flight Recorder" is a **naming + unification + readout** over
> pieces that already exist or are in-flight — NOT a new capture engine. "Flight recorder /
> black box" appears in the repo only in **competitor/vision docs**, never as shipped code —
> but the *substrate* (raw capture, decision-trace store, difference record, human-decision
> flow, learning loop) is largely present. There is even an **OPEN PR that literally adds a
> deterministic SimLab flight recorder (#2335).**

---

## 1. Current branch & dirty working tree

- **Branch:** `feat/litmus-bench-proof` (the Litmus WIP branch).
- **Dirty tree (untouched by this discovery):** `mira-hub/**` RAG WIP (5 files), `wiki/hot.md`,
  `.agents/skills/qr-onboarding/SKILL.md`, and untracked `demo/`, `docs/customer_workflows/`,
  `docs/discovery/`, `docs/external-ai/`, `mira-mcp/factorylm_external_ai/`, `mira-plc-parser/evals/`,
  `scripts/verify_factorylm_external_ai_stack.py`, `tests/simlab/test_proveit_demo.py`.
  This discovery only ADDS two new docs; it stages/commits/moves nothing.

## 2. Files inspected

- `demo/factory_difference_engine/{pipeline,__main__,__init__}.py`, `README.md` (the deterministic engine + JSON contract).
- `docs/discovery/factory_difference_engine_visual_workflow.md` (the visual-workflow discovery that precedes this).
- `plc/conv_simple_anomaly/difference_detectors.py` (+ `baseline_learner.py`, `event_context.py`).
- `docs/adr/0022-decision-trace-and-tag-stream-storage.md` (**the accountability-storage ADR**).
- `docs/specs/why-mira-thinks-this-spec.md`; `mira-hub/src/components/WhyMiraThinksThis.tsx`;
  `mira-hub/src/app/api/decision-trace/[id]/{route.ts,feedback/route.ts}`.
- Migrations `mira-hub/db/migrations/{032_decision_traces, 055_decision_trace_confidence_and_feedback, 033_tag_events, 020/036 live_signal_cache}.sql`.
- `tools/proof/build_pdf.py`; `docs/sample-reports/weekly-digest/2026-04-28_weekly-digest.html`.
- `mira-hub/src/components/review/review-queue.tsx`; `.../knowledge/suggestions`; `ai_suggestions`(027).
- Search sweep: `flight recorder|black box|historian|difference engine|baseline|drift|trace|decision_trace|WhyMiraThinksThis|ai_suggestions|review queue|live_signal_cache|tag_events|Sparkplug|MQTT|evidence recorder|machine replay`.

## 3. Recent PRs / issues inspected (the decisive discovery)

| PR | State | What it means for the Flight Recorder |
|---|---|---|
| **#2335 feat(simlab): add deterministic flight recorder** | **OPEN** (`codex/flight-recorder-phased`) | **A Layer-0 event tape already exists in-flight.** `simlab/flight_recorder.py` records `scenario_loaded` / per-tick / `evidence_requested` events → NDJSON; `simlab/api.py` exposes read/clear/NDJSON endpoints. Headless, deterministic, no Hub DB / wall-clock / UUIDs. Plan: `docs/superpowers/plans/2026-06-27-simlab-flight-recorder.md`; boundary: `docs/simlab/flight-recorder-hub-integration.md`. **Do not rebuild this.** |
| #2350 Historian Query API + swappable adapter | MERGED | Durable tag-history read path exists. |
| #2354 prod historian worker+beat | MERGED | The continuous historian gap is now filled. |
| #2358 Sparkplug B MQTT consumer | MERGED | Standard industrial ingest path landed (Connect adapter). |
| #2387 Reposition as signal difference engine | MERGED | The difference engine + `event_context` are on main. |
| #2136 "Import Review" → contextualization Review Queue | MERGED | Review-queue reuse is live. |

## 4. Existing pieces found (the accountability layer is ~mostly present)

| Flight-Recorder concern | Already exists | Where |
|---|---|---|
| **Raw machine capture** | SimLab flight recorder (NDJSON, #2335); raw ingest stream; prod historian | `simlab/flight_recorder.py` (#2335), `tag_events`(033), historian (#2350/#2354), Sparkplug consumer (#2358) |
| **Baseline vs current difference record** | difference engine → observations → one machine event; deterministic JSON | `plc/conv_simple_anomaly/*`, `demo/factory_difference_engine/pipeline.py::run_pipeline()` |
| **Evidence bundle** | evidence packet (abnormal tags + baseline + delta + docs) + citation set | `simlab/diagnostic.py::assemble_evidence`, `stages.explain` |
| **MIRA explanation record** | append-only **`decision_traces`** (evidence JSONB, citations_present, technician_confirmed, outcome, model_used, latency); + confidence/feedback | migrations 032 + 055; API `/api/decision-trace/[id]`; UI `WhyMiraThinksThis.tsx` |
| **Human accept/reject/escalate** | ADR-0017 proposal state machine + decide routes + review queue | `mira-bots/shared/proposal_transition.py`, `/api/proposals|suggestions/[id]/decide`, `review/review-queue.tsx` |
| **Approved learning loop** | `kg_*.approval_state` verified/rejected; `ai_suggestions` lifecycle | migrations 027/029; ADR-0017 |
| **Trace store decision** | **NeonDB decision_traces, NOT Langfuse** (Langfuse off-by-default was explicitly rejected) | ADR-0022 §Alternatives |

## 5. Existing UI / review / report / schema pieces to REUSE

- **Report styling:** `docs/sample-reports/weekly-digest/2026-04-28_weekly-digest.html` (self-contained inline-CSS HTML) → the Flight Recorder Report skin. PDF later via `tools/proof/build_pdf.py` (reportlab).
- **Decision-trace UI:** `WhyMiraThinksThis.tsx` + `/api/decision-trace/[id]` — the explanation/evidence surface already exists; the Report mirrors it in static form.
- **Review/approval UI:** `mira-hub/src/components/review/review-queue.tsx` + `/knowledge/suggestions` — the Learn panel.
- **Schema:** `decision_traces`(032/055), `tag_events`(033), `live_signal_cache`(020/036), `ai_suggestions`(027), `kg_*`(029). All append-only where it matters.
- **Data contract:** `run_pipeline()` JSON (5 stages) — already the single source for any readout.
- **Demo mode:** demo tenant `00000000-…-d1`, `sessionOrDemo`, `/demo/conveyor/[tag]`.

## 6. Gaps (the genuinely missing pieces)

1. **A unified human-readable "flight record" readout.** The pieces exist but nothing renders one
   auditable black-box readout per machine event/session (capture → diff → explanation → decision →
   learning). **This is the real gap.**
2. **A static, offline, deterministic report** over the existing `run_pipeline()` JSON (no Hub/DB/LLM) —
   the smallest visual proof, and the "Export" artifact a Hub page would later reuse.
3. **A stable "flight-record" bundle shape** that references (not copies) the existing stores
   (`decision_traces` id, `tag_events`/historian window, difference-engine event, proposal ids) — a
   thin envelope, not a new table (Phase 2+).
4. Bridging SimLab's Layer-0 NDJSON tape (#2335) to the Layer-1 accountability bundle (optional, later).

## 7. Recommended smallest first implementation

**A static HTML "Flight Recorder Report" renderer over the existing deterministic Factory Difference
Engine JSON.** Offline, deterministic, no DB/cloud/LLM. One renderer + a `--html` flag + one test.
It turns `run_pipeline()` into a manager-readable black-box readout (header, executive summary,
difference cards, event timeline, baseline-vs-current, explain, evidence/citations, learn preview).
This is the same Phase 1 the visual-workflow discovery recommended — reaffirmed by this deeper pass.

## 8. Explicit DO-NOT-REBUILD list

- ❌ `simlab/flight_recorder.py` + `simlab/api.py` recorder endpoints (**PR #2335** — the Layer-0 tape).
- ❌ `decision_traces` table / `/api/decision-trace/[id]` / `WhyMiraThinksThis.tsx` (the explanation record + UI).
- ❌ The historian (Query API + worker, #2350/#2354) — durable tag history already lands.
- ❌ The Sparkplug B MQTT consumer (#2358) and `tag_events`/`ingest_contract` ingest path.
- ❌ The difference engine (`plc/conv_simple_anomaly/*`) and `run_pipeline()` JSON.
- ❌ ADR-0017 proposals / decide routes / `review-queue.tsx` (the human-decision + learning loop).
- ❌ A new trace store — ADR-0022 already chose NeonDB `decision_traces` over Langfuse.
- ❌ Any LangGraph orchestration — rejected by ADR-0011. Langfuse/Phoenix stay **optional** tracing adapters only.

## Cross-references
- `docs/prd/factorylm_flight_recorder_black_box_prd.md` — the PRD this discovery grounds.
- `docs/adr/0022-decision-trace-and-tag-stream-storage.md`; `docs/specs/why-mira-thinks-this-spec.md`.
- PR #2335 `docs/superpowers/plans/2026-06-27-simlab-flight-recorder.md` + `docs/simlab/flight-recorder-hub-integration.md`.
- `docs/discovery/factory_difference_engine_visual_workflow.md`; `demo/factory_difference_engine/README.md`.
