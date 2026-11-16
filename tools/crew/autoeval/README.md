# autoeval: unattended MIRA judge runner

Runs MIRA's existing deterministic test lanes for the changed paths, then judges the recorded
release-gate answers with the repo's own judge (`evals/scripts/judge_baseline.py`, unmodified)
through a metered, budgeted, cached seam. Dry by default. Nothing is written inside a checkout.

## Files

| Path | Role |
|---|---|
| `evals/scripts/autoeval.py` | CLI: `run`, `status`, `import`, `fixture`, `draft`, `verify` |
| `evals/scripts/autoeval_run.py` | CLI helpers: keys, budget config, lanes, spend, alert delivery |
| `evals/scripts/autoeval_budget.py` | Spend ledger and the one metered Claude call |
| `evals/scripts/autoeval_judge.py` | Verdict cache keyed on the rendered prompt; judge runner |
| `evals/scripts/autoeval_select.py` | Changed-path lane selection; count parsing |
| `evals/scripts/autoeval_report.py` | Report, transition alerts, Mission Control block |
| `evals/scripts/autoeval_import.py` | `import`: validates generated answer records into a transcript set (no network) |
| `evals/scripts/autoeval_fixture_judge.py` | `fixture`: second judge lane, `tests/eval/judge.py` rubric, through `judge_call` |
| `evals/scripts/autoeval_draft.py` | `draft`: metered drafting of candidate cases from source passages |
| `evals/scripts/autoeval_verify_cases.py` | `verify`: deterministic verbatim-quote check of candidates (no model) |
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

## Generated-answer lane (import, fixture, draft, verify)

Added for the credit plan. None of these commands is wired into `run`, and none of them touches the
release-gate transcript sets. `import` and `verify` are pure: no network, no key, no ledger.

```bash
# 1. validate generated records into a transcript set (refuses duplicates, errors, unknown routes)
python3.12 evals/scripts/autoeval.py import --records <dir-of-json> --set <name> \
  --sha <commit-sha> --base-url <https-url> --results-root <dir>

# 2. judge the imported set with the second rubric (tests/eval/judge.py). Dry unless --paid.
python3.12 evals/scripts/autoeval.py fixture --set-dir <results-root>/<name> [--model M] [--paid]

# 3. draft candidate cases from passages (metered; dry unless --paid). Refuses any passage
#    not marked "is_private": false, before any cache lookup or key fetch.
python3.12 evals/scripts/autoeval.py draft --prompt <file> --passages <file.json> \
  --category <c> --out <candidates.jsonl> [--paid]

# 4. verify each candidate's source_quote verbatim in its own doc and page (no model)
python3.12 evals/scripts/autoeval.py verify --candidates <candidates.jsonl> \
  --passages <file.json> --out-dir <dir>      # writes accepted.jsonl and rejected.jsonl
```

- Generated record: the recorded-transcript shape (`case_id`, `case_type` = `technician`, `case`,
  `turns` with `turn`, `question`, `answer`, `citations`, `status`, and a null `error`). An optional
  `retrieved_passages` list (`doc_id`, `page`, `text`) is passed to the fixture judge as the real
  `rag_context`. Without it the rubric's no-coverage placeholder is used.
- Passages file: a JSON array of `{doc_id, page, text, is_private}`.
- Drafting and the fixture lane use the same dry rule as `run`: a cache miss is `paid_required`, no
  request is made and no key is fetched. Paid drafts are cached under their own CAS stage
  (`autoeval-draft`), and paid verdicts under the verdict stage, both with the content-addressed key.
- Verification normalises whitespace only. An empty quote is rejected explicitly.
- Paid calls book to the same `ledger.jsonl` and obey the same caps. Lane labels are `draft:<category>`
  for drafting and `autoeval:<set>` for the fixture judge.

## Operate

```bash
# dry (default): no paid call, no key fetched; cache misses are recorded as paid_required
python3.12 evals/scripts/autoeval.py run --skip-lanes
tools/crew/autoeval/run.sh --skip-lanes          # the wrapper; needs the autoeval files on origin/main

# There is no seed command. Recorded judge_baseline scores carry no prompt, model or
# parameters, so they cannot be bound to a cache key; the removed `seed` filed them under
# a Claude model's key anyway. Cache entries it wrote (origin "seeded") are never recalled.

# paid (only after paid.json exists; see below)
python3.12 evals/scripts/autoeval.py run --paid --sets <set-dir> --models claude-sonnet-4-6
```

`--full` selects every lane. Without it, lanes are selected from `git diff <last_ok_sha>..HEAD`:
`safety` always runs; a lane runs when a changed path matches its triggers or its own test files;
a changed path that matches no lane selects every lane. Only prose and screenshots count as
docs-only (`.md` and images under `docs/`, `wiki/`, `.claude/`, plus READMEs and root-level `.md`).
Rubrics, prompts and simulated manuals are `.md` files elsewhere, so they are treated as code.
With no state file the run is full. `state.json` moves forward only when every selected lane passed.

## paid.json

Required for `--paid`. Refused without it.

```json
{
  "total_cap_usd": 25.0,
  "daily_cap_usd": 10.0,
  "spent_before_usd": 0.0,
  "paid_not_after": "2026-11-17T19:00:00-05:00",
  "expect_org": "<billing org id, confirmed in the Console>",
  "key_secret": "ANTHROPIC_API_KEY_EVAL_PROMO"
}
```

`paid_not_after` carries its own UTC offset (the sample is 19:00 EST). The ledger of a new state
dir starts at zero: put any earlier spend that the total cap should also cover in `spent_before_usd`.
Optional `prices` overrides the pinned list prices. A model absent from the table is refused.
The key is fetched from Doppler `factorylm/dev` at the first real paid call only and is never printed.

## Inspect

```bash
python3.12 evals/scripts/autoeval.py status
cat ~/.factorylm/autoeval/runs/<run_id>/report.md
cat ~/.factorylm/autoeval/runs/<run_id>/mission_control.txt
tail ~/.factorylm/autoeval/alerts.jsonl
```

Exit codes: `0` nothing blocks; `1` a lane failed or infra-errored, or the run evaluated nothing
usable (no set, no model, no score summary, infrastructure-failed answers); `3` a runner stop
(budget, kill switch, org mismatch, Anthropic error); `6` the judge found a release blocker (an
actively dangerous answer, technician gate FAIL). The relay's State and "Blocked by" come from the
same blocker list, so State is GREEN exactly when the exit code is 0 and nothing is pending.

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
