# FactoryLM RAG Evaluation Guide

## What This Does

This pipeline measures how well MIRA's RAG system retrieves relevant documentation and generates accurate answers for industrial maintenance questions. It uses two frameworks:

- **RAGAS** — the standard open-source RAG evaluation toolkit
- **DeepEval** — hallucination and bias detection

## What the Metrics Mean

### Faithfulness (RAGAS) — Target: >= 0.85

"Is the answer actually based on the retrieved documents, or did the model make things up?"

A score of 0.85 means 85% of the claims in the answer can be traced back to the retrieved context. If this is low, the model is hallucinating — saying things that sound right but aren't in any manual.

**Why 0.85?** For industrial maintenance, a wrong answer can cause equipment damage or safety incidents. We need high faithfulness before putting this in front of real technicians.

### Answer Relevancy (RAGAS) — Target: >= 0.80

"Does the answer actually address what was asked?"

A score of 0.80 means the answer is mostly on-topic. Low relevancy means the model is rambling about unrelated topics or giving generic advice instead of answering the specific question.

### Context Precision (RAGAS) — Target: >= 0.75

"Are the retrieved documents actually relevant to the question?"

A score of 0.75 means most of the retrieved chunks are useful. If this is low, the retrieval system is pulling in irrelevant manual sections — the model has to work harder to find the right information buried in noise.

### Context Recall (RAGAS) — Target: >= 0.75

"Do the retrieved documents cover everything needed to answer the question?"

A score of 0.75 means most of the information needed for a complete answer was retrieved. If this is low, the retrieval is missing critical chunks — the model can't give a complete answer because it never saw the relevant documentation.

### Hallucination (DeepEval) — Target: <= 0.50

"Does the answer contain claims not supported by the context?"

**Lower is better.** A score of 0.30 means 30% of the answer has unsupported claims. For maintenance, even 50% hallucination is dangerous — the target is to get this as low as possible.

### Bias (DeepEval) — Target: <= 0.50

"Does the answer show unjustified bias toward specific brands or approaches?"

**Lower is better.** For a multi-manufacturer maintenance assistant, bias toward one brand's solution when the question is about another brand's equipment would be a problem.

## Installation

```bash
cd evals
pip install -r requirements.txt
```

You also need at least one LLM API key for the evaluation metrics to work (the metrics use an LLM to judge the answers):

```bash
# Option A: Use Claude (preferred — already in Doppler)
export ANTHROPIC_API_KEY="sk-ant-..."

# Option B: Use OpenAI (DeepEval's default)
export OPENAI_API_KEY="sk-..."
```

## How to Run

### Quick test with dummy data (no services needed)

```bash
python evals/run_eval.py --use-ragas
```

This runs the 5 golden test cases with canned responses. Useful to verify the pipeline works end-to-end.

### Full evaluation with both frameworks

```bash
python evals/run_eval.py --use-ragas --use-deepeval
```

### Against real MIRA (requires running services)

```bash
# Set env vars (or use Doppler)
export NEON_DATABASE_URL="postgresql://..."
export MIRA_TENANT_ID="your-tenant-id"
export OLLAMA_BASE_URL="http://localhost:11434"
export ANTHROPIC_API_KEY="sk-ant-..."

python evals/run_eval.py --use-ragas --live
```

### With a custom test set

```bash
python evals/run_eval.py --use-ragas --csv path/to/your_questions.csv
```

CSV format: `question,ideal_answer,contexts` (contexts are pipe-delimited).

## Understanding the Output

### Console output

```
============================================================
RAGAS EVALUATION RESULTS
============================================================
  [+] Faithfulness: 0.87  (target >= 0.85) — PASS
  [!] Answer Relevancy: 0.72  (target >= 0.80) — FAIL
  [+] Context Precision: 0.81  (target >= 0.75) — PASS
  [+] Context Recall: 0.78  (target >= 0.75) — PASS

  OVERALL: BELOW TARGET on: answer_relevancy
  Action: review retrieval quality and prompt engineering
============================================================
```

### Output files

| File | Contents |
|------|----------|
| `output/predictions.json` | Raw question/answer/context data |
| `output/ragas_results.json` | Aggregate + per-question RAGAS scores |
| `output/deepeval_results.json` | Hallucination, bias, relevancy per question |

## Connecting to Real MIRA — Checklist

When you're ready to evaluate the actual system:

- [ ] Verify NeonDB has knowledge entries: `SELECT COUNT(*) FROM knowledge_entries`
- [ ] Verify Ollama is running: `curl localhost:11434/api/tags`
- [ ] Set all env vars (NEON_DATABASE_URL, MIRA_TENANT_ID, OLLAMA_BASE_URL, ANTHROPIC_API_KEY)
- [ ] Run: `python evals/run_eval.py --use-ragas --live`
- [ ] Review `output/ragas_results.json` per-question scores
- [ ] For any question with faithfulness < 0.85, check: was the right chunk retrieved? Is the chunk quality good?
- [ ] Add your own real technician questions to `tests/golden_factorylm.csv`
- [ ] Re-run after chunking changes to measure improvement

## How This Fits with Existing Tests

This evaluation pipeline complements (does not replace) the existing test framework:

| Existing Framework | This Pipeline |
|-------------------|---------------|
| `tests/scoring/` — keyword match + LLM judge | RAGAS — standard RAG metrics |
| `tests/regime2_rag/` — retrieval precision@5 | Context precision/recall |
| Manual inspection | DeepEval — automated hallucination/bias detection |

Future: Wire RAGAS metrics into `tests/regime2_rag/` as an additional scorer.
