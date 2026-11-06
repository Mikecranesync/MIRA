# Asset Memory first read slice

> For agentic workers: use superpowers:executing-plans or bounded
> subagent-driven development; one product writer, independent exact-head review.

**Goal:** Connect one saved job and exact QC candidate to the existing Guide,
Living Sheet selection and notebook answer, with a bounded dated current overlay.
**Spec:** [North Star](../../NORTH_STAR_ASSET_MEMORY.md) and
[audit](../../discovery/2026-11-06-asset-memory-inventory.md).
**Authority:** Mike explicitly requested autonomous safe implementation, local
verification and GitHub PR preparation. No new generic design-approval stop.
**R0:** `rollback/asset-memory-r0` at
`d91536ab6fbfd0d0382123cebf1bb31d0f9256ed`; isolated existing checkout.
**Risk:** R3: identity, temporal evidence, tenant/viewer privacy and maintenance
provenance. No schema, external-source write or release operation.

## Decisions from the audit

Reuse the existing full `InstructionRecordV2`; do not change v1/v2 storage or
create another writable record. An opt-in/enriched v2 read returns an intersection
`AssetMemoryRecord = InstructionRecordV2 & { assetMemory: Projection }`.
The shared server projection contains an exact historical selector and bounded
facts; graph/observations/source admission/CMMS status remain a dated current
overlay. A persisted answer retains the actual bounded overlay in existing
viewer-owned turn `evidence[]`. This is not historical replay of every upstream
store or automatic promotion into approved knowledge.

The existing chat admission and evidence-sufficiency gates do not count Living
Sheet records as approved OEM evidence. Preserve those gates. This slice augments
an existing admitted-document/general chat journey; it does not establish a
standalone job-only answer path. Test the representative answer through the
existing admitted path and record job-only readiness as a remaining gap.

Selector: `{seq, snapshotId, candidate: null | {id, revision, hash}}`.
Omission on initial preview selects latest once; the response returns an
explicit selector. Explicit null means source-only forever. Wrong/missing pins
fail closed and never fall back to latest.

## Product file boundary

1. New `mira-hub/src/capabilities/living-sheet/asset-memory.ts`: server-only
   read orchestration plus pure bounded projection and selector validation/hash.
   Client code imports types only; no DB/crypto runtime import into the browser.
2. Existing `.../sheets/[jobId]/route.ts`: opt-in enriched v2 read with exact
   selector parsing. Ordinary/v1/v2 compatibility remains tested.
3. `factorylm-ui/living-sheet-client.ts`: typed opt-in read and selector transport.
4. `LivingInstructionControls.tsx`: hold and publish the server-selected selector,
   refresh explicitly after QC; no silent switch during prepared send/retry.
5. `LivingInstructionGuide.tsx`: screen/print section from the same projection,
   separately labelling historical core and current overlay/coverage.
6. `LivingSheet.tsx`: selector callback/clear through existing open-sheet seam.
7. `hub-host.tsx`: outgoing selector after existing rider, notebook/job scoped;
   retry retains the actual serialized outgoing body. Do not edit host-logic.
8. Notebook chat `route.ts`: validate pin after idempotent replay but before
   translation/provider work; F18 uses the shared data-channel projection;
   persist bounded manifest for served answers and suppress post-hoc mutable
   sheet receipts for pinned requests/replays. Ordinary requests keep behavior.

Separate follow-up #5240 adds a red-first exclusion regression and the smallest
GuideMeasurements fix on this new branch. Frozen converged #5239 head/body and
review budget are unchanged. This supports the North Star's exclusion lineage,
not another review/remediation round on that PR.

No edits to graph/observation/retrieval/outbox/protocol/core/mobile owner files.
Additional tests live alongside the existing route/guide/client test suites.
Hub minor release metadata follows current versioning doctrine; root VERSION
is retired. Generated sitemap changes only if the existing route inventory needs
them. Documentation/proof work remains coordinator-owned.

## Steps and acceptance checks

- [ ] Read/claim exact integration hunks and post-claim collision check. Source
  and connector audits are complete; owner delivery is not a file handoff.
- [ ] Red-first exact selector tests: same job seq/hash, candidates A then B;
  selected A stays A, explicit null stays source, initial latest is B. Existing
  `getJobSheetRevision` plus metadata validation provides exact selection; do not
  add a candidate store. Check tenant/notebook/job/revision/hash/source sequence.
- [ ] Loader first proves notebook/job scope, sequence equality and existing
  snapshot hash. Captured machine/UNS is immutable. Resolve current notebook
  binding separately. New pinned chat requires confirmed same asset; historical
  preview remains readable after rebinding. Legacy selected-job context must
  not contaminate a different currently bound asset.
- [ ] Reuse `maintenanceContext(...,{includeSimilar:false,maxWorkOrders:...})`
  for the saved machine key. Check returned equipment/children tenant and
  identity. Project verified principal equipment/hierarchy/components/manual/WO
  references only; exclude PM mismatches, similar assets, arbitrary properties
  and recommendations. State missing edge/reviewer/version metadata explicitly.
- [ ] Reuse observation flag, bounded `listProjectionRows`, pure projector and
  summary, including contributor IDs/author/both clocks/contest/uncertainty.
  Disabled, empty, unavailable and limited are distinct. Never load private chat
  as shared asset memory or select raw observation reports.
- [ ] Graph and imported manual references stay references/claims. Existing
  `validateChatSources` must separately admit any bounded explicit document set.
  No chunk retrieval/re-ingest or generic approval. Reuse work-order request
  status after job scope; do not equate saved/queued/delivered with repair,
  completion, asset FK or UNS propagation.
- [ ] Bound added prompt/manifest to24KiB UTF-8 with count/string limits and
  explicit omission/coverage metadata. Preserve the complete existing record.
  The bounded history summary is not presented as a complete procedure. Hash
  facts separately from capture interval; changed values change content hash.
- [ ] Exercise original/corrected/excluded fields, done versus planned work,
  original source links and unresolved questions in the shared projection and
  both human views. Keep observations/OEM claims/QC/acceptance/safety separate.
- [ ] Exercise Controls→Sheet→host send selection, job/notebook switches,
  out-of-order loads, later QC, retry after UI changes and pending execution.
  Do not attach a stale selector or silently reload latest on retry.
- [ ] Exercise served-turn manifest and idempotent replay before current reads;
  no new provider/current-read/receipt/proposal on completed identical replay.
  New rebinding request, wrong scope/pin and permission failures spend no provider
  call. Error/stopped/safety-only answers do not claim unseen context.
- [ ] Run focused unit/route/render tests, full Hub suite, scoped lint/typecheck,
  sitemap/diff and CodeGraph sync/preflight. Compare typecheck with the exact
  known baseline. Do not introduce or apply a migration. Use existing synthetic
  fixtures/local test infrastructure; no shared industrial/CMMS writes.
- [ ] Render actual component screen/print at412px and inspect every PDF page
  when visible output changes. Evidence is fictional/development-exposed, not
  workplace material, clean holdout or human acceptance.
- [ ] Fresh pre-push overlap check; draft PR against preserved guide branch;
  finalize body, required CI and trusted-base read-only adversarial review.
  Converged ends that PR's loop under existing SDLC. Record exact revisions,
  tests, omissions, rollback and promotion gates; no unauthorized merge/deploy.

## Deliberate limits

Existing PUMP-01 QA job04bce10d…/Atlas1652 is the reference control, with unknown
historical UNS and unlinked external asset. Synthetic local contract fixtures
may model missing components/sources but do not establish those links live.
The new view does not promise full historical graph/document versions, automatic
answer-to-guide discovery, every imported citation's immutable bytes, later
reusable acceptance, device restart recovery or physical/human acceptance.

## Independent builder check disposition

Fresh read-only check at55212dbb4 found the eight-file boundary implementable;
no new human architectural decision is needed. Admission remains unchanged as
stated above. Apply these concrete constraints:

- Candidate hash covers canonical revision body. Validate captured asset as
  well as revision/job/notebook/sequence/source snapshot. Explicit null retains
  imported prior-job provenance but never selects a current QC candidate.
- Legacy A-to-B protection also covers the post-hoc receipt/proposal wrapper;
  matching-or-unbound scope applies to both legacy prompt and receipt. This is
  the narrow exception to retaining ordinary unpinned behavior. Pinned completed
  replay bypasses current loading and the receipt wrapper entirely.
- Build the projection once after completed-turn replay and before translation
  or provider work. Persist that exact JSON for served answers. Content hash
  covers values, admission, adapter version, limits and omissions; only capture
  clock fields are excluded. Final UTF-8 size includes omission metadata.
- Controls uses a request-generation key for notebook/job/sequence, not merely
  an alive flag. Sequence changes or pending execution invalidate the selector;
  stale completions/cleanup cannot clear or overwrite a newer selection.
- Freeze outgoing decorated body and notebook target once. Retry bypasses rider
  decoration and cannot substitute today's job/selector or a different target.
  UI changes during a failed send must not mutate its original request.
