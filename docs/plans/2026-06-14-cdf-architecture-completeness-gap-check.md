# CDF Architecture vs. MIRA — "Are We Missing Anything?" Completeness Check

**Status:** ARCHITECTURE REVIEW + GAP PLAN — planning only, no production code
**Authored:** 2026-06-14
**Owner:** Mike Harper
**Trigger:** Cognite video *"Cognite Data Fusion® Architecture walkthrough with Cognite CTO Geir Engdahl"* (Cognite, ~5 min). A CTO-level tour of the full CDF platform stack. Goal here: lay CDF's architecture next to MIRA's and confirm we have an answer — build, defer, or deliberately skip — for **every** layer.
**Companion docs:** `docs/plans/2026-06-14-cognite-contextualization-replication-plan.md` (the matcher gap, in depth) → `docs/plans/2026-06-01-mira-master-architecture-plan.md` → `docs/THEORY_OF_OPERATIONS.md` → `docs/specs/uns-kg-unification-spec.md`

---

## 0. How to read this + honesty note

This is a **completeness audit**, not a feature-copy plan. The previous doc covered the one capability you flagged (document→tag matching). This one zooms out to the **whole platform** the CTO walks through and asks: *does MIRA have a deliberate answer for each architectural layer, or is something silently missing?*

**Sourcing honesty:** like the first video, this one's transcript is gated — captions exist but YouTube now blocks the raw caption/transcript fetch, and the in-page transcript panel never finished loading. So this is **not** a line-by-line of the spoken words. It's grounded in Cognite's *public architecture documentation* (which is exactly what a CTO architecture walkthrough covers) plus MIRA's own repo map and specs. The video's own description confirms the scope: CDF "is what is backing all the industrial applications… all about making previously siloed data easily available and understandable." Sources at the bottom.

**Verdict legend:** ✅ have · ⚠️ partial · 🔲 missing · 🟦 deliberate skip (out of MVP scope, by design)

---

## 1. The CDF architecture stack (what the CTO walks through)

Cognite Data Fusion is a cloud DataOps platform whose pipeline has three named stages — **integration → transformation → contextualization** — wrapped by storage, governance, an API/SDK layer, and the application layer on top. Laid out as layers, bottom to top:

1. **Source systems** — historians (e.g. PI), SAP/maintenance, file shares, IoT/SCADA, 3D/CAD, simulators.
2. **Extractors & connectors** — push data to CDF with minimal logic; prebuilt + custom (Python/.NET); some bidirectional.
3. **Extraction-pipeline monitoring** — register/configure/monitor pipelines with automatic failure notifications.
4. **RAW (staging)** — schemaless landing tables; land raw, transform later.
5. **Transformations** — SQL, run/re-run in the cloud to reshape & enrich RAW → the data model.
6. **Data model / typed resources** — assets, time series, events, files, sequences, 3D, relationships; plus flexible Data Modeling (DMS / GraphQL) → an industrial **knowledge graph**.
7. **Contextualization** — entity matching, P&ID/diagram parsing, document extraction; ML + rules + domain expert.
8. **Data governance** — data sets, access control (groups/capabilities, OIDC/Entra ID), data lineage.
9. **Compute** — serverless Functions, data apps.
10. **Open API + SDKs** — REST + Python/JS/.NET.
11. **Application layer** — web-app workspaces + industrial tools (InField, Maintain, Charts) + Atlas AI agents + partner apps.
12. **Cross-cutting** — security, multi-cloud, observability.

## 2. MIRA mapped to every CDF layer (the completeness matrix)

| # | CDF layer | What it does | MIRA equivalent (where) | Verdict |
|---|---|---|---|---|
| 1 | Source systems | Connect the plant's data silos | Ignition (PLC/tags), MQTT/Sparkplug, manuals/PDF/photos, CMMS work orders, Google Drive | ✅ for MIRA's target sources |
| 2 | Extractors & connectors | Pull/stream data in | `mira-crawler/ingest/`, `mira-core/mira-ingest/`, MiraDrop watcher, Ignition module, `mira-relay`, `tools/` Drive ingest | ✅ docs/tags/CMMS · 🟦 no SAP/ERP/historian extractor |
| 3 | Pipeline monitoring + alerting | Pipeline health, failure notifications | `mira-ops` (Prometheus/Grafana/Flower) for services; **per-source ingest health/alerting thin** | ⚠️ **gap G2** |
| 4 | RAW staging | Schemaless land-now-transform-later | None — ingest writes straight to KB/NeonDB with UNS tags | 🔲 **gap G1** |
| 5 | Transformations | Re-runnable in-cloud reshape/enrich | Extraction+normalize happen **at ingest** in `mira-crawler/ingest`; no separate replayable transform | ⚠️ **gap G1** |
| 6 | Data model + KG | Typed resources → knowledge graph | UNS (ltree) + `kg_entities`/`kg_relationships` + component profiles + CMMS (events/PM) + manuals (files) + live tags (time series via Ignition) | ✅ core · 🟦 no 3D/sequences · 🟦 Postgres-first (no GraphQL DMS until Phase 13) |
| 7 | Contextualization | Match entities, parse diagrams, extract docs | Doc extraction ✅; entity matching 🔲→planned; diagram parsing 🔲→planned (see companion doc) | ⚠️ **gap G3 (already planned)** |
| 8 | Data governance | Data sets, access control, lineage | `tenant_id`, `auth-tenancy-spec`, API auth (bearer/JWT), Doppler, PII sanitization; evidence/page-refs give partial lineage | ⚠️ **gap G4** (no data-set grouping / lineage view) |
| 9 | Compute / functions | Serverless + data apps | Celery (Alpha), workers, `mira-bridge` Node-RED, `mira-pipeline` | ✅ functionally · 🟦 no user-deployable functions |
| 10 | API + SDK | REST + SDKs | `mira-mcp` (FastMCP, REST :8001), `mira-pipeline` (OpenAI-compat), `mira-web` | ✅ · 🟦 no published external SDK |
| 11 | Application layer | Workspaces + tools + agents | Slack/Telegram bots, Hub (feed/proposals/command center), Ask MIRA, Ignition Perspective panel, `mira-web` /cmms | ✅ strong |
| 12 | Security / observability / cloud | OIDC, monitoring, multi-cloud | `security-boundaries` (Doppler, PII, safety keywords), `mira-ops`, `agent_trace.py` (+ optional OTel/Phoenix), multi-node + VPS | ✅ · 🟦 single-cloud/VPS by design |

**Read of the matrix:** MIRA covers the **top of the stack** (data model, KG, API, apps, security) and the **bottom** (sources) well. The thin band is the **middle data-engineering plumbing** — staging, re-runnable transforms, pipeline observability, and resource-level governance — plus contextualization (already on the roadmap).

## 3. The real gaps (everything not marked 🟦)

Ordered by architectural leverage:

**G1 — No RAW staging / no replayable transform (biggest).**
CDF deliberately separates *land raw* → *transform in cloud* so it can **re-derive** the model when logic improves, without re-pulling from source. MIRA extracts **and** normalizes **and** UNS-tags in one ingest pass. Consequence: when you improve the chunker, the UNS resolver, or (critically) the new **matcher**, you must **re-ingest the source** to benefit — you can't just replay a transform over already-landed raw. This is the same architectural muscle the matcher's "rerun pipeline / learn from confirmations" needs (companion doc §7–8). Fixing G1 unlocks G3.

**G2 — Ingestion pipeline observability + failure alerting.**
`mira-ops` watches *services*; there's no first-class "this source's extraction is failing / stalled / producing low-confidence junk" health signal with notifications. For a self-serve PLG funnel where customers drop their own docs, silent ingest failure = silent churn.

**G3 — Contextualization (entity matching + diagram parsing).**
Confirmed as the right priority by this audit. Fully specced in `docs/plans/2026-06-14-cognite-contextualization-replication-plan.md`. No new work to define here — just flagging it's a genuine architectural layer, not a nice-to-have.

**G4 — Resource-level governance: data sets + lineage surfacing.**
MIRA has tenant isolation and stores evidence (source doc + page) on KG edges — so **lineage data exists** but isn't **surfaced** as "show me everything derived from this manual / this upload batch," and there's no "data set" boundary to scope, govern, or roll back a bad ingest. Matters for trust ("why did MIRA say that?") and for cleanup.

**G5 — Time-series as a stored, groundable resource (decide explicitly).**
CDF stores time series as a first-class resource. MIRA treats live tags as **live-only** through Ignition. Decision needed: does grounded troubleshooting need **persisted** tag snapshots/history (so an answer can cite "tag X trended up over the last hour"), or is live-read enough? Today this is an implicit skip; make it an explicit one.

## 4. Deliberate skips — write them down so they're decisions, not oversights

These are 🟦 *on purpose*; documenting them is the point of the audit (so nobody later "discovers" a gap that was a choice):

- **Historian / SAP / ERP extractors** — out of MVP scope; MIRA's sources are PLC-via-Ignition, docs, CMMS.
- **3D / CAD / sequences modeling** — not in the maintenance-copilot wedge.
- **Flexible GraphQL data modeling (DMS)** — Postgres-first/ltree by constraint; revisit only at master-plan Phase 13.
- **User-deployable serverless functions** — internal workers cover compute; no customer FaaS surface.
- **Published external SDK** — MCP + OpenAI-compat API is enough for now.
- **Multi-cloud** — single VPS + node cluster by design.

If any of these stops being true (e.g. a customer demands SAP work orders), it graduates from "skip" to a roadmap item — but that's a deliberate trigger, not a surprise.

## 5. The "are we missing anything?" checklist

Run this list; each item has a decision, not just a checkbox.

- [ ] **G1 Raw landing:** add a schemaless `ingest_raw` landing (source bytes/text + metadata + UNS hint) **before** normalization, so transforms/matching can replay without re-pulling. → *Build (high leverage; unblocks matcher rerun).*
- [ ] **G1 Replayable transform:** make chunk→UNS-tag→propose a transform that runs over `ingest_raw`, not only at upload. → *Build with G1.*
- [ ] **G2 Ingest health:** per-source/per-batch status (rows in, chunks out, avg confidence, failures) + a notification when a batch fails or lands low-confidence. → *Build (cheap, protects PLG funnel).*
- [ ] **G3 Entity matching:** per companion doc Phase 1–2. → *Build (in flight).*
- [ ] **G3 Diagram/P&ID parsing:** per companion doc Phase 5. → *Defer behind matcher.*
- [ ] **G4 Data sets:** introduce an upload-batch / data-set id on ingested rows + KG edges. → *Build (small, enables governance + rollback).*
- [ ] **G4 Lineage view:** Hub surface "everything derived from this source / this batch," reading existing evidence refs. → *Build after data sets.*
- [ ] **G5 Time-series persistence:** decide store-snapshots vs live-only; if store, define retention + how an answer cites it. → *Decide now, build only if needed.*
- [ ] **Confirm deliberate skips (§4)** still hold for the current customer pipeline. → *Review, don't build.*
- [ ] **Governance/access** at resource level (who can see which data set) — confirm `auth-tenancy-spec` covers it or note the delta. → *Review.*

## 6. Recommended sequencing

1. **G1 (raw landing + replayable transform)** — foundational; do it **with or just before** the matcher (companion doc Phase 1), because the matcher's "rerun & learn" design assumes replayable data.
2. **G2 (ingest health/alerting)** — small, high ROI for self-serve; slot alongside G1.
3. **G4 (data sets + lineage)** — the `data_set_id` rides along naturally once raw landing exists; lineage view after.
4. **G3 (matching, then diagrams)** — already planned; G1 makes it cleaner.
5. **G5 (time-series)** — decide explicitly; build only if grounded answers need persisted history.

Fold G1/G2/G4 into the **maintenance-namespace-builder** plan (`docs/plans/2026-05-15-…`) as a "data foundation hardening" sub-phase so the readiness-level surface and `/proposals` stay coherent.

## 7. Constraints to honor (unchanged)
- Postgres-first (NeonDB); no Neo4j/graph DB pre-Phase 13. Raw landing = a Postgres table, not a new datastore.
- No LangChain / TensorFlow / n8n. Transforms are SQL/Python, not a framework.
- Inference cascade Groq → Cerebras → Gemini; never Anthropic (PR #610).
- UNS compliance: paths only via `uns.py`; tokenize via `uns.slug()`.
- No auto-verify `proposed → verified`; raw/transform replay doesn't change the human-gate rule.
- Migrations + seeds dev → staging → prod; screenshot rule for Hub UI.

## 8. Open questions
1. **G1 scope:** land *raw bytes* (full re-OCR possible) or *raw-extracted text* (cheaper, but re-OCR needs re-pull)? Recommend raw-extracted text for v1, raw bytes for PDFs/diagrams only.
2. **G5:** is there a concrete troubleshooting answer today that *needs* persisted time-series, or is Ignition live-read sufficient for the MVP? This decides whether G5 is in or out.
3. **Data-set granularity:** per upload, per source system, or per customer "project"? Affects G4 + governance.
4. Do we treat **CMMS work orders** as a CDF-style "events" resource feeding the graph (so PM history grounds answers), or keep Atlas separate? (Leaning: feed it in — it's high-value grounding.)
5. Fold this into the namespace-builder plan, or keep as a standalone data-foundation hardening plan?

---

## Sources
- Cognite — *Data integration overview* (integration → transformation → contextualization; extractors, RAW, monitoring): https://docs.cognite.com/cdf/integration
- Cognite — *What is Cognite Data Fusion (CDF)?* (architecture course, data model): https://docs.cognite.com/cdf/learn/cdf_basics/
- Cognite — *Staging (CDF RAW)*: https://docs.cognite.com/cdf/integration/guides/extraction/raw_explorer/
- Cognite — *About contextualization* / *Match entities*: https://docs.cognite.com/cdf/integration/concepts/contextualization · https://docs.cognite.com/cdf/integration/guides/contextualization/match_entities/
- Cognite — *CDF product page*: https://www.cognite.com/en/product/cognite_data_fusion_industrial_dataops_platform
- Cognite — *CDF API reference*: https://api-docs.cognite.com/
- Source video: *Cognite Data Fusion® Architecture walkthrough with Cognite CTO Geir Engdahl*, YouTube `KIaUF5oV_uY` (captions present but transcript fetch gated — no verbatim transcript available)
- MIRA internal: `CLAUDE.md` (repo/container/node maps), `.claude/CLAUDE.md`, `docs/specs/uns-kg-unification-spec.md`, `docs/specs/knowledge-graph-spec.md`, `docs/plans/2026-06-14-cognite-contextualization-replication-plan.md`
