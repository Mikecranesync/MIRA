# Pilot journey: emulator verification, 2026-11-05 Eastern

**Full pilot verdict: NOT YET ACCEPTED.** The staging Android-emulator capture → Living Sheet → Atlas → finish → independent handover path passed the scoped checks below. Physical Pixel/camera and two-real-technician acceptance have not run. This is not production readiness or full Level 3/customer acceptance.

## Candidate and environment

- Owner of this verification and migration repair: Codex CLI. Atlas recovery/runtime owner: existing Charlie session `vvmfyb3m`; no competing writer or worker was started.
- Source reviewed: `2b6061ee5f021b84989c7dc2097b76daa88dc0a8`; merged by [#5231](https://github.com/Mikecranesync/MIRA/pull/5231) as **`090c8e15bfcbd85f0091103cf5a6f5fc6b221056`**. The source and merge trees are identical.
- Staging Hub actually served that SHA, version **3.444.8**, build **2026-11-05T23:57:57Z**, throughout the trial. [Hub-only deployment 42133241935](https://github.com/Mikecranesync/MIRA/actions/runs/42133241935) succeeded with `reset_volumes=false`.
- Android **15/API35**, AVD `mira35`, device `emulator-5584`, Chrome **124.0.6367.219**. Playwright controlled this Android Chrome through its ADB-forwarded CDP socket; no desktop viewport was substituted.
- Existing dispatcher image: `sha256:4752de14fa3fe2d8496f2be94762d9a57499944caf68fff11cb6809edf43de0f`. Its MIRA source revision label is absent; inherited OCI labels identify Bun, not MIRA. Do not attribute the Hub SHA to this image.
- Atlas API image: `sha256:a112fa5831f9827c92ad7d436cff8ff7bc18116be1aab3ab09639793774e49a2`.
- Read-only runtime inspection: `CMMS_SYNC_ENABLED=false`; existing event dispatcher enabled only for QA tenant `00000000-0000-0000-0000-000000000099`. No flags, worker state, credentials or access changed.
- Production remained at `489088d4cc0f8d16c02036df891752120a0250da`; no production deployment or migration was made.

Verified emulator entry point: <https://app-staging.factorylm.com/v3/?notebook=d36d1927-d466-4cb4-8cad-3ce8394c3201>. Open **Job sheet → STAGING TEST - Codex emulator 5a2295**. An authorized QA-tenant session is required; no reachable physical-phone session is claimed.

The notebook is the existing **fictional** PUMP-01/Goulds 3196 fixture. Job **`04bce10d-1acc-4a21-b5ba-fa06d3d14b05`**, Atlas order **1652**. The image is an emulator-screen fixture named `EMULATOR-UI-FIXTURE-NOT-EQUIPMENT.png`; it is not machine evidence.

## Required gates

| Required behavior | Exact evidence/revision | Result | Existing owner / smallest next action |
|---|---|---|---|
| 113/114 order compatibility with empty and populated tables; preserve applied history | #5231 source 2b6061ee5; 7 PG cases, related 9 files/133 tests; current-head CI 42130593869, outbox job 127606190342 actually executed all 7 cases plus 9 request tests | PASS, local and CI separately | Codex CLI; repair merged. Proposed 113 was not promoted |
| Staging schema/ledger agree | Existing 114 DDL compared with canonical SQL; [ledger reconciliation 42133062149](https://github.com/Mikecranesync/MIRA/actions/runs/42133062149); fresh read-only check 132/132 canonical, zero drift, only correct 114 ledger row added, schema unchanged | PASS, staging | Codex CLI; no further staging migration. Production #5227 remains separate |
| Accurate attachment controls; work survives interruption/retry | #5228 merged 3020e45be; emulator checks E01/E03/E04 at deployed 090c8e15b | PASS for tested web/emulator scope | Codex CLI; physical camera/native behavior still requires Pixel |
| One correct Atlas order and finish record with independent readback | Job 04bce10d; order 1652; create event 2a9fe6a8-6df4-483d-9849-cbf73811fd7b; finish event 9d68cf61-e69e-46b3-9d9d-dcb4be3af6e5; E06/E07/E08 | PASS, actual staging | Existing Atlas owner + Codex verifier; keep fixture intact |
| Physical Pixel and two real technicians complete representative checklist | No human-run receipt exists | UNVERIFIED — mandatory | Mike: name second technician/time and authorize one fresh human test job/order before that run |

## Emulator scenarios

**11 scoped scenario checks PASS, 0 unresolved failures in that matrix.** Mandatory physical/human acceptance is unverified and is not included in that count.

| ID | Actual check and observed result |
|---|---|
| E01 | Live SHA/build matched. Photo/File enabled; Camera/Scan QR disabled with visible, associated “Requires the mobile app.” Closing Attach preserved the unsent draft |
| E02 | UI started exactly one titled job; server captured the notebook's confirmed PUMP-01 machine binding and Carlos QA authorship |
| E03 | Verified Chrome offline fault; note remained in durable local queue. Reconnect saved once. Exact frozen-event replay returned 200/replayed with the same event/sequence; canonical note count remained one for that marker |
| E04 | Actual Android Chrome file input uploaded the fixture to the real photo route. Canonical photo count one; image bytes rendered. Native camera prompt was cancelled; camera capture is unverified |
| E05 | Handover and reported finish persisted. Canonical stream has 6 distinct client IDs: start, two distinct notes, handover, photo, finish. Reload/reopen retained all data and authorship |
| E06 | Explicit create confirmation produced one request. Existing worker independently delivered it, attempts 1, verified_by_readback, external ref 1652. The initial 45-second poll was too short; delivery completed about 48 seconds after the request |
| E07 | Direct Atlas HTTP readback outside Hub: exact title, correct machine, source job reference, photo file reference and safety boundary. Complete two-page company scan found only order 1652 with the create marker |
| E08 | Exactly one non-system Atlas finish comment carried the finish event marker. Read-only DB also shows one verified finish delivery, attempts 1. Repeated work-order requests returned the same event ID/replayed; post-retry Atlas scan still found one order and one finish |
| E09 | Dana QA identity (same organization, manager role) independently opened the job through UI and recovered both notes, image, handover and finish attribution. This automated second account is not a real second technician |
| E10 | Existing nonempty Carlos-private conversation was readable by Carlos; Dana's history returned no private turn/thread. Other-tenant QA identity got 404 for notebook, sheet, work-order status and photo bytes |
| E11 | Force-stopped Android Chrome and launched its installed activity without supplying a URL. Same notebook/thread URL and login restored; all six events, image, handover, finish and order 1652 remained recoverable at the same live SHA/build |

Atlas order 1652 remains **OPEN**. The Living Sheet's reported finish is one Atlas note; it does not mark the order COMPLETE or assert equipment repaired, healthy or safe. No cleanup or order-status mutation was performed.

Same-organization diagnostics returned telemetry metadata (200) with no question/answer/prompt content fields, consistent with its established tenant-scoped contract. Private conversation content remained excluded from history. This is not a claim that diagnostic metadata itself is private per technician.

## Evidence and reproduction

Sanitized receipt: [pilot-emulator/receipt.json](2026-11-05-pilot-emulator/receipt.json). Direct Atlas receipts: [initial readback](2026-11-05-pilot-emulator/atlas-independent.txt) and [after request retries](2026-11-05-pilot-emulator/atlas-after-retry.txt).

Screenshots from the actual emulator:

- [Attachment availability](2026-11-05-pilot-emulator/attach.png)
- [Independent QA-account readback](2026-11-05-pilot-emulator/handover.png)
- [After actual Chrome process restart](2026-11-05-pilot-emulator/restart.png)

Full local acceptance report, scripts, screenshots, private QA setup and raw receipts are under:

`/Users/charlienode/Documents/Codex/2026-11-05/task/codex-pilot-journey-20261105T225657Z-5a2295`

Do not publish or copy its private account/key files. Reproduction scripts reference that task-owned directory and the reviewed worktree. Shared API writes require the same explicit fixture authorization; they are not safe to rerun blindly:

1. Read `RUN.json` and `emulator-trial.json`; inspect existing job/order before any write.
2. Read-only canonical check: `doppler run --project factorylm --config stg -- node <run>/emulator-canonical-read.mjs`. This uses verified TLS and `BEGIN READ ONLY`.
3. Independent Atlas check: `atlas-1652-verify-readonly.py`, adapted from existing `tools/stg_atlas_verify_1602.py`, executed via the existing pinned staging-deploy SSH route under `factorylm/stg`. It has no completion/cleanup branch. Both scans and their logs are retained.
4. `emulator-restart-verify.mjs` verifies the existing job; it does not create another.

Harness corrections are retained, not product defects: the first page-route network injection did not apply; a replay sequence assertion incorrectly expected top-level `seq` instead of `event.seq`; a diagnostics test incorrectly expected per-user 404 instead of the documented content-free tenant metadata; the generic Android launcher failed and CDP was initially polled before ready. The corrected checks used verified fault injection, actual API contracts and the resolved installed Chrome activity. No application code was changed to make these emulator checks pass.

## Limits and five-minute handoff

[Automatic acceptance 42133769385](https://github.com/Mikecranesync/MIRA/actions/runs/42133769385) produced a generation-matched PASS receipt for its defined retrieval/capture checks. That is narrower than customer answer acceptance: capture follow-up B and cancel/reconnect F/G returned 422; the receipt's ledger-closure checks still passed. A retrieval scenario honestly abstained on missing evidence. Those results do not prove a useful cited next step, successful conversational recall or cancellation behavior. No extra provider evaluation/review was started during this emulator trial.

No complete customer lane is promoted to Level 3 by these automated results. No Level 4/customer-value claim is made. Correct-manual/cited-answer learning-loop acceptance is separate and was not exercised by this capture/Atlas fixture. Drawing packet #5204 stays HELD.

Human run, after one fresh test job/order is authorized and two real technicians are named:

1. **0:00–1:00:** Technician A opens the staging entry on the physical Pixel, confirms the agreed permitted machine/task and starts the uniquely labelled acceptance job.
2. **1:00–2:00:** Capture the actual permitted photo and a short observation. Save a precise handover. Confirm Create work order once.
3. **2:00–3:00:** Wait for verified Atlas ID (allow the existing worker tick, up to 90 seconds). Record the performed/unfinished state honestly and finish the sheet; do not imply return-to-service authority.
4. **3:00–4:00:** Close/reopen the Pixel browser. Recover the same job, photo, note and handover. Technician B signs in independently with an already-authorized account.
5. **4:00–5:00:** B finds the record without A's private conversation and describes the next-shift action. The verifier compares canonical events and direct Atlas readback: one order, one finish note, no lost observation. Record both real names and their accept/reject judgment.

Stop on a missing source, access denial, lost record, duplicate or wrong machine. Preserve evidence. Do not replace it with a persona, mock or green CI result.

**Single next decision:** Mike supplies the second real technician/time and approves the one fresh QA job/order for the physical Pixel acceptance run. Until then, preserve order 1652 and this evidence; make no further shared writes.
