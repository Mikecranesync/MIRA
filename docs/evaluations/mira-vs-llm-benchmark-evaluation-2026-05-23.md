# MIRA vs ungrounded-LLM benchmark — evaluation design

**Date:** 2026-05-23
**Owner:** Mike Harper
**Status:** v1 implemented

## Goal

Quantify the gap between MIRA (grounded retrieval over the customer KB) and
the same LLM cascade called without any retrieval. Both halves of the test
hit the **same** model family (Groq → Cerebras → Gemini cascade) so the
*only* meaningful variable is grounding.

This is a head-to-head: not "is MIRA accurate" in isolation, but "does
grounding the LLM in the customer's manuals actually improve the answer a
maintenance tech sees in Slack?"

## Architecture

No new services. Wires into what exists:

| Piece | Source | Used for |
|---|---|---|
| `shared.neon_recall.recall_knowledge` | `mira-bots/shared/neon_recall.py` | Retrieval — BM25 + dense vector + structured fault + ILIKE; the same pipeline the production engine runs |
| `shared.inference.router.InferenceRouter` | `mira-bots/shared/inference/router.py` | LLM calls — same cascade as prod |
| Local Ollama `nomic-embed-text:latest` | `http://localhost:11434/api/embeddings` | Query embedding (768-dim, matches NeonDB vectors) |
| `psycopg2 + sqlalchemy` | already in repo | NeonDB connection |

**Database:** staging Neon branch via Doppler `factorylm/stg`
(`NEON_DATABASE_URL`).

**Tenant:** `QUICKSTART_TENANT_ID` (UUID). The `MIRA_TENANT_ID` env var in
stg is the literal string `"staging"`, which is not a valid UUID and fails
the `tenant_id::uuid` column — known gotcha.

**Read-only.** Bench never writes to the DB.

## Scoring

Each answer is judged on six 1-5 dimensions (max 30):

| Dimension | What it measures |
|---|---|
| correctness | Are technical facts right? Registers, baud rate, parity, wiring, CCW steps |
| citation_quality | Inline `[#N]` chunk citations vs vague "see manual" |
| completeness | Coverage of wiring, params, programming, testing |
| safety | De-energize / LOTO / qualified person / DC bus discharge — required when task touches power |
| hallucination_resistance | When info is missing, does the answer admit it instead of inventing |
| usefulness | Could a maintenance tech actually follow this on a phone |

**Judge model:** Groq (top of the cascade), called via the same
`InferenceRouter`. Same pattern as `staging-gate.yml` LLM judging.

Retrieval is scored separately (no LLM) on:

- `relevance` — share of chunks whose content overlaps required-doc tokens
- `coverage` — share of required docs touched by ≥1 chunk
- `citation_quality` — share of chunks carrying a `source_page` / `source_url` / `source_type` tuple

## Question set

10 questions across modbus, wiring, plc-programming, troubleshooting, safety
— focused on the cluster's gold-path equipment (Micro820, GS10/GS11 VFDs,
Modbus RTU). See `tests/mira_bench_questions.yaml`.

Each question carries:

- `expected_answer_components` — list of facts that ought to appear
- `required_documents` — KB sources that ought to be retrieved
- `required_citations` — page/section hints
- `difficulty` (easy / medium / hard)
- `category`

## Files

| File | Purpose |
|---|---|
| `tests/mira_bench_questions.yaml` | The 10-question truth set |
| `tests/mira_bench_scorer.py` | LLM-judge + retrieval scorer |
| `tests/mira_bench.py` | Main runner |
| `tests/run_mira_bench.sh` | Doppler-wrapped shell entry point |
| `docs/evaluations/runs/<date>/mira-bench-results.md` | Per-run markdown report |
| `docs/evaluations/runs/<date>/mira-bench-raw.json` | Per-run raw JSON |

## How to run

```bash
bash tests/run_mira_bench.sh                 # all 10
bash tests/run_mira_bench.sh --only Q01,Q03  # subset
```

Roughly 40 LLM calls per full run (4 per question — 2 candidate answers
+ 2 judge calls). Well under the per-provider hourly budget.

## Rules

- Read-only against NeonDB
- Staging Neon branch only (`factorylm/stg`)
- No modifications to production code paths
- New files only in `tests/` and `docs/evaluations/`
- Empty-retrieval is a finding, not a failure — document it
