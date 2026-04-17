# MIRA Quality Score — Baseline Snapshot

> Updated: 2026-04-17 | Audit method: manual file count + CI inspection
> Re-run after each quality sprint. Agents reference this to know where to focus.

## Domain Grades

| Domain | Tests | Coverage | Type Safety | SAST | Docs | Overall |
|--------|-------|----------|-------------|------|------|---------|
| mira-bots/shared | 10 files | unmeasured | none (pyright not enabled) | none | sidecar CLAUDE.md | **C** |
| mira-core/ingest | 4 files | unmeasured | none | none | sidecar CLAUDE.md | **C-** |
| mira-mcp | 1 file | unmeasured | none | none | sidecar CLAUDE.md | **D+** |
| mira-crawler | 22 files | unmeasured | none | none | minimal | **D+** |
| mira-pipeline | 0 files | 0% | none | none | sidecar CLAUDE.md | **F** |
| mira-web | 5 files | unmeasured | TS strict | none | sidecar CLAUDE.md | **D** |
| mira-cmms | 0 files | 0% | none | none | minimal | **F** |
| tests/ (regimes) | 46 files | n/a (eval, not unit) | none | none | README.md | **B-** |

## Harness Maturity

| Layer | Tool | Status | Target |
|-------|------|--------|--------|
| Linting | ruff (check + format) | ✅ CI-enforced | Maintain |
| SAST | semgrep + bandit | ❌ Not configured | Phase 1 |
| Secrets scanning | gitleaks | ❌ Not configured | Phase 1 |
| Type checking | pyright | ❌ Not configured | Phase 2 |
| Coverage | pytest-cov | ❌ Not measuring | Phase 2 |
| Architecture | import-linter | ❌ Not configured | Phase 3 |
| Dep automation | Dependabot | ❌ Not configured | Phase 3 |
| Property tests | hypothesis | ❌ Not configured | Phase 4 |
| Image scanning | trivy | ❌ Not configured | Phase 4 |
| Agent review | agent-to-agent | ❌ Not configured | Phase 5 |
| Garbage collection | scheduled cleanup | ❌ Not configured | Phase 5 |

## Score: 5.5 / 10

**Strengths:** CLAUDE.md + sidecar docs, wiki (Karpathy pattern), CI pipeline (5 jobs), ruff hooks, 5-regime test framework, Doppler secrets management.

**Critical gaps:** No SAST, no type checking, no coverage measurement, no pre-commit enforcement, no architecture enforcement, no agent review loops.

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
