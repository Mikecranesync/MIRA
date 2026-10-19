"""mira-reranker: a cross-encoder reranking service.

Scores (query, passage) pairs with cross-encoder/ms-marco-MiniLM-L-6-v2 via
ONNX Runtime. Internal network only — no auth, no persistence, no logging
of passage/query text (counts and timing only).
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
from tokenizers import Tokenizer

logger = logging.getLogger("mira-reranker")
logging.basicConfig(level=logging.INFO)

MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
MODEL_REVISION = "233902d25c440f23af6f7d6e94d2946bac0bee0a"
MODEL_TAG = f"{MODEL_NAME}@{MODEL_REVISION}"

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/models/ms-marco-MiniLM-L-6-v2"))
ONNX_PATH = MODEL_DIR / "onnx" / "model.onnx"
TOKENIZER_PATH = MODEL_DIR / "tokenizer.json"

MAX_QUERY_CHARS = 1000
MAX_PASSAGE_CHARS = 2000
MIN_PASSAGES = 1
MAX_PASSAGES = 100
MAX_SEQ_LEN = 512
BATCH_SIZE = 32

RERANKER_THREADS = int(os.environ.get("RERANKER_THREADS", "2"))


class RerankRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=MAX_QUERY_CHARS)
    passages: list[str] = Field(..., min_length=MIN_PASSAGES, max_length=MAX_PASSAGES)

    @field_validator("passages")
    @classmethod
    def _truncate_passages(cls, value: list[str]) -> list[str]:
        return [p[:MAX_PASSAGE_CHARS] for p in value]


class RerankResponse(BaseModel):
    scores: list[float]
    model: str
    ms: int


class HealthResponse(BaseModel):
    status: str
    model: str


class Reranker:
    """Loads the tokenizer + ONNX session once and scores (query, passage) pairs."""

    def __init__(self) -> None:
        self._session: ort.InferenceSession | None = None
        self._tokenizer: Tokenizer | None = None

    def load(self) -> None:
        tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
        tokenizer.enable_truncation(max_length=MAX_SEQ_LEN, strategy="longest_first")
        tokenizer.enable_padding()

        sess_options = ort.SessionOptions()
        sess_options.intra_op_num_threads = RERANKER_THREADS
        session = ort.InferenceSession(
            str(ONNX_PATH),
            sess_options=sess_options,
            providers=["CPUExecutionProvider"],
        )

        self._tokenizer = tokenizer
        self._session = session
        logger.info("model loaded: %s (threads=%d)", MODEL_TAG, RERANKER_THREADS)

    @property
    def is_loaded(self) -> bool:
        return self._session is not None and self._tokenizer is not None

    def score(self, query: str, passages: list[str]) -> list[float]:
        if not self.is_loaded:
            raise RuntimeError("model not loaded")
        assert self._tokenizer is not None
        assert self._session is not None

        scores: list[float] = []
        for start in range(0, len(passages), BATCH_SIZE):
            batch = passages[start : start + BATCH_SIZE]
            encodings = self._tokenizer.encode_batch([(query, p) for p in batch])

            input_ids = np.array([e.ids for e in encodings], dtype=np.int64)
            attention_mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
            token_type_ids = np.array([e.type_ids for e in encodings], dtype=np.int64)

            outputs = self._session.run(
                None,
                {
                    "input_ids": input_ids,
                    "attention_mask": attention_mask,
                    "token_type_ids": token_type_ids,
                },
            )
            logits = outputs[0].reshape(-1)
            scores.extend(float(x) for x in logits)

        return scores


reranker = Reranker()


@asynccontextmanager
async def _lifespan(_: FastAPI):
    reranker.load()
    yield


app = FastAPI(title="mira-reranker", lifespan=_lifespan)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    if not reranker.is_loaded:
        raise HTTPException(status_code=503, detail="model not loaded")
    return HealthResponse(status="ok", model=MODEL_TAG)


@app.post("/rerank", response_model=RerankResponse)
def rerank(req: RerankRequest) -> RerankResponse:
    t0 = time.monotonic()
    scores = reranker.score(req.query, req.passages)
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    logger.info("rerank: passages=%d ms=%d", len(req.passages), elapsed_ms)
    return RerankResponse(scores=scores, model=MODEL_TAG, ms=elapsed_ms)
