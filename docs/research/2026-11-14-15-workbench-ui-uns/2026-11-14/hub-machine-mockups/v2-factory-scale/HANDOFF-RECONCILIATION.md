# Reconciled agent queue — current handoffs to new equipment UI

> Publication note (2026-11-15): archived research and observations from the date stated below, not a current release-status report or new authorization. See the [collection index](../../../README.md) and [private-evidence policy](../../../PRIVATE-EVIDENCE.md).


Date: 2026-11-14. Planning only. Source of current work: Mike's pasted handoffs and his explicit statement that the agents have done no additional work since the interface concern was discovered. This document does not infer progress from time elapsed, proposed work or an old green check. Later handoffs supersede earlier ones where they conflict. This chat's limited tablet proof supplements them but is not their full acceptance run.

## Decisions already settled

- Integration coordinator: CHARLIE Codex. The later handoff confirms the coordinator transfer; do not request it again.
- Pilot inventory: drive + MLC only. The six earlier questions about a 19/21-row full inventory are not blockers for this increment. The 19 seeded rows are not an expansion of scope.
- #5500 owner: BRAVO Claude. The existing independent SQL audit is retained at its tested snapshot; do not dispatch another identical audit.
- #5504: merged and reported on staging as v3.452.0 / eab62164d. Earlier instructions to fix F9/F10 as an unmerged PR are obsolete. Device acceptance and later follow-ups remain outstanding.
- Integration candidate 982f8aa4b: local-only and predates the latest composition/staging facts. Its tests remain evidence for that tree, not a ready release of the current combined work.
- Migration 115: already applied by the reported approved staging workflow. Do not activate it again. Rollback across it is not established safe.
- Whole-factory hierarchy is a design target. It does not reopen all bench-inventory questions or authorize migrating production equipment.

## Sessions and immediate queues

The handoffs name five distinct sessions across four machine/tool lanes: CHARLIE has Codex plus separate Claude component/UI and Claude ontology sessions. Preserve that distinction even if only four sessions will be active concurrently.

| Session / current owner | Last reported state | Finish now | Transition to architecture work |
|---|---|---|---|
| BRAVO Codex — applicability writer | #5510 published 9d404675a and CI passed. The later BRAVO Claude round-2 handoff found two new HIGH wrong-model electrical-value defects and reports one further repair plus final review was granted. No later repair push was reported. | Repair those latest two findings, preserve the regression controls, publish only within the existing grant, and hand the exact head/body to the existing review operator. Old CI does not clear the new findings. | Only after the source slice passes its required review and is handed over: bounded equipment search/read APIs. Coordinate identity mapping with the ontology session. No simultaneous speculative rewrite of retrieval. |
| BRAVO Claude — review and verification | Owns #5500; cheap review returned BLOCK with no findings. Owns #5544 generic-PDF recovery fix and #5545 runbook drafts. #5510 final review awaits the writer. Phone onboarding/persistence had partial passes, but answer checks did not run; desktop rerun was still incomplete at handoff. | Finish the authorized #5510 review on the new exact head. Resolve the unusable #5500 review disposition under the existing review ledger; retain the 99-case audit and its PG18-vs-CI-PG16 limitation. Finish/report the in-progress sign-out/recovery checks. Prepare #5544/#5545 against the selected baseline; reviews beyond existing grants remain ungranted. | Keep this session in verification. Reuse #5545 as the new UI acceptance script, add repeated-tag/scale fixtures and run the physical-device loop. Do not move this owner into shared-shell implementation. |
| CHARLIE Claude — component/UI session (Opus handoff) | #5504 merged; staging and retrieval checks green. Rehearsal revision 9 still awaiting the actual tablet walk. #5546 drawer obstruction was reported to this owner; no subsequent fix reported. Follow-ups include #5542, #5536, #5537, #5538 and migration-115 rollback uncertainty. | Address #5546 in the permitted shared shell/adapter, then re-run affected device cases. Preserve the server selection-version boundary. Reproduce the tablet-proof semantic-retry issue: a retained question about a selected component must not silently become an answer about the whole machine. Complete the drive/MLC subset of relevant acceptance rows, including streams, stale selection, drafts and attachments. | This is the natural sole shared-UI writer. After its current fixes/claims are reconciled, build the new navigation in the existing fixture lab, then connect the same notebook/component capabilities. Do not assign its role to the ontology session by calling both merely CHARLIE Claude. |
| CHARLIE Codex — coordinator and #5415 author | Coordinator handoff complete. Local integrated candidate 982f8aa4b passed its local suite/build but is not deployed or current-composition acceptance. #5415 local b4de24e42 needs refresh after #5504/main movement; earlier GREEN belongs to an older snapshot. | Freeze one updated composition from current main and owner-approved heads; remove duplicate inclusion of already-merged #5504. Refresh #5415 only in its isolated checkout and obtain independent review. Pin final Hub version, exact database/migration state, remaining findings, rollback and device window. Reuse compatible evidence without carrying old verdicts onto new commits. | Own architecture/contract coordination, candidate composition and release reporting. Review other authors' UI/API work, but arrange another Codex reviewer for #5415 or code this session authors. No parallel shared-core writer. |
| CHARLIE Claude — ontology session (Fable handoff) | #5539 has independent review and automated passes. #5543 graph repair is shelved with a known medium issue and a local unpublished fix. No runtime trigger retires corrected relationships; real-database tests are not in CI. #5540, #5520, #5524 and #5527 were reported unowned. Earlier #5530 shape-coverage work remains a distinct draft unless explicitly shown superseded. | Supply #5539 and the earlier shape inventory as integration evidence, with exact heads and limitations. Have the coordinator select inclusion; do not independently merge. Preserve #5543's local fix and identify the remaining review/runtime gap. Give the coordinator an explicit ownership/disposition list for the unowned issues. | Own the identity/record mapping contract and its negative cases, working with the backend writer. Graph repairs only become prerequisites where the new workflow actually reads those paths; no claim of runtime protection from offline shape tests. |

## Dependency order

### 1. Close the correctness lane while preparing the design
BRAVO Codex completes the source repair; BRAVO Claude reviews it. CHARLIE component/UI owner repairs the obstruction and context-retry UX in its existing scope. CHARLIE Codex refreshes composition and #5415. Ontology supplies a factual constraint/test packet.

Read-only design, fixture design and the identity map can proceed in parallel. The disconnected UI prototype may proceed when the sole UI writer has a clean, non-overlapping claim. No one abandons an outstanding wrong-answer fix to start search pagination.

### 2. Produce one minimal reviewed bench baseline
The coordinator decides the exact included heads:
- Already-merged #5504 is part of main, not a branch to re-add.
- #5510's latest corrected/reviewed head is the source-correctness candidate, not automatically the old published 9d head.
- #5500 and #5415 remain existing integration/review work; reuse them only after their current gates clear.
- #5539 supplies useful contract tests; it is not proof that #5543 or all ontology rules run in production.
- #5544 enters when its pending-manual recovery fix is needed for the supported upload/recovery journey and its required review clears.
- #5545 is the acceptance/runbook source, not a competing UI implementation.
- Keep #5530 separate from #5539 until their actual contents/supersession are recorded.

Final acceptance runs on this exact composition. A combined branch passing unit tests does not satisfy independent review, staging or device gates.

### 3. Deliver the first new-interface proof on drive + MLC
The component/UI owner changes how users find and open the existing machine/components. The coordinator integrates it; BRAVO Claude verifies it. Preserve machine identity, notebook/thread history, source links, server selection checks and work records. Test search/find → correct component → supported answer/refusal → source page → save/reopen.

Do not wait for a complete plant register or a 20,000-component migration to demonstrate this improvement.

### 4. Expand to the factory-scale architecture
When source-correctness ownership is handed over, BRAVO Codex takes bounded browse/search APIs. The ontology session owns identity mapping semantics and cross-instance/retirement tests. The same UI owner connects paged navigation. BRAVO Claude adds scale/device cases. CHARLIE Codex reviews the integrated candidate and keeps one release packet.

## Explicit blocker disposition

- #5510 wrong-model values: blocker for accepting paths affected by that source-admission logic. Keep source writer and reviewer together until cleared.
- #5546 blocked navigation: immediate UI defect, included before a technician navigation acceptance claim.
- Tablet Send ambiguity: BRAVO Claude retains verification. This chat did produce real sends on the tablet after an initial keyboard-intercepted tap, so do not describe Send as universally broken or universally proven; verify the actual phone/tablet flow and retain the intervention.
- #5289 large drive manual: remains with its established owner. Do not reassign silently. It blocks the original full drive-baseline assertion if still required; the coordinator must explicitly own the dependency. A smaller-document demo is a narrower proof, not a substitute pass.
- Second technician reopening a record: requires the real second account and remains NOT TESTED until available. The first Mike/agent walk can proceed, but cannot claim this acceptance.
- #5540 RUN-command/unknown-fault summary: no live-state claims in the first manual/component UI proof. If the summary remains exposed in the chosen journey, repair it with an explicit owner before acceptance. Do not show reassuring state derived from commands or unread registers.
- #5542 concurrent identity-save error: reported fail-safe, not a wrong-answer finding. Preserve it as a named follow-up; it still needs a passed concurrency acceptance case before claiming that behavior supported.
- #5536 ownership keys / proposed migration 116: not an automatic authority to migrate. Prove the current tenant/ownership boundary for any chosen scope; an unresolved access defect blocks wider use even if its schema work was originally deferred.
- #5538 machine readings in component answers: limit the first proof to documented component questions; record the policy decision before extending to live/observed readings.
- #5543 and its missing runtime trigger: do not claim corrected graph facts are retired in real use. A graph-dependent feature must wait for this chain; basic equipment navigation need not.
- #5520/#5524/#5527: coordinator assigns explicit owners or documents an exclusion with user-visible capability limits; do not relabel them solved because a contract test passes.
- Review caps, paid budgets, guarded paths and device leases remain those in the handoffs. This plan grants no new push/review/merge/deploy authority.

## Reconciled schedule

The prior estimate assumed a cleared integration baseline. These handoffs show it is not yet cleared.

Planning allowance for current repair/review/composition closeout: 2–4 working days if the already-reported final repair passes review and required review windows are available. This is an allowance, not a promise or a new review budget. New HIGH findings, unavailable approval/account/device windows or the large-manual dependency can extend it.

- Interactive navigation prototype: 1–2 focused working days once the UI writer is available; can overlap independent closeout work.
- Connected new-interface bench acceptance: approximately 7–12 working days from a coordinated resume (2–4 closeout + earlier 5–8 implementation/acceptance estimate), with overlap potentially shortening it.
- Bounded factory-scale pilot: use 4–6 working weeks from resume as a provisional range, then re-estimate after the corrected baseline and identity-map audit.
- Keep the architecture effort estimate separate from pre-existing repair work. Do not charge existing passing audit/fixture work as if it must be rebuilt.

## Handoff/reporting changes

Each owner should continue the existing lane record in Mission Control/#5232 with current PR/head, evidence stage, remaining findings, next action and authorization limits. Distinguish the two CHARLIE Claude sessions in the owner text. A handoff becomes complete only when the recipient acknowledges the concrete packet and the authoritative status is read back.

This reconciliation is local and undispatched. No owner record, lease, PR, budget or deployment was changed.
