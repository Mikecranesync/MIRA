# Runbook: Reddit Benchmark Agent

## Overview

The Reddit Benchmark Agent harvests real maintenance questions from Reddit, feeds them through MIRA's diagnosis engine (Supervisor), and produces reports measuring confidence distribution, latency, and error rates.

## Architecture

```
Reddit public JSON (/top.json)
    |
reddit_harvest.py -> benchmark_questions table
    |
reddit_benchmark_run.py -> Supervisor.process_full() -> benchmark_results table
    |
reddit_benchmark_report.py -> CSV + console summary
    |
FastAPI routes (/agents/reddit-benchmark/*) -- API access to all of the above
```

## Prerequisites

| Requirement | Where |
|-------------|-------|
| `httpx>=0.27` | `mira-core/mira-ingest/requirements.txt` (already included) |
| `langfuse>=2.0` | `mira-bots/telegram/requirements.txt` (optional -- no-op if unconfigured) |
| Feature flag enabled | `REDDIT_BENCHMARK_ENABLED=1` |

No Reddit API credentials required. The harvester uses Reddit's public JSON endpoints.

## Setup

1. **Enable feature flag:**
   ```
   REDDIT_BENCHMARK_ENABLED=1
   ```
2. That's it. No API keys, no app registration.

## Usage

### CLI -- Harvest questions

```bash
python mira-core/scripts/reddit_harvest.py
```

No Doppler wrapper needed -- zero credentials required. Optionally set `MIRA_DB_PATH` to control the SQLite location.

### CLI -- Run benchmark

```bash
doppler run --project factorylm --config prd -- \
  python mira-bots/scripts/reddit_benchmark_run.py
```

### CLI -- Generate report

```bash
# Console report (latest run)
python mira-bots/scripts/reddit_benchmark_report.py

# Specific run + CSV export
python mira-bots/scripts/reddit_benchmark_report.py --run-id 1 --csv report.csv
```

### API -- via mira-ingest FastAPI

All routes require `REDDIT_BENCHMARK_ENABLED=1`. Without it, they return 503.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/reddit-benchmark/harvest` | Trigger Reddit harvest |
| GET | `/agents/reddit-benchmark/questions?limit=50&offset=0` | List harvested questions |
| GET | `/agents/reddit-benchmark/runs` | List benchmark runs |
| GET | `/agents/reddit-benchmark/runs/{id}/results` | Results for a run |
| GET | `/agents/reddit-benchmark/runs/{id}/report` | Summary report for a run |

### Example API calls

```bash
# Harvest
curl -X POST http://localhost:8002/agents/reddit-benchmark/harvest

# List questions
curl http://localhost:8002/agents/reddit-benchmark/questions?limit=5

# Get report
curl http://localhost:8002/agents/reddit-benchmark/runs/1/report
```

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `REDDIT_BENCHMARK_ENABLED` | `0` | Feature flag -- must be `1` to activate |
| `BENCHMARK_LIMIT` | `0` (all) | Max questions per benchmark run |
| `LANGFUSE_SECRET_KEY` | (unset) | Langfuse telemetry -- no-op when unset |
| `LANGFUSE_PUBLIC_KEY` | (unset) | Langfuse telemetry -- no-op when unset |
| `LANGFUSE_HOST` | `cloud.langfuse.com` | Langfuse endpoint |

Subreddits and harvest limits are hardcoded in `reddit_harvest.py` (5 subreddits, up to 200 posts each via pagination).

## Database Tables

Three tables in the shared SQLite DB (`MIRA_DB_PATH`):

- **`benchmark_questions`** -- harvested Reddit posts (deduped by `post_id`)
- **`benchmark_runs`** -- each benchmark execution with status + timing
- **`benchmark_results`** -- per-question results: reply, confidence, latency, errors

## Telemetry (Langfuse)

Langfuse integration is graceful no-op -- when `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` are unset (current state on BRAVO), all telemetry calls silently do nothing. No import errors, no runtime failures.

When Langfuse is deployed:
- Each `Supervisor.process_full()` call creates a Langfuse trace
- Vision worker and RAG worker calls are wrapped in spans
- `trace_id` is stored in benchmark results for correlation

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `503 -- disabled` | Set `REDDIT_BENCHMARK_ENABLED=1` |
| `429` rate limited | Wait a few minutes -- Reddit throttles unauthenticated requests |
| `No questions in DB` | Run harvest first |
| Langfuse errors in logs | Non-fatal -- check keys or ignore |
