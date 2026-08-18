# Gate 7 adversarial review — PR #3309

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** security boundaries, cross-repository contract

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `290d4ab62b5af1748fc02ddfc10ec93754db7477`
- scope (--paths): full PR diff
- excluded by scope (0): none
- diff chars sent/total: 26,999/26,999 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `63e9f1008b2c2cc1aa8f9494014dd27d511ee19dd3ea7bcc8c9e26e036c1c487`
- full scoped-diff sha256 (pre-cap): `63e9f1008b2c2cc1aa8f9494014dd27d511ee19dd3ea7bcc8c9e26e036c1c487`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Unexpected fields in `REGISTRY.yaml` may break schema validation** — The platform’s registry loader expects a fixed schema (e.g. `status`, `observed_files`, `declared_state`, `key_components`, `known_drift`). This PR adds keys that are not defined in the existing schema: `canonical_basis`, `deletion_safe`, `blocking_evidence`, `clearing_evidence`. When the loader encounters these unknown keys it will raise a validation error, causing CI or downstream tooling to fail.
- **[high] Documentation drift: `DUPLICATE_CAPABILITIES.md` still claims SimLab is CI‑gated while `REGISTRY.yaml` now records that the gate does** — not** block merges** — The row for `MIRA/simlab` in `DUPLICATE_CAPABILITIES.md` says “CI‑gated (`simlab‑gate` on every PR)”, yet the new `known_drift` entry in `REGISTRY.yaml` explicitly states the gate does not block merges. This contradictory information can mislead reviewers and automated decision tools that consume these docs, potentially resulting in incorrect classification or gating behavior.
- **[high] Documentation drift: `BACKLOG.md` still describes SimLab as “CI‑gated” despite evidence it is not a merge gate** — The CU‑08 backlog entry reads “SimLab stays canonical (CI‑gated)”. This directly contradicts the findings in the PR body (F1) and the `known_drift` entry added to `REGISTRY.yaml`. The inconsistency can cause owners to make decisions based on an inaccurate gating claim.
- **[medium] Added `simlab` as a dependency for experimental bench components may unintentionally couple them to the canonical CI pipeline** — The `dependencies` list for both `mira-fault-detective` and `mira-fault-sim` now includes `simlab`. If the CI system uses these dependencies to order or gate jobs, a failure in the canonical SimLab pipeline could block builds of the bench harnesses, contrary to their “experimental” nature.
- **[medium] Non‑empty `known_drift` for a CANONICAL component may cause gates that reject any drift to block merges** — The `known_drift` list for `simlab` now contains two entries describing a mismatch between documentation and actual CI behavior. Some gating logic (e.g., Gate 11) may treat any non‑empty `known_drift` as a failure condition, potentially preventing merges of the canonical SimLab component even though it remains functional.
- **[low] Inconsistent presence of `deletion_safe` across components** — `deletion_safe` is added for the two experimental components but omitted for all other components (including other LEGACY items). If downstream tooling expects this flag to be present for every entry, missing keys could lead to `KeyError` exceptions or default‑fallback behavior that may be undesirable.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Unexpected fields in `REGISTRY.yaml` may break schema validation** — The platform’s registry loader expects a fixed schema (e.g. `status`, `observed_files`, `declared_state`, `key_components`, `known_drift`). This PR adds keys that are not defined in the existing schema: `canonical_basis`, `deletion_safe`, `blocking_evidence`, `clearing_evidence`. When the loader encounters these unknown keys it will raise a validation error, causing CI or downstream tooling to fail.  
  `docs/architecture/convergence/REGISTRY.yaml:+  canonical_basis:`  
  `docs/architecture/convergence/REGISTRY.yaml:+    - "actively maintained (last commit 2026-06-24) with 34 .py modules"`  
  `docs/architecture/convergence/REGISTRY.yaml:+  deletion_safe: false`  
  `docs/architecture/convergence/REGISTRY.yaml:+  blocking_evidence:`  
  `docs/architecture/convergence/REGISTRY.yaml:+    - "mira-bots/shared/engine.py:510 — the CANONICAL Supervisor names it: _FAULT_DETECTIVE_URL = os.getenv(\"FAULT_DETECTIVE_URL\", \"http://mira-fault-detective:8077\"), and :5265 GETs /current_fault. Gate 11 requires zero API CONSUMERS, not merely zero imports."`  
  `docs/architecture/convergence/REGISTRY.yaml:+  clearing_evidence:`  
  `docs/architecture/convergence/REGISTRY.yaml:+    - "zero Python imports repo-wide; not named by engine.py or any other canonical module"`

- **[severity: high] Documentation drift: `DUPLICATE_CAPABILITIES.md` still claims SimLab is CI‑gated while `REGISTRY.yaml` now records that the gate does **not** block merges** — The row for `MIRA/simlab` in `DUPLICATE_CAPABILITIES.md` says “CI‑gated (`simlab‑gate` on every PR)”, yet the new `known_drift` entry in `REGISTRY.yaml` explicitly states the gate does not block merges. This contradictory information can mislead reviewers and automated decision tools that consume these docs, potentially resulting in incorrect classification or gating behavior.  
  `docs/architecture/convergence/DUPLICATE_CAPABILITIES.md:| `MIRA/simlab` | **CANONICAL** | CI-gated (`simlab-gate` on every PR), deterministic, publishes through the canonical `ingest_contract` ("one contract, every transport", `simlab/publishers.py:221`) |`  
  `docs/architecture/convergence/REGISTRY.yaml:+  known_drift:`  
  `docs/architecture/convergence/REGISTRY.yaml:+    - "CU-08 F1 — `simlab-gate` RUNS on every code PR but does NOT block merge. It is absent from branch protection's required contexts (staging-gate, Hub E2E, mira-web pack tests, CI Gate, hold-gate) AND from ci-gate's needs array. The exclusion is DELIBERATE and documented at ci.yml:1161-1164 (\"Intentionally NOT in the gate yet (stay visible; promote once reliable)\"), so ci.yml behaves correctly — but three other places assert the blocking that does not happen: ci.yml:841-843 (the job's own comment, \"is a merge gate ... blocks merge\"), DUPLICATE_CAPABILITIES.md:34 (\"CI-gated\" given as the reason for CANONICAL), and docs/plans/2026-06-21-simlab-platform-oracle-implementation-plan.md:34 (\"regressions block merge\")."`

- **[severity: high] Documentation drift: `BACKLOG.md` still describes SimLab as “CI‑gated” despite evidence it is not a merge gate** — The CU‑08 backlog entry reads “SimLab stays canonical (CI‑gated)”. This directly contradicts the findings in the PR body (F1) and the `known_drift` entry added to `REGISTRY.yaml`. The inconsistency can cause owners to make decisions based on an inaccurate gating claim.  
  `docs/architecture/convergence/BACKLOG.md:- SimLab stays canonical (CI-gated). Decide: `mira-fault-sim`/`mira-fault-detective` → keep as bench harness (register EXPERIMENTAL) or retire; factorylm sim quartet (`sim`, `simulation`, `cosmos`, `cookoff`) is one coupled deletion unit (15+ cross-imports).`  
  *(the line above remains unchanged, still asserting “CI‑gated”)*

- **[severity: medium] Added `simlab` as a dependency for experimental bench components may unintentionally couple them to the canonical CI pipeline** — The `dependencies` list for both `mira-fault-detective` and `mira-fault-sim` now includes `simlab`. If the CI system uses these dependencies to order or gate jobs, a failure in the canonical SimLab pipeline could block builds of the bench harnesses, contrary to their “experimental” nature.  
  `docs/architecture/convergence/REGISTRY.yaml:+  dependencies:`  
  `docs/architecture/convergence/REGISTRY.yaml:+    - docker-compose.fault-detective.yml`  
  `docs/architecture/convergence/REGISTRY.yaml:+    - simlab`  

- **[severity: medium] Non‑empty `known_drift` for a CANONICAL component may cause gates that reject any drift to block merges** — The `known_drift` list for `simlab` now contains two entries describing a mismatch between documentation and actual CI behavior. Some gating logic (e.g., Gate 11) may treat any non‑empty `known_drift` as a failure condition, potentially preventing merges of the canonical SimLab component even though it remains functional.  
  `docs/architecture/convergence/REGISTRY.yaml:+  known_drift:`  
  `docs/architecture/convergence/REGISTRY.yaml:+    - "CU-08 F1 — `simlab-gate` RUNS on every code PR but does NOT block merge. …"`  

- **[severity: low] Inconsistent presence of `deletion_safe` across components** — `deletion_safe` is added for the two experimental components but omitted for all other components (including other LEGACY items). If downstream tooling expects this flag to be present for every entry, missing keys could lead to `KeyError` exceptions or default‑fallback behavior that may be undesirable.  
  `docs/architecture/convergence/REGISTRY.yaml:+  deletion_safe: false` (for `mira-fault-detective`)  
  `docs/architecture/convergence/REGISTRY.yaml:+  deletion_safe: true` (for `mira-fault-sim`)  

## NOT REVIEWED
- Runtime behavior of any code that consumes `REGISTRY.yaml` (e.g., scripts that generate deployment manifests, dashboards, or automated decision tools). Without access to the consuming code we cannot confirm whether the new fields cause crashes or are ignored gracefully.  
- The impact of the newly added `CU-08.md` on any documentation generation pipeline. If the pipeline expects a specific front‑matter format or certain headings, the file could cause generation errors.  
- Potential security implications of the environment‑variable references (`FAULT_DETECTIVE_URL`, `MIRA_LIVE_DATA_ENABLED`) mentioned in the `blocking_evidence` strings. These are documentation only, but if they are parsed/executed by tooling they could lead to unintended exposure.  
- Any test suite changes: the PR does not modify test code, but it notes that tests for the bench components are not run by CI. The effect of this omission on overall test coverage is not examined here.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
