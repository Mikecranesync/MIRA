# RAG Pipeline Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
End-to-end retrieval-augmented generation across **knowledge ingest** (offline) and **query-time retrieval** (runtime). Produces grounded, cited diagnostic answers from MIRA's knowledge base of OEM manuals, equipment photos, and conversation history. Operates as **two completely separate pipelines** that share only NeonDB tables — no shared runtime, no shared framework, all hand-written Python (no LangChain / LlamaIndex per CLAUDE.md hard constraints).

## Scope
**IN scope**
- Ingest pipeline (`mira-crawler` + `mira-core/scripts/ingest_*`)
- Query pipeline inside `mira-bots/shared/workers/rag_worker.py` and `shared/recall.py`
- Hybrid retrieval: pgvector (dense) + BM25 (lexical) fused via Reciprocal Rank Fusion (Unit 6)
- Citation formatting in engine replies
- NeonDB tables: `knowledge_entries`, `fault_codes`, `manual_cache`, `manuals`, `source_fingerprints`

**OUT of scope**
- Knowledge graph hop retrieval (`knowledge-graph-spec.md`)
- Vision description (`mira-ingest /ingest/photo`)
- ChromaDB legacy retrieval (`mira-sidecar`, deprecated)

## Architecture

### Ingest (offline)
```
manual_cache → ingest_manuals.py → pdfplumber|Docling → blocks
                          → chunker.py → ≥ MIN_CHUNK_CHARS chunks
                          → Ollama nomic-embed-text-v1.5 (768-d)
                          → NeonDB.knowledge_entries (tenant_id scoped)
Claude API (legacy)/Groq → extract_fault_codes.py → NeonDB.fault_codes
```

### Query (runtime, `RAGWorker`)
```
User query
  ├── guardrails.expand_abbreviations()
  ├── guardrails.rewrite_question()
  ├── Hybrid retrieval (gated by MIRA_RETRIEVAL_HYBRID_ENABLED)
  │     ├── pgvector cosine ANN top-K
  │     ├── BM25 over chunk text top-K
  │     └── ILIKE product filter
  │     → Reciprocal Rank Fusion (k=MIRA_RRF_K, default 60) → top-N chunks
  ├── Build prompt with chunks as context (cited)
  ├── InferenceRouter.complete(messages, sanitize=True)
  └── reply with [source N] citations
```

## API Contract

### Internal — `RAGWorker`
```python
RAGWorker(db_path, openwebui_url, api_key, collection_id, tenant_id)
  .retrieve(query: str, k: int = 5) -> list[Chunk]
  .answer(query: str, history, photo_b64=None) -> EngineReply
```

`Chunk` shape: `{id, text, score, source_url, equipment_id, page_num, section}`.

### NeonDB schema (canonical)
- `knowledge_entries (id UUID, tenant_id, equipment_id, content TEXT, embedding vector(768), source_url, page_num, section, created_at)`
- `fault_codes (id, tenant_id, equipment_id, code TEXT, description, remedy, source_url)`
- `manual_cache (url, status, last_seen)` and `manuals (id, url, sha256, ingested_at)`

### Citation contract
Every grounded answer must include `[source N]` markers and the engine response object's `citations` field must list the URLs/sections matching those markers.

## Configuration
| Var | Default | Purpose |
|---|---|---|
| `NEON_DATABASE_URL` | required | KB store |
| `MIRA_TENANT_ID` | required | Tenant scope for retrieval and ingest |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Embedding host |
| `EMBED_MODEL` | `nomic-embed-text-v1.5` | 768-d embedder |
| `USE_DOCLING` | `false` | OCR + semantic parsing |
| `MIRA_RETRIEVAL_HYBRID_ENABLED` | `true` | Unit 6 hybrid kill switch |
| `MIRA_RRF_K` | `60` | RRF constant (Cormack et al. 2009) |
| `MIRA_HISTORY_LIMIT` | `20` | Conversation context cap |
| `MAX_PDF_PAGES` | `300` | Skip enormous manuals |
| `MIN_CHUNK_CHARS` | `80` | Drop micro-chunks |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| KB size | ~25,219 entries (2026-03-28) | grow continuously |
| Retrieval recall@5 (golden cases) | tracked in `tests/eval/` | ≥ 0.80 |
| Eval pass rate | 77 % (last recorded; stale) | ≥ 90 % |
| Citation present rate | unmeasured | 100 % on industrial queries |
| Hybrid uplift over vector-only | Unit 6 baseline | ≥ +5 pts recall@5 |
| Tenant leakage | 0 | RLS / tenant-id assertion in every retrieval test |

## Acceptance Criteria
1. **Tenant isolation:** A retrieval call with tenant A never returns rows from tenant B (covered in `tests/eval/`).
2. **Empty-KB fallback:** When `knowledge_entries` is empty, the engine still returns a non-empty answer with a "no sources" caveat — must not 5xx.
3. **Hybrid kill switch:** Setting `MIRA_RETRIEVAL_HYBRID_ENABLED=false` falls back to pre-Unit-6 path without code change.
4. **Citation markers:** Every grounded answer includes at least one `[source N]` and `citations` list entries match.
5. **Embedding dimension:** Ingest aborts on a non-768-d vector rather than silently inserting.
6. **Idempotent ingest:** Re-running `ingest_manuals.py` on the same URL inserts zero new chunks (sha256/url dedup).
7. **Eval golden set:** `tests/eval/` has 39 golden cases that run offline; CI must keep ≥ 90 % pass.
8. **No-LangChain invariant:** `grep -r "from langchain" .` returns zero hits; same for LlamaIndex.

## Known Issues
- pdfplumber loses table structure — flagged in `docs/architecture/rag-pipeline.md`.
- Eval pass rate (77 %) is stale per memory `project_mira_state.md` — re-run after every prompt or retrieval change.
- ChromaDB legacy data still lives in `mira-sidecar`; OEM migration to Open WebUI KB pending.
- Sites that block bots silently underrepresent some OEMs in the KB.

## Change Log
- 2026-04 — Hybrid retrieval (Unit 6) shipped behind `MIRA_RETRIEVAL_HYBRID_ENABLED`.
- 2026-03-28 — RAG architecture snapshot at v0.5.3 (`docs/architecture/rag-pipeline.md`).
- 2026-03-27 — Fault code extraction added.
