# Bot Evaluation Loop — Continuous Improvement Spec

**Status:** draft → PR-A (logger + schema) shipping first
**Owner:** Mike (judge), MIRA agent (auto-scorer)
**Created:** 2026-05-13
**Related:** PR #1206 (`tests/bot_regression.py` golden-case format), issue #1212 (deepeval reference rewrite backlog)

---

## Purpose

Stop the four-time regression pattern (most recently PowerFlex 525 / F004, fixed in PR #1206) by closing the production-to-test feedback loop. Every real conversation becomes a graded signal; every bad response Mike confirms becomes a permanent golden test case; CI catches the regression before the next deploy.

Explicitly **not weekly**. The loop runs daily and tightens as evidence accumulates. The bot is "tuned" when the rolling 7-day average auto-score stays ≥ 4.0 and no regression-class failure has been merged in that window.

---

## The loop

```
Telegram / Slack user
        │
        ▼
┌──────────────────────────────┐
│ Bot generates response       │     ← shared.engine.Supervisor.process_full
└──────────────┬───────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
   Send reply    conversation_logger.log_turn()
                      │
                      ▼
                NeonDB: conversation_eval
                      │
                      ▼  (daily 03:00 UTC — Celery beat on VPS)
            mira-crawler.tasks.eval_scorer
              calls InferenceRouter cascade
              (Groq → Cerebras → Gemini)
                      │
                      ▼
                  UPDATE row
                  SET auto_score, scorer_reasoning, scored_at
                      │
                      ▼
                  rows where auto_score < 3
                      │
                      ▼  (daily 13:00 UTC)
              Telegram digest to Mike
              "12 convos yesterday. Avg 3.8. 3 flagged."
              [Good]  [Bad]  [Skip]   per flagged row
                      │
                      ▼
            UPDATE: human_score, human_verdict,
            correction (Mike replies inline)
                      │
                      ▼
        tools/harvest_golden_cases.py  (weekly, or on-demand)
        rows where human_verdict='bad' AND correction IS NOT NULL
                      │
                      ▼
            Emits dict entries in tests/bot_regression.py format
            Mike reviews, appends, commits
                      │
                      ▼
                ci.yml runs bot_regression.py
                bad responses can never come back
```

Monotonic property: every confirmed-bad response becomes a permanent test case. Score can only sustainably rise, because every regression is captured before merge.

---

## Schema (PR-A)

`mira-core/mira-ingest/db/migrations/012_conversation_eval.sql`:

```sql
CREATE TABLE IF NOT EXISTS conversation_eval (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_id TEXT NOT NULL,              -- Telegram chat_id or Slack channel_id
    source TEXT NOT NULL,               -- 'telegram' | 'slack'
    user_message TEXT NOT NULL,         -- PII-sanitized (see Privacy below)
    bot_response TEXT NOT NULL,         -- PII-sanitized
    intent TEXT,                        -- as labelled by guardrails.classify_intent()
    has_citations BOOLEAN DEFAULT false,
    response_time_ms INTEGER,
    -- Auto-scorer fields (filled by eval_scorer task)
    auto_score INTEGER,                 -- 1..5; NULL = unscored
    auto_score_breakdown JSONB,         -- per-criterion scores
    scorer_reasoning TEXT,
    scorer_model TEXT,                  -- which provider answered (groq|cerebras|gemini)
    scored_at TIMESTAMPTZ,
    -- Human-review fields (filled when Mike taps Good/Bad)
    human_score INTEGER,                -- 1..5
    human_verdict TEXT,                 -- 'good' | 'bad' | 'needs_fix' | NULL
    correction TEXT,                    -- what the response should have been
    reviewer_id TEXT,                   -- Telegram user_id of the reviewer
    reviewed_at TIMESTAMPTZ,
    -- Lifecycle
    golden_case_added BOOLEAN DEFAULT false,  -- set true by harvester
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_eval_created_at
    ON conversation_eval (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_eval_unscored
    ON conversation_eval (created_at) WHERE auto_score IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_eval_flagged
    ON conversation_eval (created_at DESC) WHERE auto_score < 3 AND human_verdict IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_eval_harvest
    ON conversation_eval (reviewed_at) WHERE human_verdict = 'bad' AND golden_case_added = false;
```

Partial indexes keep the hot paths (unscored, flagged-for-review, ready-to-harvest) lean even as the table grows.

---

## Privacy & PII (load-bearing, do not skip)

Industrial conversations contain IPs, MACs, asset serials, plant location names. The existing `InferenceRouter.sanitize_context()` (mira-bots/shared/inference/router.py) already handles `[IP]`, `[MAC]`, `[SN]` redaction for outbound LLM calls. The conversation logger **must apply the same sanitizer** to `user_message` and `bot_response` *before* INSERT.

```python
from shared.inference.router import InferenceRouter
sanitized_user = InferenceRouter.sanitize_context(user_message)
sanitized_bot  = InferenceRouter.sanitize_context(bot_response)
```

Retention: 90-day TTL via a periodic cleanup task (`DELETE FROM conversation_eval WHERE created_at < now() - interval '90 days' AND golden_case_added = false`). Rows that turned into golden cases are kept indefinitely as training-data provenance.

Out of scope for PR-A: cross-tenant isolation in this table. All logging is currently single-tenant (Mike's deployment). When multi-tenant SaaS arrives, add `tenant_id` and an RLS policy mirroring `work_orders_telegram` (migration 010).

---

## Auto-scorer rubric

Scorer prompt (lives in `mira-bots/shared/eval_score_rubric.py` so it's importable & testable):

> You are evaluating the bot's reply. Score 1–5 on each criterion. Return strict JSON.
>
> 1. **answered_question** — Did the bot address what the user asked, or did it deflect / re-ask for info already provided?
> 2. **no_hallucination** — Are the technical claims supportable from general engineering knowledge or the cited KB? Penalize fabricated part numbers, fault codes, voltages.
> 3. **no_redundant_questions** — Did the bot avoid asking for manufacturer/model/code that the user already typed in this turn or earlier?
> 4. **cited_sources_when_claimed** — If the bot referenced a manual / KB chunk, was a citation present?
> 5. **appropriate_tone** — Crisp, technician-grade, no excessive hedging or sycophancy.
>
> Output:
> ```json
> {
>   "answered_question": 1-5,
>   "no_hallucination": 1-5,
>   "no_redundant_questions": 1-5,
>   "cited_sources_when_claimed": 1-5,
>   "appropriate_tone": 1-5,
>   "overall": 1-5,
>   "reasoning": "1-2 sentences"
> }
> ```

`overall` is the integer stored in `auto_score`. Per-criterion scores go to `auto_score_breakdown`. Mike's human score overrides the auto score in dashboard aggregations once present.

**Provider:** existing `InferenceRouter.complete()` cascade — Groq first, falls through to Cerebras, then Gemini. No Anthropic (per PR #610 + #649 hard rule). `sanitize=True` is the default and we keep it on for the scorer too — the rubric only needs intent shape, not raw IPs.

---

## Human review surface — Telegram inline keyboard

Daily digest (13:00 UTC, after the 03:00 UTC scoring run):

```
MIRA quality report — 2026-05-13
─────────────────────────────────
Yesterday:  37 turns
Avg score:  3.8 / 5  ↘ from 4.1
Flagged:    4 turns below 3

▼ 1/4
"i have a powerflex 525 with a f004 fault"
→ "I'd be happy to help. Could you tell me the manufacturer and model?"
Auto: 2/5 — re-asked for vendor already in message
[ 👎 Bad ]  [ ✓ Good (false flag) ]  [ — Skip ]
```

`[Bad]` triggers a follow-up prompt: "Reply to this message with what MIRA *should* have said." Mike's reply text is stored as `correction`.

**Authorization (critical):** the callback handler MUST check `update.effective_user.id` against `EVAL_REVIEWER_TG_IDS` (CSV env var, Doppler-managed). Reject anonymous votes with a silent ignore + log line. Without this gate, anyone in any forwarded chat could pollute the golden-case training set.

Fallback path: if the Telegram digest fails (bot offline, rate-limited), the flagged rows are still in the DB. A simple `python tools/review_flagged.py` CLI provides the same surface from the terminal for backfill.

---

## Golden-case harvester

`tools/harvest_golden_cases.py`:

- SELECT * FROM conversation_eval WHERE human_verdict='bad' AND correction IS NOT NULL AND golden_case_added=false
- For each row, emit a Python dict matching the `GOLDEN_CASES` shape on `tests/bot_regression.py` (PR #1206):
  ```python
  {
      "name": "harvested_<short_slug>",
      "input": <user_message>,
      "intent": <auto-classified label>,
      "clarification_must_be_none": <True if vendor+code present, else False>,
      "asset_identified": "",
      "expected_substring_in_response": <correction[:80]>,
      "source_row": <uuid>,
  }
  ```
- Prints proposed entries to stdout for Mike to paste-review-commit. Does NOT auto-mutate the test file. After Mike commits, the harvester is rerun with `--mark-applied` to flip `golden_case_added=true` for each row referenced by source_row UUID in the commit message.

Why no auto-PR: golden cases are forever. A human eyeball is the right gate for "this assertion goes in the regression suite forever."

---

## Quality-score dashboard + deploy gate

Daily aggregate (computed inside `eval_scorer`):

- `avg_score_24h` — mean(auto_score WHERE created_at > now()-24h, human_score takes precedence)
- `avg_score_7d` — same, 7-day window
- `flagged_rate` — count(auto_score < 3) / total

Written to a small `conversation_eval_daily` summary view (PR-C scope) for Prometheus scrape.

**Deploy gate (PR-C, not PR-A):** `scripts/check_bot_quality.sh` exits non-zero when `avg_score_24h < 3.5`. Wired into `deploy-vps.yml` before the bot containers redeploy. A red bot can be hotfixed but not silently redeployed.

**Tuning target:** `avg_score_7d ≥ 4.0` sustained for 7 consecutive days, with no `golden_case_added=false AND human_verdict='bad'` rows older than 48 hours. When both conditions hold, the bot is considered "tuned for the current corpus" — promote the gate threshold from 3.5 to 4.0 and start the cycle over with a higher bar.

---

## Schedule mechanism — VPS Celery beat

Decision: both scoring and digest tasks run on the VPS Celery beat at `/opt/master_of_puppets/celery_app.py` (the same beat that already runs `mira_eval.run_batch` and `mira_synth.generate_nightly`). Trigger.dev Cloud is reserved for the public-internet crawler scheduling pattern.

Beat schedule snippet (applied to VPS `celery_app.py` during PR-B deploy):

```python
'mira_eval.score_conversation_eval': {
    'task': 'mira_eval.score_conversation_eval',
    'schedule': crontab(hour=3, minute=0),   # 03:00 UTC daily
},
'mira_eval.send_review_digest': {
    'task': 'mira_eval.send_review_digest',
    'schedule': crontab(hour=13, minute=0),  # 13:00 UTC daily (08:00 Mike-local)
},
```

The task code itself ships in `mira-crawler/tasks/eval_scorer.py` so it is discoverable by the existing Celery worker package without an additional install.

---

## Rollout — three PRs, not one

**PR-A (this spec + migration + logger)** — safe to merge first; starts collecting data immediately. No automatic scoring, no review UI. Just: every bot reply lands in NeonDB with PII sanitized. **Does not depend on PR #1206**.

**PR-B (scorer + Telegram digest + auth gate)** — depends on PR-A being deployed for ≥24h so there's data to score. Adds the daily Celery beat schedule on VPS.

**PR-C (harvester + deploy gate + ops doc + dashboard view)** — depends on PR #1206 being merged (harvester emits to `tests/bot_regression.py` format, which only exists on the merged PR).

Each PR is independently reviewable, reversible, and provides observable value on its own.

---

## What this is NOT

- Not a replacement for `tests/bot_regression.py`. That's the *gate*. This loop is the *source of new gates*.
- Not a replacement for the DeepEval reference suite. DeepEval scores the bot against curated references the team wrote. This loop scores the bot against real-world traffic the team didn't anticipate.
- Not a way to ship without code review. Every harvested golden case is reviewed by Mike before it lands in CI.
- Not an Anthropic call site. Scorer cascades Groq → Cerebras → Gemini; PR #610 + #649 stand.
