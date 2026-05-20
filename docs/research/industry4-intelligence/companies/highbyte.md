# HighByte

## Identity

- **Name:** HighByte, Inc.
- **Website:** https://www.highbyte.com/
- **Category:** UNS / Industrial DataOps
- **ProveIt involvement:** UNCONFIRMED (likely speaker / sponsor track based on adjacent ecosystem appearances)
- **Industry 4.0 relevance score (1-5):** 5
- **MIRA overlap (1-5):** 4 — strong substrate overlap (UNS / model layer); not a maintenance copilot
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (public summary)

HighByte sells **Intelligence Hub**, an edge-native Industrial DataOps product that lets manufacturers "collect, merge, model, and stream ready-to-consume datasets to target applications without writing or maintaining code." Its central thesis is that the Unified Namespace is **not** the broker — it's the **modeling layer** that decides what gets published. Intelligence Hub now ships with an embedded MQTT v3.1.1 / v5 broker (JSON and Sparkplug payloads). HighByte was named a Leader in the [IDC MarketScape Worldwide Industrial DataOps Platforms 2026 Vendor Assessment](https://www.businesswire.com/news/home/20260407774829/en/HighByte-Positioned-as-a-Leader-in-IDC-MarketScape-for-Worldwide-Industrial-DataOps-Platforms).

## Architecture (as publicly described)

- **Data model / hierarchy:** Customer-defined hierarchies (ISA-95-aligned: enterprise / site / area / line / asset). Models are user-editable "instances" + "definitions" — explicit modeling layer separate from raw tags. (Source: highbyte.com/intelligence-hub.)
- **UNS / namespace approach:** HighByte's blog ["Is the Intelligence Hub a Unified Namespace?"](https://www.highbyte.com/blog/is-highbyte-intelligence-hub-a-unified-namespace) argues a UNS = **broker + payload spec + model**. They sell the *model* layer and integrate with brokers. Intelligence Hub now also embeds its own broker.
- **Protocols supported:** OPC-UA, MQTT (incl. Sparkplug B), REST, SQL, Kafka, file-based, plus connectors to Ignition, AVEVA, Azure, AWS IoT, Snowflake, Databricks. INFERENCE: connector list grows yearly — see latest docs.
- **AI / ML usage:** Per IDC writeup, HighByte is "developing Model Context Protocol (MCP)-oriented services to better support the rapidly growing demand for agentic AI integration and governance" — i.e., they intend to expose their modeled data as MCP tools to AI agents. (Source: businesswire IDC MarketScape coverage, April 2026.)
- **Hosting / deploy model:** Edge-native software, self-hosted by the customer on-prem or in their cloud. AWS publishes a [reference architecture](https://aws.amazon.com/solutions/guidance/industrial-data-fabric-with-highbyte-intelligence-hub-on-aws/) ("Industrial Data Fabric with HighByte Intelligence Hub on AWS").
- **Notable repos:** UNCONFIRMED. HighByte does not appear to maintain a public OSS repo footprint comparable to HiveMQ's. Their docs are the primary public artifact.
- **Notable screens / UX:** Browser-based model editor with hierarchy tree + tag mapping + flow visualizer. Screenshots on highbyte.com/intelligence-hub.

## Maintenance / CMMS / PLC relevance

- **Maintenance:** Indirect — they don't ship a maintenance app. They ship the data substrate a maintenance app would consume.
- **CMMS:** Connectors to common targets (Snowflake, SAP, Azure) make CMMS integration practical, but they don't own a CMMS surface.
- **PLC programs / tags:** Read-only tag ingest via OPC-UA + Ignition + native drivers. They do not author PLC logic.

## Business model

- Quote-based enterprise sales. Per-instance / per-CPU licensing — UNCONFIRMED pricing tiers.
- Channel partners: AWS, Snowflake, Inductive Automation, Cumulocity (Software AG), Databricks.
- ICP: discrete + process manufacturers with > $500M revenue; multi-plant operations.

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| HighByte Intelligence Hub | docs | https://www.highbyte.com/intelligence-hub | 2026-05-19 | Product overview, embedded broker mentioned |
| Is the Intelligence Hub a UNS? | blog | https://www.highbyte.com/blog/is-highbyte-intelligence-hub-a-unified-namespace | 2026-05-19 | Their definition of UNS — model + broker + spec |
| IDC MarketScape leader announcement | press | https://www.businesswire.com/news/home/20260407774829/en/HighByte-Positioned-as-a-Leader-in-IDC-MarketScape-for-Worldwide-Industrial-DataOps-Platforms | 2026-05-19 | MCP-services tease confirms agentic-AI direction |
| AWS Industrial Data Fabric guidance | reference arch | https://aws.amazon.com/solutions/guidance/industrial-data-fabric-with-highbyte-intelligence-hub-on-aws/ | 2026-05-19 | Reference deployment pattern |
| HighByte + Ignition use cases | blog | https://www.highbyte.com/blog/highbyte-and-ignition-two-powerful-solutions-in-your-modern-data-architecture | 2026-05-19 | Co-deploy pattern |

## What MIRA should emulate

- **Treat the model as separate from the broker.** HighByte's "UNS = model + broker + payload spec" framing matches MIRA's own model: `mira-crawler/ingest/uns.py` + the KG (`kg_entities`/`kg_relationships`) is our modeling layer; the broker (Mosquitto / Ignition / HiveMQ at the customer) is plumbing. The argument is on our side.
- **Explicit "instance vs definition" modeling.** This is the same shape as MIRA's component templates (per-model definition vs per-instance attachment). Cross-reference with `.claude/skills/component-profile-builder/SKILL.md`.
- **Code-free flow editor.** Intelligence Hub's GUI for routing tags → models is a UX target for any future MIRA admin surface (the Hub-side namespace builder, `mira-hub/`).
- **MCP-oriented exposure of modeled data.** This validates the bet behind `mira-mcp/` — exposing curated, governed slices of plant context to LLMs/agents over MCP is becoming a category standard, not a quirk.

## What MIRA should avoid

- **Don't try to be the broker.** HighByte already owns this layer for serious customers; competing wastes our wedge.
- **Don't replicate their "no-code" admin model** at the level of granularity they have. Their target user is a DataOps team. MIRA's target user is a maintenance technician — a different UX target. A simplified, opinionated UNS admin (in `mira-hub/`) is fine; a full IDE is scope creep.

## Integration opportunity

- **HighByte is the most natural partner in the Tier 1 list.** They model the plant; we ground a maintenance copilot in that model.
- Concrete vector: a sample integration that ingests HighByte models (via their REST API or their MCP services when shipped) into MIRA's KG and demonstrates a grounded maintenance answer. This is **demo-able** and **non-overlapping**.
- Likely contact path: their partner program (channel) — UNCONFIRMED whether they have a formal MCP partner track yet.

## Threat level to MIRA (low / medium / high)

- **Score:** Low (today) → Medium (if they ship a maintenance app)
- **Why:** Different ICP and different surface today. The MCP push means they'll likely host *generic* agentic surfaces, not a domain-specific maintenance copilot — but watch them.

## Usefulness score for MIRA learning (1-5)

- **Score:** 5
- **Why:** Closest public articulation of the modeling-layer thesis we already act on. Validates our UNS-is-separate-from-broker stance; their MCP direction validates `mira-mcp/`.

## Open questions

- [ ] Do they offer a public REST API for hierarchies / models that MIRA could read directly?
- [ ] What does their MCP service expose — read-only model + tag values, or also action endpoints?
- [ ] Is there a partner program with formal terms (logo, demo center, lead share)?
- [ ] Public reference architecture for "HighByte + maintenance copilot" — does one exist today? (Probably not — opportunity.)

## MIRA lessons (1-3 bullets)

- HighByte's framing is the public proof that MIRA's "UNS modeling layer separate from broker" decision was correct. Cite this externally when explaining MIRA architecture.
- Their MCP direction means MIRA's `mira-mcp/` strategy should explicitly plan for **federated** MCP — MIRA reads from HighByte's MCP and exposes its own grounded-answer MCP, rather than re-modeling the plant.
- The "no-code flow editor" UX is the gold standard for the Hub-side namespace builder. Anchor the namespace-builder spec UX to a simpler subset of this.
