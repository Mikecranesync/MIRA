# MIRA vs. Every Problem Raised in "What Manufacturing Still Hasn't Solved"

## Overview

The 4.0 Solutions ProveIt! fireside chat ("What Manufacturing Still Hasn't Solved," March 2026) brought together five industry leaders — Magnus (CTO, HiveMQ), Zack Etshtein (VP Architecture, Flow Software), Mark Friedman (Founder, Make Yourself AI), Sam (VP Product Experience, Litmus), and moderator Jeff Nepper — to map the honest gap between the current state of industrial AI and what it needs to become. Every problem they raised is either a direct MIRA use case, a MIRA Connect onboarding problem, or a foundational architecture decision already in MIRA's I3X compliance spec. This document maps each problem to a specific MIRA solution.[^1]

***

## Problem 1: AI Doesn't Remember — No Persistent, Contextual Memory

**What they said:** Mark Friedman described the dream as an AI that "remembers our intention, remembers what we like, our tribal knowledge — not just RAG or a knowledge graph — but actually understands *when* to remember the right thing so it can recall it." He called this "just-in-time memory." The critique is specific: "When it comes to manufacturing operations, things that matter — you can't forget even the details. You need to know exactly the schema of that table."[^1]

**Why it's unsolved today:** Standard RAG retrieves documents but has no concept of *relevance to the current situation.* A technician describing a new fault doesn't get surfaced with the memory of last time the same fault occurred on the same machine, because that memory is stored as a flat embedding without temporal or situational context.[^1]

**MIRA's answer:** MIRA's pgvector store is keyed by ISA-95 path, equipment ID, and `data_type` — so every past fault event, every work order resolution, every OEM note, and every technician conversation related to `AcmePlant/Line2/Oven1/Zone3` is co-located under the same key. When a tech opens a job on Zone 3, MIRA's retrieval query filters for that exact ISA-95 path across all `data_type` values simultaneously — live telemetry, maintenance history, work orders, tribal knowledge captures, and OEM manual excerpts all surface together. The result is situationally relevant memory: not everything MIRA knows, but everything MIRA knows *about this machine right now.* The few-shot template library built into MIRA Connect compounds this — every confirmed mapping and every resolved fault event becomes a retrievable precedent for future similar situations.

***

## Problem 2: Tribal Knowledge Is Trapped in People's Heads

**What they said:** Zack Etshtein: "We have all this tribal knowledge in the factory and it's in people's heads — it's not in a form that an agent can work on." This includes which vendor lot to use, who to call when a specific drive trips, why a setpoint was changed three years ago, and what the senior tech does differently than everyone else to get a machine running in 20 minutes instead of two hours. HiveMQ's 2026 survey confirmed data governance and contextualization tools as a top priority for 67% of manufacturers — specifically because unstructured knowledge can't be acted on by agents.[^1]

**Why it's unsolved today:** Current solutions — digital SOPs, Augmentir, Composabl — capture knowledge in *human-readable* structured documents but produce formats that require an engineer to translate into something an agent can traverse. The knowledge exists; the agent-ready encoding doesn't.[^2][^3]

**MIRA's answer:** MIRA's tribal knowledge capture is native to the maintenance workflow — not a separate "document your knowledge" task that nobody does. When a tech resolves a fault through MIRA, the resolution path, the symptoms described, the steps taken, and the outcome are automatically embedded as a `data_type: tribal_knowledge` vector keyed to the equipment's ISA-95 path. No separate documentation step. No SOP authoring. The act of using MIRA *is* the capture mechanism. Over time, MIRA accumulates a dense, agent-queryable institutional memory indexed by equipment, failure mode, and outcome — exactly the form the panelists said doesn't exist today.

***

## Problem 3: No "Harness" for Industrial AI

**What they said:** Magnus described the need for "a harness or a jig for industrial AI — tools that allow us to do it agentically, safely, repeatably, reliably." He noted that software engineering has good harnesses (Claude Code, Cursor) but "we don't have that for industry — we haven't figured out what that harness is yet." The Zach / Jeff exchange made this concrete: harnesses manage context, manage what goes in, manage how the agent responds, and execute from that response safely in an industrial environment where a wrong action has physical consequences.[^1]

**Why it's unsolved today:** General-purpose AI agent frameworks (LangGraph, CrewAI, AutoGen) are not designed for industrial safety constraints. They have no concept of ISA-95 hierarchy, no understanding of which actions require operator confirmation before execution, and no mechanism for audit trails that OT security teams require.[^4]

**MIRA's answer:** MIRA's architecture *is* the industrial harness. Every MIRA action that touches physical systems — creating a work order, escalating an alarm, changing a setpoint recommendation — flows through a confirmation layer that requires explicit technician sign-off before execution. The I3X API server exposes only read operations externally; write operations require authenticated MIRA sessions. Context is managed by ISA-95 path scoping — MIRA never sends a full plant knowledge graph to the LLM; it scopes context to the specific equipment object being worked on, matching exactly what the panelists described as the correct approach to context window management. The MIRA Connect setup wizard produces a validated SM Profile that becomes the harness's ground truth — the agent always knows the schema of what it's operating on.[^5]

***

## Problem 4: Data Has No Semantic Structure — Agents Can't Navigate It

**What they said:** Jeff Nepper's framework: "Structure, fidelity, and context. You must have all three." Zack explained why this matters for agents: with 100,000 CNCs, if you only have instance data, it overwhelms the agent's context window. An ontology layer connects each machine to its line, area, operators, and relationships so the agent can reason hierarchically — understanding context without consuming the entire dataset. Flow Software's knowledge graph work with Infohub demonstrates this practically — transforming raw operational data into contextualized, decision-ready information.[^6][^1]

**Why it's unsolved today:** Most manufacturers have raw SCADA/historian data that is instance data only — tag addresses and values with no semantic layer. The UNS provides a naming hierarchy but not an ontology. Knowledge graphs exist as a concept but "it's not known what the right node or edge should be — we're still learning," as multiple panelists admitted.[^1]

**MIRA's answer:** MIRA's SM Profile data model with ISA-95 paths *is* the ontology layer the panelists described. The three-tier structure — ontology (SM Profile type definition: what a ZoneHeater *is*), instance (this specific zone heater at this specific path), and relationships (`partOf`, `adjacentTo`, `monitoredBy`, `feedsInto`) — maps directly to the knowledge graph architecture described by Zack and validated by peer-reviewed digital twin research. When MIRA's RAG pipeline receives a query about Zone 3, it doesn't dump all 10,000 tags into the context window. It navigates the relationship graph: Zone 3 is `partOf` Oven 1, which is `partOf` Line 2. The agent can traverse up and down that structure to gather exactly the context required for the question — no more, no less. The knowledge graph problem the panelists described as unsolved is solved in MIRA through the ISA-95 + SM Profile + relationships JSON structure.[^7]

***

## Problem 5: Data Fidelity — Raw Factory Data Is Untrustworthy for AI Reasoning

**What they said:** Jeff: "The fidelity is we have to make sure that the stuff we're putting in our structure and our data stores can be trusted." The context window is a strength only if what goes in is coherent and curated — "give it every edge and node and the agent will say: what do you want me to do with this?" HiveMQ's agentic AI work emphasizes that "the benefits of agentic AI depend entirely on the data backbone behind it" — live operational context must be continuously delivered so agents can observe, reason, and act on real conditions, not stale data.[^5][^1]

**Why it's unsolved today:** Raw OPC UA tag values have no quality metadata. A value of `415.2` has no unit, no normal range, no alarm thresholds, no indication of whether the sensor is healthy or faulty. An AI receiving this value has no basis for reasoning about whether it's good, bad, or meaningless.[^1]

**MIRA's answer:** Every property in a MIRA SM Profile carries quality metadata: `engineeringUnit`, `normalRangeMin`, `normalRangeMax`, `alarmHigh`, `alarmLow`, `quality` (Good/Bad/Uncertain from OPC UA quality codes), and `timestamp`. When MIRA's RAG pipeline embeds a live telemetry reading, it converts it to natural language: "Zone 3 temperature currently 415.2°F — within normal range (350–425°F), quality: Good, heater enabled, setpoint 415°F." An AI receiving this context doesn't need to know what "415.2" means — it has complete, trusted, unit-annotated context. MIRA Connect's AI mapper also validates data type match between the source tag and the SM Profile field definition before writing to the database — a Modbus register mapped to the wrong field type fails validation rather than silently corrupting the context store.

***

## Problem 6: No Feedback Loop — AI Interactions Don't Improve the System

**What they said:** This was implied rather than stated directly, but the panelists' description of the ideal AI — one that remembers, learns, and improves — implicitly requires a feedback mechanism that doesn't exist in current industrial platforms. The academic three-layer knowledge graph architecture for digital twins explicitly addresses this: "optimized and updated knowledge is fed back into the knowledge graph, thereby enabling iterative optimization".[^7][^1]

**Why it's unsolved today:** Every industrial AI pilot today is essentially stateless — the same questions get the same answers regardless of how many times a technician has corrected the AI, confirmed a mapping, or resolved a fault. There is no compounding.

**MIRA's answer:** Three compounding loops are built into MIRA's architecture. First, MIRA Connect's few-shot template library grows with every technician confirmation — each confirmed tag mapping becomes a high-confidence template for the next similar tag. Second, every resolved maintenance event is embedded as a `tribal_knowledge` vector that future MIRA queries can retrieve — the system gets smarter about each specific machine with every use. Third, the `FewShotTrainer` in the AI mapper tracks confirmation counts and uses them to boost confidence scores, so mappings that have been confirmed 20 times get near-automatic approval while new mappings get human review. The system compounds rather than plateaus.

***

## Problem 7: Brownfield Infrastructure — Factories Aren't Connected

**What they said:** Sam and Zack both emphasized that AI is "the last thing" — you need data infrastructure first. Sam specifically called out the dream of running AI utilities "on premises — we don't need a data center, not even more than a 12 gig card." The Litmus-AWS architecture demonstrates the current state of the art: edge-to-cloud data fabric requiring significant integration effort.[^1]

**Why it's unsolved today:** Most brownfield plants have PLCs that have never exposed data outside the control panel. Getting from "PLC running a machine" to "AI can reason about that machine" currently requires a systems integrator engagement, protocol converters, historian configuration, and weeks of tag mapping.[^1]

**MIRA's answer:** MIRA Connect is the direct answer to this problem. The setup wizard auto-discovers OPC UA endpoints on the local network, connects without firewall changes, and completes tag mapping in under 30 minutes on a tablet held by a maintenance technician — not a systems integrator. For the most resource-constrained sites, MIRA Connect's offline mode runs a local Ollama instance for AI mapping with zero cloud dependency, specifically addressing Sam's "12 gig card" vision. For ongoing operation, a single Tailscale node on one plant PC gives MIRA permanent secure access to live OPC UA data without IT approval or VPN configuration. The entire stack — ingest, map, confirm, publish, analyze — runs on hardware that already exists inside the plant.

***

## Problem 8: Wrong First Step — Executives Believe AI Means Headcount Reduction

**What they said:** Jeff was direct: "3 out of every 5 boardrooms I go in, they think the promise is in the reduction of headcount — and they are going to fail. The promise is found in optimizing the headcount we already have so that we can grow our head count." Walker extended this: "making ordinary people super people, making super people exceptional people."[^1]

**Why it's a problem:** When executives frame AI as a cost-cutting tool, maintenance technicians treat it as a threat to their jobs and resist adoption. Knowledge capture fails because workers won't document their expertise into a system they believe will eliminate their role.[^2]

**MIRA's answer:** MIRA's entire positioning is the technician copilot, not the technician replacement. The onboarding flow explicitly centers the tech as the expert — MIRA asks the tech questions, confirms the tech's knowledge, and makes the tech the agent who decides what's right. This isn't just messaging; it's architecture. MIRA Connect's confirmation UI is built so the tech feels heard (their local knowledge overrides the AI's suggestions), not audited. The few-shot training loop rewards tech input by making future sessions faster and more accurate — demonstrating tangible personal benefit from contributing knowledge rather than fear of obsolescence. The CraneSync background makes this credibility authentic: MIRA is built by a maintenance tech, for maintenance techs.

***

## Problem 9: Trusted Delegation Doesn't Exist Yet

**What they said:** Magnus: "Trusted delegation — I want to be able to assign a task to a confident colleague and know it's going to get accomplished repeatedly with memory." Walker: "We're really addressing downtime when we plan to be down and not dealing with it when we're not planning to be down — scheduling and running work orders in the absolutely most optimal way possible."[^1]

**Why it's unsolved today:** No industrial AI today can be trusted to autonomously schedule a work order, dispatch a technician, or recommend a parts order without human review of every step — not because the AI lacks capability but because there is no audit trail, no explainability, and no mechanism to verify that the AI's reasoning was grounded in real equipment context.[^5]

**MIRA's answer:** MIRA's I3X-compliant data backbone provides the explainability layer trusted delegation requires. When MIRA recommends scheduling a bearing replacement on Conveyor 2, the recommendation is traceable: it cites the specific vibration readings (with quality codes), the historical precedent (last time vibration reached this level on this conveyor, bearing failed 11 days later), the OEM manual recommendation (replace bearing at X vibration threshold), and the prior tech confirmation (two technicians have confirmed this mapping). The tech doesn't have to trust MIRA's black box — they can see exactly what MIRA saw and why it concluded what it did. That transparency is what converts "interesting AI output" into trusted delegation in an industrial environment.

***

## Problem 10: Knowledge Graph Node/Edge Design Is Unsolved

**What they said:** Zack acknowledged openly: "It's not known what the right node should be. It's not known what the right edge should be. We're still learning." The warning: if you dump the entire graph into the agent's context, "the agent's going to say — what do you want me to do with this?" Mark added that context window limits are a *strength* — they force coherent, focused communication rather than information overload.[^1]

**Why it's unsolved:** General knowledge graph implementations in manufacturing use flat entity models — every machine is a node, every person is a node, every event is a node. Without a principled ontology (like ISA-95 or SM Profiles) defining *what kind of thing* each node is and *what kinds of relationships are valid*, the graph becomes semantically meaningless to an agent.[^7]

**MIRA's answer:** MIRA doesn't solve the general knowledge graph problem — it solves it specifically for maintenance. The node definition is the SM Profile (a `ZoneHeater`, `ConveyorDrive`, `CentrifugalPump` — typed, versioned, schema-validated objects). The valid edge types are the relationships in the SM Profile JSON (`partOf`, `adjacentTo`, `monitoredBy`, `feedsInto`) — not arbitrary graph edges but semantically meaningful maintenance relationships. Context scoping uses ISA-95 hierarchy: a query about Zone 3 activates the Zone 3 subgraph, not the entire plant graph. This is precisely the ontology-plus-instance-data architecture Zack described as the right answer — MIRA just implements it specifically for the maintenance domain rather than attempting a general solution.

***

## Problem 11: Knowledge Capture Must Feel Natural — Not Extractive

**What they said:** Mark: "It has to be natural for them. The agent should be listening to you primarily. You shouldn't have to open VS Code. No concern about giving up that information — because it's actually helping you. You feel heard and you actually feel helped."[^1]

**Why it's a problem:** Every "capture the expert's knowledge" initiative in manufacturing history has failed for the same reason: asking workers to document what they know feels like performance review, threat assessment, and job elimination all at once. Workers who cooperate do so grudgingly and incompletely.[^8]

**MIRA's answer:** MIRA's knowledge capture happens entirely within the maintenance workflow. A technician using MIRA to diagnose a fault isn't "documenting tribal knowledge" — they're getting help with a problem they have right now. The capture is a side effect of the help. The confirmation UI in MIRA Connect asks plain-English questions while the tech stands in front of the machine: "This register seems to control temperature — does that look right to you?" The tech answers in their own words, MIRA records the context, and the tech gets a cleaner MIRA experience next time as a direct reward. Mark's iPad demos of makeyourself.ai represent the frontier of this approach — MIRA's UX philosophy draws directly from that model of empathy-driven agent design.[^1]

***

## Problem 12: Scale — What Works at One Site Doesn't Replicate

**What they said:** All panelists acknowledged they are "actively figuring out the answers" and that the architectures for reliable scale in industrial AI don't fully exist yet. HiveMQ's 2026 report confirms that most industrial AI teams "can't scale past pilots due to data and integration gaps". The recommended path: improve data quality and governance, strengthen IT/OT collaboration, expand real-time data streaming, and modernize brittle integrations.[^1]

**Why it's hard:** Every brownfield site has a unique tag schema invented by a different integrator in a different decade. What MIRA learns about Site A's Siemens S7 configuration has historically been useless for Site B's Allen-Bradley setup.[^1]

**MIRA's answer:** MIRA's template library is the scale mechanism. The SM Profile schema is vendor-neutral — a `ConveyorDrive` profile has the same structure whether the source is an Allen-Bradley PowerFlex, a Danfoss FC302, or a Siemens G120. When MIRA Connect maps Site A's PowerFlex to a `ConveyorDrive` profile and the tech confirms it, that confirmation becomes a template. When Site B has a PowerFlex, MIRA auto-applies the template with high confidence — the tech confirms in seconds rather than minutes. By Site 10, the template is essentially automatic. This is the compounding network effect that makes MIRA's value accelerate with deployment count rather than plateauing. The CESMII SM Marketplace adds a distribution layer: validated profiles published there are immediately available to every manufacturer in the CESMII network, turning MIRA's local template library into an industry-wide shared resource.

***

## Summary: MIRA's Response to Every Identified Gap

| Problem Identified in Video | MIRA Component That Answers It |
|---|---|
| AI doesn't remember / just-in-time memory | ISA-95-keyed pgvector with multi-`data_type` retrieval |
| Tribal knowledge trapped in heads | Native capture via maintenance workflow, not separate documentation |
| No industrial AI harness | ISA-95 scoped context, confirmation layer, SM Profile as ground truth |
| No semantic structure / agents can't navigate | SM Profile ontology + ISA-95 instance + relationships graph |
| Data fidelity — raw tags are untrustworthy | SM Profile quality metadata, unit annotation, range validation |
| No feedback loop / AI doesn't compound | Few-shot trainer, tribal knowledge embedding, confidence boosting |
| Brownfield factories aren't connected | MIRA Connect — setup wizard, auto-discovery, offline mode, Tailscale |
| Wrong first step — headcount reduction mindset | Technician copilot architecture, tech-as-expert UX, CraneSync credibility |
| Trusted delegation doesn't exist | Explainable recommendations with traceable sources and quality codes |
| Knowledge graph node/edge design unsolved | SM Profile as typed node definition, maintenance relationships as valid edges |
| Knowledge capture must feel natural | Capture as side effect of usage, plain-English confirmation questions |
| Scale beyond individual site pilots | Template library, SM Profile vendor-neutrality, CESMII Marketplace |

Every gap the panelists identified is either already designed into MIRA's architecture or directly addressed by MIRA Connect's onboarding mechanic. The panelists weren't describing competitors — they were describing the market need MIRA was built to fill.

---

## References

1. [Accelerating Industrial AI in 2026: The Report - HiveMQ](https://www.hivemq.com/resources/the-report-accelerating-industrial-ai-in-2026/) - Industrial AI is accelerating, but most teams can't scale past pilots due to data and integration ga...

2. [How to preserve tribal knowledge in manufacturing with AI - LinkedIn](https://www.linkedin.com/posts/kence_smartmanufacturing-operationalexcellence-activity-7354159735807365120-IVaj) - key is how best a manufacturing company can capture decades of priceless operational 'tribal' knowle...

3. [What is Tribal Knowledge and How Do You Capture It? - Augmentir](https://www.augmentir.com/glossary/what-is-tribal-knowledge) - Manufacturers can capture tribal knowledge by implementing digital knowledge management systems, sta...

4. [Best AI Agent Harness Tools and Frameworks 2026 - Atlan](https://atlan.com/know/best-ai-agent-harness-tools-2026/) - Compare 11 AI agent harness tools in 2026 — LangGraph, CrewAI, AutoGen, Mastra, and more. Benchmarks...

5. [Build the Foundation for Agentic AI in Industrial Operations - HiveMQ](https://www.hivemq.com/solutions/agentic-ai-in-industrial-operations/) - Discover how HiveMQ powers agentic AI use cases & applications in industrial operations with real-ti...

6. [Automation Engineer to AI Agent | Flow Software Webinar - YouTube](https://www.youtube.com/watch?v=bW-SO4HQrCQ) - ... Knowledge Graph 1:10:10 – Closing & How to Connect with Flow. ... 4 Industrial Data Use Cases: A...

7. [Digital twin system for manufacturing processes based on a multi ...](https://pmc.ncbi.nlm.nih.gov/articles/PMC11997226/) - We propose a novel three-layer knowledge graph architecture to enhance digital twin modeling for man...

8. [Culture Change: 4 Ways to Overcome Tribal Knowledge and Inspire ...](https://drive.starcio.com/2025/09/culture-change-overcome-tribal-knowledge-inspire-expertise/) - “The cost of losing tribal knowledge isn't just downtime—it's lost innovation. AI gives us the chanc...

