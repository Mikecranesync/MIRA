# MIRA Codebase Flowchart — baseline 2026-09-29

**Start here to understand the codebase.** Five module-level diagrams: what talks to what, how a chat turn is answered, how data gets in, and how code ships. Baseline snapshot of `main` on 2026-09-29 — when the architecture changes, add a new dated section or file rather than silently rewriting this one, so the baseline stays comparable.

Deeper references: [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) (layer rules) · [`container-map.md`](container-map.md) · [`database-map.md`](database-map.md) · [`ENGINE_REFERENCE.md`](ENGINE_REFERENCE.md) · [`INGEST_PIPELINES.md`](INGEST_PIPELINES.md) · [`docs/THEORY_OF_OPERATIONS.md`](../THEORY_OF_OPERATIONS.md) (why).

| # | Diagram | Answers |
|---|---|---|
| 1 | [System map](#1--system-map) | Which surfaces, backends, brain modules and tables exist, and how they connect |
| 2 | [Engine chat turn](#2--engine-chat-turn-slack-telegram-web-ignition) | How `Supervisor.process()` answers a Slack/Telegram/web/Ignition message |
| 3 | [Hub notebook turn](#3--hub-notebook-turn-command-center--mobile-app) | How the Hub/mobile notebook chat answers (separate TypeScript engine) |
| 4 | [Ingest pipelines](#4--ingest-pipelines) | How documents and live tag data enter |
| 5 | [Branch to production](#5--branch-to-production) | How a change goes from branch to prod |

## 1 · System map

Every consumption surface renders the same approved-context answer. There are two answer engines: the Python Supervisor behind the bots and `mira-pipeline`, and the Hub's TypeScript notebook route. Both read the same NeonDB evidence and use the same free-tier model cascade.

```mermaid
flowchart LR
  subgraph S["Surfaces (where technicians ask)"]
    direction TB
    MOB["mira-mobile<br/>Capacitor app"]
    HUB["mira-hub<br/>Command Center · Next.js"]
    WEB["mira-web<br/>factorylm.com · Hono/Bun"]
    TG["Telegram bot"]
    SL["Slack bot"]
    IGN["Ignition / Perspective<br/>Ask MIRA panel"]
    UI["packages/factorylm-ui<br/>unified shell (new UI)"]
  end

  subgraph B["Backends"]
    direction TB
    NB["Hub API routes<br/>/api/equipment-notebooks/[id]/chat<br/>/api/hub/ask"]
    PIPE["mira-pipeline :9099<br/>/v1/chat/completions<br/>/api/v1/ignition/chat"]
    ASK["mira-ask<br/>ask_api · drive packs"]
    MCP["mira-mcp<br/>CMMS + recall tools"]
  end

  subgraph BR["Brain: mira-bots/shared"]
    direction TB
    ENG["engine.py · Supervisor<br/>FSM · UNS gate"]
    INF["inference/router.py<br/>Groq → Cerebras → Together"]
    CIT["citation_compliance.py<br/>guardrails.py"]
  end

  subgraph D["Evidence + state (NeonDB)"]
    direction TB
    KE[("knowledge_entries<br/>OEM corpus + private uploads")]
    KG[("kg_entities · kg_relationships<br/>ai_suggestions")]
    TE[("tag_events<br/>live_signal_cache")]
    DT[("decision_traces<br/>notebook turns")]
  end

  subgraph IN["Inlets"]
    direction TB
    CR["mira-crawler<br/>OEM crawl · Celery"]
    ING["mira-ingest<br/>upload · OCR · embed"]
    REL["mira-relay<br/>ingest_contract → ingest_batch"]
  end

  MOB --> UI
  UI --> NB
  HUB --> NB
  WEB --> PIPE
  TG --> ENG
  SL --> ENG
  IGN --> PIPE
  PIPE --> ENG
  ASK --> KE
  NB --> INF2["lib/inference/canonical-cascade.ts<br/>same provider order"]
  NB --> KE
  NB --> DT
  ENG --> INF
  ENG --> CIT
  ENG --> KE
  ENG --> KG
  ENG --> TE
  ENG --> MCP
  ENG --> DT
  CR --> KE
  ING --> KE
  REL --> TE
```

- <div class="note">**No Anthropic in the cascade** Chat and diagnosis use Groq, Cerebras and Together only (removed in PR #610). PrintSynth print-photo vision is the single exception.
- **Two chat engines** The Hub notebook route builds its own retrieval and prompt in TypeScript. A fix to `engine.py` does not reach the phone app.
- **Legacy, not in prod** `mira-sidecar` (ChromaDB), Open WebUI and `mira-connect` are dormant or removed.

## 2 · Engine chat turn (Slack, Telegram, web, Ignition)

The path through `Supervisor.process()` in `mira-bots/shared/engine.py`. Chat surfaces must pass the UNS location-confirmation gate before troubleshooting. Direct machine connections are certified by the connection itself.

```mermaid
flowchart TD
  A["Technician message<br/>text · photo · fault code"] --> FP{"Adapter fast-path matches?<br/>drive pack · wiring · print photo"}
  FP -- "yes, read-only" --> FPA["Cited answer from pack / diagram<br/>or falls through on miss"]
  FP -- no --> G["guardrails.classify_intent()"]
  G --> S{"Safety keyword?<br/>LOTO · arc flash · confined space"}
  S -- yes --> SB["Safety banner + full answer"]
  S -- no --> SRC{"Where did the turn come from?"}
  SB --> SRC
  SRC -- "direct connection<br/>Ignition · MQTT · PLC · QR" --> UID{"Carries a UNS id?"}
  UID -- no --> REJ["Reject: 400 uns_required"]
  UID -- yes --> CERT["uns_context.source = direct_connection<br/>gate satisfied"]
  SRC -- "chat surface" --> R["uns_resolver.resolve_uns_path()<br/>vendor · model · fault · asset"]
  R --> Q{"Asset-specific question?"}
  Q -- "no, general / educational" --> RET
  Q -- yes --> CONF["Send confirmation:<br/>site → asset → component → fault<br/>evidence · confidence"]
  CONF --> W{"Technician confirms?"}
  W -- corrects --> R
  W -- confirms --> RET
  CERT --> RET["Recall evidence<br/>neon_recall · manual chunks<br/>work orders · live tags · prior decisions"]
  RET --> CTX["technician_context.py<br/>one TechnicianContext per turn"]
  CTX --> LLM["InferenceRouter.complete()<br/>PII sanitized · Groq → Cerebras → Together"]
  LLM --> CC["citation_compliance<br/>groundedness 1–5"]
  CC --> OUT["Reply with citations<br/>or admits the KB gap"]
  OUT --> LOG[("decision_traces<br/>benchmark_db · Langfuse")]
```

- <div class="note stop">**Hard rule** A code path that starts troubleshooting before the technician confirms (chat surfaces) is a bug.
- **Safety never withholds** Since 2026-09-27, a safety hit shows a banner alongside the full answer; it does not stop the reply.
- **Read-only** No PLC or control writes anywhere in the beta product.

## 3 · Hub notebook turn (Command Center + mobile app)

`mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`. The notebook is already bound to one asset, so there is no chat gate. The flight recorder writes an evidence packet for every turn.

```mermaid
flowchart TD
  U["POST notebook chat<br/>question · attached photo"] --> AU["sessionOr401()<br/>UUID tenant only"]
  AU --> OT["openTurn() · startTurnRecorder()"]
  OT --> SC["safety-classifier<br/>hazard + safety notices"]
  SC --> LANG["answer-language<br/>translate-for-search"]
  LANG --> MCX["machine-context-packet<br/>machine-history · notebook-query"]
  MCX --> RAG["manual-rag.ts runBm25Query()<br/>is_private = false OR tenant_id = caller"]
  RAG --> CAS["canonical-cascade.ts<br/>Groq → Cerebras → Together"]
  CAS --> SHAPE["answer-shape<br/>citation markers · step safety"]
  SHAPE --> JEV["Evidence sufficiency shadow check<br/>recorded, not yet enforced"]
  JEV --> CL["closeTurn() · persistTurnUsage()"]
  CL --> RES["Streamed answer + citations<br/>to Hub UI / mobile unified shell"]
  CL --> PK[("Turn evidence packet<br/>diagnostics endpoint · Langfuse")]
```


## 4 · Ingest pipelines

Documents and live signals take separate roads. Each has one canonical path, and CI rejects forks of either (Contract 5 in `tests/test_architecture.py` covers the tag path).

```mermaid
flowchart LR
  subgraph DOCS["Documents → citable chunks"]
    direction TB
    UP["Customer upload<br/>Hub · mobile · MiraDrop"] --> IG["mira-ingest<br/>Tika · OCR · chunk"]
    OEM["sources.yaml curated OEM URLs"] --> MC["ManufacturerCrawler<br/>oem_trusted = true"]
    MC --> DD["ingest/dedup.py<br/>content hash"]
    IG --> DD
    DD --> UNS["ingest/uns.py<br/>tag chunk with UNS path"]
    UNS --> EMB["embed on write"]
    EMB --> KE2[("knowledge_entries")]
    UP -. "is_private = true<br/>tenant UUID" .-> KE2
    MC -. "is_private = false<br/>verified = true" .-> KE2
  end

  subgraph TAGS["Live signals → machine memory"]
    direction TB
    SRC2["Ignition · MQTT · Sparkplug B<br/>PLC bridge · SimLab"] --> DEC["Transport decodes wire format"]
    DEC --> BTE["build_tag_entry()<br/>build_ingest_batch()"]
    BTE --> IB["tag_ingest.ingest_batch()<br/>approved_tags allowlist"]
    IB --> TE2[("tag_events<br/>live_signal_cache")]
    TE2 --> DIFF["tag_diff_logger<br/>flaky_detector · historian"]
  end
```

- <div class="note warn">**Hybrid corpus law** Per-tenant reads must use `(is_private = false OR tenant_id = caller)` on the raw pool. Filtering on tenant alone hides the OEM library; no filter leaks uploads.
- **Recall before recompute** Expensive stages (OCR, vision, embeddings) are materialized as versioned evidence keyed by source hash (`printsense/cas.py`).

## 5 · Branch to production

Dev on CHARLIE, staging on a Neon branch plus the staging VPS, production on the OVH host. Merge and deploy are human-gated.

```mermaid
flowchart LR
  BR["Feature branch<br/>isolated worktree"] --> HK[".githooks/pre-commit<br/>shellcheck · gitleaks · actionlint"]
  HK --> PR["Pull request"]
  PR --> CI["CI<br/>ci.yml · smoke-test · lifecycle guard<br/>capability-closure · migration-verify"]
  PR --> REV["Adversarial review<br/>Codex, exact-SHA PASS"]
  CI --> MG{"Human merge"}
  REV --> MG
  MG --> TAG["version-tag.yml<br/>vX.Y.Z + rollback checkpoint"]
  TAG --> STG["Staging deploy<br/>retrieval acceptance loop"]
  STG --> MIG["apply-migrations.yml<br/>dry-run → apply"]
  MIG --> DEP["deploy-vps.yml<br/>prod: app.factorylm.com"]
  DEP --> SMK["install/smoke_test.sh<br/>verify live"]
```

- <div class="note stop">**Never** psql against prod, restart VPS containers by hand, or point a branch at `@FactoryLM_Diagnose`. `prod-guard.sh` blocks the obvious cases.

---

_Built 2026-09-29 from `origin/main` directory listings, the Hub notebook chat route's imports, and the repo's `CLAUDE.md` + `.claude/rules/`. Module-level only; not every service or table is drawn._
