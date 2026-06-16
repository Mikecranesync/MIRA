# Runbook: Prejudged Multi-Turn Benchmark

## Overview

The prejudged benchmark tests MIRA's full diagnostic arc over multi-turn Socratic conversations. Unlike the single-turn Reddit benchmark (which measures triage quality), this benchmark uses cases where the answer is already known and simulates complete technician conversations, measuring whether MIRA's questioning path leads to the correct root cause.

## Architecture

```
seed_cases.json + Reddit solved threads
    |
build_case_corpus.py -> prejudged_cases table
    |
prejudged_benchmark_run.py
    |
    ├─ FOR each case:
    │   ├─ Supervisor.process() ──> MIRA reply
    │   ├─ Read FSM state from SQLite
    │   ├─ Answer Simulator (Claude sonnet) ──> technician reply
    │   └─ Loop until DIAGNOSIS or max 8 turns
    │
    ├─ Evidence Judge (Claude sonnet) ──> 5 dimension scores
    └─ Store transcript + scores in prejudged_conversations
    |
prejudged_benchmark_report.py -> CSV + console summary
```

## Prerequisites

| Requirement | Where |
|-------------|-------|
| `anthropic` SDK | `mira-bots/telegram/requirements.txt` |
| `ANTHROPIC_API_KEY` | Doppler `factorylm/prd` |
| `httpx>=0.27` | For Reddit comment fetching (corpus building) |
| Seed cases loaded | `python build_case_corpus.py --seed-only` |

## Setup

### 1. Build the case corpus

```bash
# Seed cases only (no network, no API key needed)
python mira-core/scripts/build_case_corpus.py --seed-only

# Seed + Reddit solved threads (needs ANTHROPIC_API_KEY)
doppler run --project factorylm --config prd -- \
  python mira-core/scripts/build_case_corpus.py
```

### 2. Run the benchmark

```bash
# Single case (quick test)
docker exec mira-bot-telegram python /app/scripts/prejudged_benchmark_run.py --case-id 1

# Limited run
docker exec mira-bot-telegram python /app/scripts/prejudged_benchmark_run.py --limit 3

# Full run (all cases)
docker exec mira-bot-telegram python /app/scripts/prejudged_benchmark_run.py
```

### 3. Generate report

```bash
# Console report (latest run)
python mira-bots/scripts/prejudged_benchmark_report.py

# Specific run + CSV export
python mira-bots/scripts/prejudged_benchmark_report.py --run-id 1 --csv report.csv

# JSON summary
python mira-bots/scripts/prejudged_benchmark_report.py --run-id 1 --json summary.json
```

## Scoring System

### 5 Dimensions (weighted)

| Dimension | Weight | What it measures |
|-----------|--------|------------------|
| Evidence Utilization | 0.20 | Did MIRA ask for the key evidence? |
| Path Efficiency | 0.20 | How many turns to reach root cause? |
| GSD Compliance | 0.25 | Socratic method adherence |
| Root Cause Alignment | 0.25 | Does MIRA's diagnosis match ground truth? |
| Expert Comparison | 0.10 | Would a master tech approve? |

### Verdict Thresholds

| Verdict | Score Range |
|---------|-------------|
| Excellent | >= 8.5 |
| Good | >= 7.0 |
| Acceptable | >= 5.0 |
| Poor | >= 3.0 |
| Failed | < 3.0 |

## Multi-Turn Simulation

Each case follows this flow:

1. Send `evidence_packet` as first message to MIRA
2. MIRA responds with a diagnostic question (state advances Q1 -> Q2 -> Q3)
3. Answer Simulator (Claude sonnet) plays a technician who knows the ground truth
4. Technician reveals observations naturally when MIRA asks about the right area
5. Technician says "looks fine" when MIRA asks about irrelevant areas
6. Loop continues until MIRA reaches DIAGNOSIS/FIX_STEP/RESOLVED or max 8 turns
7. On turns 6-7, simulator drops stronger hints if MIRA is stuck

## Database Tables

Three new tables in the shared SQLite DB (`MIRA_DB_PATH`):

- **`prejudged_cases`** -- cases with ground truth (seed or reddit_solved)
- **`prejudged_runs`** -- each benchmark execution
- **`prejudged_conversations`** -- per-case transcript, 5 dimension scores, verdict

## Seed Cases

10 hand-crafted cases covering:

1. VFD overcurrent fault on startup (Allen-Bradley PowerFlex 525)
2. Bearing failure vibration on pump motor
3. PLC communication loss to remote I/O rack
4. Compressor high-head pressure alarm (Kaeser)
5. Conveyor belt tracking/alignment issue
6. Motor overheating under load (3-phase)
7. Hydraulic cylinder slow response
8. Proximity sensor intermittent detection
9. Soft starter bypass contactor failure
10. Chiller low refrigerant alarm

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `MIRA_DB_PATH` | `/data/mira.db` | SQLite path |
| `ANTHROPIC_API_KEY` | (required) | For answer simulator + judge |
| `OPENWEBUI_BASE_URL` | `http://mira-core:8080` | Open WebUI endpoint |
| `OPENWEBUI_API_KEY` | (required) | API key |
| `KNOWLEDGE_COLLECTION_ID` | (required) | KB collection UUID |

## Deploy to BRAVO

```bash
# Copy scripts to BRAVO
scp mira-bots/scripts/prejudged_benchmark_run.py bravonode:~/Mira/mira-bots/scripts/
scp mira-bots/scripts/prejudged_benchmark_report.py bravonode:~/Mira/mira-bots/scripts/
scp mira-core/scripts/build_case_corpus.py bravonode:~/Mira/mira-core/scripts/
scp mira-core/data/seed_cases.json bravonode:~/Mira/mira-core/data/

# Copy into container
docker cp ~/Mira/mira-bots/scripts/prejudged_benchmark_run.py mira-bot-telegram:/app/scripts/
docker cp ~/Mira/mira-bots/shared/benchmark_db.py mira-bot-telegram:/app/shared/

# Run
docker exec mira-bot-telegram python /app/scripts/prejudged_benchmark_run.py --limit 1
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `No prejudged cases` | Run `build_case_corpus.py --seed-only` |
| `anthropic import error` | Install: `pip install anthropic` |
| `ANTHROPIC_API_KEY not set` | Add to Doppler or set in env |
| State leakage between cases | Verify `supervisor.reset()` called in finally block |
| Judge returns all zeros | Check Claude API connectivity and model availability |
| Slow runs | Use `--limit N` to cap case count |

## Verification Checklist

1. `python build_case_corpus.py --seed-only` -- loads 10 seed cases
2. `docker exec mira-bot-telegram python /app/scripts/prejudged_benchmark_run.py --limit 1` -- single case e2e
3. Verify transcript has alternating mira/technician turns
4. Verify judge scores populated (all 5 dimensions)
5. Verify `supervisor.reset()` called between cases (no state leakage)
6. `python prejudged_benchmark_report.py --run-id N` -- full report
7. `pytest test_prejudged.py -v` -- all tests pass
