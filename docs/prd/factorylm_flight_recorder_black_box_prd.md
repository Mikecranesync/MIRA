# PRD — FactoryLM / MIRA Flight Recorder (Black Box)

**Status:** DRAFT (2026-07-01). Grounded in
`docs/discovery/factorylm_flight_recorder_black_box_discovery.md`. **No code yet.**
(Path note: repo PRDs also live in `docs/product/`; this uses the requested `docs/prd/` path.)

> **Thesis.** The Flight Recorder is MIRA's **accountability layer** — the black-box readout
> that bundles, per machine event/session, *what the machine did → what changed vs baseline →
> what evidence supports it → what MIRA recommended → what a human accepted/rejected/escalated →
> what the system is allowed to learn.* It is a **unification + readout over existing stores**,
> not a new capture engine.

## 1. Problem

MIRA now detects differences, explains them, and proposes context — but the *record of what
happened and who decided what* is scattered across `tag_events`, the SimLab flight tape (#2335),
`decision_traces`, the difference-engine JSON, and `ai_suggestions`. There is no single auditable
"flight record" a maintenance manager (or an auditor, or Mike) can open and trust. Accountability —
"prove what MIRA saw, said, and was allowed to learn" — has no human-readable artifact.

## 2. Goals

Define one **Flight Record** per machine event/session that binds six existing concerns into an
auditable, reproducible bundle, and render it as a human-readable **Flight Recorder Report**.

## 3. Non-goals

- ❌ A new capture engine, historian, trace store, or ingest path (all exist — see §8).
- ❌ Any PLC/control write. Read-only, always (`.claude/rules/fieldbus-readonly.md`).
- ❌ LangGraph orchestration (rejected, ADR-0011). Langfuse/Phoenix are **optional** tracing
  adapters only — never required (ADR-0022 chose NeonDB `decision_traces` as the store).
- ❌ Cloud LLM / NeonDB / live data in Phase 1.
- ❌ Rebuilding `decision_traces` / `WhyMiraThinksThis.tsx` / `review-queue.tsx` / difference engine.

## 4. What the Flight Recorder IS (six records, each over an existing store)

| # | Record | Definition | Backed by (reuse) |
|---|---|---|---|
| 1 | **Machine event/session capture** | the raw tape: signals seen, per-tick values, evidence requests, window | SimLab flight tape `simlab/flight_recorder.py` (#2335, NDJSON); `tag_events`(033); historian (#2350/#2354); Sparkplug consumer (#2358) |
| 2 | **Baseline vs current difference record** | learned normal, detected differences, grouped into one machine event | `plc/conv_simple_anomaly/*`; `run_pipeline().stages.prove` |
| 3 | **Evidence bundle** | abnormal tags + baseline + delta + candidate docs + citation set | `simlab/diagnostic.assemble_evidence`; `stages.explain` |
| 4 | **MIRA explanation record** | what MIRA recommended: answer, what-to-check, confidence/rubric, model | `decision_traces`(032/055) + `/api/decision-trace/[id]` + `WhyMiraThinksThis.tsx`; `stages.explain` |
| 5 | **Human accept / reject / escalate decision** | the reviewer's verdict on each proposed context/learning | ADR-0017 `proposal_transition.py` (accept→verified, reject→rejected, **escalate→needs_review** via `flag_review`); `review-queue.tsx`; `/decide` routes |
| 6 | **Approved learning loop** | what the system is allowed to learn: only accepted context becomes verified | `kg_*.approval_state`; `ai_suggestions`(027/029) |

**Flight-record bundle = a thin envelope that REFERENCES these, not a new copy:**
```
FlightRecord {
  record_id            # deterministic (scenario+seed) in demo; decision_trace_id in prod
  asset, scenario, seed, deterministic
  capture     -> refs: ndjson tape / tag_events window / historian range   (#2335, 033)
  difference  -> stages.prove   (observations + one machine event)
  evidence    -> stages.explain.evidence + citations
  explanation -> stages.explain.answer + rubric  (+ decision_trace_id in prod)
  decision    -> stages.learn.proposals[] {accept|reject|escalate}
  learning    -> verified[] / rejected[] (kg approval_state)
  caveats     -> unproven/missing (honest)
}
```
Phase 1 assembles this envelope purely from the deterministic `run_pipeline()` JSON — **no new table.**

## 5. The three layers (do not confuse them)

- **Layer 0 — capture tape** (EXISTS/in-flight): `simlab/flight_recorder.py` NDJSON, `tag_events`, historian.
- **Layer 1 — the accountability RECORD/bundle** (the envelope in §4): binds capture+diff+evidence+explanation+decision+learning by reference.
- **Layer 2 — the READOUT** (the gap): a human-readable **Flight Recorder Report** (static HTML first).

The Flight Recorder PRD is **Layer 1 + Layer 2**; Layer 0 is reused, not rebuilt.

## 6. Phase 1 — Static HTML Flight Recorder Report (the smallest first build)

**Offline, deterministic, no DB/cloud/LLM/PLC.** A renderer over the existing `run_pipeline()` JSON →
one self-contained HTML file Mike double-clicks. Reuses the inline-CSS pattern of
`docs/sample-reports/weekly-digest/2026-04-28_weekly-digest.html`. Sections:

1. **Asset/scenario header** — Northwind Bottling / CV-200 (backing `filler01`), scenario, seed, "deterministic".
2. **Executive summary** — one paragraph: what changed, how bad, what to check first (manager-readable).
3. **Difference cards** — one card per observation (signal, normal range, current, magnitude, kind).
4. **Event timeline** — the grouped machine event on a simple time axis.
5. **Baseline vs current** — normal range vs current value per abnormal signal (bar/inline sparkline).
6. **Explain panel** — MIRA's answer + recommended checks.
7. **Evidence / citations panel** — abnormal tags + cited manuals (from the evidence bundle).
8. **Learn / review preview** — proposed context updates with accept / reject / **escalate** (static preview of the decision).

The report answers the manager's questions 1:1: *what machine, what signals, what tags approved, what
changed, what event, what evidence, what to check first, what was learned, what is still unproven.*

## 7. Phased plan

- **Phase 1 (weekend):** the static HTML report renderer above. **Recommended first.**
- **Phase 2:** a Hub readout at `/hub/difference-engine/report/[id]` that renders the same bundle,
  reusing `WhyMiraThinksThis.tsx` (explanation) + `review-queue.tsx` (Learn decisions) + `/api/decision-trace`.
  Bridge `run_pipeline()` JSON via the existing Python-service pattern (see visual-workflow discovery §8).
- **Phase 3:** persist/reference real ids — link a live Flight Record to a `decision_traces` row, a
  `tag_events`/historian window, and ADR-0017 proposal ids; add PDF export (`tools/proof/build_pdf.py`);
  wire live Connect adapters (Litmus/Ignition/Sparkplug). Optional Langfuse/Phoenix span export — never required.

## 8. Reuse map (authoritative "do not rebuild")

Capture: `simlab/flight_recorder.py` (#2335), `tag_events`(033), historian (#2350/#2354), Sparkplug (#2358).
Difference: `plc/conv_simple_anomaly/*`, `run_pipeline()`. Evidence: `simlab/diagnostic.py`.
Explanation: `decision_traces`(032/055), `/api/decision-trace`, `WhyMiraThinksThis.tsx`.
Decision/learning: `proposal_transition.py` (ADR-0017), `review-queue.tsx`, `/decide` routes, `kg_*.approval_state`.
Report skin: `docs/sample-reports/weekly-digest/*.html`; PDF `tools/proof/build_pdf.py`. Demo mode: demo tenant + `sessionOrDemo`.

## 9. Acceptance criteria

**Phase 1 (non-programmer):** Mike opens `Flight-Recorder-Report.html` in a browser and, with **no
CLI/JSON/code**, reads the 8 sections above for scenario A/B/D/F; the file is shareable/printable; two
renders of the same (scenario, seed) are byte-identical. **CI:** a deterministic test asserts each
section is present and stable. **No** DB/cloud/LLM/PLC touched.

## 10. Constraints / rules

Offline-first · deterministic · no DB/cloud/live-LLM in Phase 1 · no PLC writes · reuse review queue +
report styling + demo mode + evidence/decision-trace concepts · LangGraph rejected (ADR-0011) ·
Langfuse/Phoenix optional adapters only (ADR-0022) · honest caveats section (CV-200 = alias over
`filler01`; templated-but-grounded Explain; scenario E yields no event).

## 11. Risks / caveats

- **Name collision:** "flight recorder" already names the Layer-0 SimLab tape (#2335). This PRD is the
  Layer-1 *record* + Layer-2 *readout* on top — reference #2335's tape, don't fork it.
- **Two decision-trace surfaces** could drift (`WhyMiraThinksThis.tsx` vs the static report). Keep the
  report a *rendering* of the same bundle, not a second source of truth.
- **Escalate** is new as a first-class outcome; it maps to ADR-0017 `flag_review → needs_review` — reuse, don't invent a new enum.

## 12. Recommendation + exact files if approved

**Yes — Phase 1 static HTML remains the best next build.** It is the only genuinely missing piece
(Layer 2 readout), needs no Hub/DB/cloud, is testable by Mike this weekend, and becomes the "Export"
artifact Phase 2 reuses. It rebuilds nothing on the do-not-rebuild list.

**Files touched if approved (small, offline, deterministic):**
- **NEW** `demo/factory_difference_engine/flight_report.py` — `render_report(run_pipeline_result) -> html_str` (self-contained, inline CSS from the weekly-digest pattern).
- **MODIFY** `demo/factory_difference_engine/__main__.py` — add `--html <path>` (write the report; optional `--open`).
- **NEW** `tests/simlab/test_flight_report.py` — deterministic: each of the 8 sections present; two renders identical; offline.
- **MODIFY (docs only)** `demo/factory_difference_engine/README.md` — document `--html`.
- **Reuse read-only (not modified):** `docs/sample-reports/weekly-digest/*.html`, `run_pipeline()`.

No other files. No commit until you ask.
