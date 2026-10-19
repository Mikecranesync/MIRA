# mira-reranker

A cross-encoder reranking microservice. Scores `(query, passage)` pairs with
`cross-encoder/ms-marco-MiniLM-L-6-v2` via ONNX Runtime, so retrieval can
rerank its candidate set without pulling PyTorch/transformers into the Hub's
Alpine image (which cannot load native ONNX Runtime) or paying the 2.5–3.5s/
question WebAssembly cost.

Internal network only — no auth, no persistence. Intended to be reached only
from inside the compose network (no published port in the compose step).

## Model

- `cross-encoder/ms-marco-MiniLM-L-6-v2`, Hugging Face revision
  `233902d25c440f23af6f7d6e94d2946bac0bee0a` (Apache-2.0).
- Files: `onnx/model.onnx` (fp32), `tokenizer.json`, `config.json`.
- **Downloaded and sha256-verified at Docker build time only** (`fetch_model.py`,
  run as a `RUN` step). The service never downloads at runtime — if
  `MODEL_SHA256` doesn't match, the build fails and the image is never
  produced.

## API

- `POST /rerank` — `{"query": str, "passages": [str]}` →
  `{"scores": [float], "model": "<name>@<rev>", "ms": int}`.
  Query ≤ 1000 chars; 1–100 passages; each passage truncated to 2000 chars
  server-side. Violations → `422`.
- `GET /health` — `{"status": "ok", "model": "<name>@<rev>"}` once the model
  has loaded; `503` before that.

Scoring matches `sentence-transformers.CrossEncoder`: tokenizer pair encoding
of `(query, passage[:2000])` as `[CLS] query [SEP] passage [SEP]` with
`token_type_ids` 0/1, truncation to 512 tokens (passage side truncated first),
batch size 32. The response score is the raw logit (no sigmoid) — order is
what matters for reranking.

## Config

- `MODEL_DIR` — where the verified model lives (default `/models/ms-marco-MiniLM-L-6-v2`).
- `RERANKER_THREADS` — onnxruntime `intra_op_num_threads` (default `2`).

## Dependencies (runtime, pinned exact versions)

| Package | Version | License |
|---|---|---|
| onnxruntime | 1.23.2 | MIT |
| tokenizers | 0.22.1 | Apache-2.0 |
| numpy | 2.3.3 | BSD-3-Clause |
| fastapi | 0.147.0 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |

No torch, no sentence-transformers, no transformers at runtime. `fetch_model.py`
is build-time only and uses stdlib (`urllib.request`, `hashlib`) exclusively —
it is not part of the runtime dependency set.

## Local development

```bash
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python -e . --group dev
pytest tests -q   # conftest.py downloads + verifies the model into a tmp cache first
```

## Build

```bash
docker build -t mira-reranker mira-reranker
```

A deliberately wrong hash in `MODEL_SHA256` makes the build fail at the
`RUN python fetch_model.py` step (sha256 mismatch), never producing an image.
