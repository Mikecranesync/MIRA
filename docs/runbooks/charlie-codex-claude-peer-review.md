# CHARLIE Codex–Claude peer review

**Scope:** CHARLIE only. This runbook does not enroll ALPHA, BRAVO, or any
external host.

## Purpose

Claude implements and remediates FactoryLM Unified UI slices. Codex performs
the independent exact-head review that gates merge. The peer channel carries
fast task updates; the GitHub PR remains the durable source of truth.

## Local topology

- A CHARLIE-local `claude-peers-mcp` broker listens on loopback port `7899`.
- User-scoped Claude and Codex MCP configuration both launch
  `/Users/charlienode/.bun/bin/bun /Users/charlienode/claude-peers-mcp/server.ts`
  with `CLAUDE_PEERS_BROKER_HOST=127.0.0.1` and
  `CLAUDE_PEERS_PORT=7899`.
- Running Claude sessions also expose authenticated native Unix sockets under
  `/tmp/cc-socks/`. Their non-secret discovery records live in
  `~/.claude/sessions/<pid>.json`.
- The active Codex review task exposes a task-scoped receiver name such as
  `codex-ui-review` and sends its Codex task ID to the implementer. Receiver
  names and task IDs are runtime identities, not values to hardcode in Git.

The broker is intentionally local. A remote broker cannot safely use its own
host PID table to decide whether CHARLIE-native Claude processes are alive; that
causes valid CHARLIE registrations to disappear.

## Start and discover

Configuration changes do not hot-reload into already-running Claude or Codex
processes. Start a new session after changing either user MCP configuration.

Read-only health checks:

```bash
claude mcp get claude-peers
codex mcp get claude-peers
lsof -nP -iTCP:7899 -sTCP:LISTEN
jq '{pid,name,status,sessionId,bridgeSessionId,cwd,messagingSocketPath}' \
  ~/.claude/sessions/*.json
```

Never print, copy into a prompt, or commit `~/.claude/sessions/*.key`. Those
files authenticate native-socket messages and must remain readable only by the
local user.

At review start, Codex sends the implementer:

```text
[CODEX-REVIEW-CHANNEL]
Receiver: <runtime receiver name>
Codex task: <runtime task ID>
Repository: Mikecranesync/MIRA
Mission: FACTORYLM-UNIFIED-UI-CUTOVER-001
```

Claude must acknowledge the receiver and send a ping before relying on it.

MCP peer discovery can omit an otherwise healthy native-socket session. In
that case, discover the session from the non-secret JSON record and use the
native `SendMessage` recipient shown in `messagingSocketPath`; do not copy or
expose the adjacent key file. Confirm delivery from the receiving session's
queue/transcript before assuming the message landed.

## Active watch

While implementation is active, monitor both channels. Peer messages show
intent and local test progress; GitHub establishes the reviewable truth.

```bash
gh pr view <number> --repo Mikecranesync/MIRA \
  --json headRefOid,isDraft,state,mergeStateStatus,statusCheckRollup
gh pr diff <number> --repo Mikecranesync/MIRA --name-only
gh pr checks <number> --repo Mikecranesync/MIRA
```

Treat every new `headRefOid` as a new candidate: discard the old verdict,
re-read the complete changed-path list, and wait for the new checks. Keep the
PR draft while review is pending. Green CI never waives a guarded legacy path,
an ownership-lane violation, missing browser/device proof, or a failed Codex
exact-head review. Report meaningful changes only—new SHA, scope change, failed
check, new finding, corrected evidence, or readiness for review.

## Exact-head review packet

Before merge, the implementer sends all of the following to the named Codex
receiver:

```text
[CODEX-REVIEW-REQUEST]
Repository: Mikecranesync/MIRA
PR: https://github.com/Mikecranesync/MIRA/pull/<number>
Base ref: main
Base SHA: <40-character SHA>
Head branch: <branch>
Head SHA: <40-character SHA>
Changed files: <authoritative count plus complete filename/status list,
                including previous_filename for every rename>
Verification: <commands and verbatim outcomes>
Visual evidence: <browser/device screenshots required by the slice>
Known limitations: <explicit list>
```

Codex independently rereads GitHub, checks the immutable commit rather than a
mutable working tree, runs proportionate verification, and reviews required
visual/device evidence. The response names the exact head:

Scope is checked before behavior. New presentation and host work must stay in
the canonical `packages/factorylm-*`, `apps/factorylm-ui-lab/**`, or bounded
`mira-*/src/factorylm-ui/**` roots. The already-connected mobile canonical
surface also includes `mira-mobile/src/unified/**` and the exact
`mira-mobile/src/screens/UnifiedRoot.tsx` and
`mira-mobile/src/screens/UnifiedChat.tsx` hosts; adjacent screens remain
legacy-by-default. Preserved mobile transport conversion may stay in
`mira-mobile/src/chat-adapter/**`. A changed path in a guarded legacy
presentation tree is an automatic hold unless the PR carries the charter's
audited `legacy-ui-exception`. Ordinary feature work never qualifies for that
exception, and importing or copying a legacy presentation into a new path does
not make it canonical.

```text
[CODEX-REVIEW] PASS | CONCERNS | FAIL
Reviewed SHA: <40-character SHA>
Findings: <ordered evidence>
```

Only `PASS` for the current head clears the gate. Any commit, rebase, or force
push invalidates the prior verdict and requires a new packet.

## Lane discipline

All four shared-core roots form one writing lease:

- `packages/factorylm-theme/**`
- `packages/factorylm-interaction/**`
- `packages/factorylm-ui/**`
- `apps/factorylm-ui-lab/**`

Only one shared-core author may edit or pre-stage work at a time. Parallel
read-only review is allowed. A later slice can preserve a draft or patch, but it
does not resume editing until the active claim is `RELEASED` or `COMPLETE`, the
claim namespace has been reread, and its new base is the merged exact head.
Serial merge order alone is not sufficient.

## Failure and fallback

If the peer receiver is absent, stale, unauthenticated, or silent, do not infer
approval. Post the complete packet to the PR as `[CODEX-REVIEW-REQUEST]` and
hold merge. The assigned Codex task posts a durable `[CODEX-REVIEW]` result to
the PR after independent review.

If native peers repeatedly disappear while their processes are still alive,
verify that both clients point to the CHARLIE loopback broker and that no remote
PID-validation broker is deleting the records. Do not weaken socket
authentication as a workaround.
