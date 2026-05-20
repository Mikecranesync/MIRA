# Fuuz

> Last refreshed 2026-05-19 by claude-code after deep-dive on **Fuuz Episode 6** ([video analysis](../videos/fuuz-video-analysis.md)) + public-repo deep-read ([repo analysis](../repos/fuuz-repo-analysis.md)). Previous review covered platform positioning only.

## Identity

- **Name:** Fuuz (legal: Fuuz Industrial Intelligence)
- **Founder/CEO:** Craig Scott
- **Tagline (self):** "Industrial Intelligence Platform" — Unified Manufacturing Platform (UMP)
- **Website:** https://www.fuuz.com/  (app: https://fuuz.app, support: https://support.fuuz.com)
- **GitHub org:** https://github.com/Fuuz-Industrial-Intelligence
- **Category:** Manufacturing iPaaS + PaaS — UNS-anchored module catalog (MES, WMS, APS, Quality, **CMMS**, IIoT) with first-class Claude-Code skill library
- **ProveIt! 2026 involvement:** **Exhibited + presented** Thursday morning immediately after CESMII (Fuuz built apps for Enterprise B + Enterprise C of the virtual factory). LNS Research categorized them as "DataOps as part of larger platform." ([LNS coverage](https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code).)
- **Industry 4.0 relevance score (1-5):** 5 (upgraded from 4 — they're now publicly the most aggressive "Claude-Code-native MES/iPaaS" vendor)
- **MIRA overlap (1-5):** 4 — they bundle a CMMS module and have a working LLM-in-the-platform story; the maintenance-app surface overlaps but their wedge is "build apps on us" not "answer maintenance questions"
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (revised summary)

Fuuz is a **manufacturing-grade application platform**: a UNS-anchored event-driven backend + a low-code Application Designer (data models, flows, screens) + a library of pre-built **integration connectors** (44+) + a publicly-released **Claude Code skill library** that lets developers (and Claude) build full MES/WMS/IIoT/CMMS apps directly on the platform.

The product is **the platform**. Their modules (MES, WMS, APS, Quality, CMMS) are pre-built example apps demonstrating what the platform can do — but they also ship as a way for customers to skip building. The platform's killer surface in 2026 is **how fast Claude Code + the skills let you stand up a manufacturing-grade application** — Craig + Claude built 100 data models + 73 screens + 94 flows in 2–3 weeks part-time for ProveIt! 2026.

## Architecture (as publicly described + observed)

### Backend
- **Event-driven monolith.** Single internal message broker; every data change (production, scrap, receiving, GL post, CRM update) published as an event; in-process subscribers handle reactive work. Craig: "the entire backend of Fuse is essentially what you see here on my screen" *(showing MQTT explorer of internal UNS)* `[Episode 6, 07:00]`.
- **Two GraphQL APIs.** *Application API* for custom data models; *System API* for platform infra (users, roles, tenants, connectors). Relay-style connections (`edges[].node`). Inline aggregation supported (`alarmState`-group `count`).
- **i3X-compliant GraphQL layer** over the UNS data — every topic has queryable history because Fuuz persists every data change in the data model.
- **Three flow runtimes:**
  - *Backend flows* — scheduled or event-triggered, 20 min internal timeout
  - *Web flows* — invoked from screens (request/response), 10 min external timeout
  - *Gateway flows* — run on the Fuuz Gateway on-premise (printers, local devices, MQTT bridging)
- **Multi-tenant by database.** Each tenant = its own database with identical system schema + custom schema. Tenant types: Administration, Application Development, Application, Custom, Integration.

### Data model
- **ISA-95 native:** Enterprise → Site → Area → Line → Cell → Asset → DataPoint.
- **Model taxonomy:** `master` / `setup` / `transactional` — drives retention defaults (5475d / 120d / 3650d), indexing, behavior.
- **Strict relationship discipline:** every FK has an inverse list relation on the parent model; UoM fields must be FK to `Unit`, never `String`.

### UNS / namespace
- Explicit ISA-95 UNS at `fuuz/{site}/{area}/{line}/{cell}/{equipment}/{datatype}` with `$cell.code ? $cell.code : "nocell"` fallback for optional levels.
- UNS message envelope: `elementId`, `displayName`, `typeId`, `parentId`, `hasChildren`, `namespaceURI`, `value{before,after}`, `timestamp`, `quality`.
- **Fuuz writes to external UNS (e.g., ProveIt! public UNS) as well as reads** — demonstrates openness.
- **UNS = nervous system; data model = queryable memory.** Treats them as two separate, complementary layers.

### Protocols / connectors
- **MQTT** (broker + client built into Fuuz Gateway).
- **OPC UA** (Fanuc CRX-10 robot integration; Prosys simulator).
- **REST / HTTP** + 44 named connectors: SAP Cloud + SuccessFactors, Plex (API + Classic + UX + IAM), NetSuite (SOAP + REST), Infor, Epicor, Dynamics 365, Salesforce, Arena, ServiceNow, Marketo, …
- **Device drivers** — 13 types, 19 named drivers (Sparkplug not explicitly named in the video; likely covered under MQTT).

### AI / LLM usage
- **Publicly shipping Claude Code skills** (`fuuz-skills` repo, 7 skills, ~43k lines of reference docs) — first manufacturing platform with this depth of public Claude scaffolding.
- **Internal MCP catalog in development** — Craig: "We're in the process of building out some extensive library of pre-built MCP tools which will have security and governance on them." Not yet released. `[Episode 6, 33:30]`.
- **Current model:** Claude builds artifact JSON (screens, flows) → human imports via copy-paste → tests in Developer Mode. Autonomous MCP loop is on the roadmap.
- **No customer-facing chat/copilot product** as of 2026-05-19. Fuuz's AI surface is *developer-facing*, not technician-facing.

### Hosting
- Cloud SaaS + on-prem Fuuz Gateway for edge.
- Tenant-isolated databases.

### Notable observed details
- `Developer Mode` in the app designer surfaces every query, transform, and binding as the screen runs — best-in-class debugging UX.
- `Application graph` view renders every artifact (data models, flows, screens) and their relationships — strong "what's in this app" overview.
- "Mini UNS at the screen level": `screen.context` keyed object + page-load flows + component subscriptions — a clever pub/sub-in-the-browser pattern.

## Maintenance / CMMS / PLC relevance

- **Maintenance / CMMS:** Direct. Fuuz ships a CMMS module under their UMP umbrella; the ProveIt! Enterprise C demo includes work-order, alarm, and reliability surfaces (MTBF / MTTR dashboards).
- **PLC:** Reads via OPC UA / MQTT; not a PLC programming tool. Integrates with PLC simulators and real PLCs (Fanuc OPC UA demo).
- **Predictive maintenance:** Shipping. Fuuz's `fuuz-ml-telemetry` skill defines EWMA baselines, Z-score anomaly, Pearson correlation, breach prediction. Demonstrated live on bioreactor sensors at ProveIt!.

## Business model

- Enterprise / mid-market SaaS via the platform + module licensing model. (Pricing UNCONFIRMED publicly.)
- Strong NetSuite-ecosystem channel; resellers like Strategic Information Group + RF-SMART affiliations.
- **ICP:** discrete + process manufacturers (multi-site, multi-domain) that want a UNS + manufacturing apps without stitching 6 vendors.
- **GTM lean:** Craig is publicly authoring on LinkedIn weekly + producing the *Manufacturing Matrix* and *Fuuz Unplugged* podcast series. Heavy thought-leadership push around UNS + Claude Code + ISA standards.

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| Fuuz homepage | docs | https://www.fuuz.com/ | 2026-05-19 | UMP + UNS positioning |
| Embracing the Future: UNS + UMP blog | blog | https://www.fuuz.com/fuuz-blog/embracing-the-future-unified-namespaces-and-unified-manufacturing-platforms-in-modern-manufacturing | 2026-05-19 | The UMP thesis |
| Platform architecture page | docs | https://www.fuuz.com/infrastructure/platform-architecture/ | 2026-05-19 | Architecture overview |
| MES module page | product | https://www.fuuz.com/fuuz-modules/manufacturing-execution-system-mes | 2026-05-19 | MES surface |
| **Episode 6 — AI on the Factory Floor (full transcript)** | video | https://youtu.be/xKuq5FDomkg | 2026-05-19 | 58 min, Craig walks through the ProveIt! 2026 build, Claude workflow, UNS architecture |
| **fuuz-skills (public repo)** | code | https://github.com/Fuuz-Industrial-Intelligence/fuuz-skills | 2026-05-19 | 7 Claude Code skills, ~43k lines of reference docs |
| **proveit2026 (public repo)** | code | https://github.com/Fuuz-Industrial-Intelligence/proveit2026 | 2026-05-19 | 3 `.fuuz` packages: 100 models, 73 screens, 94 flows |
| LNS Research — ProveIt 2026 coverage | analyst | https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code | 2026-05-19 | Names Fuuz as DataOps-embedded-in-platform |
| Tech-Clarity coverage (iPaaS modules) | analyst | https://tech-clarity.com/ipaas-and-modules-fuuz/20213 | 2026-05-19 | Independent analyst writeup |
| Tech-Clarity coverage (industrial intelligence platform) | analyst | https://tech-clarity.com/industrial-intelligence-platform/23104 | 2026-05-19 | Fuuz enterprise positioning |
| Fuuz YouTube — Manufacturing Matrix / Fuuz Unplugged | video | https://www.youtube.com/@fuuz (channel) | 2026-05-19 | Several episodes catalogued in [videos/video-index.md](../videos/video-index.md) |

## What MIRA should emulate

1. **Public Claude Code skill library.** Fuuz's `fuuz-skills` is the single best public artifact of "this is how to make an AI-native industrial product." We should structure MIRA's own publicly-readable rules + skills the same way — numbered, deeply-versioned, paired with reference docs.
2. **Module catalog under a UNS.** Their framing — *one UNS, many apps* — is the most explicit public proof of MIRA's working model: KG + UNS + Slack copilot + Atlas CMMS as a coordinated set, not one monolith.
3. **"Universal language of common names" framing.** Steal the customer-facing language for what MIRA's UNS gate enforces.
4. **Developer-Mode-style live trace.** When MIRA does build a Hub admin surface, a "show me every query / classifier / proposal / citation that produced this answer" view is the right shape.
5. **Application-graph view** — when MIRA's component-template editor matures, render its data models + flows + UI as one visual map.
6. **Skill semver + manifest.** `SKILLS_VERSION_MANIFEST.md` with status (`draft`/`review`/`ready`/`deployed`/`deprecated`/`baked-in`) is a clean pattern. MIRA's `.claude/skills/` should track the same way.

## What MIRA should avoid

- **Don't try to ship MES + WMS + APS modules.** That's the Fuuz lane, well-defended. MIRA stays maintenance-only — see `mira-saas-scope-guard`.
- **Don't drift into NetSuite-tied positioning.** Our channel is Slack + technician workflow, not ERP-ecosystem-bound.
- **Don't replicate the "build apps in our designer" surface.** MIRA's product is the *answer*, not the *app builder*.
- **Don't release skills without a license.** Fuuz hasn't (yet) — if MIRA publishes skill files, choose Apache 2.0 or MIT (per PRD §4) from day one.

## Integration opportunity

- **Medium-high.** Fuuz's CMMS module is a candidate for a "MIRA grounds in your Fuuz UNS" integration:
  - Fuuz publishes ISA-95 UNS topics → MIRA subscribes via `mira-relay` → grounds Slack replies in real-time tag data.
  - Fuuz exposes work-order data via GraphQL Application API → MIRA's `mira-mcp` reads it.
  - Fuuz customers who picked the platform for the UNS but find the CMMS module thin → MIRA + Atlas can fill the maintenance copilot gap without forcing them to swap CMMS.

- **Sales motion:** "Keep your Fuuz UNS. Let MIRA give your technicians the maintenance copilot Fuuz doesn't build."

## Threat level to MIRA

- **Score:** Medium-high (was Medium pre-deep-dive; raised on evidence of working Claude-Code AI development pipeline).
- **Why:** They have (1) a UNS + CMMS module under one roof, (2) an active analyst story, (3) a working public Claude Code workflow, (4) an upcoming MCP tool catalog. The only thing keeping the threat from being "high" is that **their AI surface is developer-facing, not technician-facing** — they're shipping "build apps faster," not "get a correct maintenance answer." If they pivot the LLM to a technician chat product, the threat tightens substantially.

## Usefulness score for MIRA learning (1-5)

- **Score:** 5
- **Why:** Two reasons.
  - **Architectural:** Cleanest public articulation of *UNS + KG-equivalent + LLM-skills-stack* in industrial software. Useful both for messaging and for confirming MIRA's bet.
  - **Process:** First publicly-readable artifact of how a manufacturing platform vendor uses Claude Code in earnest. Worth studying as a how-to, not just a competitor.

## Open questions

- [ ] What's the depth of the Fuuz CMMS module — is it MaintainX-level or a checkbox? (Open since prior review.)
- [ ] Public API for reading the UNS / models? (Yes — Application + System GraphQL APIs. Confirmed.)
- [ ] Any shipping LLM features as of 2026-05-19? (**Yes** — public Claude skills + active demo applications. The "in-platform copilot" piece is roadmap. Confirmed.)
- [ ] How customers reconcile Fuuz CMMS module with an existing MaintainX / Limble / Fiix install? (Still open.)
- [ ] Pricing model — per-module or bundle? (Still UNCONFIRMED.)
- [ ] What's in the upcoming Fuuz MCP catalog? (Still UNCONFIRMED — Craig mentioned RBAC + governance focus.)
- [ ] License on `fuuz-skills` and `proveit2026` repos? (No LICENSE files; treat as proprietary.)
- [ ] Multi-tenant data isolation strategy — per-database is heavy at scale; does Fuuz plan to consolidate? (UNCONFIRMED.)
- [ ] What does Craig's "I'm shifting more towards Claude Code over Claude Desktop" mean for skill UX evolution? Are Fuuz skills designed for terminal Claude Code or also the desktop app? (Skill docs work in both.)

## MIRA lessons (top 3)

1. **The platform is the moat, not the AI.** Craig's "100% confidence in this application implemented at my factory — because it's built using the standardized building blocks within Fuse" `[45:30]` is the entire AI-native-industrial thesis. MIRA's equivalent is: grounded KG + UNS gate + Slack-front-door are the moat; the LLM is glue.
2. **Skills are captured corrections, versioned and shipped.** Fuuz's 71 golden rules in `fuuz-packages` *plus* the version manifest are the artifact every MIRA `.claude/rules/` and `.claude/skills/` should grow toward.
3. **Bundled platform exists, and customers buy it.** MIRA's correct counter-positioning is *specialist* — we're the best at grounded maintenance chat, and we plug into whichever UMP/UNS the customer chose. Lean into integration, not replacement.
