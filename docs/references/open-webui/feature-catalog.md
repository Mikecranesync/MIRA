---
source: https://docs.openwebui.com
version: "0.6.x (stable, April 2026)"
fetched_date: "2026-04-19"
summary: >
  Comprehensive catalog of every user-facing and admin feature in Open WebUI's
  current stable release. Covers authentication, models, pipelines, RAG, voice,
  image generation, chat UX, memory, admin tools, integrations, and developer
  extensibility. Written for MIRA admins evaluating under-used capabilities.
---

# Open WebUI Feature Catalog

## Feature Matrix

| Feature | Category | Default | How to Enable | Requires | Docs URL |
|---|---|---|---|---|---|
| Email/password signup | Auth | On | `ENABLE_SIGNUP=true` | None | [docs](https://docs.openwebui.com/features/authentication-access/) |
| Admin approval gate | Auth | Off | Admin Panel > Settings > General > Default User Role = `pending` | None | [docs](https://docs.openwebui.com/features/authentication-access/) |
| SSO / OIDC (Google, Microsoft, Okta, Keycloak) | Auth | Off | Set `OAUTH_*` env vars | IdP | [docs](https://docs.openwebui.com/features/authentication-access/) |
| LDAP auth | Auth | Off | Set `LDAP_*` env vars | LDAP server | [docs](https://docs.openwebui.com/features/authentication-access/) |
| SCIM 2.0 provisioning | Auth | Off | Set `SCIM_*` env vars | SCIM-capable IdP | [docs](https://docs.openwebui.com/features/authentication-access/) |
| Trusted header auth | Auth | Off | `WEBUI_AUTH_TRUSTED_EMAIL_HEADER` | Reverse proxy | [docs](https://docs.openwebui.com/reference/env-configuration/) |
| API keys | Auth | Off | Admin Panel > Settings > General > Enable API Keys | None | [docs](https://docs.openwebui.com/features/authentication-access/api-keys/) |
| RBAC (roles + groups) | Auth | On | Admin Panel > Users | None | [docs](https://docs.openwebui.com/features/authentication-access/) |
| Ollama backend | Models | On | Settings > Connections > Ollama | Ollama instance | [docs](https://docs.openwebui.com/getting-started/quick-start/connect-a-provider) |
| OpenAI-compatible endpoint | Models | On | Settings > Connections > OpenAI | API key | [docs](https://docs.openwebui.com/getting-started/quick-start/connect-a-provider) |
| Anthropic endpoint (`/api/v1/messages`) | Models | Off | Add Anthropic connection | Anthropic key | [docs](https://docs.openwebui.com/reference/api-endpoints/) |
| Model presets (agents) | Models | On | Workspace > Models > + New Model | None | [docs](https://docs.openwebui.com/features/workspace/models) |
| Dynamic system prompt variables | Models | On | Use `{{ USER_NAME }}` in system prompt | None | [docs](https://docs.openwebui.com/features/workspace/models) |
| Per-model access control | Models | On | Workspace > Models > Edit > Visibility | None | [docs](https://docs.openwebui.com/features/workspace/models) |
| Per-model TTS voice | Models | Off | Workspace > Models > Edit > TTS Voice | TTS backend | [docs](https://docs.openwebui.com/features/workspace/models) |
| Global model defaults | Models | Off | Admin Panel > Settings > Models > gear | None | [docs](https://docs.openwebui.com/features/workspace/models) |
| Pipelines (filter/pipe/action) | Pipelines | Off | Deploy pipeline container; add OpenAI URL in Admin > Connections | Docker | [docs](https://docs.openwebui.com/features/extensibility/pipelines) |
| In-process Tools (Python) | Pipelines | Off | Workspace > Tools > + New Tool | None | [docs](https://docs.openwebui.com/features/extensibility/plugin) |
| In-process Filter Functions | Pipelines | Off | Workspace > Functions > + New Function | None | [docs](https://docs.openwebui.com/features/extensibility/plugin) |
| Pipe Functions (new model provider) | Pipelines | Off | Workspace > Functions > Pipe type | None | [docs](https://docs.openwebui.com/features/extensibility/pipelines/pipes/) |
| Community function import | Pipelines | Off | Workspace > Functions > Community | None | [docs](https://docs.openwebui.com/features/extensibility/) |
| MCP server (Streamable HTTP) | Tools/MCP | Off | Admin Panel > Settings > External Tools > + Add Server | MCP server | [docs](https://docs.openwebui.com/features/extensibility/mcp) |
| mcpo proxy (stdio/SSE MCP) | Tools/MCP | Off | Run mcpo container; register as OpenAPI server | Docker | [github](https://github.com/open-webui/mcpo) |
| OpenAPI server auto-discovery | Tools/MCP | Off | Admin Panel > Settings > External Tools > OpenAPI type | OpenAPI server | [docs](https://docs.openwebui.com/features/extensibility/) |
| RAG knowledge collections | Knowledge | On | Workspace > Knowledge > + New Knowledge | None | [docs](https://docs.openwebui.com/features/workspace/knowledge) |
| Hybrid search (BM25 + vector) | Knowledge | Off | `ENABLE_RAG_HYBRID_SEARCH=true` | None | [docs](https://docs.openwebui.com/features/workspace/knowledge) |
| Cross-encoder reranking | Knowledge | Off | `RAG_RERANKING_MODEL=...` | Reranking model | [docs](https://docs.openwebui.com/features/workspace/knowledge) |
| Full-context (no-chunk) mode | Knowledge | Off | Click attached KB > toggle Full Context | None | [docs](https://docs.openwebui.com/features/workspace/knowledge) |
| Agentic knowledge tools | Knowledge | Off | Enable native function calling per model | Native-capable model | [docs](https://docs.openwebui.com/features/workspace/knowledge) |
| 9 vector DB backends | Knowledge | ChromaDB | `VECTOR_DB=qdrant/pgvector/milvus/...` | Chosen DB | [docs](https://docs.openwebui.com/reference/env-configuration/) |
| 5 extraction engines | Knowledge | Unstructured | `PDF_EXTRACT_IMAGES`, `CONTENT_EXTRACTION_ENGINE` | Engine install | [docs](https://docs.openwebui.com/reference/env-configuration/) |
| Web search (SearXNG, Brave, etc.) | Knowledge | Off | Admin Panel > Settings > Web Search | Search provider | [docs](https://docs.openwebui.com/features/workspace/knowledge) |
| YouTube transcript loader | Knowledge | Off | Enable in RAG settings | None | [docs](https://docs.openwebui.com/features/workspace/knowledge) |
| STT: Web Speech API (browser) | Voice | On | Settings > Audio > STT Engine = Browser | None | [docs](https://docs.openwebui.com/features/chat-conversations/audio/speech-to-text/stt-config) |
| STT: OpenAI Whisper API | Voice | Off | Settings > Audio > STT Engine = OpenAI | OpenAI key | [docs](https://docs.openwebui.com/features/chat-conversations/audio/speech-to-text/openai-stt-integration) |
| STT: Whisper local | Voice | Off | `WHISPER_MODEL=...` | GPU/CPU | [docs](https://docs.openwebui.com/features/chat-conversations/audio/speech-to-text/stt-config) |
| STT: Mistral Voxtral | Voice | Off | Set Mistral STT endpoint | Mistral key | [docs](https://docs.openwebui.com/features/chat-conversations/audio/speech-to-text/mistral-voxtral-integration) |
| TTS: OpenAI | Voice | Off | Settings > Audio > TTS Engine = OpenAI | OpenAI key | [docs](https://docs.openwebui.com/features/chat-conversations/audio/text-to-speech/openai-tts-integration) |
| TTS: Kokoro (local) | Voice | Off | Deploy Kokoro-FastAPI; set TTS endpoint | Docker | [docs](https://docs.openwebui.com/features/chat-conversations/audio/text-to-speech/Kokoro-FastAPI-integration) |
| TTS: Edge TTS (Azure Edge) | Voice | Off | Deploy edge-tts container | Docker | [docs](https://docs.openwebui.com/features/chat-conversations/audio/text-to-speech/openai-edge-tts-integration) |
| TTS: Chatterbox (voice cloning) | Voice | Off | Deploy Chatterbox container | Docker, GPU | [docs](https://docs.openwebui.com/features/chat-conversations/audio/text-to-speech/chatterbox-tts-api-integration) |
| Voice/video call mode | Voice | Off | Enable via Audio settings | STT + TTS | [docs](https://docs.openwebui.com/features/chat-conversations/audio) |
| Image gen: AUTOMATIC1111 | Image Gen | Off | Admin Panel > Settings > Images > AUTOMATIC1111 URL | A1111 instance | [docs](https://docs.openwebui.com/features/chat-conversations/image-generation-and-editing/automatic1111) |
| Image gen: ComfyUI | Image Gen | Off | Admin Panel > Settings > Images > ComfyUI URL | ComfyUI instance | [docs](https://docs.openwebui.com/features/chat-conversations/image-generation-and-editing/comfyui) |
| Image gen: OpenAI DALL-E | Image Gen | Off | Admin Panel > Settings > Images > OpenAI | OpenAI key | [docs](https://docs.openwebui.com/features/chat-conversations/image-generation-and-editing/openai) |
| Image gen: Gemini Imagen | Image Gen | Off | Admin Panel > Settings > Images > Gemini | Gemini key | [docs](https://docs.openwebui.com/features/chat-conversations/image-generation-and-editing/gemini) |
| Image gen toggle per model | Image Gen | Off | Workspace > Models > Edit > Image Generation | Image backend | [docs](https://docs.openwebui.com/features/workspace/models) |
| Multi-model side-by-side | Chat UX | On | Select 2 models in chat | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features) |
| Folders / Projects | Chat UX | On | Sidebar > New Folder | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features/conversation-organization) |
| Chat tagging + search | Chat UX | On | Chat menu > Tags | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features/history-search) |
| Chat share link | Chat UX | On | Chat menu > Share | `ENABLE_COMMUNITY_SHARING` opt | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features/chatshare) |
| Temporary chat | Chat UX | On | New Chat > Temporary | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features) |
| Chat export (JSON/MD) | Chat UX | On | Chat menu > Export | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features) |
| Autocomplete (AI prompt assist) | Chat UX | Off | Settings > Interface > Autocomplete | Task model | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features/autocomplete) |
| Follow-up prompt suggestions | Chat UX | Off | Settings > Interface > Follow-Up Prompts | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features/follow-up-prompts) |
| URL-param chat preconfig | Chat UX | On | Append `?model=...&tools=...` to chat URL | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features/url-params) |
| Reasoning / thinking tag display | Chat UX | On | Supported automatically with thinking models | Thinking-capable model | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features/reasoning-models) |
| Rich text input + toolbar | Chat UX | Off | Settings > Interface > Rich Text Input | None | [docs](https://docs.openwebui.com/features/notes) |
| Skill mentions (`$skill`) | Chat UX | On | Type `$` in chat to activate a Skill | Skills configured | [docs](https://docs.openwebui.com/features/workspace/skills) |
| User memory (cross-session) | Memory | Off | Settings > Personalization > Memory (per user) | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features) |
| Custom instructions | Memory | On | Settings > Personalization > Custom Instructions | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features/chat-params) |
| Notes workspace | Memory | On | Sidebar > Notes | None | [docs](https://docs.openwebui.com/features/notes) |
| Agentic note read/write | Memory | Off | Enable native function calling | Native-capable model | [docs](https://docs.openwebui.com/features/notes) |
| Channels (team chat + AI) | Memory | Off (beta) | Admin Panel > Settings > General > Channels | None | [docs](https://docs.openwebui.com/features/channels) |
| System banners | Admin | On | Admin Panel > Settings > Banners | None | [docs](https://docs.openwebui.com/features/administration/) |
| Admin webhook (new-user notify) | Admin | Off | Admin Panel > Settings > General > Webhook URL | Slack/Discord webhook | [docs](https://docs.openwebui.com/features/administration/webhooks) |
| User webhook (task-done notify) | Admin | Off | Admin Panel > Settings > General > User Webhooks | None | [docs](https://docs.openwebui.com/features/administration/webhooks) |
| Channel webhooks (inbound) | Admin | Off | Channel settings > Webhooks | Channel enabled | [docs](https://docs.openwebui.com/features/administration/webhooks) |
| Analytics dashboard | Admin | On | Admin Panel > Analytics | None | [docs](https://docs.openwebui.com/features/administration/) |
| Model evaluation (ELO leaderboard) | Admin | On | Admin Panel > Evaluation | None | [docs](https://docs.openwebui.com/features/administration/evaluation) |
| Arena mode (blind A/B) | Admin | On | Model selector > Arena Model | None | [docs](https://docs.openwebui.com/features/administration/evaluation) |
| Audit log | Admin | Off | `AUDIT_LOG_LEVEL`, `AUDIT_LOG_FILE_PATH` | None | [docs](https://docs.openwebui.com/reference/env-configuration/) |
| SQLite backend | Integrations | On (default) | Default | None | [docs](https://docs.openwebui.com/reference/env-configuration/) |
| PostgreSQL backend | Integrations | Off | `DATABASE_URL=postgresql://...` | Postgres | [docs](https://docs.openwebui.com/reference/env-configuration/) |
| Redis (sessions + scale-out) | Integrations | Off | `REDIS_URL=...` | Redis | [docs](https://docs.openwebui.com/reference/env-configuration/) |
| S3 / GCS / Azure Blob storage | Integrations | Off | `STORAGE_PROVIDER=s3/gcs/azure` | Cloud storage | [docs](https://docs.openwebui.com/reference/env-configuration/) |
| OpenTelemetry tracing | Integrations | Off | `ENABLE_OTEL=true`, `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel collector | [docs](https://docs.openwebui.com/reference/monitoring/) |
| Langfuse monitoring (via Pipeline) | Integrations | Off | Install Langfuse filter pipeline | Langfuse + Pipelines | [github](https://github.com/open-webui/pipelines/blob/main/examples/filters/langfuse_filter_pipeline.py) |
| Code execution (Python sandbox) | Advanced UI | Off | Workspace > Models > Edit > Code Interpreter | None (browser sandbox) | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features) |
| Open Terminal (real compute) | Advanced UI | Off | Admin Panel > Settings > General > Open Terminal | Docker/host access | [docs](https://docs.openwebui.com/features/open-terminal) |
| Mermaid diagram render | Advanced UI | On | Automatic in chat | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features) |
| LaTeX math render | Advanced UI | On | Automatic in chat | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features) |
| HTML artifact rendering | Advanced UI | On (in code blocks) | Automatic for HTML/SVG blocks | None | [docs](https://docs.openwebui.com/features/chat-conversations/chat-features) |
| Custom CSS | Developer | Off | Admin Panel > Settings > Interface > Custom CSS | None | [docs](https://docs.openwebui.com/reference/env-configuration/) |
| OpenAI-compatible REST API | Developer | On | Bearer token / API key | API keys enabled | [docs](https://docs.openwebui.com/reference/api-endpoints/) |
| Swagger UI | Developer | On | `/docs`, `/api/v1/docs`, `/audio/api/v1/docs`, etc. | None | [docs](https://docs.openwebui.com/reference/api-endpoints/) |
| Community plugin marketplace | Developer | On | Workspace > Tools/Functions > Import from Community | None | [openwebui.com/functions](https://openwebui.com/functions) |
| SCIM 2.0 user sync | Developer | Off | `SCIM_*` env vars | IdP with SCIM | [docs](https://docs.openwebui.com/features/authentication-access/) |

---

## 1. Authentication & Users

**Email/password signup** — Local user accounts created via the signup form. The first account is always admin. Toggle `ENABLE_SIGNUP` to close registration entirely.

**Admin approval gate** — Set default role to `pending` in General Settings; new signups sit in a queue until an admin approves them. Ideal for controlled rollouts.

**SSO / OIDC** — Supports Google, Microsoft, Okta, Keycloak, Auth0, or any OIDC-compliant provider via `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, and `OPENID_PROVIDER_URL`. Groups from the IdP can map to Open WebUI groups.

**LDAP** — Authenticate against Active Directory or OpenLDAP. Configure with `LDAP_SERVER_HOST`, `LDAP_SEARCH_BASE`, `LDAP_ATTRIBUTE_FOR_USERNAME`, etc.

**SCIM 2.0** — Automated user and group lifecycle management. When your IdP deprovisions a user, they're removed from Open WebUI automatically.

**Trusted header auth** — Reverse proxies (Nginx, Authentik, Cloudflare Access) can inject a pre-authenticated email header; Open WebUI accepts it without a password. Env var: `WEBUI_AUTH_TRUSTED_EMAIL_HEADER`.

**RBAC / Groups** — Two primary roles (Admin, User) plus a `Pending` state. Permissions are additive: group memberships grant capabilities, never revoke. Per-resource ACLs on models, knowledge bases, tools, and skills.

**API keys** — Personal bearer tokens for programmatic access. Keys inherit the creating user's full permission set. Admins can restrict which endpoints API keys can call via an allowlist.

---

## 2. Models & Backends

**Ollama** — First-party integration with local Ollama instances. Full passthrough at `/ollama/api/*`. Pull new models by typing `ollama run hf.co/{user}/{repo}` in the model selector.

**OpenAI-compatible endpoints** — Any provider exposing the OpenAI chat-completions shape works: OpenAI, Azure OpenAI, Groq, Cerebras, vLLM, LiteLLM, Mistral, etc.

**Anthropic endpoint** — Native `POST /api/v1/messages` route lets the Anthropic SDK and Claude Code point at Open WebUI directly, no wrapper needed.

**Model presets** — Thin wrappers around any base model. Bundle a system prompt, knowledge bases, tools, skills, and parameter overrides into a named agent. Supports dynamic Jinja2 variables (`{{ USER_NAME }}`, `{{ CURRENT_DATE }}`).

**Per-model access control** — Mark a model Private and assign it to specific users or groups. Finance models don't appear in Engineering's selector.

**Global model defaults** — Admin-level baseline capabilities and inference parameters applied to all models. Per-model settings override globals on conflict. Useful for org-wide policy (e.g., disable code interpreter everywhere).

**Model fallback** — `ENABLE_CUSTOM_MODEL_FALLBACK=true` redirects requests to a default model when the target becomes unavailable.

---

## 3. Pipelines & Functions

**Pipelines** — A separate Docker container (`ghcr.io/open-webui/pipelines`) running a Python plugin server. Registered as an OpenAI-compatible endpoint. Used for GPU-heavy workloads, external API routing, custom RAG, compliance filters, and real-time translation that shouldn't share resources with the main instance.

**Pipe Functions** — Lightweight version of a Pipeline that runs inside the Open WebUI process. Appears as a new model in the selector. Use for adding providers (Anthropic, Vertex AI) or custom logic without extra infrastructure.

**Filter Functions** — Intercept messages at `inlet` (before model) and `outlet` (after model). Use for PII redaction, prompt injection detection, compliance logging, or injecting dynamic system context.

**Action Functions** — Add UI buttons to chat responses. On click, run custom Python (e.g., "Save to CRM", "File ticket", "Add to Memories").

**Community marketplace** — Browse `openwebui.com/functions` for hundreds of pre-built pipelines. One-click import with no `pip install` required for pure-Python tools.

---

## 4. Tools / MCP

**Native Python tools** — Written in Python, run inside Open WebUI. Given to models as callable functions. The built-in code editor lets you write and test tools in the admin UI. Enable per-model in Workspace > Models.

**MCP (Streamable HTTP)** — Native support added in v0.6.31. Register any MCP server under Admin Panel > Settings > External Tools. Supports OAuth 2.1 (dynamic and static). Stdio/SSE transports require the `mcpo` proxy.

**OpenAPI servers** — Point Open WebUI at any OpenAPI spec URL; it discovers all endpoints and exposes them as model-callable tools automatically. No glue code needed.

**Tool auth** — MCP connections support None, Bearer, OAuth 2.1, and OAuth 2.1 (Static). API-key tools embed credentials in the server registration, not in user sessions.

---

## 5. Knowledge / RAG

**Knowledge collections** — Named buckets of uploaded documents. Supported formats: PDF, DOCX, TXT, CSV, Markdown, HTML, and more. Processed via one of five extraction engines (Tika, Docling, Azure Document Intelligence, Mistral OCR, custom).

**Retrieval modes** — Focused Retrieval (RAG, chunked vector search) vs. Full Context (entire document injected verbatim). Toggle per attachment at chat time.

**Hybrid search** — Combines BM25 keyword search with semantic vector search, then applies a cross-encoder reranker. Enabled via `ENABLE_RAG_HYBRID_SEARCH=true`. Significantly improves recall for technical documents with exact terminology (part numbers, error codes — relevant for MIRA).

**9 vector DB backends** — ChromaDB (default), PGVector, Qdrant, Milvus, Elasticsearch, OpenSearch, and more. Swap via `VECTOR_DB` env var.

**Web search** — Providers: SearXNG, Brave, Google PSE, Tavily, DuckDuckGo, Bing. Configured in Admin Panel > Settings > Web Search. Enable per-model in Workspace > Models.

**YouTube transcript loader** — Ingest YouTube video transcripts as knowledge base documents.

**Chunk configuration** — `CHUNK_SIZE`, `CHUNK_OVERLAP`, `RAG_TOP_K` control retrieval granularity. Tune to your document types.

**Agentic retrieval** — With native function calling enabled, models autonomously browse knowledge bases using built-in tools (`query_knowledge_files`, `view_file`, etc.) without manual `#kb-name` attachment.

---

## 6. Voice

**STT: Browser (Web Speech API)** — Zero-infra, uses the user's browser microphone via the native Web Speech API. Quality varies by browser; no server processing.

**STT: OpenAI Whisper API** — Cloud transcription. Configure via `AUDIO_STT_ENGINE=openai` and `AUDIO_STT_OPENAI_API_BASE_URL`.

**STT: Local Whisper** — Runs Whisper on the server. Set `WHISPER_MODEL` (e.g., `base`, `medium`, `large-v3`). GPU-accelerated if available.

**STT: Mistral Voxtral** — Mistral's native speech model for accurate multilingual transcription.

**TTS: OpenAI** — Connects to OpenAI TTS API. Voices: alloy, echo, fable, onyx, nova, shimmer.

**TTS: Kokoro** — High-quality open-source neural TTS. Deploy via `Kokoro-FastAPI` Docker image. No external API key needed after setup.

**TTS: Edge TTS** — Microsoft Edge TTS voices via a Docker sidecar. Free, 300+ voices, no Azure subscription required.

**TTS: Chatterbox** — Voice cloning TTS. Upload a reference audio sample and clone a voice. GPU recommended.

**Per-model voice** — Assign a specific TTS voice to each model preset so "MIRA" sounds different from "General Assistant."

**Voice/video call mode** — Hands-free conversation with STT + TTS active simultaneously. Accessible via the microphone icon in the chat bar.

---

## 7. Image Generation

**AUTOMATIC1111** — Point at a running A1111 instance URL. Full access to all installed checkpoint models, LoRAs, and sampler settings.

**ComfyUI** — Connect to ComfyUI's API. Supports custom workflow JSON upload for advanced generation pipelines.

**OpenAI DALL-E** — Uses DALL-E 2/3 via OpenAI API key.

**Gemini Imagen** — Uses Google Gemini's image generation models.

**Image Router** — Pipeline-based routing to select the image backend dynamically per request.

**Per-model toggle** — Enable or disable image generation per model preset in Workspace > Models > Capabilities.

---

## 8. Chat UX

**Multi-model comparison** — Select up to two models simultaneously; responses appear side-by-side with navigation arrows. Ratings from comparisons feed the ELO leaderboard.

**Folders / Projects** — Organize chats into folders. Folders can be promoted to Projects with their own system prompt and attached knowledge base, creating scoped workspaces.

**URL parameters** — Preconfigure a chat session via URL: `?model=mira-v3&tools=web-search`. Useful for creating direct-link launchers to specific MIRA agents.

**Autocomplete** — AI-powered prompt completion as you type, powered by a configurable task model.

**Follow-up suggestions** — Auto-generates 2-3 suggested next questions after each model response. Reduces blank-page hesitation.

**Skill mentions** — Type `$` in the input field to trigger a skill picker. Injects the skill's markdown manifest into context, steering model behavior without changing the system prompt permanently.

**Reasoning display** — Thinking tags (`<think>...</think>`) from models like DeepSeek-R1 or Claude Extended Thinking are rendered in a collapsible "thinking" panel.

**Chat export** — Export individual chats as JSON or Markdown.

**Chat sharing** — Generate a shareable link (internal instance or Open WebUI community platform). Controllable per-instance via `ENABLE_COMMUNITY_SHARING`.

**Message queue** — Continue typing while the model streams its previous response. Messages queue and send automatically.

---

## 9. Memory / Personalization

**User memory** — Opt-in persistent memory that stores facts about the user across sessions. Models can read and write memory entries via built-in tools. Stored per-user, not shared.

**Custom instructions** — Per-user persistent instructions injected into every conversation system prompt. Set in Settings > Personalization.

**Notes** — A persistent markdown/rich-text editor outside of chat. Notes inject full content (no chunking) when attached to a chat. With native function calling, models can search, read, create, and update notes autonomously.

**Channels** — Persistent shared spaces (currently beta) where multiple users and multiple models participate in the same timeline. `@model` tagging summons specific AI into the thread. Supports threads, reactions, pinned messages, and DMs.

---

## 10. Admin

**Banners** — Customizable system-wide announcements (info/warning/error/success with color coding). Configured in Admin Panel or via `WEBUI_BANNERS` env var. Dismissible per user.

**Analytics** — Usage dashboard showing message volume, token consumption, model popularity, per-user activity, filterable by time period and user group.

**Model evaluation (ELO)** — Thumbs up/down ratings during chat accumulate into an ELO leaderboard. Arena mode randomly pairs models for blind A/B comparison. Rated chats are snapshotted for future fine-tuning.

**Webhooks (admin)** — POST to a Slack/Discord webhook when a new user signs up. Configured via `WEBHOOK_URL`.

**Webhooks (user)** — Personal webhook fired when a long-running model response completes and the user is inactive. Enabled via `ENABLE_USER_WEBHOOKS=true`.

**Webhooks (channel)** — Per-channel inbound webhooks. External systems (CI/CD, monitoring, scripts) POST messages into Open WebUI channels. Identified by a unique token-bearing URL.

**Audit log** — Structured JSON log of admin actions, model calls, and auth events. Controlled via `AUDIT_LOG_LEVEL` and `AUDIT_LOG_FILE_PATH`.

---

## 11. Integrations

**Database** — SQLite (default, zero-config) or PostgreSQL (`DATABASE_URL`). For multi-node deployments, Postgres is required.

**Redis** — Required for stateless horizontal scaling. `REDIS_URL` enables shared session state across multiple Open WebUI instances.

**Object storage** — S3, GCS, or Azure Blob via `STORAGE_PROVIDER`. Enables stateless file handling across instances.

**OpenTelemetry** — Distributed tracing + metrics export to any OTel-compatible backend (Jaeger, Honeycomb, Grafana Tempo). Enable with `ENABLE_OTEL=true`.

**Langfuse** — Conversation monitoring and cost tracking via the Langfuse filter pipeline. Requires Pipelines container + Langfuse account or self-hosted instance.

**LiteLLM** — Use LiteLLM as a unified proxy to normalize 100+ model providers into one OpenAI-compatible endpoint registered in Open WebUI's Connections.

---

## 12. Advanced UI

**Code interpreter (browser sandbox)** — Runs Python in a sandboxed browser environment (Pyodide). Zero infrastructure. Enable per model in Workspace > Models > Code Interpreter.

**Open Terminal** — Connects to a real compute environment (Docker container or host). The AI writes code, executes it, reads output, and iterates. Includes a file browser and live web preview pane.

**Mermaid diagrams** — Rendered automatically when the model produces fenced Mermaid blocks.

**LaTeX math** — Rendered automatically inside `$...$` and `$$...$$` delimiters.

**HTML/artifact rendering** — HTML and SVG code blocks are rendered as live previews in the chat. Useful for data visualization artifacts.

**Writing/code content blocks** — Models that emit `:::writing` or `:::code_execution` colon-fence blocks get formatted containers with a copy button, distinguishing prose from code output.

---

## 13. Developer

**OpenAI-compatible REST API** — Full chat-completions API at `POST /api/chat/completions`, file upload, knowledge management, model listing. Works with any OpenAI SDK pointed at your instance URL.

**Anthropic-compatible API** — `POST /api/v1/messages` accepts Anthropic SDK requests. Claude Code can use Open WebUI as its backend.

**Swagger UIs** — Interactive API docs at `/docs`, `/api/v1/docs`, `/audio/api/v1/docs`, `/images/api/v1/docs`, `/retrieval/api/v1/docs`, `/ollama/docs`.

**Custom CSS** — Inject arbitrary CSS for custom branding via Admin Panel > Settings > Interface. Enterprise tier adds full white-labeling.

**Community marketplace** — `openwebui.com/functions` hosts hundreds of community Tools, Pipes, and Filters. One-click import.

**Skills** — Markdown instruction manifests stored in Workspace > Skills. Invoked on-demand via `$skill-name` in chat. Keep system prompts clean while providing rich task-specific guidance.

---

## What Most Teams Under-use

These features are often missed by new admins but deliver outsized value:

1. **Hybrid search (`ENABLE_RAG_HYBRID_SEARCH=true`)** — The default pure-vector search misses exact-match queries (part numbers, error codes, model numbers). BM25 + vector + reranking dramatically improves retrieval for industrial/technical document sets like MIRA's equipment manuals. One env var, no extra infra.

2. **Model presets as agents** — Most teams use Open WebUI as a chat UI and select raw base models. Wrapping each use-case (MIRA diagnostics, CMMS query, PM scheduling assistant) in a named preset with a pre-bound system prompt, knowledge base, and tools eliminates repetitive setup and ensures consistent behavior.

3. **Filter Functions for compliance/logging** — A 20-line Python filter can redact PII from outputs, log all requests to an external SIEM, or block unsafe prompts before they reach the model. No Pipelines container needed; runs in-process. Underused because it's in "Functions," not "Settings."

4. **Channels (team chat + AI)** — Most deployments ignore this feature because it's beta and buried. For MIRA, a `#fault-diagnosis` channel where technicians tag `@mira` inline is significantly more collaborative than each user having private chats. Context accumulates; knowledge is shared.

5. **ELO evaluation + Arena mode** — Admins select models based on benchmarks rather than actual performance on their domain. The Arena mode running A/B tests on real MIRA diagnostic queries gives ground-truth data on whether Gemini or Claude performs better for your specific equipment fault types.

6. **Per-model TTS voice** — If MIRA is deployed as a voice assistant in the field, assigning a distinct voice to each agent (MIRA vs. General Assistant vs. CMMS Bot) gives users instant audio confirmation of which agent they're talking to, reducing errors.

7. **Channel webhooks for inbound monitoring** — CI/CD pipelines, Prometheus alerts, and PLC alarm systems can POST directly into a `#plant-alerts` channel. Technicians see live alerts alongside AI analysis without leaving Open WebUI. Requires only a channel webhook URL.

8. **URL parameter deep-links** — Create browser bookmarks or QR codes like `https://app.factorylm.com/?model=mira-v3&tools=web-search` that drop field technicians directly into the right MIRA agent with the correct tools pre-enabled. Zero friction onboarding.
