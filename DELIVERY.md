# FactoryLM / MIRA — Shared Delivery Plan

Status date: 2026-11-27. Engineering coordination: Claude Desktop.
Independent technical audit: Codex Desktop. Existing implementation and integration
claims retain their owners until an acknowledged handoff.
Strategy: [NORTH_STAR.md](NORTH_STAR.md).
Live acceptance and agent updates: [#5232](https://github.com/Mikecranesync/MIRA/issues/5232).

Product convergence: [acceptance matrix and recovery order](docs/plans/2026-11-27-product-convergence.md),
[observed resources and ownership](docs/plans/2026-11-27-product-convergence-inventory.md).
These are evidence crosswalks for the existing queue, not additional assignment queues.

## North stars and end goals

1. **Trustworthy context:** turn messy maintenance information into human-approved,
   asset-bound context with source identity, applicability, revision and provenance.
   FactoryLM is the context layer; MIRA proves it with grounded, cited assistance.
2. **Useful technician workflow:** a technician can onboard equipment, find applicable
   evidence, document work and recover it later without Mike repairing the application.
3. **Customer value:** prove the workflow with representative technicians on unfamiliar
   customer information; record usefulness, failures, assistance required and repeat use.
   A seeded CV-101 demo is an engineering milestone, not customer demand.
4. **Sustainable delivery:** earn a supported pilot and a defensible paid continuation
   or consulting engagement under Mike's approved offer. Track actual agreements and
   payment receipts separately from software progress. Do not invent a price or date.
5. **Evidence-backed demonstrations and responses:** describe demonstrated capability,
   prototype, planned work and gaps separately. Commercial, government-bid and
   production acceptance remain distinct.

This plan restates the current delivery mission. It does not replace strategy,
architecture, existing work claims, G01–G12/W0–W5 definitions or release governance.
Read those definitions before declaring their gates passed. No shorter checklist here
reduces the controlling acceptance scope in #5232 and its linked #5086 report.
Scope/offer changes belong to Mike; agents flag conflicts rather than silently choosing.

## Dates and deliverables

All deadlines below use America/New_York (ET). November dates and requirements were
provided in Mike's November 8 handoff; primary assignment/solicitation verification is
still required. An unverified deadline is a planning constraint, not proof of compliance.

For each external commitment, retain its primary source, original timezone and ET
conversion in the approved evidence location. Link only public sources in #5232;
reference private evidence by repository/path without copying its details. Until
verified, label it HANDOFF-REPORTED. Surface conflicts to Mike; do not silently change
a date or scope.

| Date | Deliverable | Accountable owner | Required proof / next action |
|---|---|---|---|
| Nov 7, 2026 — historical target | First Dollar | Mike | Agent reports target missed; verify current commercial state. Preserve the miss; Mike sets any replacement date and offer. |
| Nov 16, 2026, 11:59 PM ET | I-Corps report; reported 5–10 interviews | Mike; CHARLIE Codex tracks | Read assignment; verify interview count and requirements; retain report and submission receipt without publishing private interview data. |
| Nov 17, 2026, 7:00 AM ET | Government RFI questions | Mike; CHARLIE Codex tracks | Work from the original solicitation and the private bid plan in the factorylm repository; retain the authorized submission receipt there. |
| Nov 24, 2026 — internal target | Evidence-backed tablet demonstration | CHARLIE Codex + CHARLIE Claude | One identified build, reviewed composition, physical workflow receipts and explicit gaps. This is not an external procurement deadline. |
| Dec 1, 2026, 7:00 AM ET | Government RFI response | Mike; CHARLIE Codex tracks | Verify deadline and page limit against the original documents; requirements-to-evidence matrix, response and submission receipt live in the private factorylm repository. |
| Dec 2, 2026–Jan 6, 2027 — reported window | Second government opportunity decision | Mike | Verify the official opportunity and dates before committing work; details stay private. |
| Feb 9–12, 2027 — historical strategy date | ProveIt demonstration | Mike | NORTH_STAR records Dallas showcase goal; verify official dates and participation before travel or external commitments. |

CHARLIE Codex tracks document owners and missing decisions; it does not abandon
integration to become the sole author of every business deliverable. Mike supplies
interviews, offer decisions and submission authority. No external message/submission
is authorized merely by this plan.

## Next integrated product milestone

On one frozen candidate, through the real device interface:

Fresh supported sign-in → New Project → choose and confirm CV-101 → select/attach an
approved applicable manual → truthful indexing/search readiness → ask the original
unhinted GS11N-20P2 acceleration question → correct P01.12 evidence and warnings →
open the exact cited source page in the device's own browser → save job, photo and
note → restart → recover context and reviewed status → reuse eligible saved
evidence in a fresh conversation.
Include the controlling illustrated-guide and second-technician acceptance steps.

Answers must carry the cited page's own cautions, and machine-binding and review labels
must match the stored record. A photo counts only when it is attached to the job.
Validate model/revision/tenant negatives, immediate-danger stops, grounded fault
responses, sign-out behavior, pending-upload recovery and large-manual stability.
Test repeated/concurrent/cancelled work under the existing memory limit; preserve
content rather than silently dropping pages. Independently record PDF and printed
page numbers against the exact manual hash/revision.

For the offline offer: separately prove fresh supported local authentication,
the physical browser journey, cold restart/reboot recovery and monitored isolation.
Record network windows, detector positive controls, timer/restoration behavior and
cleanup. After a reboot the services must come back without manual commands, and the
sign-in screen must lead with the path that works offline. A reused session, matching
online answers, failed ping or free-memory snapshot alone does not establish
correctness, no-egress or long-duration stability.
Do not claim 180-day acceptance from a short run.

Freeze SHA, included changes, configuration, source hashes, runtime generation and
device identity. Review/CI must apply to the candidate required by existing governance.
Record staging, physical acceptance, rollback and production as separate stages.
Conveyor stays stopped; equipment interaction remains read-only.

## Four agent lanes

These are responsibility summaries, not grants to take over active file claims.
Verify current ownership and exact heads before editing. PR numbers are entry points,
not claims about current merge, review or deployment status.
The operating roles below govern coordination; the four lanes retain their existing
specialties, claims and integration/device responsibilities. No running session is
reassigned by a documentation change.

| Agent | Responsibility | Starting references |
|---|---|---|
| CHARLIE Codex | Integration, release composition, Pixel acceptance, combined evidence and deadline tracking | #5232; coordinate all lanes and preserve rollback |
| CHARLIE Claude | Offline runtime, passage usefulness, safety, source-page UI, packaging and Samsung acceptance | #5265/#5266; existing #5300–#5306 slices as applicable |
| BRAVO Codex | Retrieval/applicability, saved-evidence recall/photo work and bounded memory repair after handoff | #5285/#5294, #5289, existing photo/recall candidates |
| BRAVO Claude | Dependable project setup, pending manual recovery and sign-out follow-up | #5295/#5302 (#5312), #5297/#5308 (#5311); follow-ups #5315, #5316 |

The #5204 owner retains overlapping loader/route hunks until explicit handoff.
CHARLIE Codex coordinates the boundary; a blocked lane continues authorized independent
work. Do not create a fifth implementation of an existing repair.

## Required agent communication

**Every FactoryLM/MIRA agent must:**

- At session start/resume, read this plan and the latest relevant owner updates in #5232.
  Refresh current source/PR/CI facts; old comments and private memory are not live state.
- Before editing, use existing durable claims and overlap checks. Link the chosen goal
  and issue; if the task serves none, record why it is necessary before expanding scope.
- Maintain one short, owner-managed status comment per lane in #5232, using the template
  below. Update it at start/resume, material proof/blocker/ownership changes, handoff
  and session end. Avoid unchanged heartbeat comments.
- Reuse the lane's existing comment and verify its designated owner before editing.
  A successor records the session/claim handoff there; another active session does not
  overwrite it or create a competing lane summary. Specialist sessions pass updates
  through the designated lane owner while retaining their own implementation claims.
- Acknowledge the exact `DELIVERY.md` commit or blob permalink in that lane comment.
  Label a pre-merge acknowledgment PROPOSED; do not claim merged adoption or acknowledge
  another lane. CHARLIE Codex links missing acknowledgments as pending in the summary.
- Keep detailed evidence on the implementation PR/issue and link it. A status comment
  does not replace claims, review records, incident history or required session closeout.
- Preserve prior material transitions in a brief history or linked receipts when editing.
  Never overwrite another lane's comment or a review/approval ledger.
- For a new or unreviewed delivery PR, include the #5232 status-comment link and affected
  goal in its description. For a frozen reviewed PR, put that link in a separate
  coordination comment instead. Report review/CI against its exact snapshot; adoption
  and routine status updates must not change a reviewed body or require another review.
- Flag an approaching or missed deadline with deliverable, owner, blocker and decision
  needed. Request only genuinely missing decisions/permissions; continue independent work.

If GitHub is unavailable, retain the same update locally with UTC timestamp, explicitly
mark it UNPUBLISHED, and publish/reconcile when access returns. Never imply peers saw it.

```text
[DELIVERY-UPDATE: CHARLIE-CODEX | CHARLIE-CLAUDE | BRAVO-CODEX | BRAVO-CLAUDE]
Updated: <ISO-8601 UTC>; session: <id>; claim: <link>
Owner / contact: <agent, host, Desktop or CLI, verified receiver/task or GitHub thread>
Goal / slice: <goal and issue>; branch / SHA: <exact>
Plan read: <DELIVERY.md commit/blob link>; acknowledgment: PROPOSED | MERGED
Intended outcome: <observable technician result and acceptance IDs>
Worktree / scope: <absolute path; owned paths/contracts; foreign WIP or none>
Plan: <next bounded steps and dependencies>
Reuse: <existing source, PRs, branches, tests and receipts checked; demonstrated gap if new code>
State: ACTIVE | BLOCKED | HANDOFF | COMPLETE
Evidence: VERIFIED | REPORTED | NOT TESTED — <scope and receipt link>
Stage: local | review/CI | staging | device | human | production
Changed: <one sentence; preserve material earlier receipts>
Progress: <observed result versus intended outcome; remaining acceptance IDs>
Next: <one concrete action>; target: <ET date/time or not agreed>
Next check: <UTC heartbeat due while executing, or handoff/stop condition>
Blocked by / needs: <owner + specific action, or none>
Decision for Mike: <specific decision, or none>
```

Choose one lane marker, state, evidence label, stage and acknowledgment status per
update; use extra short lines when evidence spans stages. COMPLETE means the owned slice's acceptance is proven, not
that the entire product is accepted. FAIL is a valid test verdict; record it explicitly.
Put the candidate's full head SHA on `Goal / slice` before any plan/source SHA:
the current cockpit parser takes the first 40-character SHA in the report.
Keep base/review/runtime revisions labelled separately; the cockpit is not their validator.

The Claude Desktop coordinator maintains the existing combined acceptance summary
in #5232 with the CHARLIE Codex integration owner and independent Codex Desktop auditor, linking the
four latest lane comments, candidate, milestone status and next decision. Refresh it
when a material update changes integration or acceptance, and at integration closeout.
The summary must distinguish VERIFIED, REPORTED, BLOCKED and NOT TESTED. Conflicting
reports remain visible until reconciled against source or receipts.

**Orchestrator:** day-to-day assignment, sequencing and handoffs follow
[docs/ORCHESTRATOR.md](docs/ORCHESTRATOR.md) (adopted by Mike 2026-11-27). It grants no merge,
deploy, spend, migration, OTA or device authority.

**Enforcement scope:** this PR adds an instruction requirement, not an automated CI
attestation, running monitor or dispatcher. Existing running sessions must explicitly
read/acknowledge it; a merged file cannot force already-running agents to reload.
Do not require a new source commit/PR for each status update.

## Product convergence operating loop

The objective is pilot readiness through recovery, reuse, integration, repair and
verification of existing capabilities. New application code is the last resort.
The complete integrated milestone and controlling acceptance scope above remain.

### Roles and one assignment queue

| Role | Responsibility | Boundary |
|---|---|---|
| Claude Desktop — engineering coordinator | Reconcile existing claims and reports; select the next dependency in #5232; identify an execution owner, intended outcome, reuse candidates and acceptance evidence; maintain the combined summary. | A role designation is not proof of a live session or authority to interrupt, override a claim, spend, merge or deploy. Register the actual coordinator session and backup in #5232. |
| Codex Desktop — independent technical auditor | Challenge the source/requirement mapping and completion claims; inspect exact source, tests, reviews and deployed evidence; identify unproven acceptance and regression risks. | Do not audit your own authored change as independent. This plan was authored by Codex and needs a separate authorized reviewer. Desktop audit does not substitute for the trusted-base R3 review producer. |
| CLI agents — execution workers | Execute one claimed slice in an isolated worktree; recover and qualify existing work first; report using the template above; provide a reproducible handoff. | Preserve the repository's Claude implementation/Codex read-only review separation. An explicitly assigned exception remains bounded to that assignment; it grants no self-review. |
| Mike — product and authorization owner | Decide supported offer/scope, resolve authority or requirement conflicts, arrange representative technicians, and make existing human-gated decisions. | Retain explicit merge, deploy, device, migration, sharing and spend boundaries and durable review budgets. |

**#5232 is the authoritative assignment and outcome queue.** Its existing claims and
linked implementation issues/PRs hold execution detail. Project #4 is its existing
board view; Mission Control is an evidence cockpit. Neither stale board status nor
a dashboard badge creates an assignment or proves pilot acceptance. The private
Pilot Acceptance Ledger remains the authoritative pilot result record, as described
in the [Mission Control runbook](docs/runbooks/mission-control.md).
The matrix/backlog ranks dependencies and links the queue; it is not a new registry.

### Registration, heartbeat, ownership and reassignment

1. At start/resume, read this exact plan revision, `wiki/hot.md`, applicable module
   instructions and controlling acceptance references. Run the existing three-command
   coordination check in the [MVP plan](docs/plans/2026-04-19-mira-90-day-mvp.md#coordination--read-before-starting-any-unit).
   Inspect actual changed paths of plausible overlapping PRs, not only their titles.
2. Register through the established `[WORK-CLAIM]` on #5232 or its linked canonical
   issue/PR. Include session/contact route, host, worktree, branch/full base and head,
   owned paths/contracts, outcome, plan, reuse and next action. Re-read the namespace
   after claiming: the earliest ACTIVE overlapping claim wins. Preserve the shared
   UI writing lease and all other exclusive claims. Never edit another worktree.
3. Keep the existing lane's owner-managed `[DELIVERY-UPDATE]` comment. A specialist
   keeps a linked slice claim and reports through its lane owner; do not overwrite
   another active owner's comment or create a second lane summary. New fields in
   the template are prose extensions; retain the existing marker and enum syntax
   so the current Mission Control parser continues to work.
4. Report on start/resume, material change, blocker, handoff and closeout. While
   executing, refresh the **same** owner comment at least every two hours with a
   truthful timestamp, current progress/blocker and next check. Do not append
   unchanged heartbeat comments. A blocked/stopped owner records when/what would
   resume it; no unattended heartbeat job is required. Mission Control's current
   nine-hour stale threshold is visibility, not a lease-expiry or takeover rule.
5. Reassignment requires the current owner or Mike to record the transfer, or the
   repository's existing stale-claim procedure: both claim and branch idle 24+ hours,
   takeover note with the idle evidence on the original thread, and updated claim.
   Check for a live process/contact and moving branch first; uncertainty goes to
   Mike. A missing heartbeat, `notLoaded` task or old worktree alone proves nothing.
   This mission inventories ownership; it performs no reassignment or interruption.
6. Handoff includes exact source/body revision, reusable artifacts, tests with scope
   and failures/skips, review ledger and remaining rounds, runtime evidence, blockers,
   next action and receiver acknowledgment. Until acknowledged, mark HANDOFF pending;
   do not assume another agent saw the plan or can receive an old peer ID.

### Discover → recover → reuse → integrate → repair → verify → independently review → reassign

For each selected queue item, the coordinator records its acceptance IDs, dependencies,
existing owner and one next action. The worker then:

- **Discover:** inspect current source, PRs/issues, worktrees/branches, historical
  receipts, approved contracts and the real failing journey. Separate VERIFIED,
  REPORTED, NOT TESTED and historical evidence.
- **Recover:** locate the existing candidate and its owner; preserve foreign WIP,
  applied migrations, source hashes, review budgets and earlier failure evidence.
  A closed/old branch may hold useful work; it is not permission to delete or adopt it.
- **Reuse:** compare the candidate with current main and the offered workflow.
  Reuse the canonical domain state, shared UI, adapters, tests and coordination tools.
  Document why an existing capability cannot close the observed gap before proposing
  application code. No new orchestration service, queue, agent platform or registry.
- **Integrate:** propose the smallest composition that delivers the complete intended
  outcome. Record interface/flag/schema dependencies and serial writer order; obtain
  any needed handoff first. Do not shrink acceptance to the passing component.
- **Repair:** change only the demonstrated gap under the existing implementation
  claim. Keep unsupported cases, safety stops and incomplete evidence visible.
- **Verify:** run relevant regressions and the actual deployed staging technician
  journey on an identified candidate. Bind source hash/revision, client/backend,
  schema/flags, tenant/asset/thread, inputs, result and receipts. Include negative,
  reload/retry and cross-tenant controls; preserve all stricter ledger thresholds.
- **Independently review:** use the existing SDLC risk class, cheap lane and required
  trusted-base exact-head/body review. Different author/reviewer; CI alone is not
  review. A changed head/body invalidates old review; do not reset a spent ledger.
- **Reassign:** reconcile the result in #5232 and the existing pilot ledger, then
  select the next authorized unclaimed dependency. Record COMPLETE only for the
  proven slice. Preserve local/test/review/staging/device/human/production distinctions.

Stop the affected action for overlapping ownership, uncertain authority, unsafe or
wrong-tenant/asset behavior, silent data loss/duplicate writes or charges, missing
applicability/provenance, a new blocking/HIGH finding, exhausted review/spend/device
allowance, or mismatched candidate/CI/runtime evidence. Record the failure and exact
owner/action needed; continue only independent authorized work. Never bypass a gate,
invent acceptance or turn a status report into permission. Follow
[SDLC v1](docs/architecture/mira-sdlc-v1.md), the
[multi-session protocol](.claude/rules/multi-session-protocol.md) and
[environment rules](docs/environments.md).

Adoption and first read order for each current session are in the
[convergence crosswalk](docs/plans/2026-11-27-product-convergence.md#adoption-by-existing-agents).

## Change and authority boundaries

This repository is public. Solicitation numbers, bid strategy, clearance, pricing and
interview data stay in the private factorylm repository; link by path, do not copy.

Keep this file focused on goals, deadlines, owners and communication. Store volatile
engineering status in #5232; change this plan through a reviewed PR when scope,
deadlines, responsibility or communication rules change. Preserve old targets/history.

Existing SDLC, safety, isolation, review budgets, code-sharing permissions and human
merge/deploy gates remain intact. Before any authorized merge, run current PR checks
and compare failures with main; new failures cannot be bypassed. Pre-existing unrelated
failures still require Mike's decision. No new spending, vendor sharing, migration,
production change, live billing change or equipment command is granted by this plan.

The customer milestone is a representative technician completing useful work with
recoverable evidence and a supported way to get help. A pilot release also needs a
clear supported scope, install/access path, recovery/support instructions and truthful
claims. Offer, price and customer/payment records require current evidence; historical
commercial targets and proposed #4960 acquisition changes are not current approval.
