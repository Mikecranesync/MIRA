# FactoryLM (Maintenance Context Platform) + MIRA (Maintenance Intelligence Resource Agent) — PRD & Repo Alignment Audit

**Status:** DRAFT · **Created:** 2026-06-16 · **Type:** Research / audit / strategy / planning (no product code)
**Author:** Northstar alignment pass over the MIRA monorepo
**Companion docs:** `docs/THEORY_OF_OPERATIONS.md` (primary doctrine) · `docs/specs/maintenance-namespace-builder-spec.md` · `docs/specs/mira-component-intelligence-architecture.md` · `docs/specs/uns-kg-unification-spec.md` · `NORTH_STAR.md` · `STRATEGY.md` · `docs/plans/2026-05-15-maintenance-namespace-builder.md` · `docs/plans/2026-06-07-path-to-beta.md`

> **Naming law for this document (and the product):**
> **FactoryLM is the platform.** It is the maintenance data, asset context, document, telemetry, CMMS, knowledge-graph, and workflow platform — the system that helps manufacturers collect, organize, map, approve, and maintain trusted industrial maintenance context.
> **MIRA is the agent.** MIRA = *Maintenance Intelligence Resource Agent* — the chatbot/agent interface that uses FactoryLM's approved context to answer questions, explain machine state, guide troubleshooting, and help teams decide.
> MIRA is **not** the whole platform. MIRA is the intelligence layer and user-facing agent. FactoryLM is the underlying context engine.

> **Evidence rule:** Every claim about what exists is anchored to a file path. Where the repo did not give enough evidence, the entry is marked **UNKNOWN** rather than guessed. This document does **not** implement product code.

---

## 1. Executive Summary

The corrected Northstar splits the product cleanly in two:

- **FactoryLM = the self-serve industrial maintenance *context* platform.** It guides technicians, controls engineers, IT/OT staff, integrators, and managers through converting raw PLC tags, SCADA/Ignition tags, CMMS assets, manuals, drawings, VFD registers, technician knowledge, maintenance history, PLC logic, and live telemetry into **trusted, asset-bound context that an AI agent can actually use.**
- **MIRA = the Maintenance Intelligence Resource Agent.** It uses that approved FactoryLM context to answer questions, explain machine state, guide troubleshooting, and produce decision traces.

"Ask MIRA" is **not** the product. The product is the **FactoryLM context-building platform underneath it.** MIRA is only as good as the context FactoryLM has built and approved.

**Where the repo stands today (one-paragraph verdict):** The repo already contains a remarkably large share of the *platform* primitives — an asset-first Hub with an onboarding wizard, a UNS namespace builder, an L0–L6 readiness model, a proposal/approval queue, a read-only PLC parser with a vendor-neutral IR, a per-asset tag-mapping config with `source`/`confidence` provenance, an in-gateway anomaly engine, a tag-streaming relay with freshness+quality columns, and a knowledge graph with proposal/evidence/approval-state discipline. The agent side has grounding, citation compliance, a UNS confirmation gate, KB-gap admission, feedback capture, and a durable decision-trace audit log. **The principal gaps are (a) the upload→retrieval bridge is still RED (beta blocker), (b) MIRA's decision trace is persisted but not surfaced to users ("Why MIRA Thinks This" is backend-only), (c) the asset-agent deployment gate is coded but non-functional (no `asset_id→uns_path` resolver), (d) there is no source-authority ranking, and (e) a customer-shipped Perspective view contains live write-to-VFD calls that violate the read-only anti-goal.** These are the alignment targets.

---

## 2. Problem Statement

Most manufacturers do **not** have clean, semantic, AI-ready maintenance data. The real industrial-AI problem is not asking an LLM a question — it is building trustworthy maintenance context. In a typical plant:

- PLC tags are named differently by every integrator.
- SCADA tags may or may not match machine names.
- CMMS assets are incomplete, duplicated, stale, or disconnected from controls data.
- Manuals and wiring prints sit in folders.
- Technician knowledge is trapped in people's heads.
- Historian data may not exist, or may not be connected to asset meaning.
- VFD/register data is hard to interpret.
- PLC logic exists but is not explained in plain English.
- There is no reliable bridge between live machine state and maintenance context.
- There is no trusted way to prove why an AI answer is correct.

**The hard part is building trustworthy maintenance context. FactoryLM solves the context-building problem. MIRA uses that context to reason.**

This framing is already embedded in repo doctrine: `docs/THEORY_OF_OPERATIONS.md` states the mission as turning maintenance reality into an AI-ready namespace via a capture→extract→match→propose→confirm→store loop, and the beta gate (`tests/beta/beta_ready_upload_retrieval_citation.py`) encodes the minimum proof: *a stranger uploads a manual, asks a question, gets a cited answer — with no manual fixing.*

---

## 3. Competitive / Market Insight

Walker Reynolds and 4.0 Solutions are **correct** that context management is the key skill in agentic industrial AI. A demo where an agent diagnoses spindle wear from CMMS history + PLC telemetry is a valid demonstration of what an agent can do **after** a factory is contextualized.

The careful point — not an accusation of dishonesty — is that such a demo **assumes the hard part is already solved**: assets modeled, telemetry mapped, CMMS history linked, signals named, units understood, machine relationships known, documents tied to assets, and context trustworthy. Most factories do not have Walker-level expertise, a high-end system integrator, or a clean digital architecture. The demo may be entirely real; its **hidden prerequisite is a mature context layer.**

**Positioning:**
- Walker shows what an agent can do *after* the factory is contextualized.
- **FactoryLM is the product that contextualizes the factory — self-serve, incrementally, one asset at a time.**
- **MIRA is the Maintenance Intelligence Resource Agent that becomes useful because FactoryLM built trustworthy context underneath it.**

Alternate one-liners: *FactoryLM turns messy industrial maintenance data into agent-ready context.* · *FactoryLM is the self-serve context platform for industrial maintenance AI.* · *FactoryLM replaces the expensive expert setup required before industrial agents can be useful.* · *FactoryLM solves the industrial maintenance "contextualization gap." MIRA is the agent powered by FactoryLM.*

This aligns with the existing product-wedge ADR (`docs/adr/0014-product-led-wedge.md` — "maintenance-first UNS, not architect-first").

---

## 4. Northstar Product Definition

**FactoryLM** — a self-serve industrial maintenance **context platform** that walks normal users through building trusted, asset-based context from messy industrial data. It guides users through:

PLC program parsing · PLC tag mapping · Ignition/SCADA tag browsing · live read-only telemetry verification · CMMS asset mapping · manual/document linking · VFD/register mapping · technician confirmation · confidence scoring · evidence capture · context approval · asset readiness scoring · agent answer validation.

**MIRA** — the **Maintenance Intelligence Resource Agent**: a chatbot/agent that uses FactoryLM's approved context to answer maintenance questions, explain decisions, and guide troubleshooting. MIRA must:

- Answer from approved FactoryLM context when possible.
- Clearly mark inferred, unapproved, stale, or missing context.
- Show evidence, decision traces, and missing context.
- Recommend next checks.
- Accept human feedback.
- Refuse to overstate confidence when FactoryLM context is weak.

This division is already encoded in `.claude/rules/train-before-deploy.md` (Command Center *trains/validates*; Ignition/HMI *deploys approved agents only*) and `.claude/rules/direct-connection-uns-certified.md`.

---

## 5. Context Maturity Model

Levels of industrial maintenance AI context maturity (the repo already uses an **L0–L6 readiness ladder** — see `mira-hub/src/lib/health-score.ts`, `mira-hub/src/app/api/readiness/route.ts`, `mira-hub/src/components/HealthScoreWidget.tsx`, `mira-hub/db/migrations/021_health_scores.sql`, and the "levels-unlock" model in `docs/THEORY_OF_OPERATIONS.md`):

| Level | Name | Meaning |
|---|---|---|
| **L0** | Raw Data | Tags, files, CMMS records, manuals, machine names exist but are not connected. |
| **L1** | Identified Assets | FactoryLM knows this is Line 1, Conveyor 3, a GS10 VFD, a Micro820 PLC. |
| **L2** | Mapped Signals | This tag = motor running; this register = output frequency; this input = photoeye blocked. |
| **L3** | Relationships | This VFD drives this conveyor; this photoeye detects product on this conveyor; this PLC routine controls this motor. |
| **L4** | Live State | FactoryLM can read current machine state from approved, fresh, mapped telemetry. |
| **L5** | Decision Logic | Permissives, interlocks, fault paths, and troubleshooting decision trees are understood. |
| **L6** | Historical Reasoning | Current events compared against fault history, maintenance history, technician notes, operating state, and prior failures. |

Most factories are stuck at **L0/L1**. FactoryLM's job is to guide them toward **L5/L6 one asset at a time.** **MIRA becomes more useful as FactoryLM's context maturity rises** — and should *refuse to overstate* when the asset is still at L0–L2.

> Note: the repo currently computes an L0–L6 *score + a single `nextStep` string*, but **does not** expose the actionable per-asset checklist that tells a user exactly what to do to climb a level (see §6/§7).

---

## 6. Current Project Inventory

Classification: **ALIGNED** (supports the Northstar) · **PARTIAL** (useful, needs reshaping) · **GAP** (missing/insufficient) · **RISK** (pulls away from the Northstar) · **UNKNOWN** (insufficient repo evidence).

### 6.1 FactoryLM — Command Center / Hub (`mira-hub/`)

| Capability | Class | Evidence |
|---|---|---|
| Asset creation / registry / detail | ALIGNED | `mira-hub/src/app/(hub)/assets/page.tsx`, `assets/[id]/page.tsx` (create modal, criticality/status filters, OEM/model/location, QR) |
| Train-and-approve / asset approval workflow | ALIGNED | `mira-hub/src/app/(hub)/onboarding/page.tsx`, `components/AssetValidateTab.tsx`, `db/migrations/046_asset_agent_status.sql` (draft→training→validating→approved→deployed; citation coverage + groundedness thresholds) |
| Asset / component profiles | ALIGNED | `assets/[id]/page.tsx` tabs (overview, activity, work orders, documents, parts, intelligence, validate) |
| AI proposals + verify/reject transition | ALIGNED | `knowledge/suggestions/page.tsx`, `api/proposals/[id]/decide/route.ts` (kg_entity, tag_mapping, component_profile, uns_confirmation types; risk-tiered) |
| Context maturity / readiness score (L0–L6) | ALIGNED | `components/HealthScoreWidget.tsx`, `api/readiness/route.ts`, `lib/health-score.ts`, `db/migrations/021_health_scores.sql` |
| First-asset onboarding wizard | ALIGNED | `onboarding/page.tsx` (6-step: company→site→line→review→try MIRA→train & approve; writes `kg_entities` + namespace audit rows) |
| Namespace builder UI (UNS gate, proposals, readiness) | ALIGNED | `namespace/page.tsx` (tree reparent, children/files/proposals/details/work-orders tabs) |
| Document/manual linking to assets | ALIGNED | `assets/[id]/page.tsx` DocumentsTab + `api/assets/[id]/documents/` (indexed/partial/pending, chunk count) |
| CMMS asset linking (read) | ALIGNED | `cmms/page.tsx`, `api/cmms/health` (WO/asset/PM stats, links to CMMS) |
| Approved vs suggested separation in UI | ALIGNED | `knowledge/suggestions/page.tsx` (Proposals vs Suggestions, status badges) |
| Context audit log / change history | ALIGNED | `event-log/page.tsx` (diagnostic/wo_created/pm_scheduled/manual_served/safety_alert with MIRA reasoning detail) |
| Ask MIRA embedded in Hub | ALIGNED | `components/AssetChat.tsx`, asset `chat/` route, node-scoped `NodeChat` |
| Command Center live HMI / freshness display | ALIGNED | `command-center/page.tsx` (10s tag freshness poll; view-only of approved assets) |
| Tag-import CSV wizard / PLC tag mapper UI | PARTIAL | Spec includes tag-import CSV pipeline (`docs/specs/maintenance-namespace-builder-spec.md`); `tag_mapping` suggestion type exists, but no dedicated importer flow in Hub |
| Relationship builder UI | PARTIAL | Proposals show relationship types read-only (`api/kg/graph/route.ts`); no interactive edge editor |
| Actionable readiness checklist | GAP | Only L0–L6 score + opaque `nextStep` string; no "do X, Y, Z to reach L3" checklist |
| Photo/nameplate capture → namespace worker | GAP | QR generation exists; no photo-upload-to-extraction wiring found (refs to `mira-scan-spec.md` only) |
| Role-based approval gating | GAP | `asset_agent_status.approved_by` is a TEXT actor; no role matrix / approver assignment UI |

### 6.2 MIRA — agent / answer generation (`mira-bots/shared/`, `mira-pipeline/`)

| Capability | Class | Evidence |
|---|---|---|
| Grounded answer generation (Supervisor/GSD) | ALIGNED | `mira-bots/shared/engine.py` (Supervisor; RAG worker; FSM state) |
| Citation / source attribution | ALIGNED | `mira-bots/shared/citation_compliance.py`, `workers/rag_worker.py` (`[Source:…]` tags, vendor-label formatting; fail-open) |
| Missing-context detection / KB-gap admission | ALIGNED | `neon_recall.py` `kb_has_coverage()`, `rag_worker.py` `_build_clarification_request()` |
| No-guessing fallback / disclaimer when KB empty | ALIGNED | `rag_worker.py` `no_kb_coverage`, `engine.py` `_append_no_kb_disclaimer()` |
| Confidence levels surfaced | ALIGNED (3-tier) | `engine.py` `_infer_confidence()` HIGH/MEDIUM/LOW; appended to answer header |
| UNS confirmation gate + direct-connection carve-out | ALIGNED | `engine.py` `_should_fire_uns_gate()`, `mira-pipeline/ignition_chat.py` (422 `uns_required` reject contract) |
| Telemetry freshness awareness in answers | ALIGNED | `mira-bots/shared/live_snapshot.py` ([LIVE …] block, `[STALE]` markers when `vfd_comm_ok=false`) |
| Human feedback loop on answers | ALIGNED | `engine.py` `log_feedback()` → `feedback_log`; Telegram/Slack thumbs wired; `few_shot_trainer.py` consumes |
| Agent answer audit log | ALIGNED | `mira-bots/shared/decision_trace.py` → `decision_traces`; `benchmark_db.py`; `conversation_logger.py` |
| Evidence packet (data layer) | ALIGNED | `decision_trace.py` (tag/manual/kg evidence JSONB), `benchmark_db.py` `evidence_packet` |
| Decision trace exposed to user ("Why MIRA Thinks This") | PARTIAL | Trace is **persisted to NeonDB but backend-only**; user sees confidence + limiting note, not the reasoning path |
| Inferred vs approved vs live vs historical labels in answer text | PARTIAL | Source tracked internally + `[STALE]`/confidence% partially signal it; not labeled in user text |
| Groundedness scoring (1–5) | GAP | No calibrated 1–5 scale; only HIGH/MEDIUM/LOW keyword heuristic |
| Explicit refusal/escalate at very low confidence | GAP | Low confidence appends a note; no hard "I won't answer / escalate to human" gate |
| Model-level citation relevance | GAP/RISK | `citation_compliance.py` checks **vendor-level** match (PowerFlex 40 chunk passes on a 525 question) |
| Asset-agent deployment gate (ENFORCE_ASSET_AGENT_GATE) | PARTIAL/GAP | Logic exists (`ignition_chat.py`, `asset_agent_transition.py`) but **NOT functional** — no `asset_id→uns_path` resolver, so it returns None for all assets; default OFF |

### 6.3 FactoryLM — PLC parser, tag mapper, VFD analyzer (`mira-plc-parser/`, `plc/`, `ignition/`)

| Capability | Class | Evidence |
|---|---|---|
| Vendor-neutral MIRA PLC IR | ALIGNED | `mira-plc-parser/mira_plc_parser/ir.py` (Controller→Program→Routine→Rung→Tag; provenance + Confidence HIGH/MEDIUM/LOW/REVIEW; read-only, no setters) |
| Rockwell L5X parser | ALIGNED | `parsers/rockwell_l5x.py` (+ `test_l5x.py`) |
| CSV tag-export parser (multi-vendor) | ALIGNED | `parsers/csv_tags.py` reusing `ignition/webdev/FactoryLM/api/diagnose/tag_csv.py` |
| Deterministic analysis (tag dict, faults, assets, VFD signals, safety REVIEW) | ALIGNED | `mira-plc-parser/mira_plc_parser/analyze.py` (+ tests) |
| Read-only posture | ALIGNED | `ir.py` (no write APIs); `.claude/rules/fieldbus-readonly.md`; `plc/discover.py` |
| Signal-role vocabulary (16 roles) | ALIGNED | `ignition/webdev/FactoryLM/api/diagnose/signal_roles.py` (dual Py2.7/3.12) |
| Per-asset tag-map config with provenance | ALIGNED | `asset_config.py` + `docs/specs/vfd-analyzer-auto-map-spec.md` (`source`=manual/ai/seed; `confidence`=verified/proposed/low; `unsPath`; divisors) |
| VFD analyzer (GS10 decode + A0–A12 anomaly rules) | ALIGNED | `diagnose_core.py` (59 fault codes; 12 rules; severity→confidence) |
| Click-to-map setup UI (Perspective) | ALIGNED | `docs/specs/vfd-analyzer-auto-map-spec.md` §6; `plc/ignition-project/testing/` TagMapper |
| PLCopen XML / Structured Text / Siemens TIA parsing | PARTIAL | `detect.py` recognizes formats; **no parser** (roadmap Phase 5/6) |
| PLC tag → component instance generation | PARTIAL/GAP | Asset candidates inferred; parser does **not** emit `installed_component_instances` |
| PLC tag → UNS path inference integrated into parser output | PARTIAL | Resolver can match tokens; not wired into parser output |
| PDF / screenshot (OCR) parsing | GAP | Deferred Phase 7 |
| Push-values to i3X | GAP | No code found; no `i3x`/`i3X` references in parser/ignition/live paths (**UNKNOWN** external service) |

### 6.4 FactoryLM — live telemetry / Ignition / connectivity (`ignition/`, `mira-relay/`, `mira-bridge/`, `mira-connect/`)

| Capability | Class | Evidence |
|---|---|---|
| Ignition WebDev endpoints + Perspective views | ALIGNED | `ignition/webdev/FactoryLM/api/{tags,chat,diagnose,status,alerts,ingest,connect}/`, `ignition/project/.../views/` |
| Gateway tag poller (allowlisted, read-only) | ALIGNED | `ignition/gateway-scripts/tag-stream.py` (`browseTags`+`readBlocking` only; quality+timestamp) |
| In-gateway anomaly detection (A0–A12, dual Py) | ALIGNED | `plc/conv_simple_anomaly/rules_core.py` (vendored as `diagnose_core.py`) |
| Cloud relay tag ingest (freshness + quality + allowlist fail-closed) | ALIGNED | `mira-relay/tag_ingest.py`, `mira-relay/auth.py` (HMAC, outbound-only) |
| Freshness schema (live/stale/unknown/simulated) | ALIGNED | `mira-hub/db/migrations/036_current_tag_state_freshness.sql`, `020_signal_cache_and_trends.sql` |
| Bench-only write tools clearly fenced | ALIGNED | `plc/live_monitor.py`, `plc/live-plc-bridge/bridge.py` (BENCH-ONLY banners) |
| Direct-connection UNS certification | ALIGNED | `mira-pipeline/ignition_chat.py` + `.claude/rules/direct-connection-uns-certified.md` |
| Automated freshness sweep (live→stale flip) | PARTIAL | Schema ready; **no worker** flips status after `expected_freshness_seconds` |
| MQTT / Sparkplug B ingestion | PARTIAL/DEFERRED | `mira-connectors/.../mqtt.py` read-only by construction; `mira-connect/` scaffolding only, no subscribe loop |
| Live tag-mapping verification endpoint | PARTIAL | `mira-connectors/.../base.py` `validate_mappings()` framework; no prod REST endpoint |
| WebDev module actually installed on bench gateway | UNKNOWN | Project structure present; module JAR install status unconfirmed (cf. `docs/RESUME_2026-06-14_*` notes WebDev not installed on bench) |
| **Customer-shipped Perspective WRITE to VFD** | **RISK** | `ignition/project/.../views/SpeedControl/resource.json` & `FaultLog/resource.json` call `system.tag.writeBlocking()` to `VFD_FreqSetpoint_Raw` / `VFD_CmdWord` — **not** bench-fenced; violates read-only anti-goal (`docs/mira-ignition-secure-architecture.md` §8) |

### 6.5 FactoryLM — CMMS, documents, knowledge graph, UNS (`mira-cmms/`, `mira-crawler/ingest/`, `mira-mcp/`)

| Capability | Class | Evidence |
|---|---|---|
| CMMS Atlas integration (internal + tenant) | ALIGNED | `mira-mcp/cmms/atlas.py`, `mira-mcp/server.py` (`AtlasCMMS.for_tenant()`) |
| Document chunker with page/section anchors | ALIGNED | `mira-crawler/ingest/chunker.py`, `mira-hub/db/migrations/045_knowledge_entries_chunk_anchors.sql` |
| knowledge_entries hybrid corpus (OEM + tenant) | ALIGNED | `.claude/rules/knowledge-entries-tenant-scoping.md`, `docs/migrations/001_knowledge_entries.sql` |
| kg_entities / kg_relationships + approval_state | ALIGNED | `docs/migrations/004,005`, `008_kg_approval_state.sql` |
| Relationship proposals + evidence | ALIGNED | `mira-hub/db/migrations/018_relationship_proposals.sql`, `mira-crawler/ingest/proposal_writer.py` |
| No-auto-verify discipline | ALIGNED | `proposal_writer.py` (default proposal path; auto-verify only behind `MIRA_KG_INGEST_AUTOVERIFY`) |
| UNS path builders + resolver | ALIGNED | `mira-crawler/ingest/uns.py`, `mira-bots/shared/uns_resolver.py` |
| De-dup before insert | ALIGNED | `mira-crawler/ingest/dedup.py` |
| **Upload→retrieval bridge** | **GAP (OPEN BLOCKER)** | Uploads write Open WebUI KB only (`mira-core/mira-ingest/main.py` `/ingest/document-kb`); retrieval reads `knowledge_entries` only (`neon_recall.recall_knowledge`). PR #1592 merged but beta gate still xfail/RED (`tests/beta/beta_ready_upload_retrieval_citation.py`) |
| Source authority ranking | GAP | Confidence exists; **no** OEM-manual > technician-note > forum weighting |
| Work-order history mining | GAP | WO models + MaintainX/Atlas syncs exist; **no** pattern-extraction module |
| CMMS asset ↔ UNS bidirectional sync | GAP | `cmms_create_asset_from_nameplate` extracts forward; no reverse mirror |
| Customer-upload manual → site-instance binding | GAP | `register_equipment_and_manual()` targets `enterprise.knowledge_base.*` catalog, not site equipment instances |

---

## 7. Gap Analysis

**FactoryLM (platform) gaps:**

| Gap | Status | Note |
|---|---|---|
| Asset-bound **context package** compiler / store | MISSING | No `ContextPackage` table; context is implicit in `troubleshooting_sessions` + `asset_agent_status` + `health_scores` |
| Per-asset **readiness checklist** (actionable steps) | GAP | L0–L6 score + single `nextStep` only |
| Upload→retrieval bridge (approved context actually retrievable) | GAP/BLOCKER | See §6.5; this is the beta blocker |
| **Source authority ranking** | MISSING | All sources weighted equally at retrieval |
| Tag-import CSV → proposals wizard (parser→Hub) | PARTIAL | Parser exists; Hub importer flow missing |
| Relationship builder (manual edge creation) | PARTIAL | Proposals read-only; no editor |
| CMMS asset ↔ UNS sync; manual→site-instance linking | GAP | One-directional today |
| Work-order history intelligence | GAP | Models present, extractor absent |
| Automated **freshness sweep** worker | PARTIAL | Schema ready, no worker |
| Photo/nameplate capture pipeline | GAP | Not wired |
| Role-based approval matrix | GAP | Actor string only |
| Audit log of context changes | ALIGNED | `event-log`, `decision_traces`, `ignition_audit_log` already exist |

**MIRA (agent) gaps:**

| Gap | Status | Note |
|---|---|---|
| **"Why MIRA Thinks This"** user-facing panel | GAP | `decision_traces` persisted but not surfaced |
| Evidence table per answer (user-facing) | GAP | Data exists; not rendered to user |
| Inferred / approved / live / historical labels in answers | PARTIAL | Internal only |
| Groundedness 1–5 score | GAP | 3-tier heuristic only |
| Explicit refusal/escalation when context missing/stale | GAP | Note appended, no hard gate |
| Model-level citation relevance | GAP | Vendor-level today |
| Asset-agent deployment gate functional | GAP | No `asset_id→uns_path` resolver |
| Human feedback (correct/wrong/missing-context) loop | PARTIAL | `feedback_log` exists; "missing context" verb + UI surfacing incomplete |
| Agent answer audit log | ALIGNED | `decision_traces` / `ignition_audit_log` |

---

## 8. Product Principles

1. FactoryLM is **asset-first, not chat-first.**
2. FactoryLM builds the trusted context; MIRA uses it.
3. MIRA must **prove what FactoryLM context it used.**
4. FactoryLM must distinguish **live facts from inferred facts.**
5. FactoryLM must never treat **suggested** mappings as **approved** facts. *(Already enforced: `proposal_writer.py` no-auto-verify, `source`/`confidence` on tag config.)*
6. FactoryLM must show **freshness** for live telemetry. *(Schema exists; sweep worker pending.)*
7. MIRA must explain its decision path in **technician-readable** language.
8. FactoryLM must guide normal users through context building instead of requiring expert setup.
9. FactoryLM supports **read-only** industrial connections by default. *(Violated by the Perspective write surface — §6.4 RISK.)*
10. FactoryLM avoids **cloud-to-plant write paths.** *(Same RISK.)*
11. FactoryLM must be useful **one asset at a time** before whole-plant transformation.
12. MIRA must not answer confidently when FactoryLM context is missing, stale, or unapproved.
13. FactoryLM must make context **visible, auditable, and correctable by humans.**
14. MIRA must be explainable enough for a technician to trust or challenge.

---

## 9. User Personas

| Persona | Pain | Can configure in FactoryLM | Should approve | Not expected to understand | FactoryLM helps | MIRA helps |
|---|---|---|---|---|---|---|
| **Maintenance technician** | Machine down, clock running, knowledge in their head | Confirm asset, confirm tag meaning, link a manual page, mark answer correct/wrong | Tag-meaning confirmations, "this is the right asset" | LLM internals, UNS ltree, embeddings | Confirm/correct mappings with live values in front of them | Plain-language diagnosis + next check + evidence |
| **Maintenance manager** | No visibility into readiness or recurring failures | Asset criticality, PM linkage, review readiness | Approve an asset agent for deployment | Parser internals | Readiness dashboard, audit log | Cross-asset patterns, WO-grounded answers |
| **Controls engineer** | Tags named inconsistently; logic undocumented | Import PLC export, map tags to roles, confirm VFD registers | Tag-role mappings, signal divisors | RAG/retrieval mechanics | PLC parser + role mapper + live verify | Explains logic/permissives in plain English |
| **IT/OT administrator** | Security, read-only posture, data boundaries | Connection setup, allowlist, tenant config | Connection scope, allowlist | Diagnostic rubric details | Read-only connectors, HMAC relay, freshness | n/a (governs the surface MIRA runs on) |
| **System integrator** | Repeating setup per customer | Bulk import, component templates, namespace build | Namespace structure, component templates | Per-tenant retrieval law | Reusable templates + proposal queue | Validates the build via Ask MIRA preview |
| **Plant manager** | ROI, downtime, trust in AI | Little directly; reviews outcomes | Go/no-go on deployment | Everything technical | Readiness + audit as proof | Decision traces as trust artifacts |

---

## 10. Primary User Journey (ideal first asset)

1. User creates/selects an asset in FactoryLM (`assets/page.tsx`).
2. User imports/connects data sources (PLC export, Ignition tags, manuals, CMMS).
3. FactoryLM discovers candidate PLC/SCADA tags (parser `analyze.py`; gateway `tag-stream.py`).
4. FactoryLM suggests likely signal meanings (`signal_roles.py`, VFD signal candidates).
5. User verifies live values (live read, quality gate).
6. User approves or corrects mappings (per-asset config `source`/`confidence`).
7. User links manuals, prints, notes (DocumentsTab + ingest).
8. User links/imports CMMS asset/history (`cmms/page.tsx`).
9. FactoryLM builds an **asset context package** *(GAP: no first-class entity yet)*.
10. FactoryLM assigns a **context maturity level** (`health-score.ts`).
11. User deploys Ask MIRA for that approved asset *(GAP: deployment gate non-functional)*.
12. MIRA answers using approved context, marking inferred/live/historical *(PARTIAL)*.
13. User opens **"Why MIRA Thinks This"** *(GAP: backend-only today)*.
14. User marks the answer correct / wrong / missing-context (`feedback_log`; verb surfacing PARTIAL).
15. FactoryLM improves the asset context profile from feedback (`few_shot_trainer.py`).

---

## 11. "Why MIRA Thinks This" Feature

A core MIRA feature. Every answer should expose: **FactoryLM context used · FactoryLM context ignored · live evidence · freshness · decision path · source references · confidence · missing context · recommended next check · human feedback controls.**

The data already exists in `mira-bots/shared/decision_trace.py` (`decision_traces` table: tag/manual/kg evidence JSONB, citations, recommendation, confidence) — **the gap is rendering it to the user.**

**Example answer structure:**

> **Q:** Why will Conveyor 1 not start?
> **MIRA:** Conveyor 1 is not starting because the drive-enable permissive is not satisfied.
>
> **Evidence from FactoryLM** (all *live, fresh*): PLC connection OK · EStop_OK true · Photoeye_Blocked false · VFD_Comm_OK true · Drive_Enable **false** · Motor_Running false
> **Decision path:** PLC reachable → safety permissive OK → photoeye clear → VFD comms OK → **Drive_Enable is false** → motor start blocked before output energizes.
> **Confidence:** High — *assuming the Drive_Enable tag mapping is approved in FactoryLM.*
> **Missing context:** Physical VFD enable-terminal state is not currently mapped.
> **Next check:** Verify VFD enable wiring, local/remote mode, and drive status word.
> **Feedback:** [Correct] [Wrong] [Missing context] [Needs human review]

---

## 12. Data Model Concepts

Status against current schema (evidence from `mira-hub/db/migrations/`, `docs/migrations/`):

| Entity | Purpose | Owner | Status | Evidence / note |
|---|---|---|---|---|
| **Asset** | Physical equipment identity | FactoryLM | PARTIAL | `cmms_equipment` referenced widely; CREATE TABLE not in Hub migrations (**UNKNOWN** location — likely CMMS/ingest schema); `asset_enrichment_reports` (Hub 004) |
| **Component** | Reusable + installed parts | FactoryLM | PRESENT | `component_templates` (016), `installed_component_instances` (017) |
| **Signal / Tag** | Tag definition + live stream | FactoryLM | PRESENT | `tag_entities` (025), `tag_events` (033), `live_signal_events` (019), `live_signal_cache` (020), `approved_tags` (035) |
| **Mapping** | Tag↔component, component↔component | FactoryLM | PRESENT | `installed_component_instances`, `wiring_connections` (026); per-asset config (`asset_config.py`) |
| **ContextPackage** | Compiled approved context for an asset | FactoryLM | **MISSING** | No table; implicit in sessions + agent status + health scores |
| **EvidenceItem** | A cited piece of support | both | PRESENT | `relationship_evidence` (018); `decision_traces.*_evidence` JSONB (032) |
| **DecisionTrace** | Per-turn reasoning audit | MIRA | PRESENT | `decision_traces` (032) |
| **SourceReference** | Pointer to doc/page/tag | both | PRESENT (JSONB) | `decision_traces.*_evidence`, `ignition_audit_log.sources_json` (031); no normalized table |
| **ContextApproval** | Approve/reject context | FactoryLM | PARTIAL | `ai_suggestions` (027), `relationship_proposals.status` (018); no unified approval trace |
| **ContextMaturityScore** | L0–L6 readiness | FactoryLM | PRESENT | `health_scores` (021); `asset_agent_status` (046), `asset_validation_qa` (047) |
| **TelemetrySnapshot** | Sampled live values | FactoryLM | PRESENT | `live_signal_events` (019), `tag_events` (033), `diagnostic_trend_signals` (020) |
| **DocumentSource** | Manual/doc chunk | FactoryLM | PRESENT | `knowledge_entries` (docs 001) + anchors (045) |
| **CMMSRecord** | Work order / asset record | FactoryLM | PARTIAL | `tenant_cmms_config` (008); `work_orders` referenced, CREATE not found (**UNKNOWN**) |
| **Relationship** | KG edge | FactoryLM | PRESENT | `kg_relationships`; `relationship_proposals` (018) |
| **TechnicianFeedback** | correct/wrong/missing-context | both | **MISSING (dedicated)** | Scattered: `feedback_log`, `decision_traces.technician_confirmed`, `asset_validation_qa.reviewer_verdict` |
| **AgentAnswerAudit** | Per-answer record | MIRA | PRESENT | `ignition_audit_log` (031), `decision_traces` (032), `asset_validation_qa` (047) |

**Separation:**
- **FactoryLM context entities:** Asset, Component, Signal/Tag, Mapping, ContextPackage, ContextApproval, ContextMaturityScore, TelemetrySnapshot, DocumentSource, CMMSRecord, Relationship.
- **MIRA runtime entities:** DecisionTrace, EvidenceItem (as rendered), AgentAnswerAudit, TechnicianFeedback (shared).

**Tenant-id typing caution** (`.claude/rules/mira-hub-migrations.md`): **TEXT** for the CMMS/equipment family (`cmms_equipment`, `tenant_cmms_config`, `knowledge_entries`) vs **UUID** for the kg/Hub family. Any new entity must match its family. No migration plan is proposed here.

---

## 13. Architecture Direction

**FactoryLM platform (context engine):**
- Asset-first context graph (`kg_entities`/`kg_relationships` + UNS ltree).
- Read-only industrial connectors (Ignition WebDev/gateway scripts → `mira-relay`; future Sparkplug via `mira-connect`).
- PLC/tag/SCADA ingestion (`mira-plc-parser` IR → analysis → proposals).
- CMMS/document/manual ingestion (`mira-crawler/ingest`, `mira-core/mira-ingest`, `mira-mcp` CMMS tools).
- **Context package builder** *(to build)* compiling approved mappings + docs + relationships per asset.
- Evidence collection (`relationship_evidence`, decision-trace evidence).
- **Source ranking layer** *(to build)*.
- Approval workflow (`ai_suggestions`, `relationship_proposals`, `asset_agent_status`).
- Context maturity scoring (`health_scores`).
- Audit log (`event-log`, `ignition_audit_log`).

**MIRA agent (intelligence layer):**
- Answer generation (`engine.py` Supervisor + cascade `inference/router.py`).
- Decision-trace generator (`decision_trace.py`).
- **Evidence renderer + "Why MIRA Thinks This"** *(to build on existing trace data)*.
- Missing-context detector (`neon_recall.kb_has_coverage`).
- Feedback collector (`feedback_log`).
- Technician-facing chat (Slack `mira-bots/slack`, Ignition `mira-pipeline/ignition_chat.py`, Hub `AssetChat`).

**How the pieces fit:** PLC parser + tag mapper + Ignition connector + CMMS mapper + document ingestion all **write proposals into FactoryLM**, which a human **approves** into the context store; the store feeds a per-asset **context package** with a **maturity level**; only when an asset is approved does **MIRA** answer over it, emitting evidence + decision trace and collecting feedback that loops back into the store.

---

## 14. UX Direction

**FactoryLM Hub = a guided context-building workspace, not just a dashboard.** Key screens (existing vs to-build):

- Asset context maturity dashboard — *exists* (`HealthScoreWidget`, `command-center`).
- First-asset setup wizard — *exists* (`onboarding/page.tsx`).
- PLC tag mapper / live tag verifier — *partial* (Perspective TagMapper; Hub importer to build).
- CMMS asset linker — *exists (read)* (`cmms/page.tsx`).
- Manual/document linker — *exists* (DocumentsTab).
- Relationship builder — *partial* (proposals read-only).
- Approved context viewer — *partial* (proposals "Verified" tab).
- Asset readiness **checklist** — *to build* (actionable steps).
- Context audit log — *exists* (`event-log`).

**MIRA components:** Ask MIRA chat (*exists*), Ask MIRA preview (*partial*), **Why MIRA Thinks This panel** (*to build*), evidence table (*to build, data exists*), decision-trace panel (*to build*), feedback/retraining panel (*partial*).

Use plain maintenance language; do not force users to understand AI terminology.

---

## 15. MVP Recommendation

Focus on **one asset type first**: the **conveyor + GS10 VFD + photoeye + motor** cell the repo is already built around (`plc/conv_simple_anomaly`, VFD analyzer, ConvSimpleLive).

**FactoryLM MVP must include:** asset creation · tag discovery/import · tag mapping (role config with source/confidence) · technician approval · live verification · **context package** · context maturity score · approved-context viewer · basic asset-readiness checklist.

**MIRA MVP must include:** Ask MIRA answer · **evidence table** · **decision trace** ("Why MIRA Thinks This") · missing-context warning · confidence level · feedback: correct/wrong/missing-context.

**Out of MVP:** multi-asset/line context, historical reasoning at scale, Sparkplug ingestion, PDF-OCR parsing, marketplace/module packaging, role-based approval matrix, push-to-i3X.

---

## 16. Roadmap

| Phase | Goal | User value | Likely files/areas | Risks | Tests/evidence |
|---|---|---|---|---|---|
| **0** | Northstar docs + this audit | Shared direction | `docs/product/` (this file) | Doc drift | This PRD reviewed/approved |
| **1** | Context maturity model + actionable readiness checklist | "What do I do next to make MIRA useful here?" | `lib/health-score.ts`, `api/readiness`, `HealthScoreWidget`, new checklist UI | Score gameable | Unit tests on level transitions; screenshot |
| **2** | **Context package builder** (compile approved mappings+docs+relationships per asset) | One trusted bundle per asset | new `ContextPackage` model + compiler; reads `installed_component_instances`, `knowledge_entries`, `kg_relationships` | Schema/tenant-typing mistakes | Package round-trip test; staging migration dry-run |
| **3** | MIRA **"Why MIRA Thinks This"** (surface decision_traces) | Trust + challengeability | `decision_trace.py` (read API), Hub/Perspective panel, `AssetChat` | Over-exposing raw internals | Render test from a real trace row; screenshot |
| **4** | PLC/tag/SCADA mapper hardening (parser→Hub CSV import; live verify endpoint; freshness sweep worker) | Faster, verified mapping | `mira-plc-parser`, Hub tag-import, `mira-relay`, freshness worker | Read-only posture; allowlist gaps | Parser tests; freshness flip test |
| **5** | CMMS/manual linking (manual→site-instance; CMMS↔UNS sync; **close upload→retrieval gap**) | Uploaded manuals are citable | `mira-crawler/ingest`, `mira-core/mira-ingest`, `manual-rag.ts`, beta gate | Tenant scoping leaks (#1761/#1833) | **`tests/beta/beta_ready_upload_retrieval_citation.py` goes green** |
| **6** | Historical reasoning (work-order mining; fault/MTTR patterns) | Learn from past failures | new WO extractor; `neon_recall` WO path | Sparse/dirty CMMS data | Golden cases over WO history |
| **7** | Multi-asset / line context | Whole-line questions | namespace subtree queries; engine `cross_asset` | Boil-the-ocean | Line-level eval scenarios |
| **8** | Marketplace / Ignition module / on-prem package | Distribution | `ignition/` packaging, module JAR | Write-surface leakage (§6.4 RISK) | Module install + read-only audit |

---

## 17. Success Metrics

**FactoryLM:** time to first approved asset context · approved mappings per asset · # assets with a maturity score · # assets at L4/L5/L6 · time raw-tags→approved-context · linked manuals/CMMS/telemetry signals per asset · % context items approved vs suggested · # technician corrections captured.

**MIRA:** % answers with an evidence table · % answers with a decision trace · % answers using approved FactoryLM context · feedback mix (correct/wrong/missing-context) · reduction in unsupported/generic answers · technician trust score · demo-readiness score · # missing-context warnings correctly shown.

Existing measurement hooks to build on: `decision_traces`, `asset_validation_qa` (`groundedness`, `evidence_utilization`), `health_scores`, `feedback_log`, `benchmark_db`.

---

## 18. Risks and Anti-Goals

**Risks:** describing MIRA as the whole platform · FactoryLM becoming "just a dashboard" · MIRA becoming "just a chatbot" · overpromising predictive maintenance · pretending telemetry exists when it doesn't · trusting unapproved mappings · making users do too much manual context work · building a giant enterprise canvas before the asset workflow works · depending on perfect CMMS data · boiling the ocean with whole-plant UNS before proving one asset · letting the LLM invent missing industrial facts.

**Anti-goals (with current repo status):**
- ❌ Cloud-to-plant write paths — **VIOLATED** by `SpeedControl`/`FaultLog` Perspective `system.tag.writeBlocking()` (§6.4). **Must gate/fence/remove.**
- ❌ Assume historian data exists — honored (telemetry is optional/freshness-aware).
- ❌ Require perfect CMMS — honored (CMMS is read/additive).
- ❌ Require Walker-level expertise — the whole self-serve thesis.
- ❌ Let MIRA invent missing telemetry — partially honored (`[STALE]`, KB-gap admission); strengthen with explicit refusal.
- ❌ Ask MIRA on unapproved assets without warnings — gate exists but **non-functional** (§6.2); must ship the resolver.
- ❌ Build a generic AI canvas as the core product — honored (asset-first wedge, `adr/0014`).
- ❌ Make MIRA responsible for context FactoryLM hasn't approved — the design intent; enforce via the deployment gate.
- ❌ Prioritize broad dashboards before first-asset workflow — watch `command-center` scope creep.

---

## 19. Current Repo Alignment Score

Overall: **6.5 / 10** — the platform primitives are unusually mature for this stage; the gaps are concentrated in *surfacing* context to users (Why-MIRA panel), *closing* the upload→retrieval loop, and *enforcing* the deploy gate + read-only posture.

| Category | Score | Reason (evidence) |
|---|---|---|
| FactoryLM platform / context model | 7/10 | Strong KG + proposals + approval + UNS (`kg_*`, `relationship_proposals`, `uns.py`); missing first-class ContextPackage + source ranking |
| MIRA agent / chat interface | 7/10 | Grounding, citation, gate, KB-gap admission, fallback all present (`engine.py`, `citation_compliance.py`); confidence is heuristic |
| Asset-first model | 8/10 | Asset pages, onboarding wizard, namespace builder, component templates/instances |
| Tag/telemetry mapping | 7/10 | Parser IR + role config + VFD decode (`mira-plc-parser`, `signal_roles.py`, `asset_config.py`); Hub importer + component instantiation partial |
| Approval workflow | 7/10 | No-auto-verify, proposals/suggestions, asset_agent_status; fragmented across surfaces; role matrix missing |
| Evidence and citations | 6/10 | Data captured (`decision_traces`, `relationship_evidence`); user-facing evidence table not rendered; citation relevance vendor-level |
| Decision trace | 5/10 | Durable backend trace exists; **not surfaced to users** |
| Live telemetry readiness | 6/10 | Read path + freshness schema strong; sweep worker missing; WebDev install UNKNOWN |
| CMMS / document context | 5/10 | Ingest + chunk anchors + CMMS client present; **upload→retrieval gap RED**; WO mining + CMMS↔UNS sync missing |
| UI wizard flow | 7/10 | Real onboarding + namespace UX; readiness checklist + relationship editor missing |
| Industrial safety / read-only posture | 5/10 | Read-only doctrine + bench fencing strong, **but** a customer-shipped Perspective write surface violates it (§6.4 RISK) |
| Demo readiness | 6/10 | Conveyor/GS10 path is deep and live; end-to-end "approve→ask→Why-MIRA" not yet wired |

---

## 20. Recommended Next PRs

Prioritized small, mergeable PRs; docs/model/UX alignment first, risky expansion later.

1. **docs(product): land this PRD + alignment audit** — *FactoryLM+MIRA.* Files: `docs/product/factorylm-maintenance-context-platform-and-mira-agent-prd.md`. Why: shared direction + naming law. AC: reviewed/approved; cross-linked from `THEORY_OF_OPERATIONS.md`. Tests: n/a (doc).
2. **fix(ignition): fence/gate the Perspective write surface** — *FactoryLM/Ignition.* Files: `ignition/project/.../views/{SpeedControl,FaultLog}/resource.json`, `docs/mira-ignition-secure-architecture.md`. Why: closes the read-only anti-goal violation. AC: no `system.tag.writeBlocking` ships in a customer surface (moved to bench project or feature-flagged + two-step-approved). Tests: read-only audit grep in CI.
3. **feat(mira): "Why MIRA Thinks This" panel (surface decision_traces)** — *MIRA.* Files: `mira-bots/shared/decision_trace.py` (read API), `mira-hub` panel + `AssetChat`. Why: trust + challengeability; data already persisted. AC: every answer renders evidence + decision path + confidence + missing-context + feedback. Tests: render from a real `decision_traces` row; screenshot (desktop+mobile).
4. **feat(factorylm): close the upload→retrieval gap → beta gate green** — *both.* Files: `mira-core/mira-ingest`, `mira-crawler/ingest`, `manual-rag.ts`, `tests/beta/*`. Why: the actual beta blocker. AC: `beta_ready_upload_retrieval_citation.py` passes (un-xfail). Tests: that gate + retrieval unit tests; respect hybrid tenant law.
5. **feat(factorylm): actionable asset-readiness checklist (L0–L6)** — *FactoryLM.* Files: `lib/health-score.ts`, `api/readiness`, new checklist UI. Why: makes maturity actionable. AC: each asset shows concrete next steps with deep links. Tests: level-transition unit tests; screenshot.
6. **feat(mira): asset-agent deployment gate resolver (`asset_id→uns_path`)** — *both.* Files: `mira-pipeline/ignition_chat.py`, `asset_agent_transition.py`, resolver. Why: makes `ENFORCE_ASSET_AGENT_GATE` real. AC: unapproved asset → refusal message; approved → answers. Tests: gate decision unit tests.
7. **feat(factorylm): ContextPackage compiler** — *FactoryLM.* Files: new model + compiler reading `installed_component_instances`/`knowledge_entries`/`kg_relationships`. Why: a single trusted bundle per asset. AC: compile + read-back for the conveyor asset. Tests: round-trip; staging migration dry-run; correct tenant-id family.
8. **feat(factorylm): source-authority ranking** — *FactoryLM.* Files: `neon_recall.py`, ranking config. Why: OEM manual > technician note > forum. AC: retrieval orders by authority×confidence; documented bands. Tests: ordering unit tests.
9. **feat(factorylm): parser→Hub tag-import CSV wizard** — *FactoryLM.* Files: `mira-plc-parser` output adapter, Hub importer, proposals. Why: turns parsed tags into reviewable proposals. AC: upload CSV/L5X → tag proposals in queue. Tests: importer unit tests; screenshot.
10. **feat(both): consolidate TechnicianFeedback** — *both.* Files: new feedback model unifying `feedback_log`/`technician_confirmed`/`reviewer_verdict`; "missing context" verb in UI. Why: one feedback truth set. AC: correct/wrong/missing-context captured uniformly. Tests: write-path round-trip.

---

## 21. Final Summary

**What FactoryLM already has:** an asset-first Hub (assets, onboarding wizard, namespace builder), an L0–L6 readiness model, a proposal/approval queue with no-auto-verify discipline, a read-only PLC parser with a vendor-neutral IR + deterministic analysis, a per-asset tag-map config carrying `source`/`confidence` provenance, a GS10 VFD analyzer with A0–A12 anomaly rules, an in-gateway anomaly engine, a tag-streaming relay with freshness + quality columns, a knowledge graph with proposals/evidence/approval-state, UNS path builders + resolver, document chunking with page anchors, and an Atlas CMMS client.

**What MIRA already has:** grounded answer generation, citation compliance, a UNS confirmation gate with a direct-connection carve-out, KB-gap admission + no-guess fallback, telemetry-freshness awareness (`[STALE]`), confidence levels (heuristic), a feedback log, and a durable per-turn decision-trace audit log.

**What is missing:** a user-facing "Why MIRA Thinks This" (the trace is backend-only); a closed upload→retrieval loop (beta gate is RED); a functional asset-agent deployment gate (no `asset_id→uns_path` resolver); a first-class ContextPackage; source-authority ranking; an actionable readiness checklist; work-order history mining; CMMS↔UNS sync and manual→site-instance binding; an automated freshness sweep; and a consolidated technician-feedback store.

**What should change immediately:** (1) fence/gate the customer-shipped Perspective **write-to-VFD** surface — it violates the read-only anti-goal; (2) surface decision traces as "Why MIRA Thinks This"; (3) close the upload→retrieval gap to turn the beta gate green; (4) ship the deployment-gate resolver so MIRA cannot answer for unapproved assets.

**What should not be built yet:** Sparkplug ingestion, PDF-OCR parsing, push-to-i3X, multi-asset/line reasoning, marketplace/module packaging, and a generic AI canvas. Prove **one asset** end-to-end first.

**What the new Northstar should be called:**
> **FactoryLM — the self-serve industrial maintenance context platform. MIRA — the Maintenance Intelligence Resource Agent powered by FactoryLM.**
> FactoryLM turns messy industrial maintenance data into trusted, asset-bound, agent-ready context. MIRA uses that approved context to answer, explain, and guide — one asset at a time.

---

### Constraints honored in this document
- No product code implemented (research/audit/strategy/planning only).
- Every "exists" claim is path-anchored; insufficient evidence marked **UNKNOWN** (e.g., `cmms_equipment`/`work_orders` CREATE location, WebDev module install status, i3X service).
- FactoryLM (platform) vs MIRA (agent) distinction maintained throughout.
