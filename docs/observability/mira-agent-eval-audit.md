# MIRA Agent Evaluation, Tracing & Observability Audit

**Date:** 2026-06-11
**Question:** Should MIRA adopt Arize Phoenix, or improve its existing eval/observability system?
**Verdict:** **EXTEND** the existing system. Phoenix stays **optional, off by default.** No LangGraph migration (ADR-0011 is current).

MIRA is an **industrial maintenance diagnostic agent with a chatbot interface** — so evaluation must cover what a generic-chatbot eval does *not*: live PLC/SCADA tag freshness, stale-data handling, correct asset (UNS) context, document grounding, citations, safety refusal, and technician usefulness. This audit measures the current system against that bar, then implements the smallest useful gap-fill.

---

## 1. What MIRA currently uses for evaluation

MIRA already has a **mature, multi-layer eval stack** — this is not a greenfield. All of the following is real, running code (not just documented):

| Layer | Where | What it does | Wired into CI? |
|---|---|---|---|
| **5-regime eval framework** | `tests/eval/` (`run_eval.py`, `offline_run.py`, `grader.py`, `judge.py`, 57 YAML fixtures, 215 scorecards in `runs/`) | Fires scenarios through the engine; 6 deterministic binary checkpoints + LLM-as-judge (5 Likert dims: groundedness, helpfulness, tone, instruction-following, flow) | Nightly Celery on VPS |
| **Staging gate** | `tools/staging_test.py` (`staging-gate.yml`) | In-process `Supervisor` against NeonDB staging, 15 questions, rubric pass criteria (avg ≥ 3.5, no safety == 1) | **YES — the only *required* PR check** |
| **DeepEval suite** | `mira-bots/benchmarks/deepeval_suite.py` (`deepeval-ci.yml`) | `deepeval` with a Groq judge: AnswerRelevancy, ConversationCompleteness, GEval; fails < 80 % | Yes (non-required) |
| **RAGAS + DeepEval (RAG)** | `evals/ragas_eval.py`, `evals/deepeval_eval.py` | Faithfulness / answer-relevancy / context-precision / context-recall (RAGAS); Hallucination / Bias (DeepEval) | Manual / advisory (RAGAS CI step is `continue-on-error` — `query_stub.py` live mode is broken) |
| **Weekly MIRA-bench** | `tests/mira_bench.py` | Grounded-vs-raw-LLM baseline, regression issue on drift | Weekly schedule |
| **QA regression** | `tests/qa_regression.py` | 5 questions through staging Telegram every 2 h, judge-scored | 2-hourly schedule |
| **Active learning** | `mira-bots/tools/active_learner.py` | 👎 feedback → anonymised fixture drafts → draft PRs | Nightly |
| **Benchmark DB** | `mira-bots/shared/benchmark_db.py` (SQLite) | Per-question results + multi-turn composite judge scores (evidence_utilization, path_efficiency, gsd_compliance, root_cause_alignment, expert_comparison) | — |

**Conclusion:** MIRA's eval *scoring* is strong and covers grounding, citations, safety, and usefulness via the judge rubric and RAGAS/DeepEval. **Keep all of it unchanged.**

---

## 2. Does MIRA currently have Phoenix-style agent traces?

**No — not in production.** A "Phoenix-style trace" is a single per-turn structured record tying together: user question · asset/UNS context · tenant · live tags used + freshness · retrieved chunks · tool calls · final answer · citations · safety/refusal flags · evaluator scores.

What exists today and why it falls short:

| Artifact | Where | Gap |
|---|---|---|
| **`decision_traces` NeonDB row** (ADR-0022) | `mira-bots/shared/decision_trace.py`, Hub mig 032 | The closest thing — captures UNS path, question, tag/manual/KG evidence, recommendation, `citations_present`, latency. **But:** NeonDB-only (needs `NEON_DATABASE_URL`); and several columns are **never populated** — `model_used`, `kg_evidence`, `technician_confirmed` are always `None`/`[]`, and there is **no** groundedness score, tool-call log, or live-tag freshness/age. |
| **Langfuse trace** | `mira-bots/shared/telemetry.py` | Wrapper created per turn but **silently no-ops in prod** — `trace_id` is `None` whenever `LANGFUSE_SECRET_KEY` is unset (the prod default). Spans are never populated with evidence. |
| **`benchmark_db` row** | SQLite | Offline-benchmark only, not a live-turn trace. |
| **Arize Phoenix / OpenTelemetry** | — | **Zero presence.** No Phoenix, no Arize, no OTel SDK anywhere in the codebase. |
| **Grafana / Prometheus / Flower** | `docker-compose.observability.yml` | Defined but **never deployed** — the `observability/` config dir doesn't exist; stack has never started. |

So: MIRA has *scattered* per-turn data (state dict, `decision_traces`, `interactions`, `api_usage`, logs) with **no unified, inspectable, cloud-free trace**, and the most complete artifact (`decision_traces`) has known dead columns and is NeonDB-bound.

### Industrial-specific gap — live tag freshness

The relay (`mira-relay/clock_resolver.py`, commit `d6064dd2`) computes real per-reading freshness — `timestamp_source`, `sample_age_seconds`, `degraded` — but that lives **only in NeonDB tag tables** and is never read back into a diagnostic turn. The engine's own live snapshot (`_maybe_attach_live_snapshot` → `live_snapshot.normalize`) marks each tag `good`/`stale`/`unknown` (via the `vfd_comm_ok` trust gate) and renders a `[STALE]` marker, **then discards the structured snapshot** after building the text block.

> **Honesty note — stale-data refusal is NOT enforced today.** The `[STALE]` marker is *informational* only: it tells the LLM the value is suspect, but **no code path blocks, refuses, or alters the turn based on tag quality.** This trace layer makes stale-data *observable and eval-able*; it does not, by itself, create refusal behavior. Building a stale-data refusal gate is a separate, future change.

---

## 3. Recommendation: KEEP eval, EXTEND tracing, Phoenix OPTIONAL

| Option | Verdict | Why |
|---|---|---|
| RAGAS, DeepEval, `tests/eval/` 5-regime, judge | **KEEP unchanged** | Mature, Apache-2.0, local, already CI-wired. No gap in *scoring*. |
| Per-turn agent trace | **EXTEND** (this PR) | The real gap: no unified, cloud-free, inspectable per-turn record. |
| **Arize Phoenix** | **OPTIONAL, off by default** | Apache-2.0, self-hostable, OTel-based — a good *viewer*, but adding it as a required service duplicates Langfuse and adds load to an 8 GB VPS known to OOM. Wire it as an opt-in OTLP export target, not a dependency. |
| **Langfuse** | Already present — leave as-is | Self-hostable, no-op without keys. The wrapper stays; we don't expand it. |
| **Grafana/Prometheus** | Already defined — out of scope here | Metrics layer; not a per-turn LLM trace. |
| **LangSmith** | **Skip** | Mandatory SaaS endpoint → violates "CI/local must not require a running external service"; LangChain-coupled. |
| **LangGraph** | **Skip** | Violates PRD §4 #3 (no framework that abstracts the LLM call); **ADR-0011 (Accepted, current)** rejects it. Revisit only at multi-agent "Config 4+" with a formal constraint revision. Not obsolete. |

**Smallest practical improvement (implemented in this PR):** a lightweight, dependency-light, **cloud-free** structured agent-trace module with JSON export, plus an **optional** OpenInference/OTLP export that no-ops unless an endpoint is configured. Phoenix becomes a place you *can* point it, never a thing CI or local dev needs running.

---

## 4. What was implemented

### `mira-bots/shared/agent_trace.py` (new)

- **`AgentTrace` dataclass** — one Phoenix/OpenInference-shaped record per turn: `trace_id`, `ts`, `session_id`, `tenant_id`, `platform`, `fsm_state`, `user_question` (PII-sanitised), `asset` (uns_path/source/confidence/mfr/model/fault), `live_tags` + derived `live_tag_count`/`stale_tag_count`/`live_tag_quality`/`live_tag_snapshot_ts`/**`live_tag_age_seconds`**, `retrieved_documents`, `tool_calls`, `final_answer`, `confidence`, `citations_present`/`citation_count`, `safety_triggered`, `groundedness_score`, `model_used`, `outcome`, `latency_ms`.
- **`build_agent_trace(...)`** — pure builder. **Reuses** `decision_trace`'s `_sanitize`, `_manual_evidence_from_sources`, `citations_present_in`, `_CITATION_TAG_RE` (no duplication). Derives tag freshness from the engine's own `LiveTagSnapshot` list.

> **Freshness caveat — read this before trusting `live_tag_age_seconds`.** The authoritative staleness signal from the engine path today is the per-tag **`quality`** band (`good`/`stale`/`unknown`) and **`stale_tag_count`**, driven by the `vfd_comm_ok` comms-trust gate — a real "link lost / value suspect" indicator. `live_tag_age_seconds = now − snapshot_ts` is honest math but, from the engine path, `snapshot_ts` is stamped at tag-*attach* time, not data-*capture* time, so it ≈ diagnostic latency (~turn duration), **not** how old the PLC reading is. It becomes a true age only when the builder is fed a snapshot whose `ts` is a real capture time — i.e. once the relay's `sample_age_seconds` (follow-up #2) is plumbed in. The audit and the module docstring both state this so the field isn't mistaken for staleness.
- **`export_jsonl(trace, path=None)`** — appends one JSON line. No-op unless `path` or `MIRA_AGENT_TRACE_FILE` is set. Fail-open.
- **`export_otel(trace)`** — emits an OpenInference span (`openinference.span.kind`, `input.value`, `output.value`, `retrieval.documents.count`, `mira.*`) to `MIRA_OTEL_ENDPOINT` via OTLP/HTTP. No-op when the endpoint is unset **or** `opentelemetry` isn't installed (`ImportError` caught) — so it never becomes a required dependency. Fail-open. Point it at a self-hosted Arize-Phoenix collector to get a Phoenix UI.
- **`emit(trace)`** — best-effort fan-out to both sinks; never raises.

### `mira-bots/shared/engine.py` (2 surgical edits)

1. `_maybe_attach_live_snapshot` now **stashes** the computed `LiveTagSnapshot` list on `self._last_live_snapshots` (reset per turn — same carryover discipline as the RAG worker's `_last_sources`) instead of discarding it. This is what makes live-tag freshness *real* in the trace rather than synthetic.
2. `_schedule_decision_trace` calls a new guarded `_emit_agent_trace(...)`, reusing the evidence it already gathered (UNS context, RAG sources, reply, outcome, latency). **Default behavior is unchanged:** with no sink env var set, `emit()` is a silent no-op — prod and CI write nothing and need nothing running.

### Not-yet-wired fields (explicit, not hidden — avoiding the `decision_traces` dead-column trap)

These `AgentTrace` fields stay `None`/`[]` from the engine hook **by design today**, and a test asserts it:

- **`tool_calls`** — the FSM dispatches DST/KG/CMMS/scrape inline without discrete tool spans.
- **`groundedness_score`** — the self-critique 1–5 scores exist (`engine._self_critique_diagnosis`) but aren't forwarded to the trace yet.
- **`model_used`** — the router logs per-call model to `api_usage` (SQLite), not joined to the turn yet.

They are real schema slots ready for follow-up wiring; the doc and a unit test make their emptiness explicit rather than implying coverage.

### Tests — `mira-bots/tests/test_agent_trace.py` (new)

Proves a trace captures each required field, grounded in the **real** `normalize`/`LiveTagSnapshot` shapes:

- user question (+ PII scrubbed) · asset/UNS context · **live tag snapshot + age (30 s derived)** · stale-tag count + worst quality · retrieved documents · final answer · citations (present + count) · safety/refusal flag.
- JSON round-trip (re-hydrate the dataclass).
- both export sinks no-op without env (no DB, no cloud, no running service); JSONL writes when a path is given.
- a trace built from the **exact engine-hook evidence shape** leaves `tool_calls`/`groundedness_score`/`model_used` empty while populating the wired fields.

**Result:** 31/31 pass (new + `test_decision_trace` + `test_engine_live_snapshot`) under `.venv` (Python 3.12). Broader `mira-bots/tests/`: 833 passed; the 21 unrelated failures are pre-existing missing-optional-dep errors in adapter tests (`jwt`, the `mira-bots/email` stdlib shadow) — identical with this change stashed. `ruff` clean.

---

## 5. How to use it

```bash
# Local / eval — write JSON-L traces you can diff between runs (no service needed):
export MIRA_AGENT_TRACE_FILE=tests/eval/traces/agent_traces.jsonl

# Optional — also stream OpenInference spans to a self-hosted Phoenix/OTLP collector:
export MIRA_OTEL_ENDPOINT=http://localhost:6006/v1/traces
pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http   # optional extras
```

Neither variable is set in CI or prod by default, so behavior there is unchanged.

---

## 6. Follow-ups (not in this PR)

1. Forward the self-critique groundedness score and the router's `model_used` into the trace (fills two of the three not-yet-wired fields).
2. Plumb the relay's `sample_age_seconds`/`timestamp_source` into the engine turn so `decision_traces` and the agent trace carry true clock-source freshness, not just the `vfd_comm_ok` quality band.
3. Decide whether a **stale-data refusal gate** (block/caveat troubleshooting when live tags are `stale`) is warranted — currently `[STALE]` is informational only.
4. Optionally add a self-hosted Phoenix stanza to `docker-compose.observability.yml` alongside the (still-undeployed) Prometheus/Grafana stack.

## References

- Audit basis: `mira-bots/shared/{engine.py,decision_trace.py,live_snapshot.py,telemetry.py,benchmark_db.py}`, `tests/eval/`, `evals/`, `docker-compose.observability.yml`
- ADR-0011 (no LangGraph), ADR-0010 (Karpathy eval alignment), ADR-0022 (decision-trace & tag-stream storage)
- Constraints: root `CLAUDE.md` PRD §4 (Apache-2.0/MIT, no LLM-abstraction framework, no Anthropic), `docs/environments.md`
