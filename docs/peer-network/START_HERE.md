# Peer development network — START HERE

**Mission:** FLEET-PEER-NETWORK-001 (`../prd/2026-09-07-fleet-peer-network-001.md`, record: issue #3648).
**Status:** Slice A — contract and onboarding. **Advisory / shadow mode.** The existing manual
workflow (`.claude/rules/multi-session-protocol.md`) stays authoritative until Slices B–F pass and
Mike accepts the drill. Nothing here changes runtime behaviour for customers or the current UI.

If you are a new Claude or Codex session in this repository, read this page before you edit
anything. It tells you how to discover the network, say who you are, ask for work, hold an
exclusive claim, work in isolation, hand off before your context degrades, and leave without
colliding with another session.

## 1. One controller, many peers

- **Foreman on the VPS** is the single mission controller (queue, policy, durable state, Slack
  summaries). It never implements product code. Until Slice B lands it is in **shadow mode**:
  the durable authority is GitHub — the canonical issue or draft PR for the mission.
- The five computers are execution peers. **Nodes are computers, never personas.** A worker is
  named by provider, session number and node: `Claude Session 2 on Travel`.

| Node | Default role (not a permission) | Typical work | Must actually hold |
|---|---|---|---|
| VPS / Foreman | mission controller | queue, policy, state, Slack, scheduling | — (no product edits) |
| Alpha | integration | shared contracts, integration branches, combined gates, RC prep | bash, git, gh, write |
| Bravo | primary implementation | bounded backend / infra / reliability | bash, git, gh, write |
| Charlie | adversarial review | read-only Codex review of an exact SHA; dev-environment checks | codex-cli; gates need bash, git, gh |
| Travel laptop | secondary implementation | disjoint infra, UI-supporting tooling, docs, test harness | bash, git, gh, write |
| PLC laptop | industrial verifier | PLC, Ignition, Factory I/O, hardware acceptance | plc, ignition, factory-io |

**A default role is a routing hint, not a permission.** Law 10 decides who implements and who
reviews (Claude implements and remediates; Codex reviews read-only); a node's sessions may take any
lane their tools cover — a Claude session on Charlie can implement, a Codex session on Bravo can
review — as long as reviewer and verifier stay independent of the implementer.

**Available is not equipped.** A session that lacks Bash, git, gh or file-write tools cannot own
an implementation slice, however idle it is. Say so when dispatched to; the dispatcher falls back
(PRD §14). Node metadata lives in `deployment/network.yml` (`peer_network` keys); the shape is
`schemas/node.schema.json`.

## 2. The twelve operating laws (PRD §6)

1. One mission controller; many execution peers.
2. One active writer per claimed resource.
3. Every writer uses a dedicated branch and an isolated worktree.
4. Every substantial task has one durable mission ID and one canonical PR or issue.
5. Claims are atomic leases, not announcements.
6. A session without a valid lease is read-only.
7. Every heartbeat, claim, commit, handoff, verdict and release is recorded as an event.
8. Reviews and verification bind to one immutable 40-character SHA.
9. A changed SHA invalidates every previous approval.
10. Claude implements and remediates; Codex reviews read-only by default.
11. Foreman manages; it never opens a product worktree or commits product code.
12. Merge, production deploy, secrets, protected infrastructure and physical acceptance are
    human-gated unless Mike creates a narrower authorization.

## 3. Session lifecycle — manual (shadow) procedure for v1

Each step names the future Foreman operation it stands in for (`schemas/README.md`).

**Join** (`join_network`)
1. Read this page. Identify your physical node and your provider session id.
2. `git fetch --all`; `gh pr list --state open --limit 60`; read the open `[WORK-CLAIM]` blocks on
   mission issues and draft PRs. Note the tools you hold (see §1).

**Request work** (`request_work`)
3. Do **not** pick an unclaimed-looking task yourself. Ask the dispatcher (today: the session that
   holds the mission record; later: Foreman) or take the next `PROPOSED` slice on the mission
   record whose dependencies are met and whose authorization is standing.

**Claim** (`claim_work`)
4. Post a `[WORK-CLAIM]` block (`.claude/rules/multi-session-protocol.md` §2) on the canonical
   issue/PR with `Status: ACTIVE`, **`Claimed at: <UTC ISO-8601>`**, the base SHA, branch, worktree
   and the **resource keys** you need (`schemas/claim.schema.json`). Claim states: `ACTIVE` (held, working), `BLOCKED` (held, waiting on a human gate or
   dependency), `LEASE_AT_RISK` (renewal missed — stop before the next edit or push), `RELEASED`,
   `COMPLETE`. **Wait at least 60 seconds,
   then re-read the whole thread** (a settling interval, so two near-simultaneous posts both see
   each other). The ACTIVE claim with the earliest `claimed_at` overlapping your keys wins; the
   comment's own creation time is only a tiebreak — never the ordering key, because editing a
   comment keeps its creation timestamp. If you lost, set yours to `RELEASED` and make no edits.
5. Only then create the worktree (detached from `origin/main`, never holding `main`) and the
   branch. Publish the branch early.

**Work and heartbeat** (`heartbeat`, `renew_claim`, `submit_checkpoint`)
6. Renew by activity: a push, or a `Last updated:` bump on the claim, at least every 60 minutes.
   Silence for 24 h on both the claim and the branch makes the claim stale (protocol §2). If you
   cannot renew, stop before your next edit or push (`LEASE_AT_RISK`).

**Handoff** (`request_handoff` → `accept_handoff`)
7. At ~70 % context, 200 turns, a hard blocker or a human gate: commit the checkpoint, write
   `docs/missions/<MISSION-ID>/HANDOFF.md` (tests, changed files, HEAD SHA, remaining work, exact
   resume command), post a `request_handoff` comment on the record, and **stay owner** until the
   replacement posts `accept_handoff`. Acceptance transfers the same claim and increments its
   `generation`; it never creates a second mission.

**Review and verification** (`request_review`, `submit_verdict`)
8. Implementation stops at a committed, pushed SHA. Send the **40-character** SHA and the full
   changed-path list to the reviewer (Codex on Charlie, read-only) and then to a separate verifier
   session (different node when the task allows). Both must PASS on the current SHA; any new
   commit voids both.

**Leave** (`release_claim`, `leave_network`)
9. Set the claim to `COMPLETE` or `RELEASED`, remove your worktree, post the session closeout
   (protocol §9).

**Rule for every record:** a field that carries an authority claim — a SHA, a verdict, a gate
decision, a lease state — needs a pattern or an enum, never prose. `claim.base_sha`,
`artifact.sha`, `claim.status` and the per-kind `event.payload` proofs are the examples; a verdict
that names no 40-character SHA is invalid by schema, not merely discouraged.

## 4. Resource keys

Claims name explicit canonical keys and acquire all of them or none:
`packages/factorylm-ui` · `packages/factorylm-theme` · `apps/factorylm-ui-lab` · `mira-mobile` ·
`mira-hub` · `mira-web` · `migration:next` · `device:pixel9a` · `environment:staging` ·
`environment:prod` · `root:CLAUDE.md` · `root:AGENTS.md` · `docs/<path>` · `deployment/<path>`.
Pattern in `schemas/claim.schema.json`. Two claims with disjoint keys may run at once.

## 5. Human gates

Merge, production deployment, secrets, Gateway/tunnel/Tailscale/Cloudflare changes, physical
tests. Record them as `human_gate` records (today: a comment naming the gate and who decided).
Whenever a required gate is incomplete, report **PARTIAL** or **BLOCKED** — never green.

## 6. Missions, handoffs and the `.fleet/` notice

New missions keep their files under `docs/missions/<MISSION-ID>/` (`../missions/README.md`).
The global `.fleet/TASK.md` and `.fleet/HANDOFF.md` are **deprecated for new missions**: they were
overwritten by unrelated missions. **Do not add new files under `.fleet/` from a branch created
after this page merges.** Exempt: every branch that already had `.fleet/` files in flight before
that merge — the FLEET-PRD-P1 set (#3549–#3554, #3558), BOOTSTRAP-001 (#3533) and
`docs/pixel-acceptance-and-merge-plan` — which keep theirs until they close; nothing is moved.
For new branches the rule is enforced by the devops path gate (check 4a: no added files under
`.fleet/`), not remembered.

## 7. Root pointers — status gate

Root `CLAUDE.md` and `AGENTS.md` get a short pointer to this page so every new Claude and Codex
session discovers the contract (PRD §8 step 1). Those two files are inside an active claim
(#3626, five open PRs), so the pointers land **only after #3647 merges**, on a rebase of this
branch. `pointers.status` holds the state: `pending:#3647` now, `landed` afterwards.
`tests/peer_network/test_contract.py` fails if the pointers appear while pending **and** if they
are missing once landed — the dependency is enforced, not remembered. The suite runs inside the
gated `test-unit` job of `ci.yml` (the `tests/` sweep in `test-eval-offline` is advisory — it is
not in `ci-gate`'s `needs:` — so a step there could go red and merge anyway).

## 8. Feature flag and rollback

`FLEET_PEER_NETWORK_ENABLED` (default `0`, read by Foreman from Slice B on). With it off, the
manual protocol above is the whole process and every GitHub record stays valid — disabling the
network loses no evidence (PRD acceptance #12).

## 9. What this slice does not do

No Foreman code, no Slack changes, no Gateway/tunnel/Tailscale/Cloudflare changes, no product
paths (`packages/factorylm-*`, `apps/factorylm-ui-lab`, `mira-mobile`, `mira-hub`, `mira-web`),
no merges, no deploys. Slice B (Foreman shadow state) is the next dependency-ready item on #3648.
