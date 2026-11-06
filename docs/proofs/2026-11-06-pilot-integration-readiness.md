# Pilot repairs: integrated source and release-readiness evidence

Status: local technical checks PASS. No successor review, actual CI, staging/production deployment, representative technician acceptance or Level3 approval is claimed.

## Exact source and preserved work

- Base: `090c8e15bfcbd85f0091103cf5a6f5fc6b221056`.
- Tested integrated source: `cf353c028e3e778084c1cdcfd3845ee8f28b7996`, Hub package2.60.0. The following proof commit changes documentation only.
- All three frozen repairs are preserved ancestors: PDF990032f13884c29acf6881f117d45826d1f42f2f; upload86fbe713f18b78698934897c319819fdf055398b; pilotb24eeeedc70ead775a55bcffdd8ee3ecd8a202a0.
- Five PDF/upload merge conflicts and two pilot version conflicts were reconciled in a task-owned worktree. The writer retains both NUL sanitation and the original attempt identity/row-lock fencing. Both CI suites and their exact fixture read permissions remain present. No duplicate implementation was built.
- No BRAVO observation, migration113, runtime-flag wiring, shared host UI or owner-held Work Packet file was edited. Original PR heads/bodies remain unchanged. All new commits use Codex CLI author/committer.

## New integration proof

A new permanent real-Postgres case writes the actual synthetic PDF under a valid upload attempt with NUL metadata, retries without duplicate chunks, cancels, then rejects resurrection by the revoked attempt. Removing filename NUL sanitation turns this exact case red at PostgreSQL; the tested source is restored byte-for-byte. CI now requires all three upload cases; a local replay passes the complete step and rejects a partial run.

The original permitted SMC-3 bytes were recovered with a SELECT-only staging transaction constrained to the previously recorded source ID and tenant. SHA2569272059d0a7c9007f9cbeb29daccea3ac5233466b432d624a9a76ece6a26f566,1,443,636bytes,4pages,10NULglyphs. The integrated writer preserves19private chunks with pages1–4, including the fenced retry/cancel path and foreign-tenant exclusion. Bytes and customer identifiers are excluded from this commit. This is parser/storage/lifecycle proof, not a real-model answer, rendered manual-page citation or proof that SMC-3 is installed on CV-101.

| Check | Local result | Private receipt |
|---|---|---|
| Full Hub unit suite | 597files,13,117passed;53existing opt-in cases skipped in4files | full-unit-verified.log |
| Permanent real-parser/fencing cases | 2files,5passed | integrated-real-pg-restored.log |
| Original SMC-3 variants | 2files,5passed;19chunks,4anchors | original-smc3-integrated.log |
| Migration113/114 order/upgrade/rollback compatibility | 7passed in disposable isolated schemas | migration-114-order-local.log |
| Required web command plus email tests | 7files,662passed | web-local.log |
| Real-component browser fixtures | 60assertions,390x844/844x390/1440x1000 | pilot-browser.log |
| Root-path Hub production build | PASS, provider credentials absent | build-root.log |
| Changed-file lint / read-filter guard / hooks | PASS | changed-lint.log, security-read-guard-final.log |
| CI upload step replay | complete0; partial1 | ci-replay/receipt.json |
| Mutation sensitivity | missing sanitizer fails joint case; exact source restored | joint-nul-mutation.json |

Initial full-suite attempts hit missing tracked sparse-checkout assets/contracts; those canonical files were hydrated without application changes. The final full suite is clean. Browser fixtures use mocked auth/APIs, block external requests and prove presentation/recovery only. Optional embed enrichment was unavailable in the disposable schema; live indexing, retrieval and provider/citation behavior are not proved by these database tests.

## Current deployed state and release gates

At this verification snapshot, Hub staging is090c8e15/v3.444.8; Hub production489088d4/v3.443.1. Web staging and production are188c2533, with productionv3.442.2. The public /pilot still404s. No candidate behavior is deployed.

Proposed release vehicle: reuse existing#4091 for the integrated technical repair, identifying#5038/#4960 as incorporated sources. Do not publish the code PR update until paid/shared-staging authority and budget admission are established. Existing#4091 ledger has4consumed rounds, next iteration5; request exactly one human-authorized post-cap review-only round, not a new ledger or autonomous loop. Preserve the source PR histories and do not merge their overlapping branches afterward.

The only verified existing cash cap is the cheap lane's0.10USD per invocation. No existing release-wide dollar cap was found for automatic PR review, staging judge/retry, backend fanout or retrieval/capture acceptance. The backend10USD default is per process/window, not an aggregate release allowance. Any proposed total in the approval packet is a new requested ceiling, not an approved balance or a measured estimate. Unbounded paths stay blocked until worst-case admission can be verified; no gate may be skipped to fit the cap.

## Migration and recovery limits

-099 is additive: nullable UUID attempt_id with gen_random_uuid() default; old rows remainNULL, no backfill. Exact SHA2563321dfee7de2ff0353f18b53368bfe4193f26e0145c1dfa53671574b384bd2ea. Staging already has the column but lacks its ledger entry. The PR's migration verification can apply DDL; it does not replace the sanctioned apply/ledger receipt. Never seed the ledger as proof.
-114 adds work_sheet_events, job_sheets, job_sheet_revisions, tenant RLS/append-only app grants, and widens existing event/delivery checks. Exact SHA2564bb2bcf9b2be0eae299ccdeb6eb531ddbf2d502d552de17e1a869211c22a079a. It is a release-drift prerequisite, not the PDF parser fix. It acquires schema locks (5-second acquisition timeout is not a5-second runtime guarantee), performs no backfill and changes no runtime flags. Existing enabled application paths can use the new storage once present.
-The sanctioned production114dry-run42244081686 succeeded; no114apply occurred. A future combined release also needs canonical099, so an114-only permission is insufficient for the whole candidate.
-Code rollback retains both additive schemas and all records. The SQL114rollback block deletes events and drops tables; it is not an authorized automatic recovery action. Code rollback is a forward deployment through the same staging/acceptance/drift controls, as docs/runbooks/rollback.md requires. Known-good Hub489088d4 image20f396af... and Web188c2533 image48dcf53a... were independently matched to production receipts. Both source compatibility checks report zero changed migration files lacking exact expand labels. Receipt freshness/generation must still be verified at release; these checks are not a complete rollback rehearsal.

## Separate acceptance dependencies

Guided#5247Back layering and#5248rejected drafts remain unfixed behind their existing shared owners. Consent#4930v2 is draft and Hub lacks a per-user versioned receipt. Terms#5126requires Mike's exact amendment/notice/effective-date decision; current Terms§10requires advance subscriber notice for material changes. No legal terms, active consent version, customer email or access flag changed here.

Garage-owner authentication, correct asset/manual association, fresh permitted PLC telemetry, BRAVO's separate113/flag activation, and representative real-technician/handover/private-thread acceptance remain independent. Do not accept synthetic practice or this local suite as Level3/production readiness. No phone was used, no equipment was operated, and no paid provider call/review runner, merge, deployment or shared migration apply was initiated.

Private evidence: `/Users/charlienode/Documents/Codex/2026-11-06/task/release-readiness-20261106-73ad9e`.
