# Drive Commander — Pack Reliability Benchmark

> Deterministic scorecard (`tools/drive-pack-extract/scorecard.py`). No LLM judgment — every
> number is a reproducible computation over `pack.json` / `grading_report.json` / `gold/`.
> Weak scores are shown, not hidden. **beta/manual-cited is NOT bench-proven.**

**Trust ladder:** candidate → beta (manual-cited) → bench-proven → production

| pack | trust | score | faults | params | cite cov | links | bench | gates |
|---|---|---|---|---|---|---|---|---|
| `durapulse_gs10` | bench-proven | 79.0 | 10 | 8 | 100% | 0/1 | yes | 5/6 |
| `powerflex_40` | beta (manual-cited) | 74.5 | 26 | 9 | 100% | 2/2 | no | 6/6 |
| `powerflex_525` | beta (manual-cited) | 74.0 | 48 | 45 | 100% | 5/5 | no | 6/6 |

## `durapulse_gs10` — bench-proven (score 79.0)

**Gates:** schema_valid ✅, param_citation_coverage>=0.9 ✅, no_broken_citations ✅, fault_links_all_resolve ❌, no_fabrication ✅, graded_at_least_beta ✅

**Strengths:** param citation coverage 100%; broken citations: 0; gold fault recall 100%; bench live_decode present (status/cmd/registers)

**Weaknesses:** fault->param link resolve 0%

**Blocks production:** no recorded human approval in registry

## `powerflex_40` — beta (manual-cited) (score 74.5)

**Gates:** schema_valid ✅, param_citation_coverage>=0.9 ✅, no_broken_citations ✅, fault_links_all_resolve ✅, no_fabrication ✅, graded_at_least_beta ✅

**Strengths:** param citation coverage 100%; broken citations: 0; fault->param link resolve 100%; gold fault recall 100%

**Weaknesses:** no bench live_decode (manual-cited only)

**Blocks production:** no bench/live evidence -> ceiling is beta; cannot reach production; bench proof required to exceed beta (populate live_decode + envelope from hardware)

## `powerflex_525` — beta (manual-cited) (score 74.0)

**Gates:** schema_valid ✅, param_citation_coverage>=0.9 ✅, no_broken_citations ✅, fault_links_all_resolve ✅, no_fabrication ✅, graded_at_least_beta ✅

**Strengths:** param citation coverage 100%; broken citations: 0; fault->param link resolve 100%; gold fault recall 100%

**Weaknesses:** no bench live_decode (manual-cited only); 3 declared residual(s)

**Blocks production:** no bench/live evidence -> ceiling is beta; cannot reach production; bench proof required to exceed beta (populate live_decode + envelope from hardware)
