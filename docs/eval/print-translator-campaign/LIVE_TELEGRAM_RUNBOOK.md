# Print Translator — Live Telegram Validation Runbook

This is the future validation step the bounded campaign in this directory (`RANKED_REPORT.md`,
`review_worksheet.csv`, `results/*.json`) cannot substitute for: a real technician sending real
photos of real prints to the real, deployed bot, with real OCR grounding. Everything in this
directory was produced offline, against the real handler code but with OCR unreachable from the
dev box (`GAPS.md` #1) — this runbook is how that gap gets closed for real.

## Precondition

Print Translator must be deployed to the live bot first. **This is Mike's step, not
automatable from this campaign** — normal deploy discipline applies (`docs/environments.md`,
staging gate, `deploy-vps.yml`). Do not run this runbook against a feature-branch build or a
non-prod bot instance if the goal is a production-representative measurement; do run it against
staging first if validating a not-yet-merged classifier fix.

## Steps

### a. Deploy (Mike)

Deploy the current `mira-bot-telegram` build (with Print Translator, and ideally with the
classifier-gate fix from `RANKED_REPORT.md` #1 once it lands) to the target bot instance. See
root `CLAUDE.md` § "Verification Workflow" and `docs/environments.md` for the promotion path.

### b. For each of the 25 corpus prints, send a real photo + theory-of-operation caption

For every row in `corpus_manifest.md` (all 25, not just the 11 this campaign could fetch —
live validation isn't blocked by this dev box's fetch limitations):

1. Open the OEM PDF at the cited URL (verify/re-resolve the URL first if it 404s — see
   `GAPS.md` #3 for the resolution procedure used in this campaign).
2. Navigate to the schematic/wiring page (use the `page` value already recorded in
   `results/<id>.json` where this campaign already found one; for the 14 un-run entries, apply
   the same schematic-density selection method described in `GAPS.md` #2).
3. Screenshot or crop the schematic region of that page.
4. Send the image to the bot via Telegram with caption `"Explain this print."` or
   `"Describe the theory of operation."` (either phrase matches
   `print_translator.THEORY_INTENT_PHRASES`).
5. Record the bot's actual reply.

### c. Paste each reply into `review_worksheet.csv`

Append a new row per entry (or update the existing row if the entry was already run in this
campaign) with the live values: `classification`, `triggered(Y/N)`, `response_excerpt`, and set
`ocr_grounding` to `"live_ocr"` (not `"unavailable_on_this_box"`) — production has real glm-OCR
+ Tesseract reachability that this dev box does not (see `GAPS.md` #1). This is the single most
important field to update: it flips the interpretation of every response from "prompt/format
layer proof only" to "production-representative answer quality."

### d. A technician fills the judgment columns

The columns left blank by this campaign — `correct_components`, `correct_sequence`,
`missed_evidence`, `unsupported_claims`, `uncertainty_handling`, `usefulness_1to5`, `notes` —
require a human who can read the actual OEM print and judge the bot's explanation against it.
This campaign explicitly does not attempt these (no correctness/usefulness scoring — see
`tools/print_translator_eval/run.py`'s honesty contract). A maintenance electrician or controls
technician should fill these per row, comparing the live bot reply against the real print.

### e. Fold recurring objective failures into `regression_fixtures/`

If the live run surfaces a new *objective, deterministic* failure pattern (not a subjective
usefulness judgment) — e.g. a new classifier mis-route, a grounding violation (an invented wire
number not in the real OCR output), or a format violation (missing one of the six required
headings) — add it to `regression_fixtures/` following the pattern in
`test_classifier_gate.py`: capture the *real* vision-model output or *real* bot reply text
verbatim, write a deterministic assertion, and mark it `xfail` with a `reason` citing the live
run, until a fix lands.

## What changes vs. this campaign

| | This campaign (bounded, offline) | Live Telegram runbook |
|---|---|---|
| Handler code path | Real (`bot._try_print_translator_reply`, spied engine) | Real, unspied, actual Telegram |
| Vision classification | Real Groq call | Real Groq call (same) |
| OCR grounding | **Unavailable** (`GAPS.md` #1) — glm-OCR unreachable, no local Tesseract | **Live** — production has both reachable |
| Corpus coverage | 11/25 (fetchability-bounded) | Up to 25/25 (not blocked by this dev box's network) |
| Correctness/usefulness scoring | None (explicitly out of scope) | Human technician judgment (step d) |
| Purpose | Prove the classification-gate defect + prompt/format layer with real data | Prove production answer quality end-to-end |

Production OCR reachability is the headline difference: every quote and finding in this
campaign's `RANKED_REPORT.md` is caveated `"ocr_grounding": "unavailable_on_this_box"` precisely
because this gap exists. The live run is what actually validates response *content* quality —
this campaign only validates the classification gate and the prompt/format layer.
