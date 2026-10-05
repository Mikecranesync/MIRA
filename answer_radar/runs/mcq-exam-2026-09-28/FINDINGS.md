# Industrial maintenance exam — bare model vs MIRA (2026-09-28)

**Question:** when MIRA gets an answer wrong, is it the model or the system around it?

**Method:** the same 100-question technician exam (`tests/benchmark/mira_mcq_benchmark.json`,
committed answer key, 8 domains) given to two contestants:

| Contestant | What it is | How it was asked |
|---|---|---|
| Bare model | `openai/gpt-oss-120b` on Groq — the model MIRA runs — with no MIRA around it | `tests/mira_eval.py --groq`; system prompt asks for one letter |
| MIRA | the deployed **staging** app chat, build `76887423c6c8`, the route the web app and the phone both use | `tools/qa/mcq_exam_staging.sh`; one fresh blank chat per question, throwaway stranger account (deleted afterwards) |

Free-tier inference only; no paid calls.

## Result

| | Correct | Unreadable reply | Wrong letter |
|---|---:|---:|---:|
| Bare model | **94 / 100** | 0 | 6 |
| MIRA (staging) | **92 / 100** | 2 | 6 |

MIRA's score is re-graded from its stored replies with the final parser (`mira_hub_regrade.jsonl`).
The first pass read 91 because the parser missed one correct reply (Q55, "D – …" under a banner);
that was a grading bug, not MIRA's, and is fixed with a test.

| Domain | Bare | MIRA |
|---|---:|---:|
| VFD faults & operation | 15/15 | 13/15 |
| Motor theory | 12/15 | 12/15 |
| PLC logic | 15/15 | 15/15 |
| NFPA 70E / arc flash | 10/10 | 9/10 |
| PM / PdM | 9/10 | 9/10 |
| Pneumatics & hydraulics | 9/10 | 9/10 |
| Sensors & instrumentation | 10/10 | 10/10 |
| CMMS & work orders | 14/15 | 15/15 |

**Reading it honestly:** each contestant answered each question once, so a 1–2 point gap is
within run-to-run variation (MIRA got 2 questions right that the bare model missed, and vice
versa). The knowledge is there — **the model is not the problem on technician knowledge.**
What the system adds shows up in *how* it answers, below.

For reference, Claude Sonnet 4.6 scored 97/100 on this exam on 2026-04-07 (BRAVO,
`~/Mira/tests/results/mcq_eval_report.txt`) — the only earlier run, and it tested neither
MIRA nor MIRA's model.

## What MIRA's layer did (system problems, with evidence)

1. **A general question was replaced by a canned refusal — intermittently.** Q3 (460 V drive,
   420 V at output) and Q6 (45 °C panel, 40 °C drive rating) came back as
   "I can't verify that machine-specific detail from the evidence in this conversation, and I
   won't guess", followed by a generic fault checklist. That text is
   `specificityFallback(null)` in `mira-hub/src/capabilities/answer-validation.ts`, which
   replaces the model's draft on the general lane when one of three detectors fires
   (fabricated-doc, exact-setting, exact-rating). Re-asked once (`reask-q3-q6/`), both came
   back correct — so it depends on the draft's wording. The replaced draft is not stored and
   the turn diagnostics do not name the rule, so **which detector fired is not proven**.
   These are textbook questions; a technician would read the refusal as "MIRA doesn't know".
2. **Safety banners fire on steps that are already safe.** 11 of 100 replies opened with a
   warning banner; 8 of those quote a "dangerous" step. By my reading, about 5 of the 8 quote a
   step that already says de-energized / powered down / isolated, or is itself a safety
   instruction — e.g. Q8 "measure the three input line voltages (with the VFD de-energized",
   Q55 "Any work on energized equipment, even at 277 V, must follow NFPA 70E." Q62 (remove the
   coupling guard) and Q73 (live coil voltage) look legitimate. Crying wolf teaches technicians
   to ignore the banner.
3. **Every reply is a troubleshooting checklist.** Even for a multiple-choice question MIRA
   answers with "verify / isolate / measure" steps rather than explaining the answer. The
   bare model was asked for a letter only, so this is not a like-for-like quality measure, but
   it is the system's style, not the model's.
4. **No retrieval at all.** All 100 turns were `basis=general_reasoning` — a blank chat never
   searches the manual library (same finding as the 2026-09-27 staging Answer Radar run).
5. **Latency.** MIRA median 5.1 s (p90 6.8 s) vs the bare model under 1 s.

## Files

- `bare-model/` — `mcq_eval_results.json` / `_summary.csv` / `_report.txt` (bare model)
- `mira_hub_answers.jsonl` — every MIRA reply verbatim, with turn status, basis, trace id,
  timing; `mira_hub_summary.json` — first-pass counts and the staging SHA
- `mira_hub_regrade.jsonl` — re-grade with the final parser (recorded vs regraded letter)
- `reask-q3-q6/` — the re-ask of the two refused questions, with turn diagnostics

## Reproduce

```bash
doppler run -p factorylm -c dev -- python3.12 tests/mira_eval.py --groq          # bare model
PYTHON=python3.12 bash tools/qa/mcq_exam_staging.sh <out-dir> [--ids 3,6] [--diagnostics]  # MIRA
```
