-- Migration 012: conversation_eval
-- Logs every bot reply with PII sanitised, then enriches asynchronously with
-- an auto-score (Groq cascade) and an optional human verdict (Telegram inline
-- keyboard from Mike). Rows confirmed bad with a correction are harvested into
-- tests/bot_regression.py so the regression cannot ship again.
-- See docs/specs/bot-eval-loop-spec.md.

CREATE TABLE IF NOT EXISTS conversation_eval (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Identification
    chat_id TEXT NOT NULL,
    source TEXT NOT NULL,                       -- 'telegram' | 'slack'

    -- Conversation content (PII-sanitised before INSERT — IPs, MACs, SNs redacted)
    user_message TEXT NOT NULL,
    bot_response TEXT NOT NULL,
    intent TEXT,
    has_citations BOOLEAN DEFAULT false,
    response_time_ms INTEGER,

    -- Auto-scorer fields (filled by mira_eval.score_conversation_eval Celery task)
    auto_score INTEGER,                         -- 1..5; NULL = unscored
    auto_score_breakdown JSONB,                 -- per-criterion 1..5 scores
    scorer_reasoning TEXT,
    scorer_model TEXT,                          -- 'groq' | 'cerebras' | 'gemini'
    scored_at TIMESTAMPTZ,

    -- Human-review fields (filled by Telegram inline keyboard from Mike)
    human_score INTEGER,                        -- 1..5
    human_verdict TEXT,                         -- 'good' | 'bad' | 'needs_fix' | NULL
    correction TEXT,                            -- what the response SHOULD have been
    reviewer_id TEXT,                           -- Telegram user_id of the reviewer
    reviewed_at TIMESTAMPTZ,

    -- Lifecycle
    golden_case_added BOOLEAN DEFAULT false,    -- set true by harvester
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Hot path: chronological browsing + sliding-window aggregates
CREATE INDEX IF NOT EXISTS idx_conversation_eval_created_at
    ON conversation_eval (created_at DESC);

-- Hot path: scorer pulls the queue of unscored rows
CREATE INDEX IF NOT EXISTS idx_conversation_eval_unscored
    ON conversation_eval (created_at)
    WHERE auto_score IS NULL;

-- Hot path: digest job pulls rows below the 3-of-5 review threshold
CREATE INDEX IF NOT EXISTS idx_conversation_eval_flagged
    ON conversation_eval (created_at DESC)
    WHERE auto_score < 3 AND human_verdict IS NULL;

-- Hot path: harvester pulls bad-with-correction rows that haven't been
-- promoted to a golden case yet
CREATE INDEX IF NOT EXISTS idx_conversation_eval_harvest
    ON conversation_eval (reviewed_at)
    WHERE human_verdict = 'bad' AND golden_case_added = false;
