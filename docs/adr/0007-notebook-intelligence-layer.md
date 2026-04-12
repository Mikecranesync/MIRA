# ADR-0007: Notebook Intelligence Layer — Open WebUI + MIRA Pipeline

## Status
Accepted

## Context

MIRA's ingest problem is not technical — it is a mental model mismatch. Ingestion
currently happens as a side effect of using the Telegram/Slack bots: a tech gets
a diagnostic response and knowledge is indexed incidentally. This means ingest
quality is bounded by bot usage patterns and the friction of those interfaces.

The goal is a tool where **ingestion is the primary action**: a tech pulls out
their phone, builds a knowledge base scoped to one piece of equipment, and
interrogates it. This is the NotebookLM pattern applied to industrial maintenance.

Additionally, the PDF processing pipeline was upgraded from pdfplumber to Docling
(`mira-core/scripts/docling_adapter.py`), which adds semantic chunking,
table-to-Markdown conversion (TableFormer), and OCR for scanned manuals. Open WebUI
has native Docling support via `DOCLING_SERVER_URL` — when set, every document
uploaded through the browser UI is processed by Docling automatically.

## Considered Options

1. **Build a purpose-built React PWA** — new frontend container, new document upload
   API, new chat UI. Full control, maximum flexibility, 4-6 weeks of frontend work.

2. **Build on top of Open WebUI** — use Open WebUI's existing shell (knowledge
   collections, document upload UI, chat interface, mobile layout) and add MIRA
   intelligence via the Pipelines extension mechanism. 1 week delta.

3. **Extend the Telegram bot UX** — add PDF handling and better feedback to the
   existing bot. Keeps everything in one adapter but doesn't solve the cross-device
   or cross-platform ingest problem.

## Decision

**Build on top of Open WebUI using its Pipelines and Tools extension points.**

Open WebUI's knowledge collection model maps directly to the notebook concept:
one collection per equipment job, documents dragged in through the browser, chat
scoped to that collection. The hard parts — document upload UI, knowledge storage,
RAG-grounded chat, mobile layout — are already built and already deployed in
`mira-core` at port 3000.

The delta is three components:

### 1. Docling server container (new in `mira-core/docker-compose.yml`)

```yaml
docling-serve:
  image: ghcr.io/docling-project/docling-serve:<pinned-tag>
  restart: unless-stopped
  networks: [core-net]
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:5001/health"]
```

Set `DOCLING_SERVER_URL=http://docling-serve:5001` in the Open WebUI environment.
Now every PDF uploaded through the browser — GS10 manuals, wiring diagrams, scanned
work orders — is processed by Docling: fault code tables preserved as Markdown,
scanned pages OCR'd, section headings used as semantic chunk boundaries.

### 2. MIRA Pipeline container (new `mira-pipeline/` in `mira-core/`)

Open WebUI Pipelines is a separate container that intercepts every chat message
before it reaches the model. The MIRA pipeline runs:

1. `classify_intent()` from `mira-bots/shared/guardrails.py` — safety short-circuit,
   intent classification
2. GSD FSM step from `mira-bots/shared/gsd_engine.py` — diagnostic state machine
3. NeonDB recall augmentation — cross-session equipment fault history
4. KB gap detection — if RAG score < 0.45 and equipment identified, fire scrape trigger
5. Response post-processing — citation injection, work order trigger detection

The pipeline reuses the existing shared engine directly — no logic duplication.
A tech using Open WebUI gets MIRA's full diagnostic intelligence transparently.

### 3. Three Open WebUI Tool functions

Exposed as callable tools (function-calling pattern):

| Tool | Action |
|------|--------|
| `create_work_order(equipment_id, fault_description)` | POST to Atlas CMMS |
| `recall_fault_history(equipment_id)` | Query NeonDB across all sessions |
| `trigger_doc_scrape(manufacturer, model)` | Fire `POST /ingest/scrape-trigger` |

## Notebook UX

A technician opens Open WebUI in a browser (phone or laptop):

1. Creates a knowledge collection: **"Line 3 VFD — GS10 — Apr 2026"**
2. Drags in the GS10 manual PDF → Docling processes it; fault code tables land
   as clean Markdown, scanned wiring diagram pages are OCR'd
3. Uploads a nameplate photo → vision model describes it, indexed to collection
4. Opens chat scoped to this collection with the MIRA pipeline active
5. Types: *"showing E.OP.1"*
6. MIRA pipeline: classifies as fault code query → RAG pulls fault table from
   manual page 47 → GSD FSM generates follow-up diagnostic question →
   response cites source page
7. Diagnosis confirmed → one-tap work order generated in Atlas

The collection persists. Next tech who works the same machine inherits the full
knowledge base. NeonDB recall can surface this history across notebooks.

## FactoryLM-Specific Advantages Over NotebookLM

- **Equipment memory across notebooks** — NeonDB stores resolved faults; a new
  notebook for the same model can pull prior repair history as a source
- **Nameplate → auto-discovery** — upload nameplate photo → manufacturer/model
  identified → Apify scraper auto-runs → manufacturer docs land in the notebook
  without manual URL entry
- **Work order as notebook output** — diagnosis produces an Atlas CMMS work order,
  not just a text summary
- **Offline mode** — PWA service worker caches the notebook; local inference path
  (qwen2.5vl:7b on Bravo) handles chat when factory floor WiFi drops
- **Safety guardrails** — 21 safety keywords short-circuit to hazard response;
  this never fires in NotebookLM because it has no industrial safety context

## Implementation Order

1. Add Docling server to `mira-core/docker-compose.yml` and wire `DOCLING_SERVER_URL`
2. Write `mira-pipeline/pipeline.py` wrapping GSD engine
3. Add pipeline container to `mira-core/docker-compose.yml`
4. Write three Tool functions and register in Open WebUI
5. Configure Open WebUI system prompt, branding, model defaults

## Consequences

### Positive
- No new frontend to build or maintain — Open WebUI handles UI, mobile layout,
  file upload UX, and collection management
- Docling's table detection resolves the most significant quality gap in equipment
  manual ingestion (fault code tables were previously lost or malformed)
- Pipelines architecture keeps MIRA's intelligence portable — the same GSD engine
  powers Telegram, Slack, and now the notebook interface
- Version-pinned Open WebUI already satisfies the MIRA hard constraint (no `:latest`)

### Negative
- Open WebUI Pipeline API can change between releases — pipeline adapter must be
  tested after any Open WebUI version bump
- Docling server adds ~2GB to the image footprint (ML models for TableFormer + OCR)
- Collection scoping requires the tech to consciously create and select the right
  collection; there is no automatic per-equipment isolation
- Open WebUI branding must be suppressed for customer-facing deployments;
  white-labeling is supported but requires config discipline

### Risks
- If Open WebUI deprecates the Pipelines extension point, the intelligence layer
  falls back to the bot adapters — no data loss, just UX regression
- Docling server cold-start is ~30s (model load); first PDF after container restart
  will be slow; subsequent documents are fast

## Related ADRs
- ADR-0003: Edge Inference Strategy — local model fallback applies here
- ADR-0005: AR HUD Architecture — notebook becomes the data layer for HUD overlays
