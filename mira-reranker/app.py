"""mira-reranker: a cross-encoder reranking service.

Scores (query, passage) pairs with cross-encoder/ms-marco-MiniLM-L-6-v2 via
ONNX Runtime. Internal network only — no auth, no persistence, no logging
of passage/query text (counts and timing only).
"""

from __future__ import annotations

import logging
import os
import threading
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
# RERANKER_MODEL picks the ONNX file (both baked in and sha256-pinned at build):
#   fp32       onnx/model.onnx               the reference model
#   int8-avx2  onnx/model_quint8_avx2.onnx   ~4x smaller, built for x86 AVX2 hosts (CU-RR1 speed)
# An unknown value refuses to start rather than silently picking one.
MODEL_VARIANTS = {"fp32": "onnx/model.onnx", "int8-avx2": "onnx/model_quint8_avx2.onnx"}
MODEL_VARIANT = os.environ.get("RERANKER_MODEL", "fp32").strip() or "fp32"
if MODEL_VARIANT not in MODEL_VARIANTS:
    raise SystemExit(f"RERANKER_MODEL={MODEL_VARIANT!r} is not one of {sorted(MODEL_VARIANTS)}")
ONNX_PATH = MODEL_DIR / MODEL_VARIANTS[MODEL_VARIANT]
TOKENIZER_PATH = MODEL_DIR / "tokenizer.json"

MAX_QUERY_CHARS = 1000
MAX_PASSAGE_CHARS = 2000
MIN_PASSAGES = 1
MAX_PASSAGES = 100
MAX_SEQ_LEN = 512
# Peak memory scales with batch x 512^2 attention: a batch of 24 full-length pairs spiked past a
# 768 MiB cap. Batches of 8 bound the peak; padding is masked, so scores do not change.
BATCH_SIZE = 8

RERANKER_THREADS = int(os.environ.get("RERANKER_THREADS", "2"))
# One inference at a time. Each one already uses every thread and its own tensors, so a
# second concurrent call would only double memory and slow both past the Hub's 1.5 s
# timeout. Excess calls are refused at once (503) and the Hub keeps today's order.
MAX_CONCURRENT = int(os.environ.get("RERANKER_MAX_CONCURRENT", "1"))
_admission = threading.BoundedSemaphore(MAX_CONCURRENT)


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
        # Every request has a different padded length, and the default CPU arena keeps the
        # largest buffers it has ever seen: measured 481 MiB -> 1.4 GiB over 20 pool-24
        # requests, OOM-killed under a 768 MiB cap. This service shares a host with
        # production, so memory must stay flat; the arena's speed gain is not worth that.
        sess_options.enable_cpu_mem_arena = False
        sess_options.enable_mem_pattern = False
        session = ort.InferenceSession(
            str(ONNX_PATH),
            sess_options=sess_options,
            providers=["CPUExecutionProvider"],
        )

        self._tokenizer = tokenizer
        self._session = session
        logger.info(
            "model loaded: %s variant=%s (threads=%d)", MODEL_TAG, MODEL_VARIANT, RERANKER_THREADS
        )

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
    if not _admission.acquire(blocking=False):
        logger.info("rerank: busy, refused passages=%d", len(req.passages))
        raise HTTPException(status_code=503, detail="busy")
    try:
        t0 = time.monotonic()
        scores = reranker.score(req.query, req.passages)
    finally:
        _admission.release()
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    logger.info("rerank: passages=%d ms=%d", len(req.passages), elapsed_ms)
    return RerankResponse(scores=scores, model=MODEL_TAG, ms=elapsed_ms)
