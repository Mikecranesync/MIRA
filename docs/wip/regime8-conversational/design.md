# MIRA Test Improvement Plan: MCQ Scores + Conversational Diagnostics

## Context

Groq (Llama 3.3 70B) scores 94/100 on the MCQ benchmark. The 6 misses are: 3 math/reasoning (Q24, Q27, Q29), 2 regulatory knowledge (Q47, Q54), 1 domain troubleshooting (Q67). Claude scores 100% on a 10-question sample. The conversational testing infrastructure (`synthetic_user/scenario_runner.py`) exists with 13 weakness categories and per-turn validation but was never wired to the live engine. Goal: push MCQ to 97%+ and build a Regime 8 conversational test suite.

---

## Part A: MCQ Score Improvement (94% -> 97%+)

### A1. Add `--smart-route` flag to `tests/mira_eval.py`

**File**: `tests/mira_eval.py`

Add a routing predicate that detects questions needing mathematical reasoning and routes them to Claude instead of Groq:

```python
def needs_reasoning(q: dict) -> bool:
    if q["type"] == "calculation":
        return True
    if q["difficulty"] == "hard":
        stem = q["stem"].lower()
        if re.search(r'\d+\.?\d*\s*(ohm|Ω|cal|cm|inch|feet|kWh|%|psi)', stem, re.IGNORECASE):
            return True
    return False
```

Changes:
- Add `--smart-route` argparse flag (~line 477)
- Load both GROQ and ANTHROPIC keys when `--smart-route` is active
- In main loop (~line 539), check `needs_reasoning(q)` per question and swap provider
- Log which questions were routed where
- Works with `--rag` flag simultaneously

### A2. Extend CoT trigger

**File**: `tests/mira_eval.py` (~line 301)

Broaden the chain-of-thought prompt to fire for hard scenarios with numeric content, not just `type == "calculation"`:

```python
is_calc = q.get("type") == "calculation" or (
    q.get("difficulty") == "hard"
    and re.search(r'\d+\.?\d*\s*(cal|cm|Ω|ohm|inch|psi|kWh)', q["stem"], re.IGNORECASE)
)
```

### A3. Validate RAG for NFPA questions

Run: `doppler run -- python tests/mira_eval.py --groq --rag --domain "NFPA" --limit 10`

If Q47/Q54 still fail, the NFPA 70E tables aren't in the KB yet (need Table 130.5(C) for PPE categories, Table 130.4(D)(a) for approach boundaries).

### A4. Full validation run

```bash
doppler run -- python tests/mira_eval.py --groq --rag --smart-route
```

Expected: 97-100/100. Cost: ~$0.02 for the 6 Claude-routed questions.

---

## Part B: Regime 8 Conversational Diagnostics

### B1. Directory structure

```
tests/regime8_conversational/
  __init__.py
  scenarios/
    01_technical_diagnostic.yaml     # 8 scenarios
    02_expertise_calibration.yaml    # 4 scenarios
    03_rag_grounding.yaml            # 4 scenarios
    04_graceful_degradation.yaml     # 3 scenarios
    05_safety_escalation.yaml        # 3 scenarios
    06_followup_handling.yaml        # 3 scenarios
    07_photo_triggered.yaml          # 2 scenarios (mock-only)
    08_context_retention.yaml        # 3 scenarios
  scoring/
    __init__.py
    conversation_rubric.py           # 5-dimension weighted scorer
    rule_compliance.py               # Programmatic checks for 12 of 20 system prompt rules
  test_conversational_diag.py        # pytest entry point + regime8_runner()
  run_conversational.py              # Standalone CLI runner
```

### B2. Wire `scenario_runner.py` to live engine

**File**: `tests/synthetic_user/scenario_runner.py`

Add `_run_scenario_live()` that instantiates `Supervisor`, calls `process_full()` per turn, captures reply/state/confidence, validates against `turn.expect`. This activates the existing 5 dormant scenarios AND powers all Regime 8 scenarios.

### B3. Scenario YAML format (30 scenarios, 8 categories)

Each scenario follows the existing YAML structure from `scenarios.yaml`, extended with:
- `scoring_tags` for category filtering
- `ground_truth` with `root_cause`, `keywords`, expected diagnosis
- `mode: mock_only` for photo scenarios
- Per-turn `expect` blocks: `contains_any`, `not_contains`, `is_question`, `has_safety_warning`, `has_honesty_signal`, `max_words`, `fsm_state`

**Category breakdown:**

| # | Category | Scenarios | Tests |
|---|----------|-----------|-------|
| 1 | Technical Diagnostics | 8 | VFD IGBT failure, motor bearing, PLC comms, soft starter bypass, intermittent ground fault, pneumatic cylinder, transformer overheating, motor single-phasing |
| 2 | Expertise Calibration | 4 | Senior vs junior on same VFD topic, senior vs junior on motor insulation |
| 3 | RAG Grounding | 4 | Grounded to docs, multi-turn stays grounded, conflicting sources, no relevant docs |
| 4 | Graceful Degradation | 3 | Unknown manufacturer, non-standard fault code, confused equipment |
| 5 | Safety Escalation | 3 | Safety mid-conversation, chemical environment, false positive avoidance |
| 6 | Follow-up Handling | 3 | "Why" depth-on-demand, source request, option selection |
| 7 | Photo-Triggered | 2 | Fault display photo, nameplate read (mock-only) |
| 8 | Context Retention | 3 | Remembers equipment, remembers readings, full 3-turn diagnosis |

### B4. 5-dimension scoring rubric

**File**: `tests/regime8_conversational/scoring/conversation_rubric.py`

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| Diagnostic Accuracy | 0.30 | Ground truth keyword match in DIAGNOSIS turn |
| Conversation Quality | 0.25 | Peer tone, conciseness, single question per turn |
| Rule Compliance | 0.20 | 12 programmatically-checkable system prompt rules |
| Confidence Calibration | 0.15 | Stated confidence vs actual correctness |
| Response Efficiency | 0.10 | Latency + word economy + turn economy |

Produces `CaseResult`-compatible output for integration with `composite.py`.

### B5. Rule compliance checker

**File**: `tests/regime8_conversational/scoring/rule_compliance.py`

Checks 12 of 20 active.yaml rules:

| Rule | Check |
|------|-------|
| R3 One Question | `reply.count('?') <= 1` |
| R6 One Action Step | Sentence count in FIX_STEP turns |
| R8 30 Word Max | `len(reply.split()) <= 30` for text-only |
| R10 Never Invent | No brand names not in conversation context |
| R11 Ground to Context | RAG-sourced answers cite source |
| R16 Cite Source | "[Source:" present when RAG used |
| R17 Expertise Calibration | Word count correlates with expertise level |
| R18 Emotional Ack | Short clause (<8 words) when pressure signals present |
| R19 Depth on Demand | 2-3 sentences after "explain"/"why" |
| R20 Diagnostic Ladder | No re-asking answered questions |
| Peer Tone | No forbidden phrases from social_eval PERSONA_FORBIDDEN |
| Forward Movement | Each turn advances (not repeating prior content) |

### B6. Integration with existing framework

- Register as Regime 8 in `tests/synthetic_eval.py`
- Add threshold `0.75` in `tests/scoring/thresholds.py`
- Output format: same JSON + Markdown report as other regimes
- Runner modes: `dry-run` (mock), `bot-only` (Supervisor), `live` (cloud inference)
- Standalone CLI: `python tests/regime8_conversational/run_conversational.py --mode live --category safety`

### B7. Activate existing 5 scenarios

Wire `_run_scenario_live()` into the existing `tests/synthetic_user/scenario_runner.py` so the 5 dormant scenarios (vfd_fault_code_diagnosis, out_of_kb_graceful_degradation, safety_keyword_escalation, vague_to_specific, cross_manufacturer_confusion) run against the live engine.

---

## Implementation Order

1. **A1+A2**: `--smart-route` flag + extended CoT in `mira_eval.py`
2. **A3+A4**: Validate with RAG + full benchmark run
3. **B1**: Create directory structure
4. **B2**: Wire `scenario_runner.py` to `Supervisor.process_full()`
5. **B3**: Write 30 scenario YAML files
6. **B4+B5**: Scoring rubric + rule compliance checker
7. **B6**: Integration (synthetic_eval.py, thresholds.py)
8. **B7**: Activate existing 5 scenarios
9. **Validation**: Dry-run all scenarios, then live against Bravo pipeline

## Verification

### Part A
```bash
# Smart-route full benchmark
doppler run -- python tests/mira_eval.py --groq --rag --smart-route
# Expect: 97+ correct, provider logged per question
```

### Part B
```bash
# Dry-run (offline, no API calls)
python tests/regime8_conversational/run_conversational.py --mode dry-run

# Bot-only (local Supervisor, no cloud)
python tests/regime8_conversational/run_conversational.py --mode bot-only

# Live against Bravo
doppler run -- python tests/regime8_conversational/run_conversational.py --mode live

# Full synthetic eval with Regime 8
python tests/synthetic_eval.py --regimes 8 --threshold 0.75
```

### Unit tests
```bash
python -m pytest tests/regime8_conversational/ -q
python -m pytest tests/ -q --ignore=tests/test_mira_pipeline.py --ignore=tests/regime6_sidecar
```

## Files Modified
- `tests/mira_eval.py` — `--smart-route` flag, extended CoT
- `tests/synthetic_user/scenario_runner.py` — `_run_scenario_live()` wiring
- `tests/synthetic_eval.py` — Regime 8 registration
- `tests/scoring/thresholds.py` — Regime 8 threshold

## Files Created
- `tests/regime8_conversational/__init__.py`
- `tests/regime8_conversational/test_conversational_diag.py`
- `tests/regime8_conversational/run_conversational.py`
- `tests/regime8_conversational/scenarios/*.yaml` (8 files, 30 scenarios)
- `tests/regime8_conversational/scoring/__init__.py`
- `tests/regime8_conversational/scoring/conversation_rubric.py`
- `tests/regime8_conversational/scoring/rule_compliance.py`

## Benchmark Baseline (2026-04-13)

### MCQ Results
- Groq (llama-3.3-70b-versatile): 94/100 (94.0%), avg 220ms/question
- Claude (claude-sonnet-4-6): 10/10 (100%), avg 2100ms/question

### MCQ Failures by Domain
| Domain | Groq Score | Weak Spots |
|--------|-----------|------------|
| VFD | 15/15 (100%) | None |
| Motor Theory | 12/15 (80%) | Q24 numeric reasoning, Q27 formula recall, Q29 calculation |
| PLC | 15/15 (100%) | None |
| CMMS | 15/15 (100%) | None |
| Sensors | 10/10 (100%) | None |
| Pneumatics | 9/10 (90%) | Q67 root cause isolation |
| NFPA 70E | 8/10 (80%) | Q47 threshold lookup, Q54 unit confusion |
| PM/PdM | 10/10 (100%) | None |

### API Spend (21 days)
- Total: 78 calls, 248K input / 13K output tokens
- Claude spend: $0.59 (53 calls)
- Groq/Cerebras: $0.00 (25 calls)
- Daily cap: $1.00
