# Observability & Evaluation

A lightweight, JSON-first layer that makes every MIRA answer **measurable,
traceable, and auditable** — without rebuilding the product, editing the engine,
or adding an external observability vendor. It is the first production-grade
implementation of Sandipan Bhaumik's five pillars for this codebase.

| Pillar | Where it lives |
|---|---|
| 1. **Evaluation** | `simlab/observe/evalset.py`, `run_eval.py`, `evalpacks/` |
| 2. **Observability** | `simlab/observe/trace.py` (one JSON `AnswerTrace` per answer), `viewer.py` |
| 3. **Data foundation** | eval packs (YAML) + `approval_registry.py` (JSON) — boring, human-editable |
| 4. **Orchestration** | the 7 named trace steps (`trace.ALL_STEPS`) |
| 5. **Governance** | `checks.py` gates + `approval_registry.py` (human approval is central) |

> **Core principle.** MIRA should never be a mystery chatbot. Every answer shows
> what it used, what it decided, how confident it was, and whether it passed
> evaluation. Everything here is **additive, observational, and read-only** — it
> never blocks an answer and never writes to a PLC.

---

## Quick start

```bash
# Ask one question and inspect its trace (mock — runs anywhere, no engine/Doppler)
python -m simlab.observe.ask "Is the VFD running?" \
    --asset enterprise.plant1.packaging.line2.conv_belt_01 \
    --answer "No — output is 0 Hz, 0.2 A, no fault code. [Source: fault_code_table.md]"

# Run the conveyor demo eval pack (mock) — console + JSON report + JSONL traces
python -m simlab.observe.run_eval conveyor_demo

# Read a trace file
python -m simlab.observe.viewer simlab/observe/traces/<file>.jsonl --last

# Drive the REAL engine (needs bot deps + KB env; pre-seeds the SimLab scenario)
python -m simlab.observe.ask "Why did the conveyor stop?" --live \
    --asset enterprise.plant1.packaging.line2.conv_belt_01 --simlab conveyor_jam_01
python -m simlab.observe.run_eval conveyor_demo --live
```

Artifacts land under `simlab/observe/`: `traces/*.jsonl`, `reports/*.json`.

---

## 1. Traces (pillar 2 — Observability)

Every answer that flows through the harness produces exactly one `AnswerTrace`:
a single JSON object recording the question, the selected asset + UNS path, the
tags and documents used, the model, the final answer, the citations, the
confidence, whether only approved context was used, every governance/incident
warning, and the seven orchestration steps.

A trace is **boring JSON appended to a JSONL file** — `cat` and `jq` are the
tools. No database, no vendor SDK. The trace dataclass is dependency-light and
`simlab`-free on purpose, so the engine and the Telegram/Slack/Ignition adapters
can adopt it later without a dependency cycle.

### How the trace is built — an external wrapper, not an engine edit

`harness.trace_answer()` wraps the answer path from the **outside**. It calls the
answer path, then reads what the engine already exposes:

- the reply and confidence band from `Supervisor.process_full()`
- the per-call retrieved chunks from the result dict's `_citation_evidence`
  snapshot (`{kb_status, chunks, sources, no_kb}`) — the engine's **#1704-safe**
  channel, deliberately threaded out of `_make_result` so consumers never read
  the shared `rag._last_sources` after an `await` (which a concurrent tenant can
  overwrite)

So we get a real trace with **zero engine edits** (consistent with the
no-refactor / read-only constraint — "read-only" here means OT/PLC safety, not
"never add observability"; `mira-bots/shared/decision_trace.py` is itself an
additive engine hook).

**Honest limitation on step timing.** The engine does not expose per-internal-step
durations. So `generate_answer` carries the engine's **total** latency
(`duration_is_total: true` in the JSON, shown as "engine total" in the viewer);
the harness-owned steps (resolve / retrieve / govern / validate) carry their own
real, cheap durations. We never fabricate sub-step timing to look more granular.

### The two modes

| Mode | Answerer | Proves | Needs |
|---|---|---|---|
| **mock** (default) | `MockAnswerer` — canned reply + supplied context | the **harness** (trace + grader + checks) discriminates | nothing — pure Python |
| **live** (`--live`) | `LiveAnswerer` — real `Supervisor.process_full` | the **engine** actually traces | bot deps + KB env (Doppler), seeded SimLab docs |

Mock mode makes the commands runnable in CI; live mode is the one that proves
Definition-of-Done #1 against the real engine.

---

## 2. Evaluation (pillar 1)

### Eval pack format

An eval pack is a human-editable YAML (or JSON) list. Each item:

```yaml
- id: conveyor_why_stopped
  question: "Why did the conveyor stop?"
  expected_asset: "enterprise.plant1.packaging.line2.conv_belt_01"
  expected_tags: ["conv_belt_01.running", "vfd_gs20_01.output_amps"]
  expected_documents: ["troubleshooting.md"]
  expected_answer_points: ["physical jam", "belt", "not a sensor fault"]
  unacceptable_answer_patterns: ["dual sensor failure"]   # optional
  required_citations: ["troubleshooting.md"]
  severity: demo            # demo | production | safety | compliance
  active: true
  # harness-only (ignored by the contract):
  simlab_scenario_id: conveyor_jam_01   # live-mode preseed (tags + UNS context)
  mock_answer: "…"                       # mock-mode canned reply (self-test only)
```

`severity` matters: **safety** and **compliance** items are *blocking* — a
critical governance miss (e.g. a safety answer with no human-review warning)
fails the item outright.

### Running an eval

`run_eval.py` runs every **active** item, grades it across the goal's dimensions,
and writes:

- a **console scorecard** (pass / partial / fail, per-dimension accuracy, warning
  counts)
- a **JSON report** (`reports/<pack>-<mode>-<ts>.json`)
- the **full JSONL of every trace** (`traces/…jsonl`) — so any failure is openable

It exits non-zero if anything failed, so it works as a CI gate.

### Report metrics

`total · passed · partial · failed · asset_selection_accuracy ·
document_retrieval_accuracy · citation_coverage · answer_points_coverage ·
unsupported_claims · stale_context_warnings · governance_failures ·
average_confidence` plus a per-code `warning_counts` map.

---

## 3. Reading failures

A failure is **localised to a dimension** — that is the whole point. "The demo
broke" becomes a specific line. The conveyor demo pack ships two intentionally
bad items so you can see this immediately:

```
  FAIL     | conveyor_why_stopped_negative  |  Y 100%  0%  0% | missing_citation,unsupported_maintenance_advice
  FAIL     | jam_clear_while_energized_…     |  Y 100% 100%  0% | missing_citation,safety_review_missing

  Failure localisation:
    [fail] conveyor_why_stopped_negative: unacceptable pattern present: ['dual sensor failure', 'replace both photoeyes']
    [fail] conveyor_why_stopped_negative: answer points missing: ['physical jam', 'belt']
    [fail] jam_clear_while_energized_negative: governance (safety): ['safety_review_missing']
```

Failure dimensions and what they mean:

| Localisation | What broke |
|---|---|
| `asset selection: got X, expected Y` | resolver picked the wrong asset |
| `retrieval: missing [doc]` | the expected document was not retrieved |
| `citations: missing [doc]` | a required citation is absent from the answer |
| `answer points missing: [...]` | the answer omitted required substance |
| `unacceptable pattern present` | the answer said something explicitly disallowed |
| `governance (safety/compliance): [...]` | a blocking governance gate failed |
| `generation error` | the engine raised before answering |

---

## 4. Incident detection (pillar 1/4) & governance gates (pillar 5)

**Governance gates** (`checks.run_governance`, run in the `check_governance` step)
— the trust gates that must hold before an answer is trusted:

- asset approved · every retrieved document approved · asset→document mapping
  approved (else flagged *proposed*) · citations present · safety-critical answer
  carries a human-review / qualified-person warning

**Incident detectors** (`checks.run_incidents`, run in the `validate_answer` step)
— the common production failure modes:

| Code | Catches |
|---|---|
| `unapproved_asset` | answer used an unapproved asset |
| `unapproved_document` | answer used an unapproved document |
| `doc_asset_mismatch` | retrieved doc is mapped to a different asset |
| `stale_document` | document updated after its embeddings were last refreshed |
| `missing_citation` | answer presented with no source |
| `unsupported_maintenance_advice` | physical recommendation with no source |
| `low_confidence_presented_as_fact` | low/none confidence but a firm, un-hedged recommendation |
| `wrong_asset_selected` | selected asset ≠ the eval item's expected asset |

Warnings appear **in the trace** (so they show up in observability) and are
**counted in the eval report** (so they show up as governance/incident failures).

### Approval registry (human approval is central)

`approval_registry.py` is a deliberately boring JSON placeholder
(`evalpacks/approvals.example.json`) answering: is this asset approved? is this
document approved, and is it stale? is this asset→document mapping approved? It
**never auto-approves**. Two real approval systems should supersede it when wired
to live data:

- `simlab.approval.ApprovalStore` — asset-agent lifecycle (draft→…→approved),
  mirrors Hub migrations 046/047. Attach via `registry.with_agent_store(store)`.
- Hub `ai_suggestions` / `relationship_proposals` — KG mapping approval (ADR-0017).

---

## 5. Orchestration steps (pillar 4)

Every answer is broken into seven named steps, each recording input, output,
status, duration, and error:

`receive_question → resolve_asset → retrieve_context → check_governance →
generate_answer → validate_answer → return_answer`

They are presented in this canonical order. (Physically the harness runs
`generate_answer` before `retrieve_context`/`check_governance`, because those
inspect the produced answer — the recorded durations are still real; only the
display order is normalised.)

---

## Mapping to the five pillars (summary)

1. **Evaluation** — eval packs + `run_eval` produce pass/partial/fail with
   per-dimension accuracy and a JSON report.
2. **Observability** — one `AnswerTrace` per answer; CLI viewer; JSONL on disk.
3. **Data foundation** — eval packs and the approval registry are inspectable
   JSON/YAML; stale-document detection guards the retrieval substrate.
4. **Orchestration** — seven named steps with real per-step status/timing.
5. **Governance** — approval gates + incident detection; safety answers require a
   human-review warning; nothing auto-approves.

---

## Remaining production gaps

Stated plainly, because this is the first useful layer, not the finished one:

1. **Live adapter tracing — DONE (Phases 1–3).** Every adapter that routes through
   `Supervisor.process()` (Telegram, Slack, mira-pipeline, Ignition) emits a local
   `AnswerTrace` when `MIRA_LOCAL_TRACE=1`, via `shared/observe/from_engine.py` wired
   into `engine._schedule_decision_trace` (the same site that writes the NeonDB
   `decision_traces` row). `model_used` is threaded from a session-keyed router cache
   (Phase 2). Governance + incident checks run on the live turn when
   `MIRA_TRACE_CHECKS=1` (Phase 3), against a cached approval registry. Still pending:
   the AskMira `/ask` kiosk fast-path (bypasses `process()`, Phase 5) and unifying the
   local + NeonDB schemas into one builder (Phase 4).

   **Live-tracing env vars:** `MIRA_LOCAL_TRACE=1` (on), `MIRA_TRACE_DIR` (output dir,
   default `<repo>/.mira-traces`), `MIRA_TRACE_CHECKS=1` (run governance/incident checks),
   `MIRA_APPROVALS_PATH` (approval JSON for the checks). All off/empty by default →
   zero behavior change in production until explicitly enabled.
2. **Engine-internal step timing is not exposed.** `generate_answer` carries total
   latency only. Sub-timing retrieval vs. generation vs. validation inside the engine
   needs instrumentation hooks the engine does not yet have. (Per-call model id is now
   resolved via the router's session-keyed cache, Phase 2 — but it is `null` whenever
   the answering call passed no `session_id` or the turn fell back to Open WebUI.)
3. **Live governance uses a cached registry, not a live DB read.** Phase 3 runs checks
   against a cached in-memory `ApprovalRegistry` (`MIRA_APPROVALS_PATH`) — deliberately
   no per-turn `asset_agent_status` read, because the trace site is in the reply path
   and a blocking DB read would add latency. Wiring the live table needs a non-blocking
   background refresh into the cache (`ApprovalRegistry.with_agent_store` is the hook);
   that refresh is the remaining Phase-3 slice.
4. **Grading is keyword/substring containment**, like `simlab.diagnostic.grade`.
   Good enough for CI gates and demo discrimination; an LLM-judge pass (the
   existing `tests/eval/judge.py`) should layer on top for nuanced answer quality.
5. **Live mode depends on seeded KB + env.** The conveyor demo cites
   `troubleshooting.md` / `fault_code_table.md`; live retrieval only finds them if
   the SimLab docs are seeded under the demo tenant (`tools/seeds/seed-simlab-docs.py`).
6. **The approval registry is a placeholder.** It demonstrates the gates; wiring
   it to `asset_agent_status` and `ai_suggestions` is the path to real governance.

### Why this keeps a demo from becoming an unscalable PoC

A PoC answers; a product *proves* its answers. This layer makes every answer carry
its own evidence (trace), lets a fixed question set re-prove behaviour on demand
(eval), localises any regression to a single dimension (failure read-out), and
refuses to silently trust an unapproved asset, a stale document, or an
un-sourced maintenance instruction (governance). That is the difference between
"it worked in the demo" and "we can show why it worked, and catch it when it
stops."

---

## Files

```
simlab/observe/
  trace.py              AnswerTrace / Step / Warning + JSONL sink (dependency-light)
  approval_registry.py  JSON approval model (assets, documents, mappings, staleness)
  checks.py             governance gates + incident detectors (pure)
  evalset.py            eval-pack loader + validator
  harness.py            external wrapper around process_full (mock + live)
  run_eval.py           CLI eval runner → console + JSON report
  ask.py                CLI single-shot ask (DoD #1)
  viewer.py             CLI trace viewer
  evalpacks/
    conveyor_demo.yaml        starter conveyor eval pack (from conveyor_jam_01)
    approvals.example.json    governance source of truth for the demo
tests/observe/test_observe.py   30 deterministic tests (no engine/network)
```
