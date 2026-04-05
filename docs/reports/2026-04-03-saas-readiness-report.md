# Hosted MIRA SaaS Readiness Report

## 1. Architecture Overview (Current vs Target)

### Current Architecture

```
                    ┌─────────────────────────────────────┐
                    │         Mac Mini (Bravo)             │
                    │    Single-tenant, 13 containers      │
                    ├─────────────────────────────────────┤
                    │                                     │
Users ──Telegram──► │  mira-bot-telegram ──► Supervisor   │
      ──Slack────►  │  mira-bot-slack    ──► (engine.py)  │
      ──Web──────►  │  mira-core (Open WebUI :3000)       │
                    │         │                           │
                    │         ▼                           │
                    │  INFERENCE_BACKEND=claude|local      │
                    │  ├─ Claude API (httpx, no SDK)       │
                    │  └─ Open WebUI → Ollama (host)       │
                    │         │                           │
                    │         ▼                           │
                    │  RAG: NeonDB pgvector (cloud)        │
                    │  State: SQLite mira.db (local)       │
                    │  Vision: Ollama qwen2.5vl (local)    │
                    │  CMMS: Atlas (4 containers, local)   │
                    │  Tools: mira-mcp FastMCP (11 tools)  │
                    └─────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  NeonDB (AWS)       │
                    │  25,219 KB entries  │
                    │  Tenant-scoped      │
                    └─────────────────────┘
```

**What each module does today:**
- **mira-core**: Open WebUI v0.8.10 — chat interface, KB admin, user accounts. Talks to Ollama on the host.
- **mira-bots**: 5 bot adapters (Telegram, Slack, Teams, WhatsApp, Reddit) sharing a single `Supervisor` diagnostic engine. Dual inference: Claude API or local Ollama.
- **mira-bridge**: Node-RED on port 1880. Owns the SQLite WAL database. Orchestrates scheduled tasks.
- **mira-mcp**: FastMCP server with 11 tools (equipment status, faults, maintenance notes, CMMS work orders). SSE on 8000, REST on 8001.
- **mira-ingest**: FastAPI service for photo/PDF ingestion. Generates embeddings via Ollama, stores in NeonDB + Open WebUI KB.
- **mira-cmms**: Atlas CMMS (Postgres + Spring Boot + React + MinIO). Optional — enabled if `ATLAS_API_USER` is set.

**Where inference is called:**
- `mira-bots/shared/inference/router.py` — `InferenceRouter.complete()` → Claude API via httpx
- `mira-bots/shared/workers/rag_worker.py` — `RAGWorker._call_llm()` → Claude or Open WebUI fallback
- Vision: `mira-bots/shared/workers/vision_worker.py` → Ollama qwen2.5vl (always local)

**Where RAG/KB storage lives:**
- **NeonDB** (primary): 25k+ entries in `knowledge_entries` table with pgvector cosine similarity
- **Open WebUI** (secondary): KB collections, used for manual browsing via chat UI
- **SQLite** (state): `conversation_state`, `equipment_status`, `faults` tables

**Existing user/tenant concepts:**
- `MIRA_TENANT_ID` env var scopes all NeonDB queries (`WHERE tenant_id = :tid`)
- `tenants` and `tier_limits` tables exist in NeonDB (free/pro/enterprise tiers)
- Open WebUI has `WEBUI_AUTH=true` with admin-provisioned user accounts
- `api_usage` table tracks per-tenant Claude API consumption

### Target Architecture (Hosted SaaS v1)

```
                    ┌──────────────────────────────────────┐
                    │   https://app.factorylm.com          │
                    │   Cloud VPS / Managed K8s             │
                    ├──────────────────────────────────────┤
                    │                                      │
Customers ──Web──► │  Auth Gateway (email+password)        │
                    │         │                            │
                    │         ▼                            │
                    │  Open WebUI (per-customer workspace)  │
                    │  ├─ Customer A workspace + KB         │
                    │  ├─ Customer B workspace + KB         │
                    │  └─ Customer C workspace + KB         │
                    │         │                            │
                    │         ▼                            │
                    │  Inference Abstraction Layer          │
                    │  ├─ Default: Anthropic (our key)      │
                    │  ├─ BYOK: customer's Claude key       │
                    │  ├─ BYOK: customer's OpenAI key       │
                    │  └─ BYOK: any OpenAI-compatible       │
                    │         │                            │
                    │         ▼                            │
                    │  NeonDB (tenant-isolated pgvector)    │
                    │  Upload → chunk → embed → store       │
                    └──────────────────────────────────────┘
```

---

## 2. Gaps & Risks

### Dimension-by-Dimension: Current vs Target

#### Inference Backends
- **Current**: Claude API (httpx direct, no SDK) + local Ollama via Open WebUI. Switched by `INFERENCE_BACKEND` env var. Vision always local (Ollama qwen2.5vl).
- **Target**: Switchable Anthropic/OpenAI/others with BYOK support.
- **Gap**: **Small**. The `InferenceRouter` already talks to Claude via raw httpx. Adding OpenAI is straightforward — same pattern, different endpoint. BYOK means storing per-customer API keys and routing per request instead of using a global env var.
- **Risk**: Vision pipeline is tightly coupled to Ollama. For SaaS, vision must either (a) use Claude/OpenAI vision APIs or (b) run a shared Ollama instance in the cloud.

#### Auth / User Accounts
- **Current**: Open WebUI has `WEBUI_AUTH=true`, `ENABLE_SIGNUP=false` (admin-provisioned). No self-service signup. No email+password gateway in front.
- **Target**: Self-service signup with email+password or magic link.
- **Gap**: **Medium**. Open WebUI already has user accounts, passwords, roles, and API keys built in. The gap is enabling signup (`ENABLE_SIGNUP=true`) and potentially adding a lightweight gateway for billing/onboarding. Open WebUI's built-in auth may be sufficient for v1.
- **Risk**: Open WebUI's user model is designed for a single org, not multi-org SaaS. Need to verify workspace isolation is enforced in their codebase.

#### Multi-Tenancy & Data Isolation
- **Current**: NeonDB queries are tenant-scoped via `WHERE tenant_id = :tid`. SQLite is NOT tenant-scoped (single instance, shared data). Open WebUI is single-org.
- **Target**: Per-customer workspace/KB with strict isolation.
- **Gap**: **Medium-High**. NeonDB is ready. SQLite needs tenant_id columns added OR must be replaced with Postgres. Open WebUI workspace isolation needs verification.
- **Risk**: SQLite migration is the biggest blocker. The `conversation_state`, `equipment_status`, `faults`, and `maintenance_notes` tables have no `tenant_id` column.

#### Document Ingest
- **Current**: `POST /ingest/photo` and `POST /ingest/pdf` endpoints. Photos processed with Ollama vision → NeonDB. PDFs chunked with pdfplumber/Docling → NeonDB. Open WebUI KB push is best-effort secondary.
- **Target**: Hosted upload (web UI) per customer workspace.
- **Gap**: **Small**. Ingest service already exists and is tenant-scoped (`check_tier_limit(tenant_id)`). Just need to wire it to the customer's workspace and ensure the upload UI passes the right tenant_id.

#### CMMS Integration
- **Current**: Atlas CMMS (4 containers, Postgres + Spring Boot). 8 CMMS tools exposed via mira-mcp. Optional — only if `ATLAS_API_USER` is set.
- **Target**: Optional per-customer integration (later).
- **Gap**: **None for v1**. Already optional and gated by env var.

#### Observability / Ops
- **Current**: Healthcheck endpoints on all services. Container logs. Langfuse telemetry (optional). `api_usage` table for Claude API tracking.
- **Target**: Basic logs and health for single-region SaaS.
- **Gap**: **Small**. Health endpoints exist. Add a log aggregator (Loki, CloudWatch) and you're covered for v1.

### Biggest Risks

1. **Open WebUI multi-tenant RAG stability** — Not designed for multi-tenant SaaS. Workspace isolation may leak data between customers. Need to test or bypass.
2. **Vision pipeline requires Ollama** — No cloud alternative currently wired in. Must either containerize Ollama with GPU or switch to Claude/OpenAI vision APIs.
3. **SQLite is single-tenant** — Equipment status, faults, and conversation state are not tenant-scoped. Migration to Postgres or adding tenant_id columns is required.
4. **Hardcoded Tailscale IPs in Atlas CMMS compose** — `100.86.236.11` baked into docker-compose.yml. Must be parameterized.

---

## 3. Distance to SaaS — Plain Language

If we target the simplest possible hosted SaaS:
- Single region
- Email+password auth (Open WebUI built-in)
- One default inference provider (Anthropic, our key)
- Per-customer workspaces in Open WebUI

### Things We Get for Free from Open WebUI

Open WebUI v0.8.10 already provides:
- **User accounts** with email+password, roles (admin/user)
- **Knowledge collections** (per-user or shared) with document upload
- **RAG pipeline** (built-in embedding + retrieval per collection)
- **API key authentication** for programmatic access
- **Model management** (connect to Ollama, OpenAI, or any OpenAI-compatible endpoint)
- **Health endpoint** (`/health`)
- **Chat history** per user
- **Dark mode, mobile responsive UI**

**What this means**: A customer can already log into Open WebUI, upload a PDF, and chat with it using Claude or any OpenAI-compatible model — IF we configure the instance correctly.

### Things That Are Just Wiring / Config (1-2 days each)

1. **Enable signup** — Set `ENABLE_SIGNUP=true`, add admin approval flow if needed
2. **Add Anthropic as a connection** — Open WebUI supports "OpenAI-compatible" endpoints. Claude's API isn't perfectly OpenAI-compatible, but the Messages API proxy endpoint works
3. **BYOK** — Open WebUI already lets users configure their own API keys in Settings → Connections
4. **Deploy to cloud** — Docker Compose runs anywhere. Spin up a VPS, clone, `docker compose up`
5. **Domain + TLS** — Nginx reverse proxy with Let's Encrypt in front of port 3000
6. **NeonDB tenant scoping** — Already implemented. Just set `MIRA_TENANT_ID` per customer

### Things That Require Real New Code (2-5 days each)

1. **Tenant onboarding flow** — Script/API to create a new tenant in NeonDB, provision Open WebUI user, assign Knowledge Collection ID. Currently manual.
2. **SQLite tenant isolation** — Add `tenant_id` to `conversation_state`, `equipment_status`, `faults`, `maintenance_notes` tables. Update all queries. OR replace SQLite with Postgres.
3. **Inference abstraction refactor** — Current `InferenceRouter` is hardcoded to Claude. Need to support OpenAI, Groq, OpenRouter by generalizing the httpx call pattern. The structure is clean but needs the abstraction.
4. **Vision cloud migration** — Replace `VisionWorker → Ollama` with Claude Vision or OpenAI Vision API for SaaS (no local GPU). Biggest code change.
5. **Per-customer workspace isolation verification** — Audit Open WebUI's collection/workspace model to confirm Customer A can't see Customer B's documents. May need custom middleware.

### Summary: ~3-4 major code changes, ~5 config/wiring changes

The architecture is already ~60% there. NeonDB tenant isolation, Doppler secrets, dual inference backend, and the full ingest pipeline are production-ready. The main gaps are vision (tied to Ollama), SQLite (single-tenant), and tenant onboarding automation.

---

## 4. Minimal Step-by-Step Plan (1-2 Weeks of Work)

### Week 1: Core SaaS Foundation

**Day 1-2: Cloud Deployment + Auth**
- Provision a cloud VPS (Hetzner $20/mo or similar) or use `factorylm-prod` (100.68.120.99, already on Tailnet)
- Deploy MIRA via Docker Compose (minimal: mira-core + mira-ingest + mira-mcp)
- Enable `ENABLE_SIGNUP=true` in Open WebUI
- Add Nginx reverse proxy with Let's Encrypt TLS
- Verify: customer can sign up at `https://app.factorylm.com` and log in

**Day 2-3: Inference Provider Wiring**
- Configure Open WebUI to connect to Anthropic as an "OpenAI-compatible" connection (using the Claude Messages API proxy or a thin adapter)
- Test: customer can chat using Claude via the web UI
- Add BYOK support: Open WebUI's Settings → Connections already lets users add their own API keys
- Drop Ollama dependency for reasoning (keep it only for vision/embedding if needed)

**Day 3-4: Document Upload + RAG**
- Verify Open WebUI's built-in document upload works per-user
- Wire mira-ingest to accept uploads via the web UI (or rely on Open WebUI's built-in RAG)
- Test: customer uploads a PDF, can chat about its contents
- Configure NeonDB tenant_id per customer (manual for now, automated later)

**Day 4-5: Vision Migration**
- Replace `VisionWorker → Ollama qwen2.5vl` with Claude Vision API or OpenAI Vision API
- This is the biggest code change: modify `vision_worker.py` to call cloud vision instead of local Ollama
- Test: customer sends a photo, gets equipment identification
- Fallback: if vision is too expensive, disable photo features for v1 and add later

### Week 2: Multi-Tenancy + Polish

**Day 6-7: Tenant Isolation**
- Add `tenant_id` column to SQLite tables OR migrate to Postgres
- Create tenant onboarding script: `create_tenant.py` that provisions NeonDB row, Open WebUI user, and returns credentials
- Test: two customers can't see each other's data

**Day 7-8: Observability + Hardening**
- Add log aggregation (stdout → CloudWatch or Loki)
- Parameterize all hardcoded IPs (Atlas CMMS compose)
- Add rate limiting per tenant (tier_limits already in NeonDB schema)
- Add basic error pages and feedback mechanism

**Day 8-9: Smoke Test with Real Customer**
- Onboard a single test customer
- They sign up, upload a manual, ask maintenance questions
- Verify: inference works, RAG retrieves from their documents, no data leakage

**Day 9-10: Documentation + Handoff**
- Write customer onboarding guide
- Document the deployment architecture
- Set up basic monitoring alerts (disk, memory, health endpoint pings)

---

## 5. Longer-Term TODO (Not Required for First Tests)

- **Billing integration** — Stripe for usage-based or subscription billing
- **Team accounts & roles** — Multiple users per customer org, admin/viewer roles
- **On-prem hardware box** — Factory-deployed edge device (Config 1-6 from PRD)
- **Advanced CMMS integrations** — Fiix, eMaint, Maximo connectors (currently only Atlas)
- **PLC/Modbus integration** — mira-bridge with live equipment data (deferred to Config 4)
- **Custom domain per customer** — `acme.factorylm.com` vanity URLs
- **SOC 2 compliance** — Audit logging, data retention policies, GDPR deletion workflows
- **Horizontal scaling** — Kubernetes, multiple regions, read replicas
- **Mobile app** — Native iOS/Android for field technicians
- **Offline mode** — Edge inference when internet is unavailable
