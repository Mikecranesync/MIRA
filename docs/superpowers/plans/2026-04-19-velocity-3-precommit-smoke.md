---
title: "feat: Velocity #3 — Pre-Commit + On-Save Smoke Eval (minimal scope)"
type: feat
status: active
date: 2026-04-19
origin: ../specs/2026-04-19-velocity-3-precommit-smoke-design.md
roadmap: 2026-04-19-velocity-roadmap.md
tags: [velocity, dx, pre-commit, eval]
---

# Velocity #3 — Pre-Commit + On-Save Smoke Eval (minimal scope)

## Overview

This PR delivers velocity survivor #3 from the 2026-04-19 dev-velocity roadmap:

1. Add `.pre-commit-config.yaml` running ruff + pyright + bandit + gitleaks + an 18-case smoke eval (binary checkpoints only) on every commit.
2. Add `tools/eval_watch.py` — opt-in file watcher that runs a 10-case smoke subset on every save in `mira-bots/shared/`, `mira-pipeline/`, and `tests/eval/fixtures/`.
3. Migrate the existing `gitleaks protect` shell hook from `.claude/settings.local.json` into the same pre-commit config so there's one source of truth.

No judge in pre-commit, no full 51-case run, no auto-started watcher, no CI changes — all deferred per the spec's scope boundaries.

## Problem Frame

Verified in the repo on 2026-04-19:

- No `.pre-commit-config.yaml` exists. Pre-commit checks today: gitleaks-only via shell hook in `.claude/settings.local.json`.
- CI catches regressions 6–12 minutes after `git push`. Engineer has switched context by then; failure surfaces as a notification, not as immediate feedback.
- Prompt-tweak loop today: edit `mira-bots/shared/prompts/*.md` → manually trigger Open WebUI → eyeball reply → repeat. State lost on `/clear`.
- `tests/eval/offline_run.py` already supports `EVAL_DISABLE_JUDGE=1` (binary checkpoints only — no LLM calls). 51 YAML scenarios in `tests/eval/fixtures/`, scored by `tests/eval/grader.py` (pure rule-based).

This is a "shift cheap fast checks left" PR. Lift CI's burden, give the engineer the same answer in seconds, not minutes. See origin: `docs/superpowers/specs/2026-04-19-velocity-3-precommit-smoke-design.md`.

## Requirements Trace

Every requirement below maps to an implementation unit.

- **R1** (.pre-commit-config.yaml with 6 hooks) → Unit 1
- **R2** (`tools/setup_precommit.sh` installer) → Unit 1
- **R3** (`tests/eval/smoke_set.txt` with 18 fixtures) → Unit 2
- **R4** (`EVAL_DISABLE_JUDGE=1` smoke path) → Unit 2
- **R5** (<2 min smoke budget) → Unit 2 verification
- **R6** (`--no-verify` honored — pre-commit default) → Unit 1 verification
- **R7** (`tools/eval_watch.py` watching 3 dirs) → Unit 3
- **R8** (<30 s watcher loop) → Unit 3 verification
- **R9** (one-line per fixture, no spinners) → Unit 3
- **R10** (manual invocation only) → Unit 3 (documented in `tools/eval_watch.py --help`)
- **R11** (SAST config parity with CI) → Unit 1 (uses `.bandit.yml`, `.gitleaks.toml`)

## Scope Boundaries

- **Not in this PR:** running the LLM-as-judge in pre-commit. Stays in nightly CI eval.
- **Not in this PR:** running the full 51-scenario suite locally — that's CI's job.
- **Not in this PR:** running pre-commit hooks server-side via `pre-commit/action@v3`. Follow-up after the local hook proves stable.
- **Not in this PR:** prompt-registry refactor (velocity ideation #5).
- **Not in this PR:** auto-minting eval cases from `fix:` PRs (velocity #4).
- **Not in this PR:** parallelizing the smoke run with `pytest-xdist`. 18 scenarios fit in <2 min serial.
- **Not in this PR:** dynamic regime-tag-driven smoke set selection. Static `.txt` files are simpler.

### Deferred to Separate Tasks

- **Pre-commit-as-CI** — once local hook is stable, add `pre-commit run --all-files` to a CI job for parity enforcement.
- **Smoke-set tuning loop** — track which fixtures fire most often; trim or replace via 1-line PRs.
- **Auto-start watcher** — only revisit if engineers want it; opt-in is the safer default.

## Context & Research

### Relevant Code and Patterns

- `tests/eval/offline_run.py` — programmatic + CLI entry to the offline harness. Already supports `EVAL_DISABLE_JUDGE=1`.
- `tests/eval/grader.py` — 5 binary checkpoints (no LLM calls). The smoke hook only consults these.
- `tests/eval/judge.py` — LLM-as-judge. **Not invoked by smoke hook.**
- `tests/eval/fixtures/` — 51 YAML scenarios + 11 non-YAML files = 62 entries. Naming convention `NN_*.yaml` for sequential scenarios, `vfd_*.yaml` for VFD-specific.
- `.bandit.yml` — bandit config used by CI (`bandit -r ... -c .bandit.yml --severity-level high`).
- `.gitleaks.toml` — gitleaks config (CI uses `gitleaks-action@v2` which auto-loads it).
- `pyproject.toml` — `[tool.ruff]`, `[tool.ruff.lint]`, `[tool.coverage.*]`. `[tool.pyright]` may or may not be present — verify in Unit 1.
- `.claude/settings.local.json` — current home of the gitleaks shell hook. Migrate cleanly.

### Institutional Learnings

- Feedback memory `feedback_verify_before_done.md` — verify the actual hook output on a synthetic bad commit, not just absence of failure.
- Feedback memory `feedback_no_throwaway_scripts.md` — no parallel one-off smoke scripts. Extend `offline_run.py`.
- Project memory `project_pipeline_regression_2026_04_17.md` — pre-commit smoke must catch the JSON envelope leak class (now fixed) on regression. Include fixture #07 (full diagnosis happy path) in smoke set as the primary canary.

### External References

- pre-commit framework docs: `https://pre-commit.com/`
- watchdog Python library docs: `https://python-watchdog.readthedocs.io/`
- `bandit -c <file>` flag documented in `https://bandit.readthedocs.io/en/latest/config.html`.

## Key Technical Decisions

- **`pre-commit` Python package over husky/raw shell.** De-facto Python standard, hook-version pinning, cross-platform parity. Migrates the existing gitleaks shell hook into the same config — one source of truth.
- **18 fixtures in smoke set: 15 representative + 3 Q-trap.** Selection rationale per regime category (FSM transitions, KB recall, safety, vendor variation, partial KB) + the 3 Q-trap-style scenarios that protect against the regression class PR #411 fixed.
- **Watcher is opt-in (manual `python tools/eval_watch.py`), not auto-started.** Safer; idle CPU stays idle; broken fixture doesn't wedge the engineer's session.
- **Smoke set lives in `tests/eval/smoke_set.txt`, watch set in `tests/eval/watch_set.txt`.** Newline-delimited fixture filenames. Tuning is a 1-line PR, not a code change.
- **Same configs as CI for bandit + gitleaks.** `.bandit.yml` + `.gitleaks.toml` are the source of truth. No inline overrides in `.pre-commit-config.yaml`.
- **No judge in pre-commit, ever.** Judge requires API keys (Doppler), network round-trips, and rate-limit risk on a hot path. Binary checkpoints (`grader.py`) are deterministic and fast.
- **Smoke runs use `EVAL_DISABLE_JUDGE=1` env var.** Already supported by `offline_run.py`. No new flag needed.
- **Programmatic API addition if missing.** If `offline_run.py` lacks a fixture-list entry point, Unit 2 adds the smallest possible: `def run_subset(fixture_filenames: list[str], disable_judge: bool = True) -> SmokeResult`. No subprocess wrapping.
- **Watchdog 500 ms debounce.** Avoids duplicate runs on VS Code auto-save salvos.

## Open Questions

### Resolved During Planning

- **Q:** `.bandit.yml` present today?
  **A:** Yes — verified at repo root. Use `-c .bandit.yml --severity-level high` to mirror CI.
- **Q:** `.gitleaks.toml` present today?
  **A:** Yes — verified at repo root. CI uses `gitleaks-action@v2` which honors it. Pre-commit uses local `gitleaks protect --staged --config=.gitleaks.toml`.
- **Q:** Is `pre-commit` Apache or MIT?
  **A:** MIT. License-allowed.
- **Q:** Is `watchdog` Apache or MIT?
  **A:** Apache 2.0. License-allowed.

### Deferred to Implementation

- Whether `offline_run.py` exposes a programmatic fixture-subset entry point. **Verification step in Unit 2:** read the file in the implementing session; if absent, add `run_subset(filenames, disable_judge)`. Don't subprocess-wrap.
- Whether `[tool.pyright]` exists in `pyproject.toml`. **Verification step in Unit 1:** if absent, seed it with the same options CI's `pyright` invocation uses (default if no flags).
- Whether VS Code's auto-save fires multiple events per logical save under our debounce window. **Verification step in Unit 3:** test with VS Code's auto-save enabled; if 500 ms is too short, raise to 1000 ms.

## Implementation Units

- [ ] **Unit 1: Add `.pre-commit-config.yaml` with 6 hooks + `tools/setup_precommit.sh`**

**Goal:** Engineer runs `bash tools/setup_precommit.sh` once, then every `git commit` runs ruff + pyright + bandit + gitleaks + smoke eval automatically.

**Requirements:** R1, R2, R6, R11

**Dependencies:** None (Unit 2 fills in the smoke hook target; Unit 1 wires up the config skeleton with a placeholder pointing at `tools/precommit_smoke.py`).

**Files:**
- Add: `.pre-commit-config.yaml`
- Add: `tools/setup_precommit.sh`
- Modify: `.claude/settings.local.json` — remove the now-redundant gitleaks shell hook (or replace its body with a comment explaining the migration to pre-commit). Decision: **remove**, document in commit message.
- Modify: `pyproject.toml` — add `[tool.pyright]` block only if absent; minimal config matching CI's invocation.

**Approach:**
- Create `.pre-commit-config.yaml` with these `repos:` entries:
  - `astral-sh/ruff-pre-commit` — pinned to `v0.9.10` (CI's pinned version) — hooks `ruff` and `ruff-format`.
  - `RobertCraigie/pyright-python` — pinned to a tag matching CI's pyright version.
  - `PyCQA/bandit` — pinned to `1.8.*` (CI's pinned version) — hook `bandit` with args `-r mira-bots/shared/ mira-bots/telegram/ mira-bots/slack/ mira-core/mira-ingest/ mira-mcp/ -c .bandit.yml --severity-level high`.
  - `gitleaks/gitleaks` — pinned to a recent tag — hook `gitleaks` with args `protect --staged --config=.gitleaks.toml`.
  - `local` repo with hook `precommit-smoke` invoking `python tools/precommit_smoke.py`. Stage: `commit`. Pass-files: false (smoke run doesn't need staged file paths).
- Create `tools/setup_precommit.sh`:
  - Detect Python (`python3` first, fall back to `python`).
  - `pip install pre-commit watchdog` (or `uv pip install` if `uv` is present).
  - `pre-commit install --install-hooks`.
  - Print one-line success and the hook list.
- Update `.claude/settings.local.json`: remove the gitleaks shell hook. Single hook system from now on.
- If `pyproject.toml` lacks `[tool.pyright]`, add a minimal block (likely just `pythonVersion = "3.12"` to match CI).

**Patterns to follow:**
- The existing CI invocations in `.github/workflows/ci.yml:42-88` are the source of truth for tool versions and flags. Mirror them exactly in `.pre-commit-config.yaml`.
- Conventional pre-commit YAML structure — see [pre-commit.com/sample-config](https://pre-commit.com/#installation).

**Test scenarios:**
- **Happy path:** `bash tools/setup_precommit.sh` then `git commit -m "test"` on a small stylistic-fix commit → all hooks pass.
- **Happy path:** `--no-verify` bypasses all hooks (R6 — built-in pre-commit behavior).
- **Edge case:** committing a file with a leaked-key pattern → `gitleaks` hook fails the commit; staged content not committed.
- **Edge case:** committing Python with a `subprocess.call(shell=True, ...)` → `bandit` hook fails the commit.
- **Edge case:** committing Python with unused imports → `ruff check --fix` auto-fixes and re-stages, commit proceeds (or fails clearly if auto-fix isn't safe).
- **Error path:** running `git commit` before `setup_precommit.sh` → no hook present, commit succeeds (R6 backward-compat).
- **Integration:** the migrated gitleaks hook fires on the same staged content as the old shell hook did. Verify by re-running the same commit that the old hook caught.

**Verification:**
- `pre-commit run --all-files` from a clean checkout produces the same pass/fail outcome as a clean CI run on the same SHA.
- `bash tools/setup_precommit.sh` is idempotent — running twice doesn't error or duplicate hooks.
- `git commit --no-verify` always succeeds regardless of staged content (R6).
- `.claude/settings.local.json` no longer contains the gitleaks shell-hook entry; commit message documents the migration.
- Hook execution is parallelized by `pre-commit` natively — no need to add explicit parallelism flags.

---

- [ ] **Unit 2: Add `tools/precommit_smoke.py` + `tests/eval/smoke_set.txt` + entry point on `offline_run.py` if missing**

**Goal:** A single Python script that loads 18 fixtures, runs them through the offline harness with judge disabled, scores via `grader.py` binary checkpoints, and exits 0 (all pass) or 1 (any fail). Total wall time <2 min.

**Requirements:** R3, R4, R5

**Dependencies:** Unit 1 (the pre-commit config references this script).

**Files:**
- Add: `tools/precommit_smoke.py`
- Add: `tests/eval/smoke_set.txt` (18 lines, one fixture filename per line)
- Modify (only if missing): `tests/eval/offline_run.py` — add `run_subset(filenames: list[str], disable_judge: bool = True) -> SmokeResult` programmatic entry.

**Approach:**
- Read fixture filenames from `tests/eval/smoke_set.txt` (relative to `tests/eval/fixtures/`).
- Set `os.environ["EVAL_DISABLE_JUDGE"] = "1"` before importing the harness.
- Call `offline_run.run_subset(filenames, disable_judge=True)`. If that entry point doesn't exist, add it as the smallest possible wrapper around the existing CLI logic — extract the fixture-loop body into a function the CLI also calls (no duplication).
- Print a one-line pass/fail per fixture and an aggregated `N/M passed` summary.
- Exit 0 only if every fixture passed every binary checkpoint.
- Time the run; print total wall time. If >120 s, print a warning suggesting smoke-set trimming.
- **Smoke set composition** (18 fixtures, picked by reading fixture YAML descriptions; final list goes in the PR description):
  - 15 representative across regime categories (FSM transitions, KB recall, safety, vendor variation, abbreviations, asset-change, partial KB, vague openers, full happy path).
  - 3 Q-trap-style: scenarios that exercise IDLE→Q1→Q2→Q3→DIAGNOSIS so a `_MAX_Q_ROUNDS` regression like #411 fails fast.

**Patterns to follow:**
- `tests/eval/offline_run.py`'s existing CLI argument parsing (mirror flag names and behavior).
- `tests/eval/grader.py` checkpoint signatures — call them directly, don't re-implement.
- No throwaway scripts (per `feedback_no_throwaway_scripts.md`) — `tools/precommit_smoke.py` is a thin caller of `offline_run.run_subset`.

**Test scenarios:**
- **Happy path:** all 18 fixtures pass → exit 0; one-line per fixture; final `18/18 passed in <T>s`.
- **Edge case:** one fixture fails a binary checkpoint → exit 1; the failing fixture line shows the failed checkpoint name; final `17/18 passed`.
- **Edge case:** `EVAL_DISABLE_JUDGE` already set in env → script honors existing value (no clobber on `1`; if `0`, override to `1` and warn).
- **Edge case:** fixture file in `smoke_set.txt` doesn't exist on disk → script exits 2 with a clear "fixture not found: <name>" message (treat as configuration error, distinct from a checkpoint failure).
- **Performance:** wall time <120 s on a 4-CPU laptop. If it creeps past, the warning fires and a follow-up PR trims the smoke set.
- **Integration:** the same `tools/precommit_smoke.py` invocation works on Windows (Mike's daily driver), macOS, and Linux.

**Verification:**
- `python tools/precommit_smoke.py` on a clean main checkout completes in <2 min and exits 0.
- Time-the-run output is reproducible within ±20% across 3 consecutive runs.
- Forcing a fixture to fail (e.g., temporarily editing fixture #07 expected output) yields the right exit code and clear failure line.
- Forcing `_MAX_Q_ROUNDS = "2"` (the PR #411 regression) causes at least one of the 3 Q-trap scenarios in the smoke set to fail — proves shift-left coverage.
- `offline_run.run_subset` (if newly added) has no behavioral side effects on existing `--suite full / text / photos` invocations.

---

- [ ] **Unit 3: Add `tools/eval_watch.py` (file watcher with debounced 10-case smoke loop)**

**Goal:** Engineer runs `python tools/eval_watch.py` in a side terminal during prompt-tweak sessions. On every save in `mira-bots/shared/`, `mira-pipeline/`, or `tests/eval/fixtures/`, it runs a 10-case smoke subset and prints results in <30 s.

**Requirements:** R7, R8, R9, R10

**Dependencies:** Unit 2 (`offline_run.run_subset` entry point and `tests/eval/smoke_set.txt` pattern).

**Files:**
- Add: `tools/eval_watch.py`
- Add: `tests/eval/watch_set.txt` (10 lines, subset of `smoke_set.txt`)

**Approach:**
- Use `watchdog.observers.Observer` to watch three dirs recursively: `mira-bots/shared/`, `mira-pipeline/`, `tests/eval/fixtures/`.
- File-extension filter: `.py`, `.md`, `.yaml` only. Ignore `__pycache__`, `.pytest_cache`, `*.pyc`.
- Debounce save events with a 500 ms window — collapse a burst of saves into one run.
- On a debounced save event:
  - Read `tests/eval/watch_set.txt`.
  - Call `offline_run.run_subset(filenames, disable_judge=True)`.
  - Print one line per fixture (`PASS  04_yaskawa_out_of_kb` / `FAIL  07_full_diagnosis_happy_path: groundedness checkpoint`).
  - Print final `N/M passed in T.Ts`.
- Header on startup: print which dirs are watched, the debounce window, and the smoke-set path. Print `python tools/eval_watch.py --help` to bypass.
- `--help` output: usage, one-shot vs watch mode, how to override watch_set.txt.
- Optional `--once` flag: run the subset once and exit (for ad-hoc use).
- `Ctrl-C` exits cleanly (no leftover threads).
- Watcher subset (10 of 18) is the smaller of the smoke-set, focused on FSM-relevant scenarios since prompt-tweaking is the primary use case.

**Patterns to follow:**
- `mira-crawler/watcher/folder_watcher.py` is the closest existing pattern (same `watchdog` library); mirror its `Observer` setup and `Ctrl-C` handler.
- No spinners, no color codes (R9). Plain text. ANSI codes break in non-TTY shells (CI logs, redirected output).
- One-line-per-fixture output format matches `precommit_smoke.py` for consistency.

**Test scenarios:**
- **Happy path:** start watcher, edit `mira-bots/shared/prompts/diagnosis.md`, save → 10-case run fires within 500 ms; completes in <30 s; one-line summary printed.
- **Happy path:** edit a `.py` file under `mira-bots/shared/`, save → run fires.
- **Edge case:** edit a fixture YAML under `tests/eval/fixtures/` → run fires; if the edited fixture is in `watch_set.txt`, it picks up the new content.
- **Edge case:** save 3 times in 200 ms (VS Code auto-save salvo) → only one run fires (debounce).
- **Edge case:** edit `.pyc` or anything in `__pycache__` → no run fires (ignored).
- **Error path:** `Ctrl-C` while a run is in progress → graceful exit; no hung threads; runs cleanly second time.
- **Integration:** watcher honors the same `EVAL_DISABLE_JUDGE=1` discipline as the smoke hook — no Groq/Claude API calls during watch loop.
- **Performance:** wall-clock per loop <30 s on a typical laptop. If it creeps past, watch_set is trimmed in a 1-line PR.

**Verification:**
- Manual: start watcher, induce a save, observe the run completes within 30 s with correct output.
- Manual: induce a regression in a watched fixture, save, watcher reports the failed checkpoint.
- Manual: `Ctrl-C` exits within 1 s.
- `python tools/eval_watch.py --once` runs the watch_set subset once and exits 0/1 — same semantics as `precommit_smoke.py` on a smaller fixture set.

---

- [ ] **Unit 4: Wire smoke gate against PR #411 regression + write README usage block**

**Goal:** Prove shift-left coverage by demonstrating the smoke hook would have caught PR #411's `_MAX_Q_ROUNDS` regression at commit time, and document the new pre-commit + watcher workflow for engineers.

**Requirements:** Validation of R3 + adoption proxy in Success Criteria.

**Dependencies:** Units 1, 2, 3 (lands last so the demo runs against the full system).

**Files:**
- Modify: `wiki/references/dev-loop.md` (or `wiki/hot.md` if no dedicated dev-loop reference exists) — add a "Pre-commit + watch loop" section with `setup_precommit.sh` invocation, hook list, watcher invocation, and the smoke/watch set tuning recipe.
- Modify: `CLAUDE.md` — add one-line pointer to `wiki/references/dev-loop.md` under the Pointers section. Keep CLAUDE.md ≤120 lines per its own self-imposed budget.
- Modify: `docs/superpowers/plans/2026-04-19-velocity-roadmap.md` — set Velocity #3's row from `next` → `shipped` with merge date.

**Approach:**
- In the PR description, include a manual verification block showing:
  1. On the velocity-3 branch with the smoke hook installed, `git checkout f29553b -- mira-bots/shared/engine.py` (the pre-#411 broken state) → `git add` → `git commit` → smoke hook fails with the Q-trap fixture failures.
  2. Restore engine.py → smoke hook passes.
- Document this exact reproduction in the PR description as the "shift-left proof point."
- README/wiki update is short and operational: install command, what to expect, how to bypass, how to tune the smoke set.

**Patterns to follow:**
- Existing `wiki/references/` doc style — short, command-first, scannable.
- `CLAUDE.md` Maintenance section: any new pointer goes under Pointers; keep total lines ≤120.

**Test scenarios:**
- **Validation:** the `_MAX_Q_ROUNDS = "2"` regression reproduction described above produces a failing pre-commit; restoring `"3"` produces a passing pre-commit. Documented with terminal-output excerpt in PR description.
- **Doc validation:** a fresh engineer follows the wiki/dev-loop.md instructions on a clean checkout and ends up with a working pre-commit + watcher within 5 minutes.

**Verification:**
- PR description includes the regression-reproduction terminal excerpt.
- `wc -l CLAUDE.md` ≤120.
- `wiki/references/dev-loop.md` is linked from `CLAUDE.md`'s Pointers section.

## System-Wide Impact

- **Interaction graph:** Touches `.pre-commit-config.yaml` (new), `tools/precommit_smoke.py` (new), `tools/eval_watch.py` (new), `tests/eval/smoke_set.txt` (new), `tests/eval/watch_set.txt` (new), `tools/setup_precommit.sh` (new), `.claude/settings.local.json` (gitleaks hook removed), `pyproject.toml` (possibly `[tool.pyright]` added), `tests/eval/offline_run.py` (possibly `run_subset` added), `wiki/references/dev-loop.md` (new or updated), `CLAUDE.md` (one-line pointer), `docs/superpowers/plans/2026-04-19-velocity-roadmap.md` (status update).
- **Error propagation:** Pre-commit hook failures block commits — that's the point. `--no-verify` is the documented escape hatch for emergencies. No CI changes; CI keeps its full sweep regardless of local hook state.
- **State lifecycle risks:** `tools/eval_watch.py` is a long-running process; ensure it shuts down cleanly on `Ctrl-C` and doesn't accumulate file handles. Verified by Unit 3's manual test scenarios.
- **API surface parity:** None. No HTTP routes, no public types. Only new dev-tooling entry points (`tools/precommit_smoke.py`, `tools/eval_watch.py`, optional `offline_run.run_subset`).
- **Integration coverage:** Unit 4's regression-reproduction validates the end-to-end shift-left claim against a real, recent regression (#411).
- **Unchanged invariants:** All existing tests, eval scenarios, CI workflows, and runtime behavior. Adding a pre-commit framework does not modify any application code; only Q-trap fix from #411 (already in the parent main as of merge) shipped engine behavior.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Smoke hook >2 min — engineers disable it | Print wall-time warning at >120 s; trim smoke_set.txt in a 1-line follow-up PR; never grow it past 18 |
| Pre-commit framework install fails on Windows for some engineers | `tools/setup_precommit.sh` is bash; test on Git Bash on Windows; fall back to PowerShell snippet in wiki doc if needed |
| Watcher debounce too short — duplicate runs on VS Code auto-save | Verified at 500 ms in Unit 3; raise to 1000 ms if needed |
| Smoke fixtures become stale as prompts evolve | `tests/eval/smoke_set.txt` is a 1-line PR to retune; CI nightly judge run catches drift |
| `offline_run.py` programmatic API change (if added) breaks existing CLI | Refactor extracts shared inner function; CLI keeps identical surface; tested by re-running existing `--suite full/text/photos` invocations |
| Bandit or pyright version drift between pre-commit and CI | Both pinned to the same versions in `.pre-commit-config.yaml` and `ci.yml`; one PR updates both |
| Engineers run pre-commit hooks in CI server-side and cause double-CI cost | Out-of-scope here; defer to follow-up where cost-benefit can be measured |

## Documentation / Operational Notes

- New wiki page `wiki/references/dev-loop.md` documents: install (`bash tools/setup_precommit.sh`), what hooks fire, how to bypass (`--no-verify`), how to tune the smoke set, and how to run the watcher.
- `CLAUDE.md` gains one-line Pointer entry to `wiki/references/dev-loop.md`.
- `docs/superpowers/plans/2026-04-19-velocity-roadmap.md` row for Velocity #3 transitions `next` → `shipped` with merge date.
- No customer-facing or API doc updates required.

## Sources & References

- **Origin document:** `docs/superpowers/specs/2026-04-19-velocity-3-precommit-smoke-design.md`
- **Parent roadmap:** `docs/superpowers/plans/2026-04-19-velocity-roadmap.md`
- **Ideation artifact:** `docs/ideation/2026-04-19-mira-dev-velocity-ideation.md`
- **Velocity #2 spec/plan (pattern source):** `docs/superpowers/specs/2026-04-19-velocity-2-impact-graph-ci-design.md`, `docs/superpowers/plans/2026-04-19-velocity-2-impact-graph-ci.md`
- **Q-trap regression PR (validation target for Unit 4):** `https://github.com/Mikecranesync/MIRA/pull/411`
- **Current CI:** `.github/workflows/ci.yml`
- **Eval harness:** `tests/eval/offline_run.py`, `tests/eval/grader.py`, `tests/eval/judge.py`
- **Bandit config:** `.bandit.yml`
- **Gitleaks config:** `.gitleaks.toml`
- **pre-commit framework:** `https://pre-commit.com/`
- **watchdog library:** `https://python-watchdog.readthedocs.io/`
