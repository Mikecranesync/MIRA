# Exact-Head Review Concurrency Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four final-review concurrency defects that currently block publication of PR #3847 without weakening the durable three-round budget, exact-body evidence, or privileged-remediation boundary.

**Architecture:** Treat the GitHub comment ledger as one ordered stream. A FULL reservation acquires a slot only when the number of already-consumed review/reservation slots before its immutable comment ID is below three, and reservation ownership is scoped to an exact-snapshot review epoch so a later return to body A can reserve again after body B was reviewed. Give every runner invocation a strict random artifact token, key every load-bearing local artifact by head, body digest, and token, and emit a machine-readable result artifact that the remediation loop uses as the sole source of the runner-captured snapshot and review artifact.

**Tech Stack:** Bash, Node.js ESM, Python 3.12, pytest.

**Spec:** `docs/superpowers/specs/2026-09-20-exact-head-lifecycle-attestation-design.md`

## Global Constraints

- Work only in `/Users/charlienode/MIRA-worktrees/legacy-gate-codex-attest` on `feat/legacy-ui-gate-codex-attestation`.
- Preserve trusted-base execution, tokenless guard evaluation, owner-`User` and numeric-comment-ID review trust, exact head/body binding, dry-run zero remote writes, and fail-closed behavior.
- The global autonomous budget remains exactly three durable FULL rounds across all heads and bodies. Completed rounds count once; crashed canonical FULL reservations remain charged; `review_only` reservations do not consume autonomous slots.
- A reservation is canonical only within its exact `(head_sha, body_sha256)` review epoch. A body A review, then body B review, then return to body A must permit one fresh body-A reservation without refunding either earlier round.
- No load-bearing prompt, envelope, Codex log, changed-file list, rendered review comment, reservation metadata, remediation prompt, or Claude log may be shared by concurrent invocations at the same head.
- Privileged remediation must consume only the exact runner-captured `(head_sha, body_sha256, run_id, reservation_comment_id, rendered review artifact)` tuple. The loop's pre-call snapshot is advisory and must never select the review artifact or authorize remediation.
- Make production changes test-first and preserve RED and GREEN command output in the task report.
- Do not push, edit PR #3847, post comments, rerun workflows, merge, delete labels, deploy, migrate, mutate secrets/environment, or touch devices in this task.

---

### Task 1: Make budget acquisition, artifact handoff, and remediation snapshot binding atomic

**Files:**

- Modify: `tests/test_adversarial_review_scripts.py`
- Modify: `scripts/adversarial-review-ledger.mjs`
- Modify: `scripts/adversarial-review.sh`
- Modify: `scripts/adversarial-review-loop.sh`
- Modify: `docs/adversarial-review-workflow.md`

**Interfaces:**

- Ledger output adds `consumed_before_mine: N`. It is computed from validated review records plus unmatched canonical FULL reservations whose numeric comment IDs precede the caller's reservation. Security consumers must use this field instead of `canonical_full_before_mine`.
- V2 canonical reservation identity is `(head_sha, body_sha256, review_epoch)`, where `review_epoch` is the newest validated review comment ID preceding the reservation, or `0` if none. The earliest numeric reservation comment in that identity wins.
- A validated review completes at most one earlier canonical FULL reservation. Prefer its strict `run_id` binding; for compatibility with older review records lacking `run_id`, match the earliest unmatched compatible reservation preceding that review. Every other unmatched canonical FULL reservation remains charged as crashed.
- Runner environment `ADV_REVIEW_ARTIFACT_TOKEN`, when supplied, must be exactly 32 lowercase hexadecimal characters. Otherwise the runner generates a fresh 128-bit token. The artifact key is `<head_sha>-<body_sha256>-<token>`.
- Runner writes `result-<pr>-<token>.json` only after it has a validated rendered review artifact. The JSON contains exact `head_sha`, `body_sha256`, `run_id`, numeric `reservation_comment_id`, `mode`, and `review_artifact`. The review artifact path must be the invocation-unique rendered comment file.
- The loop generates and passes the token, reads the result JSON after the runner returns, validates every field, recomputes the expected review-artifact path, and uses the result snapshot for all pre-remediation checks and ledger queries.

- [ ] **Step 1: Add the four RED behavior locks.**

Add focused tests which prove:

1. Three pre-existing validated reviews plus a new canonical FULL reservation produce `consumed_before_mine == 3` even when `canonical_full_before_mine` would be lower.
2. With two rounds already consumed, concurrent FULL reservations for two different bodies at one head result in exactly one Codex run; the later reservation fails acquisition because its ordered prefix already consumes three slots.
3. Body A reservation/review, body B reservation/review, then a new body A reservation makes the last reservation canonical, reports `consumed_before_mine == 2`, and brings total `consumed` to three.
4. A loop whose pre-call snapshot is body A but whose runner captures body B and whose post-review snapshot returns to body A launches zero Claude remediations and never reads a head-only review artifact.

Extend the existing artifact test to run two same-head, different-body invocations and assert distinct prompt, envelope, Codex-log, changed-file, rendered-comment, reservation-result, remediation-prompt, and Claude-log paths. Assert each rendered review digest matches the exact body artifact supplied to that invocation.

- [ ] **Step 2: Run the focused selection and confirm RED for the intended missing contracts.**

Run:

```bash
/opt/homebrew/bin/python3.12 -m pytest tests/test_adversarial_review_scripts.py -q \
  -k 'consumed_before_mine or different_bodies_compete_for_last_slot or body_a_body_b_body_a or runner_snapshot_controls_remediation or invocation_unique_artifacts'
```

Expected: failures because the ledger exposes only reservation ordering, old snapshot reservations remain canonical forever, artifact names are head-only, and the loop selects artifacts from its pre-call snapshot.

- [ ] **Step 3: Implement ordered budget accounting and review epochs.**

Keep each validated review's immutable numeric comment ID and optional strict `run_id`. Assign each reservation the latest validated review ID preceding it, canonicalize by exact snapshot plus that epoch, and compute budget usage as unique validated review rounds plus canonical FULL reservations not completed by one compatible later review. For `--run-id`, compute `consumed_before_mine` over only validated comments with IDs lower than `mine_comment_id`. Do not use timestamps or array position as authority.

Update both runner acquisition and loop pre-privileged recheck to require:

```javascript
j.mine_found === 1 &&
j.mine_is_canonical_for_its_snapshot === 1 &&
j.canonical_run_id_for_snapshot === runId &&
j.consumed_before_mine < 3
```

- [ ] **Step 4: Implement invocation-unique artifacts and the result handoff.**

Use the strict token in every load-bearing artifact name. Write the result JSON with mode `0600` via a temporary sibling followed by atomic rename. In the loop, reject a missing, malformed, cross-token, wrong-mode, wrong-head/body, wrong-run-ID, nonnumeric-reservation-ID, or unexpected review-artifact path before launching Claude.

Bind remediation prompt and Claude log names to the same artifact key. Replace the loop's use of `PRE_SHA`, `PRE_BODY_SHA256`, and `comment-<pr>-<head>.md` for authorization with the validated result fields. A snapshot mismatch skips or stops stale remediation fail-closed; it never falls back to another local artifact.

- [ ] **Step 5: Run focused GREEN, then the complete review-script suite.**

Run:

```bash
/opt/homebrew/bin/python3.12 -m pytest tests/test_adversarial_review_scripts.py -q \
  -k 'consumed_before_mine or different_bodies_compete_for_last_slot or body_a_body_b_body_a or runner_snapshot_controls_remediation or invocation_unique_artifacts'
/opt/homebrew/bin/python3.12 -m pytest tests/test_adversarial_review_scripts.py -q
```

Expected: the focused regressions pass, then the complete file passes with no failures.

- [ ] **Step 6: Run script/static verification and commit.**

Run:

```bash
bash -n scripts/adversarial-review.sh scripts/adversarial-review-loop.sh
shellcheck scripts/adversarial-review.sh scripts/adversarial-review-loop.sh
ruff check tests/test_adversarial_review_scripts.py
git diff --check
```

Update `docs/adversarial-review-workflow.md` to describe ordered mixed-stream acquisition, exact-snapshot review epochs, invocation-unique artifacts, and the runner-result handoff. Then commit:

```bash
git add tests/test_adversarial_review_scripts.py scripts/adversarial-review-ledger.mjs \
  scripts/adversarial-review.sh scripts/adversarial-review-loop.sh \
  docs/adversarial-review-workflow.md \
  docs/superpowers/plans/2026-09-21-exact-head-review-concurrency-remediation.md
git commit -m "fix(review): make exact-snapshot rounds concurrency safe"
```

