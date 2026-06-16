# Paused / broken ingest + scraping — audit

**Date:** 2026-05-23
**Node audited:** CHARLIE (192.168.1.12)
**Scope:** every cron / launchd / Celery / Trigger.dev / Docker schedule that
ingests, scrapes, or evaluates anything in the MIRA stack.

## TL;DR

Two genuinely-paused pipelines, one broken-and-spamming-failures launchd job,
and one unresolved-merge-conflict service. The rest is alive and on cadence.

| Pipeline | State | Action |
|---|---|---|
| Trigger.dev Cloud (14 schedules — RSS, sitemaps, YouTube, gdrive, reddit, patents, foundational, photos, freshness) | **PAUSED — no API key in Doppler `factorylm/prd`** | Decide: deploy or retire |
| VPS `install_crons.sh` (14 cron jobs incl. weekly bench) | **Status unknown from CHARLIE** — script exists in repo, no recent `install` commit | SSH to VPS and `crontab -l` |
| `com.factorylm.mira-offline-eval` launchd | **Broken since 2026-05-22** — passes `--output` arg that `offline_run.py` doesn't accept | 1-line plist fix |
| `com.factorylm.brain-mcp` launchd | **Exit 1** — unresolved git merge conflict in source (`<<<<<<<` / `>>>>>>>` tokens) | Resolve conflict |
| `com.mira.lead-hunter` launchd | **Healthy** — last run 2026-05-23 18:03 | None |
| `com.factorylm.mira-drop-watcher` launchd | **Running** (PID 58943) | None |
| `com.factorylm.brain-ingest` launchd | **Running** (PID 841, :8500) | None |
| `com.factorylm.vastai-tunnel` launchd | **Running** | None |
| `com.factorylm.health-monitor` launchd | Loaded, 5-min interval | None |
| `com.mira.eval-fixer` launchd | Scheduled daily 01:00 — ran today, committed `4eeeeeed` | None |
| `com.mira.slack-agent` launchd | Loaded | Not in scope |

## 1 — Trigger.dev Cloud (the big paused one)

**What it does:** `mira-crawler/trigger/src/tasks/` defines 14 scheduled tasks
across `continuous.ts`, `hourly.ts`, `nightly.ts`, `weekly.ts`,
`monthly.ts`. They call back into the Celery `mira-task-bridge`
(`http://…:8003`) to trigger discovery/ingest:

| File | Tasks |
|---|---|
| `continuous.ts` | `pollRssFeeds`, `scanWatchFolder` |
| `hourly.ts` | `checkSitemaps`, `ingestPending` |
| `nightly.ts` | `nightlyYoutube`, `nightlyGdrive`, `nightlyReport` |
| `weekly.ts` | `weeklyDiscovery`, `weeklyReddit`, `weeklyFreshness` |
| `monthly.ts` | `monthlyFoundational`, `monthlyPhotos`, `monthlyPatents` |

**Why this exists separately from Celery beat:** commit `9b2f79c0` removed
Celery beat from the compose file in favour of Trigger.dev Cloud (commit
`f20b8de2`, "remove beat_schedule"). The test
`tests/test_celery_tasks.py::test_beat_schedule_removed` enforces this —
"scheduling is owned by Trigger.dev Cloud."

**Why it's paused:** no `TRIGGER_*` secret in Doppler `factorylm/prd`. No
`mira-crawler/trigger/.env` either. The TypeScript code exists; the cloud
project (`proj_mira-ingest`, per `trigger.config.ts`) is either never deployed
or deployed-then-orphaned. The matching `mira-celery-worker` /
`mira-task-bridge` / `mira-redis` Docker containers are also **not running on
CHARLIE** (none in `docker ps`).

**Note in `celeryconfig.py:100`:** the file still has a `beat_schedule` block
despite the test asserting it shouldn't exist — schedule drift. Worth a separate
PR to either delete it or update the test rationale.

**Decision needed:**
- (a) Re-deploy Trigger.dev (need `TRIGGER_API_KEY` + redeploy `trigger`
  dir + start `mira-celery-worker` + `mira-task-bridge`). 24/7 ingest comes
  back, with a Trigger.dev monthly bill.
- (b) Retire Trigger.dev, move the 14 schedules into VPS crontab
  (`install_crons.sh`) where the rest of MIRA's scheduling lives. Cheaper,
  one less moving part, but the worker stack still has to run somewhere.
- (c) Leave paused. Manual ingest via `~/MiraDrop/` + lead-hunter +
  `kb_growth_cron.py` (on the VPS, if installed) covers the day-to-day.

My read: **(c)** for now — MiraDrop + lead-hunter + KB growth cron cover the
real ingest. The 24/7 RSS/Reddit/patent firehose is volume MIRA doesn't yet
need. If/when an enterprise prospect demands "show me you ingest fresh OEM
docs nightly," revisit. **(b)** is a clean follow-up if Trigger.dev's
free-tier limits start biting.

## 2 — VPS `install_crons.sh` (likely-running, unverified)

**What it does:** `scripts/install_crons.sh` writes a 14-line crontab on the
prod VPS (`/opt/mira`). Notable entries:

```cron
0 * * * *     kb_growth_cron.py                                   # hourly KB PDF batch
0 3 * * 0     mira-bots/benchmarks/corpus/scraper.py              # Sunday Reddit refresh
0 4 * * 1     mira-bots/benchmarks/corpus/youtube_harvester.py    # Monday YouTube harvest
30 11 * * 2,4 mira-crawler/social/publisher.py --publish          # Tue/Thu social publish
0 9 * * *     morning_brief_runner.py                             # daily Telegram brief
0 12 * * *    pm_escalation_runner.py                             # daily PM nag
0 10 * * *    safety_alert_runner.py                              # daily safety sweep
0 2 * * 6     pytest tests/eval/ -q                               # WEEKLY EVAL — Sat 02 UTC
0 12 * * 1    billing_health.py                                   # weekly Stripe check
*/15 * * * *  heartbeat_monitor.py                                # health every 15 min
*/5 * * * *   external_probe.py                                   # external 200-check every 5 min
0 8 * * *     heartbeat_monitor.py --daily-summary                # daily 08 UTC summary
0 3 * * 6     learning_capture.py                                 # Sat 03 UTC after weekly eval
0 13 * * *    funnel_tracker.py                                   # daily 13 UTC funnel
30 13 * * 1   funnel_tracker.py --weekly                          # Monday 13:30 UTC Pulse
```

**Why "unknown":** I can't `ssh factorylm-prod` from this agent (prod-guard +
no creds). The script is idempotent — re-running on the VPS replaces the
whole crontab. There's already a weekly eval at `Sat 02 UTC` running
`pytest tests/eval/ -q` which covers the **golden-case** suite. The new
**mira_bench** suite (282 vs 255) is separate and not yet on this schedule —
the weekly workflow in this PR is the home for that.

**Action:** Mike runs `ssh factorylm-prod "crontab -l | head"` and confirms
the schedule is installed. If empty: `bash /opt/mira/scripts/install_crons.sh`.

## 3 — `com.factorylm.mira-offline-eval` (broken, spamming)

**Failure:** since `2026-05-22T14:10Z` every 4-hour invocation has been exiting
with status 2, log:

```
offline_run.py: error: unrecognized arguments: --output tests/eval/runs/offline-20260523T1810.md
usage: offline_run.py [-h] [--suite {text,photos,full,auto}] [--judge] …
```

The plist passes `--output PATH`. The script accepts no such flag — it computes
its own output path at `tests/eval/offline_run.py:363`:

```python
output_path = _RUNS_DIR / f"{run_date}-offline-{suite}.md"
```

**Fix:** drop the `--output` arg from `ProgramArguments` in
`/Users/charlienode/Library/LaunchAgents/com.factorylm.mira-offline-eval.plist`.

```bash
# 1. Edit the plist — replace the long bash -c string with:
#    cd /Users/charlienode/MIRA && \
#      /Users/charlienode/.local/bin/doppler run --project factorylm --config prd -- \
#      /usr/bin/python3 tests/eval/offline_run.py --suite text 2>>/tmp/mira-offline-eval.log

# 2. Reload
launchctl unload ~/Library/LaunchAgents/com.factorylm.mira-offline-eval.plist
launchctl load ~/Library/LaunchAgents/com.factorylm.mira-offline-eval.plist
```

(Plist is local to CHARLIE; not in git.)

## 4 — `com.factorylm.brain-mcp` (exit 1, merge conflict)

**Failure:**

```
/tmp/brain-mcp/stderr.log:
>>>>>>> 433ffad (feat(brain): graceful fallback + Open Brain startup protocol)
              ^
SyntaxError: invalid decimal literal
```

A git merge conflict marker is sitting in a Python source file under
`~/factorylm/services/`. The Python parser dies on `>>>>>>>`. The service
hasn't started since the conflict was introduced.

**Fix:** find the conflict, resolve it.

```bash
cd ~/factorylm
git grep -nE '^<<<<<<< |^>>>>>>> |^=======$' services/
# Resolve the conflict, commit, then:
launchctl kickstart -k gui/$(id -u)/com.factorylm.brain-mcp
```

Out of scope for this PR (different repo — `~/factorylm`, not `MIRA`).

## 5 — Everything else (healthy)

| Service | Cadence | Last run | Notes |
|---|---|---|---|
| `lead-hunter` | hourly @ :00 | 2026-05-23 18:03 (enriched 20 leads in Clewiston, FL) | Hardened runner; alert sink writes to `marketing/prospects/hardening-alerts.jsonl` |
| `mira-drop-watcher` | always-on | live | `~/MiraDrop/inbox/` → Hub `/api/uploads/folder` → KB |
| `brain-ingest` | always-on | live :8500 | Doppler `factorylm/dev`, uvicorn |
| `vastai-tunnel` | always-on | live | GPU tunnel |
| `health-monitor` | every 5 min | live | `~/factorylm/scripts/health-check.sh` |
| `eval-fixer` | daily 01:00 | 2026-05-23 (commits `4eeeeeed`, `abdcbd87`) | Wiki-writing eval |

## Recommendations

1. **Resolve the offline-eval plist** (1-line, local). Stops the
   spam in `/tmp/mira-offline-eval-stderr.log` (200+ failed runs since
   2026-05-22).
2. **Resolve the brain-mcp conflict** in `~/factorylm/` (1 file).
3. **Verify VPS crontab** is installed (`ssh factorylm-prod "crontab -l"`).
   If not: `bash scripts/install_crons.sh` on the VPS.
4. **Decide Trigger.dev fate** — see § 1.
5. **Delete `beat_schedule` from `mira-crawler/celeryconfig.py`** to match
   the existing test assertion (`test_beat_schedule_removed`). Schedule
   drift is a foot-gun once someone wires up Celery beat again.
