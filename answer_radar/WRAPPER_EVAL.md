# MIRA wrapper evals — run before changing the answer path

The frozen September 28 exam in PR #4089 is the baseline. This eval regrades
the stored technician-facing text against the committed key, pairs every question
with the bare `openai/gpt-oss-120b` result, and checks known wrapper failures.
It makes **no inference calls**.

```bash
python -m answer_radar.wrapper_eval
python -m answer_radar.wrapper_eval --check
uv run --with pytest --with pyyaml python -m pytest -q \
  tests/test_wrapper_eval.py tests/test_mcq_hub_parser.py
```

The first command reports the historical 94/100 bare versus 92/100 MIRA,
including paired flips, latency, retrieval basis and diagnostic availability.
`--check` is **expected to fail** on the historical run: Q3/Q6 were replaced
by a general-question refusal; Q8/Q12/Q28/Q31/Q55 warned on quoted safe or
cautionary text. Those five labels apply only when the warning quotes the
adjudicated snippet; other warnings on those questions require human review.
Unreadable or failed turns also fail. A 2-point single-run score difference is
reported, not used as a statistical pass/fail threshold.

After a staging deployment, generate a fresh 100-question MIRA capture with
`tools/qa/mcq_exam_staging.sh <new-output-dir> --diagnostics`. Then run:

```bash
python -m answer_radar.wrapper_eval \
  --mira <new-output-dir>/mira_hub_answers.jsonl \
  --out <new-output-dir>/wrapper_eval.json --check
```

The script insists on all 100 IDs, unique rows and the frozen key. It reads
the reply again, so a stale `model_answer` field cannot inflate the score.
Record the staging SHA from the MCQ summary alongside the report. Check the
`missing_diagnostics_ids` field: the old capture had no diagnostics, and even
the available turn diagnostics do not preserve the discarded model draft or
specific validator rule. The report cannot attribute those refusals to a
particular detector until the answer path emits that evidence.

This exam measures **intelligence retention and known intervention regressions**.
Use the existing Answer Radar staging run and independent grading for value on
manufacturer/model questions. Use the existing answer-safety test suite and
human review of new warnings to check unsafe instructions are caught without
noise. A green MCQ check alone does not prove safe or useful troubleshooting.
