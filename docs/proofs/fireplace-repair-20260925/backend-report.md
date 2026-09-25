# Backend repair checkpoint — 2026-09-25

Candidate base: `7e45def2b98898861041a23104dd5b7224c307a8` (root's combined current-main + existing navigation/retry repairs). Root subsequently committed backend as `32787374d`. This worker made no commits, pushes, deployments, DB operations, provider changes or live API calls. Physical candidate grading is still required. Original staging observations were on older `24f90b7`; these causes were inspected in current candidate source.

## Causes and changes

- `buildFollowupSuggestions` treated any generated parameter-shaped token as an editable parameter. It now requires an exact token and parameter/fault classification together in retrieved reference text. Generated answers and photo OCR cannot establish that authority. Chat passes only retrieved `ManualChunk.content`; documented parameter/fault positive controls remain.
- Chat discarded all earlier photos when a new image was attached, and only recalled the newest two on text follow-ups. It now retains up to12 distinct same-conversation observations, excludes current attachment from prior context, orders prior photos chronologically, and scans up to24 historical turns for compatibility. `loadRecentLookObservations` keeps existing owner/notebook/thread/tenant/link/rejection predicates and widens bounded LIMIT to12. No global notebook-image fallback.
- The general prompt forced every answer to start with a likely cause and checks, even neutral photo questions. It now answers observations first, establishes symptoms before ranking hypotheses, distinguishes operator evidence from assistant guesses, and forbids hidden wiring/contact/program-logic inference.
- The safety floor missed present-voltage and powered-relay checks under LOTO headings. New instruction-anchored rules reject those shapes. Passive drawing/display/LED descriptions, absence-of-voltage guidance and prohibitions pass. Existing hazard rules were not removed or narrowed. Semantic judge explicitly considers contradictions across headings/list items.
- LOOK instructions preserve printed names/AC/DC/relay IDs, distinguish drawings/hardware and screw faces/indicators, and require local uncertainty. These prompt edits do not prove vision accuracy. No case-specific fan/current-transformer/PLC-input/repair solution was encoded.

## Verification

- Initial red:7 failures /118 pass in3 files, reproducing suggestions, lost context (0 or2 instead of5), unsafe present voltage.
- Additional red controls: exact F01 vs F010 token; powered relay under LOTO; passive drawing/display imperatives; general prompt contracts.
- Full Hub `npx vitest run`: **295 files /3876 tests passed**. Subsequent test-only return-type fix: affected five-photo file rerun13/13.
- Five-photo test uses real prior-photo renderer and asserts every oldest→newest description reaches canonical provider messages, both text-only and with current attachment. Existing unverified-photo/empty-history controls pass.
- Prompt string assertions are instruction contracts, not generative quality tests.
- `tsc --noEmit`: **33 candidate diagnostics, identical to33 baseline diagnostics** in isolated HEAD archive with same installed dependencies. Existing test/e2e errors include asset chat null cast, CMMS SSO mock tuple, nameplate DiscoveryResult mocks, Mira ask context/cascade/PoolClient mocks, drive-pack PoolClient mock, e2e options/cookies. No new diagnostic after test type fix. Disposable archive removed after comparison to free disk; logs retained.
- `git diff --check` passed.

Logs and complete backend patch are in `backend-tests/`. Private original photos are not present in these artifacts.

## Grounded symbols and runtime

Modified existing definitions/call sites: `buildFollowupSuggestions`, `loadRecentLookObservations`, prior-photo assembly in notebook chat, `GENERAL_SYSTEM_PROMPT`, `INSPECTION_PROMPT`, `HAZARD_AFFIRMATIONS`, `JUDGE_SYSTEM`. New optional function argument `referenceText` is supplied by existing `ManualChunk.content`. No new DB columns, services, models, endpoints or modules.

Originals park in `namespace_direct_uploads.content` BYTEA, not filesystem. LOOK uses existing Together key/model. Detector service is optional via `NAMEPLATE_DETECT_ENABLED=1`; otherwise original pixels are passed.600-token LOOK output cap remains unchanged pending actual extraction evidence.

## Outstanding

Root must grade fresh physical candidate photos, retain raw LOOK separately from answer, and test exact labels/AC/DC, no invented wiring/logic, context continuity, usefulness and unsafe opposite controls. #3982 is not declared fixed: generation could still add unrequested checks; existing A4 behavior remains. Do not loosen safety from the old passive-question observation alone. #3984 remains OPEN. No release/merge claim.
