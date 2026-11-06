# Supported QC fields — local verification

Status: PARTIAL; GitHub publication authorized, exact-head review pending. Product commits7613a8cd7452e66fa60f263c99ea11c4ba43c405
and6e77205a8db3f62144b9f0fb8da05809e1ca6687, based on frozen draft5236 at
8a54f29a73507da80eee98bfcb6534f332617a24. No remote branch/PR publication,
authoritative independent review, CI, merge, staging, deployment or human
acceptance of this follow-up has occurred.

## Behavior and evidence

The saved guide now uses effective values and correction/exclusion provenance
for per-step inclusion, source-indexed figure placement and measurement fields.
Reported readings stay distinct from original source claims and proposed values.
Proposed equipment identity fields are visible separately from immutable captured
identity/address. Parts and hazard fields use bounded full-width rows through
the same renderer, so their source/correction details also survive print.

Red-first regressions reproduced the initial six omissions, two additional
exclusion/legacy-figure cases, the correction→exclude→confirm source loss, and
seven further identity/print-source gaps. Final operational coverage strips
screen-only folds and QC/audit text before checking all40 current canonical QC
targets. This avoids a false pass from incidental JSON or audit strings.

Fresh full Hub verification on final product source:588 files passed/4 skipped;
13,085 tests passed/53 existing skips. Log:task root guide-5237-final-unit.log.
Focused all-field/content/guide run34 passed; final print-flow guide run25
passed. Lint has zero errors/warnings. Typecheck still exits2 with the exact
159-line R0 baseline; no new changed-file error and no typecheck-green claim.
Diff and sitemap checks pass; current map remains70 pages/207 routes.
CodeGraph sync/preflight is READY at final product source6e77205a8, with the
healthy20-caller canary; imports/signatures were also checked in source/types.

The prior57-test real PostgreSQL receipt applies to the unchanged stores/routes;
this pure rendering follow-up adds no new database assertion. Task-owned PG is
stopped, with data/logs retained. Old5236 cloud CI remains35 successful checks
at8a54f29a7, and parent5235 remains56 successful checks at7d3a4654d. Those results
do not certify the unpublished follow-up.

## Actual browser and PDF

An independent31-target rich fixture passes actual Chromium CSS-visible text
checks in BOTH screen and print:zero missing effective values and zero missing
correction sources. The input and receipt are retained as all-fields-fixture.json
and visible-field-audit.json. Unit coverage spans40 targets, including exact
step/figure association, equal-basis differing decisions, unknown/excluded
states, repeated QC, inherited jobs and preserved original execution.

guide-synthetic.pdf is actual final-component Chromium output:5 A4 pages and
one fictional illustration. Every page was rendered with Poppler and inspected.
No clipping, overlap, blank page or orphaned step heading. Long detailed steps
flow across pages; their heading/action and field labels stay with content.
Ordinary short steps retain their keep-together layout. All five original F3
field families and their correction sources are visible. Original30-demo-unit
claim and50-demo-unit correction remain distinct. A412px view has scrollWidth412
and one visible image. This is a deliberately verbose engineering fixture,
not a promised customer page count or an accepted maintenance instruction.

All equipment, source text, identities and artwork are fictional. These fixtures
are development-exposed, not benchmark holdouts; workplace data was not used or
transferred. Underlying v2 exact-conversation/exposure capture stays explicitly
unknown. Artifact digests are in artifact-sha256.json.

## Bounds and pending publication

Captured UNS is an address fact only. The canonical finish-outbox INSERT still
writes asset_uns_path=NULL (finish-outbox.ts:162); no actual CMMS delivery is
established by this guide. No API/store/schema/outbox or peer-owned Work Packet,
core/mobile files changed. Hub2.57.0 is local release metadata, not a release.

Automatic approval review rejected publishing a RELEASED parent claim on5232
(including one narrower retry after checking ownership) and an ACTIVE claim on
5237 as organizational commitments without specific publication permission.
Neither executed. The existing parent claim remains ACTIVE. No push/new PR or
alternate route was used to bypass the rejections. Exact proposed notes and
reasons are retained in task-root claim-publication-approval.md.

The original product goal remains authorized; local work was prepared in this
session's already-owned guide files. Mike's subsequent Asset Memory mission
explicitly authorized the GitHub work. Scoped ACTIVE claim6677663412 was posted
on #5237 and reread without a competing writer. The denied operations were not
bypassed; materially new explicit permission resolved the publication block.
Old5236 head/body and its CONVERGED review remain frozen, with F3 tracked by5237.
The latest parent-directed follow-up is not an additional round on that PR.

After authorized publication, preserve the normal exact-head review/CI gates and
the stacked-draft main-base requirement. Dedicated reusable acceptance, automatic
new-step assembly from job updates, exact conversation/benchmark linkage,
UNS/CMMS adapter propagation and representative job/phone/human acceptance remain
separate unfinished work. No blanket human verification or safety clearance.

Rollback:local rollback/living-guide-qc-field-completeness-r0 at8a54f29a7. Reverting
the reader restores the known omissions; preserve source/history and do not
present that version as a complete accepted guide. No shared data/schema rollback.
