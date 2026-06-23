# Phase 5 — MIRA Integration Plan

**Goal:** make the Phase 2/3 explanation output (ranked causes + evidence for/against + technician checks + citations) appear inside the existing MIRA answer path — **no second chatbot, no second endpoint, no extra LLM round-trip.** Grounded to the engine-seam deep dive (file:line). 2026-06-23.

## The turn pipeline (where we plug in)

| # | Hop | file:line |
|---|---|---|
| 1 | Adapter sets `uns_source="direct_connection"`, builds `tag_evidence` | `ignition_chat.py:511-535` |
| 2 | `engine.process(... uns_source=, tag_evidence=)` | `ignition_chat.py:608-615` |
| 3 | `process()` (timeout wrapper, reply-string contract) → `process_full()` | `engine.py:1153-1166`, `1204-1213` |
| 4 | `process_full()` resolves UNS, routes FSM/RAG/diagnosis | `engine.py:1763-1771` |
| 5 | result assembled via `_make_result(reply, confidence, trace_id, …, citation_evidence)` | `engine.py:1062-1090` |
| 5a | per-turn retrieval snapshot `_evidence_from_parsed(parsed)` → `{kb_status, chunks, sources, no_kb}`, threaded as `_citation_evidence` | `engine.py:1092-1105` |
| 6 | citation rewrite + gap admission (reuses `citation_compliance.py`) | `engine.py:1107-1147, 1254` |
| 7 | **`_schedule_decision_trace(...)` — fire-and-forget, POST-reply** | `engine.py:1268-1277, 1292-1363` |
| 8 | `decision_trace.build_trace_row(...)` (pure) → `_insert` → `decision_traces` | `decision_trace.py:112-157, 175-208` |
| 9 | Ignition envelope `{answer, sources, citations, evidence, confidence, suggested_actions}` — **all empty except `answer`** | `ignition_chat.py:654-664` |
| 10 | Hub reads `GET /api/decision-trace/[id]` → `WhyMiraThinksThis.tsx` renders confidence/manual/tags/KG/outcome | `route.ts:35-44`, `tsx:181-258` |

## The plug-in seam (recommended)

**A pure `explain_cause(...)` post-processor, called inside `_schedule_decision_trace` (engine.py:1292-1363), writing a new `explanation` JSONB column on `decision_traces` via the existing pure `build_trace_row`.**

```python
# decision_trace.py — one new kwarg + one row key (mirrors tag_evidence/manual_evidence pattern)
def build_trace_row(*, ..., explanation: Optional[dict] = None) -> dict:
    ...
    row["explanation"] = json.dumps(explanation or {})
    return row
```
```python
# new pure transform — NO LLM, NO new route, fail-open ({} on error)
def explain_cause(*, reply, uns_context, citation_evidence, tag_evidence, confidence) -> dict:
    return {
      "most_likely_cause": ...,
      "ranked_causes": [...],
      "evidence_for": [...],
      "evidence_against": [...],     # realizes the deferred PRD §11 "context_ignored"
      "technician_checks": [...],    # realizes the deferred "next_check"
      "manual_citations": citation_evidence.get("sources") or [],
    }
```
Call it where `manual_sources` is already derived from `result["_citation_evidence"]` (`engine.py:1339-1341`) and thread into `write_trace(...)` (`engine.py:1352-1363`).

### Why this satisfies every constraint
- **Reply path unchanged.** `_schedule_decision_trace` runs *after the reply is returned* ("adds zero latency", `decision_trace.py:14-18`). The technician's answer never passes through `explain_cause`.
- **No second chatbot / endpoint / LLM.** `explain_cause` is a pure transform over evidence the engine already gathered (`_citation_evidence`, `uns_context`, `tag_evidence`). No new provider call.
- **Reuses citation enforcement.** Citations come from the same `_citation_evidence` snapshot `citation_compliance.py` + `_enforce_citation_rewrite` (`engine.py:1107-1147`) already operate on — single source of truth.
- **One producer, two render surfaces.** `GET /api/decision-trace/[id]` adds `explanation` to its SELECT → `WhyMiraThinksThis.tsx` renders new sub-sections (it already has the section scaffolding, `tsx:77-99`); the **empty** Ignition envelope (`ignition_chat.py:654-664`) populates `evidence`/`suggested_actions`/`citations`/`confidence` from the same object.

**Rejected alternatives:** (b) a bare column with no producer is dead; (c) putting `explain_cause` in `ignition_chat.py` would only serve Ignition (Slack/Telegram/Hub route through `engine.process`), duplicate evidence-shaping, and violate "one brain."

## Field map (spine answer-card → existing)

| Spine field | Landing | Status |
|---|---|---|
| `confidence` | `decision_traces.confidence` (mig 055) — already plumbed to `_make_result` + `ConfidencePill`; **just stop emitting `None` in the Ignition envelope** | **DIRECT** |
| manual citations | `decision_traces.manual_evidence` (mig 032) + `manual-rag.ts ManualSource`; envelope `citations`/`sources` | **DIRECT (storage) / PARTIAL (envelope render)** |
| `human_review` | `decision_trace_feedback` (mig 055, `verdict ∈ good/bad/missing_context/needs_review`) + feedback buttons + `POST .../feedback` | **DIRECT — full loop exists** |
| `evidence_for` | from `manual_evidence` + `tag_evidence` (FOR-framing new) | PARTIAL |
| **`evidence_against`** | **`explanation.evidence_against`** (the `context_ignored` idea — NOT a column today) | **NEEDS-NEW-FIELD** |
| **`technician_checks`** | **`explanation.technician_checks`** → render to envelope `suggested_actions` | **NEEDS-NEW-FIELD** |
| `most_likely_cause` / `ranked_causes` | **`explanation`** (reply prose already carries the narrative) | **NEEDS-NEW-FIELD** |
| history | queryable per-asset from `decision_traces`/`cmms_*`; `mira/ask` already computes `transition_fact`/`trend_proposal` | PARTIAL (assemble into `explanation.history`) |

## No-duplicate-chatbot rule (how it's honored)

- The **only** answer producer stays `engine.process()`. `explain_cause` is a **post-hoc structuring** of that turn's evidence, not a re-answer.
- The Ignition surface keeps calling `/api/v1/ignition/chat` → `engine.process` — it does **not** call the spine's `causality`/`evidence_graph` directly. The spine's logic is ported *into* the engine as `explain_cause`, then deleted from the standalone runtime path.
- Bots-side locator gap to close in the same arc: extend `neon_recall.recall_knowledge` + `format_source_label` to select mig-045 `page_start`/`section_path` so `manual_citations` carry `{doc, page, section}`.

## Sequence (Phase 5b, after the Hub writer PR)

1. Add the `explanation` JSONB column migration (`db_migration_plan.md`).
2. Port `causality.explain_cause` + the evidence-graph for/against logic into `mira-bots/shared/` as the pure `explain_cause`; call it in `_schedule_decision_trace`.
3. Render `explanation` in `WhyMiraThinksThis.tsx`; populate the Ignition envelope.
4. Gate: `deepeval-ci.yml` + GS11 grounding + the SimLab grader (engine-side gates fire on `mira-bots/shared/**`).
