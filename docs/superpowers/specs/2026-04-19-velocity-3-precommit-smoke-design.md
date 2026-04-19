---
date: 2026-04-19
topic: velocity-3-precommit-smoke
status: active
owner: Mike
tags: [velocity, dx, pre-commit, eval]
linked: ../plans/2026-04-19-velocity-roadmap.md
depends-on: velocity-2-impact-graph-ci (no hard dependency; #2 just makes CI fast enough that pre-commit + CI together stop being painful)
---

# Velocity #3 — Pre-Commit + On-Save Smoke Eval (Minimal Scope)

## Problem Frame

CI catches regressions ~6–12 minutes after `git push`. By then the engineer has switched context, the prompt-tweak intent is gone, and the failure shows up in a notification. Cost of one prompt-tweak iteration today: **edit → push → wait 8 min → read failure → diagnose → repeat**.

Local development infrastructure verified 2026-04-19:

- **Pre-commit:** No `.pre-commit-config.yaml`. Only `.claude/settings.local.json` shells out `gitleaks protect` on commit. Ruff, pyright, and bandit are CI-only.
- **Eval harness:** `tests/eval/offline_run.py` already exists, supports `EVAL_DISABLE_JUDGE=1` (binary checkpoints from `grader.py` only — no LLM calls). 51 YAML scenario fixtures in `tests/eval/fixtures/`.
- **Watcher tooling:** Only `mira-crawler/watcher/folder_watcher.py` (manual ingest). No code/prompt watcher exists.
- **Prompt-tweak loop today:** edit `mira-bots/shared/prompts/*.md` → manually trigger Open WebUI → eyeball reply → repeat. Result is lost on `/clear`.

This is the "shift the cheap, fast checks left so the engineer never pushes a known-broken state" PR.

## Requirements

**Pre-commit hook**

- R1. Add `.pre-commit-config.yaml` at repo root using the [pre-commit](https://pre-commit.com) framework, with hooks:
  - `ruff check --fix` (lint, auto-fix safe issues)
  - `ruff format` (format)
  - `pyright` (types — same version pin as CI)
  - `bandit -r mira-*/` (security — same config as CI)
  - `gitleaks protect --staged` (preserves the existing shell-hook behavior; replaces `.claude/settings.local.json` invocation)
  - `tools/precommit_smoke.py` (the 18-case smoke eval — defined in R3)
- R2. `tools/setup_precommit.sh` installs the framework and registers the hook (`pre-commit install`). Idempotent — re-running is safe.
- R3. The smoke hook runs **18 fixtures**: 15 representative scenarios (one per regime category) + 3 Q-trap-specific scenarios. Selection list lives in `tests/eval/smoke_set.txt` (one fixture filename per line) so it can be tuned without code changes.
- R4. The smoke hook runs with `EVAL_DISABLE_JUDGE=1` (binary checkpoints only — no Groq/Claude API calls). Hook exits non-zero on any binary-checkpoint failure.
- R5. Smoke hook completes in **<2 minutes** wall-clock on a developer laptop (M-series Mac, Windows i7, or equivalent). If it creeps past 2 min, the smoke set must shrink, not the budget.
- R6. The pre-commit hook honors `--no-verify` (standard pre-commit behavior — no special handling required) so emergency commits stay possible.

**On-save watcher**

- R7. `tools/eval_watch.py` watches `mira-bots/shared/`, `mira-pipeline/`, and `tests/eval/fixtures/` for file changes. On any `*.py`, `*.md`, or `*.yaml` save it runs a **10-case subset** of the smoke set (defined in `tests/eval/watch_set.txt`).
- R8. Watcher runs in **<30 seconds** wall-clock per save event. Same offline-judge-only path as the pre-commit hook.
- R9. Watcher prints a one-line pass/fail per fixture plus an aggregated `N/M passed` summary. No truncation, no spinners, no color-codes that break in non-TTY shells.
- R10. Watcher is invoked manually (`python tools/eval_watch.py`) — not auto-started by any settings hook. Engineers opt in.

**SAST parity**

- R11. The pre-commit `bandit` and `gitleaks` invocations use the same configs and severity thresholds as CI (`.bandit.yml` if present, otherwise the same CLI flags as `ci.yml`). No drift between local pre-commit and CI SAST.

## Success Criteria

- A pre-commit ran on a typical staged change completes in **<2 minutes** end-to-end (all 6 hooks).
- Pre-commit hook **catches at least the 4 Q-trap-style regressions** that PR #411 fixed — specifically, an engineer reverting `_MAX_Q_ROUNDS = "3"` to `"2"` would be blocked at commit time.
- Watcher loop completes in **<30 seconds** per save and never blocks the engineer's editor save itself (asynchronous run).
- `pre-commit install` works on Windows (Mike's daily driver), macOS Mac mini (Bravo, Charlie), and Ubuntu (Linux laptop / CI parity check).
- **Adoption proxy:** at least one prompt-tweak iteration in the next 2 weeks visibly demonstrates the watcher catching a regression before commit (recorded as a project memory).

## Scope Boundaries

- **Out of scope:** running the LLM-as-judge in pre-commit. Judge calls take 5–30 s per scenario × 18 scenarios = 1.5–9 min. Way over the <2 min budget. Judge stays in nightly CI eval as today.
- **Out of scope:** running the full 51-scenario suite in pre-commit. That's CI's job.
- **Out of scope:** changing CI to run pre-commit hooks server-side (`pre-commit/action@v3`). Considered, deferred — pre-commit-as-CI is a follow-up PR after the local hook proves stable.
- **Out of scope:** the prompt-registry refactor (velocity ideation idea #5) — separate PR.
- **Out of scope:** auto-minting eval cases from `fix:` PRs (velocity idea #4) — separate PR.
- **Out of scope:** parallelizing the smoke hook with `pytest-xdist`. The smoke set is small enough that 18 serial runs already fit in <2 min on the existing offline harness.
- **Out of scope:** generating the smoke and watch sets dynamically from regime tags. Static `tests/eval/smoke_set.txt` and `tests/eval/watch_set.txt` files — easier to read, easier to tune.

## Key Decisions

- **Use the `pre-commit` Python package, not husky or raw shell.** Reasons: (a) it's the de-facto standard for Python repos, (b) hook-version pinning is built in (no manual `npm install` dance), (c) it works identically on Windows / macOS / Linux (Mike's daily driver is Windows), (d) the existing gitleaks shell hook can be migrated cleanly into the same config so we don't have two parallel hook systems.
- **Smoke set is 18 fixtures, not the full 51.** The 80/20 rationale from the velocity ideation: 15 representative scenarios catch the dominant regression classes (FSM transitions, KB recall, safety, vendor variation) and 3 Q-trap scenarios protect against the exact regression class that landed PR #411. Adding more cases blows the 2-min budget without proportional coverage.
- **Watcher is opt-in, not auto-started.** Auto-starting watchers (in a settings hook or shell rc) silently consumes CPU on idle laptops and can wedge if a fixture is broken. Engineers run `python tools/eval_watch.py` in a side terminal when they're actively prompt-tweaking. Cheap to start, cheap to stop.
- **Same configs in pre-commit and CI.** Tools must read the same source-of-truth config (`.bandit.yml`, `pyproject.toml`'s `[tool.ruff]`, the existing `.gitleaks.toml` if present). Forking config = guaranteed drift = engineer surprise on push when CI flags a thing pre-commit said was fine.
- **No judge in pre-commit, ever.** Judge calls add Groq/Claude API key requirements (Doppler), network round-trips, and rate-limit risk to a hot path that runs every commit. The binary checkpoints in `grader.py` are deterministic, fast, and cover the regression classes that matter for shift-left.
- **Smoke set lives in `tests/eval/smoke_set.txt` (newline-delimited fixture filenames), not embedded in code.** Tuning the set is a 1-line PR, not a code change. Watcher set lives in `tests/eval/watch_set.txt` for the same reason.

## Dependencies / Assumptions

- `pre-commit` Python package (Apache 2.0 — license-allowed) installs cleanly via `pip install pre-commit` on all three OSes Mike uses.
- `tests/eval/offline_run.py` exposes a programmatic entry point (or accepts a fixture-list flag) so `tools/precommit_smoke.py` can invoke it without subprocess wrapping. **Verify in implementation:** if no entry point exists, add one (`offline_run.run_smoke(fixture_list, disable_judge=True) -> SmokeResult`).
- `EVAL_DISABLE_JUDGE=1` path through `offline_run.py` is reliable — no NeonDB or Groq calls when set. **Verify by reading the code in implementation.**
- The `watchdog` Python package (MIT — license-allowed) is the canonical cross-platform file watcher. `tests/eval/eval_watchdog.py` is **unrelated** (it's a Celery monitoring task — naming collision noted but no code reuse intended).
- pyright respects `pyproject.toml`'s `[tool.pyright]` config if present; otherwise uses defaults — same as CI.
- Smoke runs do NOT touch NeonDB, prod, or any external service. All inputs are local YAML; all outputs are local stdout/exit codes.

## Outstanding Questions

### Resolve Before Planning

*None.* Scope is set; product decisions are made.

### Deferred to Planning

- [Affects R3, R7][Technical] Which 15 representative + 3 Q-trap fixtures land in `smoke_set.txt`? Pick by reading fixture YAML for diagnostic regime breadth; document the selection rationale in the PR description.
- [Affects R5, R8][Technical] Does the existing `offline_run.py` entry point support a fixture-subset flag? If not, plan adds the smallest possible API: `offline_run.run_subset(filenames: list[str], disable_judge: bool = True)`.
- [Affects R7][Technical] Does the watcher need to debounce save events? VS Code can fire 2–3 saves in a row on auto-save; without debouncing, the watcher kicks off duplicate runs. Plan picks a 500 ms debounce window unless something breaks it.
- [Affects R1][Technical] Does pyright have a meaningful config in this repo, or do we need to seed `[tool.pyright]` to match CI's invocation? Verify in implementation.
- [Affects R11][Needs research] Is `.bandit.yml` present today, or does CI invoke bandit with explicit CLI flags? If the latter, the pre-commit hook config must mirror those flags inline.

## Next Steps

`→ /ce-plan` for structured implementation planning.
