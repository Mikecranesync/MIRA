# autoeval: unattended MIRA judge runner

Runs MIRA's existing deterministic test lanes for the changed paths, then judges the recorded
release-gate answers with the repo's own judge (`evals/scripts/judge_baseline.py`, unmodified)
through a metered, budgeted, cached seam. Dry by default. Nothing is written inside a checkout.

## Files

| Path | Role |
|---|---|
| `evals/scripts/autoeval.py` | CLI: `run`, `seed`, `status` |
| `evals/scripts/autoeval_run.py` | CLI helpers: keys, budget config, lanes, spend, alert delivery |
| `evals/scripts/autoeval_budget.py` | Spend ledger and the one metered Claude call |
| `evals/scripts/autoeval_judge.py` | Verdict cache keyed on the rendered prompt; judge runner; seed replay |
| `evals/scripts/autoeval_select.py` | Changed-path lane selection; count parsing |
| `evals/scripts/autoeval_report.py` | Report, transition alerts, Mission Control block |
| `evals/autoeval.lanes.json` | Lane table (the exact test files that exist at base) |
| `tools/crew/autoeval/run.sh` | Wrapper: detached `origin/main` checkout, singleton lock, runs `autoeval run` |
| `tools/crew/autoeval/com.factorylm.autoeval.plist` | launchd job (not loaded by default) |
| `tests/eval/test_autoeval_*.py` | Hermetic tests (MockTransport, fake key, fake lane runner) |
| `tests/eval/autoeval_mutate.py` | Removes each guard in turn; each named test must go red |

## Default state dir

`~/.factorylm/autoeval/` (override with `--state-dir`):

- `ledger.jsonl`: append-only spend ledger (paid mode only)
- `cas/`: content-addressed verdict cache
- `state.json`: `last_ok_sha`, the base for changed-path selection
- `alert-state.json`, `alerts.jsonl`: alert transitions
- `paid.json`: paid configuration (paid mode only)
- `STOP`: kill sentinel
- `runs/<run_id>/`: `run.json`, `report.md`, `mission_control.txt`, `alerts.jsonl`, `judge/`, and
  `verdicts.jsonl` (one row per judged case: model, prompt hash, transcript and runner commit,
  tokens, cost, request id, cache file, and the path of the judge's evidence file)
- `seed/`: output of `seed`

## Operate

```bash
# dry (default): no paid call, no key fetched; cache misses are recorded as paid_required
python3.12 evals/scripts/autoeval.py run --skip-lanes
tools/crew/autoeval/run.sh --skip-lanes          # the wrapper; needs the autoeval files on origin/main

# seed the cache from recorded Stage 1 verdicts (free, offline)
python3.12 evals/scripts/autoeval.py seed --recorded <set>/scores --inputs <set> --model claude-sonnet-4-6

# paid (only after paid.json exists; see below)
python3.12 evals/scripts/autoeval.py run --paid --sets <set-dir> --models claude-sonnet-4-6
```

`--full` selects every lane. Without it, lanes are selected from `git diff <last_ok_sha>..HEAD`.
With no state file the run is full. `state.json` moves forward only when every selected lane passed.

## paid.json

Required for `--paid`. Refused without it.

```json
{
  "total_cap_usd": 25.0,
  "daily_cap_usd": 10.0,
  "spent_before_usd": 0.0,
  "paid_not_after": "2026-11-17T19:00:00+00:00",
  "expect_org": "<billing org id, confirmed in the Console>",
  "key_secret": "ANTHROPIC_API_KEY_EVAL_PROMO"
}
```

Optional `prices` overrides the pinned list prices. A model absent from the table is refused.
The key is fetched from Doppler `factorylm/dev` at the first real paid call only and is never printed.

## Inspect

```bash
python3.12 evals/scripts/autoeval.py status
cat ~/.factorylm/autoeval/runs/<run_id>/report.md
cat ~/.factorylm/autoeval/runs/<run_id>/mission_control.txt
tail ~/.factorylm/autoeval/alerts.jsonl
```

Exit codes: `0` clean; `1` a lane failed or infra-errored; `3` a runner stop (budget, kill
switch, org mismatch, Anthropic error).

## Kill switch

```bash
touch ~/.factorylm/autoeval/STOP     # every paid reserve is refused before any request
rm ~/.factorylm/autoeval/STOP        # re-enable
launchctl unload ~/Library/LaunchAgents/com.factorylm.autoeval.plist   # stop the schedule
```

## Recover

- **Run died mid-way.** Spend is never refunded: a reservation with no settle counts as spent.
  Re-running resumes from the cache, so no case is paid twice. Read `spend.today_usd` in `run.json`.
- **Lock left behind** (`run.lock` exists and no run is alive): `rmdir ~/.factorylm/autoeval/run.lock`.
- **Ledger unreadable** (`STOP: ledger unreadable`): spend is uncertain. Do not delete it. Find the
  bad line, fix it by hand after a copy, and confirm the totals with `status` before any paid run.
- **Checkout wedged:** `run.sh` reuses one fixed checkout at `~/.factorylm/autoeval/checkout` and
  force-resets its tracked files to `origin/main` each run. To rebuild it:
  `git worktree remove --force ~/.factorylm/autoeval/checkout`, then re-run.
- **A verdict is wrong:** each row of `runs/<run_id>/verdicts.jsonl` names its `cache_file`. Move
  that one file aside and re-run with `--paid`: only that case is re-judged, and that is a real
  spend. A `dry` run first shows the worst-case cost under "Worst-case reserved" in `report.md`.
- **Stored unparseable or truncated verdicts** recall as unscored. They are not re-billed, and they
  stay unscored until their `cache_file` is moved aside as above.

## Known limits

- The billing org is only visible in a response header. The first paid call of a fresh ledger cannot
  be org-checked before the request. It is checked immediately after the response and the call is
  still booked. `expect_org` empty, or a foreign org already in the ledger, refuses before any request.
- The judge rubric has no version id. Only the rendered prompt keys the cache. Bump `VERSION` in
  `autoeval_judge.py` to force a full re-judge.
- Hub lanes need `mira-hub/node_modules`. Without it they are `infra_error` (`npx --no-install`
  never fetches). `run.sh` runs `bun install --frozen-lockfile` in its checkout before each run;
  a direct `autoeval.py run` from another checkout needs that install done by hand.
- The launchd job's `PATH` names this machine's `npx`, `bun` and `python3.12` locations. On another
  machine, edit the plist.
- A dry cache miss raises a `paid_required` alert once per set and model. It is a pending approval,
  not a failure. A budget, kill-switch or billing stop raises `hard_stop`, once per stop reason.
- Alert kinds: `safety_regression`, `execution_failure`, `budget_threshold` (50/80/100% of the daily
  or total cap), `hard_stop`, `paid_required`. Each fires when it becomes active, not while it stays
  active. They are written to `alerts.jsonl`; Telegram delivery needs `--send-alerts`.
- A change to the runner's own files selects the `runner` lane (its own test suite) plus `safety`.
