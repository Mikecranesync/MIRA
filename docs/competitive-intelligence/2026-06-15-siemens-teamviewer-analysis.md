# Competitive Intelligence — Siemens, TeamViewer (+ Rockwell) vs. MIRA / FactoryLM

**Date:** 2026-06-15
**Author:** automated competitive-intel run (CHARLIE)
**Scope:** Siemens industrial AI, TeamViewer Frontline, Rockwell Automation AI — threat-mapped against MIRA's wedge.
**Trigger:** Siemens CES 2026 keynote transcript (`youtube.com/watch?v=R4Wm6YdoZSs`) + standing competitor-tracking task.

> **MIRA in one line (the thing we're comparing against):** an AI maintenance copilot for **SMB/mid-market brownfield plants** that ingests OEM manuals, PLC tags, fault history, and tribal knowledge into a **Unified Namespace (ISA-95) knowledge graph** and returns **grounded, document-cited** troubleshooting answers in **Slack/Telegram**, on a **free-tier LLM cascade** (Groq → Cerebras → Gemini). Wedge = grounded citations + namespace structuring, zero new hardware, same-day value, sold to plants that cannot afford a Siemens/Rockwell program.

---

## TL;DR threat board

| Company | Closest product to MIRA | Classification | One-line why |
|---|---|---|---|
| **Siemens** | Senseye Maintenance Copilot (Entry/Scale) | **Adjacent now / incumbent-watch** | Same JTBD (conversational maintenance copilot) but enterprise ICP, 3–6 mo deploys, $250k+ plants, case-history (not manual-cited) reasoning, Siemens-hardware gravity. Cannot reach MIRA's SMB economics today. |
| **Rockwell** | Fiix Asset Risk Predictor + GenAI prescriptive work orders | **Adjacent / HIGH incumbent-watch** | Fiix is the CMMS our buyers already evaluate; Rockwell owns ~50% of the NA PLC base our UNS sits on. A conversational, manual-grounded Fiix copilot would be a direct hit. Also our **substrate** (Allen-Bradley/PowerFlex). |
| **TeamViewer** | Frontline Assist AR + Tia knowledge graph | **Adjacent / complement** | AR-hardware + remote-human-expert delivery, enterprise-only, knowledge from *session history* not OEM docs. Low direct-threat; genuine **complement** (MIRA = brain, Frontline = AR eyes/escalation). |

**Net:** None is a head-on competitor to MIRA's SMB grounded-citation wedge **today**. The two to watch are **Rockwell/Fiix** (closest data model + owns our buyer + owns our substrate) and **Siemens/Senseye Entry** (down-market intent + "hallucination is not acceptable" messaging that validates our thesis). TeamViewer is more partner than rival.

---

## 1. Siemens CES 2026 keynote — transcript analysis

**Source:** Roland Busch (Siemens President & CEO) CES 2026 keynote, with Jensen Huang (NVIDIA), Satya Nadella + Jay Parikh (Microsoft), PepsiCo, Commonwealth Fusion. ~1,100 transcript segments. Pulled via `tools/youtube_transcript.py R4Wm6YdoZSs`.

### What the keynote was actually about
Overwhelmingly **digital twins, simulation, and AI factories** — not maintenance. The spine of the talk:

- **"Powering the industrial AI revolution"** framing — AI is to this century what electricity was to the last; Siemens controllers run "one in three manufacturing machines worldwide."
- **NVIDIA partnership** (the bulk of stage time): GPU-accelerating Siemens EDA + Simcenter simulation 100–1000×, "AI physics" to emulate rather than simulate, AI-native chip design, AI-driven adaptive manufacturing (first fully AI-driven site in Germany in 2026).
- **Digital Twin Composer** launch — photorealistic plant/process twin connected to real-time machine data, on the Xcelerator marketplace. PepsiCo cited 20% efficiency gain in 3 months at a Gatorade plant, 10–15% CapEx reduction estimate.
- **AI factories** (the $50B GPU data-center-as-factory), Commonwealth Fusion, grid stability.

### The maintenance-relevant moments (the parts that matter to MIRA)

1. **"Hallucination is not acceptable when AI is deployed in the industrial world."**
   Busch said this almost verbatim early in the keynote, as a design constraint for industrial AI. **This is MIRA's entire grounding thesis, stated by the largest industrial automation company on Earth.** It validates the category we're building (grounded, cited, refuse-when-unsure) and is a quote we can use in our own positioning ("even Siemens says hallucination is unacceptable on the plant floor — that's why MIRA cites every answer").

2. **Meta Ray-Ban smart glasses for shopfloor workers (the "Sarah" demo).**
   The single most MIRA-adjacent segment. A new factory worker ("Sarah") gets **real-time audio guidance through the glasses — which button to press, which parameters to change.** Her AI "brings together **live machine data, knowledge from my colleagues, and all of our standard operating procedures**, and explains everything … at my pace, in my language." The AI proactively flags a sensor issue at "cell four" and offers to guide a reset.
   - This is a **connected-worker maintenance copilot** — exactly MIRA's job-to-be-done (live data + tribal knowledge + SOPs → guided fix), but delivered on Meta glasses to enterprise shopfloors, not in Slack to SMB techs.
   - Note what's missing from the demo narrative: no mention of **OEM-manual citation** or a queryable **namespace** — it's "knowledge from my colleagues + SOPs," i.e. internal procedure capture, closer to Senseye case-history than to MIRA's document-grounded retrieval.

3. **"Nine additional AI-powered Siemens Industrial Copilots"** announced at CES 2026, spanning design → engineer → operate (Teamcenter, Polarion, Opcenter named; six unnamed). Distributed via Xcelerator. The **Maintenance Copilot lives inside Senseye** and was a *separate, earlier* (March 2025) announcement — not one of the nine.

### Read-through
Siemens is pouring its CES marketing budget into **digital twins + NVIDIA + AI factories**, with maintenance as a downstream copilot, not the headline. The connected-worker glasses demo shows they *understand* the floor-tech assistant use case, but they're aiming it at large, Siemens-instrumented factories. The "no hallucination" line is a gift to MIRA's narrative.

---

## 2. Siemens — company profile

**What they are:** The 175-year industrial automation incumbent. ~250k employees, 1,500+ AI experts, 30 industrial verticals, Siemens controllers in ~1/3 of manufacturing machines worldwide. AI is being woven across the entire portfolio under the "industrial AI" umbrella on the **Xcelerator** marketplace.

### Product lines relevant to MIRA

**Senseye Predictive Maintenance** (acquired 2022) — cloud PdM SaaS. ML anomaly detection on sensor data (vibration/temp/pressure); OEM-agnostic via API but optimized for SIMATIC/TIA/Insights Hub. Azure private cloud. **3–6 month deploys**; brownfield shops often need clean centralized data first (commonly $100k+ infrastructure).
- **Senseye Maintenance Copilot** (announced Mar 2025) — the directly-competitive piece. Conversational NL interface; **multilingual case-based reasoning over past maintenance cases**; aggregates across maintenance systems. Pilot result: **25% reduction in reactive maintenance time**. Two packages: **Entry** (down-market positioning, "SMBs starting their PdM journey") and **Scale** (multi-site enterprise). **Pricing undisclosed**; base Senseye ~$7.50/asset/mo aggregate; full-plant implementations reported $250k+.
- **Key gap vs MIRA:** reasons over *case history*, **not OEM manuals with page citations**; no UNS/ISA-95 proposal layer; no tribal-knowledge capture via chat; separate web portal (not Slack-native).

**Siemens Industrial Copilot** — the GenAI brand across the value chain, powered by **Microsoft Azure OpenAI**. TIA Portal Copilot (writes/debugs PLC code), nine new copilots at CES 2026, Eigen Engineering Agent + Plant Simulation Copilot + Insights Hub Production Copilot at Hannover Messe 2026. Mostly **engineering/operations**, not floor-tech troubleshooting.

**Siemens Xcelerator** — the open marketplace/ecosystem (1,000+ offerings, 400+ sellers) that distributes all of the above. Not a product; the distribution layer. Industrial AI Suite went GA at Hannover Messe 2026.

**Insights Hub** (formerly MindSphere, rebranded 2023) — the IIoT/analytics data layer Senseye sits on. Mendix low-code; SIMATIC-native; tiered (Essentials/Standard/Premium, "Start for Free"). Not a maintenance tool itself.

### ICP / GTM
Stated "companies of all sizes"; **actual** customers are Fortune 500 / large manufacturers, best-fit greenfield Siemens-heavy shops. Direct sales → professional services → months of implementation. An "SMB Production Optimization Starter Pack" signals down-market *intent*, but there is no self-serve sign-up, no list price, no 14-day trial for the maintenance copilot.

---

## 3. Rockwell Automation — company profile (closest incumbent watch)

**What they are:** $8.34B revenue (FY2025), Fortune 500 (NYSE: ROK), ~50%+ of the **North American PLC installed base** (Allen-Bradley ControlLogix/CompactLogix/MicroLogix/Micro820, PowerFlex VFDs). Strategy tagline: "From Automation to Autonomy." AI embedded **inside-out** across FactoryTalk rather than launched standalone.

### AI stack
- **FactoryTalk Design Studio Copilot** — NL → ladder logic / structured text, troubleshooting control logic. Dual-track: **Azure OpenAI** (cloud) + **NVIDIA Nemotron Nano 9B SLM** (air-gapped edge, Nov 2025). Targets **controls engineers / OEMs / SIs — not maintenance techs.**
- **FactoryTalk Optix** — cloud HMI with **Microsoft Phi-3** embedded for AI-guided operator instructions at the panel.
- **FactoryTalk Analytics — GuardianAI / LogixAI** — edge/PLC signal-based predictive maintenance (anomaly detection on vibration/temp/current). Predicts *when*, not *why*; no document grounding.
- **Plex (cloud MES/ERP)** — agentic AI roadmap; AI-driven digital work instructions (legacy docs → structured steps); future Plex Agent Composer.
- **Hannover Messe 2026** — AI-orchestrated factory system design (NL → build/refine/validate factory model). Demo-stage.

### Fiix — the most MIRA-adjacent product Rockwell owns
Fiix (CMMS, acquired 2021) under FactoryTalk MaintenanceSuite. Standard CMMS + two AI layers:
- **Asset Risk Predictor (ARP)** — predicts failures from **work-order + asset history only** (no manuals, no tags, no fault registers). Predictions within ~2 weeks; sellable standalone or atop any CMMS.
- **Prescriptive Maintenance (GenAI work orders, May 2024)** — ARP flags a failure → GenAI **auto-generates a work order** (procedure/parts/steps) from "asset data, completed work orders, and trusted maintenance sources," human-reviewed, pushed to any CMMS. **No conversational chat, no manual-cited diagnostic answer**, no disclosed LLM.
- **Pricing (3rd-party est.):** Free (≤3 users) → ~$35–45 (Basic) → ~$75–95 (Pro) → ~$110–150/user/mo (Enterprise); ARP an add-on; implementation $3k–$60k+. Reviewer base is **56% small business** — Fiix *itself* is SMB-accessible, but the **AI add-ons are enterprise-priced and assume rich CMMS history.**

### Rockwell is simultaneously competitor AND substrate
- **Substrate:** Allen-Bradley + PowerFlex are exactly the gear MIRA's UNS tag-mapping, fault-code KG, and Ignition tag bridge target. MIRA's bench already runs on AB hardware. MIRA reads Rockwell data to ground answers — without the AB installed base, MIRA has no plants.
- **Competitor (latent):** Fiix is the CMMS our buyers already use. If Rockwell adds a **conversational, manual-grounded** technician copilot to Fiix/FactoryTalk/Teams, they reach our exact plants with cross-sell muscle. No such product as of June 2026; plausible in 12–24 months.

---

## 4. TeamViewer — company profile

**What they are:** Public German company (Frankfurt: TMV). ~€767.5M revenue (FY2025), 44.3% adj. EBITDA margin, ~1,925 employees. Famous for remote-access; the industrial story is **TeamViewer Frontline** (from the 2020 **Ubimax** AR acquisition). (The 2024 **1E** acquisition is IT/DEX — irrelevant here.)

### Frontline suite (AR connected-worker platform; x-names being rebranded to "Frontline X")
- **Frontline Assist (xAssist)** — remote AR expert-on-demand: remote expert sees the tech's smart-glasses feed and annotates it live. **+ Hannover Messe 2026: Tia AI agent + a proprietary knowledge graph** that surfaces, during live calls, how similar past issues were resolved (captures expert knowledge from resolved sessions). + Microsoft on-device **video super-resolution** for poor plant networks. ← *the one real overlap vector.*
- **Frontline Pick (xPick)** — vision picking for warehouse logistics (DHL, Coca-Cola HBC, Samsung SDS). Not maintenance.
- **Frontline Make (xMake)** — AR-guided assembly/production steps.
- **Frontline Inspect (xInspect)** — digitized inspection/maintenance workflows, checklists, auto-captured reports (Airbus: 40% faster gearbox inspections). AI here is **workflow authoring** (PDF→AR steps), not diagnostic reasoning.
- **Frontline Upskill / Spatial** — AR training + spatial-computing digital twins (GE Aerospace).
- **AiStudio** — no-code computer-vision add-on (QA / PPE checks). Rule-based classification, not generative diagnosis.

### AI strategy
Four layers: (1) workflow-authoring AI (PDF→AR steps), (2) AiStudio CV, (3) **Tia + knowledge graph in Assist AR** (session-history capture — closest to MIRA, still preview/beta and AR-gated), (4) Microsoft VSR for video quality. **No announced LLM-grounded fault diagnosis from OEM manuals / PLC tags / fault history.** Tia originated as an **IT-support** agent (Microsoft Ignite, Nov 2025); the OT extension is nascent.

### ICP / GTM / pricing
Hardware: device-agnostic across **RealWear / Vuzix / HoloLens 2 / Zebra**. GTM: **direct enterprise sales + TeamUP partners + GSIs**; alliance partners SAP, Microsoft, Siemens, Google Cloud. **ICP = large enterprise** (automotive, aerospace, logistics, F&B; 10k+ employees). Frontline pricing **undisclosed/quote-only** (likely per-user or per-device); requires smart-glasses procurement + ERP/PLM integration. Customers: DHL, Coca-Cola HBC, Airbus, GE Aerospace, Samsung SDS, Siemens, GlobalFoundries.

---

## 5. Direct comparison vs MIRA

| Dimension | **MIRA / FactoryLM** | **Siemens** (Senseye Copilot) | **Rockwell** (Fiix + FactoryTalk) | **TeamViewer** (Frontline) |
|---|---|---|---|---|
| **Primary user** | Plant maintenance tech | Reliability eng / maintenance mgr | Controls eng (copilots) / maint planner (Fiix) | Frontline worker + remote expert |
| **Delivery surface** | Slack / Telegram chat | Senseye web portal | FactoryTalk/Optix panel, Fiix web/mobile | AR smart glasses + video |
| **Core knowledge source** | **OEM manuals + PLC tags + WO history + tribal knowledge → cited** | Maintenance **case history** | **Work-order history** (ARP) | **Remote-session history** (Tia KG) |
| **Document-cited answers** | **Yes — page-level citations** | No | No | No |
| **UNS / ISA-95 knowledge graph** | **Yes — core** | No (Insights Hub data layer, not a KG proposal surface) | No | No |
| **Predictive (sensor) analytics** | No (reactive/assisted) | **Yes** (Senseye ML) | **Yes** (GuardianAI/LogixAI/ARP) | No |
| **Hardware required** | **None** (chat on a phone) | Sensors + clean data feeds | Sensors (GuardianAI); Fiix none | **Smart glasses** |
| **Manufacturer scope** | **Agnostic** (UNS) | Best on SIMATIC/Siemens | Best on Allen-Bradley | Agnostic (delivery only) |
| **Deploy time** | **Same day** (upload manual) | 3–6 months | ARP ~2 wks + CMMS history | Enterprise integration + HW |
| **LLM** | Free cascade (Groq/Cerebras/Gemini) | Azure OpenAI | Azure OpenAI + NVIDIA SLM | Tia / Microsoft |
| **Entry price** | Free-tier / per-seat | Undisclosed; $250k+ plants | Fiix $35+/user/mo; AI add-on | Undisclosed, enterprise |
| **ICP** | **SMB / mid-market brownfield** | Fortune 500 / large | Enterprise + mid-market Fiix | Large enterprise |
| **Threat to MIRA wedge** | — | Adjacent / incumbent-watch | **Adjacent / HIGH watch** | Adjacent / complement |

---

## 6. Threat assessment

### Siemens — **Adjacent now, incumbent-watch.**
Cannot reach MIRA's ICP at MIRA's economics today (no self-serve, $250k+ plants, 3–6 mo deploys, Siemens-hardware gravity, case-history ≠ manual-cited). The watch items: (a) Senseye **Entry Package** + SMB Starter Pack = explicit down-market intent; (b) huge mid-market SIMATIC base is a natural Senseye upsell that removes plants from MIRA's TAM; (c) the "no hallucination" + connected-worker-glasses narrative shows they grasp our use case. **Not a near-term displacement risk; a category-validation tailwind plus a long-run squeeze.**

### Rockwell — **Adjacent, HIGH incumbent-watch (closest of the three).**
Fiix is the most MIRA-shaped product any incumbent owns, Rockwell owns ~50% of the substrate MIRA depends on, and they've already shipped GenAI work-order generation (proof they understand the GenAI-maintenance motion). The only thing standing between Fiix and a direct collision with MIRA is **a conversational, manual-grounded technician interface** — a logical next step they have not yet announced. **This is the competitor most likely to converge on MIRA's wedge, and the one with the channel to win the same plants fast.**

### TeamViewer — **Adjacent, lean complement.**
AR-hardware + remote-human-expert + enterprise-only + session-history knowledge = a different product bet. Converging on MIRA would require a chat-native pivot, OEM-doc ingestion+citation, and a down-market GTM — a non-trivial 3-axis turn with no evidence they intend it. **Low direct threat; real complement potential** (MIRA = grounded reasoning brain; Frontline = AR delivery + human-expert escalation).

---

## 7. What MIRA does that they don't

1. **Page-level document-grounded citations** from OEM manuals, wiring diagrams, fault-code tables. None of the three cite source documents in answers — Siemens reasons over cases, Rockwell over WO history, TeamViewer over session recordings.
2. **ISA-95 Unified Namespace knowledge graph** with proposal/verify review — a queryable, manufacturer-agnostic plant brain. No equivalent at any of the three.
3. **Zero-hardware, same-day deployment** — upload a manual, get cited answers in Slack today. Everyone else needs sensors, glasses, CMMS history, or months of integration.
4. **SMB/brownfield-from-zero** — works with *no* CMMS, *no* historian, *no* clean data feed. Fiix ARP needs WO history; Senseye needs sensor data; Frontline needs glasses + ERP.
5. **Tribal-knowledge capture via the chat the tech already uses** — technician answers feed the KB through Slack/Telegram dialogue.
6. **Free-tier LLM economics** — no Azure-OpenAI enterprise contract baked into the price.

## 8. What they do that MIRA should watch

1. **Sensor-based predictive analytics** (Siemens Senseye, Rockwell GuardianAI/LogixAI/ARP) — predicting *when* a machine fails. MIRA is reactive/assisted today; this is the natural adjacent expansion buyers will ask about.
2. **Rockwell/Fiix conversational grounding** — if Fiix gains a manual-grounded chat copilot, it's a direct hit. **Set a tripwire on Fiix product announcements.**
3. **Siemens "Entry Package" + SMB Starter Pack pricing/self-serve** — if Siemens ever ships true self-serve down-market, the ICP gap narrows.
4. **Connected-worker AR delivery** (Siemens Meta glasses, TeamViewer Frontline) — the floor-tech-assistant UX is moving to hands-free. Watch whether grounded-AI + glasses converge.
5. **Edge/air-gapped SLMs** (Rockwell NVIDIA Nemotron, Siemens edge) — many plants forbid cloud. MIRA's cloud cascade may eventually need a local/edge story (we already have `local` → Open WebUI → qwen2.5vl).
6. **"Hallucination is not acceptable" as table-stakes messaging** — the incumbents now say it too; MIRA must *prove* grounding (citations, refuse-when-unsure), not just claim it, to stay differentiated.

---

## 9. Recommendation on tracking cadence

**Add Siemens and Rockwell to the weekly competitive-intel scheduled task. Keep TeamViewer at monthly / event-driven.**

| Company | Cadence | What to watch | Tripwire |
|---|---|---|---|
| **Rockwell / Fiix** | **Weekly** | Fiix product releases, FactoryTalk copilot launches, Automation Fair (Nov), any "maintenance technician chat" feature | A conversational, manual/WO-grounded Fiix copilot → escalate to **direct competitor**, re-position immediately |
| **Siemens / Senseye** | **Weekly** | Senseye Entry Package pricing/self-serve, SMB Starter Pack, Industrial Copilot maintenance features, CES/Hannover | True self-serve SMB maintenance copilot < $X/mo → ICP-gap closing alert |
| **TeamViewer / Frontline** | **Monthly + event-driven** | Tia OT/Assist-AR knowledge-graph maturity; any OEM-doc ingestion + citation; any chat-native or down-market move | Frontline adds OEM-document-grounded diagnostics OR an SMB chat product → re-classify from complement to adjacent-competitor |

**Rationale:** Rockwell and Siemens are the two whose roadmaps could intersect MIRA's wedge, and both have annual flagship events (Automation Fair, CES/Hannover Messe) plus steady release cadence worth weekly monitoring. TeamViewer's industrial AI is moving slowly and on a different axis (AR/remote), so monthly + event-driven is sufficient — but the Tia/Assist-AR knowledge graph is the one feature that could change that, so it carries an explicit tripwire.

**Also worth a one-time action:** capture the Siemens *"hallucination is not acceptable when AI is deployed in the industrial world"* quote into sales/positioning material — it's an incumbent CEO validating MIRA's grounding thesis on the CES main stage.

---

## Sources

**Siemens:** [CES 2026 keynote video](https://www.youtube.com/watch?v=R4Wm6YdoZSs) · [CES 2026 press release](https://press.siemens.com/global/en/pressrelease/siemens-unveils-technologies-accelerate-industrial-ai-revolution-ces-2026) · [Senseye GenAI maintenance (Mar 2025)](https://press.siemens.com/global/en/pressrelease/siemens-expands-industrial-copilot-new-generative-ai-powered-maintenance-offering) · [Senseye PdM product](https://www.siemens.com/en-us/products/industrial-digitalization-services/senseye-predictive-maintenance/) · [Insights Hub](https://www.siemens.com/en-us/products/insights-hub/) · [Xcelerator ecosystem](https://xcelerator.siemens.com/global/en/ecosystem.html) · [SMB Starter Pack](https://news.siemens.com/en-us/siemens-small-manufacturers-operational-efficiency-pack/) · [Senseye alternatives analysis (F7i.ai)](https://f7i.ai/blog/who-competes-with-siemens-senseye-a-2026-comparative-guide-for-reliability-leaders)

**Rockwell:** [FY2025 results](https://www.businesswire.com/news/home/20251106761417/en/Rockwell-Automation-Reports-Fourth-Quarter-and-Full-Year-2025-Results-Introduces-Fiscal-2026-Guidance) · [Rockwell × Microsoft](https://www.rockwellautomation.com/en-us/company/news/press-releases/Rockwell-Automation-and-Microsoft-Deliver-on-a-Shared-Vision-to-Accelerate-Industrial-Transformation.html) · [NVIDIA Nemotron edge SLM](https://www.rockwellautomation.com/en-us/company/news/press-releases/rockwell-automation-to-advance-industrial-intelligence-through-e.html) · [Fiix Asset Risk Predictor](https://fiixsoftware.com/arp/) · [Fiix GenAI prescriptive work orders (May 2024)](https://www.prnewswire.com/news-releases/fiix-by-rockwell-automation-announces-industry-leading-genai-prescriptive-work-orders-302134253.html) · [GuardianAI](https://www.rockwellautomation.com/en-us/products/software/factorytalk/maintenancesuite/factorytalk-analytics-guardianai.html) · [Hannover Messe 2026 AI orchestration](https://www.prnewswire.com/news-releases/rockwell-automation-to-demonstrate-aiorchestrated-factory-system-design-at-hannover-messe-2026-302722110.html) · [Fiix pricing (Fabrico, 3rd-party)](https://www.fabrico.io/blog/fiix-pricing-guide-2026-tiers-costs-and-what-you-actually-get/)

**TeamViewer:** [Frontline product](https://www.teamviewer.com/en/products/frontline/) · [Hannover Messe 2026 — Assist AR AI + agentless](https://www.prnewswire.com/news-releases/hannover-messe-teamviewer-highlights-agentless-access-and-ai-supported-maintenance-for-industrial-operations-302744497.html) · [Tia launch (Nov 2025)](https://www.teamviewer.com/en/global/company/press/2025/teamviewer-launches-tia-intelligent-agent-autonomous-it-support/) · [Microsoft VSR for Assist AR](https://www.computerweekly.com/news/366643921/TeamViewer-Microsoft-bring-AI-AR-for-clearer-smarter-remote-assistance) · [AiStudio](https://www.auganix.org/teamviewer-announces-aistudio-add-on-to-bring-ai-image-and-object-recognition-to-its-frontline-enterprise-augmented-reality-platform/) · [PAC Radar #1 connected worker 2025](https://www.prnewswire.com/news-releases/teamviewer-named-best-in-class-for-connected-worker-platforms-in-2025-pac-radar-302516675.html) · [FY2025 annual report coverage](https://www.sahmcapital.com/news/content/teamviewer-se-publishes-2025-annual-report-2026-03-18)

> **Verification notes:** Pricing for Senseye, Industrial Copilot, Fiix AI add-ons, and TeamViewer Frontline is not officially published — figures above are third-party estimates or aggregate review-site data, flagged inline. "Nine copilots" (six unnamed), Eigen Engineering Agent, and Tia's OT/Assist-AR extension are announced/preview, not confirmed-shipping. Treat all forward-looking convergence timelines as analyst judgment, not fact.
