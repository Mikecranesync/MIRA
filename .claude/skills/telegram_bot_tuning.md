# telegram_bot_tuning

Automated interaction screener for MIRA's Telegram bot. Tails SQLite interactions,
NDJSON sessions, Docker logs, and feedback_log. Scores each session against
Amazon Lex / Contact Lens / Dialogflow CX quality standards. Proposes targeted
fixes with exact file references.

## When to invoke
- "review telegram conversations"
- "check for bad interactions"
- "screen the bot sessions"
- "tune the telegram bot"
- "what conversations went wrong"
- Any request to audit, review, or improve bot quality

## Setup check (run once)

```bash
cd ~/Mira/mira-bots
python -c "from screener.schema import SessionQuality; print('screener OK')"
```

If import fails, check that `mira-bots/screener/` exists and Python path is set.

## Screener modes

### Live tail (ongoing monitoring)
```bash
cd ~/Mira/mira-bots
doppler run --project factorylm --config prd -- \
  python -m screener --mode live --container mira-bot-telegram
```
Streams P0/P1 alerts as conversations happen.

### Report (last 24h — default)
```bash
cd ~/Mira/mira-bots
doppler run --project factorylm --config prd -- \
  python -m screener --mode report --hours 24
```

### Interactive fix review (run report + approve fixes)
```bash
cd ~/Mira/mira-bots
doppler run --project factorylm --config prd -- \
  python -m screener --mode report --hours 24 --interactive
```

### Batch (grade all unanalyzed sessions, write JSON to /data/screener/)
```bash
cd ~/Mira/mira-bots
doppler run --project factorylm --config prd -- \
  python -m screener --mode batch
```

## Quality flag codes (Amazon Lex / Contact Lens schema)

| Code | Severity | Meaning | Fix category |
|---|---|---|---|
| `FSM_LOOP` | P0 | Same FSM state 3+ consecutive turns | fsm_redesign |
| `THUMBS_DOWN` | P0 | User submitted negative feedback | benchmark_case |
| `HALLUCINATION_RISK` | P0 | Response <800ms + confidence=none (no RAG hit) | guardrail_rule |
| `LOW_CONFIDENCE_PERSISTENT` | P1 | >50% turns have low/none confidence | nlu_training |
| `ABANDONED` | P1 | Session ended without RESOLVED state | fsm_redesign |
| `REPETITION` | P1 | User repeated same message 2+ times | fsm_redesign |
| `MISSING_SLOTS` | P1 | 6+ exchanges, asset still not identified | fsm_redesign |
| `HIGH_LATENCY` | P2 | P95 response time >5000ms | threshold_adjustment |
| `INTENT_MISMATCH` | P2 | Chitchat intent during active diagnostic | nlu_training |
| `LOW_JUDGE_SCORE` | P2 | Judge dimension scored <3/5 | prompt_edit |

## Workflow when invoked

### Step 1 — Run the screener
Run the report command above (or batch for full history). Parse the output.

### Step 2 — Triage flagged sessions
For each session with P0 or P1 flags:
1. Show the session summary (outcome, turn count, avg confidence, flags)
2. Read the FixProposal for each flag
3. Present it to the user as: "**[P0 FSM_LOOP]** {title} — file: {affected_file}"

### Step 3 — Apply approved fixes
For each approved fix, use the Edit tool to apply `proposed_change` to `affected_file`.

**Fix category → action map:**

| Category | What to do |
|---|---|
| `fsm_redesign` | Edit `shared/engine.py` — find the FSM state handler and add the fallback branch described |
| `guardrail_rule` | Edit `shared/guardrails.py` — add keyword/pattern or output check as described |
| `benchmark_case` | Run the SQL INSERT described in `proposed_change` against mira.db |
| `nlu_training` | Edit `shared/conversation_router.py` or `shared/engine.py` — add training phrase as described |
| `rag_tuning` | Edit `shared/workers/rag_worker.py` — adjust BM25 weight or top-k as described |
| `prompt_edit` | Edit `shared/prompts/diagnose/active.yaml` or `shared/engine.py` — rewrite the prompt section |
| `threshold_adjustment` | Edit `shared/inference/router.py` — adjust timeout or `shared/screener/schema.py` thresholds |

### Step 4 — Verify improvement
After applying fixes, re-run the screener on the same time window and confirm flags reduced:
```bash
python -m screener --mode report --hours 24
```
Then run the full eval suite to catch regressions:
```bash
cd ~/Mira
doppler run --project factorylm --config prd -- python3 tests/eval/analyze_sessions.py
```

### Step 5 — Commit
Commit with a message referencing the session_id and flag codes:
```
fix: screener patch — FSM_LOOP Q2 + HALLUCINATION_RISK (session abc12345)
```

## Data sources (what's being watched)

| Source | Path / Command | Poll |
|---|---|---|
| SQLite interactions | `$MIRA_DB_PATH` (default `/data/mira.db`) | Every 5s |
| NDJSON sessions | `$SESSION_RECORDING_PATH` (default `/data/sessions`) | Every 2s |
| Docker logs | `docker logs -f mira-bot-telegram` | Streaming |
| SQLite feedback_log | `$MIRA_DB_PATH` | Every 10s |

## Local path overrides (for running on Bravo outside Docker)
```bash
python -m screener --mode report \
  --db /path/to/mira.db \
  --session-dir /path/to/sessions \
  --hours 48
```

## Files
- `mira-bots/screener/schema.py` — Pydantic-style dataclasses, thresholds
- `mira-bots/screener/watcher.py` — Async source tailers
- `mira-bots/screener/scorer.py` — Quality scoring engine
- `mira-bots/screener/proposer.py` — Deterministic fix proposal generator
- `mira-bots/screener/report.py` — ANSI terminal formatter
- `mira-bots/screener/cli.py` — Entry point
- `mira-bots/shared/session_manager.py` — `get_recent_interactions()` helper added
