# MIRA Autonomous Build Schedule

**Last updated:** 2026-04-22
**Status:** Active (Charlie + VPS + Bravo configured; Alpha needs repo clone)

---

## Machine Inventory

| Machine | Role | State | MIRA repo |
|---------|------|-------|-----------|
| Charlie (192.168.1.12) | KB host, Claude Code primary | ✅ up 30d | `/Users/charlienode/MIRA` |
| Bravo (192.168.1.11) | Compute / Ollama | ✅ up 30d, load ~6 | `/Users/bravonode/Mira` |
| Alpha (192.168.4.28) | Orchestrator | ✅ up 51d | ❌ needs clone |
| VPS (factorylm-prod) | Production | ✅ all 15 containers healthy | `/opt/mira` |

**VPS Celery:** master_of_puppets worker + beat alive (started Apr20). MIRA has no Celery — all MIRA automation uses cron + docker exec.

---

## Token Classification

| Task | Type | Tokens/run | Machine | Frequency |
|------|------|-----------|---------|-----------|
| Nightly eval (deterministic) | COMPUTE | 0 — HTTP to pipeline | VPS cron | Daily 2AM UTC |
| Nightly eval (LLM judge) | TOKEN | ~10K via Groq | VPS cron | Daily 3AM UTC |
| Morning briefing delivery | TOKEN | ~500/user via Groq | VPS cron | 5-7AM UTC every 15min |
| pytest offline suite | COMPUTE | 0 — pure Python | Bravo cron | Nightly 3AM local |
| Offline eval (local pipeline) | COMPUTE | 0 — no external API | Charlie launchd | Every 4h |
| Lead hunter | TOKEN | ~20K via WebSearch | Charlie cowork | Daily 6AM local |
| Competitive intel | TOKEN | ~10K via WebSearch | Charlie cowork | Sunday 9AM local |
| Contact enrichment | TOKEN | ~50K via WebSearch | Charlie cowork | Mon+Thu 7AM local |
| KB gap crawl | COMPUTE | 0 — Apify + HTTP | VPS on-demand | Manual trigger |
| Ollama embedding | COMPUTE | 0 — local GPU | Bravo | On demand |

**Daily token budget: ~80K ≈ $0.08–0.12/day** (Groq pricing). Nothing on Max plan.

---

## Charlie Schedule (this machine)

### Already running
- Cowork scheduled tasks: lead hunter, competitive intel, contact enrichment
- Claude Code sessions triggered by Mike

### launchd: Offline Eval every 4h

Plist: `~/Library/LaunchAgents/com.factorylm.mira-offline-eval.plist`
Installed: see below.

```
Command: doppler run --project factorylm --config prd -- python3 tests/eval/offline_run.py
Output: tests/eval/runs/offline-YYYYMMDDTHHMM.md
```

---

## VPS Schedule

### Existing crons (already in crontab)
- `0 2 * * *` — MIRA nightly eval (deterministic, `/opt/mira/tests/eval/run_eval.py`)
- `0 4 * * *` — GDrive backup
- `0 3 * * *` — OpenClaw Doppler sync
- `*/10 * * * *` — network health check

### Added crons
- `5 3 * * *` — MIRA judge eval (`offline_run.py --suite text --judge`, ~10K Groq tokens, log: `/var/log/mira-judge-eval.log`)
- `*/15 5-9 * * *` — Morning briefing delivery (**PENDING** — no dispatch endpoint yet; `POST /api/briefing/profiles` exists but no `/deliver` route; needs implementation before enabling)

---

## Bravo Schedule

### Nightly pytest (pure compute, no tokens)
- `0 3 * * *` — `cd ~/Mira && git pull origin main -q && /opt/homebrew/bin/python3 -m pytest mira-bots/tests/ tests/ -x -q --ignore=<pre-existing-failures> > ~/mira-pytest.log 2>&1`
- Ignores: `regime5_nemotron/`, `regime6_sidecar/`, `test_mira_pipeline.py`, `test_atlas_cmms_integration.py`, `test_fault_code_lookup.py`, `test_session_memory.py`, `test_slack_relay.py`, `test_email_adapter.py`

---

## Alpha Setup (Mike action required)

Alpha has no MIRA repo. To enable Alpha for long-running crawls:

```bash
ssh alpha
cd ~
git clone git@github.com:Mikecranesync/MIRA.git
cd MIRA
# Doppler token for alpha: set in doppler configure
doppler configure set token TOKEN_HERE
```

Once cloned, Alpha can run:
- Long-running Apify crawls (KB building) without VPS memory pressure
- Bulk PDF extraction with PyMuPDF

---

## What requires Mike's action

| Item | Why | Effort |
|------|-----|--------|
| Clone MIRA repo on Alpha | No MIRA there yet | 5 min |
| Ollama on Bravo | Not installed, needed for local vision inference | 15 min |
| Bravo SSH key to GitHub | ✅ Already works — `git fetch` succeeded | Done |
| Morning briefing dispatch | Implement `/api/briefing/deliver` endpoint in mira-pipeline | ~1h |
