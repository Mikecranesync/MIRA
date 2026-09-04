# AUTONOMOUS-FOREMAN-V1 — Foreman Management Loop

**Mission ID:** `AUTONOMOUS-FOREMAN-V1`  
**Issue:** https://github.com/Mikecranesync/MIRA/issues/3566  
**Base SHA:** `d16faa5ed000a22319cf45688aff3293a0c1db6f`  
**Branch:** `fleet/AUTONOMOUS-FOREMAN-V1`  
**Manager:** FactoryLM Foreman (Grok in Slack) — not the implementer  
**Implementer:** exactly one Claude session on physical Bravo  
**Reviewer:** exactly one Codex session on physical Charlie, of an exact Git SHA  
**Outcome:** isolated branch + Draft PR. Do not merge. Do not deploy.

## Purpose

Encode the Foreman autonomous management loop as durable, testable policy.
Foreman inspects GitHub, ranks live risk, waits for Mike on human gates,
dispatches one implementer, collects GitHub evidence, sends the exact PR head
SHA to Charlie/Codex for independent review, and returns GO/NO-GO.

Slack is not the source of truth. Mission state is serialized to `docs/missions/`.

## Loop

1. Inspect GitHub (issues, HELD/draft PRs, CI/canaries) — no secrets printed.
2. Rank unfinished / live-risk work. Do not invent work to keep workers busy.
3. Stop for Mike on: merge, deploy, secrets, Gateway/tunnels, HELD-PR release.
4. On explicit mission dispatch: one implementation worker (`isolated_worktree=true`).
5. Collect proof on GitHub (commits, draft PR, handoff artifact).
6. Independent Codex review on Charlie of the exact head SHA (not a Bravo summary).
7. If review fails: stop the reviewer, relaunch one Bravo Claude fix, then re-review the new SHA.
8. Never merge or deploy. Return GO/NO-GO.

## Acceptance Criteria

### A. Manager ≠ implementer

Foreman policy must not open an implementation worktree, edit product files,
or commit. Dispatching a worker is allowed; doing the worker's job is not.

### B. Max one implementation worker

Attempting to launch a second implementation worker while one is `running`
must be refused. Reviewers do not count as implementation workers. After the
implementer is `stopped`, a new implementer for a fix round is allowed.

### C. Charlie reviews an exact SHA

Review dispatch requires `git_ref` = a 40-char commit SHA. A branch name,
`origin/main`, or a Bravo prose summary is **invalid**. Reviewer role is
Charlie; provider is Codex.

### D. No merge / no deploy

Policy must refuse `merge`, `deploy`, `gh pr merge`, `deploy-vps`, and VPS
compose/restart. Tests prove refusal.

### E. HELD stays HELD

PRs #3533 and #3558 (and any PR titled/held HELD) must not be merged,
undrafted-for-merge, or deployed by this loop.

### F. Hard boundaries

Refuse: Gateway config/restart, Cloudflare/Tailscale/tunnels, Doppler/secret
copy or print, paying vendor bills, stopping unowned sessions, deleting
unowned worktrees.

### G. GitHub is source of truth

Mission state (mission id, base SHA, implementer session, head SHA, reviewer
session, verdicts, GO/NO-GO) must be serializable to a durable artifact under
`docs/missions/` that a restarted Foreman can read. Slack-only state is a fail.

### H. GO/NO-GO shape

Terminal recommendation is exactly one of `GO` or `NO-GO` plus: PR URL,
exact SHA, reviewer verdict, verifier verdict, what Mike would merge (nothing auto-merged),
remaining human gates.

**GO requires:**
- Reviewer verdict == PASS
- Verifier verdict == PASS (independent acceptance required — absent Verifier is NO-GO, Mike decision 2026-09-04)
- Both bound to the exact head SHA
- head_sha is a valid 40-char exact SHA
- pr_url is set

**Anything else is NO-GO.**

### I. Isolation

Implementer uses branch `fleet/AUTONOMOUS-FOREMAN-V1` from the recorded base
SHA, in an isolated worktree. Draft PR only.

### J. Tests

Offline tests cover A–H. `ruff` passes on all touched Python.

## Implementation

- `mira-bots/foreman/mission_loop.py` — pure policy (no Slack, no Doppler, no Gateway HTTP)
- `mira-bots/foreman/test_mission_loop.py` — hermetic tests for AC A–H
- `docs/missions/AUTONOMOUS-FOREMAN-V1.HANDOFF.md` — durable handoff artifact

## Human Gates (unchanged by this mission)

- Merge the Draft PR: human only via `gh pr merge` after review passes.
- Deploy: `deploy-vps.yml` after smoke tests pass. Human-gated.
- HELD PRs #3533 / #3558: HELD status may only be changed by Mike.
