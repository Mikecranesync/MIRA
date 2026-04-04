"""MIRA RAG Sidecar — FastAPI application entry point.

Endpoints:
  GET  /status         — health + provider info
  POST /ingest         — parse document, embed, store in ChromaDB
  POST /ingest/upload  — multipart file upload + ingest pipeline
  POST /rag            — RAG query pipeline
  POST /route          — Path B tier-routed query (feature-flagged)
  POST /build_fsm      — build FSM model from state history

SaaS: reachable via Docker network (mira-net). Not exposed on host ports.
On-prem: bind to 127.0.0.1 via HOST env var for loopback-only access.
"""

from __future__ import annotations

import logging
import logging.config
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

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
_tier_router = None  # Path B tier router (None when tier_routing_enabled=False)
_health_probe = None


# ---------------------------------------------------------------------------
# Lifespan — initialise expensive resources once at startup
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN001
    """Initialise ChromaDB and LLM/embedding providers on startup."""
    global _store_tenant, _store_shared, _llm, _embedder, _tier_router, _health_probe  # noqa: PLW0603

    logger.info(
        "mira-sidecar v0.2.0 starting — llm_provider=%s embedding_provider=%s",
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

    # Initialise Path B tier routing (feature-flagged)
    if settings.tier_routing_enabled and settings.tier1_ollama_url:
        from llm.ollama_provider import OllamaProvider
        from routing.health_probe import HealthProbe
        from routing.tier_router import TierRouter

        _health_probe = HealthProbe(
            ollama_url=settings.tier1_ollama_url,
            interval=settings.health_probe_interval,
        )
        _health_probe.start()

        # Tier 1 provider: Ollama on Charlie (Gemma 4 E4B)
        # Use default 120s timeout — Gemma 4 E4B inference takes 30-90s for
        # full responses. tier1_timeout (15s) is for the health probe, not inference.
        tier1_provider = OllamaProvider(
            base_url=settings.tier1_ollama_url,
            chat_model=settings.tier1_model,
            embed_model=settings.ollama_embed_model,
        )

        # Tier 3 provider: reuse the already-initialized _llm if it's Anthropic,
        # otherwise create an Anthropic provider for fallback
        tier3_provider = _llm
        if settings.llm_provider != "anthropic" and settings.anthropic_api_key:
            from llm.anthropic_provider import AnthropicProvider

            tier3_provider = AnthropicProvider(
                api_key=settings.anthropic_api_key,
                model=settings.llm_model_anthropic,
                ollama_base_url=settings.ollama_base_url,
                ollama_embed_model=settings.ollama_embed_model,
            )

        _tier_router = TierRouter(
            health_probe=_health_probe,
            tier1_provider=tier1_provider,
            tier3_provider=tier3_provider,
            tier1_max_query_words=settings.tier1_max_query_words,
            tier2_gpu_url=settings.tier2_gpu_url,
        )
        logger.info(
            "TIER_ROUTING enabled — tier1=%s model=%s tier3=%s",
            settings.tier1_ollama_url,
            settings.tier1_model,
            tier3_provider.model_name if tier3_provider else "none",
        )
    else:
        logger.info(
            "TIER_ROUTING disabled — tier_routing_enabled=%s tier1_url=%s",
            settings.tier_routing_enabled,
            settings.tier1_ollama_url or "(empty)",
        )

    logger.info(
        "Startup complete — chroma_path=%s tenant_docs=%d shared_docs=%d",
        settings.chroma_path,
        _store_tenant.doc_count(),
        _store_shared.doc_count(),
    )

    yield

    if _health_probe:
        _health_probe.stop()
    logger.info("mira-sidecar shutting down")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="MIRA RAG Sidecar",
    version="0.2.0",
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


class RouteRequest(BaseModel):
    query: str
    asset_id: str = ""
    user_id: str = ""
    facility_id: str = "default"
    force_tier: Literal["tier1", "tier3"] | None = None
    tag_snapshot: dict[str, Any] = {}


class RouteResponse(BaseModel):
    answer: str
    sources: list[dict[str, Any]]
    tier_used: str
    latency_ms: int
    model: str
    query: str


class StatusResponse(BaseModel):
    status: str
    version: str
    tenant_doc_count: int
    shared_doc_count: int
    llm_provider: str
    embedding_provider: str
    tier_routing: bool = False
    tier1_available: bool = False


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
        tier_routing=_tier_router is not None,
        tier1_available=_health_probe.available if _health_probe else False,
    )


@app.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest) -> IngestResponse:
    """Parse a document, chunk it, embed chunks, and store in ChromaDB.

    The file must already be accessible at req.path on the local filesystem.
    Use collection="shared" to ingest into Brain 1 (shared OEM library).
    """
    store = _require_shared_store() if req.collection == "shared" else _require_tenant_store()
    embedder = _require_embedder()

    # X2 fix: restrict path to DOCS_BASE_PATH to prevent arbitrary file read
    real_path = Path(req.path).resolve()
    allowed_base = Path(settings.docs_base_path).resolve()
    if not str(real_path).startswith(str(allowed_base)):
        raise HTTPException(status_code=403, detail="Path must be within DOCS_BASE_PATH")

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

    # X1 fix: sanitize asset_id and filename to prevent path traversal
    safe_asset = re.sub(r"[^a-zA-Z0-9_\-]", "_", asset_id)
    safe_name = Path(file.filename).name  # strips directory components
    if not safe_name or ".." in safe_name:
        raise HTTPException(status_code=422, detail="Invalid filename")

    # X3 fix: reject uploads over 100MB before reading into memory
    if file.size and file.size > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 100MB)")

    content = await file.read()
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 100MB)")

    # Save to DOCS_BASE_PATH/{safe_asset}/{safe_name}
    dest_dir = Path(settings.docs_base_path) / safe_asset
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe_name
    dest_path.write_bytes(content)

    logger.info(
        "ingest/upload: asset_id=%s filename=%s size=%d path=%s",
        safe_asset,
        safe_name,
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

    store.add(chunks=chunks, embeddings=embeddings, asset_id=safe_asset)

    logger.info(
        "ingest/upload complete: asset_id=%s filename=%s chunks_added=%d",
        safe_asset,
        safe_name,
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


@app.post("/route", response_model=RouteResponse)
async def route(req: RouteRequest) -> RouteResponse:
    """Tier-routed RAG query — selects LLM provider based on query complexity.

    Same RAG pipeline as /rag, but the tier router picks which LLM
    (local Ollama vs Claude) handles the generation step.
    Requires tier_routing_enabled=True in config. Returns 503 if disabled.
    Use force_tier to override routing for testing (e.g. "tier1", "tier3").
    """
    import time

    if _tier_router is None:
        raise HTTPException(
            status_code=503,
            detail="Tier routing is disabled (set TIER_ROUTING_ENABLED=true and TIER1_OLLAMA_URL)",
        )

    tenant_store = _require_tenant_store()
    shared_store = _require_shared_store()
    embedder = _require_embedder()

    logger.info(
        "route: query='%s' user_id=%s force_tier=%s",
        req.query[:120],
        req.user_id,
        req.force_tier,
    )

    # Select tier and provider
    selection = _tier_router.select(query=req.query, force_tier=req.force_tier)
    t0 = time.monotonic()

    # Run the same RAG pipeline as /rag, but with the tier-selected LLM
    result = await rag_query(
        query=req.query,
        asset_id=req.asset_id,
        tag_snapshot=req.tag_snapshot,
        store=tenant_store,
        shared_store=shared_store,
        llm=selection.llm,
        embedder=embedder,
    )

    # H2 fix: if Tier 1 returned empty/canned error, fallback to Tier 3
    from routing.tier_router import Tier, TierSelection

    answer = result.get("answer", "")
    tier1_failed = selection.tier == Tier.TIER1 and (
        not answer or answer.startswith("Unable to generate")
    )
    if tier1_failed and _tier_router._tier3:
        logger.warning("TIER1_FALLBACK: empty response from tier1, retrying with tier3")
        fallback_llm = _tier_router._tier3
        result = await rag_query(
            query=req.query,
            asset_id=req.asset_id,
            tag_snapshot=req.tag_snapshot,
            store=tenant_store,
            shared_store=shared_store,
            llm=fallback_llm,
            embedder=embedder,
        )
        selection = TierSelection(
            tier=Tier.TIER3,
            complexity=selection.complexity,
            llm=fallback_llm,
            model_name=fallback_llm.model_name,
        )

    elapsed_ms = int((time.monotonic() - t0) * 1000)

    # Log the routing decision
    _tier_router.log_route(
        req.query,
        selection,
        elapsed_ms,
        fallback=tier1_failed,
        fallback_reason="tier1_empty" if tier1_failed else "",
    )

    return RouteResponse(
        answer=result["answer"],
        sources=result["sources"],
        tier_used=selection.tier.value,
        latency_ms=elapsed_ms,
        model=selection.model_name,
        query=req.query,
    )


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
        host=settings.host,  # 0.0.0.0 in Docker, 127.0.0.1 for on-prem
        port=settings.port,
        reload=False,
        log_level="info",
    )
