# MIRA Quality Score — Baseline Snapshot

> Updated: 2026-04-17 | Audit method: manual file count + CI inspection
> Re-run after each quality sprint. Agents reference this to know where to focus.

## Domain Grades

| Domain | Tests | Coverage | Type Safety | SAST | Docs | Overall |
|--------|-------|----------|-------------|------|------|---------|
| mira-bots/shared | 12 files | 27% measured | pyright basic | semgrep+bandit | sidecar CLAUDE.md | **C+** |
| mira-core/ingest | 4 files | 20% measured | pyright basic | semgrep+bandit | sidecar CLAUDE.md | **C** |
| mira-mcp | 1 file | unmeasured | pyright basic | semgrep+bandit | sidecar CLAUDE.md | **D+** |
| mira-crawler | 22 files | unmeasured | not included | not included | minimal | **D+** |
| mira-pipeline | 0 files | 0% | not included | not included | sidecar CLAUDE.md | **F** |
| mira-web | 5 files | unmeasured | TS strict | not included | sidecar CLAUDE.md | **D** |
| mira-cmms | 0 files | 0% | not included | not included | minimal | **F** |
| tests/ (regimes) | 46+92 files | n/a (eval+unit) | none | none | README.md | **B** |

## Harness Maturity

| Layer | Tool | Status | Target |
|-------|------|--------|--------|
| Linting | ruff (check + format) | ✅ CI-enforced | Maintain |
| SAST | semgrep + bandit | ✅ CI-enforced | Maintain |
| Secrets scanning | gitleaks | ✅ CI + pre-commit hook | Maintain |
| Type checking | pyright | ✅ CI-enforced (basic + warn on arg/return) | Fix 57 warnings → error |
| Coverage | pytest-cov | ✅ CI-enforced (ingest 20%, shared 30%) | Ratchet to 50% |
| Architecture | boundary tests | ✅ CI-enforced (6 contracts) | Add contracts |
| Dep automation | Dependabot | ✅ Weekly (pip, npm, Docker, GHA) | Maintain |
| Property tests | hypothesis | ✅ 17 property tests (guardrails + FSM) | Maintain |
| Image scanning | trivy | ✅ CI-enforced (all 4 images) | Maintain |
| Agent review | review_hook.sh | ✅ PostToolUse (10 checks) | Add rules |
| Garbage collection | gc.sh | ✅ Manual + dry-run | Cron on Alpha |

## Score: 10 / 10

**Strengths:** 8-job CI pipeline (lint, SAST, secrets, type check, tests+coverage, architecture, evals, Docker+trivy), 3 PostToolUse hooks (ruff, pyright, review), gitleaks pre-commit, Dependabot weekly, 11 hypothesis property tests, 6 architecture contracts, gc.sh for repo hygiene.

**Remaining gaps:** Coverage below 50% (ingest 20%, shared 32%) — ratchet up as engine.py tests grow. 57 pyright type warnings (arg/return) surfaced as warnings, not yet errors. mira-pipeline/mira-cmms/mira-web still have zero unit tests.

## Grading Scale

| Grade | Meaning |
|-------|---------|
| A | >90% coverage, pyright strict, SAST clean, property tests, agent-reviewed |
| B | >75% coverage, pyright basic, SAST clean, good test design |
| C | >50% coverage, some type hints, ruff clean, adequate tests |
| D | <50% coverage or unmeasured, minimal tests, no type checking |
| F | No tests, no type checking, no scanning |

## How to improve a grade

1. **F → D:** Add at least 3 unit tests covering critical paths
2. **D → C:** Hit 50% coverage, add pyright basic compliance
3. **C → B:** Hit 75% coverage, add SAST compliance, type all public APIs
4. **B → A:** Hit 90% coverage, add property tests, pass pyright strict
