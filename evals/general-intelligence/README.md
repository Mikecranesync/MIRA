# MIRA General Intelligence Arena

The benchmark the parity program is judged by (build plan §12–§18). It answers one question
before any orchestration change ships:

> **Did this make the assistant better, or did we accidentally make the model worse?**

Doctrine: `.claude/rules/general-intelligence-preservation.md`. Current-state map:
`docs/architecture/general-intelligence-parity-current-state.md`.

## Layout

```
evals/general-intelligence/
  cases/       gi1-corpus.json — 24 cases (industrial, household, electronics, non-maintenance, maker)
  fixtures/    README.md — the photos each case expects (captured, never generated; none committed yet)
  schemas/     case.schema.json
  runners/     arena.py — raw frontier vs MIRA, dry-run / live, budget-capped
  judges/      rubric.py — deterministic degradation/claim checks + blind model-judge prompt
  reports/     <run-id>/results.jsonl, verdicts.json, report.md (gitignored except curated baselines)
```

## Baselines

- **A — raw configured frontier model** (automated): same prompt + images, no FactoryLM tools.
  `GI_FRONTIER_BASE_URL` / `GI_FRONTIER_API_KEY` / `GI_FRONTIER_MODEL` — an OpenAI-compatible
  endpoint; **no model name is hard-coded** (owner decision 2026-08-26 permits OpenAI models
  behind the seam; Anthropic is excluded from diagnosis).
- **B — the ChatGPT product** (human protocol): run the exact prompt/photo in ChatGPT, capture
  answer + source URLs + screenshot + visible model/config + date into
  `reports/chatgpt/<case-id>.json`; the runner ingests them for blind scoring. No scraping.
- **MIRA** — today's real door: notebook chat, `mode:"general"`, through the Hub API with an
  isolated eval tenant (`GI_MIRA_HUB_BASE`, `GI_MIRA_COOKIE`, `GI_MIRA_NOTEBOOK_ID`).

## Run

```bash
# validate the corpus (CI, $0)
python evals/general-intelligence/runners/arena.py --validate-only
# reproducible dry run — no network, deterministic answers, exercises judges + report
python evals/general-intelligence/runners/arena.py --dry-run
# LIVE run = declared validation spend (zero-token law); refuses without a budget
python evals/general-intelligence/runners/arena.py --budget-usd 3.00 --judge
```

## Verdict rules

- Deterministic (Tier 1, every PR): **wrapper degradation** (a `must_answer` case refused for a
  FactoryLM reason — approved context, select a source, no notebook/manual, "not in the selected
  sources"), **asset-evidence claim without evidence**, critical facts, forbidden phrases. A hard
  fail caps the case score at 10 — a refusal is never a win.
- Model judge (Tier 2/3): blind `Answer A / Answer B` (mapping recorded separately), the plan's
  weighted rubric (correctness 25, troubleshooting 20, visual 15, natural 15, sources 10,
  follow-up 10, citations 5), tie margin 3 points.
- Targets (plan §16): general cases ≥ 95 % of raw; industrial-without-private ≥ raw;
  private-data cases materially better than raw (GI-2).

## What the dry run shows today

The `mira` canned answers mimic the current engine honestly: general mode answers text, but the
conversation model never sees image pixels, so every image-first case degrades to the
Gate-G refusal. That is the failure class the harness exists to catch — and the first thing GI-1
fixes after the live baseline exists.

## Honesty

- Cases with `fixture_status: needs_capture` validate and dry-run; a live run records
  `fixture_missing` rather than pretending the photo was sent.
- The runner never seeds SQL, never touches production, and stops at the declared budget.
- `parity_pct` is only computed when a model judge scored both systems.
