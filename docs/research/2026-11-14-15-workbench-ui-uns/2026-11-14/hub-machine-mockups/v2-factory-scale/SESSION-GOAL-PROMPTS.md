# Five session goal prompts

> Publication note (2026-11-15): archived research and observations from the date stated below, not a current release-status report or new authorization. See the [collection index](../../../README.md) and [private-evidence policy](../../../PRIVATE-EVIDENCE.md).


Each fenced prompt is under 3,000 characters. Prepared from Mike's frozen handoffs; not dispatched.

## BRAVO Codex — applicability, then equipment APIs

2846 characters.

```text
Goal: Finish the current source-correctness work, then deliver the bounded equipment APIs for the new FactoryLM UI.

Read DELIVERY.md, applicable AGENTS.md and the existing owner/claim records. Treat Mike's latest pasted handoffs as the starting state; do not assume later progress. CHARLIE Codex is already coordinator. Pilot scope is drive + MLC.

1. Finish #5510. Published 9d404675a passed CI, but BRAVO Claude's later round 2 found TWO NEW HIGH wrong-model electrical-value defects. Use the actual findings, add reproducing tests, repair them, and preserve the existing controls. Use only the reported remaining repair/publication grant. Send the exact head, body hash, tests and CI receipts to BRAVO Claude for the authorized final review; do not launch a duplicate review.
2. Hand the accepted source slice to CHARLIE Codex. Bind integration tests to the coordinator's actual candidate; never transfer old a857/42d results to a new tree. If the final review blocks, prepare the concrete repair/approval packet and continue independent planning within your authority.
3. After source closeout and an explicit path claim, implement factory equipment browse/search in the existing Hub capability layer. Reuse before building. Work with the CHARLIE ontology session on installed-instance versus notebook-component identity. Preserve canonical IDs, old URLs and the existing /api/assets array contract. Use bounded child reads and scoped server search, default page size 50, maximum 100, stable cursors and cancellation. No whole-plant download, LLM navigation, parallel asset store or new search service.
4. Test real PostgreSQL isolation and repeated tags/models using the agreed 20,000-component fixture. Prove authorized rows/counts, cursor boundaries, unknown/unplaced records and exact notebook/component resolution. Treat latency targets as measurements to collect, not achieved claims.

The shared UI roots belong to the CHARLIE component/UI writer; do not edit them. Coordinate migration/index changes with CHARLIE Codex; prepare and test them locally without applying shared-environment changes outside existing authorization.

At start, material changes, handoff and end: update your existing owner record in Mission Control/#5232 through the established reporting path, then read it back. Record plan revision, full SHA, evidence stage, review results, blockers, next action, owner/lease and remaining budget/authority. Link the receipt in your handoff. If publishing fails, save UNPUBLISHED locally and report the failure. Do not overwrite another owner's record.

Done: #5510 disposition is explicit and handed over; the API slice has exact-head tests and independent review evidence, or a concrete blocked handoff. No pilot/deployment claim from local tests. Existing push/review/spend/merge/deploy/device limits remain in force.
```

## BRAVO Claude — reviews and verification

2814 characters.

```text
Goal: Close the reviews and verification you already own, then prove the new equipment UI on the bench and at factory scale.

Read DELIVERY.md, applicable AGENTS.md and current claims. CHARLIE Codex coordinates; scope is drive + MLC.

1. Retain #5510's review lane. Your round 2 found two new HIGH wrong-model electrical-value defects. Wait for BRAVO Codex's corrected exact head, verify required CI, and run only the already-authorized final review. Record the exact head/body and verdict. Do not review the old published head as though it contains the new repair. If more authority is needed, provide the concrete findings and cost/round ledger.
2. Retain #5500 ownership. Resolve the cheap review's BLOCK-with-no-findings disposition honestly under existing governance. Reuse the independent 99-case SQL audit at its actual snapshot; retain its PostgreSQL 18 versus hosted 16 limitation. Do not commission a duplicate audit.
3. Finish/report the interrupted desktop sign-out/recovery checks. Preserve partial phone successes and untested answer steps. Send ambiguity needs verification; this chat's tablet sends do not establish universal phone behavior. Refresh #5544 generic-PDF recovery and #5545 runbook against the selected baseline; do not spend ungranted review rounds.
4. Adapt #5545 into the new UI verification loop: find Conveyor 1 without a project name; select VFD1/MLC; distinguish unconfirmed identity; ask or receive a correct refusal; open the actual cited page; save/reopen a job, note and photo; preserve draft/attachments through stale-selection recovery. Preserve the second-account and #5289 large-manual dependencies explicitly.
5. Prepare scale cases in parallel: 8 lines x 50 machines x 50 components, repeated MLC/VFD1 tags, identical models, another tenant/site, unplaced equipment and shared utilities. Coordinate fixture ownership. Test navigation, isolation, pagination, delayed responses and Back/reopen; do not certify database performance from a screenshot.
6. Run the authorized exact-candidate browser/device window with its lease. Mike reviews first; unfamiliar-technician and second-account checks remain NOT TESTED until actually performed.

Do not edit the shared UI files. Keep local, review/CI, staging, device and human evidence separate.

Update your existing Mission Control/#5232 owner record at start, material changes, handoff and end; read back the update. Include plan revision, SHA/build/device, actual pass/fail/not-tested results, receipt links, remaining findings, next action, lease and budget/authority. If unavailable, retain an UNPUBLISHED packet. Do not overwrite other owners.

Done: hand over explicit review dispositions and an acceptance packet naming every remaining gate. Preserve all existing spending, push, review, deployment and device limits.
```

## CHARLIE Claude component/UI — current fixes, then shared navigation

2830 characters.

```text
Goal: Finish acceptance of your merged component workflow, then implement the new equipment navigation as the sole shared-UI writer.

You own COMPONENT/UI, not ontology. Read DELIVERY.md, AGENTS.md, the UI cutover charter and current claims. CHARLIE Codex coordinates; scope is drive + MLC.

1. #5504 is already merged on staging v3.452.0/eab62164d. Do not restart the old F9/F10 unmerged-PR work. Complete the relevant drive/MLC acceptance cases from rehearsal revision 9, including streaming, stale selection, drafts and attachments.
2. Own the #5546 navigation obstruction reported to you. Reproduce and repair it in the permitted shared shell/adapter. Also reproduce the tablet semantic-retry gap: a retained question about "the selected component" must not silently become a whole-machine answer after another screen clears selection. Preserve the draft and attachments; show old/new targets, require explicit target review and a fresh Send. Keep server-side version validation.
3. Preserve #5542/#5536/#5537/#5538 as explicit follow-ups, not solved claims. Migration 115 is already applied; do not reapply it or claim rollback across it safe. Coordinate any tenant-boundary defect or observed-reading policy with the coordinator.
4. After reconciling your current claim, build the equipment-first navigation in the existing shared-shell fixture lab. You alone own packages/factorylm-theme, packages/factorylm-interaction, packages/factorylm-ui and apps/factorylm-ui-lab. Reuse the Hub adapter, Notebook persistence, source viewer and work-record capabilities.
5. Design: site > area > line/cell > machine > optional assembly > component. Search/recent items bypass the tree. Use compact rows, visible location for repeated tags, and an unambiguous question target beside the composer. Browsing must not silently change that target. Preserve old links and project permissions.
6. Use docs/design/factorylm-style.md and canonical tokens: flat surfaces, thin rules, readable text, restrained indigo actions; no gradients, AI sparkles, hero cards or decorative state. Connect drive + MLC first. Add paged factory navigation only after the backend/reference contract is ready.
7. Hand exact-head tests, screenshots and the implementation packet to independent Codex review. Static mockups are not runtime proof.

At start, material changes, handoff and end, update your existing Mission Control/#5232 owner record and read it back. Identify this session as COMPONENT/UI. Include plan revision, SHA/build, tests/review/device evidence, open gates, next action, lease and remaining authority. Save UNPUBLISHED if reporting fails.

Done: current defects have dispositions and new navigation passes staged acceptance, or a concrete blocker packet is handed over. Preserve existing publication/review/spend/merge/deploy/device limits.
```

## CHARLIE Codex — coordination and integration

2923 characters.

```text
Goal: Close the existing integration work and carry the equipment-first UI through one controlled bench-to-factory delivery plan.

Coordination is already yours. Read DELIVERY.md, current claims and ARCHITECTURE-PLAN.md/HANDOFF-RECONCILIATION.md in:
 /Users/charlienode/.codex/visualizations/2026/11/14/01a1da9d-4402-7993-ba21-3631ab6bcd1d/hub-machine-mockups/v2-factory-scale/
No work occurred beyond Mike's supplied handoffs. Scope is drive + MLC; the old inventory questions are settled.

1. Refresh local candidate 982f8aa4b from the selected current baseline and owner-approved heads. #5504 is merged into main, not another branch to add. Pin composition, final version, migration state and source hashes. Old passing tests stay attached to their old tree.
2. Retain #5415 authorship: refresh it after main/#5504 changes in an isolated checkout, preserve its safety/citation controls, and obtain another Codex's independent review. Do not approve your own code.
3. Track #5510 through the writer's two latest HIGH repairs and BRAVO Claude's final authorized review. #5500 remains BRAVO Claude's; reuse its completed audit. Select #5539/#5530 evidence and #5544/#5545 inclusion explicitly, without assuming they are merged or superseded.
4. Name an owner or bounded exclusion for #5289, #5540 and the ontology handoff's unowned #5520/#5524/#5527. Known wrong-model/scope/access defects affecting the chosen journey block acceptance. Live-state or graph features with unresolved truth defects stay out of the claimed pilot.
5. Preserve separate CHARLIE component/UI and ontology sessions. One writer owns all shared UI roots. Sequence current correctness closeout -> disconnected prototype -> connected drive/MLC proof -> bounded factory-scale APIs and identity mapping -> integrated acceptance.
6. Freeze the typed identity contract with ontology/backend owners before parallel implementation. No duplicate asset/chat stores or cosmetic UNS path migration. Prove that an installed-instance result resolves to the correct notebook component without tag/model guessing.
7. Compose exact candidate review/CI, real-database tests, feature rollback and leased device acceptance. Mike first, then real technician/account cases. Prepare one concrete release request; do not infer deployment, migration or extra review authority.

At start, material changes, handoff and end, update the existing Mission Control/#5232 coordinator record and read it back. Link each owner's record and exact-head receipts. Record plan revision, composition, local/review/staging/device/human stages, defects, next owner/action, leases and spend limits. Never convert an agent report into independently verified proof.

Re-estimate after source closeout and identity mapping. Current ranges: bench 7–12 working days; factory pilot 4–6 weeks from resume.

Done: one release/acceptance packet or explicit owner-addressed blockers; no orphaned work.
```

## CHARLIE Claude ontology — current evidence, then identity contract

2781 characters.

```text
Goal: Close the ontology work, then define and test the new UI's component identity contract.

You own ONTOLOGY, not component/UI. Read DELIVERY.md, AGENTS.md and current claims. CHARLIE Codex coordinates; pilot scope is drive + MLC.

1. Deliver #5539's exact-head review/test packet to the coordinator for inclusion. Retain #5530's shape-coverage work separately unless actual contents establish supersession. Distinguish offline tests, database tests, CI and runtime enforcement.
2. Preserve #5543's unpublished fix and review ledger. Prepare its next review packet within existing authority. The missing application trigger for retiring corrected relationships remains an unproven runtime gap.
3. Propose owners/dispositions for #5540, #5520, #5524 and #5527. Do not take another owner's files. #5540's command-as-feedback and unread-register-as-no-fault defects block live-state claims.
4. Map the existing canonical records: cmms_equipment, kg_entities, installed_component_instances, notebook_components/revisions and notebook selection/history. Verify actual keys, tenant boundaries, states and revision ownership in source. Equal UUIDs do not establish equal identity.
5. Define a typed, tenant-validated link from a browsed installed instance to its correct existing notebook/component target. Do not merge by local tag, model, name or path. Keep placement/catalog linkage distinct from notebook identity confirmation. Preserve old history, approvals and source applicability. Unresolved links remain visibly unresolved.
6. Keep containment separate from control/wiring relationships. Drives and motors can be siblings; shared utilities must not be duplicated under every line. Preserve current CV-101 IDs/UNS path. Full replacement-management UI and a graph rewrite are not prerequisites for the first navigation proof.
7. With BRAVO Codex, specify executable negative tests: repeated MLC/VFD1 tags across lines/sites; same-model instances; foreign tenant/project; ambiguous/missing links; stale identity revisions; retired/superseded facts; replacement not inheriting verification. Run real database paths where applicable. Make required database checks run in CI; skipped is not passed.

Do not edit the shared UI roots. Coordinate schema proposals with the backend writer/coordinator; no shared-environment migration outside existing authorization.

Update your existing Mission Control/#5232 owner record at start, material changes, handoff and end; identify ONTOLOGY explicitly and read back the update. Include exact heads, enforcement evidence, runtime gaps, owners, next action and remaining review/spend limits. If unavailable, save UNPUBLISHED.

Done: explicit PR dispositions and a grounded identity contract/test packet for the coordinator and backend writer.
```
