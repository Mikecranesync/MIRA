---
date: 2026-04-19
topic: velocity-2-impact-graph-ci
status: active
owner: Mike
tags: [velocity, ci, dx]
linked: ../plans/2026-04-19-velocity-roadmap.md
---

# Velocity #2 — Impact-Graph CI (Minimal Scope)

## Problem Frame

CI time-to-green on a typical feature-branch PR is slow enough to break flow for the 1–2 engineer MIRA team. Measurable causes in the current `.github/workflows/ci.yml` (verified 2026-04-19):

- Unit tests run serially with no `pytest-xdist`.
- Offline eval tests run serially — same.
- `sast-scan` job runs `semgrep` and `bandit` sequentially inside one job instead of as two parallel jobs.
- `docker-build-check` builds 4 Dockerfiles with no cache; every push pays the full 3–4-minute-per-image cost.
- Docs-only PRs (for example the recent ideation PRs #402 and #404) trigger the full CI pipeline with zero functional changes.

This is the "shift the intra-job work from serial to parallel, cache the predictably-cachable parts, and skip CI when there's nothing to gate" PR. Selective test runs and import-graph-driven test selection are explicitly deferred — see Scope Boundaries.

## Requirements

**Test execution**
- R1. Update the `test-unit` job to run `pytest` with `-n auto` via `pytest-xdist`.
- R2. Update the `test-eval-offline` job to run `pytest` with `-n auto` where regime-safe; if any regime has order-dependency, keep it serial under a labeled exception documented in the job step.
- R3. Coverage reporting (`pytest-cov`) continues to aggregate correctly under `-n auto` — no regression in the `--cov-fail-under` gates (ingest=20, bots=30).

**SAST parallelization**
- R4. Split `sast-scan` into two jobs: `sast-semgrep` and `sast-bandit`. Both run in parallel; both gate only on `lint-and-type-check`.
- R5. No change to tool configuration, severity thresholds, or SARIF upload behavior.

**Docker build caching**
- R6. Every `docker buildx build` step in `docker-build-check` uses `cache-from: type=gha` and `cache-to: type=gha,mode=max`.
- R7. Cache scope keyed per-Dockerfile (one cache per image) so one service's churn does not evict another service's cache.

**Docs-only CI skip**
- R8. Add workflow-level `paths-ignore:` (or equivalent job-level filter) so PRs and pushes whose diff touches only the following paths skip CI entirely: `docs/**`, `wiki/**`, `**/*.md`, `.claude/**`, `**/*.webp`, `**/*.png`, `**/*.jpg`, `**/*.gif`.
- R9. Pushes to `main` run the full workflow regardless of path filter (safety net for accidental branch misuse).

## Success Criteria

- Time-to-green on a typical feature-branch PR drops by **≥50%** measured against a baseline of three recent representative PRs (one bot-code, one ingest, one pipeline). Baseline to be captured in the planning PR, not this requirements doc.
- Warm-cache `docker-build-check` run drops from the current ~3-4 min per image to **<90 seconds per image**.
- Docs-only PRs produce **zero CI workflow runs** (no skipped-but-charged billable minutes).
- No regression in test reliability — same tests pass; the `@pytest.mark.flaky` / ignored-test set stays unchanged.

## Scope Boundaries

- **Out of scope for this PR:** selective test runs via path-based filter (`dorny/paths-filter`), `pytest --testmon`, or a custom `tools/impact.py`. Feature PRs still run the full test suite — just faster.
- **Out of scope:** parallelizing the 4 Dockerfile builds into a matrix of 4 parallel jobs. Burns free-tier concurrency slots for marginal upside at 4 images; revisit if we add more.
- **Out of scope:** fixing the chromadb/starlette version conflict that keeps `regime5_nemotron`, `regime6_sidecar`, `test_mira_pipeline.py`, `test_nameplate_e2e.py`, and `test_session_context.py` ignored. Tracked as velocity ideation idea #8 — separate PR.
- **Out of scope:** adding pre-commit hooks locally — that's velocity survivor #3.
- **Out of scope:** building the 13 non-prod Dockerfiles in CI. Current 4 stays current 4.
- **Out of scope:** eval judge caching or eval parallelization beyond `-n auto` on the offline harness — velocity survivors #3 and #5.

## Key Decisions

- **Path-based selective test runs deferred.** Coarse-grained path→test mapping is brittle and adds a map-maintenance burden; the xdist speedup alone likely delivers most of the feature-PR time win without that cost. Revisit if CI is still slow after this lands.
- **Docker builds stay in one job, just cached.** Matrix-fanning 4 builds would saturate the free-tier runner budget on busy days; the gha cache captures ~80% of the possible win at zero concurrency cost.
- **Docs-only skip applies to both pushes and PRs** except `main` pushes. Rationale: we want docs-only ideation/plan PRs (like #402, #404, and this one) to merge without CI noise, and we want docs-only pushes to `dev` to skip too. `main` always runs full CI as the last safety net.
- **Coverage gates unchanged.** `--cov-fail-under=20` (ingest) and `30` (bots) survive the xdist change. If xdist changes coverage reporting shape, the planning PR pins `pytest-cov` appropriately.

## Dependencies / Assumptions

- GitHub-hosted `ubuntu-latest` runners expose ≥2 CPU cores (currently 4 on free/pro tier). `pytest-xdist -n auto` uses all available.
- `docker/setup-buildx-action@v4` (already in use) supports `type=gha` cache backend — confirmed.
- GitHub Actions `paths-ignore:` at workflow level applies at trigger evaluation. Job-level path-filter via `dorny/paths-filter@v3` is the documented alternative; the choice belongs in planning.
- **Unverified:** whether any of the 76 offline tests have process-global state, filesystem-contention, or ordering-dependency that would break under xdist. Planning should run a trial pass before committing.

## Outstanding Questions

### Resolve Before Planning

*None.* Scope is set; product decisions are made.

### Deferred to Planning

- [Affects R1, R2][Technical] Do any current tests have order-dependency that breaks under `pytest-xdist -n auto`? Investigate via a trial run on a feature branch.
- [Affects R6, R7][Technical] gha cache key structure: per-Dockerfile only, or per-Dockerfile + per-requirements-hash? Trial with one image first.
- [Affects R8][Technical] Workflow-level `paths-ignore:` vs job-level `dorny/paths-filter`: which yields cleaner GitHub PR status reporting ("skipped" vs "never ran")?
- [Affects R4][Needs research] Whether `sast-scan` splitting into two jobs affects the SARIF dedupe behavior on the GitHub Security tab.

## Next Steps

`→ /ce-plan` for structured implementation planning.
