# Auto-Research / Continuous Eval Loop for MIRA

**Branch:** `docs/auto-research-eval-loop`  
**Status:** Design — not yet implemented  
**Related:** Issue #195 (sidecar deprecation / pipeline cutover)  
**Author:** Claude Code × Mike Harper  
**Date:** 2026-04-13

---

## Why This Exists

The stress test that ran today (`MIRA-Stress-Test/1.0`, 4,231 requests over 4 hours) proved the framework works mechanically. What it couldn't tell us: *was the diagnostic useful?* Two FSM sessions surfaced — one reached DIAGNOSIS after 14 exchanges (✅), one stuck at ASSET_IDENTIFIED after 3 (⚠️). We don't know why the second session stalled, or whether the 14-exchange success was because the retrieval was good or because the LLM was fluent enough to fake it.

This is the gap that kills AI in production: you can measure throughput; you can't measure correctness without deliberate instrumentation. The goal here is to close that gap with a self-improving loop that runs without Mike having to babysit it.

The design takes Karpathy's maxim seriously: **build the eval set first, then iterate on the system**. Everything else — prompts, retrieval tuning, FSM rule edits — is downstream of having a scorable, reproducible benchmark.

---

## 1. The Problem Frame

### LLM quality vs. agent quality

Standard LLM evals measure writing quality: fluency, coherence, factuality in a vacuum. That's not what matters for a maintenance diagnostic system.

A maintenance technician doesn't care if the response is grammatical. They care if:

1. **The right asset was identified** — Did MIRA correctly parse "GS10 VFD" from a nameplate photo, a terse fault code, or a vague description?
2. **The symptom set was sufficient** — Before diagnosing, did the Q1→Q2→Q3 exchange surface the information actually needed? Did it ask about output voltage when it needed to, or did it go straight to a guess?
3. **Retrieval pulled from the right manual** — A PowerFlex 525 overcurrent fault (F004) and a GS20 overcurrent fault have different root cause trees. The retrieved chunk must come from the right vendor section. Cross-vendor retrieval is a hallucination in disguise.
4. **The diagnosis was actionable** — Not "check the drive parameters" — specifically which parameter, what the expected value is, what the symptom looks like when the fix works.
5. **The FSM state matched the conversation stage** — Reaching DIAGNOSIS after only 2 exchanges (before enough symptoms were gathered) is just as bad as never reaching it. State-response alignment matters.

These five criteria form the core eval rubric. They are **binary by default** — not because nuance doesn't exist, but because binary checkpoints compose into regression suites, and regression suites prevent shipping broken versions. Nuance is for improvement direction, not for merge gates.

### What this is not

- An LLM benchmark (MMLU, HellaSwag, etc.) — those measure language model capabilities, not agent system quality
- A latency SLA (though we track latency, it's not the primary signal)
- A user satisfaction study (we don't have users at scale yet — this is what lets us get there)

---

## 2. Intelligence Stack Layers

MIRA is a pipeline, not a model. Each layer introduces its own failure modes. They must be measured independently so a regression in retrieval doesn't get misattributed to the LLM (or vice versa).

### Layer 0: Router / Provider Cascade

**What it is:** `InferenceRouter` in `mira-bots/shared/inference/router.py` — tries Groq → Cerebras → Claude → Open WebUI in sequence.

**What to measure:**
- `provider_used`: which provider handled the request (Groq / Cerebras / Claude / OW-fallback)
- `fallback_count`: how many providers were tried before success
- `latency_ms`: wall-clock time from first provider call to response
- `token_cost`: approximated (Groq/Cerebras free tier; Claude by token; log provider + model)
- `api_error_rate`: HTTP 4xx/5xx rate per provider

**On-point:** Request enters `InferenceRouter.complete()`  
**Off-point:** First successful non-empty response returned  
**Signal:** `fallback_rate > 5%` on Groq = worth investigating. `>20%` = active outage.

**Rubric:** Deterministic. No judge needed. Log these from the router directly.

---

### Layer 1: Intent Classification

**What it is:** `classify_intent()` in `mira-bots/shared/guardrails.py` — routes to "safety" / "industrial" / "help" / "greeting" / "off_topic".

**The known failure mode:** False positives on real maintenance questions. The current default biases toward `"industrial"`, which is correct — but safety keyword matching (22 phrases) can be over-triggered, and the `INTENT_KEYWORDS` list (158+ terms) doesn't catch all valid technical phrasing.

**What to measure:**
- `intent_classified_as`: which bucket was assigned
- `expected_intent`: ground truth from scenario fixture
- `classification_correct`: boolean match
- `safety_false_positive_rate`: `classify_intent(msg) == "safety"` when scenario is not a safety scenario
- `guard_false_positive_rate`: intent classified as non-industrial when scenario requires industrial processing

**On-point:** User message enters `GSDEngine.process()`  
**Off-point:** `intent` returned from `classify_intent()`  
**Signal:** `safety_false_positive_rate > 2%` means real technicians are getting blocked on valid questions.

**Rubric:** Deterministic (compare to ground truth label in scenario fixture).

---

### Layer 2: FSM State Transitions

**What it is:** State machine in `mira-bots/shared/engine.py`. States: `IDLE → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED`. Plus `SAFETY_ALERT`, `ASSET_IDENTIFIED`, `ELECTRICAL_PRINT`.

**Legal transition map** (what the eval enforces):

```
IDLE          → Q1, SAFETY_ALERT
Q1            → Q2, SAFETY_ALERT, DIAGNOSIS (if symptom is clear-cut)
Q2            → Q3, Q2, DIAGNOSIS, SAFETY_ALERT
Q3            → DIAGNOSIS, Q3, SAFETY_ALERT
DIAGNOSIS     → FIX_STEP, DIAGNOSIS
FIX_STEP      → FIX_STEP, RESOLVED, DIAGNOSIS
RESOLVED      → IDLE, Q1
SAFETY_ALERT  → IDLE (only after explicit de-energize confirmation)
ASSET_ID      → Q1 (nameplate photo processed → begin diagnostic)
```

**Illegal transitions that signal a bug:**
- `IDLE → DIAGNOSIS` (skipped symptom collection)
- `DIAGNOSIS → Q1` (regression — re-asking collected symptoms)
- `Q3 → IDLE` (session dropped without resolution)
- `FIX_STEP → Q1` (FSM reset mid-repair)
- Any state → same state 3+ times in a row without new information (stuck-state)

**What to measure:**
- `state_sequence`: ordered list of states visited per session, e.g., `["Q1", "Q2", "Q2", "Q3", "DIAGNOSIS"]`
- `illegal_transitions`: transitions not in the legal map above
- `stuck_state_events`: same state repeated ≥ 3 consecutive turns
- `sessions_reaching_diagnosis`: `final_state == "DIAGNOSIS"` or later
- `median_turns_to_diagnosis`: exchanges before hitting DIAGNOSIS

**On-point:** User turn received by `GSDEngine.process()`  
**Off-point:** `fsm.state` after engine returns  
**Signal:** `stuck_state_rate > 10%` or `median_turns_to_diagnosis > 8` = FSM or prompt problem.

**Rubric:** Deterministic (state reads from SQLite `mira.db`). No judge needed.

---

### Layer 3: Retrieval (NeonDB Brain3 + Open WebUI KB)

**What it is:** `RAGWorker.process()` in `mira-bots/shared/workers/rag_worker.py`. Embeds query → NeonDB recall (`_neon_recall.recall_knowledge()`) → quality gate (similarity ≥ 0.70) → optional Nemotron reranking → chunks injected into system prompt.

**The critical failure modes:**
- **Cross-vendor retrieval:** GS20 question retrieves PowerFlex chunks (same fault symptom, wrong manual). A fluent LLM can write a confident wrong answer from the wrong source.
- **Quality gate miss:** Top chunk similarity = 0.68 → suppressed → LLM runs without context → hallucinates or gives generic answer. This is the intended behavior; the failure is when it happens on equipment *that is* in the KB.
- **Chunk fragmentation:** The answer is split across two non-contiguous chunks; neither one alone contains the diagnosis. Recall@3 looks fine; groundedness fails.

**What to measure:**
- `chunks_retrieved`: count at quality gate exit
- `top_chunk_similarity`: similarity score of rank-1 chunk
- `chunk_vendor_match`: whether retrieved chunk vendor matches query vendor (from scenario fixture)
- `recall_at_3`: if gold chunks are known, fraction of top-3 that include the correct chunk
- `kb_suppressed`: boolean — quality gate fired (no chunks injected)
- `nemotron_active`: whether Nemotron reranking ran and its score distribution

**On-point:** Query text and embedding enter `_neon_recall.recall_knowledge()`  
**Off-point:** Chunks list passed to `_build_prompt_with_chunks()`  
**Signal:** `vendor_mismatch_rate > 5%` = retrieval index problem. `kb_suppressed_rate > 30%` on equipment that should be in KB = embedding or index problem.

**Rubric:** Vendor match is deterministic (parse vendor from chunk metadata). Recall@k requires gold set (build this for the 10 seed scenarios first). Cross-vendor check is a string match.

---

### Layer 4: LLM Output at Each FSM State

**What it is:** The structured JSON response each LLM call must return, given the current FSM state and injected context.

**The GSD system prompt (lines 34–120 in `rag_worker.py`) requires:**
- Single question + 3–4 numbered options (not a monologue)
- JSON format with `reply`, `next_state`, `confidence` fields
- 50-word reply limit (except photo analysis)
- Never invent — only report retrieved/visible facts
- If uncertain, say so explicitly

**What to measure per-state:**
- `json_parse_success`: LLM returned parseable JSON
- `next_state_field_present`: `"next_state"` key in response
- `proposed_state_valid`: in `_VALID_STATES` (or alias-resolvable)
- `options_count`: number of numbered options in reply (expected: 3–4 during Q-states)
- `reply_word_count`: over 100 words in a Q-state = prompt non-adherence
- `hallucination_detected`: response claims fact not in retrieved chunks AND not in system prompt (LLM-as-judge, see §4)
- `confidence_field`: "high" / "medium" / "low" — distribution over session

**On-point:** Prompt assembled, LLM call initiated  
**Off-point:** Raw LLM response string, before FSM parsing  
**Signal:** `json_parse_failure > 2%` = prompt format regression. `options_count < 3` in Q-states = LLM ignoring instruction. `reply_word_count > 100` in Q-states = verbosity regression.

**Rubric:** `json_parse_success`, `options_count`, `reply_word_count` are deterministic. Hallucination detection uses LLM-as-judge (§4).

---

### Layer 5: Vision (When Images Present)

**What it is:** Qwen2.5-VL (7B) vision pass in `rag_worker.py` — extracts OCR text from nameplate photo, injects into prompt.

**What to measure:**
- `ocr_extracted`: non-empty OCR string returned
- `asset_identified_in_ocr`: scenario fixture asset (e.g., "GS10") appears in OCR output
- `fault_code_extracted`: if image contains a fault code, was it captured?
- `vision_latency_ms`: Qwen2.5-VL call duration (often 8–20s — the dominant latency term)

**On-point:** Base64 image enters `_visual_search()` or vision worker  
**Off-point:** `ocr_text` string returned  
**Signal:** `asset_identified_in_ocr` rate on nameplate photos < 80% = vision model or prompt issue.

**Rubric:** Deterministic (string match on scenario fixture's expected asset label).

---

### Layer 6: Tool Calls and WO Triggers

**What it is:** `parseWORecommendation()` in `mira-web/src/server.ts` looks for `"WO RECOMMENDED: <title> | Priority: <level>"` in the DIAGNOSIS response. CMMS action proposed = work order created.

**What to measure:**
- `wo_trigger_present`: string pattern found in DIAGNOSIS response
- `wo_trigger_warranted`: scenario fixture says WO should have been recommended
- `precision` = `true_positives / (true_positives + false_positives)` across runs
- `recall` = `true_positives / (true_positives + false_negatives)` across runs

**On-point:** DIAGNOSIS state response generated  
**Off-point:** `parseWORecommendation()` return value  
**Signal:** Low recall (missing warranted WOs) = diagnostic prompts not instructing WO recommendation. False positives = WO threshold too low.

**Rubric:** Ground truth from scenario fixture (`wo_expected: true/false`). Deterministic string match.

---

### Layer 7: Conversational UX

**What it is:** Session-level signals that indicate user confusion — not whether MIRA was right, but whether the *interaction* was usable.

**What to measure:**
- `turns_to_diagnosis`: how many exchanges before DIAGNOSIS state
- `rephrases_detected`: user sends near-identical message twice (cosine similarity > 0.85 between consecutive user turns — suggests MIRA's question wasn't understood)
- `selection_resolution_rate`: when MIRA offers numbered options, how often does the next user turn resolve to a valid selection vs. a free-text non-answer?
- `session_abandoned`: FSM session created but never reached Q2 or beyond
- `avg_response_length_by_state`: per-state word count distribution

**On-point:** Session start (IDLE → Q1 transition)  
**Off-point:** Session end (RESOLVED or abandoned)  
**Signal:** `rephrases_detected_rate > 15%` = MIRA's Q-state questions are unclear.

**Rubric:** Deterministic (similarity computation, session state reads).

---

## 3. Rubric Design

Three philosophies, one recommendation.

### Option A: Binary checkpoints (yes/no per criterion)
Each scenario either passes or fails each criterion. No partial credit. This composes into CI-style regression suites. Cheapest to implement, most actionable for regressions. Hard to distinguish "slightly better" from "clearly better."

### Option B: Weighted multi-dimensional scoring
0–4 scale per dimension (retrieval quality, diagnosis correctness, FSM adherence, etc.), weighted by criticality. Richer signal for improvement direction. Much noisier — small prompt changes produce score drift, making trend analysis hard.

### Option C: Pairwise comparison (Karpathy RLHF style)
Two runs (this week vs. last week) shown to a judge (LLM or human). Judge says which is better per scenario. Best for capturing directional improvement. Requires a reference run baseline; useless for first run. Complex infrastructure.

### Recommendation: A + C layered

**Binary checkpoints for CI gating (Option A):**
- Gate every PR that touches prompts, FSM, retrieval, or inference routing
- Must pass: `fsm_reached_diagnosis`, `no_illegal_transitions`, `json_parseable`, `vendor_match`, `no_safety_false_positives`
- These run in < 5 minutes on 10 seed scenarios, fail loudly

**Pairwise comparison for improvement direction (Option C):**
- Weekly only — compares this week's full nightly run against last week's
- LLM-as-judge scores 100 randomly sampled scenario pairs
- Output: "X scenarios improved, Y regressed, delta vs. baseline"
- Drives the weekly dashboard summary (§5)

Do not implement Option B. The signal-to-noise ratio is not worth the complexity at current scale.

---

## 4. LLM-as-Judge: When to Use and When Not To

LLM-as-judge is powerful and has three well-documented failure modes:

1. **Verbosity bias** — longer responses are rated higher regardless of accuracy
2. **Position bias** — when shown two options, favors whichever is listed first
3. **Self-similarity bias** — Claude rates Claude-generated responses higher than equivalent Groq responses

**Use LLM-as-judge for:**

| Task | Prompt pattern |
|------|---------------|
| Hallucination detection | "Does this response claim facts not present in [retrieved chunks]? Yes/No + reason" |
| Intent label verification | "Given this maintenance query, which intent is it: industrial / safety / off_topic / greeting?" |
| FSM transition validity | "Given this conversation history and state=[X], is the proposed next_state=[Y] appropriate? Yes/No" |
| WO recommendation quality | "Is this a situation where a work order is genuinely warranted? Yes/No + confidence" |
| Conversational tone | "On a scale of 1–3: does this response match the tone of a peer engineer speaking to a technician? Not appropriate / acceptable / exactly right" |

**Use deterministic code for:**

| Task | Method |
|------|--------|
| FSM state reached | `SELECT state FROM fsm_sessions WHERE chat_id = ?` |
| Retrieval vendor match | `chunk_metadata['manufacturer'] == scenario['asset_manufacturer']` |
| JSON parse success | `json.loads(response)` — exception = fail |
| Options count | `len(re.findall(r'^\d+[.)]', response, re.M))` |
| Latency / cost / error rate | Log parsing, arithmetic |
| Safety keyword trigger | String match against `SAFETY_KEYWORDS` list |

**Reserve human review for:**
- "Was this response actually useful to a technician working on this problem?"
- Calibrating the LLM judge: periodically run 20 scenarios through both human and judge, check agreement rate
- Confirming proposed auto-fix patches before they're opened as PRs

**Practical LLM-judge setup:**
- Use a *different* model than the one being evaluated (avoid self-similarity bias). If the pipeline uses Groq Llama-3.3-70B, use Claude Sonnet for judging.
- Use chain-of-thought prompting + forced binary output: "Think step by step. Then output only YES or NO on the final line."
- Include 2 few-shot examples (one clear pass, one clear fail) in every judge prompt.
- Log all judge calls + their reasoning — if judge agreement with human drops below 80%, the judge prompt needs revision.

---

## 5. The Auto-Research Loop

```
                    ┌─────────────────────────────────────┐
                    │         Seed Corpus (YAML)          │
                    │   50–200 diagnostic scenarios        │
                    └────────────────┬────────────────────┘
                                     │ nightly (cron)
                    ┌────────────────▼────────────────────┐
                    │      Synthetic Run Engine           │
                    │  tests/synthetic_user/runner.py +   │
                    │  tools/audit/ux_full_test.py        │
                    │  fires each scenario via Open WebUI │
                    └────────────────┬────────────────────┘
                                     │ full pipeline trace
                    ┌────────────────▼────────────────────┐
                    │         Grader / Scorer             │
                    │  tests/eval/grader.py (new)         │
                    │  binary checkpoints per layer       │
                    └────────────────┬────────────────────┘
                                     │ scorecard + diff
                    ┌────────────────▼────────────────────┐
                    │         Auto-Triage Engine          │
                    │  clusters failures by root cause    │
                    │  retrieval miss / FSM stuck /       │
                    │  LLM format / prompt / vision       │
                    └────────────────┬────────────────────┘
                                     │ failure clusters
                    ┌────────────────▼────────────────────┐
                    │      Proposal Generator             │
                    │  LLM-drafted fix suggestions per    │
                    │  cluster (prompt edits, index adds) │
                    └────────────────┬────────────────────┘
                                     │ draft PR or digest
                    ┌────────────────▼────────────────────┐
                    │          Mike's Review              │
                    │  weekly digest + approve button     │
                    └────────────────┬────────────────────┘
                                     │ approved fix
                    ┌────────────────▼────────────────────┐
                    │         A/B Staging Run             │
                    │  proposed fix vs. control on        │
                    │  50% of scenarios — pairwise grade  │
                    └────────────────┬────────────────────┘
                                     │ if A wins
                              promote to main
```

### Step-by-step

**Step 1 — Seed corpus:** 50 YAML scenario fixtures (see §7). Covers: 10 VFD fault codes (5 vendors), 10 motor mechanical faults, 5 nameplate-OCR flows, 5 out-of-KB graceful degradation cases, 5 safety escalations, 5 ambiguous/vague openers, 10 multi-turn context chains. The 6 regression scenarios already in `tests/synthetic_user/scenarios.yaml` become the first 6.

**Step 2 — Nightly synthetic run:** `tests/synthetic_user/runner.py` (already exists) fires each scenario via the Open WebUI HTTP API. Each scenario run produces a **pipeline trace**: user turns, assistant responses, FSM states at each turn, retrieved chunks, provider used, latency. Trace written to SQLite (see §7).

**Step 3 — Grade each run:** `tests/eval/grader.py` (new) reads the trace, applies binary checkpoints per layer, writes a per-scenario scorecard. Aggregate scorecard for the run stored as a parquet row.

**Step 4 — Diff against yesterday:** Compare scorecards. Which scenarios regressed (was passing, now failing)? Which recovered? Which are chronically failing (failing for ≥ 3 consecutive days)?

**Step 5 — Auto-triage:** Failures clustered by root cause signature:
- `retrieval_vendor_mismatch` → retrieval index problem
- `fsm_stuck_state` → FSM rule or prompt problem
- `json_parse_failure` → prompt format regression
- `safety_false_positive` → guardrails over-triggering
- `diagnosis_not_reached` → general diagnostic quality issue

**Step 6 — Propose fixes:** For each cluster, LLM-drafted suggestion:
- `retrieval_vendor_mismatch`: "Add 20 GS20-specific chunks to knowledge index"
- `fsm_stuck_state at Q2`: "Q2 prompt may need stronger state-advance signal; suggest adding explicit transition instruction"
- `json_parse_failure`: "Response format changed — check for recent prompt edit"

Proposals land in a weekly digest markdown file (`wiki/eval-digest-YYYY-MM-DD.md`), not as auto-merging PRs. Mike reviews and approves.

**Step 7 — A/B staging:** Approved fix deployed to a staging pipeline instance. 50% of that day's nightly run routes to staging, 50% to production. Pairwise judge compares. If staging wins on net score, promote.

**Step 8 — Dashboard:** A single-page markdown report (or lightweight HTML) generated per run:
- Per-layer health status (green/yellow/red)
- 7-day trend sparklines
- Top 5 regressions (scenario name + failing checkpoint)
- Top 5 chronic failures (failing ≥ 3 days)
- Provider cascade stats (Groq hit rate, fallback rate, cost estimate)

This report goes to `wiki/hot.md` (overwritten nightly — already the canonical session-start read).

---

## 6. How It Plugs Into What Exists

**Existing infrastructure — use as-is:**

| File | Current role | Role in eval loop |
|------|-------------|-------------------|
| `tests/synthetic_user/runner.py` | HTTP stress runner | Primary harness — fires scenarios via Open WebUI API. Add `--mode eval` flag to capture full trace. |
| `tests/synthetic_user/scenarios.yaml` | 6 regression scenarios | Seed corpus Week 1. Expand to 50 in Week 2. |
| `tests/synthetic_user/evaluator.py` | Weakness classifier (15 categories) | Already does `VENDOR_MISMATCH`, `CONTEXT_AMNESIA`, `HALLUCINATION` detection — wire its output into the new grader as a sub-signal. |
| `tests/synthetic_user/llm_judge.py` | LLM-based eval | Use for hallucination detection and FSM transition validity checks in the grader. |
| `tools/audit/ux_full_test.py` | 16-exchange Playwright flow | Run as a "golden path" scenario — if this fails, stop everything else. |
| `mira-pipeline/main.py:285` | `PIPELINE_CALL` log line | **Currently wrong log level** — the log exists but isn't emitted at INFO. Fix: change `logger.debug` → `logger.info` at line 285. This is a prerequisite. |
| `mira.db` (FSM SQLite) | Per-session state | Primary source of truth for FSM state sequence. Eval harness reads `fsm_sessions` table after each run. |

**New modules needed (delta-minimal):**

| New file | Purpose | Size estimate |
|---------|---------|---------------|
| `tests/eval/grader.py` | Binary checkpoint evaluation for each intelligence layer | ~300 lines |
| `tests/eval/triage.py` | Failure clustering + root cause labeling | ~150 lines |
| `tests/eval/scorecard.py` | Scorecard schema + serialization (SQLite + parquet) | ~100 lines |
| `tests/eval/proposer.py` | LLM-drafted fix suggestions from triage clusters | ~100 lines |
| `tests/eval/run_eval.py` | CLI entry point: `python tests/eval/run_eval.py --scenarios 50 --output wiki/eval-digest.md` | ~80 lines |
| `tests/scenarios/` | Expanded YAML scenario fixtures (50+ files) | 50 YAML files |

**Fix prerequisite before anything else:**
In `mira-pipeline/main.py`, line 285:
```python
# Before (emits at DEBUG, not visible at INFO level)
logger.debug("PIPELINE_CALL chat_id=%s latency_ms=%d len=%d", chat_id, ms, len(reply))

# After
logger.info("PIPELINE_CALL chat_id=%s latency_ms=%d len=%d", chat_id, ms, len(reply))
```
Without this, the eval harness can't read pipeline call records from logs. FSM DB is the backup, but log-level traces give retrieval chunk data that the DB doesn't.

---

## 7. Data Model

### Scenario fixture (YAML)

```yaml
# tests/scenarios/vfd_gs10_overcurrent.yaml
id: vfd_gs10_overcurrent_v1
description: "Senior tech reports OC fault on GS10, 5HP, single-phase input"
asset:
  manufacturer: AutomationDirect
  model: GS10
  nameplate_voltage: 120V
  hp: 5
  phases: 1
turns:
  - role: user
    content: "GS10 VFD showing OC fault on startup"
  - role: user
    content: "2"  # selects option 2 from MIRA's numbered list
  - role: user
    content: "Motor is 5HP 120V single phase, no load connected"
ground_truth:
  expected_final_state: DIAGNOSIS
  max_turns_to_diagnosis: 6
  retrieval_vendor: AutomationDirect
  retrieval_must_contain: ["overcurrent", "GS10", "acceleration"]
  wo_expected: false
  safety_expected: false
  intent: industrial
tags: [vfd, overcurrent, gs10, single-phase]
```

### Per-run trace record (SQLite: `eval_runs` DB, separate from `mira.db`)

```sql
CREATE TABLE eval_run (
    run_id TEXT,          -- UUID per nightly run
    run_date TEXT,        -- ISO date
    scenario_id TEXT,
    turn_index INTEGER,
    user_message TEXT,
    assistant_response TEXT,
    fsm_state TEXT,
    provider_used TEXT,   -- groq / cerebras / claude / owui
    latency_ms INTEGER,
    chunks_retrieved INTEGER,
    top_chunk_similarity REAL,
    top_chunk_vendor TEXT,
    json_parse_ok INTEGER,  -- 0/1
    options_count INTEGER,
    reply_word_count INTEGER,
    PRIMARY KEY (run_id, scenario_id, turn_index)
);
```

### Per-scenario scorecard (SQLite: `eval_scorecards`)

```sql
CREATE TABLE eval_scorecard (
    run_id TEXT,
    run_date TEXT,
    scenario_id TEXT,
    -- Binary checkpoints (0 fail / 1 pass / -1 not applicable)
    cp_fsm_reached_diagnosis INTEGER,
    cp_no_illegal_transitions INTEGER,
    cp_no_stuck_states INTEGER,
    cp_json_parseable INTEGER,
    cp_vendor_match INTEGER,
    cp_no_safety_false_positive INTEGER,
    cp_wo_trigger_correct INTEGER,
    cp_vision_asset_identified INTEGER,
    cp_intent_classified_correct INTEGER,
    -- Aggregate
    checkpoints_passed INTEGER,
    checkpoints_total INTEGER,
    score_pct REAL,
    failure_cluster TEXT,  -- CSV of triggered failure categories
    PRIMARY KEY (run_id, scenario_id)
);
```

### Long-term trend store (Parquet, written daily)

Path: `data/eval/runs/YYYY-MM-DD.parquet`

Columns: `run_date`, `scenario_id`, all `cp_*` columns, `avg_latency_ms`, `fallback_rate`, `vendor_mismatch_rate`, `stuck_state_rate`.

Query example (find retrieval regressions over last 30 days):
```python
import polars as pl
df = pl.read_parquet("data/eval/runs/2026-*.parquet")
df.filter(pl.col("cp_vendor_match") == 0).group_by("scenario_id").agg(
    pl.count().alias("failures"),
    pl.col("run_date").min().alias("first_seen")
).sort("failures", descending=True)
```

At 50 scenarios × 365 days = 18,250 rows/year. Parquet handles 100k+ rows trivially. This schema holds for years without needing a rewrite.

---

## 8. First-Week Deliverable

### Week 1 — MVP (binary checkpoints, 10 scenarios, nightly)

**Deliverables:**
1. Fix `logger.debug` → `logger.info` in `mira-pipeline/main.py:285` (30 min)
2. Write 10 seed YAML scenarios covering: 3 VFD faults (GS10, PowerFlex 525, GS20), 2 motor mechanical, 2 safety escalations, 2 out-of-KB graceful degradation, 1 nameplate photo flow (4h)
3. `tests/eval/grader.py` — binary checkpoints for: `fsm_reached_diagnosis`, `no_illegal_transitions`, `json_parseable`, `vendor_match`, `no_safety_false_positive` (4h)
4. `tests/eval/run_eval.py` — CLI runner that fires each scenario, reads FSM DB, writes scorecard to `wiki/eval-digest-YYYY-MM-DD.md` (2h)
5. Cron job (existing `mcp__scheduled-tasks` infra on VPS) — nightly 2:30am, runs `python tests/eval/run_eval.py`, commits scorecard to repo (1h)

**Week 1 success metric:** 10 scenarios run cleanly nightly, scorecard appears in repo by 3am, at least 7/10 pass all binary checkpoints.

### Week 2 — Expand corpus + add triage

- Expand to 50 YAML scenarios (use `tests/synthetic_user/personas.py` and `question_bank.py` to generate drafts, then hand-curate)
- Add `tests/eval/triage.py` — failure cluster labeling
- Add vendor match deterministic check (parse manufacturer from chunk metadata)
- Wire `tests/synthetic_user/evaluator.py` into grader (reuse its weakness categories)
- Add latency / fallback rate columns to scorecard

### Week 4 — LLM-as-judge + pairwise

- `tests/eval/llm_judge.py` — hallucination detection and FSM transition validity (reuse `tests/synthetic_user/llm_judge.py` as scaffold)
- Pairwise comparison job (weekly, runs Sunday 3am after nightly)
- Proposal generator (draft fix digest for Mike's weekly review)
- Per-layer health dashboard in scorecard output

### Week 8 — A/B staging + proposal workflow

- Staging pipeline instance for fix testing
- 50/50 traffic routing (nginx upstream switch)
- Approved-fix PR workflow (proposed → draft PR → Mike approves → merge → next nightly validates)
- Trend store (Parquet daily snapshots, polars queries for retrospective analysis)
- Dashboard: HTML page (generated from scorecard data, served from `wiki/`) or terminal-renderable markdown with sparklines

---

## 9. Risks and Open Questions

### Risk 1: Scenario drift

The 4,231 stress-test requests were synthetic — they phrase things like `tests/synthetic_user/question_bank.py` does, not like actual technicians do. A scenario corpus that's too synthetic trains the system to be good at synthetic prompts.

**Mitigation:** Every 4 weeks, seed 5 new scenarios from real Mike conversations (sanitized). The wiki's `hot.md` is a natural collection point — add a convention where Mike notes unusual technician phrasings encountered in testing. These become ground truth fixtures.

### Risk 2: Judge gaming

Surface-polished responses (fluent, well-structured, confidently wrong) fool LLM judges more often than they should. A Llama-3.3-70B judge rating Claude Sonnet outputs may have systematic blind spots.

**Mitigation:** Keep the judge model diversified (use Claude for grounding checks; use Groq for tone/format checks). Calibrate monthly: run 20 scenarios through human + judge, measure Fleiss kappa. If kappa drops below 0.6, revise judge prompts before the next weekly run.

### Risk 3: Cost creep

Each nightly run with 50 scenarios × ~6 turns = 300 exchanges. If the inference cascade hits Claude Sonnet, at ~1K tokens/exchange that's 300K tokens/night. At $3/MTok = $0.90/night = $27/month. Add LLM-as-judge (50 calls/night at 2K tokens each) = another $0.30/night.

**Model:** Total eval cost < $40/month at 50 scenarios. Scales linearly — 200 scenarios = ~$160/month. Acceptable. Use Groq (free tier) for the eval runs themselves; reserve Claude for judge calls only.

### Risk 4: Logging gap in pipeline

Without `PIPELINE_CALL` log lines at INFO level, the eval harness must rely entirely on the FSM SQLite DB for pipeline call data. The DB captures state but not retrieval details (chunks, similarity scores). The fix is one line change — but if it's not done before the harness is built, the harness needs a fallback that reads Open WebUI's SQLite `chat.chat` JSON blobs (painful, as we discovered).

**Mitigation:** Fix the log level as the first PR. Gate the grader build on that fix being deployed.

### Risk 5: How Mike wants to review proposals

Three options, each with different overhead:
- **Draft PR per cluster** — highest visibility, but creates PR noise if many clusters fail simultaneously
- **Weekly digest markdown + approve button** — single document, lower overhead, but requires building the "approve button" workflow (webhook → PR creation)
- **Sunday morning email** — simplest, no new infra, but async and easy to miss

**Recommendation:** Weekly digest markdown committed to `wiki/eval-digest-YYYY-MM-DD.md` is the right Week 4 deliverable. Mike reviews it like `hot.md`. If a fix looks good, he creates the PR manually (or says "implement this" to Claude Code). The full approve-button automation is a Week 8 stretch goal.

### Open questions to resolve before building

1. Does `fsm_sessions` table in `mira.db` have a stable schema with `chat_id`, `state`, and `updated_at` columns? (Confirm — last investigation found `updated_at` stored as ISO string, not unix int.)
2. Does the Open WebUI HTTP API accept scenario turns as-is, or do we need to maintain session cookies between turns? (The stress test framework already handles this — confirm session handling in `runner.py`.)
3. What's the correct internal URL to call Open WebUI from the eval harness (localhost vs. container name vs. Tailscale)?
4. Should the scenario YAML repo live in `tests/scenarios/` or `tests/synthetic_user/scenarios/` (current location is `scenarios.yaml` singular)?

---

## Ranked Recommendations (Impact per Week)

| Rank | Action | Week | Impact |
|------|--------|------|--------|
| 1 | Fix `logger.debug → logger.info` in `mira-pipeline/main.py:285` | 1 | Unblocks all log-based eval. Zero risk. 30 min. |
| 2 | Write 10 seed scenarios + binary checkpoint grader + nightly cron | 1 | Establishes baseline. All subsequent work is relative to this. |
| 3 | Expand to 50 scenarios + vendor match + triage clustering | 2 | Transforms from "did it work?" to "where exactly did it fail?" |
| 4 | LLM-as-judge hallucination + FSM validity checks | 4 | Catches failures that deterministic code misses. Pairs with pairwise comparison. |
| 5 | Weekly digest + proposal generator | 4 | Converts failure data into actionable suggestions. Closes the loop. |
| 6 | Parquet trend store + polars retrospective queries | 6 | Enables "show me every vendor mismatch in the last month." |
| 7 | A/B staging pipeline + traffic split | 8 | Enables safe fix promotion. High infrastructure cost; wait until proposal quality is proven. |

The loop is useful from Week 1. It becomes *self-improving* at Week 4 when proposals start. Everything after that is scale and polish.

---

*This document describes what to build, not a timeline commitment. The eval set is more important than any single fix — build it first, build it well, and the system will tell you what to fix next.*
