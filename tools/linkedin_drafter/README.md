# LinkedIn Draft Automation — Operator Runbook

Generates LinkedIn posts for Mike Harper's hydraulics group, applying Frankie
Fihn's Loom Conversion Machine framework. Posts are generated as Celery tasks
and saved as markdown files for review before copy/paste to LinkedIn.

## Architecture

```
Celery Beat (Mon/Wed/Fri 8am ET)
  → linkedin.draft_post task
    → Reads voice.md + topics.md + weights.yml + recent history (Redis)
    → Calls Claude via httpx + tool_use (schema-validated output)
    → Writes ~/drafts/linkedin/drafts/YYYY-MM-DD-<type>.md
    → Records metadata in Redis for Grafana dashboard
```

## Daily workflow (Mike's ritual)

1. Open Finder: `~/drafts/linkedin/drafts/`
2. Read the latest `.md` file (30 seconds)
3. Select all the "full_post" section, copy
4. Paste into LinkedIn composer, publish
5. Move the used draft to `~/drafts/linkedin/posted/`

Moving to `posted/` is the feedback loop — the task reads recent posted
files to avoid repeating hooks and topics.

## Where things live

| What | Path |
|------|------|
| Voice profile (system prompt) | `mira-crawler/linkedin/voice.md` |
| Topic backlog | `mira-crawler/linkedin/topics.md` |
| Post-type weights | `mira-crawler/linkedin/weights.yml` |
| Prompt template | `mira-crawler/linkedin/prompt_template.md` |
| Celery task code | `mira-crawler/tasks/linkedin.py` |
| Generated drafts | `~/drafts/linkedin/drafts/` |
| Used drafts (feedback) | `~/drafts/linkedin/posted/` |

## Edit voice, topics, or weights (no restart needed)

All three config files are read fresh on every task run. To change content
strategy, just edit the file. The next run picks it up automatically.

```bash
# Edit voice profile
vim ~/Documents/mira/mira-crawler/linkedin/voice.md

# Add a timely topic (add to the TOP of the file)
vim ~/Documents/mira/mira-crawler/linkedin/topics.md

# Shift to Phase 2 (engagement) — uncomment the Phase 2 block in weights
vim ~/Documents/mira/mira-crawler/linkedin/weights.yml
```

## Manual trigger (don't wait until Monday)

```bash
# Generate a draft immediately
docker exec mira-celery-worker celery -A mira_crawler.celery_app \
  call linkedin.draft_post

# Force a specific post type
docker exec mira-celery-worker celery -A mira_crawler.celery_app \
  call linkedin.draft_post --args='["pain_story"]'

# Check results
ls ~/drafts/linkedin/drafts/
docker exec mira-redis redis-cli ZREVRANGE linkedin:drafts 0 0 WITHSCORES
```

## Dashboards

| Dashboard | URL | Credentials |
|-----------|-----|-------------|
| Flower (task history) | http://localhost:5555 | admin / mira2026 |
| Grafana (metrics + drafts) | http://localhost:3001 | admin / mira2026 |

In Grafana, navigate to **MIRA > MIRA Celery + LinkedIn Drafts** to see:
- Worker health, queue depth, task success rate
- Task throughput by name (all Celery tasks)
- LinkedIn-specific: drafts generated, drafts by type, recent 10 drafts table

## Start / stop

```bash
cd ~/Documents/mira

# Start everything (Celery + observability)
doppler run --project factorylm --config prd -- \
  docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d

# Stop
docker compose -f docker-compose.yml -f docker-compose.observability.yml down

# Logs
docker compose logs -f mira-celery-worker
docker compose logs -f mira-celery-beat
```

## Warm-up strategy

The LinkedIn group has been dormant for 15 years. Content phases are
controlled via `weights.yml`:

- **Phase 1 (months 1-2):** general_ai_maintenance=30, hand_raiser=3.
  Value-only. Zero sales pressure. Build trust.
- **Phase 2 (months 3-4):** Shift toward case_study and insight. Introduce
  soft MIRA mentions. Still only hand_raiser=5.
- **Phase 3 (month 5+):** Balanced rotation. hand_raiser=15. Real CTAs.

Only shift phases after seeing real engagement (comments, DMs, group activity).
