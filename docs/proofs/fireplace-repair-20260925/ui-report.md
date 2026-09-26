# UI repair handoff — 2026-09-25

## Start here — plain-language summary

This records repairs to the screens and buttons: saved conversations, opening photos, upload progress, and retry. Earlier automated checks passed. The main report explains what was subsequently tested on the phone.

[Read the complete plain-language report on GitHub](https://github.com/Mikecranesync/MIRA/pull/3999#issuecomment-5841521419). It separates what works, what still fails, and what has actually been published.

<details>
<summary>Technical test record for developers</summary>

Implementation: `89e21505da1ee4071edb7a7df9687867b71bc7e7` (`fix(mobile): preserve photo retry context and conversation reachability`). Integration already includes the existing #3845 attachment and #3807 Sources repairs. No replacement architecture or case-specific diagnostic answer was introduced.

## Root causes and repairs

- **#3994:** Fresh notebooks synthesized their legacy row only while server summaries were empty. Adding a draft hid that row; populated named drafts also remained only in the temporary overlay and disappeared on switching. Preserve the legacy summary when opening a draft, and promote completed sends into the root navigation cache. Real root/screen regression sends in legacy and named conversations, then switches both directions and checks restored text. Existing abandoned-empty-draft control remains green.
- **#3995:** Photo evidence cards had no action, and the adapter displayed raw persisted basis enums. Add an optional photo-open host hook and reuse `Sheet`/`FilePreview` with authenticated `requestBinary` and local blob URLs. Existing media viewer remains the zoom/view implementation. Use conservative friendly provenance; workspace evidence is not assumed to be a photo.
- **#3996:** Attachment composition occurred before host send state, leaving preparation invisible. Show immediate preparation status and block repeated send while composition runs.
- **#3998:** Local attachment failure retained bytes but never set host `canRetry`; the shared error surface also required a prior turn ID. Expose explicit retained-attachment retry independently of host text failure, including a photo-only first turn. Preserve the original failed question, clear only its unchanged draft on retry, and discard retained photo bytes when a later plain send supersedes it. Negative control verifies a subsequent failed text request retries text only.

## Red/green evidence

- Initial new chat tests: **2 failed / 14 passed** (missing preparation acknowledgement; stale restored text draft), then **16 passed** after repair.
- Fresh legacy navigation regression: **1 failed / 21 passed** before repair; initial photo/provenance regression also failed on raw `workspace_evidence`.
- Adjacent retained-photo isolation regression: **1 failed / 17 passed**; a later text retry incorrectly called photo upload again. Fixed by dropping superseded retained bytes.
- Real root/screen named-thread regression: **1 failed / 1 passed** before completed-thread promotion (named item disappeared), then **2 passed** with legacy and named text restored.
- These behavioral failures and fixes are included in the final complete-suite result below. A stale DOM reference and a duplicate-text query encountered while authoring tests were test-harness mistakes, corrected before relying on those tests; they are not product findings.

## Final automated verification

- `cd mira-mobile && npm test -- --reporter=dot`: **793 passed**, **62 files**, no failures.
- `cd mira-mobile && ./node_modules/.bin/tsc --noEmit`: clean.
- `cd apps/factorylm-ui-lab && bun test ../../packages src`: **252 passed**, **22 files**, no failures.
- `git diff --check`: clean at handoff.
- Logs: `/tmp/fireplace-mobile-final.log`, `/tmp/fireplace-shared-full.log`, `/tmp/fireplace-ui-tsc-final.log`. Earlier red logs use `/tmp/fireplace-ui-red*.log`, `/tmp/fireplace-root-red.log`, and `/tmp/fireplace-history-red.log`.

## Physical validation boundary

Root owns phone/build execution. At this report's creation, root reports that the mounted-project Sources panel/sheet opens and preparation acknowledgement appears immediately (29 ms). These are root's ongoing physical observations, not independently executed by this worker. Original-photo viewing, both conversation-switch directions, failed-photo explicit retry/exactly-one send, dismiss isolation, and unchanged-versus-edited text draft retry still require root's physical acceptance record. Automated success does not establish device or diagnostic acceptance.

Private photos, screenshots, and phone/backend evidence remain local and must not be published. This worker performed no commit, push, install, deployment, or device action; root created the integration commit. No source edits followed this handoff.

</details>
