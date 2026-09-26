# Backend repair checkpoint — 2026-09-25

## Start here — plain-language summary

This records repairs to the part of MIRA that reads evidence and writes answers. Software checks passed, but real photo answers still contain mistakes. Later emulator findings supersede any older progress claim below.

[Read the complete plain-language report on GitHub](https://github.com/Mikecranesync/MIRA/pull/3999#issuecomment-5841521419). It separates what works, what still fails, and what has actually been published.

<details>
<summary>Technical test record for developers</summary>

Candidate base: `7e45def2b98898861041a23104dd5b7224c307a8` (root's combined current-main + existing navigation/retry repairs). Root subsequently committed backend as `32787374d`. At the first checkpoint this worker made no commits, pushes, deployments, DB operations, provider changes or live API calls. Subsequent explicitly authorized local diagnostics are recorded below. Physical candidate grading is still required. Original staging observations were on older `24f90b7`; these causes were inspected in current candidate source.

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

Originals park in `namespace_direct_uploads.content` BYTEA, not filesystem. LOOK uses existing Together key/model. Detector service is optional via `NAMEPLATE_DETECT_ENABLED=1`; otherwise original pixels are passed.The original 600-token LOOK cap was subsequently changed after the live truncation evidence below.

## Outstanding

Root must grade fresh physical candidate photos, retain raw LOOK separately from answer, and test exact labels/AC/DC, no invented wiring/logic, context continuity, usefulness and unsafe opposite controls. #3982 is not declared fixed: generation could still add unrequested checks; existing A4 behavior remains. Do not loosen safety from the old passive-question observation alone. #3984 remains OPEN. No release/merge claim.

## Second checkpoint: observed backend failures and bounded repairs

Normal synthetic QA authentication against the isolated local HTTPS Hub was used for five original-photo controls, never a physical UI acceptance claim. Originals and raw LOOK versus served chat remain separate under the gitignored `private-backend-diagnostic/` directories. No held-out repair facts were supplied. No remote configuration, deployment, credential reset, or commit was performed by this worker.

Actual boundary failures: LOOK accepted malformed/truncated JSON as healthy prose; provider finish reasons were discarded; chat marked length-truncated text answered; prior-photo context could displace the current image; generic requests for an installation manual triggered a fabricated-document gate and irrelevant restart guidance. Raw vision also invented exact labels and electrical meanings. The latter is **not resolved** by deterministic test success.

Changes in existing carriers:
- `VisionCall`/`togetherVisionCall` retain optional finishReason. LOOK rejects explicit non-stop completion and malformed schema, permits complete escaped-object JSON only after strict parsing, and retries once (1200 then1600 output tokens). No malformed prose success fallback.
- `INSPECTION_PROMPT` requests <=180 words and <=8 legible labels with locally unresolved regions. It distinguishes fasteners/indicators and channel names/actual settings. This is an instruction, not proof the model follows it.
- Chat puts current-photo evidence nearest the question, keeps earlier comparisons, and removes the contradictory instruction to supply typical device-specific meanings without a matching reference.
- Chat rejects non-stop finish reasons and abrupt EOF without stop or explicit SSE DONE. Partial output is not persisted as answered. DONE remains supported for existing provider streams. `general-mode.test.ts` demonstrates length/content_filter/tool_calls/EOF errors; tool_calls and EOF were red before repair.
- Specificity validation accepts generic installation-manual requests but retains unsupported named-document claims. A specificity fallback now has insufficient_evidence status/no grounding basis and requests the missing evidence instead of inventing a procedure.
- Voltage negation exemptions bind to the voltage predicate and scan coordinated new instructions. The independent-review unsafe cross-clause controls, including safe absence check AND unsafe live measurement, are covered alongside safe absence and passive-label controls.

Live round3 still fails visual accuracy: sideways safety schematic LOOK502; breaker1489 read1499; Honeywell arrow read as d; green LEDs still assigned electrical status before the final HONESTY contradiction removal. Honest errors/refusals do not constitute a successful diagnosis.

Diagnostic-only rotated and multiview controls preserve originals and improve CURRENT SENSOR/sheet identification, but still misread E-STOP/440R. No preprocessing was added to production. Authenticated Together model listing identified public Qwen3-VL 8B/32B/235B candidates with Apache-2.0 metadata; model listing is not successful inference proof. Parent owns further bounded comparisons.

Verification logs: `/tmp/fireplace-eof-red.log` (2 failed/13 passed), `/tmp/fireplace-eof-green.log` (15 passed), `/tmp/fireplace-and-green.log` (117 passed), and `/tmp/fireplace-round2-checkpoint-full.log` (295 files /3893 tests passed). Latest pre-EOF full suite was295 files/3889 tests; tsc remained33 baseline-only diagnostics in `/tmp/fireplace-round2-final-tsc.log`. The actual model controls are not replaced by these mocks.

Final bounded diagnostic: upright full safety drawing plus four native-resolution quadrants returned200/stop and correctly read AB/440R/CURRENT SENSOR/sheet4of5, but still E-STOP→F-STOP and exceeded eight labels. Raw result: private-backend-diagnostic/quadrants/PXL_20260925_092954021.jpg.json. This is partial improvement, not clean acceptance; no production transform was added. Separate authorized worker tested listed Qwen235B/32B/8B: all actual inference requests returned400 model_not_available (dedicated endpoint required). No runtime provider/model configuration was changed.

### Evaluator correction
Root re-inspected the original safety drawing at full resolution: F-STOP may be the literal printed label (including C-FSTOP-PR), so earlier E→F grading is withdrawn. It is not demonstrated model error. Root's subsequent audit of the native-quadrant output found AB/440R/CURRENT SENSOR/DC24/120VAC and the other reported labels plausible. That control is potentially useful and must not be called failed solely on the earlier F/E assumption. This correction changes evaluator grading only; no hints were sent to MIRA.

### Existing PrintSense provider comparison
Reused `printsense.interpret._generate_with_provider` with original image bytes, its existing schema/system prompt, and neutral question. OpenAI default gpt-5.5 works with staging key (91s drawing /77s panel); original sideways drawing still includes incorrect442R/C-STOPPRT/TLOW240VAC readings. Panel reads1489-M and fullACS035 model plus printed AmberOver/GreenUnder without assigning an electrical LED state, but requires independent fine-label audit. Existing Anthropic default claude-opus-4-8 returns400 insufficient API credit balance; no retry or account changes. Capability registry marks both defaults formally untested; actual working inference is not formal qualification. Fourth/final call is an authorized upright OpenAI control, pending.

PrintSense already contains Pillow/Tesseract content-based orientation in `printsense/preprocess.py`; local pytesseract is absent (tesseract binary present), so normal local preprocessing only resizes. Current Hub has no PrintSense interpreter call or OpenAI/Anthropic vision adapter found. No provider architecture/runtime change was made.

Fourth PrintSense diagnostic completed80s: upright OpenAI improves AB/440R/CURRENT SENSOR/FLOW SWITCH and correctly separates vendor5399-E001 from UniversalN/A, but exhausts12000 outputtokens and ends mid-JSON. No valid graph pass; no provider integration. Details: private-backend-diagnostic/print-provider-comparison/REPORT.md. Existing nameplate agreement functions are field-limited and select a winner, not a generic prose verification gate; no new framework or source edits made during frozen physical checkpoint.

Matching-contract follow-up (two explicitly authorized calls): OpenAI gpt-5.5 with EXACT current Hub INSPECTION_PROMPT, original images, neutral question, medium reasoning and4096 total output budget. Both completed with validJSON in~10s. Original sideways safety print confidently becomes AIR SAFETY MODULE/LOCKOUT SAFETY RELAY/START SWITCH/TEMP SWITCH/COMB PASS THRU JUMPER: clear inaccurate transcription. Panel preserves1489/fullACS035/two green indicators but supply rating needs audit. Provider swap alone does not solve original-photo correctness. Exact status/usage/raw JSON: private-backend-diagnostic/openai-look-contract/. No source changes or new adapter.

Automatic preprocessing control: installed missing pytesseract only under disposable `/tmp/mira-fireplace-localqa/python-deps`; existing Tesseract binary used. Existing `printsense.preprocess.prepare_print_image` detected rotate270/orientation_conf1.68 above its1.0 threshold, automatically corrected original4000x3000 to1932x2576. No manual orientation hint. One exact-LOOK-prompt OpenAI control completed validJSON in14.57s with AB SAFETY MODULE/440R/TB104/TB105/K2/K1(FIRE)/24VDC+/120VAC NEUTRAL and correct vendor5399-E001/revD/sheet4of5, distinguishing drawing from hardware/logic. No clear invented labels/counts in this concise result; independent root visual audit still required. Evidence: private-backend-diagnostic/auto-orientation/ (actual OSD/hashes plus raw response). No production preprocessing/provider change.

</details>
