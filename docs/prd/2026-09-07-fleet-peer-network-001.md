# FLEET-PEER-NETWORK-001

## Durable Peer Development Network for FactoryLM/MIRA

**Status:** Proposed implementation PRD
**Owner:** Mike Harper
**Date:** 2026-09-07
**Product dependency:** FLM-UI-4000
**Implementation type:** Additive development infrastructure; shadow mode first
**Runtime effect at first merge:** None on FactoryLM customers or the current UI

## 1. Decision

FactoryLM development will use a durable network of Claude and Codex sessions across the five named computers. The computers remain peer-capable execution nodes, but **FactoryLM Foreman on the VPS is the single mission controller**.

The controller assigns bounded work, records session identity, grants atomic work claims, prevents overlapping writes, receives handoffs, and dispatches independent review and verification. GitHub remains the durable source of truth for branches, pull requests, claims, evidence and final status.

This network must be introduced beside the active FLM-UI-4000 work. It must not pause, replace, rebase, merge, deploy or broadly refactor the current application work.

## 2. Problem

The current fleet has working connectivity and strong conventions, but coordination is partly manual:

- Claude sees the multi-session rules, while the root Codex `AGENTS.md` is stale.
- Foreman's pure `ForemanPolicy` is not enforced by the live Slack message path.
- Slack threads share one warm Grok context instead of isolated mission contexts.
- event deduplication and session identity are lost when Foreman restarts.
- GitHub `[WORK-CLAIM]` blocks are auditable but not atomic.
- shared `.fleet/TASK.md` and `.fleet/HANDOFF.md` files can be overwritten by unrelated missions.
- only Alpha, Bravo and Charlie are represented in the canonical topology.
- newly spawned sessions have no automatic join, heartbeat, work-request or handoff procedure.

The result is a real risk of duplicate work, stale reviews, crossed mission context, overwritten handoffs and agents modifying the same system simultaneously.

## 3. Goal

Provide continuous, safe development capacity until Mike accepts a sellable FactoryLM release.

A newly spawned Claude or Codex session must be able to discover the network, register itself, request appropriate work, receive an exclusive claim, work in isolation, hand off before context degradation, and exit without colliding with another session.

**24/7 means continuously available and resumable—not continuously making uncontrolled changes.** If no authorized, dependency-ready and unclaimed task exists, workers wait.

## 4. Non-goals

This mission does not:

- redesign or connect the new FactoryLM UI;
- modify `packages/factorylm-*`, `apps/factorylm-ui-lab`, `mira-mobile`, `mira-hub` or `mira-web` during the foundation slices;
- merge or deploy application PRs;
- release HELD work;
- change Gateway, tunnel, Tailscale, Cloudflare or production configuration without a separately approved mission;
- permit Foreman to implement product code;
- create a second GitHub, review, CI or deployment system;
- stop, adopt or delete an unowned session or worktree;
- invent work merely to keep machines busy.

## 5. Team and node roles

Physical node names are computers, never agent personas. Workers are named by provider, session number and node—for example, `Claude Session 2 on Travel`.

| Node | Default role | Allowed work |
|---|---|---|
| VPS / Foreman | Mission controller | Queue, policy, durable state, Slack summaries, scheduling; no product edits |
| Alpha | Integration node | Shared contracts, integration branches, combined gates and release-candidate preparation |
| Bravo | Primary implementation node | Bounded backend, infrastructure and reliability tasks |
| Charlie | Adversarial review node | Read-only Codex review of an exact SHA; development-environment checks |
| Travel laptop | Secondary implementation node | Disjoint infrastructure, UI-supporting tooling, docs and test-harness work |
| PLC laptop | Industrial verifier | PLC, Ignition, Factory I/O, hardware and equipment-context acceptance |

Assignments may change based on capability and availability, but reviewer and verifier must be independent sessions and should use different nodes whenever the task allows it.

## 6. Operating laws

1. One mission controller; many execution peers.
2. One active writer per claimed resource.
3. Every writer uses a dedicated branch and isolated worktree.
4. Every substantial task has one durable mission ID and one canonical PR or issue.
5. Claims are atomic leases, not informal announcements.
6. A session without a valid lease is read-only.
7. Every heartbeat, claim, commit, handoff, verdict and release is recorded as an event.
8. Reviews and verification bind to one immutable 40-character SHA.
9. A changed SHA invalidates every previous approval.
10. Claude implements and remediates; Codex reviews read-only by default.
11. Foreman manages; it never opens a product worktree or commits product code.
12. Merge, production deployment, secrets, protected infrastructure and physical acceptance remain human-gated unless Mike explicitly creates a narrower authorization.

## 7. Architecture

### Durable authority

- **GitHub:** canonical tasks, branches, PRs, review evidence and closeouts.
- **Foreman state store:** SQLite WAL on the VPS, accessible only through the Foreman service. No node mounts the database file directly.
- **Fleet Gateway:** session execution and node communication.
- **Slack:** Mike's command and summary surface, not mission memory.

### Minimum durable records

**nodes** — node ID, hostname, OS, capabilities, availability and last heartbeat.
**sessions** — session UUID, provider, node, mission, state, context budget and last heartbeat.
**work_items** — mission ID, goal, priority, dependencies, acceptance gates, status and authorization.
**claims** — mission, session, base SHA, branch, worktree, resource keys, lease expiry and generation.
**events** — append-only timestamped lifecycle record with an idempotency key.
**artifacts** — commits, PR, handoff, test evidence, reviewed SHA and verdicts.
**human_gates** — merge, deploy, architecture, secret, protected infrastructure and physical-test decisions.

Resource claims use explicit canonical keys such as `packages/factorylm-ui`, `mira-mobile`, `migration:next`, `device:pixel9a`, or `environment:staging`. The controller acquires all requested keys in one transaction or grants none.

## 8. Session lifecycle

### Join

Every new session:

1. reads the root `CLAUDE.md` or `AGENTS.md` pointer to `docs/peer-network/START_HERE.md`;
2. identifies its physical node and provider-generated session ID;
3. calls `join_network` with capabilities and current checkout state;
4. fetches current `origin/main`, open PRs and active claims;
5. calls `request_work` instead of selecting an unclaimed-looking task itself.

### Claim

Foreman returns a proposed mission with exact scope, dependencies, base SHA, tests, out-of-scope paths and human gates. The worker calls `claim_work`. The first transaction to acquire every resource key wins. A losing worker makes no edits and requests different work.

The successful worker creates its isolated worktree and branch, then publishes a matching `[WORK-CLAIM]` on the canonical issue or draft PR. The GitHub record mirrors the controller state; it does not replace the atomic lease.

### Work and heartbeat

- A runner-owned heartbeat renews the session independently of long model/tool calls.
- Default heartbeat interval: 60 seconds.
- Default claim lease: 10 minutes.
- Failure to renew changes the worker to `LEASE_AT_RISK`; it must stop before its next edit or push.
- Foreman never silently reassigns work while branch activity is still occurring.

### Handoff

At 70% context usage, 200 turns, a hard blocker or a human gate, the worker:

1. commits its bounded checkpoint;
2. writes a mission-specific handoff under `docs/missions/<mission-id>/`;
3. reports tests, changed files, HEAD SHA, remaining work and exact resume command;
4. calls `request_handoff`;
5. remains owner until the replacement calls `accept_handoff`.

Acceptance transfers the same claim and increments its generation. It does not create a second mission.

### Review, verification and completion

Implementation stops at a committed SHA. Foreman dispatches:

1. an independent read-only adversarial reviewer;
2. after review PASS, an independent verifier on the same SHA.

Both must PASS on the current SHA. Any new commit clears both verdicts. Completion releases claims and records the next dependency-ready task, but begins it only when standing authorization allows it.

## 9. Controller operations

The eventual Foreman/Gateway contract contains:

```text
join_network
heartbeat
fleet_status
request_work
claim_work
renew_claim
release_claim
submit_checkpoint
request_handoff
accept_handoff
submit_result
request_review
submit_verdict
leave_network
```

Every mutating operation requires a mission ID, session UUID, lease generation and idempotency key. Unknown, stale, foreign or duplicated identities fail closed.

## 10. Integration with active application development

This capability is delivered incrementally:

### Slice A — shared contract and onboarding, no runtime effect

- create `docs/peer-network/START_HERE.md` and the versioned schemas;
- add short pointers to both root `CLAUDE.md` and `AGENTS.md`;
- extend `deployment/network.yml` to represent Travel and PLC without changing networking;
- deprecate global `.fleet/TASK.md` and `.fleet/HANDOFF.md` in favor of mission-specific paths;
- document the application team's current claims without modifying their branches.

### Slice B — Foreman shadow state

- connect the existing `ForemanPolicy` to the live bot;
- persist Slack event deduplication and `thread_ts -> mission_id` mapping;
- create one Grok mission context per Slack thread;
- record decisions in shadow mode while the existing manual workflow remains authoritative.

### Slice C — membership and heartbeat

- register all available nodes and sessions;
- add capability discovery and health states;
- prove restart recovery and reconnect without adopting foreign sessions.

### Slice D — atomic claims and collision refusal

- implement resource-key leases and post-claim verification;
- add startup and pre-push checks;
- prove two simultaneous claims yield exactly one writer.

### Slice E — durable handoff and review orchestration

- implement claim transfer between old and fresh sessions;
- integrate exact-SHA reviewer and verifier records;
- invalidate stale verdicts automatically.

### Slice F — guarded scheduler

- schedule only dependency-ready, authorized and unclaimed work;
- limit concurrent writers by resource and node capacity;
- pause when product gates are red or human action is required;
- expose a concise Slack roster, queue and blocker summary.

Each slice is a separate draft PR and must leave the current app workflow usable. No big-bang cutover is permitted.

## 11. Acceptance criteria

1. A fresh Claude session and a fresh Codex session both discover the protocol before editing.
2. All five computers can be represented even when one is offline.
3. Foreman restart preserves missions, Slack-thread isolation, deduplication and leases.
4. Two sessions racing for one resource produce one winner and one refused worker.
5. Disjoint resource claims can run simultaneously.
6. A session cannot edit or push after losing its lease.
7. A replacement session resumes the same mission and claim generation from a committed handoff.
8. A foreign or unowned session cannot be stopped, adopted or modified.
9. Reviewer and verifier are separate sessions and bind to the exact current SHA.
10. Changing HEAD invalidates both verdicts.
11. Existing FLM-UI-4000 branches and open PRs are untouched by the foundation slices.
12. Disabling the feature flag restores the current manual process without losing GitHub evidence.
13. Slack can report nodes, sessions, claims, queued work, blockers and human gates after a restart.

## 12. Required tests

- hermetic state-store and policy tests;
- Slack event replay and duplicate-delivery tests;
- two-thread context-isolation test;
- simultaneous claim race test;
- lease expiry/renewal and fail-closed tests;
- Foreman restart recovery test;
- node disconnect/reconnect test;
- handoff generation and exact-resume test;
- foreign-session ownership refusal tests;
- exact-SHA review/verifier independence tests;
- UI-path changed-file guard for Slices A–E;
- rollback/shadow-mode test.

## 13. Initial work claim

```text
[WORK-CLAIM]
Slice: FLEET-PEER-NETWORK-001-A — contract and onboarding only
Owner/session: one fresh Claude Code session on Travel laptop
Branch: feat/fleet-peer-network-001a-contract
Worktree: isolated; created from latest origin/main
Expected systems: docs/peer-network, root CLAUDE.md pointer, root AGENTS.md pointer,
deployment/network.yml metadata, mission handoff conventions
Explicitly excluded: packages/factorylm-*, apps/factorylm-ui-lab, mira-mobile,
mira-hub, mira-web, application APIs, databases, deployments, Gateway/tunnels
Status: PROPOSED — claim only after overlap check and post-claim reread
```

## 14. Handoff and review assignment

**Implementer:** one fresh Claude Code session on the Travel laptop, acting as Peer Network Engineer. Start with Slice A only.
**Adversarial reviewer:** a fresh Codex session on Charlie, read-only, bound to the exact Slice A HEAD SHA.
**Verifier:** a separate Claude or Codex session on the PLC laptop. Prove that both Claude and Codex startup instructions discover the network contract without touching application code.
**Integrator:** Alpha combines later slices only after each independent PR is green.
**Foreman:** tracks the dependency sequence and reports status; it must not implement the slices itself.

If Travel is the unavailable fifth computer, assign Slice A to the least-loaded working non-UI Claude session. Do not interrupt an active FLM-UI-4000 session; wait for its committed handoff or choose another node.

## 15. Definition of done

The network is ready for unattended scheduling only after Slices A–F pass, Mike can see the whole roster and queue from Slack, a restart-and-handoff drill succeeds, an intentional collision is refused, and the feature can be disabled without disrupting current development.

Until then, it runs in shadow or advisory mode alongside the existing process.

## 16. Copy/paste dispatch prompt

```text
Take ownership of FLEET-PEER-NETWORK-001 Slice A from the attached PRD. Work as one
fresh Claude Code session on the Travel laptop in an isolated worktree from latest
origin/main. First inspect open PRs and actual changed-file overlap, then publish and
reread the WORK-CLAIM before editing. Implement only the contract/onboarding slice.
Do not touch FLM-UI-4000 product paths, active app branches, Gateway/tunnels, secrets,
deployments or production. Preserve the current manual workflow. Produce one draft PR,
tests or static contract checks, and a mission-specific handoff. Do not merge. Request
a read-only exact-SHA Codex review on Charlie when the branch is ready.
```
