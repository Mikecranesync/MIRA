# Gate 7 adversarial review — PR #3309

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** security boundaries, cross-repository contract

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `cd83467857e4e6d4b486135d713d2797c17bb248`
- scope (--paths): full PR diff
- excluded by scope (0): none
- diff chars sent/total: 40,000/43,434 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `25fccfb6e55a0b33939ec1af00846eb99c8dec3cddb30c42f7abc28dfbe94245`
- full scoped-diff sha256 (pre-cap): `fd262d2cc9ddb28cddf895ed7c66e3872fecd80a630e0033c864564fdaaf2050`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[high] Unexpected fields in `REGISTRY.yaml` may break schema validation** — The registry loader in MIRA expects a fixed set of keys (e.g., `status`, `observed_files`, `declared_state`, `key_components`, `known_drift`). This PR adds several new top‑level keys that are not part of the known schema:
  ```diff
  +  canonical_basis:
  +    - "actively maintained (last commit 2026-06-24) with 34 .py modules"
  +    - "real consumers: tools/proof/, two tools/seeds/ files, simlab/api.py, simlab/observe"
  +    - "its own seed lane in .github/workflows/apply-seeds.yml (seed-simlab-docs.py, fixed SimLab tenant)"
  +    - "simlab-gate RUNS on every code PR (.github/workflows/ci.yml:836)"
  +  deletion_safe: false
  +  blocking_evidence:
  +    - "mira-bots/shared/engine.py:510 — the CANONICAL Supervisor names it: _FAULT_DETECTIVE_URL = os.getenv(\"FAULT_DETECTIVE_URL\", \"http://mira-fault-detective:8077\"), and :5265 GETs /current_fault. Gate 11 requires zero API CONSUMERS, not merely zero imports."
  +  clearing_evidence:
  +    - "zero Python imports repo-wide; not named by engine.py or any other canonical module"
  ```
  Adding unknown keys can cause the YAML loader or downstream validation tooling to raise errors, breaking CI pipelines and any automation that consumes the registry.

- **[high] `deletion_safe: true` for `mira-fault-sim` may mislead automated cleanup processes** — The PR marks the experimental bench harness as safe to delete:
  ```diff
  +  deletion_safe: true
  ```
  If any repository‑wide housekeeping job uses this flag to prune “deletion‑safe” components, it could automatically remove `mira-fault-sim`. This component currently provides the only simulation of electrical‑sensor transient states (fuse, dropout, debounce) that are **not** covered by `simlab`. Deleting it would eliminate unique test coverage and could silently degrade the fault‑detection capability of the platform.

- **[high] Documentation drift: CI job comment still claims `simlab-gate` blocks merges** — The PR’s own documentation highlights that the CI job comment and a historic plan still state the gate blocks merges, while the actual CI configuration does **not**:
  ```diff
  + SimLab stays canonical — on maintenance, consumers and its seed lane. ⚠️ **NOT on CI gating:** `simlab-gate` runs on every code PR but does **not** block merge (CU-08 F1, **#3310**); the exclusion is deliberate per `ci.yml:1161-1164`, but the job's own comment and the 2026-06-21 plan both still claim otherwise.
  ```
  This mismatch can give developers a false sense of security, leading them to assume regressions in `simlab` are merge‑blocked when they are not, increasing the risk of unintentionally shipping breaking changes.

- **[high] `known_drift` entry for `simlab` may trigger unintended gate failures** — The PR adds a non‑empty `known_drift` list to a component whose status is `CANONICAL`:
  ```diff
  +  known_drift:
  +    - "CU-08 F1 — `simlab-gate` RUNS on every code PR but does NOT block merge. It is absent from branch protection's required contexts (staging-gate, Hub E2E, mira-web pack tests, CI Gate, hold-gate) AND from ci-gate's needs array. The exclusion is DELIBERATE and documented at ci.yml:1161-1164 (\"Intentionally NOT in the gate yet (stay visible; promote once reliable)\"), so ci.yml behaves correctly — but three other places assert the blocking that does not happen: ci.yml:841-843 (the job's own comment, \"is a merge gate ... blocks merge\"), DUPLICATE_CAPABILITIES.md:34 (\"CI-gated\" given as the reason for CANONICAL), and docs/plans/2026-06-21-simlab-platform-oracle-implementation-plan.md:34 (\"regressions block merge\")."
  ```
  If any gating step (e.g., Gate 11) treats any `known_drift` on a `CANONICAL` entry as a failure condition, this entry could erroneously block merges of `simlab`, a core component, despite its functional correctness.

- **[high] Bench‑harness test suites are not executed by any CI job (regression‑blind)** — Both experimental components have test directories that are completely omitted from the CI workflow, as documented in their `known_drift` sections:
  ```diff
  +    - "CU-08 F5 — mira-fault-detective/tests/test_rules.py exists and NO CI job runs it (ci.yml enumerates test paths individually, cf. #3089). Regression-blind."
  ...
  +    - "CU-08 F5 — mira-fault-sim/tests/ exists and NO CI job runs it. Regression-blind."
  ```
  The absence of CI test execution means defects in the fault‑simulation or detection logic can be introduced without any automated guard, violating the platform’s quality‑gate guarantees.

## NOT REVIEWED
- Whether the MIRA registry loader actually validates against a strict schema (and thus would reject the new fields) – this requires running the loader or inspecting its implementation, which is outside the diff.
- The exact behavior of any housekeeping automation that consumes `deletion_safe` – we cannot confirm if such tooling exists or how it interprets the flag without reviewing the relevant scripts.
- The impact of the `known_drift` entries on existing gate logic – we lack visibility into the implementation of Gate 11 or other gates that might read this field.
- Any downstream tooling that parses the `canonical_basis`, `blocking_evidence`, or `clearing_evidence` fields – their effect is unknown without code inspection.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
