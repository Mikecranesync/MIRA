# Evidence-verification runoff harness

Zero-token. Plan / results / decision: `docs/evals/evidence-runoff/`. Inputs live under
`/Users/charlienode/MIRA/.planning/` (gitignored: they contain manual text); `data/manifest.json` records the
sha256 of every input.

```bash
D=/Users/charlienode/MIRA/.planning/evidence-runoff-data
# 0. venvs (pinned): requirements.lock.txt (NLI/emb), requirements-docling.lock.txt (Docling)
uv venv -p 3.12 $D/venv && uv pip install -p $D/venv/bin/python -r tools/evidence-runoff/requirements.lock.txt

# 1. frozen corpus + every page's text
python3.12 tools/evidence-runoff/build_corpus.py          # -> $D/corpus.jsonl, data/manifest.json
python3.12 tools/evidence-runoff/build_pages.py           # -> $D/pages.jsonl

# 2. gold (data/gold.json, audited: data/gold-audit.json) -> labels; adversarial swaps
python3.12 tools/evidence-runoff/grade.py $D/corpus.jsonl tools/evidence-runoff/data/gold.json $D/pages.jsonl $D/labels.jsonl
python3.12 tools/evidence-runoff/build_adversarial.py     # -> $D/corpus_adv.jsonl

# 3. validators
cd mira-hub
npx vite-node --config vitest.config.ts ../tools/evidence-runoff/run_v1.ts -- $D/corpus.jsonl $D/v1.jsonl
npx vite-node --config vitest.config.ts ../tools/evidence-runoff/run_v1.ts -- $D/corpus_adv.jsonl $D/v1_adv.jsonl
V1_JOIN=1 npx vite-node --config vitest.config.ts ../tools/evidence-runoff/run_v1.ts -- $D/corpus.jsonl $D/v1b.jsonl
V1_JOIN=1 npx vite-node --config vitest.config.ts ../tools/evidence-runoff/run_v1.ts -- $D/corpus_adv.jsonl $D/v1b_adv.jsonl
cd ..
for m in cross-encoder/nli-deberta-v3-small cross-encoder/nli-MiniLM2-L6-H768 cross-encoder/nli-deberta-v3-base; do
  n=$(echo $m | tr / _)
  $D/venv/bin/python tools/evidence-runoff/run_sentence_scores.py nli $m $D/corpus.jsonl $D/scores-$n.jsonl
  $D/venv/bin/python tools/evidence-runoff/run_sentence_scores.py nli $m $D/corpus_adv.jsonl $D/adv-scores-$n.jsonl
done
$D/venv/bin/python tools/evidence-runoff/run_sentence_scores.py emb nomic-embed-text $D/corpus.jsonl $D/scores-emb.jsonl
$D/venv/bin/python tools/evidence-runoff/run_sentence_scores.py emb nomic-embed-text $D/corpus_adv.jsonl $D/adv-scores-emb.jsonl

# 4. score (thresholds tuned on DEV only) and the parser track
python3.12 tools/evidence-runoff/analyze.py $D $D/results.json
$D/venv-docling/bin/python tools/evidence-runoff/run_docling.py $D/docling-out
```

Pinned: sentence-transformers 5.7.0, torch 2.14.1, transformers 5.20.2, tokenizers 0.23.3, docling 2.140.0
(docling-core 2.103.0, docling-parse 7.22.3, docling-ibm-models 4.0.3, rapidocr 3.10.0).
