# FactoryLM / MIRA — North Star

> **Canonical strategy. Updated 2026-07-18.** This document states the infrastructure wedge — the
> context layer and grounded agent. The **first product wedge** (Phase 1) is **Drive Commander**, a
> read-only VFD troubleshooting tool, per issue #2577, PR #2504, and ADR-0025. This NORTH_STAR is
> the foundation that Drive Commander (and future services) are built on; read NORTH_STAR first to
> understand the product philosophy, then see **`docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`**
> for the first sellable motion. Earlier wedge framings (services-led "transformation firm",
> "Slack-first AI copilot", "signal difference engine", "Ignition module") are archived in
> `docs/product/`; see those files' superseded-by headers.
>
> **See also (2026-06-30):** the *engine* under this wedge is named in
> `docs/product/mira_difference_engine_offering.md` — "signal difference engine with a contextual
> supervisor" (find what changed → group into machine events → explain what they mean). A
> **sharpening of this wedge, not a new one**; the context layer is still the lead. However, this
> engine docs is now subordinate to the Drive Commander product execution; see ADR-0025 for
> prioritization.
>
> **See also (2026-07-18):** ADR-0028 defines **Vision Zero-Token Architecture** for Visual
> Technician, PrintSense, Drive Commander images, and the FactoryLM-owned model program. It is an
> inference-cost and IP strategy under this wedge, not a new product wedge.

---

## Current delivery coordination

[DELIVERY.md](DELIVERY.md) restates the current end goals, dated commitments and required cross-agent updates. Live acceptance remains in [#5232](https://github.com/Mikecranesync/MIRA/issues/5232); this strategy remains the long-term north star. Historical status below is not a current deployment or customer claim.

## The wedge — stated once

**FactoryLM is the maintenance-context layer that makes a factory's messy reality — PLC tags,
manuals, CMMS records, VFD registers, tribal knowledge, live telemetry — trustworthy enough for AI,
one asset at a time, human-approved, on top of *any* Unified Namespace. MIRA is the grounded agent
that *proves the context is real* by diagnosing with cited sources.**

The product is **the context**. The agent is the **proof**. We own the part everyone else assumes is
already done: turning mess into trusted, asset-bound, AI-ready context.

**Lead with the context platform, never with the copilot.** "AI maintenance copilot" is a crowded
category we lose on distribution. "The layer that makes any maintenance AI trustworthy on *your*
messy factory" is the empty chair. Infrastructure first, AI second — *never* lead with "AI CMMS."

> **The adapters stay.** "Lead with context, not copilot" is about the *pitch*, not the plumbing.
> Once context is trusted, MIRA the agent should reach techs wherever they already are — **Slack,
> Telegram, the Ignition "Ask MIRA" panel, QR-scan, web.** Adapters are valued consumption/distribution
> surfaces; the only rule is that **every adapter renders the same approved-context answer** (same
> citations, same score, same read-only guarantee). Context is the product; the surfaces are how the
> proof reaches people. Both are real.

> **One evidence shape per producer — "same answer" starts before the answer.** "Every adapter renders
> the same approved-context answer" is only true if every adapter is handed the *same evidence*. It is
> not enough for two transports to be individually correct: if they describe the same physical reading
> differently, the context layer has already forked, and no downstream discipline can re-join it.
>
> Worked example, closed 2026-07-30: the PLC laptop's Ignition Gateway emitted **two incompatible
> shapes for the same tag read**. The stream path (`gateway-scripts/tag-stream.py` → `mira-relay`)
> produced typed readings — values in their real Python type, quality **banded** to
> `good|bad|stale|uncertain`, allowlist **fail-closed**. The chat path (`api/chat/doPost.py` →
> `mira-pipeline/ignition_chat.py`) read the same tags separately and **stringified every value**,
> forwarded the **raw unbanded** Ignition quality, and applied its allowlist inside
> `except ImportError: pass` — **fail-open**. Same gateway, same instant, two truths: `value` was
> sometimes `48.5` and sometimes `"48.5"`; `quality` sometimes `good`, sometimes `Good_Unspecified`.
>
> The rule this establishes: **a producer has exactly one adapter, and transports are renderings over
> it.** `ignition/webdev/FactoryLM/api/tags/gateway_live_snapshot.py` is now the single Gateway live-snapshot
> adapter; both paths derive from `collector.build_reading()`, and a test asserts field-by-field that
> the chat rendering and the stream rendering agree. A third Ignition transport adds a *rendering*,
> never a second read. Read-only toward OT is enforced mechanically rather than by review: the adapter
> imports no Ignition runtime and reaches a tag only through injected reader callables.
>
> Cross-refs: `.claude/rules/one-pipeline-ingest.md` (the same law for ingest transports),
> `.claude/rules/direct-connection-uns-certified.md` (the surfaces this applies to),
> `.claude/rules/fieldbus-readonly.md` (why this adapter can never write).

---

## Why this wedge wins — the competitive map (validated 2026-06)

The market splits into two camps, and **neither owns the chair between them**:

| Camp | Examples | What they own | What they assume away |
|---|---|---|---|
| **Platforms / plumbing** | **Fuuz**, HighByte, Ignition, Litmus, Cognite (data layer) | UNS transport, ISA-95 hierarchy, MES/WMS/OEE, connectors | The maintenance *brain*. (Fuuz — ~43 ppl, bootstrapped — **deliberately does not build diagnostic AI**: "bring your own LLM via GraphQL.") |
| **Copilots** | **MaintainX**, OxMaint, Limble, AVEVA, C3, UptimeAI | Grounded RAG over manuals/work-orders | **The contextualization.** They answer *after* the factory is structured, or make the customer do it. |

**The empty chair is the contextualization layer** — and it's exactly where we planted the flag:
*"Walker shows what an agent can do **after** the factory is contextualized. FactoryLM is the product
that contextualizes the factory — self-serve, incrementally, one asset at a time."* The hidden
prerequisite of every flashy agent demo is a mature context layer. **We are that layer.**

- **vs. platforms (Fuuz et al.):** we are the maintenance brain that plugs into *their* UNS — theirs,
  Ignition's, HighByte's. We never rebuild their plumbing or write to a PLC. Integrate, don't out-platform.
- **vs. copilots (MaintainX et al.):** our moat is the **bundle** they each have only a piece of —
  *cited + self-scored + read-only/UNS-safe + works-on-your-mess.* The intersection is empty today.
  The window is **~12 months** before MaintainX-class incumbents add citations + scoring. Move now.
- **Our sharpest, least-contested knife:** per-answer, customer-visible **groundedness scoring** —
  we measure ourselves against ground truth. Only Cognite tells a benchmark story, and theirs is an
  annual PDF. Ours is live, per answer. (This is what SimLab is *for* — see "Decisions" below.)

---

## What we are NOT

- ❌ "An AI CMMS" / a bolt-on chatbot / a generic copilot. (Crowded; we lose on distribution.)
- ❌ A platform that replaces Ignition, Fuuz, the historian, the CMMS, or the ERP. We integrate.
- ❌ A thing that writes to OT. **Read-only for the plant floor, always.** No PLC commands, no resets,
  no parameter writes. (Beta and beyond. This is a *trust* feature, not a limitation — see Brutal Truth.)
- ❌ A whole-plant UNS boil-the-ocean project. **Prove one asset, end-to-end, first.**
- ❌ A demo that only works on data we hand-seeded. The wedge *is* "works on a factory we didn't seed."

---

## The brutal truth — where we actually are (2026-06-22)

The thesis is right. The execution is **behind it.** Stated honestly so the roadmap stays pointed:

- **Zero paying customers.** The 90-day MVP's "3 paying logos" window has passed with none.
- **The *Hub NodeChat* beta gate is proven (staging only); generic-upload beta is deferred behind Drive Commander.** "A stranger uploads a manual → cited answer, no Mike fixing it" now works on the **Hub NodeChat surface** on staging (#1592/#1863/#1911/#2100, un-xfailed #2077, CI-enforced `beta-gate.yml`). However, bot surfaces (`neon_recall`) cannot yet retrieve folder=brain tenant-scoped uploads, and the per-answer score + decision trace aren't surfaced in-product. The Drive Commander wedge (issue #2577, PR #2504) is Phase 1; generic-upload beta is sequenced behind it. **See the product roadmap (ADR-0025) for the staged execution.**
- **Never proven on foreign messy data.** Every live demo still runs on Mike's pre-seeded garage conveyor.
- **Trust is half-built:** citation grounding *logs* but does not *enforce*; a cross-tenant documents
  IDOR was live on `main`; the shipped Perspective bundle's write paths were **removed in v3.26.1 (2026-06-17)** — read-only is now enforced by CI guard `test_no_customer_write_paths.py`, per `docs/mira-ignition-secure-architecture.md`.
- The plumbing (engine, FSM, UNS gate, KB retrieval, parser, bench hardware) is genuinely mature.
  **The self-serve contextualization loop a stranger walks unaided is not.** Self-scored 6.5/10.

**The window is ~12 months. There are zero customers. The wedge is real but not yet *earned*.**

---

## The way forward — one storyline (not ten phases)

> **Make the loop "contextualize a factory we didn't seed → cited diagnosis" actually work, prove it
> on someone else's mess, and let ProveIt 2027 (Feb 9–12, Dallas) be the deadline that forces it.**

Everything collapses to this. The "Path to Beta" work and the ProveIt prep are the *same work*:

1. **Close the contextualization loop on foreign data** — the beta gate (#1592 upload→retrieval),
   citation *enforcement* (not logging), parser → tag-mapper → human-approve → context package,
   working on a manual + tag-set we've never seen.
2. **Prove on someone else's plant before Dallas** — 1–2 design partners (90-day free), or the ProveIt
   shared UNS dataset itself. The "stranger" test and the conference test are one test.
3. **Reframe SimLab** — internal proving ground for the contextualize→diagnose loop, and the
   credibility weapon (per-answer scoring). It is *not* the ProveIt demo (that uses *their* factory).
4. **Fence the violations** — remove the write-to-VFD calls, close the IDOR. Read-only is the wedge.

---

## ProveIt 2027 — the perfect conference (Feb 9–12, Hilton Anatole, Dallas)

ProveIt! (Walker Reynolds / 4.0 Solutions) is **not a scored benchmark.** It is a live showcase where
every vendor connects to the **same intentionally-messy shared UNS factory** and answers four
questions on stage — *what problem, how, how long, how much* — judged by the manufacturers in the room.
2026's energy: **UNS + knowledge graphs + agents building live with Claude Code.** No winner, no rubric.
*"No polished slide deck saves you. You either prove it or you don't."*

**Design the demo to win that room — the 20-minute arc:**

1. **Connect MIRA read-only to ProveIt's shared messy UNS, live.** Do *not* bring our own factory.
2. **Contextualize it on stage, agentically, in minutes.** Point ingestion at their messy tags + a
   manual → AI proposes the asset structure / knowledge graph → human approves → a trusted context
   package appears. *This is the showstopper* — the exact agentic-build energy that won 2026, aimed at
   the one thing no one else does: building **trustworthy context**, not just a connector.
3. **Then diagnose.** "Why did line 3 fault?" → cited answer from *their* manual, with the
   **"Why MIRA Thinks This"** decision trace and the **groundedness score shown live** as proof.
4. **Answer the four questions, crisply.** *Problem:* the maintenance-context gap every agent demo
   assumes away. *How:* FactoryLM ingests→proposes→human-approves→MIRA diagnoses, read-only.
   *How long:* minutes, live, on data we'd never seen. *Cost:* self-serve, cheap vs. a six-figure SI.
5. **The closing line (the whole strategy in one sentence):** *"Everyone here showed you an agent that
   works **after** your factory is contextualized. We just contextualized a messy factory we'd never
   seen — live, in twenty minutes — and answered a real fault with a cited source. That's the part
   everyone else assumes is already done."*

**The prerequisite checklist for the stage = the beta gate.** If we can contextualize ProveIt's shared
messy factory live, the beta gate is closed by definition. ProveIt is the stage, the deadline, and the
proof, at once.

---

## The product, under the hood — the canonical asset graph

"AI-ready context" has a concrete shape: a **canonical industrial asset graph** — the translation
layer between plant-floor OT and enterprise maintenance systems.

- **In:** semi-structured reality from every direction — Maximo / SAP / MaintainX / Fiix / Limble;
  Ignition / MQTT-Sparkplug B / OPC-UA / historians; manuals, wiring diagrams, PLC tags, nameplates,
  technician knowledge.
- **Through:** one canonical graph (`kg_entities` + `kg_relationships`, ISA-95 `uns_path` addressing,
  `proposed → verified` approval state, confidence + provenance on every edge) — **raw source record
  preserved, never normalized-and-discarded.**
- **Out:** the layer agents ground in, plus a bidirectional bridge (OT signal meaning flows up to
  CMMS/ERP; enterprise structure flows down) — without replacing either system or writing to a PLC.

Two commitments make it defensible: **(1) build the canonical graph first, connectors map *into* it**
(no connector owns a shape); **(2) read-only for OT by default.** Architecture:
`docs/mira/canonical-asset-graph.md`, governed by `docs/plans/2026-06-01-mira-master-architecture-plan.md`.

## The deployable edge — Maintenance Intelligence Module

The namespace, made installable: an Ignition Perspective module (then any SCADA) that **onboards
itself.** Install → auto-detect the connection → read whatever tags exist → **AI-classify them into
equipment** → approve (train-before-deploy) → trends + live fault detection + grounded Ask MIRA light
up. The **unique hook — detect AND explain:** a panel spots a fault from live tags (A0–A12 anomaly
rules running **in-gateway, offline**) and one-tap explains it from the customer's own manuals.
**Tier split:** detection + trends = the free wedge; grounded Ask MIRA = the paid cloud upsell.
Read-only, always. (Status: live GS10 telemetry proven on bench; in-gateway diagnose seam built +
tested — `83ea8e81`.)

## Vision ZTA - the visual compiler and owned-model spine

Vision work must follow the same North Star as the rest of MIRA: turn messy factory evidence into
trusted context, then let the agent prove that context with cited answers. The strategy is **Vision
Zero-Token Architecture**: infer locally only when the answer is not already known; verify it;
compile it into deterministic artifacts; and never pay to reason through the same verified visual
fact twice.

This is not "replace every model call with a tiny local chatbot." It is a compiler flywheel:

1. Secure intake, hash identity, and exact-result cache.
2. Deterministic quality, rotation, crop, raster, dedup, page classification, and PrintSense grading.
3. Local OCR/layout and verified pack/catalog/graph/regex/visual-similarity lookup.
4. Local detector or small local VLM only for unresolved observations.
5. Independent local reread or human review before promotion.
6. Accepted facts compile into cache entries, OCR rules, drive/print packs, graph edges, exemplars,
   detector labels, and regression fixtures.

Paid vision APIs are **off by default**. A paid call is an explicit, budgeted, audited benchmark or
operator exception, never an automatic fallback. Unresolved or contradictory identifiers go to review
instead of being guessed.

Fleet ownership is job-level, not cross-Mac model sharding. Alpha orchestrates, hashes, rasterizes,
preprocesses, and grades. Bravo owns the fast interactive local VLM/OCR lane. **Charlie owns document
OCR/layout, embeddings and visual-similarity indexing, batch corpus processing, benchmark/dataset
curation, and only a resource-gated second VLM lane.** The VPS owns public ingress, tenant/session
routing, job state, manifests, and cache metadata; it must not become a heavy vision host.

### Bravo runtime boundary — an evidence lane, never a second assistant

Bravo owns the fast interactive local VLM/OCR lane, and that is *all* it owns in the runtime:

- **Bravo emits typed *candidate* evidence, not technician answers.** Its VisualSession observations
  (vision prose, OCR text, schematic inference) enter the runtime as
  `EvidenceKind.PRINT_OBSERVATION` items — never as a conversational reply, never as a separate
  chat personality. The sole conversational runtime remains `mira-pipeline` / the shared `Supervisor`.
- **Every Bravo result entering context retains its provenance.** Source identity (evidence /
  observation id, original content hash), producer + model provenance (the `extractor`, and the model
  version only when actually supplied), explicit coordinates (page, bounding box) *only when the
  source row contains them*, trust state, and known gaps all survive the crossing. Nothing — page,
  coordinate, asset identity, or model version — is ever derived from a filename, list order, or prose.
- **The common context contract is the only path** from Bravo evidence to the one technician policy
  (`materialized_evidence/context_contract.py :: evidence_from_visual_session`). There is no second
  context schema and no second evidence ledger.
- **Human review, not model confidence, promotes trusted truth.** VLM/OCR output stays `candidate`
  no matter how confident the model is; only the existing human `review_state` raises it, and rejected
  or superseded observations never cross at all.

The proprietary model program compounds the same loop. FactoryLM should own adapters, fine-tunes,
OCR models, embedding/reranker pairs, detector datasets, model manifests, graders, and deterministic
artifacts before dreaming about foundation-model pretraining. Do not train on private customer
material without explicit consent; do not mix frozen benchmark cases into training; do not call a
model "FactoryLM-owned" unless the owned base weights, adapters, datasets, graders, and deterministic
artifacts are named separately.

## Materialized Evidence and Recall-First Architecture

MIRA works with industrial datasets whose processing cost may be measured in hours, days, or
substantial model expense — multi-thousand-page print packages, hundreds of equipment photos, hours
of machine video, PLC projects, years of historian signals. These do not fit a context window, and
verifying them can itself cost another expensive pass. So the **dataset — not the chat session — is
the unit of machine memory.**

This is the same loop the Vision ZTA section states, generalized to *all* expensive industrial work:
once MIRA has inspected a manual, drawing, photo, video, PLC export, log, or sensor dataset, the
resulting discovery must become **durable, typed, versioned, searchable evidence.** MIRA must recall
compatible prior evidence before recomputing it.

Expensive stages must materialize reusable outputs carrying source hashes, lineage, schemas, producer
versions (including model + prompt version where inference was used), approval state, known gaps, and
cost metadata. **Intermediate stages are preserved** so a failed or changed downstream stage never
forces reprocessing the whole source. Recompute only when the relevant source evidence or a
dependency actually changed — and then only the affected descendants, never the unaffected 2,999
pages.

Three stores, three jobs, never conflated: **Materialized Evidence** preserves what MIRA discovered
(including candidates and unresolved conflicts — not yet trusted). **Capability Packs** contain what
FactoryLM has validated and promoted into reliable, versioned capability. **Temporal** coordinates the
long-running work that moves evidence through extraction, review, compilation, and promotion — it
passes identifiers and hashes, it does not store the industrial source. A model never promotes its own
output to trusted truth; human review does, through the existing approval systems.

The permanent rule, extending "infer once, validate, export, run without inference":

> **Infer once. Materialize every expensive discovery. Validate and approve stable truth. Compile it
> into Capability Packs. Recall it unless the evidence changed.**

Or, plainly: **do not make the machine pay twice for the same understanding.** Doctrine is operational
in `.claude/rules/materialized-evidence.md`; the layer architecture is `docs/architecture/materialized-evidence.md`;
the platform decisions are `docs/adr/0029-materialized-evidence.md`. The seed already exists —
`printsense/cas.py` is a content-addressed, producer-version-keyed derivation cache; this amendment
generalizes it into a platform layer rather than replacing it.

### The batch-document boundary (first working receipt)

The first place this stops being architecture and starts being a receipt is **batch document
ingest** — the OEM-manual lane on Charlie (`mira-crawler/tasks/full_ingest_pipeline.py`).

Its boundary is deliberately narrow, and the narrowness is the point:

- A batch document produces **typed, `candidate` evidence receipts** — byte identity (SHA-256 of the
  actual downloaded bytes, never a URL, filename, or chunk ordinal) plus the **real** extraction
  method recorded verbatim. A text-layer parse is never described as OCR.
- A receipt is a **pointer, not a document store.** It references the raw PDF and the
  `knowledge_entries` chunks that ingest already created; it carries no document text, no OCR text,
  no tenant chunk contents.
- Receipts **do not answer technicians and do not promote themselves.** Trust stays `candidate`,
  approval stays `pending`, and promotion remains a human act through the existing approval systems
  (ADR-0017). A byte hash is byte identity — never corpus lineage, training lineage, or a rights grant.
- The lane is **optional and fail-open.** Unconfigured, document ingest behaves exactly as before; a
  receipt failure is reported and never blocks, retries, or re-grades a document.

What it does **not** yet do: it makes no automatic recompute-or-skip decision. It writes the durable
identity that a later recall decision can safely be built on — it does not yet make that decision.

## The flywheel + the moat

1. We structure a plant → its **Maintenance Intelligence Namespace** is captured (assets, docs, tags,
   history) on the canonical graph.
2. Each structuring grows reusable inventory — parsed manuals, OEM PM templates, fault-pattern
   libraries, tag-mapping heuristics — so each next plant maps onto existing canonical nodes instead
   of starting blank.
3. MIRA on top gives grounded answers, captures more knowledge, feeds it back. Cost-to-structure
   drops; the moat compounds.
4. **The Knowledge Cooperative:** opt-in plants share anonymized PM patterns and fault-resolution
   traces. A plant that pilots a Yaskawa GA500 — every subsequent GA500 starts ~80% structured for
   free. **The asset graph is what compounds; that is the network effect that makes us defensible.**

## The commercial model

**Product-led + self-serve is the primary motion** (resolved: ADR-0014 over the older services-only
ladder). A new user gets a grounded, cited answer without an onboarding call. The **$500 Assessment**
survives as a *sales-assist / land motion* for in-person plant visits, not the only door.

> **Open decision (Mike's call):** the three docs carry three price architectures ($499 / $2–5K-mo ·
> $97 / $297 · $0 / $97 / $497). Pick ONE before beta outreach. This North Star does not invent a
> fourth — it flags that one decision must be made and propagated.

## The decision filter

Before building any feature: **"Does this make the contextualization loop work on a factory we didn't
seed — and prove it with a cited, scored answer?"** If not, it waits.

- Reusable OEM manual parsing / tag auto-classification? **YES** — that *is* the loop.
- Per-answer groundedness scoring surfaced to the user? **YES** — the differentiating knife.
- Turning recurring visual interpretation into cache/rule/pack/graph/model artifacts? **YES** — that
  is the Vision ZTA flywheel.
- New chat adapter / pretty dashboard? **Only** if a paying plant or the ProveIt demo needs it.
- Anything that writes to OT, or boils the whole-plant UNS before one asset works? **NO.**

## Decisions this North Star locks

1. **The wedge is the context layer** (FactoryLM) with the agent as proof (MIRA) — *not* a copilot,
   *not* a platform we rebuild. Lead with context, never with "AI copilot."
2. **Product-led self-serve** is the primary motion; assessment is a land-assist. (Reconcile
   `STRATEGY.md` + `NORTH_STAR` services ladder to this.)
3. **Read-only for OT, no exceptions** — fence the shipped write-to-VFD surface.
4. **SimLab = internal proving ground + per-answer scoring credibility, NOT the ProveIt demo.**
   ProveIt runs on *their* shared messy factory.
5. **One storyline to February:** contextualize foreign data → cited diagnosis, proven on someone
   else's mess. Beta gate = ProveIt prerequisite = the same finish line.
6. **Pricing:** one architecture, decided by Mike, then propagated (flagged above).
7. **Vision ZTA:** visual inference is local-first, deterministic-first, review-before-paid, and
   compile-to-artifact. FactoryLM-owned adapters/weights are a product moat only when provenance,
   consent, evals, and rollback are recorded.

---

## Repeatable product end-state vision

**Owner-requested direction, 2026-11-17. Future target, not a shipped-capability claim.**
This section extends the context-layer wedge, read-only boundary, train-before-deploy
and materialized-evidence principles above. It is not a replacement architecture,
a new roadmap or permission to start every capability at once. Historical dates,
market comparisons and status elsewhere in this document remain historical, not
current proof. [DELIVERY.md](DELIVERY.md) and [#5232](https://github.com/Mikecranesync/MIRA/issues/5232)
retain current delivery ownership and controlling acceptance requirements.

### The finished-product promise

**A new supported customer supplies its equipment, references and access constraints;
a trained operator configures the product; ordinary technicians complete useful,
traceable maintenance work without Mike writing customer-specific code or operating
the system behind the scenes.**

FactoryLM supplies the reusable trusted-context foundation. MIRA is the grounded
technician experience that proves its value. Keep the existing clean conversational
app, equipment context, manuals, photos and recoverable work connected as one journey,
not a collection of demos or separate specialist assistants.

The goal is not “every buyer, every machine, anytime.” Publish a supported customer
profile, equipment/content requirements, deployment options and exclusions. A good
product makes evaluation and adoption low-risk; it cannot guarantee buyer budget,
procurement approval, mission fit or an award.

### One reusable core, configured rather than forked

- Reuse the canonical industrial asset graph, ISA-95/UNS identity, evidence contracts,
  approval systems, Living Sheet/work records and approved-context answer path.
  Align interoperability work with existing CESMII/i3X direction where applicable;
  do not create another identity model, evidence ledger or conversational brain.
- Keep deterministic processing and recall first. Materialize expensive discovery;
  preserve source bytes, hashes, lineage, revision, producer versions and known gaps.
  Compile verified reusable knowledge into versioned Capability Packs. The LLM
  interprets and communicates within those boundaries; it does not manufacture truth.
- Package supported equipment/content/workflow configurations and versioned adapter
  interfaces. A new site should map to these, not receive a permanent code fork.
  Novel integrations are explicit scoped engineering, not concealed “configuration.”
- Offer a small, documented set of deployment profiles using mature infrastructure.
  Build the differentiating context and technician workflow, not replacements for
  every customer's historian, CMMS, identity provider or industrial data platform.
- Preserve all existing cloud/provider, licensing, privacy and safety restrictions.
  This vision does not select new vendors, models, spending or hosting permissions.

### What “ready” must mean to a customer

| Outcome | End-state delivery | Evidence required before claiming it |
|---|---|---|
| **1. Trust the machine and answer** | Bind the installed asset, model/variant and applicable document revision. Preserve table/value/unit/condition relationships, exact source locations, cautions and uncertainty. Keep observations, ratings, measurements and hypotheses distinct. Unsupported or hazardous requests do not become invented procedures. | Independent frozen correct-model, wrong-model, missing-data, conflicting-source and hazard cases, followed by deployed technician acceptance. Measure harmful errors **and useful-answer coverage**; indiscriminate refusal is not success. |
| **2. Finish and recover a real job** | Identify equipment → obtain applicable cited help → capture photos, readings, actions and outcome → review/verify → reopen later against the correct asset and permissions. A source packet becomes a durable work record, not a dead-end chat. | The complete supported journey on real devices, across restart, device changes and interrupted connectivity; original sources and review state recover intact. Another qualified person can understand what happened and what remains unknown. |
| **3. Onboard without the founder** | Import equipment and references, resolve identity, configure roles/templates, show truthful indexing readiness and recover failed processing through supported controls. No silent document loss. | Someone other than Mike onboards an unfamiliar supported equipment family, then a second site without code changes; record time, errors and every intervention. |
| **4. Integrate predictably** | Standalone MIRA remains useful with CMMS off. Chosen connectors use versioned mappings, source freshness/quality, bounded retries, deduplication, disconnect recovery and least-privilege credentials. | Contract and failure-path tests plus actual supported-system integration receipts. OT stays read-only, always. Any optional business-system write requires separately approved scope and auditable outcome; this document grants none. |
| **5. Operate and support it** | Repeatable install, upgrade, rollback, backup/restore, monitoring, capacity/cost limits, incident handling and support handoff. The product cannot depend on undocumented rescue commands. | A nonauthor installs and operates a supported profile, restores data and rolls back a failed upgrade. Publish measured limits and agreed service targets, not invented uptime or recovery guarantees. |
| **6. Pass a serious security review** | Tenant isolation, roles, auditability, documented data flows/retention/providers, secret management and vulnerability/incident processes match the chosen deployment. | Independent boundary tests and a maintained security evidence package. Certifications, authorization and regulatory compliance remain unclaimed until the specific required evidence exists. |
| **7. Demonstrate customer value** | Useful work improves relative to the customer's current process with manageable training and support. | Real maintainers and buyers: baseline comparison, time to correct information, task success, repeat use, support burden and buyer acceptance or paid continuation. Synthetic personas, a seeded bench and leads are not customer demand. |
| **8. Be straightforward to buy** | Defined scope/exclusions, approved price, onboarding plan, pilot acceptance, support terms and procurement/security package; repeatable delivery by an operator or implementation partner. | Buyer-understandable offer and acceptance record, viable economics including onboarding/support/model costs, and separately verified commercial agreement/payment. Mike decides offer and price. |

Saved technician work is **user-verified evidence, not automatically authoritative
procedure**. Preserve author, asset binding, source identity, time, review state,
corrections and provenance. Qualified human review is required where appropriate;
candidate, rejected and superseded records cannot silently become approved knowledge
or be reused across unauthorized users/customers. No model promotes its own output.

### Specialized disconnected / Navy deployment profile

The same core should eventually support a rigorously qualified disconnected profile,
not a parallel Navy-only product. This is a **future deployment target**, not a claim
of Navy endorsement, solicitation compliance or current air-gapped readiness.

- Cold boot without network; supported fresh local authentication; local retrieval,
  grounded answers and exact citations; capture work and recover it after restart.
  Cached PDFs, a previously authenticated session or disabling a cloud model alone
  do not prove this profile.
- Define what remains usable offline, model/hardware limits, content updates and
  operator recovery. Prove monitored isolation with positive controls and explicit
  network windows, not merely a failed ping.
- Reconnect safely: two devices, conflicting edits, loss/duplication, document and
  model versions, identity/permission revocation and reconciliation must have
  explicit behavior and evidence. Retain history rather than silently choosing.
- Evaluate mixed technical documents and equipment history with representative
  maintainers. Tailor guidance to role and context without bypassing safety.
- Determine deployment-specific cyber, export, classification, clearance and
  acquisition obligations from the controlling requirements. No assumed
  certification, clearance, authorization to operate or approved data handling.

**Proposal readiness is not finished-product readiness.** A Phase I feasibility
proposal may address an explicitly bounded research gap; it does not require every
end-state feature to exist. Conversely, submitting or winning a proposal proves
neither operational acceptance nor a production-ready product. Verify the official
solicitation, amendments, eligibility, required evidence and submission rules for
each opportunity. Keep bid strategy, solicitation-specific details, pricing and
private customer/interview evidence in the private repository, not this public file.

### Sequence, evidence and agent decision filter

1. Finish **one trustworthy deployed technician journey** within the current supported
   scope and existing safety/data-integrity gates.
2. Prove usefulness with **real maintainers and a buyer** on unfamiliar information.
3. Make that success **repeatable at a second site without founder coding**.
4. Package operations, security, support and procurement for the supported offer.
   Necessary security and customer-discovery work runs alongside the journey.
5. Qualify the specialized disconnected profile against its actual requirements.
   Do not require every future connector or Navy feature before the first customer.

This ordering guides investment; it does not reorder existing active claims or
weaken any G01–G12/W0–W5 requirement. Use the canonical tracker and current owners to
turn gaps into small owned work, not a competing implementation or second backlog.

For every slice ask: **Which supported customer outcome does this improve, what can
we reuse, who owns the seam, and what exact evidence will prove the improvement?**
If it only adds infrastructure or a new surface without advancing that outcome, defer it.

Mission Control is the visibility layer for this same delivery system: show the
current goal, owner, candidate, evidence, blocker and next action by linking existing
records. It is not a second project brain, replacement issue tracker or permission
to build an unrelated dashboard before the customer journey works.

Keep these evidence states separate:

- **Vision / proposed:** desired behavior, acceptance design or feasibility hypothesis.
- **Implemented / tested:** named source SHA, configuration, dataset and bounded test
  results; not automatically deployed, accepted or useful.
- **Staged / device-proven:** exact deployed candidate and repeatable physical workflow
  receipts, including failures and remaining unknowns.
- **Human / customer accepted:** representative qualified users complete the controlling
  journey and the buyer's explicit acceptance criteria; not synthetic stand-ins.
- **Released / commercially supported:** required exact-head review/CI and promotion
  gates, deployment/rollback/support evidence and the approved offer all hold.

Every pass must name the artifact it certifies. A merged PR, short offline run,
automated score or persuasive demo cannot substitute for missing evidence. Existing
SDLC, independent review, human merge/deploy decisions and safety boundaries remain
in force. This vision grants no new implementation, external submission, purchase,
data sharing, equipment control or release authority.

The outcome is a **repeatable, trusted product and delivery system**. Mike supplies
domain judgment, product direction and customer relationships; the product and its
operators carry the routine delivery burden.
