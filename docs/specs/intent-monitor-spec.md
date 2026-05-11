# Intent Monitor Spec

**Status:** Draft | **Owner:** Mike | **Created:** 2026-05-11

## Goal

Daily-scan social platforms (Reddit, YouTube) for **buying-intent + pain signals** related to maintenance software, digital transformation, CMMS, and PLC troubleshooting. Surface high-intent posts/comments to Mike via Telegram with a suggested outreach reply so he can validate PMF and start outbound.

## Assumptions

- Reddit polled via **public JSON** endpoints (matches existing `mira-crawler/tasks/reddit.py`). OAuth (PRAW) deliberately avoided — same pattern as ingest pipeline.
- YouTube Data API v3 via `YOUTUBE_DATA_API_KEY` in Doppler `factorylm/prd`.
- Intent scoring uses **Groq `llama-3.1-8b-instant`** (free tier, already in cascade). Single call per post/comment, sanitized via existing `InferenceRouter.sanitize_context()` patterns.
- Persistence in **NeonDB** alongside existing `mira-ingest` tables. Migration `011_intent_signals.sql`.
- Alerts via existing `mira_crawler.reporting.telegram_notify.notify()` helper using a new `intent_scout` agent key.
- HubSpot contact creation is **out of scope for v1** — schema reserves `hubspot_contact_id`, but population deferred (no existing HubSpot client in repo). v1 leaves Mike to copy URL → HubSpot manually from Telegram alert.
- Hub dashboard (optional) **deferred to v2**.

## Non-Goals

- LinkedIn scanning (separate skill; LinkedIn ToS hostile to scraping).
- Auto-replying. Mike replies manually after reviewing suggested copy.
- Real-time / push. Daily/6h cadence is sufficient for outbound validation.

## Data Model

Migration `mira-core/mira-ingest/db/migrations/011_intent_signals.sql`:

```sql
CREATE TABLE IF NOT EXISTS intent_signals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    source TEXT NOT NULL,             -- 'reddit', 'youtube', 'linkedin'
    platform_id TEXT NOT NULL,        -- reddit post/comment ID, youtube comment ID
    author TEXT,
    author_profile_url TEXT,
    company TEXT,
    url TEXT NOT NULL,
    title TEXT,
    content TEXT,
    intent_score INTEGER,
    intent_category TEXT,             -- 'cmms_search' | 'pain_signal' | 'competitor_mention' | 'technical_help'
    suggested_reply TEXT,
    status TEXT DEFAULT 'new',        -- 'new' | 'contacted' | 'qualified' | 'disqualified'
    hubspot_contact_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    contacted_at TIMESTAMPTZ,
    UNIQUE(source, platform_id)
);

CREATE INDEX IF NOT EXISTS idx_intent_signals_created_at ON intent_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intent_signals_status ON intent_signals (status);
CREATE INDEX IF NOT EXISTS idx_intent_signals_score ON intent_signals (intent_score DESC);
```

Dedup is enforced by `UNIQUE(source, platform_id)` — re-runs are safe via `ON CONFLICT DO NOTHING`.

## Modules

| File | Role |
|------|------|
| `mira-crawler/tasks/_intent_scorer.py` | Groq call → `(score:int, category:str, suggested_reply:str)`. Shared by reddit + youtube tasks. |
| `mira-crawler/tasks/_intent_store.py` | NeonDB insert with `ON CONFLICT DO NOTHING`. Returns `True` if inserted. |
| `mira-crawler/tasks/reddit_intent.py` | Celery task `tasks.reddit_intent.scan_reddit_intent` — every 6h. |
| `mira-crawler/tasks/youtube_intent.py` | Celery task `tasks.youtube_intent.scan_youtube_intent` — daily 00:00 ET. |
| `mira-crawler/tasks/intent_digest.py` | Celery task `tasks.intent_digest.send_daily_digest` — daily 06:00 ET. |

## Reddit Scanner Behavior

- Subreddits: `PLC, maintenance, manufacturing, IndustrialAutomation, SCADA, ControlTheory, industrialengineering, Ignition, automationtechnology`.
- Endpoints (public JSON):
  - `https://www.reddit.com/r/{sub}/search.json?q={kw}&restrict_sr=1&sort=new&t=week&limit=25` per keyword.
- Keyword groups (16 keywords, queried OR-joined per subreddit when supported, otherwise serially):
  - CMMS-search: `"CMMS recommendation"`, `"maintenance software"`, `"looking for CMMS"`, `"alternative to MaintainX"`, `"alternative to UpKeep"`, `"alternative to Limble"`, `"alternative to Fiix"`
  - Pain: `"digital transformation manufacturing"`, `"digitize maintenance"`, `"paper work orders"`, `"replace paper"`
  - Technical: `"PLC troubleshooting"`, `"fault code"`, `"Allen Bradley alarm"`, `"Micro820"`, `"VFD fault"`
  - PM/asset: `"predictive maintenance"`, `"PM schedule software"`, `"preventive maintenance tracking"`, `"maintenance knowledge base"`, `"tribal knowledge"`, `"technician training"`, `"QR code asset"`, `"equipment tracking"`, `"asset management small manufacturer"`
- Dedup: Redis set `mira:intent:reddit:seen` (90-day TTL) **and** NeonDB unique constraint (defense in depth).
- Rate limits: 60 req/min → in-code sleep `time.sleep(1.1)` between requests; existing pattern in `reddit.py`.
- Per post: if `intent_score >= 60`, insert row and (if `>= 75`) fire Telegram alert.
- User-Agent: `mira-intent-monitor/0.1 by /u/<REDDIT_USERNAME>` (Reddit ToS).

## YouTube Scanner Behavior

- Daily quota budget: 10K units/day. Strategy targets <2K units to leave headroom for other YouTube tasks.
  - `search.list` = 100 units. Cap at **8 searches/day** = 800 units.
  - `commentThreads.list` = 1 unit. ~1K calls available.
- Step 1: For each of the 8 most-loaded keyword phrases, run `search.list?part=snippet&q={kw}&publishedAfter={now-7d}&type=video&maxResults=10&order=date`.
- Step 2: Union with monitored channel IDs (Walker Reynolds 4.0 Solutions, RealPars, Rockwell, Inductive Automation, MaintainX, UpKeep, Limble, The Automation Blog) — pull latest 5 videos each via `search.list?channelId=...` (one-shot 100u each ≤ first run; cached video IDs reused after).
- Step 3: For each video, `commentThreads.list?part=snippet&videoId=...&maxResults=50&order=relevance`.
- Score every top-level comment via `_intent_scorer`. Insert if `>= 60`. Telegram alert if `>= 75`.

## Daily Digest Behavior

- Runs at 06:00 ET via Celery Beat (UTC 10:00 / 11:00 depending on DST — single cron entry at 10:00 UTC; spec accepts ±1h DST drift).
- Query: `SELECT * FROM intent_signals WHERE created_at >= now() - interval '24 hours' ORDER BY intent_score DESC`.
- Message format:

```
📊 Daily Intent Digest — May 12, 2026

Reddit: 8 signals (3 high-intent)
YouTube: 12 signals (2 high-intent)

🔥 Top Signal:
r/PLC — "Looking for a CMMS that actually works for a small shop..."
Score: 92 | Suggested reply: "30-year maintenance vet here..."
→ https://reddit.com/r/PLC/...

📈 Trending: "digital transformation" mentioned 14x this week (up from 8 last week)
```

- "Trending" computed by comparing last-7-day keyword hit counts to the prior 7 days. Top mover only.

## Celery Beat / Rate Limits

Added to `mira-crawler/celeryconfig.py`:

```python
beat_schedule = {
    "reddit-intent-scan": {
        "task": "tasks.reddit_intent.scan_reddit_intent",
        "schedule": crontab(minute=0, hour="*/6"),
    },
    "youtube-intent-scan": {
        "task": "tasks.youtube_intent.scan_youtube_intent",
        "schedule": crontab(minute=0, hour=4),   # 00:00 ET
    },
    "intent-daily-digest": {
        "task": "tasks.intent_digest.send_daily_digest",
        "schedule": crontab(minute=0, hour=10),  # 06:00 ET
    },
}
```

> **Trigger.dev note:** existing comment in `celeryconfig.py` says Trigger.dev Cloud owns scheduling. This spec re-enables Celery Beat **only for the intent-monitor trio**; Trigger.dev parity can be added later by mirroring these crons. Both runners use the same `app.send_task(...)` so duplicate execution is the only failure mode — gate via a single beat process or pick one runner per task.

Rate-limit annotations (added to `task_annotations`):

- `tasks.reddit_intent.scan_reddit_intent`: `1/h` (defense; beat schedules every 6h anyway)
- `tasks.youtube_intent.scan_youtube_intent`: `1/h`
- `tasks.intent_digest.send_daily_digest`: `1/h`

## Secrets (Doppler `factorylm/prd`)

| Env var | Use |
|---------|-----|
| `GROQ_API_KEY` | Intent scoring |
| `YOUTUBE_DATA_API_KEY` | YouTube Data API v3 |
| `REDDIT_USERNAME` | User-Agent contact (Reddit ToS) — optional, falls back to `mike` |
| `NEON_DATABASE_URL` | NeonDB writes |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Alerts (already used by other tasks) |
| `CELERY_BROKER_URL` | Redis dedup set |

No new secrets need provisioning — all listed already exist per memory `project_youtube_secrets.md` and existing crawler tasks.

## Verification

- `ruff check mira-crawler/tasks/_intent_scorer.py mira-crawler/tasks/_intent_store.py mira-crawler/tasks/reddit_intent.py mira-crawler/tasks/youtube_intent.py mira-crawler/tasks/intent_digest.py` → exits 0.
- Migration applied: `psql $NEON_DATABASE_URL -f mira-core/mira-ingest/db/migrations/011_intent_signals.sql` → idempotent.
- Smoke: `celery -A mira_crawler.celery_app call tasks.reddit_intent.scan_reddit_intent` → task ID returned, log shows ≥1 NeonDB insert OR `0 high-intent signals (expected when starting cold)`.
- Telegram receipt: digest message lands at 06:00 ET in Mike's chat.

## Future (v2+)

- LinkedIn scanner (manual upload of search-result HTML, then parse — ToS-safe).
- HubSpot contact auto-create with company enrichment via Clearbit or built-in HubSpot enrichment.
- Hub `/intent-signals` dashboard (Hono/Bun on mira-web) with status mutations.
- Auto-draft replies in the suggested-reply field using Mike's brand voice guidelines.
