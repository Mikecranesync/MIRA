# HiveMQ

## Identity

- **Name:** HiveMQ
- **Website:** https://www.hivemq.com/
- **HQ:** Landshut, Germany
- **Category:** MQTT broker + Sparkplug B steward + UNS evangelist
- **ProveIt involvement:** Co-publishes the [2026 Industrial Data & AI Readiness Survey](https://www.hivemq.com/) with Inductive Automation and HighByte — strong ProveIt-ecosystem alignment.
- **Industry 4.0 relevance score (1-5):** 5
- **MIRA overlap (1-5):** 2 — infrastructure layer, not a maintenance copilot
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (public summary)

HiveMQ ships an enterprise MQTT broker (3.1.1, 5.0) with strong Sparkplug B support, used as the central nervous system for Industrial IoT deployments. They are also the most prolific public educator on **MQTT Sparkplug + ISA-95 + Unified Namespace**, with a deep library of explainer content. Their 2026 thesis frames the broker as the foundation for **AI-ready industrial data**.

## Architecture (as publicly described)

- **Data model / hierarchy:** ISA-95-aligned UNS pattern (Enterprise → Site → Area → Line → Cell → Asset). [Smart Manufacturing Using ISA95, MQTT Sparkplug and the UNS](https://www.hivemq.com/resources/smart-manufacturing-using-isa95-mqtt-sparkplug-and-uns/).
- **UNS / namespace approach:** The broker IS the UNS in HiveMQ's framing. Sparkplug B's `group_id` / `edge_node_id` / `device_id` map naturally to UNS hierarchy levels. They publish a long series of explainers including [Implementing UNS With MQTT Sparkplug](https://www.hivemq.com/blog/implementing-unified-namespace-uns-mqtt-sparkplug/) and [Semantic Data Structuring with MQTT Sparkplug and UNS](https://www.hivemq.com/blog/semantic-data-structuring-mqtt-sparkplug-unified-namespace-uns-smart-manufacturing/).
- **Protocols supported:** MQTT 3.1.1, MQTT 5.0, MQTT-SN, Sparkplug B (Tahu / TCK compliant). HiveMQ Edge extends to OPC-UA, Modbus, Profibus ingest.
- **AI / ML usage:** They don't ship AI themselves; they market the broker as the "AI-ready" data plane. Their [5 Key Factors to Choose an MQTT Broker for the AI Era in 2026](https://www.hivemq.com/blog/5-key-factors-choose-mqtt-broker-ai-era/) is a strong articulation of "AI needs governed, observable, secure pub/sub."
- **Hosting / deploy model:** Self-hosted (Java, Kubernetes-friendly), HiveMQ Cloud (managed), HiveMQ Edge (lightweight gateway).
- **Notable repos:** HiveMQ maintains a non-trivial OSS footprint at [github.com/hivemq](https://github.com/hivemq) including HiveMQ Community Edition broker, MQTT clients (Java, Swift), HiveMQ Edge, Sparkplug-related tools. Worth deeper review under `repos/`.
- **Notable screens / UX:** HiveMQ Control Center + Data Hub UI; topic browser, schema registry, kafka bridge config. Their UX is admin-facing, not technician-facing.

## Maintenance / CMMS / PLC relevance

- **Maintenance:** None directly. They are infrastructure that maintenance copilots like MIRA grounds against.
- **CMMS:** None.
- **PLC:** Read tag streams via HiveMQ Edge (OPC-UA, Modbus). Don't author logic.

## Business model

- Tiered enterprise licensing (Professional / Enterprise), HiveMQ Cloud subscription, HiveMQ Edge (free with paid tiers).
- ICP: enterprise IIoT with > 10K devices; automotive, energy, smart cities, manufacturing.

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| MQTT Sparkplug solution page | docs | https://www.hivemq.com/solutions/technology/mqtt-sparkplug/ | 2026-05-19 | Sparkplug + UNS pitch |
| Implementing UNS With MQTT Sparkplug | blog | https://www.hivemq.com/blog/implementing-unified-namespace-uns-mqtt-sparkplug/ | 2026-05-19 | Step-by-step UNS pattern |
| Smart Manufacturing Using ISA95, MQTT Sparkplug and UNS | whitepaper | https://www.hivemq.com/resources/smart-manufacturing-using-isa95-mqtt-sparkplug-and-uns/ | 2026-05-19 | ISA-95 mapping reference |
| Semantic Data Structuring with Sparkplug + UNS | blog | https://www.hivemq.com/blog/semantic-data-structuring-mqtt-sparkplug-unified-namespace-uns-smart-manufacturing/ | 2026-05-19 | Payload + topic semantics |
| 5 Key Factors to Choose an MQTT Broker for the AI Era | blog | https://www.hivemq.com/blog/5-key-factors-choose-mqtt-broker-ai-era/ | 2026-05-19 | "AI-ready broker" framing |
| Connecting Ignition to MQTT and HiveMQ | partner blog | https://www.hivemq.com/blog/a-step-by-step-guide-connecting-ignition-mqtt-hivemq/ | 2026-05-19 | Concrete Ignition + HiveMQ recipe |
| github.com/hivemq | repos | https://github.com/hivemq | 2026-05-19 | Active OSS org — pull Community Edition + Edge for `repos/` deep dives |

## What MIRA should emulate

- **Their pedagogy.** The HiveMQ blog is the clearest public articulation of UNS+Sparkplug B in industry. Mirror this style of doc when explaining MIRA's UNS gate.
- **ISA-95 hierarchy as canonical.** Their `enterprise/site/area/line/cell/asset` shape is exactly the shape MIRA's UNS uses. Validates `docs/specs/uns-kg-unification-spec.md`.
- **Sparkplug B Tahu / TCK compliance posture.** When MIRA's relay handles Sparkplug, target conformance with the Tahu reference, not "just enough."

## What MIRA should avoid

- **Don't confuse "broker = UNS" with "model = UNS".** HighByte makes the explicit counter-argument (see [companies/highbyte.md](highbyte.md)). MIRA's stance must remain "the model is the UNS; the broker is plumbing." HiveMQ's framing is technically valid but tilted to sell brokers.
- **Don't try to be a broker.** Their economics (high scale, low margin per topic) are alien to ours.

## Integration opportunity

- **Medium-High.** HiveMQ + Sparkplug B is the most common stack MIRA will land into. Reasonable next step: a published reference recipe "MIRA on HiveMQ" that ingests Sparkplug B birth/data messages and writes UNS context into NeonDB.
- Their Data Hub + schema registry is a candidate substrate for component-template definitions. UNCONFIRMED whether their schema layer can host MIRA's component-profile shapes.

## Threat level to MIRA (low / medium / high)

- **Score:** Low
- **Why:** They sell brokers. We don't compete; we sit on top. Watch only for a "HiveMQ Insights" copilot — unlikely from a broker company, but worth a quarterly check.

## Usefulness score for MIRA learning (1-5)

- **Score:** 5
- **Why:** Best public reference material on the protocol/topology layer MIRA must interop with. Read their blog before touching Sparkplug in `mira-relay/` or `mira-crawler/ingest/uns.py`.

## Open questions

- [ ] Does HiveMQ Data Hub + schema registry support custom schemas at the granularity MIRA's component templates need?
- [ ] What's the recommended Sparkplug B birth-certificate payload shape for an asset that has 50+ tags?
- [ ] Are there published HiveMQ + AI-agent reference patterns yet?
- [ ] Does their TCK include CMMS/maintenance-relevant payload conventions, or is that out of scope?

## MIRA lessons (1-3 bullets)

- Use HiveMQ's blog as canonical reference when documenting MIRA's UNS / Sparkplug B handling — don't re-derive. Link to specific posts from `docs/specs/uns-kg-unification-spec.md` if not already done.
- The HighByte-vs-HiveMQ framing tension ("model is UNS" vs "broker is UNS") is the cleanest external way to explain MIRA's design choice. Use it in pitch materials.
- HiveMQ's OSS Community Edition + HiveMQ Edge are candidates for the **MIRA staging environment** broker — beats hand-rolled Mosquitto for Sparkplug B conformance testing. Worth a small ADR.
