# Exact-Head Lifecycle Attestation Design

**Status:** Owner-approved direction; implementation pending plan and exact-head review

**Owner decision:** retire the manual `legacy-ui-exception` label route

**Primary PR:** #3847

**Downstream blocked PR:** #3919

## Problem

The Unified UI Lifecycle Guard correctly freezes legacy presentation and
governed control-plane paths, but its authorization mechanism requires a fresh
maintainer application of the `legacy-ui-exception` label. That click is not the
safety property. The safety property is a fail-closed, durable, independent
review of the current immutable candidate.

The repository already has that durable review ledger:
`scripts/adversarial-review.sh` posts a structured
`[CODEX-ADVERSARIAL-REVIEW]` verdict to the PR. PR #3847 implemented a second
guard route that accepts an exact-head `GREEN`, but it stalled before merge and
retained the manual label as a fallback. Consequently `main` still runs the old
label-only guard and release-hardening PR #3919 is blocked by a rule the owner
directed the project to retire.

## Decision

The Lifecycle Guard remains fail closed, but the Codex adversarial-review ledger
becomes its only authorization route for guarded changes. The
`legacy-ui-exception` label, its transient label-event approval logic, and its
documentation are removed.

This is not removal of the guard and is not permission to expand frozen legacy
UI. It replaces a manual transport mechanism with exact-candidate evidence.

## Alternatives Considered

### Keep PR #3847 unchanged

Routine migration work could pass with an exact-head GREEN, while architectural
or control-plane changes would still require the label. This does not satisfy
the owner decision and would leave #3919 blocked on the obsolete path.

### Delete or bypass the Lifecycle Guard

This would remove the freeze rather than improve its attestation. It is rejected
because a PR could add or expand a frozen surface without review.

### Exact-head ledger as the sole route

This is the selected design. It reuses the repository's existing, round-capped,
durable review mechanism and retains fail-closed behavior when evidence is
absent, stale, malformed, or negative.

## Guard Contract

For a PR that touches no guarded path, the guard passes without an attestation.

For a PR that touches one or more guarded legacy or control-plane paths, all of
the following are required:

1. A substantive `## Lifecycle guard rationale` PR-body section with:
   `Reason:`, `Canonical replacement impact:`, and `Rollback:`.
2. A newest applicable `[CODEX-ADVERSARIAL-REVIEW]` ledger verdict whose
   `reviewed_sha` equals the current 40-character PR head SHA.
3. A ledger body digest whose `reviewed_body_sha256` equals the SHA-256 digest of
   the current PR body after normalizing GitHub's null body to the empty string.
4. `status: GREEN` on that exact head and body.
5. A well-formed owner-account `User` comment. Bot and foreign-account comments
   do not grant or revoke authorization.

The body digest preserves the old guard's important body-snapshot property:
editing the rationale after review makes the verdict stale even when the code
head does not move.

The newest well-formed owner ledger entry decides. A later `ISSUES_FOUND`
verdict for the same head/body revokes an earlier GREEN. A push, body edit,
missing digest, malformed security-bearing field, missing ledger, or API/read
failure blocks the guarded PR.

## Review Policy

The adversarial-review prompt must continue to classify new or expanded frozen
legacy presentation as a blocker. Migration, removal, canonical adapters,
narrow corrections, and reviewed control-plane changes may reach GREEN when the
reviewer finds no substantive defect.

Changes to the Lifecycle Guard itself are no longer impossible to authorize
without the retired label. They require the same exact-head/body GREEN, the full
guard self-test suite, workflow validation, and an explicit owner integration
decision. The owner decision authorizes integration; it does not replace the
ledger evidence.

## Workflow Behavior

The trusted `pull_request_target` workflow continues to:

- fetch current PR metadata and changed files before checkout;
- check out only the trusted base revision;
- fetch issue comments as data;
- evaluate the trusted-base guard implementation;
- post `Legacy UI Lifecycle Guard` status to the current head SHA.

The workflow no longer fetches approver permission data and no longer interprets
`labeled` or `unlabeled` as authorization events. Those trigger types may be
removed. `edited` and `synchronize` remain important because they invalidate the
body or head binding.

Because posting a comment does not trigger `pull_request_target`, a verified
GREEN continues to rerun the latest lifecycle-guard workflow for that head. A
rerun failure is reported and leaves the status blocked; it never changes the
review verdict.

## Repository Cleanup

The implementation removes:

- `load_exception_approval` and `ExceptionApproval`;
- label-file and approver-event CLI inputs used only by that route;
- `legacy-ui-exception` parsing and failure messages;
- label instructions from the PR template, charter, Claude rule, and review
  documentation;
- label-route tests and fixtures.

The implementation renames the substantive PR-body section and updates all
tests and documentation atomically. After the replacement is merged and a live
positive/negative control proves it, the repository label itself is deleted.

The status context name is retained to avoid an unrelated branch-protection or
dashboard migration in this change.

## Trust Boundary

The exact-head ledger and the old label currently use the same owner credential,
so both are policy-protected rather than mechanically independent. This change
does not claim to close issue #3657's source-authentic status identity gap.

The replacement is still preferable operationally: the accepted evidence names
the reviewed code and body, carries a verdict, fails stale by construction, and
is produced by the bounded review workflow rather than an unexplained label
click. A future distinct reviewer identity can strengthen the same ledger
contract without reintroducing the manual label.

## Bootstrap and Rollout

1. Rebase #3847 onto the frozen current `main` while preserving its existing
   implementation and tests.
2. Add failing tests for sole-route behavior and body-digest invalidation.
3. Remove the label route and update the ledger producer/consumer minimally.
4. Run the full lifecycle-guard suite, actionlint, shellcheck, focused ledger
   tests, diff checks, and required repository CI.
5. Obtain a fresh independent verdict on the exact #3847 head.
6. Integrate #3847 under the owner's explicit governance decision. The old
   advisory guard is expected to remain red on this bootstrap PR; no label is
   applied.
7. Prove the new route on a real guarded PR: absent ledger is red, exact-head/body
   GREEN becomes green, body edit becomes red, and fresh GREEN restores green.
8. Delete the `legacy-ui-exception` repository label.
9. Rebase or otherwise refresh #3919 onto the new `main`, update its rationale
   heading, and rerun its complete exact-head review and CI.
10. Merge #3919 only after those gates pass. No staging or production deployment
    is authorized by this design.

## Acceptance Criteria

- No production guard code, workflow, template, or governing documentation uses
  `legacy-ui-exception` as an authorization mechanism.
- A guarded PR without a valid exact-head/body GREEN fails with actionable
  output.
- A valid exact-head/body GREEN passes the guarded PR without any label action.
- A new commit or PR-body edit invalidates the prior GREEN.
- A newer issues-found verdict overrides an older GREEN.
- Foreign users, bots, malformed comments, API failures, and truncated comment
  data fail closed or are ignored without granting access.
- Unguarded PR behavior is unchanged.
- The guard's trusted-base execution and separate status-posting job remain
  intact.
- #3919 is not merged until it is refreshed and reviewed after this governance
  change.
- No deploy, migration, secret, environment, OTA, or device action occurs as
  part of this work.

## Rollback

Revert the governance merge commit to restore the previous label-based guard
code. Recreate the deleted repository label only if the reverted guard must be
operated before a corrected replacement lands. No application data, schema,
environment, or deployed service is changed by this governance work.
