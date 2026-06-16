# Mira + Factory LM — Product Requirements Document v2
### Cloud-First SaaS | April 2026 | Canonical Reference

---

> **INSTRUCTION FOR CLAUDE CODE — READ THIS FIRST**
>
> Do not assume alignment with this document. Before writing a single line of code,
> audit the existing repository and produce a written alignment report that answers
> every checkpoint listed in **Section 9: Alignment Audit Protocol**. Only after
> that audit is complete and reviewed should any implementation proceed.
> If your current build contradicts a decision in this PRD, surface the conflict
> explicitly rather than silently overriding it.

---

## Table of Contents

1. Product Vision
2. Target Users & Tiers
3. Core Architecture — The Two-Brain System
4. The Knowledge Intelligence Stack (Factory LM)
5. Interface Layer
6. Feature Roadmap
7. Data Philosophy & Privacy
8. Build Sequence
9. Alignment Audit Protocol (Claude Code reads this first)

---

## 1. Product Vision

Mira is an AI-powered maintenance co-pilot that tells a technician exactly what
is broken, why it broke, what to do about it, and which parts to order — using
that facility's own manuals, work order history, and the collective intelligence
of the entire Mira network.

**The one-sentence version:** Mira is to a maintenance technician what a senior
SME with 30 years of experience on every machine in your facility would be —
available 24/7, on their phone, from day one.

**The business model:** Cloud-first SaaS. Three user tiers. One backend serving
all surfaces: web portal, mobile PWA, and thin-client integrations (Slack, Teams,
WhatsApp).

**The moat:** A growing shared knowledge base (Brain 1) that gets smarter as
every user on the network contributes anonymized fault-resolution patterns — a
data flywheel no competitor can replicate by starting from zero.

---

## 2. Target Users & Tiers

### Tier 1 — Independent Technician (Bottom of Funnel)
- Solo tech, independent contractor, small shop owner
- Uses **Atlas CMMS** (open-source, GPLv3, iOS/Android app) as the CMMS layer
- Subscribes to Mira as a mobile-first AI co-pilot
- Low/free entry price
- Onboards via direct document upload (PDF from phone)
- Contributes anonymized fault-resolution patterns to Brain 1 (opt-in)

### Tier 2 — Small Maintenance Shop (Primary Revenue Target)
- Maintenance manager overseeing 5–10 technicians
- Minimal IT oversight — decision made by the manager, no procurement process
- Documents already stored in **Google Drive** shared folders
- Onboards via Google Drive OAuth connector (2-minute setup)
- Uses web portal (desktop) + PWA (technicians' phones)
- Monthly SaaS subscription

### Tier 3 — Enterprise Facility (Future Roadmap)
- Larger plant, potential compliance requirements, dedicated IT
- Full CMMS API integration, hybrid or dedicated cloud deployment
- Local/on-premise deployment available as an add-on
- **Note:** Do NOT build for Tier 3 requirements now. Every architecture
  decision should serve Tier 1 and Tier 2 first.

---

## 3. Core Architecture — The Two-Brain System

This is the single most important architectural decision in the project.
Every data flow, every query, every document ingestion must respect this boundary.

### Brain 1 — Mira Base (Shared, Cloud-Hosted RAG)

**What it is:** The shared knowledge base available to every user on the
network from day one, before they upload a single document.

**What it contains:**
- All public OEM equipment manuals (Fanuc, Mazak, Siemens, Rockwell,
  Allen-Bradley, ABB, Yaskawa, Ingersoll Rand, etc.)
- Manufacturer fault code databases
- Industry standards (ISO 14224 failure taxonomy, OSHA standards)
- Anonymized fault-resolution patterns contributed by users (opt-in)
- Manufacturer safety bulletins and recall notices (Bulletin Intelligence Engine)

**Who feeds it:**
- Mira team curation (primary)
- User document donations: if a user uploads a public OEM manual not yet
  in Brain 1, Mira flags it for review and, with user permission, promotes
  it to the shared collection
- Automated bulletin ingestion from RSS feeds and manufacturer portals

**Technical implementation:**
- ChromaDB collection name: `shared_oem` (or equivalent global namespace)
- Accessible to all tenants as a fallback collection
- Documents tagged with: manufacturer, model_family, doc_type,
  language, version, ingestion_date

**What it NEVER contains:**
- Any facility-specific work order
- Any document identifying a specific company or location
- Any proprietary repair procedure
- Any personally identifiable information

---

### Brain 2 — Facility Brain (Private, Per-Tenant RAG)

**What it is:** Each customer's private, isolated knowledge base scoped
entirely to their tenant. Never shared, never promoted without explicit consent.

**What it contains:**
- That facility's OEM manuals (may overlap with Brain 1 — that is fine,
  Brain 2 takes priority in query results)
- Work order history (from Atlas CMMS, MaintainX, Fiix, or direct upload)
- Internal tech notes and repair procedures
- Asset registry (machine ID, model, location, install date)
- Facility-specific documents (SOPs, safety binders, vendor contacts)

**Who feeds it:**
- Google Drive OAuth connector (primary onboarding path)
- Direct PDF upload via web portal or mobile
- Atlas CMMS API sync (for Tier 1 independent users)
- Future: CMMS API connectors (MaintainX, Fiix)

**Technical implementation:**
- ChromaDB collection name: `tenant_{user_id}` (existing implementation)
- Strict tenant isolation — no cross-tenant queries ever
- PII sanitization runs on all documents before embedding (existing)

---

### Query-Time Brain Resolution

When a user asks Mira a question, the retrieval sequence is:

```
1. Search Brain 2 (tenant_{user_id}) — facility-specific context first
2. Search Brain 1 (shared_oem) — shared library fallback
3. Merge and re-rank results across both collections
4. Factory LM synthesizes one answer, citing which brain each chunk came from
5. Response always indicates source: "From your work order WO-2024-1143"
   vs. "From the Fanuc R-2000iC Manual (Mira shared library)"
```

**This dual-query architecture must be implemented before any customer
goes live. Ingesting seed documents into a demo tenant's Brain 2 instead
of the shared Brain 1 collection is a critical architecture error.**

---

## 4. The Knowledge Intelligence Stack (Factory LM)

### Layer 1 — RAG (What Mira SEES)

Pure retrieval-augmented generation is the correct foundation for the
current build stage. Continue building Brain 1 RAG indefinitely —
modern vector databases scale to 20M+ documents without fundamental
architecture changes. Volume is not the problem; retrieval quality is.

**Retrieval architecture (implement now, not after scale problems appear):**

```
Query → BM25 keyword filter (eliminate irrelevant documents)
      → Semantic vector search (find conceptually related chunks)
      → Metadata filter (manufacturer, model, doc_type)
      → Cross-encoder re-ranking (re-score top 20 by true relevance)
      → LLM synthesis (top 3–5 chunks → structured answer with citations)
```

Current state uses pure semantic search. This is acceptable for MVP at
low document count. BM25 hybrid is the next retrieval improvement.

### Layer 2 — System Prompt Persona (What Mira SOUNDS LIKE)

The system prompt is the current mechanism for making Factory LM behave
like a maintenance SME. It must include:

- **Persona:** Professional maintenance co-pilot, not a generic chatbot
- **Format:** Every answer follows: Severity → Description → Cause →
  Recommended Actions → Parts Needed → Estimated Time → Citations
- **Citations:** Always cite `[filename — page N]` or
  `[Work Order WO-XXXX]`. Never answer without citing source.
- **Safety:** If query contains safety keywords (LOTO, arc flash, confined
  space, energized, smoke, fire — see safety.py), lead with SAFETY_BANNER
  before any technical answer
- **Confidence:** If documentation does not cover the question, say so
  explicitly. Do not guess. Recommend OEM support contact.
- **Scope:** Redirect off-topic questions politely. Mira helps with
  equipment maintenance, troubleshooting, specifications, and safety.

### Layer 3 — Safety Guardrails (Non-Negotiable)

Safety detection runs BEFORE the query reaches Factory LM. It is not
a post-processing filter — it modifies the system prompt context
and prepends SAFETY_BANNER to the response.

**File:** `mira-sidecar/safety.py`

Trigger keywords minimum set (expand from existing guardrails.py):
arc flash, lockout, tagout, LOTO, energized, live wire, confined space,
smoke, fire, explosion, chemical burn, high voltage, electrical hazard,
pressure release, hydraulic failure, ammonia, chlorine, asphyxiation

### Layer 4 — LLM Fine-Tuning (Future — NOT MVP)

**Do not implement fine-tuning until:**
- Brain 1 RAG is solid with hybrid retrieval
- At least 500 real technician interactions are logged
- Synthetic Q&A generation from OEM corpus is complete

When the time comes, use LoRA (Low-Rank Adaptation) on a base model
(Llama 3.1 8B or equivalent). Fine-tuning teaches HOW to think
(maintenance SME reasoning, response format, failure mode vocabulary),
not WHAT to know (that belongs in RAG).

**Fine-tuning data sources (build toward this now):**
1. Synthetic Q&A pairs generated from Brain 1 OEM corpus using GPT-4o
2. Anonymized fault→repair→outcome patterns from user interactions (opt-in)
3. Expert-curated gold examples written by the Mira domain SME

---

## 5. Interface Layer

### Zone 1 — Desktop Web Portal (Build First)
**Users:** Maintenance managers, plant directors, senior techs

**Required screens for MVP:**
- Dashboard: fleet health, open work orders, active faults, upcoming PMs
- Mira Chat: full RAG query interface with document citations
- Knowledge Base panel ("Mira's Brain"): what's indexed, what's missing,
  corpus health, document status, recent citations
- Work Order queue: create, assign, update, complete
- Integrations hub: Google Drive OAuth connector, Atlas CMMS sync
- Settings: user management, notification preferences

**"Mira's Brain" panel — minimum viable implementation:**
```
MIRA KNOWLEDGE BASE — [Facility Name]
Documents indexed: [N] | Last updated: [timestamp]

[List of indexed documents with: filename, page count, indexed date, status]
[✓ Indexed | ⏳ Processing | ✗ Error]

Coverage gaps detected:
⚠ No manual found for: [Asset Name]
⚠ No work order history for: [Asset Name]

Recent citations this week:
[filename] cited [N] times
```

**Technology:** Next.js (React) with responsive CSS.
This same build becomes the PWA mobile experience with no additional work.

**No custom frontend for Open WebUI at MVP.**
Brand Open WebUI using the admin API (configure_branding.py approach
in the current Claude plan is correct).

---

### Zone 2 — Mobile / PWA (Technician Interface)

**Start:** Responsive Next.js web portal = free PWA. No separate build.

**Core technician flows (mobile-optimized):**
1. Fault code lookup → speak or type → Mira answers in <5 seconds
2. QR code scan on machine → full asset history + open WOs load
3. Voice-to-work-order: speak the repair narrative → structured WO created
4. Work order status update from the floor
5. Photo attachment to work order (fault documentation)
6. Push notifications for newly assigned work orders

**Offline requirement:**
Factory floors have dead Wi-Fi zones. Core fault lookup for the top N
assets in a tenant must be cached locally (service worker). Work orders
created offline sync when connectivity returns.

**React Native dedicated app:** Plan for v2 after first revenue.
Triggers: voice reliability issues with PWA, need for App Store
discoverability, Bluetooth sensor pairing for IIoT.

---

### Zone 3 — Thin Clients (Slack, Teams, WhatsApp, Telegram)

All thin clients are webhook listeners routing text to the same
Factory LM API endpoint. No separate model, no separate knowledge base.

**Slack/Teams bot capabilities:**
- `@mira [query]` → RAG answer with citations posted in channel
- Work order assignment alerts pushed to maintenance channel
- Recall/bulletin alerts for affected assets

**WhatsApp Business API:**
- Same RAG query capability
- Preferred channel for Tier 1 independent technicians
- Markets where WhatsApp is primary communication tool

**Build order:** Slack → Teams → WhatsApp (lowest to highest setup cost)

---

## 6. Feature Roadmap

### P0 — MVP (Current Sprint)
- [x] Open WebUI → sidecar → Claude API pipeline
- [x] ChromaDB per-tenant isolation (Brain 2)
- [x] Ollama nomic-embed-text embeddings
- [x] PII sanitization
- [ ] Brain 1 shared OEM collection (separate from tenant collections)
- [ ] Dual-query Brain 1 + Brain 2 at query time
- [ ] Expanded system prompt (maintenance SME persona, format, citations)
- [ ] Safety guardrails (safety.py, keyword detection, SAFETY_BANNER)
- [ ] Open WebUI branding as MIRA (configure_branding.py)
- [ ] Seed OEM documents into Brain 1 shared collection
  (PowerFlex 22A, PowerFlex 525, Allen-Bradley commissioning guides)
- [ ] End-to-end verification (fault query → citation, safety query → banner)

### P1 — Customer Onboarding (Next Sprint)
- [ ] Google Drive OAuth connector (folder selection → Brain 2 ingestion)
- [ ] "Mira's Brain" corpus visibility panel
- [ ] BM25 + semantic hybrid retrieval
- [ ] Cross-encoder re-ranking
- [ ] Responsive CSS / PWA shell
- [ ] Work order creation from chat
- [ ] Atlas CMMS API sync (for Tier 1 users)
- [ ] Slack bot (basic query + alert)

### P2 — Intelligence Layer
- [ ] Bulletin Intelligence Engine
  - RSS feed subscriptions: CPSC, Siemens ProductCERT, Rockwell Security,
    Schneider Electric, ABB
  - Asset-bulletin matching engine (per-tenant alert on match)
  - In-app alert + push notification + Slack alert
- [ ] Anonymized fault-resolution pattern extraction (opt-in)
- [ ] Synthetic Q&A generation from Brain 1 corpus (fine-tuning prep)
- [ ] WhatsApp Business API bot
- [ ] QR code → asset context on mobile

### P3 — The Living Bible
- [ ] Facility Intelligence Document (auto-generated, continuously updated)
  - Asset registry pages (specs, history, failure patterns, bulletins)
  - Synthesized maintenance procedures (OEM + facility history)
  - PM calendar and compliance record
  - Active recalls and bulletin response status
  - Knowledge gaps report
- [ ] Export: full PDF, single asset PDF, new technician onboarding packet
- [ ] Incremental update triggers (new WO, new bulletin, new manual)

### P4 — Fine-Tuning & Advanced Retrieval
- [ ] LoRA fine-tune Factory LM on synthetic Q&A + anonymized outcomes
- [ ] Knowledge graph layer for complex multi-asset queries
- [ ] Predictive failure scoring (component-level MTBF from network data)
- [ ] React Native dedicated mobile app
- [ ] CMMS API connectors (MaintainX, Fiix)

---

## 7. Data Philosophy & Privacy

### The Three Data Tiers

**Tier A — Facility-Private (Brain 2):**
Everything a customer uploads or generates in their account. Lives in
their tenant's ChromaDB collection. Never shared. Never used for any
purpose other than answering that tenant's queries. Customer can delete
at any time and all their data is purged.

**Tier B — Anonymized Contributions (Brain 1 network effect):**
When a user resolves a fault in Mira, the resolution pattern may be
extracted and contributed to the shared knowledge base. This requires:
- Explicit opt-in during onboarding (clear checkbox, plain English)
- True anonymization: company name, asset ID, location, technician name
  all stripped before any data leaves the tenant context
- Only component-level patterns contributed:
  `{fault_code, manufacturer, machine_class, symptoms[], repair_actions[], outcome, repair_time_hrs}`
- No raw documents or work order text transmitted
- Customer can withdraw contribution consent at any time

**Tier C — Public OEM Knowledge (Brain 1 base):**
Manufacturer manuals and fault code databases that are already publicly
available. No consent required. Mira team curates and ingests.

### Privacy Policy Requirements (non-negotiable before first customer)
- Plain-English data policy page (not a legal document)
- Explicit disclosure of Tier B contribution mechanics
- Clear opt-out mechanism
- Data deletion procedure documented

### What Never Happens
- Customer data is never sold or shared with third parties
- Customer data is never used to train a shared model without opt-in
- Cross-tenant queries are never permitted
- PII (IPs, serial numbers, MACs, names) is stripped before reaching
  any LLM (existing sanitization must cover all three scenarios)

---

## 8. Build Sequence

The correct order respects the dependency chain and gets to a
demonstrable customer product as fast as possible.

```
PHASE 1 — Customer-Ready MVP (Current)
  Fix Brain 1 collection namespace
  → Expand system prompt
  → Add safety.py guardrails
  → Brand Open WebUI as MIRA
  → Seed Brain 1 with PowerFlex / Allen-Bradley docs
  → End-to-end test (fault query, safety query, upload + query)
  MILESTONE: First external demo possible

PHASE 2 — First Customer Onboarding
  Google Drive OAuth connector
  → Brain 1/2 hybrid query with source labeling
  → Corpus visibility panel (Mira's Brain)
  → Hybrid BM25 + semantic retrieval
  → Responsive CSS → PWA
  MILESTONE: First paying customer can self-onboard

PHASE 3 — Retention Features
  Bulletin Intelligence Engine (CPSC + top 3 manufacturer feeds)
  → Asset-bulletin matching and alerting
  → Slack bot
  → Atlas CMMS sync
  MILESTONE: Product is proactive, not just reactive

PHASE 4 — Institutional Knowledge Lock-in
  Living Bible generation
  → Export formats (PDF, onboarding packet)
  → Anonymized contribution pipeline
  → Synthetic Q&A generation for fine-tuning prep
  MILESTONE: Churn becomes structurally difficult

PHASE 5 — Scale Infrastructure
  LoRA fine-tune Factory LM
  → React Native mobile app
  → Additional CMMS connectors
  → Knowledge graph layer
  MILESTONE: Product is genuinely differentiated at the model level
```

---

## 9. Alignment Audit Protocol

**MANDATORY BEFORE ANY CODE IS WRITTEN**

Claude Code must explore the repository and answer every question below
with evidence (file paths, code snippets, current values). Do not assume.
Do not infer from memory. Read the actual files. Report findings honestly —
if something is missing, say it is missing. If something contradicts this
PRD, flag the conflict explicitly.

---

### Audit Checklist

**A. Brain 1 / Brain 2 Collection Architecture**

1. What ChromaDB collection name(s) currently exist in the codebase?
   Show the collection initialization code.
2. Is there a `shared_oem` collection (or equivalent) separate from
   per-tenant collections? If not, this is a P0 gap requiring immediate fix.
3. Where does the query path execute? Show the retrieval code in
   `mira-sidecar/rag/query.py`. Does it query one collection or multiple?
4. If only one collection is queried, show exactly where the dual-query
   (Brain 2 first → Brain 1 fallback) needs to be added.

**B. System Prompt**

5. Show the current full text of `_SYSTEM_PROMPT` in
   `mira-sidecar/rag/query.py`.
6. Does it include: citation requirements? safety escalation logic?
   confidence/refusal behavior? structured answer format?
   Answer per item — do not say "yes" if only partially implemented.
7. Show the content of `mira-bots/shared/prompts/diagnose/active.yaml`
   (the tone/style reference to reuse).

**C. Safety Guardrails**

8. Does `mira-sidecar/safety.py` exist? If yes, show its contents.
   If no, confirm it needs to be created.
9. Show the SAFETY_KEYWORDS list from `mira-bots/shared/guardrails.py`.
   Count the keywords. The PRD requires minimum 21 triggers.
10. At what point in the request pipeline does safety detection run?
    Show the code. Does it run before or after the query reaches the LLM?
    It must run before.

**D. Document Ingestion**

11. Show the `/ingest/upload` endpoint implementation. What parameters
    does it accept? What metadata does it attach to each chunk?
12. When a document is ingested, what collection does it land in?
    Is there any logic to route public OEM manuals to Brain 1 vs.
    user documents to Brain 2?
13. Are the seed documents (PowerFlex 22A, PowerFlex 525,
    Allen-Bradley guides) currently ingested anywhere? If yes, which
    collection? If they are in a demo tenant's Brain 2, flag this as
    a P0 conflict with the PRD.

**E. PII Sanitization**

14. Show the current sanitization rules. What patterns are stripped?
    (IPs, MACs, serial numbers — what else?)
15. Does sanitization run on: (a) documents at ingestion time,
    (b) user queries before reaching Claude, or (c) both?
    The PRD requires (b) at minimum. (c) is preferred.

**F. Open WebUI Branding**

16. Does `mira-sidecar/openwebui/configure_branding.py` exist?
    If yes, what API endpoints does it call?
17. What is the current app name shown to users at app.factorylm.com?
    What is the default model shown in the model selector?

**G. End-to-End Verification Status**

18. Test and report results for each of the five verification scenarios
    in the current Claude plan:
    - Fault code query with citation
    - Safety question triggering SAFETY_BANNER
    - PDF upload with "Ingested (N chunks)" confirmation
    - Query against uploaded PDF returning RAG answer
    - New user signup flow (what does a brand-new user see?)

---

### Conflict Resolution Protocol

If any audit finding contradicts a decision in this PRD, do the following:

1. State the conflict explicitly: "PRD requires X. Current code does Y."
2. Do not silently implement the PRD version over the current code
3. Propose the minimal change needed to resolve the conflict
4. Wait for explicit approval before implementing

The audit report must be presented before any code changes are made.

---

## Appendix A: Current Known State (as of April 3, 2026)

The following is confirmed working as of the Claude plan review:

| Component | Status |
|---|---|
| Sign up / login at app.factorylm.com | ✅ Working |
| MIRA Diagnostic model in chat selector | ✅ Working |
| Pipe Function → sidecar → Claude API | ✅ Working |
| Ollama nomic-embed-text embeddings | ✅ Working |
| ChromaDB per-tenant isolation | ✅ Working |
| PII sanitization (IP, MAC, serial) | ✅ Working |
| Brain 1 shared OEM collection | ❌ Not implemented |
| Dual-query Brain 1 + Brain 2 at query time | ❌ Not implemented |
| Expanded system prompt | ❌ 4 sentences only — needs full expansion |
| Safety guardrail (safety.py) | ❌ Needs to be created |
| MIRA branding (not Open WebUI default) | ❌ Not configured |
| Seed OEM docs in Brain 1 collection | ❌ Pending architecture fix first |

---

## Appendix B: Key Files Reference

```
mira-sidecar/
├── rag/
│   └── query.py                    ← _SYSTEM_PROMPT lives here
│                                     Retrieval logic lives here
│                                     ADD: dual Brain 1/2 query
├── safety.py                       ← CREATE THIS
│                                     Port from mira-bots/shared/guardrails.py
├── openwebui/
│   └── configure_branding.py       ← CREATE THIS

mira-bots/
├── shared/
│   ├── guardrails.py               ← READ: SAFETY_KEYWORDS source
│   └── prompts/
│       └── diagnose/
│           └── active.yaml         ← READ: tone/style reference
```

---

*Document version: 2.0 | Product: Mira + Factory LM | Owner: FactoryLM Inc.*
*This document supersedes all previous PRD versions and informal architecture notes.*
*Next review: After Phase 1 milestone is verified end-to-end.*
