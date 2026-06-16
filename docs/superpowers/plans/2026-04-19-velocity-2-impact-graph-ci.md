---
title: "feat: Velocity #2 — Impact-Graph CI (minimal scope)"
type: feat
status: active
date: 2026-04-19
origin: ../specs/2026-04-19-velocity-2-impact-graph-ci-design.md
roadmap: 2026-04-19-velocity-roadmap.md
tags: [velocity, ci, dx]
---

# Velocity #2 — Impact-Graph CI (minimal scope)

## Overview

This PR delivers the minimal scope of velocity survivor #2 from the 2026-04-19 dev-velocity roadmap:

1. Parallelize `pytest` inside test jobs via `pytest-xdist -n auto`
2. Cache Docker buildx via `type=gha` to drop warm-cache builds from 3-4 min → <90 s per image
3. Split the sequential `sast-scan` job into two parallel jobs (`sast-semgrep`, `sast-bandit`)
4. Add `paths-ignore:` so docs-only PRs and non-main pushes skip CI entirely

No selective test runs, no impact-graph walker, no matrix-fanned Docker builds, no pre-commit hook — all deferred per the brainstorm's scope boundaries.

## Problem Frame

Verified in `.github/workflows/ci.yml` on 2026-04-19: CI time-to-green on a feature-branch PR is slow enough to break flow for the 1–2 engineer team. Specifically:

- `test-unit` runs `pytest` serially (no `-n auto`)
- `test-eval-offline` runs `pytest` serially
- `sast-scan` runs `semgrep` then `bandit` sequentially within one job
- `docker-build-check` builds 4 Dockerfiles with no cache — every push pays the full 3–4-minute-per-image cost
- Docs-only PRs (like #402, #404) trigger the full pipeline with zero functional changes

This is a pure-win PR: each change lifts a known bottleneck with zero architectural risk. See origin: `docs/superpowers/specs/2026-04-19-velocity-2-impact-graph-ci-design.md`.

## Requirements Trace

Every requirement below maps to an implementation unit.

- **R1** (test-unit xdist) → Unit 1
- **R2** (test-eval-offline xdist, regime-safe exceptions) → Unit 1
- **R3** (coverage gates unchanged under xdist) → Unit 1 verification
- **R4** (split sast-scan into two parallel jobs) → Unit 2
- **R5** (SAST config, severity, SARIF unchanged) → Unit 2
- **R6** (Docker `type=gha` on all 4 builds) → Unit 3
- **R7** (cache scope per-Dockerfile) → Unit 3
- **R8** (docs-only `paths-ignore` for PRs and non-main pushes) → Unit 4
- **R9** (main pushes always run full CI) → Unit 4

## Scope Boundaries

- **Not in this PR:** selective test runs, `pytest --testmon`, `tools/impact.py` (all deferred to later velocity work).
- **Not in this PR:** matrix-fanning the 4 Dockerfile builds into 4 parallel jobs.
- **Not in this PR:** fixing the `chromadb`/`starlette` version conflict that keeps 5 test files ignored — tracked as velocity ideation idea #8.
- **Not in this PR:** pre-commit hooks — that is velocity survivor #3.
- **Not in this PR:** building the 13 non-prod Dockerfiles in CI. Current 4 stays current 4.
- **Not in this PR:** eval judge caching — velocity survivor #3/#5.

### Deferred to Separate Tasks

- **Selective test runs** — becomes its own PR once baseline xdist shows us the residual tax.
- **Matrix-fan Docker builds** — revisit if build count grows past 4.
- **chromadb/starlette pin** — velocity idea #8, separate PR.

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/ci.yml` — entire file touched; verified on 2026-04-19.
- `.github/workflows/ci-evals.yml` — out of scope for this PR but will inherit cache-key conventions later.
- `pyproject.toml` — `[tool.pytest.ini_options]` has `asyncio_mode = "auto"`; coverage fail-under live in `[tool.coverage.report]` (`fail_under = 25`).
- `mira-core/mira-ingest/tests/` — unit-test root #1 (currently run with `--cov-fail-under=20`).
- `mira-bots/tests/` — unit-test root #2 (`--cov-fail-under=30`, ignores `test_slack_relay.py`).
- `tests/` — eval root, runs with `-m "not network and not slow"` plus 5 explicit `--ignore=` flags for known-broken files (chromadb/starlette version conflict).

### Institutional Learnings

- Feedback memory `feedback_verify_before_done.md` — after a side-effecting CI change, verify the actual workflow run output, not just absence of failure.
- Project memory `project_pipeline_regression_2026_04_17.md` — do not re-capture screenshots while pipeline regressions are active; our verification flow here is bounded to CI timing and pass/fail, not product screenshots.

### External References

- `docker/setup-buildx-action@v4` → `cache-from: type=gha` backend, documented at `https://docs.docker.com/build/ci/github-actions/cache/#github-cache`.
- `pytest-xdist` → `-n auto` uses logical CPU count; GitHub-hosted `ubuntu-latest` runners expose 4 vCPU on free/pro tier.

## Key Technical Decisions

- **Workflow-level `paths-ignore:` over `dorny/paths-filter`.** Simpler, fewer dependencies, and sufficient for docs-only skip. A path-filter job becomes worthwhile only when we add selective test runs, which is explicitly out of scope here. Revisit in velocity #3+ if needed.
- **gha cache scope per-Dockerfile, keyed by image name.** `scope: mira-ingest`, `scope: mira-telegram`, `scope: mira-slack`, `scope: mira-mcp`. Prevents one service's cache churn from evicting another's. No shared base-layer cache — GHA already dedupes identical intermediate layers by digest.
- **Split SAST into two separate jobs, not one job with parallel steps.** GitHub Actions jobs run on separate runners; job-level split gives us true parallelism and independent status reporting on the PR. Step-level parallelism inside one job is not a first-class feature.
- **xdist distribution mode: default (`loadfile`).** No need to force `loadscope` or `loadgroup` unless tests fail — keeps the change minimal and reversible.
- **Coverage thresholds unchanged.** `pytest-cov` aggregates correctly across xdist workers via `--cov-append` semantics when `-n auto` is present. `--cov-fail-under=20` (ingest) and `=30` (bots) still apply.
- **No `continue-on-error` anywhere.** The SAST split and docs-skip must not weaken the existing gate — only restructure or conditionally skip it.

## Open Questions

### Resolved During Planning

- **Q:** `paths-ignore:` at workflow level vs job-level `dorny/paths-filter`?
  **A:** Workflow level. Covered in Key Decisions.
- **Q:** gha cache key structure per-Dockerfile + per-requirements-hash, or per-Dockerfile only?
  **A:** Per-Dockerfile only for v1. `type=gha` already keys on Dockerfile content digest internally; per-requirements-hash is an over-optimization.
- **Q:** SAST SARIF dedupe on GitHub Security tab — does splitting affect it?
  **A:** No. Each job uploads its own SARIF with its own category; GitHub de-duplicates by (rule, file, line) regardless of source job.

### Deferred to Implementation

- Whether any of the 76 offline tests have process-global state or ordering dependencies that break under `-n auto`. **Verification step in Unit 1:** trial run on the feature branch; if a regime fails, narrow its pytest invocation to `-n 0` (serial) and document in a step comment.
- Exact minute-count baseline for time-to-green. **Verification step in Unit 4:** capture `gh run list --branch <trial>` timings before-and-after on 3 representative PRs (bot code, ingest code, docs-only).

## Implementation Units

- [ ] **Unit 1: Enable `pytest-xdist -n auto` in test-unit and test-eval-offline jobs**

**Goal:** Parallelize pytest across the runner's CPUs so the existing test suite runs in ~1/N the wall-clock time without changing any test behavior.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `.github/workflows/ci.yml`
- Test: `tests/` (existing); no new test files

**Approach:**
- In `test-unit` job's pip-install step, add `pytest-xdist` to the package list.
- Change both `pytest` invocations in `test-unit` to include `-n auto` before any other flags. Keep `--cov=...`, `--cov-report=term-missing`, `--cov-fail-under=*`, and `-v` unchanged.
- In `test-eval-offline`, add `pytest-xdist` to the install and `-n auto` to the invocation.
- Do not change any `--ignore=` flags. The 5 ignored test files (regime5_nemotron, regime6_sidecar, test_mira_pipeline, test_nameplate_e2e, test_session_context) stay ignored — out of scope.

**Patterns to follow:**
- Existing `pytest` invocation shape in `ci.yml:109-118` and `ci.yml:185-196`.
- Keep `-v` verbose flag; needed for failure triage.

**Test scenarios:**
- **Happy path:** push to a feature branch; `test-unit` completes successfully; total wall time < baseline.
- **Happy path:** `test-eval-offline` completes successfully under `-n auto`; all non-ignored scenarios still pass.
- **Edge case:** coverage report still aggregates; `--cov-fail-under=20` and `=30` gates still apply and still fail if coverage regresses.
- **Error path:** intentionally break a test on the trial branch; verify the xdist-parallelized run still reports the failure with a readable traceback.
- **Integration:** both `--cov-report=term-missing` output and the final `Unit Tests` / `Eval Offline` job names appear the same as today (no breaking change to downstream log consumers).

**Verification:**
- `test-unit` job duration drops by ≥30% on a typical PR.
- `test-eval-offline` duration drops by ≥30%.
- Coverage delta in CI log is ≥ the pre-change value (no regression).
- If any test becomes flaky under parallelism, narrow that regime's invocation to `-n 0` with a one-line comment identifying the ordering dependency.

---

- [ ] **Unit 2: Split `sast-scan` into `sast-semgrep` and `sast-bandit`**

**Goal:** Remove the sequential bottleneck where semgrep must finish before bandit starts. Both gate on `lint-and-type-check` and run fully in parallel.

**Requirements:** R4, R5

**Dependencies:** None (can ship independently of Unit 1)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Test: none (CI config change; no code under test)

**Approach:**
- Delete the current `sast-scan` job.
- Add `sast-semgrep` job with `needs: lint-and-type-check`, containing only the semgrep step + SARIF upload.
- Add `sast-bandit` job with `needs: lint-and-type-check`, containing only the bandit install + run.
- No change to semgrep config, `.bandit.yml`, severity thresholds, or SARIF upload path.
- Keep identical step names where possible to preserve any external status-check references.

**Patterns to follow:**
- Existing `sast-scan` job body at `ci.yml:58-88` is the source; the split is mechanical.
- `license-check` and `architecture-check` already use the `needs: lint-and-type-check` pattern — mirror it.

**Test scenarios:**
- Test expectation: none — pure CI config change, no behavioral code modified. Unit 2's verification below is the acceptance gate.

**Verification:**
- Both `sast-semgrep` and `sast-bandit` appear as distinct status checks on a PR.
- Both run after `lint-and-type-check` passes (not before).
- SARIF upload from `sast-semgrep` lands on the GitHub Security tab as before.
- Total SAST wall time (semgrep + bandit in parallel) is ≈ max(semgrep_time, bandit_time), not sum.
- A semgrep failure does not block bandit from reporting, and vice versa (each job reports independently).

---

- [ ] **Unit 3: Add `type=gha` Docker cache to all 4 builds in `docker-build-check`**

**Goal:** Drop warm-cache Docker build time from ~3–4 min per image to <90 s per image by reusing layer cache across CI runs.

**Requirements:** R6, R7

**Dependencies:** None

**Files:**
- Modify: `.github/workflows/ci.yml`
- Test: none (CI config change)

**Approach:**
- For each of the 4 `docker buildx build` steps (mira-ingest, mira-telegram, mira-slack, mira-mcp), add `--cache-from type=gha,scope=<image-name>` and `--cache-to type=gha,mode=max,scope=<image-name>` flags.
- Scopes: `mira-ingest`, `mira-telegram`, `mira-slack`, `mira-mcp` — one per image, matching the `-t <name>:scan` tag.
- Do not change the trivy scan step or its severity thresholds.
- Do not change Dockerfile contents.

**Patterns to follow:**
- Existing `docker buildx build` invocation shape at `ci.yml:211-245`.
- `docker/setup-buildx-action@v4` is already present at `ci.yml:204-205` — no additional setup needed.

**Test scenarios:**
- Test expectation: none — CI config change. Verification below is the gate.

**Verification:**
- First run after this unit lands: cold-cache, same timing as before (≈ baseline).
- Second run on the same branch (no Dockerfile changes): warm-cache, build step <90 s per image.
- GitHub Actions cache entries visible under the repo's Caches tab, one per scope.
- A change touching only `mira-ingest/Dockerfile` does not evict the `mira-telegram` scope's cache.
- Cache size stays under GitHub's 10 GB per-repo limit (spot-check after 2 weeks of CI churn).

---

- [ ] **Unit 4: Add `paths-ignore` for docs-only PRs and non-main pushes; capture baseline**

**Goal:** Skip CI entirely when the only changes are documentation, wiki content, or image assets, while preserving the safety net that `main` pushes always run full CI.

**Requirements:** R8, R9

**Dependencies:** Units 1, 2, 3 (land last so the baseline capture measures the fully-optimized pipeline)

**Files:**
- Modify: `.github/workflows/ci.yml`

**Approach:**
- At the top-level `on:` trigger in `ci.yml`, add `paths-ignore:` to both `pull_request:` and `push:` blocks.
- The `paths-ignore` list: `docs/**`, `wiki/**`, `**/*.md`, `.claude/**`, `**/*.webp`, `**/*.png`, `**/*.jpg`, `**/*.gif`.
- For the `push:` block, preserve the current `branches: [main, dev]` behavior but document the intent: non-`main` pushes follow `paths-ignore`; `main` pushes always run full CI as the last safety net.
- **Note:** GitHub Actions semantics — `paths-ignore` applies per-trigger. If we want `main` pushes to be the exception, we need two `push:` entries (one with `paths-ignore` for `dev`, one without for `main`) or a post-filter at the job level. Resolve in implementation: check GHA docs to confirm the cleanest way to express "ignore paths except on main."
- Capture CI baseline for verification: before this unit merges, run `gh run list --branch main --workflow CI --limit 10 --json conclusion,durationMS,name,createdAt > /tmp/ci-baseline-pre.json` so we have a measured before/after.

**Patterns to follow:**
- GitHub Actions `paths-ignore` documented at `docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onpushpull_requestpull_request_targetpathspaths-ignore`.

**Test scenarios:**
- **Happy path:** open a PR that only modifies `docs/foo.md` → no CI runs.
- **Happy path:** open a PR that modifies `docs/foo.md` + `mira-bots/shared/foo.py` → full CI runs (mixed PR not ignored).
- **Happy path:** push directly to `main` with a docs-only change → full CI still runs (safety net).
- **Edge case:** open a PR that modifies `wiki/hot.md` → no CI runs.
- **Edge case:** open a PR that adds `mira-web/public/screenshots/foo.webp` → no CI runs.
- **Edge case:** open a PR that modifies `CLAUDE.md` at repo root → covered by `**/*.md` → no CI runs.
- **Integration:** the 3 already-open docs-only PRs (#402, #404, and this plan's PR when it lands) do not re-trigger CI on the next push to those branches.

**Verification:**
- `gh pr create` against a synthetic docs-only branch reports no pending CI checks.
- `gh pr create` against a synthetic mixed branch reports all checks running.
- Capture `gh run list --branch <trial> --workflow CI --limit 5 --json conclusion,durationMS,name,createdAt > /tmp/ci-baseline-post.json`.
- Compare to `/tmp/ci-baseline-pre.json`: median feature-PR duration should drop by ≥50% (the roadmap's primary success criterion).

## System-Wide Impact

- **Interaction graph:** Touches only `.github/workflows/ci.yml`. `ci-evals.yml`, `dependency-check.yml`, `prompt-guard.yml`, `release.yml` are untouched but will inherit `type=gha` cache conventions in a future PR.
- **Error propagation:** SAST split changes the failure shape — two independent failures instead of one compound. Branch-protection rules that reference `sast-scan` by name must be updated to reference `sast-semgrep` + `sast-bandit`. **Action for the implementer:** check `Settings → Branches → main` for required-status-check references to `sast-scan` and update them in the same PR.
- **State lifecycle risks:** None — CI is stateless per run. GHA cache is eventually consistent; a cold-cache run is always safe fallback.
- **API surface parity:** Status-check names change (`sast-scan` → `sast-semgrep` + `sast-bandit`). Any external CI status listener (none known at this time) must be updated.
- **Integration coverage:** Coverage aggregation under `pytest-xdist` is covered by Unit 1 tests. SARIF de-duplication under the SAST split is covered by Unit 2 verification.
- **Unchanged invariants:** All existing test suites, coverage thresholds (20%, 30%), Trivy severity gates (HIGH, CRITICAL), semgrep config, `.bandit.yml`, license-check allowlist, architecture-check test. Nothing that affects test pass/fail semantics moves in this PR.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `pytest-xdist -n auto` surfaces hidden test ordering or shared-state bugs | Trial on a feature branch first; narrow any offending regime to `-n 0` with a documented comment; open a separate issue to fix root cause |
| Required-status-check name changes break branch protection | Update branch protection in the same PR; verify required checks list before merging |
| GHA cache eviction under heavy churn | Per-Dockerfile scope isolation; monitor cache size for 2 weeks post-merge |
| `paths-ignore` expression doesn't match "main-always" intent cleanly | Confirm GitHub Actions `paths-ignore` semantics during implementation; fall back to job-level filter if workflow-level proves too coarse |
| Coverage report aggregation quirks under xdist | Already supported by `pytest-cov` natively with `-n auto`; verify on trial branch that `--cov-fail-under` still enforces |

## Documentation / Operational Notes

- No customer-facing doc updates required.
- Update the velocity roadmap (`docs/superpowers/plans/2026-04-19-velocity-roadmap.md`) in the same PR: set Unit 2's row from `next` → `shipped` with the merge date.
- Capture CI baseline before/after in the PR description as a screenshot or inline metrics block — acts as both success evidence and historical baseline for velocity #3.

## Sources & References

- **Origin document:** `docs/superpowers/specs/2026-04-19-velocity-2-impact-graph-ci-design.md`
- **Parent roadmap:** `docs/superpowers/plans/2026-04-19-velocity-roadmap.md`
- **Ideation artifact:** `docs/ideation/2026-04-19-mira-dev-velocity-ideation.md`
- **Current CI:** `.github/workflows/ci.yml`
- **Pytest config:** `pyproject.toml` (`[tool.pytest.ini_options]`, `[tool.coverage.*]`)
- **Docker buildx GHA cache:** `https://docs.docker.com/build/ci/github-actions/cache/#github-cache`
- **GitHub Actions paths filter:** `https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onpushpull_requestpull_request_targetpathspaths-ignore`
