# ARCHIVED — mira-sidecar

**Status:** Archived 2026-04-12  
**Superseded by:** NeonDB + pgvector (production RAG path) + ADR-0003 (Edge Inference Strategy)

## Why

The sidecar was "Path B" — a ChromaDB-based local RAG microservice. It was superseded by:

1. **NeonDB consolidation (Mar 18)** — 17K+ pre-embedded chunks discovered and wired into `neon_vectors.py`; now 59K+ rows in production. This became the authoritative vector store.
2. **ADR-0003** — local inference fallback is Ollama/Open WebUI, not a separate sidecar service.

The sidecar was never deployed to production and is no longer referenced by any active service.

## What's here

- FastAPI microservice with ChromaDB dual-brain RAG (`shared_oem` + `mira_docs`)
- Tier routing (local Ollama vs Claude API based on query complexity)
- FSM builder from state history
- Integration tests in `tests/regime6_sidecar/`

Do not build on or extend this code.
