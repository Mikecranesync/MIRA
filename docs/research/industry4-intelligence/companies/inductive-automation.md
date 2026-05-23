# Inductive Automation (Ignition)

## Identity

- **Name:** Inductive Automation
- **Product:** Ignition (SCADA + IIoT platform)
- **Website:** https://inductiveautomation.com/
- **HQ:** Folsom, California, USA
- **Category:** SCADA / HMI / IIoT platform
- **ProveIt involvement:** Active member of the broader UNS / Sparkplug B ecosystem; speakers at HiveMQ joint surveys. UNCONFIRMED whether they are explicit ProveIt founders.
- **Industry 4.0 relevance score (1-5):** 5
- **MIRA overlap (1-5):** 4 — they own the SCADA + tag layer MIRA grounds against; not a maintenance copilot today
- **Last reviewed:** 2026-05-19
- **Reviewer:** claude-code

## What they do (public summary)

Inductive Automation ships **Ignition**, a SCADA / HMI / IIoT platform with unlimited-tag licensing and native MQTT + Sparkplug B via the Cirrus Link modules (Transmission / Engine / Distributor). Ignition has a dedicated [Unified Namespace solution page](https://inductiveautomation.com/solutions/unified-namespace) and a deep installed base in North American discrete + process manufacturing. The product wedge is HMI/SCADA, but the marketing thesis has moved to "Ignition is the UNS hub."

## Architecture (as publicly described)

- **Data model / hierarchy:** Tag-centric. Ignition Tag Providers organize tags into folder hierarchies; UDTs (User-Defined Types) provide instance-vs-definition modeling. The standard UNS pattern is `enterprise/site/area/line/asset/tag`.
- **UNS / namespace approach:** Inductive Automation's official UNS solution page positions Ignition as the platform that can ingest from OPC-UA / Modbus / native drivers, transform via Cirrus Link MQTT Transmission into Sparkplug B, publish to an MQTT broker, and consume back via MQTT Engine — i.e., be both UNS producer and consumer.
- **Protocols supported:** OPC-UA, Modbus, EtherNet/IP, Allen-Bradley CIP, Siemens S7, MQTT (incl. Sparkplug B via Cirrus Link modules), REST (custom). [Ignition IIoT solution page](https://inductiveautomation.com/solutions/iiot).
- **AI / ML usage:** Tag history + machine-learning integrations available via 3rd-party modules; native LLM/agent surface is UNCONFIRMED in public docs as of 2026-05-19. The product Perspective module + scripting opens the door to embedded copilots, but I have not seen a first-party shipping product.
- **Hosting / deploy model:** On-prem gateway (Java-based). Edge gateways for line-of-business deployments. Cloud-hosted via partners (AWS / Azure marketplace listings).
- **Notable repos:** Inductive Automation Forum is the primary community channel; the [Ignition Exchange](https://inductiveautomation.com/exchange/) hosts community modules. There is no large monolithic OSS repo on GitHub for the core gateway.
- **Notable screens / UX:** Perspective Designer + Vision Designer; both are HMI builders. Tag browser is the primary admin surface for tag hierarchy.

## Maintenance / CMMS / PLC relevance

- **Maintenance:** Indirect — Ignition is the operator's screen, not a maintenance technician's chat surface. Some integrators have built CMMS work-order panels inside Perspective, but these are bespoke.
- **CMMS:** No native CMMS; integrators (and Inductive Automation Exchange modules) provide bridges. **This is a real opening for MIRA + Atlas / MaintainX.**
- **PLC programs / tags:** Read + write to PLC tags through Ignition drivers. Industrial control is what they do best.

## Business model

- Unlimited-tag, per-server licensing — pricing public, predictable. This is a known competitive moat: customers escape per-tag pricing traps.
- Channel partners (integrators) drive most enterprise sales.
- ICP: any plant with > 5 PLCs and a desire to consolidate HMI / SCADA. Strong in food & bev, discrete, water/wastewater, energy.

## Public sources

| Source | Type | URL | Date read | Notes |
|---|---|---|---|---|
| Ignition UNS Solution | docs | https://inductiveautomation.com/solutions/unified-namespace | 2026-05-19 | UNS pitch + Cirrus Link module stack |
| Build an IIoT Solution with MQTT | docs | https://inductiveautomation.com/solutions/iiot | 2026-05-19 | MQTT + Sparkplug B + protocol matrix |
| Demystifying the UNS with Ignition (ICC 2024) | video | https://inductiveautomation.com/resources/icc/2024/demystifying-the-unified-namespace-with-ignition | 2026-05-19 | Conference talk — Ignition-centric UNS framing |
| MQTT Sparkplug Specification | docs/video | https://inductiveautomation.com/resources/video/mqtt-sparkplug-specification | 2026-05-19 | Their Sparkplug B explainer |
| Revolutionizing Data Efficiency with Ignition and MQTT | blog | https://inductiveautomation.com/blog/revolutionizing-data-efficiency-with-ignition-and-mqtt | 2026-05-19 | Bandwidth + namespace efficiency thesis |
| Connecting Ignition to MQTT and HiveMQ | partner blog | https://www.hivemq.com/blog/a-step-by-step-guide-connecting-ignition-mqtt-hivemq/ | 2026-05-19 | Step-by-step UNS bring-up |

## What MIRA should emulate

- **Treat tags as first-class, with UDT-style definitions.** This is the closest analog in commercial products to MIRA's component-template approach. Validates the per-model vs per-instance split (`.claude/skills/component-profile-builder/SKILL.md`).
- **Publish into Sparkplug B when speaking outward.** For interop with customer plants already on Ignition, MIRA's relay (`mira-relay/`) and the Hub should support Sparkplug B payload shapes for incoming tag streams.
- **Per-server / per-plant pricing, not per-tag.** Ignition's predictable pricing is their moat; MIRA should mirror predictability with per-site / per-plant pricing, not per-asset.

## What MIRA should avoid

- **Don't build an HMI.** Ignition Vision/Perspective is excellent and entrenched. The Slack-first front door is the correct contrarian bet.
- **Don't fight the "Ignition is the UNS" narrative.** Customers running Ignition often already believe Ignition IS the UNS. MIRA's correct stance is: "Great — we ground our copilot in the tags you've already exposed via your Ignition UNS." Sit on top, don't replace.
- **Don't ignore Perspective.** A future "MIRA inside Perspective" embed is a plausible distribution channel for non-Slack-using customers. Note for `mira-bots/` roadmap.

## Integration opportunity

- **High.** Concrete vector: ship a Cirrus Link-compatible MQTT subscriber in the relay that ingests Sparkplug B and writes UNS context to NeonDB. Pair with a Perspective component "MIRA — ask about this tag" that posts the tag UNS path into a Slack-backed conversation. Demo gold.
- Lower-effort vector: an Ignition Exchange module that links MIRA's Slack bot to a tag context (right-click tag → "ask MIRA").

## Threat level to MIRA (low / medium / high)

- **Score:** Medium (today). Could rise to **High** if Inductive Automation ships a first-party LLM-grounded copilot inside Perspective.
- **Why:** They own the screen technicians and operators use. If they add a "MIRA-like" Q&A surface natively, they capture the front door for any plant already on Ignition. Counter: Slack-first + multi-vendor (we work even when the plant has Rockwell FactoryTalk or Siemens WinCC, not just Ignition).

## Usefulness score for MIRA learning (1-5)

- **Score:** 5
- **Why:** Defines the dominant UNS pattern in North American manufacturing. Their UDT model, Sparkplug B payload conventions, and tag-history approach are the de facto starting points we need to interop with.

## Open questions

- [ ] Is there a first-party Ignition-branded LLM copilot in the pipeline? (Check ICC 2026 talks.)
- [ ] What's the Sparkplug B payload shape for UDT instances — exact protobuf field conventions?
- [ ] Can Ignition Exchange host commercial modules, or is it OSS-only? (Distribution channel question.)
- [ ] How do customers reconcile Ignition's tag-history with a separate historian (AVEVA PI, Canary)?

## MIRA lessons (1-3 bullets)

- Ignition is the **substrate** MIRA grounds against in many target customers, not a competitor. The Slack-first wedge and multi-PLC posture (not Rockwell-only, not Siemens-only, not Ignition-only) is the differentiator.
- Sparkplug B literacy is non-negotiable for the relay. Add it to `mira-relay/` roadmap if not already there. (Cross-check before promoting to a decision.)
- A "ask MIRA about this tag" right-click affordance inside Perspective is a high-leverage demo. Park it as a feature idea for the Hub spec.
