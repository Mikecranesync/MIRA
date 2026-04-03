"""MIRA RAG Sidecar — FastAPI application entry point.

Endpoints:
  GET  /status         — health + provider info
  POST /ingest         — parse document, embed, store in ChromaDB
  POST /ingest/upload  — multipart file upload + ingest pipeline
  POST /rag            — RAG query pipeline
  POST /build_fsm      — build FSM model from state history

SaaS: reachable via Docker network (mira-net). Not exposed on host ports.
On-prem: bind to 127.0.0.1 via HOST env var for loopback-only access.
"""

from __future__ import annotations

import logging
import logging.config
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, Form, HTTPException, UploadFile
from pydantic import BaseModel

from config import settings
from fsm.builder import build_fsm
from fsm.models import FSMModel, StateVector
from llm.factory import create_providers
from rag.chunker import chunk_document
from rag.embedder import embed_texts
from rag.query import rag_query
from rag.store import MiraVectorStore

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)
logger = logging.getLogger("mira-sidecar")

# ---------------------------------------------------------------------------
# Application state (populated in lifespan)
# ---------------------------------------------------------------------------

_store_tenant: MiraVectorStore | None = None  # Brain 2 — per-tenant docs
_store_shared: MiraVectorStore | None = None  # Brain 1 — shared OEM library
_llm = None
_embedder = None


# ---------------------------------------------------------------------------
# Lifespan — initialise expensive resources once at startup
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN001
    """Initialise ChromaDB and LLM/embedding providers on startup."""
    global _store_tenant, _store_shared, _llm, _embedder  # noqa: PLW0603

    logger.info(
        "mira-sidecar v0.1.0 starting — llm_provider=%s embedding_provider=%s",
        settings.llm_provider,
        settings.embedding_provider,
    )

    # Initialise vector stores — Brain 2 (tenant) + Brain 1 (shared OEM)
    _store_tenant = MiraVectorStore(
        chroma_path=settings.chroma_path,
        collection_name="mira_docs",
    )
    _store_shared = MiraVectorStore(
        chroma_path=settings.chroma_path,
        collection_name="shared_oem",
    )

    # Initialise LLM + embedding providers
    _llm, _embedder = create_providers(settings)

    logger.info(
        "Startup complete — chroma_path=%s tenant_docs=%d shared_docs=%d",
        settings.chroma_path,
        _store_tenant.doc_count(),
        _store_shared.doc_count(),
    )

    yield

    logger.info("mira-sidecar shutting down")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="MIRA RAG Sidecar",
    version="0.1.0",
    description="RAG + FSM sidecar for MIRA industrial maintenance AI",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class IngestRequest(BaseModel):
    filename: str
    asset_id: str
    path: str
    collection: str = "tenant"  # "tenant" → Brain 2, "shared" → Brain 1


class IngestResponse(BaseModel):
    status: str
    chunks_added: int


class RAGRequest(BaseModel):
    query: str
    asset_id: str
    tag_snapshot: dict[str, Any] = {}
    context: str = ""


class RAGResponse(BaseModel):
    answer: str
    sources: list[dict[str, Any]]


class BuildFSMRequest(BaseModel):
    asset_id: str
    tag_history: list[StateVector]


class StatusResponse(BaseModel):
    status: str
    version: str
    tenant_doc_count: int
    shared_doc_count: int
    llm_provider: str
    embedding_provider: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _require_tenant_store() -> MiraVectorStore:
    if _store_tenant is None:
        raise HTTPException(status_code=503, detail="Tenant vector store not initialised")
    return _store_tenant


def _require_shared_store() -> MiraVectorStore:
    if _store_shared is None:
        raise HTTPException(status_code=503, detail="Shared vector store not initialised")
    return _store_shared


def _require_llm():  # noqa: ANN201
    if _llm is None:
        raise HTTPException(status_code=503, detail="LLM provider not initialised")
    return _llm


def _require_embedder():  # noqa: ANN201
    if _embedder is None:
        raise HTTPException(status_code=503, detail="Embedding provider not initialised")
    return _embedder


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/status", response_model=StatusResponse)
async def status() -> StatusResponse:
    """Health check and provider info."""
    tenant_store = _require_tenant_store()
    shared_store = _require_shared_store()
    llm = _require_llm()
    embedder = _require_embedder()
    return StatusResponse(
        status="ok",
        version="0.2.0",
        tenant_doc_count=tenant_store.doc_count(),
        shared_doc_count=shared_store.doc_count(),
        llm_provider=f"{settings.llm_provider}:{llm.model_name}",
        embedding_provider=f"{settings.embedding_provider}:{embedder.model_name}",
    )


@app.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest) -> IngestResponse:
    """Parse a document, chunk it, embed chunks, and store in ChromaDB.

    The file must already be accessible at req.path on the local filesystem.
    Use collection="shared" to ingest into Brain 1 (shared OEM library).
    """
    store = _require_shared_store() if req.collection == "shared" else _require_tenant_store()
    embedder = _require_embedder()

    logger.info(
        "ingest: asset_id=%s filename=%s path=%s",
        req.asset_id,
        req.filename,
        req.path,
    )

    # Parse and chunk
    chunks = chunk_document(req.path)
    if not chunks:
        raise HTTPException(
            status_code=422,
            detail=f"No text could be extracted from '{req.filename}'",
        )

    # Embed
    texts = [c.text for c in chunks]
    embeddings = await embed_texts(texts, embedder)
    if not embeddings:
        raise HTTPException(status_code=502, detail="Embedding provider returned no vectors")

    # Store
    store.add(chunks=chunks, embeddings=embeddings, asset_id=req.asset_id)

    logger.info(
        "ingest complete: asset_id=%s filename=%s chunks_added=%d",
        req.asset_id,
        req.filename,
        len(chunks),
    )
    return IngestResponse(status="ok", chunks_added=len(chunks))


@app.post("/ingest/upload", response_model=IngestResponse)
async def ingest_upload(
    file: UploadFile,
    asset_id: str = Form(...),
    collection: str = Form("tenant"),
) -> IngestResponse:
    """Accept a multipart file upload, save it, and run the ingest pipeline.

    This endpoint lets callers (e.g. an Open WebUI Pipe Function) stream a
    file directly without needing a shared Docker volume.
    Use collection="shared" to ingest into Brain 1 (shared OEM library).
    """
    store = _require_shared_store() if collection == "shared" else _require_tenant_store()
    embedder = _require_embedder()

    if not file.filename:
        raise HTTPException(status_code=422, detail="Uploaded file has no filename")

    # Save to DOCS_BASE_PATH/{asset_id}/{filename}
    dest_dir = Path(settings.docs_base_path) / asset_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / file.filename

    content = await file.read()
    dest_path.write_bytes(content)

    logger.info(
        "ingest/upload: asset_id=%s filename=%s size=%d path=%s",
        asset_id,
        file.filename,
        len(content),
        dest_path,
    )

    # Chunk, embed, store — same pipeline as /ingest
    chunks = chunk_document(str(dest_path))
    if not chunks:
        raise HTTPException(
            status_code=422,
            detail=f"No text could be extracted from '{file.filename}'",
        )

    texts = [c.text for c in chunks]
    embeddings = await embed_texts(texts, embedder)
    if not embeddings:
        raise HTTPException(status_code=502, detail="Embedding provider returned no vectors")

    store.add(chunks=chunks, embeddings=embeddings, asset_id=asset_id)

    logger.info(
        "ingest/upload complete: asset_id=%s filename=%s chunks_added=%d",
        asset_id,
        file.filename,
        len(chunks),
    )
    return IngestResponse(status="ok", chunks_added=len(chunks))


@app.post("/rag", response_model=RAGResponse)
async def rag(req: RAGRequest) -> RAGResponse:
    """Run the dual-brain RAG pipeline and return an AI-generated answer.

    Queries Brain 2 (tenant docs) and Brain 1 (shared OEM library),
    merges results by cosine distance, and returns the top-5 to the LLM.
    """
    tenant_store = _require_tenant_store()
    shared_store = _require_shared_store()
    llm = _require_llm()
    embedder = _require_embedder()

    logger.info(
        "rag: asset_id=%s query='%s'",
        req.asset_id,
        req.query[:120],
    )

    result = await rag_query(
        query=req.query,
        asset_id=req.asset_id,
        tag_snapshot=req.tag_snapshot,
        store=tenant_store,
        shared_store=shared_store,
        llm=llm,
        embedder=embedder,
    )

    return RAGResponse(answer=result["answer"], sources=result["sources"])


@app.post("/build_fsm", response_model=FSMModel)
async def build_fsm_endpoint(req: BuildFSMRequest) -> FSMModel:
    """Build and return an FSM model from a sequence of state observations."""
    logger.info(
        "build_fsm: asset_id=%s history_len=%d",
        req.asset_id,
        len(req.tag_history),
    )

    model = build_fsm(
        asset_id=req.asset_id,
        history=req.tag_history,
        rare_threshold=settings.fsm_rare_threshold,
    )
    return model


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host=settings.host,  # always 127.0.0.1 per security policy
        port=settings.port,
        reload=False,
        log_level="info",
    )
