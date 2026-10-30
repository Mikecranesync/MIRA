# Project #4: shared overview and proposed agent handoff

Status: proposal and investigation record, 2026-10-24. This document does not
implement a dispatcher, approve access grants, or authorize agent execution,
spending, merge or deployment. Existing repository gates remain authoritative.

## Objective and existing foundation

Use the existing private [GitHub Project #4](https://github.com/users/Mikecranesync/projects/4)
as the canonical task store, with linked issues and PRs as the source of detailed
work and evidence. Give the owner one focused overview and an understandable
way to direct an agent. Do not create another board, task database or GitLab
migration. Repository mirroring would not provide live issue synchronization.

Project #4 is native GitHub Projects v2: project items reference canonical issues
or PRs; project fields and saved views organize those records; GitHub workflows
can add items and change status. A private dashboard would be a client of that
store, not a second source of truth. See the existing
[kanban instructions](../../wiki/references/kanban.md),
[coordination protocol](../../.claude/rules/multi-session-protocol.md),
[readiness tracker #4372](https://github.com/Mikecranesync/MIRA/issues/4372) and
[coordination thread #3626](https://github.com/Mikecranesync/MIRA/issues/3626).
Their historical snapshots require reconciliation with current records.

The inventory found a broad backlog, sparse visible ownership and status
ambiguity: closed or unmerged work can be marked Done, while some closed issues
remain In Progress. Existing native workflows include auto-close and PR-link
handling. Inspect their conditions before changing status semantics. The current
session-start instructions read only 100 items, which cannot represent the full
board. Private card contents and the raw audit are intentionally not reproduced.

## Verified boundaries on October 24

| Surface | Observation | What remains unproven |
| --- | --- | --- |
| Native Project | The all-items inventory reached 1,925 items during the connection investigation; a later API refresh for this document returned 1,937. Counts are snapshots. | Inventory size is not evidence of current ownership or acceptance. |
| Orca Desktop 1.4.237 | Owner-provided screenshots established GitHub and task-source connection, issue listing and discovery of Project #4. The all-items view was refused because of size, not authentication. | This does not establish a connection from the separate custom dashboard. |
| Focused view | [View 2: Focus: In progress](https://github.com/users/Mikecranesync/projects/4/views/2), filter `status:"In progress" is:open`, was saved and reopened with 34 matches at 16:41 UTC. A later API read confirmed its name and filter. | Rendering that saved view inside Orca remains unverified. Its match count can change. |
| Original board | The focused-view operation preserved View 1, cards, statuses, workflows and permissions. | It did not reconcile stale cards or establish new acceptance rules. |
| Private decision UI | Timestamped snapshot with multiple-choice decisions grounded in issue/PR evidence, a recommended option, custom text to add or replace directions, and a preview. Send remains disabled. | No verified live dispatch or prompt-delivery path. Its private URL and screenshots are not public evidence. |

Orca documents native Tasks that display Projects, update a card's status when
moved, and create a workspace from a card. Its Claude integration launches Claude
Code in a worktree. These documented capabilities do not prove the proposed
custom Send path. A remote server is not inherently required merely to browse
the existing board. Sources, checked 2026-10-24:
[Orca GitHub and Tasks](https://www.onorca.dev/docs/review/github) and
[Claude Code in Orca](https://www.onorca.dev/docs/agents/claude-code).

## Proposed operating model

Start with approximately 10–15 active outcomes, preserving the historical
backlog and canonical owners. Add an executive overview and Needs Mike,
Blocked, and Live but Not Accepted views of the same records. The saved focus
view is a useful first filter, not the complete target overview.

Expose accountable owner, executing agent, bounded claim/scope and expiry, next
action, blocker/decision, evidence links, revision/environment/device and last
verification. A proposed outcome stage is Ready → Working → Review → Acceptance
→ Accepted, with Blocked separate. Reconcile native workflow behavior before
adopting these stages; an initial separate outcome-stage field may avoid changing
the meaning of existing automated Status updates.

Keep implemented, reviewed, merged, staging verified and production verified
as distinct milestones. Acceptance is outcome-specific and may require physical
device and technician/customer proof. Neither a decision nor passing tests
establishes review, deployment or acceptance.

Agents inspect the current record before starting, respect one accountable owner
per outcome and one active implementation claim per task, and use explicitly
non-overlapping scopes for parallel work. Existing comment claims are advisory,
not atomic locks. Handoffs include exact branch/commit, tests, remaining risks and
next owner. A future reconciliation helper should flag stale claims/evidence,
overlap and merged-but-unaccepted work; it should not merge, deploy, spend or
contact people autonomously.

The first product outcome remains a supervised machine-specific paid pilot;
commercial terms and acceptance are not established here. Richer evidenced
machine memory follows. Photo scope stays with
[proposal #4708](https://github.com/Mikecranesync/MIRA/pull/4708).

## Proposed Send contract

```text
Project item + current issue/PR evidence
  → owner selects an option and previews exact instructions and target
  → reviewed server-side dispatcher revalidates record, claim and authorization
  → durable unique decision → Project status update
  → approved GitHub Actions workflow → named, authorized Orca execution route
  → selected Claude agent → actual run and prompt-delivery receipts
```

1. Re-read the item, linked PR revision and active claim immediately before Send.
   Reject stale previews, conflicting claims or unauthorized targets; show what
   changed and require a fresh decision.
2. Preview the exact resulting prompt, whether custom text adds to or replaces
   directions, the canonical item, selected agent, bounded scope and execution
   route. Do not dispatch unreviewed text from issue content as authority.
3. Record a unique decision and durable idempotency key before side effects.
   Repeated clicks, retries and restarts must resolve to the same decision/run.
4. Set the existing item to In Progress and dispatch only an approved, allowlisted
   workflow/ref to the named Claude route. Claude is the selected agent; there is
   no automatic fallback to Codex and no new spending commitment.
5. Return the actual Actions run URL/ID and a separate receipt that binds prompt
   delivery to the intended agent/session and decision. An accepted dispatch
   request alone is not proof that Claude received or started the task.
6. Hold launches nothing. On partial failure, show which steps succeeded and
   which failed. A moved card with failed dispatch must say so. An uncertain
   dispatch must be reconciled against receipts before retrying; never launch a
   second worker merely because a response was lost.

GitHub status updates and external dispatch are not one transaction. The
dispatcher needs durable decision state and recovery semantics, but that ledger
must not become a competing task database. Send remains disabled until this
contract is implemented and verified.

## Missing connection and hosting work

The dashboard's inspected connector exposes neither Projects v2 writes nor
workflow dispatch. This is a connector capability limit, not a claim that GitHub
or the owner's account cannot perform those operations. A refreshed inspection
of MIRA and factorylm workflow sources found no general issue-plus-directions
launcher for an Orca agent.

[code-review.yml](../../.github/workflows/code-review.yml) is a PR-triggered review
path, not that launcher or an implementation approval. The
[Foreman integration](../../mira-bots/foreman/README.md) uses a separate
Slack/Cursor/Fleet Gateway path. Neither should be silently repurposed.

Remaining work requires a reviewed server-side dispatcher, appropriately scoped
GitHub and Orca authorization, a named execution route, explicit cost controls,
durable idempotency and a real end-to-end test. Keep credentials out of the
browser and repository. Verify available plan/access before relying on native
auto-add across repositories: GitHub currently documents one auto-add workflow
on Free and five on Pro/Team; no account upgrade is assumed.
[GitHub auto-add limits](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically).

The requested destination is a permanent private VPS dashboard, with browser
homepage/startup access and an Android shortcut. Hosting must isolate the
owner-only service from customer production, require HTTPS and authorization,
prove that unauthenticated and unauthorized users are denied, and have a tested
rollback. Follow [deployment governance](../environments.md) and
[deploy-vps.yml](../../.github/workflows/deploy-vps.yml); this proposal grants no
deployment permission. No VPS deployment or browser-setting change has occurred
as part of this work. Do not publish infrastructure addresses or private routes.

Private Project visibility does not privatize linked public issues. Keep private
sales data in the existing authoritative CRM and private evidence in approved
private storage. Public records should contain sanitized summaries only.

## Phases and acceptance checklist

1. **Reconcile and focus:** verify the saved view in Orca, confirm current owners,
   select active outcomes and inspect native workflow conditions. A planning
   range of roughly 1–2 working days for the first useful overview is conditional
   on straightforward access and reconciliation, not an engineering commitment
   or product launch date.
2. **Review the connection:** agree the exact execution route, permissions,
   spending boundary, decision schema and failure behavior before implementing.
3. **Prove dispatch:** test one approved bounded task through the real route,
   including duplicate, stale, unauthorized, Hold and partial-failure cases.
4. **Qualify hosting:** independently verify isolation, HTTPS, owner access,
   rollback and desktop/Android entry points before any authorized deployment.

- [ ] Focused Project view renders in Orca without the all-items size refusal.
- [ ] One canonical record per outcome; owners and claims reconciled.
- [ ] Exact instructions, target and custom-text behavior visible before Send.
- [ ] Hold, stale previews and unauthorized/conflicting claims launch nothing.
- [ ] Duplicate clicks, retries, restart and lost responses cannot double-launch.
- [ ] Actual run and prompt-delivery receipts bind to the same decision/target.
- [ ] Status-update and dispatch failures are distinguishable and recoverable.
- [ ] Claude selection and approved cost limits are enforced without fallback.
- [ ] Review, merge, deployment and acceptance remain independently evidenced.
- [ ] Private hosting passes positive and negative authorization tests and rollback.
- [ ] Browser startup and Android shortcut work only after separately authorized setup.

## Future Claude assignment template

Use only after a separately approved implementation scope and execution route:

> Inspect Project #4, its focused view, current issues/PRs, repository rules and
> active claims. Reuse the existing records and owners. Propose the smallest
> reviewed server-side connection satisfying this document's Send contract;
> identify the exact workflow/ref, Orca route, permission and cost dependencies.
> Implement only the authorized slice in an isolated branch. Keep Send disabled
> wherever authorization or receipts are missing. Prove idempotency, Hold, stale
> and conflicting claims, unauthorized access and partial failures with negative
> controls, then an explicitly approved end-to-end task. Return exact commits,
> tests, run/delivery receipts, remaining risks and the next owner. Do not grant
> access, spend, contact other agents, merge or deploy without separate authority.
