# Print of the Day — real-print benchmark (2026-07-22)

Budget-declared acceptance benchmark run against real, **ungraded** prints.
Owner-authorized ceiling: **$0.50 USD hard cap**, Downloads prints, no answer
keys. Interpret-only — **no `--send`** (dry run, no email), **no `--live`** (skip
the readiness canary), so the only paid call per print is the MiniMax vision
interpret.

> **What was executed.** The benchmarked artifact was the **PR-6/7 staging runtime
> container** at image revision `6218ecc7ae240ec63b283b4f6f6123ac07adeabc` —
> provider registry + fail-closed readiness + provenance + send gate + container
> entrypoint — exercised **after v3.204.0 merged to `main`**. The **#2868
> email-review layer** (the `factorylm.potd-view-model.v1` view model, the v2
> mobile email, the 20-section report renderer) was built *after* this image, is
> **not part of it**, and was **not exercised or benchmarked here**. This run
> measures the container's interpret → grade → provenance → manifest path only.

## Setup

| | |
|---|---|
| Container | `mira-print-of-day:6218ecc7…` (PR-6/7 staging runtime; tesseract-ocr baked in; **excludes the #2868 email-review layer**) |
| Image revision (provenance identity) | `6218ecc7ae240ec63b283b4f6f6123ac07adeabc` |
| Provider / model | Together → `MiniMaxAI/MiniMax-M3` (strict policy, no fallback) |
| OCR floor | Tesseract 5.5.0 / pytesseract (required, present in container) |
| Output cap | `PRINT_VISION_MAX_TOKENS=4000` |
| Prints | 5 JPGs from `~/Downloads` (a full sheet + 4 region crops), **ungraded** |
| Creds | staging Doppler (`factorylm/stg`) |

The prints are gitignored (`printsense/benchmarks/.gitignore` excludes `*.png`/`*.jpg`),
so images are referenced by name only, not committed.

## Results

| Print | Exit | Model responded | In / Out tokens | Est. cost | OCR | Verdict | Gold-elig. |
|---|---|---|---|---|---|---|---|
| `titleblock.jpg` | 0 | MiniMax-M3 | 4289 / 1465 | $0.0217 | ✓ 5.5.0 | PASS | true |
| `topstrip.jpg` | 0 | MiniMax-M3 | 4145 / 2217 | $0.0257 | ✓ 5.5.0 | PASS | true |
| `leftmargin.jpg` | 0 | MiniMax-M3 | 5801 / 907 | $0.0228 | ✓ 5.5.0 | PASS | true |
| `rightmargin.jpg` | 0 | MiniMax-M3 | 5801 / 829 | $0.0224 | ✓ 5.5.0 | PASS | true |
| `A104.jpg` | **1** | — | — | — (2 failed calls) | — | — | — |

**Yield: 4/5.** Counted spend **$0.0926**; the two failed `A104` calls (original +
one determinism retry) consumed vision tokens but wrote no manifest, so are
uncounted — est. ~$0.04 each ⇒ **total ≈ $0.17, well under the $0.50 cap**.
Average successful print: **$0.023** (vs the $0.086 planning estimate — ~3.7× cheaper).

## What MiniMax actually read (blind interpretation)

- **`titleblock.jpg` — strong structured extraction.** Drawing `31971` / `AP31971`,
  "Hyper Launch — Sensor Control Unit 2", customer Mack, Orlando FL, sheet 6 of
  1706, dated 11.07.2022, prepared by Ascher, rev "SCU2 V3.5", "PLC overview",
  mfr INTRASYS. (This is the SCU2 print family already represented in
  `printsense/fixtures/scu2`.) Accurate drawing metadata pulled clean.
- **`topstrip.jpg` — honest partial-crop handling.** Self-reported "only a partial
  view of one print is visible; the bulk of the sheet is off-frame. Title block
  not legible in this crop." Extracted one device `-5/A101` (backplane slot/card)
  with evidence + `confidence 0.92` + `trust=proposed`. No fabrication.
- **`leftmargin.jpg` / `rightmargin.jpg` — correct blank/low-content refusal.**
  Title fields `UNREADABLE`, empty entity lists, `unresolved` explaining "only a
  thin vertical blue border line" and "a partially visible numeral '7' (likely a
  page number)". **No hallucinated schematic** — the anti-hallucination property
  held on near-empty inputs.

## Findings

1. **Anti-hallucination held.** On the three low-content crops the model refused
   to invent structure and reported honest `UNREADABLE`/`unresolved` states — the
   core POTD safety property, confirmed on real inputs.
2. **Deterministic robustness gap on a dense sheet (`A104.jpg`).** Two identical
   runs both failed `INVALID_MODEL_JSON: Expecting ',' delimiter: line 265 column
   6 (char 8422)`. A dense sheet drives a large extraction that breaks the JSON
   contract near the 4000-token output cap. The pipeline **fails closed** (typed
   error, no manifest, no fabricated output, exit 1) — correct safety behavior,
   but a **yield gap**. Likely fix: raise the output budget for dense sheets
   and/or add a JSON-repair / continuation pass. *To be developed and tested on
   hermetic fixtures — not paid re-validation (spend law).*
3. **Judge not shipped in the container image.** Every run recorded
   `judge_error: "InferenceRouter unavailable: No module named 'shared'"` ⇒
   pipeline-health `manual_review_required`. Same known gap surfaced by the PR-7
   staging E2E; the free-cascade judge is not packaged in the POTD image, so the
   container path always needs a human. Tracked follow-up.
4. **`gold_eligible=true` is structural, not quality.** Ungraded clean runs are
   gold-*eligible* (approved provider pair, no fallback/degraded, OCR up, page
   match) even with `grade=None` — by design a human still authorizes gold. Worth
   remembering when reading an ungraded verdict: "eligible" ≠ "verified correct".

## Spend accounting

- Counted (4 manifests): **$0.0926**.
- Uncounted (2 failed `A104` calls, truncated at 4000 out tokens): est. **~$0.08**.
- **Total ≈ $0.17 of the $0.50 ceiling.** No Anthropic/OpenAI key present or used;
  Together/MiniMax only. No email sent (`--send` never passed). Production untouched.

## Reproduce

```
doppler run -p factorylm -c stg -- py -3 scratch/potd_bench.py <work-dir>
# per print: docker run --rm -e TOGETHERAI_API_KEY -e FACTORYLM_NETWORK_MODE=enabled \
#   -e PRINT_VISION_MAX_TOKENS=4000 -v <print>:/in/print.png:ro -v <work>:/work \
#   mira-print-of-day:6218ecc7… --case <id> --image /in/print.png --out /work/out_<id>
```
