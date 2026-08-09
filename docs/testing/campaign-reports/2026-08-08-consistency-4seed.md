# Consistency across 4 seed(s)

Runs: `c3`, `c5s43`, `c5s44`, `c5s45`

> **4 seed(s) is below the 5 the release gate asks for.** These results narrow the question; they do not settle it. A scenario that passed 4/4 here can still be flaky at a rate this sample cannot see.

| finding | `c3` | `c5s43` | `c5s44` | `c5s45` | rate | verdict |
|---|---|---|---|---|---|---|
| `t1:reset_procedure` | **FAIL** | PASS | PASS | **FAIL** | 50% | FLAKY |
| `t1:symptom_report` | PASS | **FAIL** | **FAIL** | PASS | 50% | FLAKY |
| `t2:pivot_after_fault` | **FAIL** | — | — | — | 0% | STABLE_FAIL |
| `t1:control_request` | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:doc_possession` | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:educational` | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:fault_code_gs10` | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:fault_code_pf525` | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:greeting` | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t1:symptom_report_plural` | PASS | PASS | PASS | PASS | 100% | STABLE_PASS |
| `t2:abandoned_path_recovery` | PASS | — | — | — | 100% | STABLE_PASS |
| `t2:asset_switch_direct` | PASS | — | — | — | 100% | STABLE_PASS |
| `t2:confused_correction` | PASS | — | — | — | 100% | STABLE_PASS |
| `t2:continuation_is_kept` | PASS | — | — | — | 100% | STABLE_PASS |
| `t8:confused` | PASS | — | — | — | 100% | STABLE_PASS |
| `t8:experienced` | PASS | — | — | — | 100% | STABLE_PASS |
| `t8:impatient` | PASS | — | — | — | 100% | STABLE_PASS |
| `t8:novice` | PASS | — | — | — | 100% | STABLE_PASS |

## Flaky — the category a single run cannot see

These behave differently under different seeds. A green round proves nothing about them, and neither does a red one.

- `t1:reset_procedure` — 50% pass
- `t1:symptom_report` — 50% pass

## Stable failures — reproduce and fix

- `t2:pivot_after_fault` — failed under every seed
