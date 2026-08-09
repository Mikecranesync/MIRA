# Consistency across 5 seed(s)

Runs: `c12s42`, `c12s43`, `c12s44`, `c12s45`, `c12s46`

| finding | `c12s42` | `c12s43` | `c12s44` | `c12s45` | `c12s46` | rate | verdict |
|---|---|---|---|---|---|---|---|
| `t1:reset_procedure` | **FAIL** | PASS | PASS | **FAIL** | PASS | 60% | FLAKY |
| `t2:pivot_after_fault` | PASS | **FAIL** | **FAIL** | **FAIL** | PASS | 40% | FLAKY |
| `t1:control_request` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:doc_possession` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:educational` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:fault_code_gs10` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:fault_code_pf525` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:greeting` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:symptom_report` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:symptom_report_plural` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t2:abandoned_path_recovery` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t2:asset_switch_direct` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t2:confused_correction` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t2:continuation_is_kept` | PASS | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |

## Flaky — the category a single run cannot see

These behave differently under different seeds. A green round proves nothing about them, and neither does a red one.

- `t1:reset_procedure` — 60% pass
- `t2:pivot_after_fault` — 40% pass
