  
**MIRA**

RAG Upgrade — LlamaIndex Orchestration Layer

| Product | MIRA v2.1.0 Monorepo |
| :---- | :---- |
| **Version** | PRD v1.0 |
| **Date** | March 28, 2026 |
| **Author** | mike@cranesync.com |
| **Target Host** | bravonode |
| **Status** | Ready to Build |

# **1\. Executive Summary**

MIRA v2.1.0 has a working end-to-end RAG pipeline: PDFPlumber handles text extraction, ChromaDB stores vectors, Ollama runs inference, and nomic-embed-text generates embeddings. The gap is the orchestration layer — chunking, embedding, indexing, retrieval, and query engine logic are currently written from scratch inside rag\_worker.py.

This PRD defines how to wire LlamaIndex around the existing stack so MIRA stops maintaining hand-rolled RAG logic and gains production-grade chunking, retrieval, and query orchestration — without replacing any existing component.

| SCOPE | What changes: rag\_worker.py internals only. What stays the same: PDFPlumber, ChromaDB, Ollama, Nemotron integration, worker architecture, Telegram/Slack interfaces, Doppler secrets, Docker Compose. |
| :---- | :---- |

# **2\. Current Architecture**

| User Message (Telegram / Slack) |
| :---- |
|         ↓ |
| engine.py → router → rag\_worker.py |
|         ↓ |
| \[PDFPlumber\]          ← extracts text from PDFs / manuals |
|         ↓ |
| \[Hand-rolled chunker\] ← splits text manually |
|         ↓ |
| \[nomic-embed-text\]    ← direct HTTP call to Ollama |
|         ↓ |
| \[ChromaDB\]            ← stores and retrieves vectors |
|         ↓ |
| \[Ollama / Nemotron\]   ← LLM answer generation |
|         ↓ |
| guardrails.py → reply to user |

## **Pain Points in Current rag\_worker.py**

* Chunking is manually tuned — no semantic awareness, chunk size is a guess

* Embedding calls are raw HTTP to Ollama — no retry logic, no batching

* Retrieval is single-stage cosine similarity only — no reranking

* No query engine: prompt assembly is ad-hoc string concatenation

* No node metadata: chunks have no source file, page number, or doc title

* Re-ingestion is destructive: re-running wipes the existing collection

# **3\. Target Architecture**

| User Message (Telegram / Slack) |
| :---- |
|         ↓ |
| engine.py → router → rag\_worker.py   \[INTERFACE UNCHANGED\] |
|         ↓ |
| \[PDFPlumber\]                          \[UNCHANGED\] |
|         ↓ |
| \[LlamaIndex SimpleDirectoryReader adapter\] |
|         ↓ |
| \[LlamaIndex SentenceSplitter\]         ← 512 tokens, 128 overlap |
|         ↓ |
| \[LlamaIndex OllamaEmbedding\]          ← nomic-embed-text |
|         ↓ |
| \[LlamaIndex ChromaVectorStore\]        ← same ChromaDB instance |
|         ↓ |
| \[LlamaIndex VectorStoreIndex\] |
|         ↓ |
| \[LlamaIndex RetrieverQueryEngine\] |
|    ├── \[VectorIndexRetriever\] similarity\_top\_k=5 |
|    └── \[Nemotron Reranker\]    if NVIDIA\_API\_KEY is set |
|         ↓ |
| \[Ollama / Nemotron LLM\]               \[UNCHANGED\] |
|         ↓ |
| guardrails.py → reply to user          \[UNCHANGED\] |

# **4\. Scope**

## **In Scope**

* Replace hand-rolled chunker/embedder/retriever in rag\_worker.py with LlamaIndex

* Add node metadata (source file, page number, doc title) to all chunks

* Implement two-stage retrieval: vector similarity \+ optional Nemotron rerank

* Preserve existing ChromaDB collections — no destructive migration

* Add incremental ingestion (upsert, not wipe-and-reload)

* Maintain all existing Nemotron → Ollama fallback paths

## **Out of Scope**

* Replacing PDFPlumber — stays as the extraction layer

* Replacing ChromaDB or changing collection names

* Replacing Ollama

* Changing engine.py, telegram\_bot.py, or slack\_bot.py

* Changing guardrails.py

* Changing Doppler secrets structure

# **5\. File Map**

| File | Change Type | Notes |
| :---- | :---- | :---- |
| mira-bots/shared/workers/rag\_worker.py | Major refactor | Core target — LlamaIndex replaces internals |
| mira-bots/shared/ingest/ | New directory | Ingestion scripts using LlamaIndex |
| mira-bots/shared/ingest/ingest\_pdfs.py | New file | Batch PDF ingestion — PDFPlumber \+ LlamaIndex |
| mira-bots/shared/ingest/ingest\_single.py | New file | Single-doc ingestion for on-the-fly uploads |
| mira-bots/shared/llama\_config.py | New file | LlamaIndex Settings object — centralized config |
| requirements.txt | Additions | 4 new llama-index packages (see Section 6\) |
| docker-compose.yml | No change | — |
| CLAUDE.md | Update | Add LlamaIndex architecture notes (Prompt 6\) |

# **6\. Dependencies**

Add to requirements.txt without removing existing packages:

| llama-index\>=0.11.0 |
| :---- |
| llama-index-vector-stores-chroma\>=0.2.0 |
| llama-index-embeddings-ollama\>=0.2.0 |
| llama-index-llms-ollama\>=0.2.0 |
| \# Optional — local reranker if no NVIDIA key: |
| llama-index-postprocessor-flag-embedding-reranker\>=0.2.0 |
|  |
| \# Already installed — verify version compatibility: |
| chromadb\>=0.5.0 |
| pdfplumber\>=0.11.0 |

| NOTE | Run Prompt 7 (Docker Validation) before rebuilding on bravonode. It checks for chromadb version conflicts before the full rebuild. |
| :---- | :---- |

# **7\. Claude Code Prompts**

Run these prompts sequentially in Claude Code CLI inside the MIRA monorepo root. Each prompt builds on the previous one. Always review Claude's plan and approve before it writes any code.

| WORKFLOW | cd into the MIRA monorepo root, then run: claude  (to open Claude Code). Paste each prompt below in order. Wait for approval checkpoint before proceeding. |
| :---- | :---- |

## **Prompt 1 — Reconnaissance (Read-Only)**

| PROMPT 1 — PASTE INTO CLAUDE CODE |
| :---- |
| Read CLAUDE.md and the full project structure. Then read these files completely: |
|   \- mira-bots/shared/workers/rag\_worker.py |
|   \- mira-bots/shared/engine.py |
|   \- mira-bots/shared/guardrails.py |
|   \- requirements.txt |
|   \- docker-compose.yml |
|  |
| Ultrathink and produce an audit report. For rag\_worker.py I need: |
|   1\. Every function that does chunking, embedding, or retrieval |
|      \- list name, line numbers, and what it does |
|   2\. The ChromaDB collection name(s) being used |
|   3\. The Ollama endpoint being called for embeddings |
|   4\. How the Nemotron fallback is currently wired |
|   5\. What data rag\_worker.py returns to engine.py |
|      (exact return type and shape) |
|  |
| Do not write any code. Output the audit report only. |
| **Purpose:** Forces Claude to audit exactly what exists before touching anything. You review the output before proceeding. |

## **Prompt 2 — Dependency Setup**

| PROMPT 2 — PASTE INTO CLAUDE CODE |
| :---- |
| Read the audit report from the previous step plus requirements.txt. |
|  |
| Add these packages to requirements.txt without removing anything existing: |
|   llama-index\>=0.11.0 |
|   llama-index-vector-stores-chroma\>=0.2.0 |
|   llama-index-embeddings-ollama\>=0.2.0 |
|   llama-index-llms-ollama\>=0.2.0 |
|  |
| Then create: mira-bots/shared/llama\_config.py |
|  |
| This file defines one function: get\_llama\_settings() |
| It must: |
|   \- Read OLLAMA\_BASE\_URL from env (default: http://localhost:11434) |
|   \- Read CHROMA\_HOST from env (default: localhost) |
|   \- Read CHROMA\_PORT from env (default: 8000\) |
|   \- Read EMBED\_MODEL from env (default: nomic-embed-text) |
|   \- Read LLM\_MODEL from env (default: llama3.2) |
|   \- Return a Settings object with OllamaEmbedding and OllamaLLM configured |
|   \- Include a docstring explaining each env var |
|  |
| All env vars: os.environ.get() with fallbacks — never hardcoded. |
| No Doppler changes needed; these vars are already in Doppler config. |
|  |
| Show me the plan first. Get approval before writing any file. |
| **Purpose:** Creates llama\_config.py as the single centralized config object. Isolated from rag\_worker.py so it can be tested standalone. |

## **Prompt 3 — Ingestion Script**

| PROMPT 3 — PASTE INTO CLAUDE CODE |
| :---- |
| Read mira-bots/shared/llama\_config.py (just created) and the |
| current rag\_worker.py ingestion logic from the audit. |
|  |
| Create: mira-bots/shared/ingest/ingest\_pdfs.py |
|  |
| This script must: |
|   1\. Accept \--docs-dir argument (path to folder of PDFs) |
|   2\. Accept \--collection argument (ChromaDB collection name, |
|      default: 'mira\_kb') |
|   3\. Accept \--overwrite flag (if set, clears collection first; |
|      default: False \= upsert only) |
|   4\. Use pdfplumber to extract text from each PDF |
|      (NOT LlamaIndex's built-in reader — keep PDFPlumber) |
|   5\. Write extracted text to temp .txt files in /tmp/mira\_ingest/ |
|   6\. Use LlamaIndex SimpleDirectoryReader to load those temp files |
|   7\. Use SentenceSplitter: chunk\_size=512, chunk\_overlap=128 |
|   8\. Attach metadata to each node: |
|      {source\_file: original\_pdf\_name, collection: collection\_name} |
|   9\. Use llama\_config.get\_llama\_settings() for embeddings |
|  10\. Use ChromaVectorStore pointing to the running ChromaDB instance |
|  11\. Build VectorStoreIndex from nodes and persist |
|  12\. Print progress: file name, chunk count, total nodes ingested |
|  13\. Clean up temp files after ingestion |
|  |
| Show me the plan and an ASCII data flow diagram. |
| Get approval before writing any code. |
| **Purpose:** Creates the ingestion pipeline. PDFPlumber stays for extraction; LlamaIndex handles everything downstream. |

## **Prompt 4 — Refactor rag\_worker.py (Core Change)**

| PROMPT 4 — PASTE INTO CLAUDE CODE |
| :---- |
| This is the core refactor. Read carefully: |
|   \- mira-bots/shared/workers/rag\_worker.py  (current) |
|   \- mira-bots/shared/llama\_config.py         (new config) |
|   \- mira-bots/shared/ingest/ingest\_pdfs.py   (new ingestion) |
|   \- The audit report from Prompt 1 |
|  |
| MUST PRESERVE: |
|   \- Function signature that engine.py calls (do not change interface) |
|   \- Return type and shape that engine.py expects |
|   \- Nemotron fallback logic (if NVIDIA\_API\_KEY set, use nemotron.py |
|     reranker) |
|   \- All guardrails.py integration points |
|   \- All logging format: \[INFO\] LLM\_CALL worker=rag |
|  |
| MUST REPLACE: |
|   \- Hand-rolled chunking → LlamaIndex SentenceSplitter (in index, |
|     not re-chunked at query time) |
|   \- Direct ChromaDB cosine call → LlamaIndex VectorIndexRetriever |
|     with similarity\_top\_k=5 |
|   \- Manual prompt assembly → LlamaIndex RetrieverQueryEngine with |
|     custom prompt template |
|  |
| QUERY ENGINE SPEC: |
|   VectorStoreIndex.from\_vector\_store(ChromaVectorStore(...)) |
|   RetrieverQueryEngine with: |
|     retriever: VectorIndexRetriever(similarity\_top\_k=5) |
|     node\_postprocessors: \[NemotronReranker\] if NVIDIA\_API\_KEY else \[\] |
|     response\_synthesizer: get\_response\_synthesizer( |
|       response\_mode='compact') |
|  |
| QA PROMPT TEMPLATE: |
|   You are MIRA, an industrial maintenance AI. Use the following |
|   context from maintenance manuals to answer the technician question. |
|   If the answer is not in the context, say so — do not guess. |
|   Context: {context\_str} |
|   Technician question: {query\_str} |
|   Answer: |
|  |
| FALLBACKS: |
|   \- ChromaDB unreachable: log error, return graceful error string |
|   \- Empty retrieval: return 'I don't have documentation covering |
|     that — please provide the relevant manual page.' |
|  |
| Show me a complete plan with before/after ASCII diagram. |
| Get approval before writing a single line. |
| **Purpose:** The main event. Replaces rag\_worker.py internals while keeping all external interfaces identical — engine.py never needs to change. |

## **Prompt 5 — Smoke Tests**

| PROMPT 5 — PASTE INTO CLAUDE CODE |
| :---- |
| Read the refactored rag\_worker.py plus the existing test suite. |
|  |
| Create: mira-bots/tests/test\_rag\_llamaindex.py |
|  |
| Write 6 unit tests using pytest and unittest.mock: |
|  |
|   1\. test\_retriever\_returns\_nodes |
|      mock ChromaVectorStore, assert retriever returns \>0 nodes |
|      for a valid query |
|  |
|   2\. test\_empty\_retrieval\_fallback |
|      mock retriever to return 0 nodes, assert rag\_worker returns |
|      the 'no documentation' fallback string |
|  |
|   3\. test\_chromadb\_unreachable |
|      mock ChromaDB connection to raise ConnectionError, |
|      assert graceful error string returned (no crash) |
|  |
|   4\. test\_metadata\_preserved |
|      assert retrieved nodes have source\_file and collection |
|      metadata keys |
|  |
|   5\. test\_nemotron\_reranker\_applied |
|      mock NVIDIA\_API\_KEY as set, assert NemotronReranker is |
|      in the postprocessors list |
|  |
|   6\. test\_nemotron\_reranker\_skipped |
|      mock NVIDIA\_API\_KEY as unset, assert postprocessors is empty |
|  |
| All mocks must be clean — no real ChromaDB or Ollama calls. |
| Run with: pytest mira-bots/tests/test\_rag\_llamaindex.py \-v |
|  |
| Show plan first. Get approval before writing. |
| **Purpose:** Validates the refactor against the exact failure modes that have bitten MIRA before: retrieval misses, ChromaDB timeouts, Nemotron key not set. |

## **Prompt 6 — CLAUDE.md Update**

| PROMPT 6 — PASTE INTO CLAUDE CODE |
| :---- |
| Read CLAUDE.md in the repo root. |
|  |
| Add a new section titled 'RAG Architecture (LlamaIndex)' that |
| documents: |
|   1\. Data flow from PDF ingestion to query response (ASCII diagram) |
|   2\. ChromaDB collection naming convention |
|   3\. How to re-ingest documents: |
|      python mira-bots/shared/ingest/ingest\_pdfs.py \\ |
|        \--docs-dir \<path\> \--collection \<name\> |
|   4\. How to add a new document source (checklist) |
|   5\. Env vars LlamaIndex reads (from llama\_config.py) |
|   6\. Where Nemotron slots into the query engine |
|  |
| Write for a developer who knows Python but has never used LlamaIndex. |
| Keep under 200 lines. Match the formatting style of existing CLAUDE.md. |
|  |
| No approval needed — write it directly. |
| **Purpose:** Keeps CLAUDE.md accurate so future Claude Code sessions start with the correct mental model of the new architecture. |

## **Prompt 7 — Docker Validation**

| PROMPT 7 — PASTE INTO CLAUDE CODE |
| :---- |
| Read docker-compose.yml and the updated requirements.txt. |
|  |
| I need to verify the Docker build will succeed before pushing to |
| bravonode. Do the following: |
|  |
|   1\. Check for version conflicts between the new llama-index packages |
|      and existing packages in requirements.txt |
|  |
|   2\. Check if llama-index-vector-stores-chroma requires a specific |
|      chromadb version — compare to what is currently pinned |
|  |
|   3\. Generate the pip install command to test locally: |
|      pip install \-r requirements.txt \--dry-run |
|  |
|   4\. If any conflicts found, propose the minimum version pins to |
|      resolve them |
|  |
| Do not modify docker-compose.yml. |
| Output a conflict report and recommended requirements.txt pins only. |
| **Purpose:** Catches dependency conflicts before the bravonode rebuild, which requires the full Docker workaround due to the Doppler keychain lock. |

# **8\. Execution Order**

| Step | Prompt | Est. Time | Risk | bravonode Impact |
| :---- | :---- | :---- | :---- | :---- |
| 1 | Reconnaissance audit | 5 min | None — read only | None |
| 2 | llama\_config.py \+ requirements.txt | 10 min | Low — new file | None |
| 3 | ingest\_pdfs.py | 20 min | Low — new file | None |
| 4 | rag\_worker.py refactor | 45 min | Medium — live code | Feature branch |
| 5 | Smoke tests | 20 min | Low | Feature branch |
| 6 | CLAUDE.md update | 5 min | None | None |
| 7 | Docker validation | 10 min | Low | Validate before rebuild |

| STRATEGY | Run Prompts 1–3 first (zero bravonode impact). Run Prompt 4 in a feature branch. Merge only after Prompt 5 tests pass. |
| :---- | :---- |

# **9\. Rollback Plan**

Because rag\_worker.py is the only file with breaking changes, rollback is a single command:

| \# If LlamaIndex refactor breaks something on bravonode: |
| :---- |
| git checkout main \-- mira-bots/shared/workers/rag\_worker.py |
| docker cp mira-bots/shared/workers/rag\_worker.py \\ |
|   bravonode:/app/shared/workers/ |
| docker exec bravonode supervisorctl restart all |
|  |
| \# Restores instantly. LlamaIndex packages in requirements.txt |
| \# cause no harm even if rag\_worker.py doesn't use them yet. |

# **10\. Success Criteria**

* All 6 smoke tests pass: pytest mira-bots/tests/test\_rag\_llamaindex.py \-v

* Fault code query ('F-201 fault') returns response citing source\_file metadata

* ChromaDB connection error returns graceful string — not a 500 crash

* Nemotron reranker activates when NVIDIA\_API\_KEY is set (visible in logs)

* Re-ingestion with \--overwrite=False does not wipe existing chunks

* Telegram bot handles a live maintenance query end-to-end on bravonode

* CLAUDE.md updated with new RAG architecture section

# **11\. Future Extensions (Post-MVP)**

| Feature | LlamaIndex Component | Priority |
| :---- | :---- | :---- |
| Per-tenant ChromaDB collections | Namespace routing in ChromaVectorStore | High |
| Global KB \+ tenant KB dual retrieval | RouterQueryEngine with two indexes | High |
| Image / photo ingestion (nameplates, prints) | MultiModalVectorStoreIndex | Medium |
| Query rewriting before retrieval | QueryRewritingRetriever | Medium |
| Streaming responses to Telegram | LlamaIndex streaming response mode | Low |
| Automatic doc freshness check | IngestionPipeline with cache | Low |

*FactoryLM / CraneSync  ·  MIRA v2.1.0  ·  Confidential*