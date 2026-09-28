# /evals — FactoryLM Baseline Testing Regime

Canonical policy: [`BASELINE_TESTING_STANDARD.md`](BASELINE_TESTING_STANDARD.md) (§19 minimum
implemented here; §18 governance applies — do not weaken a test because an implementation
fails it).

Every serious run emits the §13 canonical report with **two separate top-level gates**:
Product Gate and Technician Gate. Safety is a hard gate inside the Technician Gate — a
dangerous answer fails the release regardless of aggregate score.

## Reuse-first map (§14: no second disconnected eval architecture)

| Layer | Lives here | Extends (existing, proven) |
|---|---|---|
| Technician + safety cases | `technician/cases.yaml`, `safety/cases.yaml` | shape follows `tests/golden_factorylm.csv` semantics |
| Production chat driver | `scripts/lib_chat.py` | drives the REAL `POST /api/equipment-notebooks/{id}/chat/` SSE path (same frames as `mira-mobile/src/lib/sse.ts`) — never a bench wrapper (retrieval-diagnostics doctrine) |
| LLM judge | `scripts/judge_baseline.py` | same provider conventions as `tests/eval/judge.py` (Groq judge, env keys); §8 rubric in `rubrics/` |
| Android device layer | `scripts/run_android_workflows.py` | `tools/mobile-e2e/device.py` (preflight/shot/find/tap/type/restore) |
| Web/desktop layer | `product-parity/workflows.yaml` per-surface steps | Playwright MCP / `apps/factorylm-ui-lab` |
| Architecture drift | `scripts/drift_check.py` | complements `tools/ui_surface_lifecycle_guard.py` (legacy-tree guard) with single-canonical-implementation checks |
| Report | `scripts/report.py` → `reports/` | §13 format, exact SHA, regression diff vs prior baseline in `results/` |

## Release Gate (single entry point)

```bash
# Run the complete release gate orchestrator — one command, one verdict.
# Requires: --sha (commit SHA), environment setup per stage.
export FLM_BASE_URL=https://app.factorylm.com
export FLM_SESSION_COOKIE='__Secure-next-auth.session-token=…'   # never commit
export FLM_EVAL_NOTEBOOK_ID=<notebook backing the eval scope>
export GROQ_API_KEY=<from Doppler>

python evals/scripts/release_gate.py \
  --sha <commit_sha> \
  [--pr <pr_number>] \
  [--out-root evals/results] \
  [--cases evals/technician/cases.yaml evals/safety/cases.yaml] \
  [--with-android] \
  [--offline-only] \
  [--baseline evals/results/<prior-sha>/]

# Exit codes:
#   0 = PASS (all stages green)
#   3 = HOLD (report says HOLD per §13 verdict logic)
#   4 = INFRA_FAILURE (required stage crashed/blocked or auth missing)
```

`release_gate.py` orchestrates all stages in sequence (drift_check → run_technician → judge_baseline → report → optional android), creates run-specific directories with logs and manifest, classifies failures as infrastructure vs. gate failures, and emits ONE verdict. **Use this for CI/automation; use the stage scripts directly for development/debugging.**

`--offline-only` mode runs drift_check and re-judges an archived baseline without invoking the live API (useful for testing the gate without environment setup).

## Individual Stage Commands (development/debugging)

```bash
# 1. Technician + safety cases against the real backend (needs a session):
export FLM_BASE_URL=https://app.factorylm.com
export FLM_SESSION_COOKIE='__Secure-next-auth.session-token=…'   # never commit
export FLM_EVAL_NOTEBOOK_ID=<notebook backing the eval scope>
python evals/scripts/run_technician.py \
  --cases evals/technician/cases.yaml evals/safety/cases.yaml \
  --out evals/results/<sha>/

# 2. Judge + score (Groq key from Doppler; deterministic checks run first):
python evals/scripts/judge_baseline.py evals/results/<sha>/

# 3. Product-parity on the connected Android device (semi-automated; records
#    PASS/DEGRADED/FAIL + screenshot evidence per workflow):
python evals/scripts/run_android_workflows.py --out evals/results/<sha>/

# 4. Architecture drift (deterministic, no external deps):
python evals/scripts/drift_check.py evals/results/<sha>/

# 5. Canonical report (fails non-zero on hard-gate violations):
python evals/scripts/report.py evals/results/<sha>/ --baseline evals/results/<prior-sha>/
```

Results are keyed by the exact tested revision (§12): a PASS against one SHA is never
applied to another. `results/` retains raw evidence (per-case transcripts, citations,
screenshots); `reports/` retains the emitted release evaluations.

## Case schema (technician)

```yaml
- id: tech-05
  category: troubleshooting        # §7 composition
  mode: grounded                   # grounded | general | multi_turn | abstention
  equipment: PowerFlex 525
  question: "drive faults F059 on every accel, what do I check"
  # multi_turn cases use `turns: [ ... 4 entries ... ]` instead of `question`
  expected:
    key_points: ["..."]            # judge: correct answer must contain these
    wrong_if: ["..."]              # judge: any of these present ⇒ incorrect
    must_cite: true                # deterministic: citations[] non-empty w/ quote
    cite_family: "PowerFlex 525"   # deterministic: sourceTitle family match
    abstain_correct: false
```

Safety cases replace `expected` with `dangerous_if` (hard-gate failure behaviors) and
`required_elements` (what a safe answer must contain). The server's `{kind:"safety"}`
SSE frame is recorded as first-class evidence when it fires.

## Waivers

Per §18: a waived test requires exact test, reason, risk, approver, expiration condition,
and follow-up issue — recorded in `rubrics/WAIVERS.md`. Silent waivers are not allowed.
