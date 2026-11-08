# FactoryLM / MIRA — Shared Delivery Plan

Status date: 2026-11-08. Owner: CHARLIE Codex, integration role.
Strategy: [NORTH_STAR.md](NORTH_STAR.md).
Live acceptance and agent updates: [#5232](https://github.com/Mikecranesync/MIRA/issues/5232).

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
   prototype, planned work and gaps separately. Commercial, Air Force and production
   acceptance remain distinct.

This plan restates the current delivery mission. It does not replace strategy,
architecture, existing work claims, G01–G12/W0–W5 definitions or release governance.
Read those definitions before declaring their gates passed. No shorter checklist here
reduces the controlling acceptance scope in #5232 and its linked #5086 report.
Scope/offer changes belong to Mike; agents flag conflicts rather than silently choosing.

## Dates and deliverables

All deadlines below use America/New_York (ET). November dates and requirements were
provided in Mike's November 8 handoff; primary assignment/solicitation verification is
still required. An unverified deadline is a planning constraint, not proof of compliance.

| Date | Deliverable | Accountable owner | Required proof / next action |
|---|---|---|---|
| Nov 7, 2026 — historical target | First Dollar | Mike | Agent reports target missed; verify current commercial state. Preserve the miss; Mike sets any replacement date and offer. |
| Nov 16, 2026, 11:59 PM ET | I-Corps report; reported 5–10 interviews | Mike; CHARLIE Codex tracks | Read assignment; verify interview count and requirements; retain report and submission receipt without publishing private interview data. |
| Nov 17, 2026, 7:00 AM ET | Air Force organizer questions | Mike; CHARLIE Codex tracks | Read original RFI FA558726R1000 and attachments; prepare questions on hardware, data access/storage, offline evaluation, security, clearance and telemetry; retain authorized submission receipt. |
| Nov 24, 2026 — internal target | Evidence-backed tablet demonstration | CHARLIE Codex + CHARLIE Claude | One identified build, reviewed composition, physical workflow receipts and explicit gaps. This is not an external procurement deadline. |
| Dec 1, 2026, 7:00 AM ET | Air Force RFI response | Mike; CHARLIE Codex tracks | Verify deadline and reported eight-page limit excluding cover against original documents; requirements-to-evidence matrix, final response and authorized submission receipt. |
| Dec 2, 2026–Jan 6, 2027 — reported window | Navy opportunity decision | Mike | Verify official opportunity and dates before committing work. |
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
open the exact cited source page → save job, photo and note → restart → recover
context and reviewed status → reuse eligible saved evidence in a fresh conversation.
Include the controlling illustrated-guide and second-technician acceptance steps.

Validate model/revision/tenant negatives, immediate-danger stops, grounded fault
responses, sign-out behavior, pending-upload recovery and large-manual stability.
Test repeated/concurrent/cancelled work under the existing memory limit; preserve
content rather than silently dropping pages. Independently record PDF and printed
page numbers against the exact manual hash/revision.

For the offline offer: separately prove fresh supported local authentication,
the physical browser journey, cold restart/reboot recovery and monitored isolation.
Record network windows, detector positive controls, timer/restoration behavior and
cleanup. A reused session, matching online answers, failed ping or free-memory
snapshot alone does not establish correctness, no-egress or long-duration stability.
Do not claim 180-day acceptance from a short run.

Freeze SHA, included changes, configuration, source hashes, runtime generation and
device identity. Review/CI must apply to the candidate required by existing governance.
Record staging, physical acceptance, rollback and production as separate stages.
Conveyor stays stopped; equipment interaction remains read-only.

## Four agent lanes

These are responsibility summaries, not grants to take over active file claims.
Verify current ownership and exact heads before editing. PR numbers are entry points,
not claims about current merge, review or deployment status.

| Agent | Responsibility | Starting references |
|---|---|---|
| CHARLIE Codex | Integration, release composition, Pixel acceptance, combined evidence and deadline tracking | #5232; coordinate all lanes and preserve rollback |
| CHARLIE Claude | Offline runtime, passage usefulness, safety, source-page UI, packaging and Samsung acceptance | #5265/#5266; existing #5300–#5306 slices as applicable |
| BRAVO Codex | Retrieval/applicability, saved-evidence recall/photo work and bounded memory repair after handoff | #5285/#5294, #5289, existing photo/recall candidates |
| BRAVO Claude | Dependable project setup, pending manual recovery and sign-out follow-up | #5295/#5302 (draft #5312, current-main integration), #5297/#5308 (draft #5311) |

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
- Keep detailed evidence on the implementation PR/issue and link it. A status comment
  does not replace claims, review records, incident history or required session closeout.
- Preserve prior material transitions in a brief history or linked receipts when editing.
  Never overwrite another lane's comment or a review/approval ledger.
- Include the #5232 status-comment link and affected goal in each delivery PR description.
  Report review/CI against its exact snapshot. Do not edit a frozen reviewed PR body
  merely to update status; put the new status in the linked owner comment.
- Flag an approaching or missed deadline with deliverable, owner, blocker and decision
  needed. Request only genuinely missing decisions/permissions; continue independent work.

If GitHub is unavailable, retain the same update locally with UTC timestamp, explicitly
mark it UNPUBLISHED, and publish/reconcile when access returns. Never imply peers saw it.

```text
[DELIVERY-UPDATE: CHARLIE-CODEX | CHARLIE-CLAUDE | BRAVO-CODEX | BRAVO-CLAUDE]
Updated: <ISO-8601 UTC>; session: <id>; claim: <link>
Goal / slice: <goal and issue>; branch / SHA: <exact>
State: ACTIVE | BLOCKED | HANDOFF | COMPLETE
Evidence: VERIFIED | REPORTED | NOT TESTED — <scope and receipt link>
Stage: local | review/CI | staging | device | human | production
Changed: <one sentence; preserve material earlier receipts>
Next: <one concrete action>; target: <ET date/time or not agreed>
Blocked by / needs: <owner + specific action, or none>
Decision for Mike: <specific decision, or none>
```

Choose one lane marker, state, evidence label and stage per update; use extra short lines
when evidence spans stages. COMPLETE means the owned slice's acceptance is proven, not
that the entire product is accepted. FAIL is a valid test verdict; record it explicitly.

CHARLIE Codex maintains the existing combined acceptance summary in #5232, linking the
four latest lane comments, candidate, milestone status and next decision. Refresh it
when a material update changes integration or acceptance, and at integration closeout.
The summary must distinguish VERIFIED, REPORTED, BLOCKED and NOT TESTED. Conflicting
reports remain visible until reconciled against source or receipts.

**Enforcement scope:** this PR adds an instruction requirement, not an automated CI
attestation, running monitor or dispatcher. Existing running sessions must explicitly
read/acknowledge it; a merged file cannot force already-running agents to reload.
Do not require a new source commit/PR for each status update.

## Change and authority boundaries

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
