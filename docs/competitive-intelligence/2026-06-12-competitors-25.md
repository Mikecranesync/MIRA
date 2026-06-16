# FactoryLM / MIRA / CraneSync — Competitive Intelligence Report
**Generated:** 2026-06-12 (automated run)  
**Scope:** 25 competitors and innovators across AI maintenance, CMMS, predictive maintenance, industrial AI platforms, and overhead crane field service.  
**Business context:** FactoryLM (factorylm.com) builds MIRA — an AI-powered Maintenance Intelligence Namespace platform that structures OEM manuals, PLC tags, fault history, and tribal knowledge into grounded AI guidance for plant technicians. CraneSync (cranesync.com) is an AI-powered field service and condition monitoring platform for industrial cranes.

---

## TIER 1 — Most Direct Competitors (AI Maintenance Copilots for Plant Floor Teams)

These companies are closest to what FactoryLM/MIRA does: turning plant documentation and operational context into grounded AI answers for maintenance technicians.

---

### 1. Dovient
**Website:** https://dovient.com  
**LinkedIn:** https://www.linkedin.com/company/dovient  
**Founded:** ~2022 | **HQ:** Hyderabad, India (Agentik Technologies Pvt Ltd)  
**Stage:** Early-stage, backed by NASSCOM, NSRCEL (IIM Bangalore accelerator)

**What they do:** "Verified AI for Maintenance & Reliability Teams." Dovient ingests SOPs, OEM manuals, work-order history, and live SCADA/IoT data into a knowledge graph, then delivers cited, step-by-step repair guidance. Their "MissingDots" verification engine refuses to answer when context is insufficient — explicit anti-hallucination architecture. They claim 35% reduction in unplanned downtime (Kayempee Foods, 90-day pilot) and 40% faster MTTR.

**Why relevant:** Closest direct competitor to MIRA. Near-identical positioning: ingest plant documents → structured knowledge → AI copilot for technicians. They have paying customers (Kayempee Foods, APL Apollo, Thyssenkrupp TKIL, Virchow Group) and a content marketing moat (58+ learning guides). India-focused currently.

**Key differentiator vs. MIRA:** "MissingDots" is a named verification engine with a public microsite (missingdots.ai). No namespace/UNS concept — more document-centric than asset-hierarchy-centric. Deploys in 2 weeks. Does not mention PLC tag reconciliation.

---

### 2. Factory AI (f7i.ai)
**Website:** https://f7i.ai  
**Founded:** ~2023 | **HQ:** USA  
**Stage:** Early-stage/seed

**What they do:** "The only AI-first CMMS bundled with predictive maintenance." Factory AI is sensor-agnostic, deploys in under 14 days in brownfield environments, and comes pre-loaded with rules for standard industrial components. Focused on the mid-market segment (plants with a mix of 20-year-old hydraulic presses and modern CNCs). PdM + CMMS in a single integrated package.

**Why relevant:** Competes in the same brownfield + AI + CMMS space. Targets the same plant size MIRA targets ($2–5K/mo pilot tier). Also strong on content — publishes comparison articles ranking MIRA-adjacent competitors.

**Key differentiator vs. MIRA:** Hardware-agnostic sensor layer is more developed. Their CMMS is the primary interface; MIRA's AI copilot (Slack/Telegram) is the differentiator. Less documentation-centric; more sensor-data-centric.

---

### 3. Tractian
**Website:** https://tractian.com/en  
**LinkedIn:** https://www.linkedin.com/company/get-tractian  
**Crunchbase:** https://www.crunchbase.com/organization/tractian  
**Founded:** 2019 | **HQ:** Atlanta, GA | **Funding:** $196M total ($120M Series C, Sapphire Ventures + General Catalyst + Next47 + NGP Capital)

**What they do:** Machine intelligence platform combining AI-driven condition monitoring with CMMS. Their Smart Trac Ultra sensor attaches to industrial machinery, collects vibration/temperature/acceleration every 5 minutes with up to 5-year battery life. AI detects and diagnoses dozens of failure modes. CMMS layer handles work orders. Customers include John Deere, P&G, Caterpillar, Goodyear, Carrier, Johnson Controls, Bimbo. Claims 6–12x ROI, ~$6,000 saved per monitored machine annually.

**Why relevant:** Well-funded, proven customer base, occupies the "sensor + AI + CMMS" stack — the natural full-stack version of what MIRA offers without sensors. Has an Oracle partnership for manufacturing.

**Key differentiator vs. MIRA:** Hardware-first (proprietary sensor + LTE). Does not structure OEM documentation or PLC tags. Strong on vibration/fault prediction but less on grounded troubleshooting guidance (the "what to do next" layer). MIRA's UNS grounding and manual citation are differentiators.

---

### 4. Augury
**Website:** https://www.augury.com  
**LinkedIn:** https://www.linkedin.com/company/augury  
**Crunchbase:** https://www.crunchbase.com/organization/augury-systems  
**Founded:** 2012 | **HQ:** New York, NY | **Funding:** $369M (Series F Feb 2025 — $75M) | **Valuation:** $1B+

**What they do:** "Industrial AI for Uptime & Productivity." Machine health platform using acoustic, vibration, and ultrasonic sensors + ML to predict failures. Products include Halo (wireless real-time asset monitoring) and a cloud-based machine health management platform. Serves food & beverage, CPG, pharma, water/wastewater, facilities. Considered the "gold standard for enterprise-scale full-service vibration and ultrasonic monitoring."

**Why relevant:** Unicorn in the same industrial AI maintenance space. Their customer list (Fortune 500 manufacturing) is the aspirational target for FactoryLM.

**Key differentiator vs. MIRA:** Enterprise-first, heavy sensor deployment, large installation footprint. Does not serve the mid-market brownfield plant that FactoryLM targets at $500 assessment → $2–5K/mo pilot. Augury is a multi-million-dollar engagement.

---

## TIER 2 — CMMS Platforms Adding AI Features

These are established CMMS players building AI copilots, predictive maintenance, and AI work order features — competing with the CMMS component of FactoryLM.

---

### 5. MaintainX
**Website:** https://www.getmaintainx.com  
**LinkedIn:** https://www.linkedin.com/company/maintainx  
**Founded:** 2018 | **HQ:** San Francisco, CA | **Stage:** Series C (well-funded, private)

**What they do:** Mobile-first CMMS often described as "the WhatsApp of maintenance." Work order management, PM scheduling, anomaly detection, real-time commenting. Recently launched MaintainX CoPilot — an AI assistant built for maintenance teams that summarizes asset history, suggests probable causes, recommends parts, auto-generates repair notes. Integrates with FactoryLM's CMMS layer (MIRA can write back to MaintainX).

**Why relevant:** A CMMS FactoryLM integrates WITH and also competes against at the namespace layer. Their CoPilot is a direct overlap with MIRA's troubleshooting guidance.

**Key differentiator vs. MIRA:** Best-in-class mobile UX, large SMB customer base, strong integrations. CoPilot is their AI play, but it's CMMS-data-only — no OEM manual grounding, no PLC tag reconciliation, no UNS.

---

### 6. UpKeep
**Website:** https://upkeep.com  
**LinkedIn:** https://www.linkedin.com/company/upkeep-maintenance-management  
**Founded:** 2017 | **HQ:** Los Angeles, CA | **Stage:** Series B (significant funding)

**What they do:** Ranked #1 CMMS in multiple 2026 comparisons. Mobile-first, strong IoT integrations. Their AI agent "Nova" runs on a schedule, analyzes data, flags issues, and executes tasks autonomously. "Voice Fill" lets technicians create work orders by talking. "UpKeep Intelligence" is their AI-powered analytics layer.

**Why relevant:** Integrates with FactoryLM's CMMS write-back. Their Nova agent is a step toward the "autonomous maintenance execution" direction MIRA is building toward.

**Key differentiator vs. MIRA:** Nova is an agent-style AI (scheduled, autonomous) vs. MIRA's conversational grounded model. UpKeep does not structure OEM documentation or perform UNS namespace building.

---

### 7. Limble CMMS
**Website:** https://limblecmms.com  
**LinkedIn:** https://www.linkedin.com/company/limble-cmms  
**Founded:** 2015 | **HQ:** South Jordan, UT

**What they do:** Cloud-native CMMS emphasizing structured workflows, PM standardization, inventory discipline, compliance, and audit-readiness. Strong UX, built for mid-market manufacturing and facilities. Not as AI-forward as competitors but highly regarded for operational rigor.

**Why relevant:** FactoryLM mentions Limble as a write-back integration target. Limble customers are ideal FactoryLM pilots — they have basic CMMS hygiene and are ready to add AI-grounded troubleshooting.

---

### 8. Fiix CMMS (Rockwell Automation)
**Website:** https://fiixsoftware.com  
**Parent:** Rockwell Automation  
**Founded:** 2008 | **HQ:** Toronto, Canada

**What they do:** Cloud-based CMMS with Fiix Foresight AI engine — analyzes work order patterns to suggest optimization, "prescriptive maintenance" for enterprises deep in Rockwell/Allen-Bradley ecosystems. Integrates natively with FactoryTalk and Allen-Bradley PLCs.

**Why relevant:** Competes directly in the enterprise plant maintenance space. Rockwell's distribution advantage makes Fiix difficult to displace in AB-heavy plants.

**Key differentiator vs. MIRA:** Native Rockwell/Allen-Bradley PLC integration is a strength MIRA is building toward. Fiix is CMMS-centric; MIRA is knowledge-namespace-centric.

---

## TIER 3 — Industrial AI Giants & Platform Players

Large enterprises building industrial AI copilots and maintenance intelligence features. Not direct CMMS competitors but relevant to the "where does MIRA need to partner vs. compete?" question.

---

### 9. Siemens Industrial Copilot
**Website:** https://www.siemens.com/en-us/company/insights/generative-ai-industrial-copilot/  
**Press release:** https://press.siemens.com/global/en/pressrelease/siemens-expands-industrial-copilot-new-generative-ai-powered-maintenance-offering  
**Parent:** Siemens AG | **Market Cap:** ~$160B

**What they do:** Siemens unveiled 9 industrial copilots at CES 2026, including a Maintenance Copilot (Senseye) that provides expert-level equipment diagnostics without specialized training. Deployed on Siemens Xcelerator Marketplace. Uses Azure/ChatGPT for NLP. Claims average 25% reduction in reactive maintenance time in pilots. Multimodal capabilities (image-based diagnosis) in roadmap.

**Why relevant:** The "big tech" AI maintenance play. Siemens owns the automation hardware layer in many plants MIRA targets — positioning MIRA as the OEM-agnostic intelligence layer on top of Siemens hardware is a potential partnership angle.

---

### 10. IBM Maximo Application Suite + watsonx
**Website:** https://www.ibm.com/products/maximo  
**Parent:** IBM | **Market Cap:** ~$240B  
**Recognition:** Verdantix Green Quadrant APM Leader 2026

**What they do:** Enterprise EAM/APM platform built on IBM watsonx. AI agents for asset management (IBM AssetOpsBench open-sourced). Maximo Condition Insight: real-time + historical asset data → prescriptive recommendations. Maximo 9.1 (mid-2025) added a generative AI assistant for conversational maintenance support. IBM Maximo Predict uses ML + IoT for failure forecasting.

**Why relevant:** The dominant enterprise EAM platform. FactoryLM competes below the enterprise threshold — Maximo is $500K+ implementations. Plants that can't afford Maximo are MIRA's sweet spot.

---

### 11. Honeywell Forge
**Website:** https://www.honeywell.com/us/en/solutions/honeywell-forge  
**Parent:** Honeywell International | **Market Cap:** ~$40B

**What they do:** Industrial IoT platform delivering AI-enabled applications for intelligent, efficient operations. Honeywell Forge Production Intelligence integrates performance monitoring with a generative AI assistant (natural language plant insights). Honeywell Forge Digitized Maintenance identifies equipment faults before problems occur via IoT + ML from edge. Built on Microsoft Azure, with Azure Digital Twins integration.

**Why relevant:** Another enterprise industrial AI play with a maintenance copilot. Strong in oil & gas, chemicals, process industries. Not a direct competitor to MIRA's brownfield-manufacturing focus.

---

### 12. AspenTech
**Website:** https://www.aspentech.com  
**Parent:** Emerson Automation Solutions (majority stake) | **Founded:** 1981 | **HQ:** Bedford, MA

**What they do:** Asset optimization software for energy, chemicals, engineering, and asset-intensive industries. AspenTech V15 (2025) embedded "purpose-built industrial AI" across asset performance management, process optimization, and sustainability metrics. Focused on upstream oil & gas, refining, and process industries.

**Why relevant:** Defines the "industrial AI" market standard for process industries. Not a direct MIRA competitor but demonstrates the large market that exists for AI-grounded maintenance intelligence.

---

### 13. GE Vernova / Proficy
**Website:** https://www.gevernova.com/software  
**Parent:** GE Vernova (NYSE: GEV) | **Founded:** Spun off from GE 2024

**What they do:** GE Vernova's Proficy platform delivers AI-driven operational analytics, predictive asset health, and grid optimization. Focused on power generation, utilities, and industrial manufacturing. Proficy Asset Performance Management includes ML-based failure prediction and condition-based maintenance recommendations.

**Why relevant:** Dominant in power/utilities sector. Proficy OEM content and fault code databases are the type of structured knowledge MIRA's namespace-builder competes with.

---

### 14. PTC (ThingWorx + ServiceMax)
**Website:** https://www.ptc.com  
**Ticker:** NASDAQ: PTC | **Market Cap:** ~$20B

**What they do:** PTC ThingWorx is the leading IIoT/industrial AI platform for discrete manufacturing (automotive, aerospace). Connects OT + IT systems, enables AI-driven analytics at edge and cloud. Integrates with Windchill PLM and Vuforia AR. ServiceMax (acquired, now part of PTC) is an enterprise field service management platform for asset-centric industries. Both are available on PTC's Servigistics platform.

**Why relevant:** ThingWorx + ServiceMax combination is the enterprise equivalent of what CraneSync aims to do for field service + asset intelligence. ThingWorx is PTC-deep; ServiceMax is the FSM layer. PTC has pending sale to TPG private equity (2026), introducing transition uncertainty.

---

### 15. Sight Machine
**Website:** https://sightmachine.com  
**Press release:** https://www.prnewswire.com/news-releases/sight-machine-launches-agentic-manufacturing-platform-that-understands-your-plant--and-improves-it-every-run-302797542.html  
**Founded:** 2012 | **HQ:** San Francisco, CA | **Funding:** ~$73M

**What they do:** Just launched (2026) an "Agentic Manufacturing Platform" — AI agents that combine a process engineer's plant knowledge with a data scientist's analytical skills. Builds a "Semantic Model" of how the facility actually runs by connecting to all OT and IT systems. Agents investigate production, surface improvement opportunities, deploy recommendations to operators. Integrates with Microsoft Azure, Microsoft Fabric, Microsoft Teams, NVIDIA Omniverse, Databricks.

**Why relevant:** Sight Machine is building the "semantic factory model" that is structurally similar to MIRA's Maintenance Intelligence Namespace. Their agentic platform is a signal of where the market is heading — MIRA should be building toward agentic execution on top of its namespace.

---

## TIER 4 — Predictive Maintenance / Condition Monitoring Specialists

---

### 16. Nanoprecise Sci Corp
**Website:** https://nanoprecise.io  
**LinkedIn:** https://www.linkedin.com/company/nanoprecise  
**Founded:** 2017 | **HQ:** Edmonton, Canada | **Funding:** $50.6M (14 rounds, latest Debt-II March 2025)  
**Recognition:** Deloitte Technology Fast 500, #151 in North America (539% growth)

**What they do:** AI predictive maintenance combining vibration analysis with energy flux monitoring — predicts failures AND identifies machines drawing excess power. Energy-efficiency angle is a differentiator in 2026's energy market. Targets industrial manufacturing across multiple verticals.

**Why relevant:** Fills the sensor + energy efficiency gap. Nanoprecise focuses on the "before failure" detection layer; MIRA focuses on the "what to do when something goes wrong" layer. Potential integration partner.

---

### 17. Samotics
**Website:** https://samotics.com  
**LinkedIn:** https://www.linkedin.com/company/samotics  
**Formerly:** Semiotic Labs | **Founded:** 2015 | **HQ:** Leiden, Netherlands

**What they do:** Electrical Signature Analysis (ESA) — condition monitoring without mounting sensors on machines. Analyzes electrical current signatures to detect faults in motors and rotating equipment. Notable for monitoring assets that are enclosed, hard to access, or in hazardous environments.

**Why relevant:** The "no sensor required" angle is compelling for brownfield plants where MIRA also operates. ESA data could feed the MIRA namespace as an additional evidence stream.

---

### 18. SparkCognition
**Website:** https://www.sparkcognition.com/products/industrial-ai-suite/manufacturing/  
**Founded:** 2013 | **HQ:** Austin, TX | **Funding:** $235M+

**What they do:** Industrial AI Suite for manufacturing with no-code plan/optimize tools. Claims 20% annual reduction in maintenance costs. Targets control parameter optimization, throughput maximization, and workforce utilization. Broad industrial AI platform beyond just maintenance.

---

### 19. C3.ai
**Website:** https://c3.ai  
**Ticker:** NYSE: AI | **Market Cap:** ~$3B  
**Founded:** 2009 | **HQ:** Redwood City, CA

**What they do:** Enterprise AI application platform with manufacturing and predictive maintenance SaaS apps. C3 AI predictive maintenance integrates sensor networks, operational systems, and exogenous data to power ML failure models. Targets enterprise manufacturers (major oil companies, utilities, defense). Acknowledged market leader in enterprise industrial AI.

---

### 20. Samsara
**Website:** https://www.samsara.com  
**Ticker:** NYSE: IOT | **Market Cap:** ~$25B | **ARR:** $1.5B+ (>40% YoY growth)  
**Founded:** 2015 | **HQ:** San Francisco, CA

**What they do:** Connected operations platform serving 25,000+ customers. Started in fleet/logistics, now expanding to industrial IoT monitoring for manufacturing, construction, utilities. Samsara Intelligence (AI layer) monitors assets, cameras, and operations. 2025 launches: Samsara Wearable (frontline worker safety), Asset Tag (inventory/theft). Strong real-time visibility but "broad but shallow" on industrial diagnostics.

**Why relevant:** Samsara's trajectory is toward where FactoryLM plays. Their weakness — "tells you a machine is down without explaining the physics of why" — is MIRA's core value proposition.

---

### 21. Azima DLI (Fluke Reliability)
**Website:** https://reliability.fluke.com  
**Blog:** https://www.fluke.com/en-us/learn/blog/vibration/azima-dli-big-data-in-industrial-ai  
**Parent:** Fluke Corporation (Fortive) | **Founded:** 1980s (legacy reliability diagnostics)

**What they do:** Predictive maintenance diagnostics trained on 30+ years of operational data — 100 trillion data points across 50 machinery component types. AI-powered vibration diagnostics that can identify faults in "virtually every kind of standard machine" operating today. Integrated into Fluke's reliability services portfolio.

**Why relevant:** Data depth is unmatched. Azima DLI represents the "incumbent reliability services" market that AI-native startups like MIRA are disrupting with better UX and faster deployment.

---

### 22. Palantir (AIP for Manufacturing)
**Website:** https://aip.palantir.com | https://www.palantir.com/offerings/edge-ai/  
**Ticker:** NYSE: PLTR | **Market Cap:** ~$200B  
**Founded:** 2003 | **HQ:** Denver, CO

**What they do:** Palantir AI Platform (AIP) for manufacturing: a digital twin that represents every facet of machines and humans, powering machine throughput, yield, WIP, safety, and energy efficiency metrics. Palantir Edge AI embeds on sensors and cameras in manufacturing plants for quality control and efficiency. AIP Baseplate includes context from operational systems. Won against C3.ai in several major enterprise deals.

**Why relevant:** The enterprise-grade digital twin/AI platform. FactoryLM's Maintenance Intelligence Namespace is conceptually similar to Palantir's Baseplate for the maintenance domain. Palantir targets large enterprises; MIRA targets mid-market plants.

---

## TIER 5 — Crane / Lifting Equipment Specific (CraneSync Competitors)

---

### 23. Konecranes TRUCONNECT
**Website:** https://www.konecranes.com/services/care/truconnect  
**Parent:** Konecranes Oyj (HEL: KCR) | **HQ:** Hyvinkää, Finland | **Revenue:** ~€4B

**What they do:** TRUCONNECT is Konecranes' IoT-enabled crane management platform for real-time monitoring, predictive maintenance, and fleet optimization of overhead cranes. Tracks utilization, load capacity, safety parameters, and equipment health via sensor data. Delivers actionable insights through dashboards and alerts. Konecranes is the world's largest crane service company — over 600,000 cranes in their service portfolio.

**Why relevant:** The dominant incumbent in overhead crane AI monitoring. Konecranes' installed base and OEM relationship make them the hardest competitor to displace. CraneSync's opportunity is the non-Konecranes installed base (independent crane owners, multi-OEM fleets).

---

### 24. CrewOS
**Website:** https://crewos.io/industries/overhead-cranes/  
**Founded:** ~2021 | **HQ:** USA | **Stage:** Early-stage SaaS

**What they do:** Field service management software built specifically for overhead crane service companies. Features: digital inspections, time tracking, equipment tracking, scheduling, and compliance. Purpose-built for crane service contractors (the same businesses that would use CraneSync).

**Why relevant:** Direct channel-level competitor to CraneSync. Both target crane service contractors rather than crane end-users. CrewOS is FSM-first; CraneSync appears to be AI condition monitoring + FSM.

---

### 25. CraneMaster / Columbus McKinnon
**Website:** https://cmliftmaster.com / https://www.cmworks.com  
**Parent:** Columbus McKinnon (NASDAQ: CMCO) | **HQ:** Getzville, NY | **Revenue:** ~$700M

**What they do:** CraneMaster is Columbus McKinnon's crane management software platform for overhead cranes, hoists, and rigging equipment. Features: digital inspections, maintenance scheduling, compliance tracking (OSHA, CMAA standards), asset lifecycle management. Centralized platform designed for multi-crane fleet owners.

**Why relevant:** Columbus McKinnon is a major crane/hoist OEM with deep customer relationships. CraneMaster is their software play in the same digital inspection + maintenance space as CraneSync. The OEM's software advantage: pre-installed relationships and equipment telemetry access.

---

## Summary Matrix

| # | Company | URL | Funding/Stage | Closest To | Primary Threat To |
|---|---------|-----|----------------|------------|-------------------|
| 1 | Dovient | dovient.com | Seed/NASSCOM | MIRA | FactoryLM |
| 2 | Factory AI (f7i.ai) | f7i.ai | Seed | MIRA | FactoryLM |
| 3 | Tractian | tractian.com | $196M (Series C) | MIRA + sensors | FactoryLM |
| 4 | Augury | augury.com | $369M (unicorn) | MIRA + sensors | FactoryLM |
| 5 | MaintainX | getmaintainx.com | Series C | MIRA CMMS layer | FactoryLM |
| 6 | UpKeep | upkeep.com | Series B | MIRA CMMS layer | FactoryLM |
| 7 | Limble CMMS | limblecmms.com | Growth | Integration partner | FactoryLM |
| 8 | Fiix / Rockwell | fiixsoftware.com | Acquired | MIRA CMMS layer | FactoryLM |
| 9 | Siemens Copilot | siemens.com | Giant ($160B) | MIRA for Siemens kit | FactoryLM |
| 10 | IBM Maximo | ibm.com/maximo | Giant ($240B) | Enterprise EAM | FactoryLM (upstream) |
| 11 | Honeywell Forge | honeywell.com | Giant ($40B) | MIRA for process | FactoryLM |
| 12 | AspenTech | aspentech.com | Emerson-backed | MIRA for process | FactoryLM (process) |
| 13 | GE Vernova Proficy | gevernova.com | Public ($25B+) | MIRA for utilities | FactoryLM |
| 14 | PTC ThingWorx+ServiceMax | ptc.com | Public ($20B) | IIoT + FSM | Both |
| 15 | Sight Machine | sightmachine.com | $73M | MIRA namespace | FactoryLM |
| 16 | Nanoprecise | nanoprecise.io | $50.6M | Sensor PdM | FactoryLM |
| 17 | Samotics | samotics.com | Series B | No-sensor PdM | FactoryLM |
| 18 | SparkCognition | sparkcognition.com | $235M+ | Industrial AI | FactoryLM |
| 19 | C3.ai | c3.ai | Public ($3B) | Enterprise AI | FactoryLM (enterprise) |
| 20 | Samsara | samsara.com | Public ($25B) | IIoT platform | FactoryLM (long-term) |
| 21 | Azima DLI / Fluke | reliability.fluke.com | Fortive subsidiary | Legacy PdM services | FactoryLM |
| 22 | Palantir AIP | palantir.com | Public ($200B) | Enterprise digital twin | FactoryLM (enterprise) |
| 23 | Konecranes TRUCONNECT | konecranes.com | Public (€4B rev) | Crane OEM monitoring | CraneSync |
| 24 | CrewOS | crewos.io | Early-stage | Crane FSM | CraneSync |
| 25 | CraneMaster (CMC) | cmliftmaster.com | Public (CMCO) | Crane OEM software | CraneSync |

---

## Strategic Observations

**1. The Most Dangerous Competitor: Dovient**  
Dovient has almost identical positioning to MIRA — plant documents + work order history + AI copilot. They have paying enterprise customers (Thyssenkrupp, APL Apollo), are deploying in 2 weeks, and are actively publishing SEO-heavy comparison content. They are building mindshare aggressively. Watch their MissingDots verification layer — this is their main technical differentiator and will be used in sales conversations.

**2. The Funding Gap Is Real**  
Tractian ($196M) and Augury ($369M) have 100–200x more capital. FactoryLM's defensible moat must be the UNS namespace depth and the structured groundedness architecture — not feature parity. The namespace IS the moat; it's the thing neither of them has built.

**3. CraneSync's Moat: Non-Konecranes Fleets**  
Konecranes TRUCONNECT dominates for Konecranes equipment. The opportunity is the large installed base of cranes from other OEMs (Demag, P&H, Yale, independent manufacturers) where Konecranes has no software lock-in. CrewOS is the closest FSM-only competitor; CraneSync's AI condition monitoring layer is the differentiator.

**4. Enterprise vs. Mid-Market Gap**  
IBM Maximo, C3.ai, Palantir, and Honeywell Forge are $500K+ enterprise implementations. FactoryLM's $500 assessment → $2–5K/mo pilot → $499/mo operating layer is a clear entry point for the plants that can't afford those platforms. This is a wide open market segment.

**5. Agentic Is the Next Wave**  
Sight Machine's agentic platform launch (2026) and UpKeep's Nova autonomous agent signal the direction: from AI-assists-human toward AI-executes-autonomously. MIRA's UNS grounding architecture is the prerequisite for safe agentic execution in maintenance. Building the namespace now positions FactoryLM well for the agentic wave.

---

*Automated competitive intelligence report — generated by MIRA Cowork session 2026-06-12.*  
*Sources: factorylm.com, cranesync.com, dovient.com, tractian.com, augury.com, fiixsoftware.com, maintainx.com, upkeep.com, limblecmms.com, f7i.ai, siemens.com, ibm.com/products/maximo, honeywell.com, aspentech.com, gevernova.com, ptc.com, sightmachine.com, nanoprecise.io, samotics.com, sparkcognition.com, c3.ai, samsara.com, reliability.fluke.com, palantir.com, konecranes.com, crewos.io, cmliftmaster.com*
