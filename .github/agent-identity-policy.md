# Agent identity policy

This repository is worked on from multiple machines and by multiple agent runtimes. GitHub attributes commits and comments to the account or token used, not to the local runtime, so every substantial GitHub-backed work item must carry explicit agent metadata.

## Required identity

Use this format everywhere a session claims or hands off work:

```text
Agent-Identity: <agent>/<machine>/<session-id>
Agent-Role: implementation | review | triage
Human-Owner: @github-handle
```

Examples:

```text
Agent-Identity: codex/charlie/2026-08-18-pr3302
Agent-Role: review
Human-Owner: @mikecranesync
```

Agent, machine, and session values must be lowercase and contain only letters, digits, `.`, `_`, or `-`.

## Role boundary

The repository-wide multi-session protocol remains authoritative:

- Claude implements and remediates.
- Codex reviews read-only and records evidence-backed findings.
- Hermes and other agents must declare their actual role; they may not silently impersonate Claude or Codex.
- A human owner authorizes merge, deploy, migration, secret, and destructive actions.
- Codex may implement a governance-only identity/enforcement change only when the PR body records `Human-Authorization: @github-handle ...`; this is an explicit exception, not a change to the default Codex review-only role.

The validator rejects `Agent-Role: implementation` for a `codex/...` identity. Changing that boundary requires a separate governance change.

## Where metadata is required

- Work-claim issue or canonical PR: all three fields.
- PR body: all three fields.
- A Codex implementation exception: add `Human-Authorization: @github-handle <explicit authorization>` to the PR body.
- Every commit introduced by a PR: `Agent-Identity` and `Agent-Role` Git trailers.
- Review, handoff, and session-closeout comments: all three fields when the comment changes ownership or status.

## Enforcement and limits

`.github/workflows/agent-identity.yml` validates PR bodies and all commits in the PR range. Repository administrators must make the `agent-identity` check required in branch protection before treating this as a hard merge gate.

Issue forms and templates provide the same fields for work claims, but GitHub does not offer a universal pre-receive hook for arbitrary issue comments or every API write. This policy is therefore durable attribution plus required PR enforcement, not cryptographic proof of which local process typed a command.

Existing history is grandfathered. New PRs and commits must comply once the branch-protection check is enabled.
