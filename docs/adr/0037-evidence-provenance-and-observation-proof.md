# ADR-0037 — Evidence provenance and observation proof

**Status:** Proposed — awaiting Mike
**Date:** 2026-09-24
**Supersedes:** nothing. **Extends:** the Capability Closure Registry (ADR-adjacent tooling, `tools/capability_closure.py`).

## Context

Two defects in recent work were green, or red, for reasons that had nothing to
do with the product:

1. A release acceptance harness queried `/api/observability/turns/`, a route
   that does not exist. A follow-up revision queried a real route with an
   identifier that could never match it — `decision_traces.turn_id` holds
   `equipment_notebook_turns.id`, while the only identifier an external caller
   holds is `client_request_id`. Every packet assertion would have failed, and
   the failure would have been recorded against MIRA.
2. A guard enumerated the Unicode characters that had been *observed* rather
   than closing the category, so it passed against its own examples and nothing
   else.

Neither was a coding error in the ordinary sense. Both were **correct-looking
implementations of an incorrect assumption**, and in both cases the test could
not distinguish "the product is broken" from "I cannot see the product".

The Capability Closure Registry already asks the right structural questions —
is this connected, CI-exercised, enabled, rolled back? — and already refuses a
capability whose declared CI job does not exist or whose evidence path is
missing. What it could not ask is whether the evidence *means* anything:
`evidence:` was a path plus prose. Prose saying "Hub deployed at main fb60a0102"
was never checked against git, never expired when the code moved, and never
recorded whether the mechanism that produced the observation had been shown to
work.

## Decision

Extend the existing registry. Do **not** add a second source of truth.

`evidence[].provenance` is introduced and validated by
`tools/evidence_provenance.py`, called from `tools/capability_closure.py`'s
single `validate()` so the registry keeps one validator, one CI job
(`capability-closure`, already in `ci-gate`'s `needs`) and one exit code.

A provenance block records:

| field | why it is mechanically checked |
|---|---|
| `commit_sha` | resolved with `git cat-file -e <sha>^{commit}`. A mistyped or force-pushed SHA is not provenance. |
| `environment` | from a closed set. `emulator` and `device` are **distinct** — collapsing them is how emulator evidence silently satisfies a physical-device requirement. |
| `outcome` | `pass` / `fail` / `inconclusive`. |
| `falsified_by` | the experiment that would disprove the claim. |
| `observation.positive_control` / `.negative_control` | both required, and both must resolve to real files. |

Four rules follow, and each is the direct answer to a real failure:

- **`observation_unproven`** — no PASS or product FAIL may rest on a path that
  has not shown a known-good and a known-bad control.
- **`evidence_inconclusive_as_proof`** — an observation that established nothing
  cannot support an enabled state. Inability to observe is not a product verdict
  in either direction.
- **`evidence_stale_for_code`** — when a capability declares `code_paths`,
  evidence expires against the tree rather than the calendar: if those paths
  moved since `commit_sha`, the proof is of a different program.
- **`provenance_sha_unknown`** — evidence that cannot be located in history
  cannot be reproduced.

### Not retroactive, deliberately

`meta.provenance_enforced_from` is an ISO date. Evidence `observed_at` on or
after it must carry provenance; older records are untouched. Failing every
historical record would either turn `main` red or invite a blanket
acknowledgement, and **a rule everyone silences is not a rule**. The date moves
forward deliberately.

### Fails open where the fault is environmental

`commit_exists` returns `True` when git itself is unavailable. A missing binary
is an environment fault, and reporting it as "this SHA is fabricated" would
reproduce exactly the product-vs-observation confusion this ADR exists to
remove. That behaviour is asserted by a test.

## Alternatives rejected

- **A new "evidence registry" / release-train file.** Rejected under
  search-before-build. `RELEASE_TRAIN.yaml` is referenced in planning prose but
  **does not exist anywhere in this repository** — no file, no content match.
  Creating one would have added a second closure authority beside
  `CAPABILITY_CLOSURE.yaml`.
- **A separate CI job.** Rejected: a separate job implies a separate source of
  truth about closure. The checks run inside `capability-closure`.
- **Free-text "verified by" notes.** That is the status quo, and it is what
  failed.
- **Blocking every capability until it has provenance.** Rejected as above; it
  optimises for looking strict rather than being enforced.

## Consequences

- Evidence for enabled capabilities dated on/after the cutover must name a
  falsifier and two controls. That is more work per claim, on purpose.
- `review_by` on registry records already fails `CI Gate` repo-wide when it
  expires; this ADR adds one more record carrying that obligation
  (`2026-12-31`).
- The checks are pure functions over a parsed registry, so they are cheap and
  hermetic; the only I/O is `git`.

## Evidence for this ADR

`tests/test_evidence_provenance.py` — 21 rule tests, each asserted in both
directions. Mutation-tested rather than assumed: gutting the control check,
letting `inconclusive` count as proof, and removing the SHA check each turn the
suite red; restoring each turns it green. Live negative controls against the
**real** registry: a fabricated `commit_sha` and a control pointing at a
non-existent file each make `tools/capability_closure.py` exit 1, and the
restored registry exits 0.

## What this does NOT do

It does not observe anything by itself. It constrains what may be *claimed*. A
capability can still be wrong; what it can no longer be is unfalsifiable,
undated, or proven by a mechanism nobody ever checked.
