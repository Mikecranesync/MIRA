# Print Translator Evaluation Campaign — Review Package

**One folder, zero setup, zero drawings you supply.** Everything below is real: real OEM PDFs,
real vision classification (Groq), real production prompt + cascade, real rendered images. Nothing
is mocked or fabricated. Date: 2026-07-10.

## How to review (3 lines)

1. Open `images/<id>.png` to SEE the exact print that was submitted, then open
   `results/<id>.gate_bypassed.json` → `translator_reply` to read MIRA's actual explanation of it.
2. Fill the blank judgment columns in `review_worksheet.csv` (`correct_components`,
   `correct_sequence`, `missed_evidence`, `unsupported_claims`, `uncertainty_handling`,
   `usefulness_1to5`, `notes`) — one row per print; start with the 10 rows where `first_10=Y`.
3. Read `RANKED_REPORT.md` for the headline finding (the classifier gate blocks ~91% of real
   prints) — that's the one thing to fix; the explanations you're reviewing prove the layer
   *behind* the gate already works.

## ⚠️ One honesty caveat, everywhere

OCR (glm-OCR + Tesseract) is **unreachable from the box this ran on**, so every explanation here
was grounded on the image alone, with **zero OCR-extracted labels** (`ocr_grounding:
unavailable_on_this_box` on every record). These explanations are representative of the
**prompt/format/grounding layer**, NOT of production answer quality — production will have real
OCR grounding. The live-Telegram run (`LIVE_TELEGRAM_RUNBOOK.md`) is what validates real answer
quality. Details: `GAPS.md` §1.

## What's in this folder

| Artifact | What it is |
|---|---|
| `corpus_manifest.md` | The 25-entry corpus. The **"Campaign Run Status"** section marks the first-10 set + which question was asked per id. 7 placeholder URLs were resolved+verified 2026-07-10 (see the `Retrieval Note` column). |
| `images/<id>.png` | The exact schematic page submitted for each run (200 dpi, one page — never a whole manual). `images/MANIFEST.md` lists sha256 + source URL + page per image. |
| `results/<id>.json` | The **REAL full-handler** result (`bot._try_print_translator_reply`, spied engine, no Telegram). Records the true classifier-gate outcome — for most prints `handled:false` (the gate mis-routed them). This is the trigger-rate ground truth. |
| `results/<id>.gate_bypassed.json` | The **REAL translator explanation** for each first-10 print: the exact production prompt-builder + real cascade + real image, skipping ONLY the buggy gate. `mode: gate_bypassed_real_prompt_real_model_real_image_ocr_empty`. This is what you actually read + judge. |
| `results/22.json` | An honest `unfetchable` record (not a run) — see `rejected.md`. |
| `review_worksheet.csv` | One row per run. Auto-filled: id/oem/url/page/type/standard/category, `first_10`, `question`, `image_path`, both image hashes, `classification`, `triggered(Y/N)`, `handler_response_excerpt`, `gate_bypassed_response_excerpt`, `ocr_grounding`. Blank for you: the 7 judgment columns. |
| `RANKED_REPORT.md` | Ranked findings. #1 = the classifier gate (measured trigger rate). Where it's EXCELLENT (prompt/grounding/format). The single highest-value fix. |
| `rejected.md` | Triage log — what was rejected and why (unfetchable #22; text-heavy #21 excluded from first-10). |
| `questions.md` | The exact caption asked per first-10 print, plus the honesty note that the caption only gates the trigger — it doesn't change the explanation text. |
| `GAPS.md` | Honest gaps — OCR unreachable, page-resolution ambiguity, URL rot, classifier defect not fixed, sample-size bias. |
| `regression_fixtures/test_classifier_gate.py` | Deterministic, NO-inference regression tests capturing the real gate defect (5 `xfail` cases from real captured vision strings). Run: `python -m pytest docs/eval/print-translator-campaign/regression_fixtures/`. |

## The first-10 evaluation set

The 10 clearest, most readable, self-contained, category-diverse schematics (all 6 corpus
categories represented; both captions used, 5 each):

| id | OEM | Category | Question | Image | Explanation |
|---|---|---|---|---|---|
| 3 | ABB Star-Delta | European/IEC | Explain this print. | `images/03.png` | `results/03.gate_bypassed.json` |
| 5 | Rockwell Bulletin 509 | NEMA Starters | Explain this print. | `images/05.png` | `results/05.gate_bypassed.json` |
| 7 | AD SR44 Soft Starter | NEMA Starters | Describe the theory of operation. | `images/07.png` | `results/07.gate_bypassed.json` |
| 9 | Rockwell Guardmaster 440R | Safety Relays | Explain this print. | `images/09.png` | `results/09.gate_bypassed.json` |
| 13 | AD CLICK PLC | PLC I/O | Describe the theory of operation. | `images/13.png` | `results/13.gate_bypassed.json` |
| 14 | AD D0–06 PLC | PLC I/O | Describe the theory of operation. | `images/14.png` | `results/14.gate_bypassed.json` |
| 17 | AD GS20 VFD | VFD | Explain this print. | `images/17.png` | `results/17.gate_bypassed.json` |
| 18 | ABB ACS355 VFD | VFD | Explain this print. | `images/18.png` | `results/18.gate_bypassed.json` |
| 20 | WEG CFW-11W VFD | VFD | Describe the theory of operation. | `images/20.png` | `results/20.gate_bypassed.json` |
| 25 | Yaskawa V1000 F/R | Reversing/Braking | Describe the theory of operation. | `images/25.png` | `results/25.gate_bypassed.json` |

> Note on the caption: it governs ONLY the trigger (`print_translator.is_theory_request`) — both
> phrasings return True. It is NOT passed to the prompt-builder, so the explanation itself is
> caption-independent (recorded honestly in each `gate_bypassed.json`'s `caption_note`). #18 is
> the one print that also passed the real handler gate on its own (`results/18.json`).

## Two records per first-10 print — why both matter

- `results/<id>.json` (full handler): the **honest reality** — most real prints get `handled:false`
  because the gate mis-classifies them. This is the finding.
- `results/<id>.gate_bypassed.json`: the **explanation you'd have gotten** if the gate weren't
  broken — real prompt, real model, real image. This is what to judge for quality.

Fixing the gate (`RANKED_REPORT.md` #1) is what connects the two: once the gate passes real
prints, the full handler produces exactly these explanations.

## Reproduce

```bash
# Full handler (real gate result):
doppler run --project factorylm --config dev -- python tools/print_translator_eval/run.py --id 18 --page 50 --caption "Explain this print."
# Gate-bypassed real explanation (needs results/<id>.json to exist first) — the tool that
# produced every results/<id>.gate_bypassed.json in this package:
doppler run --project factorylm --config dev -- python tools/print_translator_eval/gate_bypass.py --id 18 --caption "Explain this print."
```

`run.py` also carries an equivalent `--gate-bypass` flag (`--id 18 --gate-bypass`) that does the
same thing as a single command (auto-loads the page + real vision_data from `results/<id>.json`,
renders + persists the PNG, calls the same real prompt-builder + cascade) — the two are
interchangeable; `gate_bypass.py` is the one whose output is checked in here.
