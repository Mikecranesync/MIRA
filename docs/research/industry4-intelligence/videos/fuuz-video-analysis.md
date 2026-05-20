# Fuuz Video Analysis — Episode 6: AI on the Factory Floor (ProveIt! 2026)

- **Video:** https://youtu.be/xKuq5FDomkg
- **Channel:** Fuuz
- **Title:** *AI on the Factory Floor: Inside Fuuz's 2026 ProveIt! Demo | Episode 6*
- **Host:** Craig Scott (Founder & CEO, Fuuz)
- **Duration:** ~58 min
- **Recorded:** Shortly after ProveIt! 2026 Dallas (Fuuz Unplugged podcast format, "Episode 6")
- **Transcript (full):** [fuuz-transcripts/fuuz-video-xKuq5FDomkg.md](fuuz-transcripts/fuuz-video-xKuq5FDomkg.md)
- **Analyzed:** 2026-05-19 by claude-code
- **Confidence:** HIGH for direct quotes / observations; UNCONFIRMED labels applied to inferences.

> **Reading guide:** Section ① is the *what* (positioning + product surface). Sections ②–⑥ extract reusable architectural and AI-development patterns. Section ⑦ is the explicit MIRA mapping.

---

## ① What Fuuz showed at ProveIt! 2026 — and how Craig framed it

### Positioning (direct quotes, paraphrased only where noted)

- "If you've followed us on LinkedIn at all, you know that we posted our **Claude skills** out there on Git for you… also available in our knowledge base at support.fuuz.com." `[00:30]`
- Conference cohort: Fuuz presented Thursday morning **immediately after CESMII** (who presented the alpha release of the **i3X GraphQL API** — "open and agnostic interface and exchange of data between enterprise systems"). `[02:30]`
- "Anybody that knows Fuuz knows that [openness] has been our mantra for the past 10 years. So we embraced that." `[03:00]`
- Audience straddle thesis: most IT folks "have never heard of a unified namespace, MQTT, or message brokers"; most OT folks "really don't think too much about security, governance, API protocols." Fuuz pitches itself as the layer that brings both together. `[01:30]`
- ProveIt! virtual factories: Enterprise A (discrete glass-bottle production, 2025), Enterprise B (mixed-mode bottling/liquid filling, 2026), Enterprise C (life-sciences / bioreactors). Fuuz focused on **Enterprise B + C**. `[03:30]`

### Team size and timeline

- "When I say 'we' I mean a team of two of us essentially — **Claude and myself**." `[11:00]`
- "This whole entire application came together very quickly over the course of a couple weeks." `[45:30]`
- ProveIt! deliverables (per the proveit2026 README): **3 fuuz packages**, **100 data models**, **73 screens**, **94 flows**, built "in 2–3 weeks part-time."

### The throwaway thesis line of the whole video

> "[AI] is really good at helping do some of the heavy lifting instead of sitting here scratching your head for hours or days … but you have to be really, really good at evaluating the output. If you don't know what the output should look like, skills or no skills, you're not going to end up with a very good application. Learn your domain, be really good at your domain. It's a great enabler, but … it's an assistance. It's not a replacement for anybody." `[17:00–18:00]`

That's the Karpathy "think before coding" principle in a manufacturing accent. MIRA's CLAUDE.md already says this; Fuuz proves it ships.

---

## ② Industrial data architecture — what Fuuz did with UNS

### UNS treatment

- **External UNS = read + write.** Fuuz's gateway has an MQTT broker + client; it both **consumed** ProveIt!'s public UNS topics (Aveva, Software Toolbox, Dynix, et al. were also publishing) and **published back** "to show the openness of the whole idea." `[05:00]`
- **Public UNS = real-time only.** Craig: "What you won't find in here anywhere is any type of **historical data**. You cannot query the UNS. You can't ask it anything. You can't interrogate it. This is purely pub/sub. If you're not subscribing to a topic [when an event fires], that message is completely lost forever." `[05:00–12:30]`
- **Topic hierarchy = ISA-95.** `enterprise / site / area / line / cell / work unit / type` — matches Fuuz's skill docs (`fuuz/{site}/{area}/{line}/{cell}/{equipment}/{datatype}`). `[05:00]`
- **Multi-UNS reality.** Craig explicitly named **three UNSes** in play: (a) the public ProveIt! UNS, (b) the **internal Fuuz UNS** (every data change in Fuuz is event-driven and published to an internal broker), and (c) a **"mini UNS at the screen level"** he invented for the UI. `[20:30]`

### Why Fuuz can query history when MQTT can't

- Fuuz persists every data change in its data model. "Because [the internal UNS] is all data-change driven and tightly coupled to our data modeling, all of those data changes are persisted in the database." `[13:00]`
- On top of that they built a **GraphQL layer that is CESMII i3X-compliant**. `[13:30]`

> **The architectural insight:** UNS is the **event nervous system**; the **data model + GraphQL** is the queryable memory. Two separate layers, both first-class. This is the same shape MIRA needs — MQTT/Sparkplug for live, NeonDB `kg_entities`/`kg_relationships` for the queryable knowledge graph.

### Event-driven internals

- "The entire backend of Fuuz is event-driven by definition. Every time something changes in Fuuz, there is a message broker inside Fuuz and those messages are published to it. Other things within Fuuz can subscribe to those messages." `[07:00]`
- Surface examples of "events": operator records production / scrap, material handler receives goods, finance posts a journal entry, salesperson enters a sales order. **All cross-domain events flow through Fuuz as the centralized hub.** `[07:30]`
- "Doing integrations with Fuuz is super easy and they just work… because of the architecture behind the scenes." `[08:00]`

### The "data change → flow → ML → upsert" loop (paraphrased trace from the live demo)

1. Raw PLC value enters internal Fuuz UNS (subscribed via OPC UA `[36:00]`).
2. `dataChange` node trigger on Create fires a backend Flow.
3. Flow sets the incoming value in flow context (in-process memory cache).
4. GraphQL query fetches the **data point metadata** (asset ID, work-center, type, frequency, upper/lower limits, set-point, dead-band, alarm-enabled). `[37:30]`
5. **`mutex` lock** keyed by data-point ID — prevents racing on the same sensor when reads arrive at "200–250/sec" `[38:30]`.
6. Query baseline (TelemetryBaseline row) — empty array on first run for a sensor, then progressively filled. `[39:00]`
7. Query last **2,000 raw readings** for the tag (≈ last 3 hours at 120 reads/hour in the demo).
8. JavaScript node runs **Z-score / EWMA / trend** logic (the Claude-written one — pure vanilla JS, no libraries).
9. Output → `ml_insight` records (if anomaly) + **upsert** of updated baseline.
10. Mutex releases; next reading for that data point can flow.

This is a textbook real-time ML pipeline: O(1) per record, baseline as state, scheduled batches do the cross-record analysis. (The fuuz-ml-telemetry skill spells this out explicitly.)

---

## ③ Screens architecture — the "mini UNS at the screen level"

This is the most interesting **invention** in the demo and worth steady study.

- Every Fuuz screen has a **`screen.context`** keyed object that holds live state — KPIs, filters, current work-center, user, plant, schedule, OEE rollups. `[21:00]`
- UI components **subscribe** to keys in `screen.context` (like an MQTT broker but in-memory, in the browser).
- Two ways data lands in `screen.context`:
  1. **Page-load flows** (`pageLoadDataFlowIds` / `screenDataFlowIds`) — a server-side or client-side Flow runs on screen mount, returns aggregates, writes them into context.
  2. **Inline page-load scripts** ("caveman approach") — a small JSON-defined script with full GraphQL access that runs on load, writes context. `[24:00–25:30]`
- Tables can bypass context entirely and use **native table queries** with auto-load + JSON transforms (filters in the demo screen). `[22:30]`
- The OEE dashboard `screen.context` for one work-center had **everything** — work-center, schedule, current state, mode duration, hourly OEE, MTTR/MTBF, baseline values, throughput, total/good/scrap, loss analysis, top downtime reasons — "not all displayed, but available." `[49:30–51:30]`

> **Why it's a "mini UNS":** the same pub/sub semantics, but scoped to a single rendered screen. Components don't fetch — they subscribe to `screen.context.workcenter.current_state`. When the underlying flow updates that key, every subscribing component re-renders.

> **Why it matters for MIRA:** MIRA's Slack reply is conceptually the inverse — Slack is **append-only output**, no subscribable UI state. But if MIRA ever ships a *technician dashboard* (mira-web, mira-hub), this is the pattern to copy. And the inverse direction also applies: MIRA can publish "agent context" (current asset under troubleshooting, last citation, confidence) into a screen-context-like store, so that downstream surfaces (a Linear card, a Hub feed, a workorder UI) subscribe instead of polling.

---

## ④ Claude Code workflow patterns Craig described

These are the patterns Fuuz **distilled into their public skills**. They're free observations of how a working AI-native industrial vendor uses Claude Code today.

### Pattern A — Skills as captured corrections, not specs

> "Over time of correcting that behavior, what we've done is **captured all of those corrections into what we call skills**. So now you can implement those skills into Claude." `[14:30]`

- Skills are *retrospective* — every "no, do it this way" becomes a rule in the SKILL.md.
- The `fuuz-packages` skill has 71 "golden rules" — every one is the residue of a past mistake.
- Result: the SKILL.md is the **organizational memory** for "how we use Claude on our platform." Same pattern as MIRA's `.claude/rules/` files (uns-compliance, python-standards, etc.).

### Pattern B — Frame the structure yourself, delegate the heavy lifting

> "Mine personally, because I like having a little bit more control, is I will actually **frame out the data flow in Fuuz** — I know the steps that need to happen. I like to frame that out but then utilize Claude to just do the heavy lift." `[26:30]`

Concrete example: Craig built the **node skeleton** (query → JSON transform → JavaScript → upsert → mutex) by hand, then handed Claude the JavaScript spec ("ISO 22400-compliant work-center state-change generator") and pasted the output into the JS node. `[27:00]`

### Pattern C — Claude Code over Claude Desktop, because of context

> "I'm shifting more towards utilizing Claude Code for doing most things just because … it works with a local directory, builds the files, updates the files. With Claude Desktop, having to constantly feed things back to it, you run out of context pretty quickly. With Claude Code I can iterate quite a bit more and quicker without having to move on to a new conversation." `[25:30]`

### Pattern D — Copy-paste workflow keeps a human in the loop

> "I personally like this copy-and-paste workflow because **it keeps me in the loop**. What I am really not sure of yet is just letting Claude make these changes directly for me in Fuuz. We will get there — likely through the MCP tools." `[33:00]`

Today: Claude writes the screen JSON → Craig downloads → imports through Fuuz UI ("Application Designer → Screen → blank → File → Import").
Tomorrow: Fuuz MCP server (in build) writes directly, with **role-based access controls + governance**.

### Pattern E — Test, validate, debug — the loop is non-negotiable

> "When I say you have to test it, this is exactly how we go about testing." `[19:30]`

Demo'd Developer Mode in the Fuuz app designer: pops the rendered screen in a tab, turns on a developer console, shows every query and transform happening, lets you click an "Acknowledge" button and watch the data path light up.

### Pattern F — "Rube-Goldberg detection"

> "It will uh generate the Rube Goldberg of solutions when it really doesn't need to … in our particular case with Fuuz because it may not be entirely up to speed on all of the custom bindings that we've created for JSON and JavaScript, it might do something in 5 or 10 lines of code that I know I can do with a single binding." `[28:00–28:30]`

This is why the skills exist — every "Claude wrote a 10-line block where the platform has a 1-call binding" becomes a rule in `fuuz-platform/references/jsonata-bindings-complete.md`.

### Pattern G — Consistency as a first-class design rule

> "These are instructions that I provided Claude so that the application I'm building is consistent and people can actually use it. How many times have you built something with AI and said 'hey I need to make some changes' and what it gives you is nothing like the first thing — it's not an iteration, it's a complete redo." `[48:00–48:30]`

The skills enforce **layout consistency**: filters on the left, table in the center, three-dots menu column on the right — every CRUD screen in ProveIt! follows that template.

### Pattern H — Use the platform's *own packages* as LLM training data

> "Use those Fuuz packages in your own LLM. You can ask it to generate documentation, end-user work instructions, process flows for how the application works, troubleshooting. It'll go through all the flows, all the scripts, all the screens, and it'll find areas. It's not 100%, but it's darn close to 80–85% accurate." `[57:00]`

The exported `.fuuz` package (a tar of `manifest.json` + `definition.json` + `package-data.json`) is *self-describing* enough that a downstream LLM can summarize it. This is the same property MIRA wants for component templates — exported template = consumable by a downstream agent.

---

## ⑤ Anti-patterns Craig explicitly named

| Anti-pattern | Craig's take | Source |
|---|---|---|
| **"Vibecoded" apps** | "Those are garbage applications that don't scale. You would never run a factory on them." | `[45:30]` |
| **Letting Claude bypass the platform** | "I would have 100% confidence in this application implemented at my factory. Why? Because it's built using the standardized building blocks within Fuuz, scalable because it's running in the platform, secure because it has to adhere to our RBAC policies." | `[45:30]` |
| **No-domain users building apps** | "You can't just put somebody on building apps that has absolutely zero clue how the shop floor works." | `[54:30]` |
| **Treating MCP as automatic** | "[MCP autonomy is] still being figured out. We're in the process of building out some extensive library of pre-built MCP tools which will have security and governance on them — which is a big issue with MCP in general right now." | `[33:30]` |
| **Iterating screens forever via AI** | "Ideally you'll get an 80–85% complete screen out of AI and then you might spend another hour really just kind of fine-tuning it in Fuuz, getting it exactly how you want it." | `[31:30]` |

---

## ⑥ Notable technical implementation details

These are reusable bits MIRA can borrow or learn from directly.

### 6.1 Backend stack signals

- **Event-driven monolith feel.** A single internal message broker, data-change-driven, every domain (production, finance, CRM, materials) on the same bus. No microservices-per-domain visible in the demo.
- **GraphQL everywhere.** "Application API" (custom data models) and "System API" (platform: users, roles, tenants). Relay-style connections (`edges[].node`). Inline aggregation (`alarmState`-group `count`) saves a flow step.
- **JSONata for transforms.** Used heavily in screen bindings + flow transforms. Custom Fuuz bindings extend baseline JSONata (294 in the skill docs).
- **JavaScript transform engine = ES5-restricted.** No `let`, no arrow fns, no template literals, no destructuring, no `.toFixed()`. The fuuz-ml-telemetry skill spells this out precisely. This is a deliberate constraint for V8-isolate-ish flow nodes.
- **Mutex on data-point ID** for sensor-burst races — a battle-tested pattern.

### 6.2 KPI/metric coverage in the live demo

- **88,654 active alarms** in the demo at the time of recording — Craig used the numbers to argue the math works ("16 acknowledged, 33 cleared in last 30d, averaging 123/hr"). `[18:00]`
- **OEE dashboard** with: hourly OEE, shift OEE, rolling 24-hr OEE, MTBF, MTTR, current state + mode + duration, loss analysis, top downtime reasons, throughput, units/hour, total/good/scrap.
- **Loss tracking** uses 12 categories + 75 specific reasons (proveit2026 README).
- **State / Mode model.** 8 modes × 14 states (per proveit2026 README). ISO 22400 compliant.

### 6.3 Bioreactor batch-prediction example (Enterprise C)

Demonstrates the "predictive maintenance" lane:

- Real-time sensor ingest from ProveIt! UNS → Fuuz historian (their own, built via data modeling) → 3 web flows for analysis. `[09:00]`
- "Correlation pairs" between sensors over a period — over time as batches complete manually, the system learns the trend/anomaly signature.
- Goal: **predict when a batch is ready for harvest** without manual sampling.
- ML algorithm = **pure vanilla JavaScript** (no library), written by Claude inside a Fuuz Flow JavaScript node.

### 6.4 Application graph — one diagnostic surface for "what's in this app"

> "Let's look at the application graph. So this is the whole app right here. All of the purple are data models like data point. We have all of these flows. We have all of these screens. This is an entire maintenance application." `[46:00]`

Fuuz renders a **graph of every artifact in an application** — data models, flows, screens — with relationships. This is the single most underrated dev-experience feature in the demo and a strong candidate to copy for MIRA's component-template editor.

### 6.5 Cross-tenant orchestration

- ProveIt! Enterprise B (WMS) is a **different Fuuz tenant** from Enterprise C (IIoT/MES). Craig hit this when he showed an alarm-dashboard error: "this is missing the data model. This was in Factory C which has an alarms data model. This however I'm in Factory B which is warehouse management — does not have an alarms data model." `[30:30]`
- "I can operate my facilities very differently. They don't have to be identical cookie cutters … but if I needed an alarms data model in Factory B it'd be simple enough for me to import it." `[30:30]`

> Mira parallel: per-tenant schema flexibility is a goal for Hub, but MIRA's KG schema is global — `kg_entities` / `kg_relationships` with `tenant_id`. Fuuz's model is **separate database per tenant** (per the platform skill). Two different choices, each with consequences.

### 6.6 Connector catalog signal

The `fuuz-platform/references/connectors-reference.md` lists **44 built-in connectors** including SAP, Plex, NetSuite (SOAP + REST), Infor, Epicor, Dynamics 365, Salesforce, Arena, plus 13 device-driver types and 19 named device drivers. ERP integration is a Fuuz first-class concern.

---

## ⑦ Direct MIRA mapping — what we steal, what we leave

> Full lessons in [mira-lessons/mira-lessons-from-fuuz.md](../mira-lessons/mira-lessons-from-fuuz.md). This is the shortlist.

### What Fuuz proves about MIRA's direction (validation, not invention)

1. **UNS = nervous system; KG = memory.** Fuuz makes the same architectural split MIRA already has (UNS/MQTT/Sparkplug live + NeonDB KG queryable). Two separate layers, both first-class. MIRA's bet is the same shape.
2. **AI assistant ≠ replacement.** Craig's "you have to be really, really good at evaluating the output" is exactly MIRA's UNS confirmation gate framing: ground the LLM before letting it speak. Both teams arrived at the same constraint independently.
3. **Skills as captured corrections.** Fuuz's skill files are a public artifact of the pattern MIRA's `.claude/rules/` and `.claude/skills/` already follow. We're not the only ones doing this.
4. **The platform is the moat, not the AI.** "It's built using the standardized building blocks within Fuuz, scalable, secure because of RBAC." MIRA's equivalent: grounded KG + UNS gate + Slack-front-door, with the LLM as a glue layer.
5. **A "mini UNS" inside the UI** is a clever pattern for component-level dashboards. (Future MIRA Hub / mira-web pattern.)

### Where Fuuz and MIRA differ (and where MIRA's bet is sharper)

1. **Fuuz is a platform builder; MIRA is a focused copilot.** Fuuz wants you to *build* MES/WMS/OEE inside their platform with Claude. MIRA wants you to *answer maintenance questions* using your existing PLC/CMMS/UNS. The wedge is narrower.
2. **Fuuz sells configuration; MIRA sells answers.** Fuuz monetizes "build apps faster on our platform." MIRA monetizes "the technician got a correct, cited answer in 30 seconds." Different pricing surface, different ROI conversation.
3. **Fuuz's customer is the manufacturing IT/OT engineer. MIRA's customer is the technician.** Slack-first vs Application-Designer-first is a real positioning gap.
4. **Fuuz writes screens; MIRA refuses to.** MIRA's correct response when asked to "build a dashboard" is *no, MaintainX/Atlas/Fuuz/Tulip do that — MIRA grounds the diagnostic conversation*.

### What MIRA should not chase from Fuuz

- **Don't build a "fuuz-screens"-equivalent skill that emits screen JSON.** Out of MIRA's lane (see `mira-saas-scope-guard`). If a customer wants screens, send them to Fuuz/Tulip/Ignition Perspective.
- **Don't build a fuuz-packages-equivalent.** MIRA's deployable artifact is the **component template**, not an MES module.
- **Don't ship a generic OEE engine.** Atlas CMMS handles work-order/maintenance KPIs; OEE belongs to the MES the customer already runs.

### What MIRA should build, inspired by Fuuz (concrete proposals)

1. **`mira-uns-resolver` skill** — codify the "every retrieval starts with a UNS context lookup" rule the way Fuuz codifies "every model is `Reference`/`Object`." Already partly there (`.claude/rules/uns-compliance.md`); make it a Skill.
2. **`mira-component-template-builder` skill** — emit valid `kg_entities`/`kg_relationships` proposals with **evidence + confidence + promotion state**, the way `fuuz-packages` emits valid `package-data.json`. (Already started — `component-profile-builder` skill exists. Borrow the **golden-rules** structure from fuuz-packages.)
3. **`mira-flow-builder` for ingest pipelines** — formalize the manual → chunk → dedup → KG-propose pipeline as the way `fuuz-flows` formalizes data-flow node patterns. (`manual-ingestion-extractor` skill is the seed.)
4. **`mira-grounded-answer-builder` skill** — define the MIRA equivalent of fuuz-screens: a structured Slack-reply spec with hard rules (lead with UNS context, cite ≤3 sources, ask before troubleshooting, refuse if ungrounded). The `slack-technician-ux-writer` skill is the seed.
5. **Application graph for MIRA components.** A visual map of "for this asset, what manuals are cited, which work orders link to it, which proposals are pending" — the same idea as Fuuz's app graph but scoped to one component template.

### Proposed full skill adaptation plan

See [mira-lessons/mira-fuuz-skill-adaptation-plan.md](../mira-lessons/mira-fuuz-skill-adaptation-plan.md).

---

## ⑧ Open questions surfaced by this video

- [ ] What is the public MCP catalog Fuuz is building? Is it open-source? Same MCP shape as Anthropic's reference or Fuuz-specific?
- [ ] Are the `.skill` files licensed? (No LICENSE file in the public repo as of 2026-05-19 — see [fuuz-repo-analysis.md](../repos/fuuz-repo-analysis.md).)
- [ ] How much of the ProveIt! data is templated vs hand-crafted demo data? (See proveit2026 README — "By the numbers: 4 sites, 10 areas, 19 lines, 40 cells, 504 assets, 1,000+ data points." Looks templated.)
- [ ] What's the actual Z-score / EWMA implementation? (Visible in fuuz-ml-telemetry skill; should compare against MIRA's eventual baseline math.)
- [ ] How does the "screen context = mini UNS" pattern scale on 50+ component subscriptions? Re-render storms?
- [ ] Does the Fuuz Gateway also expose **Sparkplug B**, or just MQTT? (Skill mentions MQTT broker + client; Sparkplug not named in this video.)
- [ ] How does Fuuz handle the staging-vs-prod-tenant flow for AI-generated screens? Importing a screen JSON straight into production tenant seems risky.

---

## Sources

- Primary: [Episode 6 transcript (full)](fuuz-transcripts/fuuz-video-xKuq5FDomkg.md) — 1,343 segments, 58 min
- Repo cross-reference: [`fuuz-skills/README.md`](https://github.com/Fuuz-Industrial-Intelligence/fuuz-skills) (read locally 2026-05-19)
- Repo cross-reference: [`proveit2026/README.md`](https://github.com/Fuuz-Industrial-Intelligence/proveit2026) (read locally 2026-05-19)
- Industry context: [LNS Research — ProveIt! 2026 coverage](https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code)
- Standards backing the demo: ISA-95, ISO 22400 (state classification), CESMII i3X (GraphQL exchange spec)
