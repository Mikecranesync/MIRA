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
