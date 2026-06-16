# CoreFlux ("Core Flux Hub 2.0") vs MIRA / FactoryLM

**Date:** 2026-06-13
**Source:** YouTube video `mYhX0SXgfVY` — a product-demo video for **Core Flux Hub 2.0**, shot in Porto, Portugal and framed around a *Francesinha* (a layered Porto sandwich) as a metaphor for the product's "stacked layers."
**Transcript:** `/tmp/coreflow-transcript.txt` (auto-generated EN captions, 178 segments, single-paragraph)

> **Grounding caveat — read first.** This is a thin source. The video is a ~5-minute
> marketing/demo reel woven into a food-and-travel format, not a technical deep-dive, sales deck,
> or pricing page. It demos *one product* (Hub 2.0) at a UI level. Several fields the brief asked
> for — **pricing, ICP/target market, full tech stack, and go-to-market strategy — are simply not
> stated in the video** and are marked "not determinable" below rather than guessed. A few terms
> are auto-caption garbles I've interpreted (flagged inline as *[inferred]*).

---

## 1. What CoreFlux is and does (from the video only)

**CoreFlux** (rendered "Core Flux" in the auto-captions) demos a product called **Hub 2.0** — pitched as a single, unified, **OS-like workspace** that **centralizes the "multitude of tools"** a user would otherwise juggle to **automate systems and visualize data**.

Direct claims from the transcript:

- **The pitch / problem:** *"If you are someone that usually relies on a multitude of tools, a different set of tools to automate your systems or visualize data, probably this product is for you. We … decided to build something to centralize and unif[y] all of those necessities and solutions in one unique place."*
- **The form factor:** *"It looks much like an OS where you can have different products, different widgets. You have it your own way."* Customizable, windowed, with a **tile manager** (horizontal / vertical / grid window layouts) and **themes** (the presenter's favorite is "monolith").
- **Design principle:** *"easy to use and … somehow low code."* Repeated emphasis on **not having to look at lines of code** — visualize data as maps and graphs instead.

The apps/surfaces shown inside Hub 2.0:

| Surface | What it does (per transcript) |
|---|---|
| **Data Viewer** | Explicitly positioned as a **replacement for MQTT Explorer** ("we used to rely on MQTT Explorer … something was missing … the overall aspect seemed a bit outdated"). **Drag-and-drop MQTT topics** (e.g. a `pump ID` topic, a `prediction` topic) into a canvas; render as **maps or graphs**, no code. **Color-codes** topics (orange, yellow) to tell them apart. References the **"UN3"** *[inferred: **UNS / Unified Namespace**]* alongside the data viewer. |
| **Connections / Routes** | Configure and manage **the different sources of data** feeding the system. **Color-coded health** — a route shown **orange = "something is wrong"** vs green = OK. |
| **"LOT editor"** *[inferred: **LOT** = Coreflux's automation language]* | Visual editor showing **automation actions, models, and assets** used to automate a system; same drag/color/modeler approach. |
| **AI Assistant** | A **low-code / no-code automation builder** for **non-technical users**: *"I cannot really code a full automation unless I use … the AI assistant … you just ask the agent what type of automation you want, set your routes, and there you go."* |
| **Dashboards** | Graph/visualization app for a **"panoramic view of your system"** — for users who aren't comfortable in the raw data viewer. |

**Core product (as demoed):** an **MQTT-centric industrial-data operations workspace** — broker/topic data plane + routing/automation + visualization + an NL automation agent, unified behind one customizable OS-like UI.

### What the video does NOT tell us (not determinable from this source)
- **Pricing model** — never mentioned.
- **Target market / ICP** — only implied ("someone who relies on many tools to automate systems / visualize data"). No vertical, company size, or buyer persona stated.
- **Full tech stack** — only MQTT (explicit), the "LOT" automation language *[inferred]*, and an unnamed AI assistant. No languages, hosting, or broker internals stated.
- **Go-to-market strategy** — not discussed; this is a feature demo, not a GTM artifact.
- **Sparkplug B / Ignition / PLCs / SCADA** — **none mentioned by name.** MQTT and topics like `pump ID`/`prediction` are the only OT signals shown. (CoreFlux as a company is an MQTT-broker vendor, but the *video* does not assert Sparkplug/Ignition/PLC/SCADA support — so I won't either.)
- **Their "approach to maintenance"** — **the video shows no maintenance, troubleshooting, work-order, manual, or fault-diagnosis functionality at all.** It is a data/automation/visualization tool.

---

## 2. Side-by-side: CoreFlux Hub 2.0 vs MIRA / FactoryLM

| Dimension | **CoreFlux Hub 2.0** (per video) | **MIRA / FactoryLM** (per `NORTH_STAR.md`, `STRATEGY.md`, `THEORY_OF_OPERATIONS.md`, `.claude/CLAUDE.md`) |
|---|---|---|
| **One-liner** | A unified, OS-like, low-code workspace to centralize tools for **automating systems & visualizing MQTT data**. | A **maintenance digital-transformation firm**; MIRA is the grounded execution layer that turns messy maintenance reality into an **AI-ready Maintenance Intelligence Namespace**. |
| **What the product *is*** | A horizontal **OT data plane + automation + visualization** product (broker/topics/routes/dashboards). | A **vertical maintenance copilot + canonical asset graph** (`kg_entities`/`kg_relationships`, ISA-95 `uns_path`). "The graph IS the product." |
| **Primary user** | A control/automation engineer or operator wiring up data flows & dashboards (with a low-code path for non-technical users). | A **maintenance technician standing at the machine** (Slack-first), plus the maintenance manager who buys the transformation. |
| **Core data** | **Live MQTT topics** (live signal data plane). | **Maintenance evidence**: manuals, nameplates, PLC tags, work-order/fault history, technician notes — *grounded* and *cited*. Live Ignition/MQTT context is read-only input, not the product. |
| **AI role** | **NL automation builder** ("build me an automation") + auto-visualization. | **Grounded troubleshooting copilot** that must cite a source and **cannot begin until the UNS location-confirmation gate** resolves the asset. Anti-hallucination is the whole point. |
| **UNS** | References **"UN3" *[inferred UNS]*** as a way to organize/identify topics in the viewer. UNS-as-data-organization. | UNS is the **canonical maintenance address space** (`mira-crawler/ingest/uns.py`, ltree), and the **maintenance side of UNS specifically** — the explicit wedge. |
| **Posture toward OT** | **Reads and routes/automates** — it's an automation tool (the "LOT editor" automates systems). | **Read-only for OT by default** — "MIRA observes the plant floor; it never controls it. Never writes to a PLC." |
| **Delivery model** | Self-contained software product (download/use the Hub). | **Services + SaaS hybrid**: Assessment ($500) → Pilot ($2–5K/mo) → Operating Layer ($499/mo). We structure *for* the customer. |
| **UX signature** | Drag-and-drop, color-coded health, tile/window manager, themes, "no lines of code." | Phone-first, terse Slack messages; lead with site→asset→component→fault + 3 evidence bullets; confirm before troubleshooting. |
| **Pricing** | Not stated. | Explicit three-tier ($500 / $2–5K-mo / $499-mo / Enterprise custom). |

---

## 3. Where they overlap

1. **Industrial / IIoT space, MQTT-native.** Both live in plant-floor data. MIRA's Live Context layer reads **MQTT / Sparkplug B** and Ignition tag streams; CoreFlux's whole Data Viewer is MQTT topics.
2. **UNS as an organizing idea.** CoreFlux uses "UN3" *[UNS]* to organize topics; MIRA's entire wedge is a maintenance-first UNS.
3. **An AI assistant over industrial data.** Both ship an LLM-driven assistant. (Different jobs — see §4 — but the surface rhymes.)
4. **"Too many tools" pain.** CoreFlux's headline pitch ("centralize a multitude of tools") echoes FactoryLM's ICP pain ("manuals in three filing cabinets, two SharePoints, and one tech's truck"). Both sell **consolidation**.
5. **Low-code / accessibility for non-experts.** CoreFlux's no-code AI assistant ↔ MIRA's "the technician does not have to become a data architect."

---

## 4. Where they differ (the important part)

1. **Operations data plane vs maintenance intelligence.** CoreFlux is an **OT data/automation/visualization workspace** — the live nervous system. MIRA is **maintenance knowledge** — manuals, components, fault history, grounded answers. This is exactly the line `STRATEGY.md` draws: *"UNS consultancies focus on production data (OEE, throughput). Maintenance is an afterthought."* CoreFlux is squarely on the **operations/production-data** side; MIRA deliberately took the **maintenance** side nobody else structures.
2. **Automates/controls vs read-only observes.** CoreFlux's LOT editor **builds automations that act on systems**. MIRA's hard constraint is **read-only for OT, never writes to a PLC**. Opposite postures.
3. **Visualize-the-stream vs ground-the-answer.** CoreFlux's value is *seeing* live data (maps, graphs, dashboards, no code). MIRA's value is a **cited, evidence-gated answer** to "why is this machine down and what do I do" — with a non-negotiable confirmation gate and citation compliance. CoreFlux shows **no manuals, no work orders, no fault diagnosis, no document grounding** in the video.
4. **Product vs transformation.** CoreFlux sells **software you operate yourself**. FactoryLM sells **a transformation service + an operating layer** — "we structure FOR them in the pilot, not via a wizard." Different business shape entirely.
5. **Engineer-tool vs technician-tool.** CoreFlux's natural user wires up routes and dashboards (an automation/controls persona). MIRA's natural user is a maintenance tech on a phone in a noisy plant.

---

## 5. Verdict: competitor, complement, or irrelevant?

**Primarily a COMPLEMENT / adjacent-infrastructure play — not a direct competitor today.**

- CoreFlux is the kind of **MQTT/UNS operations data plane** that MIRA's own strategy says it **sits on top of, not against**: *"Trying to replace Ignition, MaintainX, or your historian"* is explicitly in the "we are not" column. A CoreFlux-style broker/namespace/visualization layer is **upstream live context** MIRA could consume read-only.
- On `STRATEGY.md`'s competitor table, CoreFlux maps to the **"UNS consultancies / operations namespace"** row — *"they focus on production data; maintenance is an afterthought… they don't compete."* That assessment holds against the video: zero maintenance/document/fault functionality shown.
- **Where it could become a competitor:** if CoreFlux pushes its **AI assistant** from "build me an automation" toward **"diagnose this machine / answer maintenance questions over the live data,"** the surfaces would start to overlap. The defensibility gap MIRA holds — **document grounding, fault/work-order history, component templates, citation + the UNS confirmation gate** — is exactly what the video shows CoreFlux *not* having. That moat is the thing to keep widening.

---

## 6. What MIRA can learn from CoreFlux

1. **The consolidation narrative lands.** "Stop juggling a multitude of tools — one place" is a clean, buyer-legible pitch (and survives the "industrial buyer who hates AI hype" filter in `STRATEGY.md`). MIRA's "manuals in three filing cabinets" pain is the same shape — worth leaning into the *consolidation* framing in GTM copy.
2. **Color-coded health as default UX.** Orange-route = "something is wrong" at a glance is a strong pattern for MIRA's **Command Center / Hub** surfaces (route/feed/namespace health). Cheap, legible, technician-friendly.
3. **Drag-and-drop + no-code visualization.** For the Hub's namespace/proposals/Command-Center views, the "humans shouldn't have to read lines of code — give them a map or graph" principle is a good north star for non-technical maintenance managers.
4. **OS/tile/window + theming polish.** CoreFlux clearly invested in UI craft (tile manager, themes). MIRA's screenshot-rule discipline already exists; the *bar* for visual polish CoreFlux sets is a useful reference for demo-ready surfaces.
5. **An NL "build it for me" assistant for non-technical users** is a proven framing. MIRA's analogue isn't "build an automation" (out of scope — read-only) but could be **"structure this asset for me"** / "set up this line" guided flows.

---

## 7. What MIRA does that CoreFlux (per the video) does not

- **Grounded, cited answers** — every claim tied to a manual page, tag, work order, or technician confirmation. CoreFlux visualizes raw streams; it doesn't *answer maintenance questions with evidence*.
- **The UNS location-confirmation gate** — MIRA refuses to troubleshoot until the asset context is resolved/confirmed. No analogue shown.
- **Maintenance knowledge graph** — `kg_entities`/`kg_relationships`, component templates, `proposed → verified` approval, confidence on every edge. CoreFlux shows topics/routes/dashboards, not an asset-knowledge graph.
- **Document/manual ingestion + RAG** — manuals, nameplates, wiring diagrams, fault codes. Absent from the video.
- **Work-order / fault history capture** and CMMS write-back (Atlas, MaintainX via Nango). Absent.
- **The technician-at-the-machine capture loop** (photo → extract → match → propose → confirm → store → use). CoreFlux is operated by someone configuring data flows, not by a tech taking a photo of a failed prox switch on a Tuesday shift.
- **The services-led flywheel** — assessment → pilot → operating layer, with a compounding cross-plant OEM/fault-pattern moat. CoreFlux (in the video) is a self-operated product.
- **Read-only OT safety posture** as a *product principle* — MIRA never controls the plant; CoreFlux's LOT editor exists to automate/act on systems.

---

## 8. Confidence & gaps

- **High confidence:** CoreFlux Hub 2.0 is an MQTT-centric, OS-like, low-code data/automation/visualization workspace with a Data Viewer, Connections/Routes, an automation editor, an AI assistant, and Dashboards. All stated or shown in the transcript.
- **Inferred (flagged):** "UN3" = **UNS**; "LOT editor" = Coreflux's **LOT** automation language; company = **Coreflux** of Porto, PT. Reasonable but not spelled out verbatim in clean form.
- **Not determinable from this source:** pricing, ICP, full tech stack, GTM, and any Sparkplug/Ignition/PLC/SCADA support. A sales page, docs site, or technical talk would be needed to fill these — flagged rather than invented.
