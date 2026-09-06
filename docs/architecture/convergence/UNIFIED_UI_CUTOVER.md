# FactoryLM Unified UI Cutover Charter

**Status:** APPROVED
**Mission:** `FACTORYLM-UNIFIED-UI-CUTOVER-001`
**GitHub coordination:** [Mikecranesync/MIRA#3626](https://github.com/Mikecranesync/MIRA/issues/3626)
**Design authority:** `docs/prd/2026-09-06-factorylm-unified-interaction-v1.md`
**Shared-shell execution plan:** `docs/superpowers/plans/2026-09-06-factorylm-unified-ui-v2-shell.md`
**Governance implementation plan:** `docs/superpowers/plans/2026-09-06-factorylm-unified-ui-cutover-governance.md`

## 1. Decision

FactoryLM has one future product UI. New product presentation work goes into the
shared FactoryLM shell and its bounded platform adapters. The current public,
Hub, and mobile presentation trees are feature-frozen legacy surfaces.

This is a **presentation freeze**, not a shutdown of the deployed products and
not a declaration that their backend capabilities are obsolete. The old UI
stays reachable as a rollback and recovery path until the cutover gates in this
document pass. Authentication, billing, activation, Equipment Notebook data,
typed streaming, evidence, safety, CMMS, files, camera, QR, offline behavior,
and enterprise services remain authoritative capabilities to attach to the new
shell.

Effective when the lifecycle guard reaches `main`:

1. Do not add features to a guarded legacy presentation path.
2. Do not create a second chat store, stream parser, safety system, evidence
   system, provider router, asset identity system, or capability registry.
3. Build shared presentation in `packages/factorylm-*` and connect existing
   capability seams through small surface adapters.
4. Keep the legacy runtime available until measured parity, rollback, and
   stability requirements pass.

No customer-facing `deprecated` banner is required. `LEGACY` is an engineering
lifecycle state. A recovery route may identify itself as **Legacy recovery** to
authenticated operators, but the public product must not imply a broken or
abandoned service during migration.

## 2. What is canonical, legacy, and preserved

### 2.1 Canonical shared UI

| Path | Ownership |
|---|---|
| `packages/factorylm-theme/**` | Shared FactoryLM tokens and semantic workspace theme |
| `packages/factorylm-interaction/**` | Shared interaction types, fixtures, reducer, and platform-adapter contract |
| `packages/factorylm-ui/**` | Shared shell, conversation parts, composer, navigation, inspector, and source viewer |
| `apps/factorylm-ui-lab/**` | Disconnected fixture lab and cross-surface verification harness |

These paths have one writer at a time. Hub, mobile, and public-web agents do not
change the shared contract while building adapters unless their work claim
explicitly assigns shared-core ownership.

### 2.2 Guarded legacy presentation

The machine-readable copy of this list lives in
`docs/architecture/convergence/REGISTRY.yaml`. The CI guard reads that registry;
this table explains the boundary.

| Surface | Guarded paths | Why guarded |
|---|---|---|
| Public | `mira-web/src/views/**`; `mira-web/public/mira-chat.js`; `mira-web/public/mira-chat.css` | Old public-page tree, product-demo shell, and standalone chat renderer |
| Hub | `mira-hub/src/app/(hub)/**`; `mira-hub/src/components/layout/**`; `mira-hub/src/components/equipment/**` | Dashboard-first route tree, navigation, and duplicate Equipment Notebook presentation |
| Mobile | `mira-mobile/src/App.tsx`; `mira-mobile/src/nav.ts`; `mira-mobile/src/screens/**` | Separate mobile shell, screen tree, navigation, and duplicate chat presentation |

The parent modules remain `CANONICAL`/deployed in `MODULES.md`. Marking an
entire module legacy would incorrectly deprecate its live API and capability
seams.

New bounded presentation adapters live outside those trees under
`mira-web/src/factorylm-ui/**`, `mira-hub/src/factorylm-ui/**`, or
`mira-mobile/src/factorylm-ui/**`. Mobile transport conversion continues to
reuse `mira-mobile/src/chat-adapter/**`. Mounting an adapter in an existing
guarded route is an audited exception; creating a sibling legacy route or
component is not a bypass.

### 2.3 Preserved capability seams

These are adapter inputs, not rewrite targets:

- Hub session, tenant context, authorization, and capability checks.
- `equipment_notebooks`, `equipment_notebook_turns`, and the existing Notebook
  route as the first durable thread/turn seam.
- `mira-hub/src/components/equipment/notebook-chat-utils.ts` and
  `mira-hub/src/lib/notebook-chat-types.ts` for current typed SSE behavior.
- `mira-mobile/src/chat-adapter/**`, API client, deep links, native picker,
  camera, QR, offline queue, resume guard, and secure storage behavior.
- `workspace_file_links` and canonical file bytes for many-to-many attachments.
- Server-owned retrieval, citations, evidence, safety, identity confirmation,
  lifecycle truth, provider routing, and tool outcomes.
- Existing Atlas/CMMS, work order, schedule, machine-memory, and enterprise
  services.

## 3. Legacy exception policy

Addition, modification, deletion, rename into, or rename out of a guarded
legacy path fails CI by default. The old runtime is rollback-critical until
Gate 8, so `deletion_safe: false` is enforced rather than documentary.

A maintainer may apply `legacy-ui-exception` only for:

- a security or severity-0/severity-1 production repair;
- rollback-path correctness;
- parity work that cannot yet live in an adapter;
- the controlled adapter mount or cutover itself;
- an explicit repair or evolution of the lifecycle guard and its trusted
  control plane.

The live pull-request body must contain:

```markdown
## Legacy UI exception

Reason: <why the change cannot be made in the canonical shell or adapter>
Canonical replacement impact: <what is added, unblocked, or intentionally unchanged>
Rollback: <how this exact change is reversed safely>
```

The label is human approval, not a convenience switch. Exactly one real
`## Legacy UI exception` section is accepted. Its three values must be
substantive text; blank values, `N/A`, template placeholders, HTML comments,
and text inside fenced code blocks fail closed. The guard reads the label and
body live from GitHub so a rerun does not require an empty commit.

### 3.1 Trusted enforcement boundary

The authoritative `Legacy UI Lifecycle Guard` runs from the default branch on
`pull_request_target`. It checks out only the trusted base revision with Git
credentials disabled, obtains PR filenames/statuses, labels, and body through a
least-privilege metadata step, and never checks out or executes pull-request
code. The enforcement step has no token. It evaluates additions,
modifications, deletions, and both sides of renames against the base registry.

The base guard also protects its own control files: the registry, charter,
guard implementation and tests, focused Claude rule, three UI workflow files,
and trusted GitHub workflow. Editing those files requires the same audited
exception. The workflow reruns on head changes, body edits, label changes,
draft-to-ready transitions, reopen, and open. It posts the uniquely named
status to the PR head SHA. After bootstrap, that status is a strict required
check on protected `main`, including for administrators; direct pushes cannot
bypass it.

Known transition collision at approval time: PR #3592 modifies
`mira-web/src/views/home.ts`. It must merge before the freeze, close, or use the
exception path. This charter does not decide or mutate that PR.

## 4. Capability attachment model

`docs/architecture/convergence/CAPABILITY_CLOSURE.yaml` remains the lifecycle
source of truth. Do not create a parallel UI capability registry. The table
below is a routing map; every connection PR updates the existing capability
record it advances or adds one when no record exists.

| Order | Capability | Canonical seam to reuse | Adapter destination | Proof required before promotion |
|---:|---|---|---|---|
| 1 | Session and tenant authorization | Hub session and server capability checks | Hub wrapper, signed-in web continuity | Two-user tenant-isolation and unauthorized tests |
| 2 | Thread, turn, persistence, and stream | Equipment Notebook route, turns, typed SSE | Shared interaction adapter used by Hub and mobile | Same account/thread/parts live and after reload on two surfaces |
| 3 | Evidence, citations, identity, and safety | Server-owned Notebook/engine frames | Shared ordered-part renderer | Exact-fixture parity; machine claims fail closed; safety survives reload |
| 4 | Files, manuals, and photos | Canonical files plus `workspace_file_links` | Composer platform adapter | Attach, cite, open canonical source, reload, and cross-device proof |
| 5 | Camera, QR, offline, share, and Back | Existing Capacitor/mobile libraries | Native platform adapter | Emulator matrix plus physical-device-only camera/release-signing checks |
| 6 | Work, work orders, schedules, findings | Existing Hub/Atlas APIs and permission gates | Shared Work cards and explicit actions | Idempotency, audit, authoritative completion, rollback |
| 7 | Enterprise context and inspection | Hub namespace, signals, integrations, team, usage, audit | Capability-gated inspector routes | Ordinary thread unchanged; unauthorized controls absent and server-denied |
| 8 | Public demo to account continuity | Fixture lab plus existing auth/activation | Public profile and sign-in handoff | Original question/context restored after sign-in; no production provider in demo |

Connection-state language inside work claims is:

`mapped -> adapter_contract -> fixture_proven -> connected -> cross_surface_parity -> default_on -> legacy_retired`

These are delivery checkpoints, not new values for the capability-closure
registry. The registry continues to use its validated states such as
`implemented_unconnected`, `staging_enabled`, and `production_enabled`.

## 5. Multi-CPU execution model

### 5.1 GitHub is the shared control plane

Every CPU starts from the same immutable inputs:

1. Repository: `https://github.com/Mikecranesync/MIRA`
2. Mission issue: `https://github.com/Mikecranesync/MIRA/issues/3626`
3. This charter on `main`.
4. An exact base SHA and one GitHub work claim using the repository-wide
   `[WORK-CLAIM]` marker.
5. One worktree, branch, bounded path set, verification command, and draft PR.

Do not coordinate only through terminal history. Claims, decisions, findings,
SHAs, and proof belong in the issue or PR.

### 5.2 Ownership lanes

| Lane | May write | Must not write in parallel |
|---|---|---|
| Shared core | `packages/factorylm-*`, `apps/factorylm-ui-lab` | Any surface adapter |
| Hub adapter | New Hub wrapper/adapter files and explicitly assigned route mounts | Shared core; mobile; public renderer |
| Mobile adapter | New mobile adapter/wrapper files and explicitly assigned route mounts | Shared core; Hub; public renderer |
| Public adapter | New public demo bundle/mount and explicitly assigned Hono route | Shared core; Hub; mobile |
| Verification | Tests, evidence, and review artifacts assigned by the integrator | Production implementation |

Tasks 5-8 in
`docs/superpowers/plans/2026-09-06-factorylm-unified-ui-v2-shell.md` remain a
single sequential shared-core lane. Adapter lanes may fan out only after the
shared interaction and component contracts are frozen at an exact SHA.

### 5.3 Merge discipline

- A lane starts from the integrator-provided base SHA, never an assumed latest
  branch.
- One writer owns a file. Parallel agents may review the same diff read-only.
- Each PR is one capability slice, opens draft, and includes the work claim,
  exact base/head SHAs, test evidence, rollback, and capability-closure update.
- Claim acquisition follows `.claude/rules/multi-session-protocol.md`: post the
  claim, reread the complete claim namespace, and start a writer only when the
  claim is the earliest overlapping `ACTIVE` record.
- No worker merges, deploys, edits production state, or weakens a gate.
- The integrator merges serially, then gives remaining lanes the new base SHA.
- A green check on an older SHA is stale evidence.

## 6. Claude Code dynamic workflows

Project workflows live in `.claude/workflows/` and become slash commands for
anyone cloning the repository. They deliberately split sign-off stages because
the workflow runtime has no mid-run human input.

### `/flm-ui-map`

Read-only fan-out across public, Hub, mobile, shared core, and capability
closure. It cross-checks path ownership and emits proposed GitHub work claims.
These are claim drafts using the repository marker, not authority to edit.
It never edits, claims, or opens PRs. It fails before dispatch unless structured
arguments include `mission`, `issue`, and a full 40-character `baseSha`.

Example input:

```text
Run /flm-ui-map with mission FACTORYLM-UNIFIED-UI-CUTOVER-001 and baseSha <sha>.
```

### `/flm-ui-slice`

Runs one writer for one approved claim, followed by parallel read-only
contract, safety, and test reviews. Required structured input includes
`mission`, `issue`, `claimUrl`, `baseSha`, `lane`, `branch`, `allowedPaths`,
and `verificationCommand`. Its read-only preflight rereads the claim namespace
and must return a structured `WON` verdict before the writer can run. The writer
must use an isolated worktree and may open a draft PR; it may not merge or
deploy. The writer must return structured output containing the full committed
`headSha`. The workflow validates that SHA before passing it verbatim to every
reviewer; missing or malformed output stops the workflow.

### `/flm-ui-verify`

Read-only exact-SHA fan-out across interaction parity, industrial safety,
tenant/auth boundaries, accessibility/mobile behavior, transport honesty,
licenses/performance, and rollback. One synthesis agent deduplicates findings
and returns `GREEN`, `PARTIAL`, or `BLOCKED` for the reviewed SHA.
It fails before dispatch unless structured arguments include `mission`,
`issue`, and the full 40-character `headSha` to review.

Use Claude Code cross-session messaging to pass landed SHAs and decisions to
sessions on other machines. Messaging supplements GitHub; it does not replace
the durable issue/PR record.

## 7. Work claim contract

Use the repository-wide marker below in each issue or draft PR. The first
fields and status vocabulary come from
`.claude/rules/multi-session-protocol.md`; the remaining fields make a UI slice
executable without private machine context.

```text
[WORK-CLAIM]
Slice:
Convergence unit: FACTORYLM-UNIFIED-UI-CUTOVER-001
Owner/session:
Branch:
Worktree:
Base SHA:
Expected files/systems:
Status: ACTIVE | BLOCKED | RELEASED | COMPLETE
Last updated:
Mission issue: #3626
Capability:
Lane: shared-core | hub | mobile | public | verification
Allowed paths:
Forbidden paths:
Consumes:
Produces:
Verification command:
Capability-closure record:
Rollback:
```

After posting, reread open issues, pull requests, and `[WORK-CLAIM]` markers for
the slice. The earliest overlapping `ACTIVE` claim wins. Record the winning
claim URL in `/flm-ui-slice` input; a proposal that is not yet `ACTIVE` is not
authority to edit.

Minimum prompt for a new agent:

```text
Work from Mikecranesync/MIRA issue #3626 and the assigned `[WORK-CLAIM]`. Read
docs/architecture/convergence/UNIFIED_UI_CUTOVER.md and the linked plan before
editing. Reread the claim namespace and proceed only if the assigned claim is
the earliest overlapping `ACTIVE` record. Create an isolated worktree at the
supplied base SHA, touch only its allowed paths, and open a draft PR. Do not
merge, deploy, or add features to guarded legacy presentation paths.
```

## 8. Cutover gates

1. **Foundation:** disconnected shared shell and fixture contract merged.
2. **Shared-core completeness:** shell-plan Tasks 5-8 pass unit, browser,
   accessibility, network-prohibition, license, and bundle-budget gates.
3. **Golden Conversation:** sign in, open/create project and thread, ask,
   attach machine/manual/photo, receive cited answer, save/reload, and open the
   same thread on another surface.
4. **Staging opt-in:** new shell runs behind an instant rollback switch; the old
   runtime remains available.
5. **Pilot:** internal and named-user outside-in tests prove tenant isolation,
   identity binding, evidence/safety parity, native behavior, and honest errors.
6. **Production default:** owner-approved, exact-release evidence attached, and
   rollback exercised before the switch.
7. **Stability window:** at least 14 consecutive days and two production
   releases with no unresolved severity-0/severity-1 UI regression, no identity
   or safety parity defect, and no rollback activation.
8. **Retirement:** owner-approved deletion PR proves zero live route, import,
   build, deployment, documentation-authority, and open-exception dependency on
   the old presentation code.

Until Gate 8 passes, `LEGACY` means **feature-frozen and recoverable**, not safe
to delete.

## 9. Immediate queue

1. Complete shared-shell Tasks 5-8 under one shared-core owner.
2. Run `/flm-ui-map` at that exact head and approve bounded adapter packets.
3. Connect the Golden Conversation in this order: Hub, mobile, public demo.
4. Add projects/folders/multiple threads only after the first connection proves
   existing Notebook IDs and turns remain canonical.
5. Add structured Work and enterprise inspector capabilities after the shared
   Ask path is stable.
6. Start the controlled cutover gates; do not delete the old presentation early.

## 10. References

- `docs/prd/2026-09-06-factorylm-unified-interaction-v1.md`
- `docs/superpowers/plans/2026-09-06-factorylm-unified-ui-v2-shell.md`
- `docs/architecture/convergence/REGISTRY.yaml`
- `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`
- `.claude/rules/multi-session-protocol.md`
- `.claude/rules/subagent-worktree-isolation.md`
- [Claude Code dynamic workflows](https://code.claude.com/docs/en/workflows)
- [Claude Code parallel agents](https://code.claude.com/docs/en/agents)
- [Claude Code cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- [Claude Code worktrees](https://code.claude.com/docs/en/worktrees)
