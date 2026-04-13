# 24/7 Knowledge Base Ingest Pipeline — Design Spec

## Context

MIRA's KB has ~25K chunks in NeonDB, ingested via batch scripts on sparse schedules (weekly/monthly). The pipeline exists in `mira-crawler/` with Celery + Redis but was **never deployed** to Bravo. The goal is:

1. Deploy the existing Celery stack
2. Add Trigger.dev Cloud as orchestration dashboard (replacing Celery Beat)
3. Expand to continuous source monitoring (RSS, sitemaps, YouTube, Reddit, patents, Google Drive)
4. Add quality gates and freshness management
5. Run at near-zero cost ($0/month incremental)

## Architecture

```
Trigger.dev Cloud (free tier, 50K runs/month)
  - Cron scheduling (replaces Celery Beat)
  - Dashboard: per-run logs, traces, fan-out tree view
  - Alerting: Slack/email on failure
          |
          | HTTP POST via Tailscale
          v
Bravo (Mac Mini M4)
  Task Bridge API (FastAPI :8003)
    -> Redis 7.4.2 (Celery broker)
      -> Celery Workers (concurrency=2)
          Queues: discovery | ingest | quality | freshness
            -> Ollama :11434 (nomic-embed-text, $0)
            -> NeonDB pgvector (existing plan)
```

**Key decisions:**
- Trigger.dev Cloud free tier = $0 (scheduler + dashboard + alerting)
- Celery Beat **removed** — Trigger.dev owns all scheduling
- No Apify — self-crawl with httpx + BS4 + Playwright (on Bravo) for JS-heavy sites
- No Claude API in ingest pipeline — Ollama-only for quality scoring
- yt-dlp for YouTube transcripts (free, no API key)
- Reddit via public JSON endpoints (no auth)
- Total incremental monthly cost: **$0**

## Components to Build

### 1. Task Bridge API (`mira-crawler/bridge.py`)

Thin FastAPI app that translates Trigger.dev HTTP calls into Celery `.delay()` calls.

```
POST /tasks/discover       -> discover_all_manufacturers.delay()
POST /tasks/ingest         -> ingest_all_pending.delay()
POST /tasks/foundational   -> ingest_foundational_kb.delay()
POST /tasks/rss            -> poll_rss_feeds.delay()
POST /tasks/sitemaps       -> check_sitemaps.delay()
POST /tasks/youtube        -> ingest_youtube_channels.delay()
POST /tasks/reddit         -> scrape_forums.delay()
POST /tasks/patents        -> scrape_patents.delay()
POST /tasks/gdrive         -> sync_google_drive.delay()
POST /tasks/freshness      -> audit_stale_content.delay()
POST /tasks/photos         -> ingest_equipment_photos.delay()
POST /tasks/report         -> generate_ingest_report.delay()
GET  /tasks/status/:id     -> poll Celery result backend
GET  /health               -> Redis ping + worker count
```

Auth: Bearer token via `TASK_BRIDGE_API_KEY` env var (Doppler).
Port: 8003 on Bravo, accessible via Tailscale only.

### 2. Trigger.dev TypeScript Tasks (`mira-crawler/trigger/`)

New directory for Trigger.dev task definitions. Each task is a thin TypeScript stub that POSTs to the bridge:

```typescript
// trigger/src/tasks/nightly-ingest.ts
import { schedules } from "@trigger.dev/sdk/v3";

export const nightlyIngest = schedules.task({
  id: "nightly-ingest",
  cron: { pattern: "15 2 * * *", timezone: "America/New_York" },
  run: async () => {
    const resp = await fetch("http://100.86.236.11:8003/tasks/ingest", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.TASK_BRIDGE_API_KEY}` },
    });
    return resp.json();
  },
});
```

### 3. New Celery Tasks

#### a. `tasks/rss.py` — RSS Feed Monitor
- 20+ feeds from manufacturer and industry sources
- Uses `feedparser` (stdlib-level, no API key)
- Checks `last_seen_guid` in Redis to skip already-ingested articles
- Queues `ingest_url.delay()` for each new article
- Schedule: every 15 minutes

Feed list (initial):
```python
RSS_FEEDS = [
    {"name": "Fluke Blog", "url": "https://www.fluke.com/en-us/learn/blog/rss"},
    {"name": "PlantServices", "url": "https://www.plantservices.com/rss/"},
    {"name": "ReliabilityWeb", "url": "https://reliabilityweb.com/feed"},
    {"name": "Maintenance Phoenix", "url": "https://maintenancephoenix.com/feed"},
    {"name": "ABB Conversations", "url": "https://new.abb.com/news/feed"},
    {"name": "Emerson Exchange", "url": "https://www.emerson.com/en-us/automation/rss"},
    {"name": "SKF Evolution", "url": "https://evolution.skf.com/feed/"},
    # ... expand to 20+
]
```

#### b. `tasks/sitemaps.py` — Sitemap Diff Monitor
- Downloads XML sitemaps from manufacturer sites
- Compares `<lastmod>` dates against stored state in Redis
- Queues new/updated URLs for ingest
- Schedule: hourly

#### c. `tasks/youtube.py` — YouTube Transcript Ingest
- Uses yt-dlp to download `.vtt` subtitle files (no video download)
- Parses timestamped transcript into text blocks
- **Visual diagnostic frame extraction**: Detects visual moments via keywords:
  ```python
  VISUAL_CUE_KEYWORDS = [
      "look at", "you can see", "notice", "as shown", "right here",
      "this is what", "see how", "pointing to", "the display shows",
      "the meter reads", "fault code", "error on screen", "nameplate",
      "let me show", "zoom in", "close up",
  ]
  ```
  When a visual cue is detected in the transcript:
  1. Extract the timestamp from the .vtt
  2. Use yt-dlp + ffmpeg to extract the video frame at that timestamp
  3. Save as `{video_id}_{timestamp}.jpg` in `~/ingest_staging/youtube_frames/`
  4. Store metadata: `{video_url, timestamp, transcript_context, frame_path}`
  5. These frames become synthetic test cases for MIRA's vision pipeline (photo → diagnosis)
- Chunks transcript text into KB entries (source_type: "youtube_transcript")
- Schedule: nightly

Channel list (initial):
```python
YOUTUBE_CHANNELS = [
    "https://youtube.com/@FlukeTestTools",
    "https://youtube.com/@ABBgroupnews",
    "https://youtube.com/@RSAutomation",
    "https://youtube.com/@KleinTools",
    "https://youtube.com/@realPars",         # PLC/automation tutorials
    "https://youtube.com/@TheEngineeringMindset",
    "https://youtube.com/@SkillcatApp",      # HVAC/electrical maintenance
    "https://youtube.com/@electricianU",
    # ... expand as discovered
]
```

#### d. `tasks/reddit.py` — Reddit Forum Scraping
- Uses public JSON endpoints (no PRAW, no OAuth)
- Pattern: `https://www.reddit.com/r/{sub}/top.json?t=week&limit=50`
- Subreddits: `r/PLC`, `r/IndustrialMaintenance`, `r/electricians`
- Extracts post title + body + top comments
- Dedup by Reddit post ID in Redis
- Schedule: weekly

#### e. `tasks/patents.py` — Google Patents Scraping
- Searches Google Patents for maintenance-relevant equipment patents
- Queries: "VFD fault detection", "bearing condition monitoring", "motor protection relay"
- Extracts patent abstract + claims (most useful for KB)
- Uses httpx + BS4 (Google Patents renders server-side, no JS needed)
- Schedule: monthly

#### f. `tasks/gdrive.py` — Google Drive Sync
- Uses rclone (already configured) to sync from shared Drive folders
- Watches `~/gdrive_sync/` for new PDFs
- Queues each new file for `ingest_url.delay()` (local file:// path)
- Schedule: nightly

#### g. `tasks/freshness.py` — Stale Content Audit
- Queries NeonDB for entries past their TTL per source_type:
  | Source Type | TTL |
  |-------------|-----|
  | equipment_manual | 365 days |
  | knowledge_article | 90 days |
  | standard | 180 days |
  | curriculum | Never |
  | forum_post | 30 days |
  | youtube_transcript | Never |
  | patent | Never |
  | rss_article | 90 days |
- Marks stale entries with `metadata.is_stale = true`
- Queues re-crawl for URLs that have stale entries
- Schedule: weekly

#### h. `tasks/playwright_crawler.py` — JS-Heavy Site Crawler
- Replaces Apify for Siemens, SKF, Emerson
- Uses Playwright headless Chromium on Bravo
- Respects robots.txt (reuses existing `robots_checker.py`)
- Rate limited: 1 page/5 seconds
- Schedule: triggered by discovery tasks

### 4. Quality Gates (in `ingest/quality.py`)

Applied to every chunk before INSERT. All use Ollama embeddings ($0):

```python
def quality_gate(chunk: dict, embedding: list[float], tenant_id: str) -> tuple[bool, str]:
    """Returns (pass, reason). All scoring via Ollama — no external API."""

    # Gate 1: Relevance scoring
    # Cosine similarity vs 10 hand-picked anchor embeddings
    # Threshold: > 0.35
    relevance = max(cosine_sim(embedding, anchor) for anchor in ANCHOR_EMBEDDINGS)
    if relevance < 0.35:
        return False, f"low_relevance:{relevance:.3f}"

    # Gate 2: Semantic dedup
    # Cosine similarity vs recent 1000 entries in NeonDB
    # Threshold: < 0.95 (reject near-duplicates)
    nearest = pgvector_nearest(embedding, tenant_id, limit=1)
    if nearest and nearest.similarity > 0.95:
        return False, f"near_duplicate:{nearest.similarity:.3f}"

    # Gate 3: Content filter (heuristic, no LLM)
    # Reject boilerplate, navigation, cookie banners
    text = chunk["text"]
    if len(text) < 80:
        return False, "too_short"
    alpha_ratio = sum(c.isalpha() for c in text) / max(len(text), 1)
    if alpha_ratio < 0.5:
        return False, f"low_alpha:{alpha_ratio:.2f}"
    sentence_count = text.count('.') + text.count('!') + text.count('?')
    if sentence_count < 2:
        return False, "too_few_sentences"

    return True, "pass"
```

Quarantined chunks go to `quality_quarantine` table (same schema as knowledge_entries, plus `rejection_reason` column).

### 5. Anchor Embeddings

10 hand-picked "gold standard" chunks that represent ideal KB content. Stored in `mira-crawler/ingest/anchors.json`:

```json
[
  {"text": "To troubleshoot a PowerFlex 525 F004 fault, first check DC bus voltage...", "source": "rockwell_manual"},
  {"text": "Bearing temperature above 180F indicates lubrication failure or misalignment...", "source": "skf_handbook"},
  ...
]
```

Generated once by embedding these texts via Ollama. Used as the reference point for relevance scoring.

### 6. Celery Config Updates (`celeryconfig.py`)

- Remove `beat_schedule` entirely (Trigger.dev replaces it)
- Add new queues: `quality`, `freshness`
- Add new task routes for new tasks
- Raise concurrency from 2 to 3 (Bravo M4 has headroom)

### 7. Docker Changes

Update `mira-crawler/docker-compose.yml`:
- Remove `mira-celery-beat` service (Trigger.dev replaces it)
- Add `mira-task-bridge` service (FastAPI :8003)
- Add Playwright to Celery worker Dockerfile (for JS-heavy crawling)
- Keep Redis + worker

New service in root `docker-compose.yml`:
```yaml
mira-task-bridge:
  build:
    context: .
    dockerfile: mira-crawler/Dockerfile.bridge
  container_name: mira-task-bridge
  restart: unless-stopped
  ports:
    - "8003:8003"
  environment:
    - CELERY_BROKER_URL=redis://mira-redis:6379/0
    - TASK_BRIDGE_API_KEY=${TASK_BRIDGE_API_KEY}
  networks:
    - core-net
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8003/health"]
    interval: 30s
    timeout: 5s
    retries: 3
```

### 8. YouTube Visual Frame Pipeline

When processing YouTube transcripts, the system extracts diagnostic-relevant video frames:

```
yt-dlp (transcript .vtt)
    -> parse timestamps + text
    -> detect VISUAL_CUE_KEYWORDS at timestamp T
    -> yt-dlp + ffmpeg: extract frame at T
    -> save to ~/ingest_staging/youtube_frames/{video_id}_{T}.jpg
    -> store metadata in NeonDB: {video_url, timestamp, transcript_context, frame_path}
    -> these frames become synthetic test cases for MIRA vision pipeline
```

Output: a growing library of real-world diagnostic screenshots (meter readings, fault displays, nameplates, equipment conditions) that can be submitted to MIRA as if a technician sent them via Telegram.

## Schedule Summary (all via Trigger.dev cron)

| Frequency | Task | Source |
|-----------|------|--------|
| Every 15 min | `poll_rss_feeds` | 20+ RSS feeds |
| Every 15 min | `scan_watch_folder` | `~/ingest_dropbox/` |
| Hourly | `check_sitemaps` | Manufacturer XML sitemaps |
| Hourly | `ingest_all_pending` | manual_cache table |
| Nightly 2:15am | `ingest_pending_manuals` | Queued PDFs |
| Nightly 3:00am | `ingest_youtube_channels` | 8+ YouTube channels |
| Nightly 3:30am | `sync_google_drive` | Shared Drive folders |
| Nightly 4:00am | `generate_ingest_report` | NeonDB stats → Telegram |
| Weekly Sun 3am | `discover_all_manufacturers` | 5 manufacturer sites |
| Weekly Sun 4am | `scrape_forums` | Reddit 3 subreddits |
| Weekly Sun 5am | `audit_stale_content` | NeonDB freshness check |
| Monthly 1st 4am | `ingest_foundational_kb` | 12 direct + 6 crawl targets |
| Monthly 1st 5am | `ingest_equipment_photos` | Next batch from 3,694 photos |
| Monthly 15th 4am | `scrape_patents` | Google Patents |

## Cost Model

| Component | Monthly Cost |
|-----------|-------------|
| Trigger.dev Cloud (free tier) | $0 |
| Redis (self-hosted Bravo) | $0 |
| Celery workers (self-hosted Bravo) | $0 |
| Ollama embeddings (self-hosted Bravo) | $0 |
| yt-dlp (open source) | $0 |
| feedparser (open source) | $0 |
| Playwright (self-hosted Bravo) | $0 |
| rclone (open source) | $0 |
| NeonDB | Existing plan (no incremental) |
| **Total incremental** | **$0/month** |

## Files to Create/Modify

### New files:
| File | Purpose |
|------|---------|
| `mira-crawler/bridge.py` | Task Bridge API (FastAPI :8003) |
| `mira-crawler/Dockerfile.bridge` | Dockerfile for bridge service |
| `mira-crawler/tasks/rss.py` | RSS feed monitor |
| `mira-crawler/tasks/sitemaps.py` | Sitemap diff monitor |
| `mira-crawler/tasks/youtube.py` | YouTube transcript ingest + frame extraction |
| `mira-crawler/tasks/reddit.py` | Reddit forum scraping |
| `mira-crawler/tasks/patents.py` | Google Patents scraping |
| `mira-crawler/tasks/gdrive.py` | Google Drive sync |
| `mira-crawler/tasks/freshness.py` | Stale content audit |
| `mira-crawler/tasks/playwright_crawler.py` | JS-heavy site crawler |
| `mira-crawler/ingest/quality.py` | Quality gate pipeline |
| `mira-crawler/ingest/anchors.json` | 10 anchor embeddings for relevance scoring |
| `mira-crawler/trigger/` | Trigger.dev TypeScript project |
| `mira-crawler/trigger/src/tasks/*.ts` | Trigger.dev cron task stubs |
| `mira-crawler/trigger/package.json` | Trigger.dev dependencies |
| `mira-crawler/tests/test_rss.py` | RSS task tests |
| `mira-crawler/tests/test_youtube.py` | YouTube task tests |
| `mira-crawler/tests/test_quality.py` | Quality gate tests |
| `mira-crawler/tests/test_bridge.py` | Bridge API tests |

### Modified files:
| File | Change |
|------|--------|
| `mira-crawler/celeryconfig.py` | Remove beat_schedule, add new queues/routes |
| `mira-crawler/celery_app.py` | Register new task modules |
| `mira-crawler/docker-compose.yml` | Remove beat, add bridge, update worker |
| `mira-crawler/Dockerfile.celery` | Add Playwright + yt-dlp + feedparser deps |
| `mira-crawler/tasks/ingest.py` | Wire quality gate into `ingest_url` before INSERT |
| `mira-crawler/ingest/store.py` | Add `quality_quarantine` table writes |
| `docker-compose.yml` (root) | Add mira-task-bridge + mira-redis services |

### Existing files reused (no changes):
| File | Reused For |
|------|-----------|
| `mira-crawler/ingest/chunker.py` | All chunking (unchanged) |
| `mira-crawler/ingest/embedder.py` | All Ollama embedding (unchanged) |
| `mira-crawler/ingest/converter.py` | PDF/HTML extraction (unchanged) |
| `mira-crawler/crawler/robots_checker.py` | Robots.txt compliance (unchanged) |
| `mira-crawler/crawler/rate_limiter.py` | Crawl rate limiting (unchanged) |
| `mira-crawler/ingest/dedup.py` | URL-level dedup (unchanged) |

## Implementation Order

1. **Deploy existing stack** — Get Redis + Celery worker running on Bravo with current tasks
2. **Build Task Bridge API** — FastAPI bridge that translates HTTP → Celery .delay()
3. **Set up Trigger.dev** — Create project, define cron schedules, connect to bridge
4. **Quality gates** — Build quality.py, anchor embeddings, wire into ingest pipeline
5. **New source tasks** — RSS, sitemaps, YouTube (with frame extraction), Reddit
6. **Extended sources** — Google Drive, patents, Playwright crawler, freshness audit
7. **Observability** — Ingest report to Telegram, Trigger.dev alerting config

## Verification

- [ ] Redis container healthy on Bravo
- [ ] Celery worker processing tasks (verify with `celery inspect ping`)
- [ ] Task Bridge API responding on :8003 (`curl http://localhost:8003/health`)
- [ ] Trigger.dev dashboard showing scheduled runs
- [ ] RSS feed poll returns new articles
- [ ] YouTube transcript + frame extraction works for one channel
- [ ] Quality gate correctly quarantines low-relevance chunks
- [ ] NeonDB row count growing (query `SELECT COUNT(*) FROM knowledge_entries`)
- [ ] Ingest report delivered to Telegram nightly
- [ ] All new tasks have pytest coverage
