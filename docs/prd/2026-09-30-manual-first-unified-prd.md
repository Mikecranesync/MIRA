# Manual-First MIRA — Unified PRD

**Version:** 1.0 Unified  
**Date:** 2026-09-30  
**Owner:** Mike Harper  
**Status:** Ready for Peer Consensus

---

## Executive Summary

The SMC valve incident (staging, 2026-09-30 21:22 UTC, trace 3d9273032) revealed a fixable gap: MIRA correctly read the equipment label via vision but declined to search for its manual. This PRD unifies three strategic lenses (Product/MVP, Governance/Safety, Platform/Speed) into a single roadmap with explicit design decisions.

**The bet:** Photo-read identities should trigger read-only manual discovery immediately. Ingested manuals are evidence-tracked and never auto-bind identity. Identity confirmation remains the technician's choice. This honors all existing governance while delivering the Manual-First experience Mike has described.

**Timeline:** Phase 1 (prefetch + honest reporting) in ~1 week; Phase 2 (OEM corpus bootstrap) in ~2 weeks; Phase 3 (continuous crawler) in ~2 weeks. MVP acceptance: SMC valve scenario produces a manual-grounded answer with citations by end of Phase 1+2.

---

## 1. Problem Statement

### The Incident (Staging, 2026-09-30 21:22 UTC)

**What the technician did:**
- Photographed a pneumatic solenoid valve.
- Label clearly read: "SMC" + "SS5Y3-DUW01302".
- Asked MIRA: *"Can you find the user manual for this valve?"*

**What MIRA did:**
- LOOK vision (Together MiniMax-M3, 6.2s latency) correctly extracted "SMC" + "SS5Y3-DUW01302".
- Chat route checked identity confirmation: `identity.resolve` returned `state=unknown, unresolved_reason=not_bound`.
- Manual acquisition skipped: `retrieval.strategy=skipped_general_mode, oem_corpus_searched=false`.
- Answer: *"I don't have a manual for that valve. Contact SMC directly."* (0 citations).

**The defect:**
The technician is asking for a thing MIRA has infrastructure to deliver. Photo-read identity is proposed, not verified, but that should not prevent a **read-only** search attempt. Instead, the flow treated lack of confirmation as a reason to not try.

### Root Causes (origin/main 356b0f305)

| Cause | File:Line | Why It Matters |
|-------|-----------|----------------|
| **RC1: Manufacturer recognition is corpus-circular** | manual-rag.ts:354–398 | `corpusManufacturers()` queries `knowledge_entries` to build the allowlist. If SMC has 0 rows (`is_private=false`), the manufacturer cannot be matched. Staging had no SMC manuals because #4115 (merged 2026-09-30) added SMC to sources.yaml but the crawler hasn't populated staging yet. |
| **RC2: Photo-read identity never triggers acquisition** | chat/route.ts:1991–1992 | Acquisition gate: `oemManufacturer.source==='notebook' && oemModel.source==='notebook'`. Only confirmed notebook identity starts the search. Photo-read observation is never bound to notebook (per #4120's doctrine and #3440 UNS gates). Result: proposed identity triggers nothing. |
| **RC3: No generic part/catalog number extractor** | manual-rag.ts:260–275 | `resolveModelFromObservationText` handles vendor-specific regex patterns only. Catalog numbers like "SS5Y3-DUW01302" are extracted by vision but not matched against any index. |
| **RC4: Feature flags unset** | CAPABILITY_CLOSURE | `MIRA_NOTEBOOK_MANUAL_ACQUISITION` deployed_disabled (create-time trigger fires for eval harnesses). `MANUAL_JUDGE_ENABLED` unset in prod. `NAMEPLATE_DETECT_ENABLED` unset. `MIRA_MANUAL_SENSE_WEB_ENABLED` unset in staging and prod. |

### The Core Problem

MIRA defaults to "don't guess wrong," which operationally means "don't try when unsure." This is a safe default, but it inverts the technician's expectation: holding equipment with a readable label, they expect MIRA to attempt a search, not an apology.

---

## 2. Vision: The Manual-First Rule

> **When a technician provides any identifier—photo, part number, or confirmed asset context—MIRA attempts to find and ingest its official documentation before apologizing it doesn't know.**

This is not "try and hallucinate." It is: attempt a **deterministic, read-only search** via Serper + OEM domain allowlist. If a direct PDF is found, ingest it immutably and immediately cite it. If not found, admit it plainly.

Photo-read identity remains a **candidate** (not confirmed), but candidates warrant an attempt.

---

## 3. Goals & Non-Goals

### Goals

1. **No manual is silent.** Every identifier (photo, part number, confirmed asset) triggers a search.
2. **Identity stays proposed.** Photo discovery does NOT bind identity to notebook; tech confirms before MIRA grounds answers.
3. **Honest in-flight reporting.** Technician knows whether discovery is in progress, found a candidate, found a ready manual, or failed (with a mfr link).
4. **Corpus-independent identity extraction.** Manufacturer recognition no longer depends on what's already in the OEM corpus; uses OEM domain allowlist + regex.
5. **Evidence-first architecture.** Every discovery is materialized as durable, audit-traced, evidence keyed on content hash + version.
6. **MVP validation.** SMC valve case (photo → manual → cited answer) works end-to-end on staging by end of Phase 1+2.
7. **Continuous scaling.** Shared OEM library grows via crawler worker + demand-driven queueing, not per-request.

### Non-Goals (P2+ or out-of-scope)

- Replace the notebook as source of truth for asset identity (notebook binding is primary; photos are fast-path).
- Structured component profiles from manuals (section-aware chunking is P4).
- Reverse-image search or CAD matching (label-text extraction only).
- PLC firmware / configuration / software manuals (equipment user manuals only).
- Write-side automation (manual binding must be explicit technician action).
- Cross-tenant corpus pooling before Phase 3 (P3 gates per-tenant `is_private=true` → shared with approval).

---

## 4. Design Decisions (Lens Synthesis)

This section resolves the three lenses' conflicts explicitly.

### Decision 1: Photo Observation Triggers Read-Only Discovery Immediately

**Lens tension:**
- **Draft 1 (Product):** Photo observation is "valid trigger" for search; don't block on confirmation.
- **Draft 2 (Governance):** Proposed-identity trigger must be read-only and evidence-tracked; no binding.
- **Draft 3 (Platform):** Prefetch in parallel; stream status; never block chat.

**Resolution:** **All three are honored together.** Photo observation starts a **background, read-only** discovery job (no blocking; not awaited). Identity remains proposed and unbound. Ingestion is immutable, durable, and tenant-scoped (`is_private=true`). This satisfies Draft 1's "attempt search," Draft 2's "read-only + evidence," and Draft 3's "prefetch + honest state."

**Implementation:** chat/route.ts detects LOOK observation metadata → starts acquisition job (detached, <100ms overhead) → emits SSE status on each turn.

---

### Decision 2: Bootstrap OEM Corpus via Curated sources.yaml + ManufacturerCrawler

**Lens tension:**
- **Draft 1 (Product):** Serper + OEM domain allowlist solves corpus-circularity for discovery.
- **Draft 2 (Governance):** Shared promotion must go through ManufacturerCrawler (deterministic, auditable, verified=true).
- **Draft 3 (Platform):** Corpus-independent extraction (allowlist) + continuous crawler = no corpus-circular trap.

**Resolution:** **Two-stage:**
1. **Discovery stage (P1):** Serper + OEM domain allowlist (corpus-independent), no corpus query.
2. **Shared promotion stage (P2):** Discovered manuals promoted to shared OEM pool **only** via re-acquisition through sources.yaml + ManufacturerCrawler (deterministic, verified=true, `is_private=false`).

This decouples discovery (Serper-backed, fast, corpus-independent) from shared promotion (crawler-backed, slow, governance-auditable). Phase 1 staging walk validates discovery on unshared corpus; Phase 2 bootstrap makes discovered manuals shared and citable in prod.

---

### Decision 3: Instrument Every Stage Independently

**Lens tension:**
- **Draft 1 (Product):** Focus on MVP acceptance (SMC case works).
- **Draft 2 (Governance):** Evidence-trace every discovery (ManualSearchTrace, materialized-evidence).
- **Draft 3 (Platform):** Instrument latency, cost, cache hit rate per stage (Flight Recorder).

**Resolution:** **All three embedded.** Flight Recorder spans for each stage (discovery_latency_ms, download_latency_ms, ingest_latency_ms, applicability_verdict, cached_hit_yes_no). ManualSearchTrace materialized-evidence record captures manufacturer, model, search_provider, results_count, selected_url, content_hash, timestamp. Cost tracked per stage. Acceptance gate: SMC case latency <5s, cache hit rate >70% by Phase 3, discovery success rate >80%.

---

### Decision 4: Proposed-Identity Confirmation Is Technician's Choice, Not Automatic

**Lens tension:**
- **Draft 1 (Product):** "Photo triggers discovery" could imply auto-binding after discovery.
- **Draft 2 (Governance):** "Identity stays proposed" → must explicitly confirm before grounding answers.
- **Draft 3 (Platform):** Prefetch allows chat to proceed; confirmation is follow-up.

**Resolution:** **Photo discovery prefetches; confirmation is a separate, explicit technician action.**
- Photo observation triggers discovery (background).
- Chat reports discovery state via SSE or message interim.
- If manual found, chat proposes identity: *"I found a manual for SMC SS5Y3-DUW01302. Is this the asset you're asking about?"* with confirm/correct buttons.
- Technician must explicitly confirm (or correct) before MIRA grounds answers in the manual.
- Confirmation (or notebook binding) updates chunks with equipment_id + rescopes retrieval.

This honors Draft 2's "propose-never-bind" governance while letting Draft 1's MVP work and Draft 3's parallel prefetch shine.

---

### Decision 5: Part-Number-Only Discovery (ADR-0036 PARTIALLY ACCEPTED)

**Lens tension:**
- **Draft 1 (Product):** Extend to handle part numbers (catalog numbers, SKUs).
- **Draft 2 (Governance):** Only trusted OEM sources (allowlist + content-hash).
- **Draft 3 (Platform):** Serper + allowlist = two-stage gate; defers scanned PDFs to queue.

**Resolution:** **Part-number discovery is in-scope IF both gates pass: (1) Serper trust (URL must be OEM host per allowlist), (2) content-hash dedup (no duplicate vendor revisions).** Forum posts, YouTube, patents, and scanned PDFs (high false-positive risk) queue for manual review in Phase 4. Phase 1 focuses on structured data (model numbers from vision + OEM domains).

---

## 5. Requirements (Numbered, Testable)

### Phase 1: Prefetch + Honest Reporting

**R1.** When LOOK observation supplies manufacturer + model/part-number with ≥70% confidence, immediately invoke `acquireManualForIdentity()` in background (detached, no await).

**R2.** Photo-read identity does NOT update notebook identity state; remains proposed (`equipment_id=null`).

**R3.** Manual search uses **corpus-independent** OEM domain allowlist (not corpus query). Serper + ≥3 OEM domains per manufacturer in parallel; 5-second timeout per domain; part-number-first strategy.

**R4.** Each turn emits Flight Recorder spans: `discovery_latency_ms`, `download_latency_ms`, `ingest_latency_ms`, `applicability_verdict` (candidate/verified/rejected), `cached_hit_yes_no`.

**R5.** ManualSearchTrace materialized-evidence: { `id`, `tenant_id`, `notebook_id`, `observation_text`, `manufacturer_proposed`, `model_proposed`, `search_provider`, `results_count`, `selected_url`, `content_hash`, `search_timestamp` }.

**R6.** Ingested PDFs: SSRF-guarded, content-hash deduped, ≤20MB, stored as `{ is_private: true, tenant_id: $caller, verified: null, metadata: { source: "photo_trigger" } }` in notebook workspace node.

**R7.** Chunks immediately queryable via BM25 (content_tsv populated; embedding trailing).

**R8.** In-flight status streamed via SSE or interim chat messages: "Searching…" → "Found candidate…" → "Ready" or "Not found".

**R9.** Applicability judgment deferred if vendor unknown; run on first retrieval (not at ingest).

**R10.** No regressions on notebook-confirmed flow (#4118); flag `MIRA_MANUAL_DISCOVERY_ENABLED` toggleable without breakage.

### Phase 2: OEM Corpus Bootstrap

**R11.** Seed manuals: SMC, Siemens, Leuze, Balluff, Banner, Bosch, Eaton, Parker, Omron (≥50 per vendor, direct PDFs). Dedup by content hash. Stored as `{ is_private: false, verified: true, tenant_id: MIRA_SHARED_TENANT_ID }`.

**R12.** Part-number extractor: 8–20 char alphanumeric → Serper + allowlist validation (OEM host only).

**R13.** Metrics baseline: `manual_discovery.success_rate`, `ingest_cost_per_manual`, `retrieval_latency_p50`.

### Phase 3: Continuous Growth

**R14.** Crawler worker runs continuously, consuming `manual_queue.json` every 60s. Discovered manuals ingest as `is_private: false, verified: true` if sourced from OEM allowlist host.

**R15.** Demand-driven queue: failed Serper searches → queue for overnight crawler refresh. Cache hit rate SLO ≥70%.

**R16.** Confirmation flow: photo surface emits proposal with `{ identity_candidates, manual_doc_id }`. Technician confirms ("Yes, SMC SS5Y3") or corrects. On confirm: bind identity to notebook, update chunks with equipment_id, re-index BM25.

### Phase 4: Structured Knowledge (Post-MVP)

**R17.** Scanned PDFs: OCR via Docling; cost <$0.15 per manual; quality gate (first-page OCR ≥0.8). Deferred to candidate queue until Phase 4.

**R18.** Section-aware chunker: extract "Wiring Diagram," "Specifications," "Troubleshooting" as searchable subtopics.

**R19.** Component profiles extracted from manual structure (parts lists, pinouts, fault modes, settings).

---

## 6. Phased Delivery

| Phase | Duration | Blocker | Owner | Acceptance |
|-------|----------|---------|-------|-----------|
| **P1: Prefetch + Governance** | 1 week | None | Backend eng + observability | SMC scenario: photo → discovery triggered, status streamed, identity unbound. Zero regressions on #4118. |
| **P2: Bootstrap OEM Corpus** | 2 weeks | sources.yaml curator sign-off | Data eng + Ops | 100+ manuals/vendor (SMC, Siemens, Leuze, etc.). Query("smc ss5y3") returns ≥3 results. Manual ingest <8s, >80% success. |
| **P3: Continuous Growth** | 2 weeks | Crawler worker in staging compose | Platform + Data eng | Crawler nightly, zero errors. ≥10 new manuals/week via demand queue. Cache hit rate ≥70%. Confirmation flow UI + acceptance testing. |
| **P4: Structured + Scanned** | 4–6 weeks (post-MVP) | OCR cost validation, human-readiness eval | Knowledge eng | Scanned PDFs ingested and citable. Component profiles auto-extracted. Safety judge ≥90% accuracy. |

**Critical path:** P1 → P2 → P3 (MVP achievable after P2). P4 post-launch.

---

## 7. Success Metrics & Baselines

| Metric | Today | Target (End P1+P2) | Measurement |
|--------|-------|-------------------|-------------|
| **Photo-to-citable latency** | ∞ (no attempt) | <5s p50 | Flight Recorder span: observation_text → manual_ready |
| **Manual discovery success rate** | ~0% (RC2 block) | ≥80% | found_manual / search_attempted in logs |
| **Manual-grounded answer rate** | ~5% (corpus-limited) | ≥60% (P2+) → ≥80% (P3+) | BM25 hit + citation_count in decision_traces |
| **OEM corpus coverage** | 83.5k chunks, no SMC/Leuze/pneumatics | ≥100 unique manuals (9 vendors, ≥50 ea) | count distinct knowledge_entries (verified=true, is_private=false) |
| **Photo accuracy** | N/A (never attempted) | ≥95% correct mfr + model | human spot-check on 50 photos |
| **Honest refusal rate** | 100% (silent fail) | ≥90% (manual not found → clear admission) | admission_of_ignorance / manual_search_completed |
| **Cache hit rate** | 0% | ≥70% | serper_skipped / search_initiated |
| **Search cost** | $0 (no search) | ≤$0.05 per acquisition | serper_tokens * RATE / acquired_manuals |
| **Regressions** | 0 | 0 | 100% pass on #4118 manual-acquisition suite |

---

## 8. Governance Amendments

### ADR-0036: Part-Number Discovery

**Status:** PARTIALLY ACCEPTED (this PRD).

Part-number-only discovery (catalog numbers, SKUs) is in-scope IF:
1. Serper confirms OEM host match (allowlist).
2. Content-hash dedup confirms not a duplicate vendor revision.

Forums, YouTube, patents, and scanned PDFs defer to candidate queue (Phase 4).

### knowledge_entries Tenant Scoping

Proposed-identity ingests land as:
```
{ is_private: true, tenant_id: $caller, verified: null, metadata: { source: "photo_trigger" } }
```

On technician confirmation: update to `verified: true` (OEM) or `verified: false` (candidate).

Shared promotion (Phase 3): per-tenant → shared via crawler re-acquisition → `{ is_private: false, verified: true, tenant_id: MIRA_SHARED_TENANT_ID }`.

### Train-Before-Deploy Carve-Out

Manual discovery on proposed unconfirmed identity does NOT violate train-before-deploy:
1. Discovery is **read-only** (no control writes, no identity binding).
2. Ingested as **private + candidate** (not immediately trusted).
3. **Confirmation is explicit** (technician must approve before MIRA grounds answers).
4. **Governance gates remain** (UNS confirmation gate for other flows; attestation on manual applicability).

### Zero-Token Architecture

- Judgment runs **once per unique manual** (content hash); cached on version record.
- Cost recorded per ingest; recall is zero-token (cache hit).
- Budget declared upfront: Serper $0.50/1000 calls, LLM judge $0.002/turn, ingest $0.05/manual.

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **OEM domain list incomplete; vendor not found** | Feature fails for unindexed vendors | Start with high-volume (SMC, Siemens, Leuze); expand monthly; fallback Serper generic search (Phase 3+). |
| **PDF quality low (scans, truncations, >300 pages)** | Citation looks right but advice wrong | #4147 + #4083 fixes pre-P1. PDF quality gate: OCR ≥0.8 on first page. Scanned PDFs queue to Phase 4. |
| **Serper quota exhaustion** | Feature becomes expensive | Monitor daily; alert at 70%; rate-limit 5 searches/tenant/day. |
| **Corpus-circular trap repeats** | Manufacturer not in corpus → rejected | Decouple extraction from corpus (allowlist + regex, not corpus query). Phase 2 bootstrap proves pattern. |
| **Identity binding carve-out mis-applied** | Photo auto-binds identity (violates #4120) | Confirmation gate: technician must explicitly confirm. Test: equipment_id=null before confirm. |
| **Staging crawler disabled** | Corpus doesn't bootstrap | One-off seed script (kb_growth_cron.py template); deploy crawler worker before Phase 3. |
| **Safety tripwire misfires** | Legitimate industrial docs blocked | Defer judgment if vendor unknown; test on real corpus in P2 acceptance. |
| **False positives from part-number extraction** | Non-manuals ingested as valid | 8+ char minimum; allowlist match; human spot-check ≥20 in P1 acceptance. |

---

## 10. Owner Decisions (Mike)

These decisions remain open for Mike to make, but each has a recommendation.

1. **Photo confidence threshold:** ≥70% or ≥85%? (Rec: start ≥70%; lower in P2 after baseline.)

2. **Serper rate limit:** 5 searches/tenant/day, or pay-per-use? (Rec: 5/day P1+P2; unlimited after Phase 3 cost tracking shows <$100/mo.)

3. **Honest refusal copy:** Link to SMC support, or just admit ignorance? (Rec: link mfr support; deflates "I'll call them directly" and improves UX.)

4. **Auto-bind on discovery:** Should finding a manual auto-confirm identity in notebook, or keep it proposed? (Rec: keep proposed; confirmation is explicit. Auto-bind risks #4120 violation.)

5. **Shared corpus timeline:** When does per-tenant `is_private=true` graduate to shared? (Rec: only via crawler re-acquisition through sources.yaml. Never auto-promote. Phase 3 approval gate required.)

6. **Production rollout:** Soft-launch after P2+P3 (P4 post-launch ops), or wait for full Phase 4? (Rec: soft-launch after P2+P3; Phase 4 is post-launch refinement.)

7. **Staging crawler:** Is enabling it P2 or P3? (Rec: P2 end / P3 start; critical path blocker for bootstrap.)

---

## 11. What Is NOT Changing

- Notebook as primary source of truth for asset identity (photos remain fast-path only).
- UNS confirmation gate for chat surfaces (direct connections unchanged per #4120).
- Approved retrieval enforcement in production (`approvedRetrievalEnforced=true` unchanged).
- Existing manual-acquisition.ts, notebook state machine, or ingestion pipelines (reuse all).
- "Propose, never bind" governance on vision-read identities.
- Component profile feature (P4 post-MVP, not MVP-blocking).

---

## 12. Definition of Done (MVP: End of Phase 1+2)

- [ ] **RC1 (corpus-circularity) fixed:** OEM domain allowlist separates identity extraction from corpus. manufacturerFromObservationText no longer queries knowledge_entries.
- [ ] **RC2 (photo-ID not triggering) fixed:** Photo observation calls acquireManualForIdentity in background; no notebook confirmation gate.
- [ ] **RC3 (no part-number extractor) addressed:** Part-number regex (8+ chars, alphanumeric) implemented; Serper validates OEM host.
- [ ] **RC4 (flags) addressed:** MIRA_MANUAL_DISCOVERY_ENABLED deployed and toggleable.
- [ ] **SMC valve end-to-end:** Photo → manual found → answer cited on staging.
- [ ] **Honest refusal:** Manual not found → MIRA admits it + mfr link.
- [ ] **No regressions:** #4118 notebook flow still works; 100% pass rate on notebook-manual-acquisition tests.
- [ ] **Governance honored:** Identity stays proposed (equipment_id=null before confirm); evidence-traced (ManualSearchTrace); tenant-scoped (is_private=true).
- [ ] **Acceptance testing:** ≥3 OEM vendors tested in staging; photo accuracy ≥95%; discovery success ≥80%; latency <5s p50.
- [ ] **Deployment ready:** Feature-flagged, flag toggleable without breakage.

---

## 13. References & Linked Work

**Merged PRs (do not re-propose):**
- #4117 (SMC regional hosts, OEM domain allowlist foundation)
- #4118 (atomic manual-acquisition claim, state machine fixes)
- #4120 (identity confirmation doctrine)
- #4115 (SMC + Eaton sources.yaml entries)

**Open PRs (fold into phases):**
- #4150 (part-number-only discovery, explicit request) → Phase 1 optional
- #3999 (LOOK prompt tuning) → Phase 1 baseline

**Open Issues:**
- #4075 (human-readiness pilot, SMC acceptance scenario)
- #4102 (human-readiness eval for judge enablement)
- #4148, #4151, #4147, #4083, #4080 (KB quality track post-MVP)

**Trace:** 3d9273032bade36018e24c1d5c6e84de, staging 2026-09-30 21:22 UTC

**Governance docs:**
- `.claude/rules/train-before-deploy.md`
- `.claude/rules/knowledge-entries-tenant-scoping.md`
- `.claude/rules/materialized-evidence.md`
- `.claude/rules/oem-crawler-trusted.md`
- `.claude/rules/zero-token-architecture.md`

**Design & plans:**
- `docs/plans/2026-08-10-chat-with-any-manual-design.md`
- `docs/specs/manual-acquisition-spec.md` (existing)
- CAPABILITY_CLOSURE (manual-acquisition flags)

---

## Summary: The Bet

**Thesis:** A technician holding equipment with a readable label should attempt manual discovery before apologizing. Photo-read identity is imperfect, but imperfection is not a reason to not try—it is a reason to confirm before grounding.

**MVP outcome (P1+P2):** Technician photographs SMC valve → manual found in <5s → manual-grounded answer with page citation. Manual ingest is immutable, tenant-scoped, evidence-tracked. Identity stays proposed until confirmed. One case working reliably proves the model.

**Scale outcome (P3+):** OEM corpus grows continuously via crawler worker. Shared library expands to 9+ vendors. Cache hit rate ≥70%. Technician satisfaction +15–20 points. Support volume for "I need manual for X" → near zero.

**P4+ outcome:** Scanned PDFs and component profiles unlock structured knowledge. Same answering engine powers Slack, Telegram, Ignition, and Hub.

---

**Next:** Peer consensus (call 3 reviewers). Then:
1. Phase 1 implementation (backend: prefetch + observability; FE: SSE + identity proposal UI)
2. Phase 2 bootstrap (curator: sources.yaml expansion; data eng: seed script)
3. Phase 3 continuous (platform: crawler worker; ops: stage integration)
