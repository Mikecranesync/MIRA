# FactoryLM / MIRA — North Star

> **Canonical strategy. Updated 2026-06-22.** This document supersedes every earlier wedge framing
> (services-led "transformation firm", "Slack-first AI copilot", "self-serve quickstart copilot",
> "Ignition module"). Those were front-doors and motions, not the wedge. The wedge below is the one
> the June PRD identified and the 2026 competitive map independently confirmed. `STRATEGY.md`, the
> root `CLAUDE.md` North Star, and the PRD are reconciled to *this*.

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
- **The beta gate is RED.** "A stranger uploads their own manual → cited answer, no Mike fixing it"
  does **not** work end-to-end: uploads land in the Open WebUI KB; chat reads `knowledge_entries`;
  the fix (#1592 folder=brain) is still DRAFT.
- **Never proven on foreign messy data.** Every demo runs on Mike's pre-seeded garage conveyor.
- **Trust is half-built:** citation grounding *logs* but does not *enforce*; a cross-tenant documents
  IDOR was live on `main`; a shipped Perspective view **violates the read-only anti-goal by writing to
  the VFD** — fence both, they directly undercut the trust pitch.
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
