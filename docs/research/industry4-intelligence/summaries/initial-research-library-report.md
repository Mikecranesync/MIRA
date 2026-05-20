# Initial Research Library Report — 2026-05-19

> First-sprint output. Captures everything created during the Tier 1 first-pass plus the synthesis layer (patterns, lessons, recommendations).
>
> **Status:** Complete first-pass. Tier 2 not yet started. No production code changed except the CLAUDE.md research-library pointer and the new skill.

## 1. Files created

### Scaffold (research only, no runtime change)

```
docs/research/industry4-intelligence/
├── README.md
├── INDEX.md
├── RESEARCH_ROUTINE.md
├── EXTRACTION_RULES.md
├── _templates/
│   ├── ARCHITECTURE_PATTERN_TEMPLATE.md
│   ├── COMPANY_TEMPLATE.md
│   ├── DECISION_LOG_TEMPLATE.md
│   └── SOURCE_TEMPLATE.md
├── companies/
│   ├── cesmii.md
│   ├── fuuz.md
│   ├── highbyte.md
│   ├── hivemq.md
│   ├── inductive-automation.md
│   ├── litmus.md
│   ├── machinemetrics.md
│   ├── maintainx.md
│   ├── thredcloud.md
│   ├── tulip.md
│   └── twinthread.md
├── mira-lessons/
│   ├── mira-architecture-decisions.md   (4 decision entries)
│   └── mira-wedge-and-positioning.md
└── summaries/
    ├── executive-summary.md
    └── initial-research-library-report.md  (this file)
```

### Code-touching files (minimal, intentional)

- `CLAUDE.md` — added "Research Intelligence Library" pointer section directing future Claude Code sessions to consult the library before major architecture/UNS/Ignition/MQTT/AI-agent/CMMS/competitive decisions.
- `.claude/skills/mira-industry4-research/SKILL.md` — new skill that auto-triggers on those topics.

## 2. Companies researched (Tier 1, first-pass complete)

11 of 11 Tier 1 companies have a populated file with public sources, facts, MIRA-specific lessons, and open questions:

| Company | Relevance | Threat | File |
|---|---|---|---|
| HighByte | 5 | Low (today) | [companies/highbyte.md](../companies/highbyte.md) |
| Inductive Automation (Ignition) | 5 | Medium | [companies/inductive-automation.md](../companies/inductive-automation.md) |
| HiveMQ | 5 | Low | [companies/hivemq.md](../companies/hivemq.md) |
| Tulip | 5 | Low-Medium | [companies/tulip.md](../companies/tulip.md) |
| MaintainX | 4 | **High** | [companies/maintainx.md](../companies/maintainx.md) |
| Litmus | 5 | Low | [companies/litmus.md](../companies/litmus.md) |
| MachineMetrics | 4 | Low-Medium | [companies/machinemetrics.md](../companies/machinemetrics.md) |
| TwinThread | 4 | Low-Medium | [companies/twinthread.md](../companies/twinthread.md) |
| CESMII | 5 | Low | [companies/cesmii.md](../companies/cesmii.md) |
| Fuuz | 4 | Medium | [companies/fuuz.md](../companies/fuuz.md) |
| ThredCloud | 5 | **Medium-High** (closest architectural twin) | [companies/thredcloud.md](../companies/thredcloud.md) |

Tier 2 (13 companies — Opto 22, FlowFuse, Software Toolbox, DYNICS/AnyLog, Siemens, Phoenix Contact, AVEVA, Critical Manufacturing, Google Cloud Manufacturing, Tatsoft, Flow Software, Portainer, TDengine) remain as `_planned_` in INDEX.md. They will be the next sprint's first task list.

## 3. Sources found (highlights)

Total sources cited across the 11 company files: **~60 public URLs** spanning vendor docs, vendor blogs, partner case studies (Cedalo / Inductive Automation), analyst coverage (Tech-Clarity, LNS Research, ARC, IDC), government program pages (DOE / Manufacturing USA for CESMII), and review sites (Gartner Peer Insights, Capterra, G2). Date-stamped 2026-05-19 throughout.

**The single most valuable external source surfaced this sprint:**

- **LNS Research, "ProveIt! 2026: All About UNS, Knowledge Graphs, and Claude Code"** — https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code

That single article names every Tier 1 vendor we researched, confirms graph-based data models as the breakout pattern at the event, identifies **MCP as the emerging interface for AI-agent access to industrial data**, and notes vendors using **Claude Code itself to build connectors live**. It is the cleanest analyst validation we have for the stack MIRA is already running.

## 4. Strongest repos (candidates for deeper review next sprint)

Read-but-not-yet-deep-dived GitHub orgs identified during first-pass. These move to `repos/` next sprint:

| Repo / org | Why it matters | Action |
|---|---|---|
| [github.com/cesmii](https://github.com/cesmii) | SM Profile SDKs + SMIP GraphQL API — neutral standards substrate aligned with MIRA's KG | Pull repos; evaluate SM Profile shape vs MIRA component templates; export prototype |
| [github.com/hivemq](https://github.com/hivemq) | HiveMQ Community Edition + Edge + Sparkplug B clients | Evaluate Edge as a candidate staging broker for `mira-relay/` |
| Eclipse Tahu (Sparkplug B reference) | Reference Sparkplug B implementation | Verify any MIRA Sparkplug B handling targets Tahu conformance |

UNCONFIRMED public repo footprint (worth confirming or downgrading next sprint): HighByte, Litmus, MaintainX, MachineMetrics, TwinThread, ThredCloud, Tulip, Fuuz.

## 5. Architecture patterns visible across the cohort

Five recurring patterns showed up in two or more company files. These will be promoted into `architecture-patterns/` files next sprint:

1. **UNS as model layer, broker as plumbing** — HighByte's framing, echoed implicitly by Fuuz (UMP = UNS + apps) and ThredCloud (KG above Ignition UNS). The counter-framing is HiveMQ's "broker = UNS." MIRA sits on HighByte's side.
2. **ISA-95 hierarchy (enterprise → site → area → line → cell → asset → component)** — HiveMQ, Inductive Automation, Litmus, Fuuz all map onto it. MIRA's UNS already conforms.
3. **Per-model definition + per-instance attachment** — UDTs in Ignition, "instances + definitions" in HighByte, "Model Factory" in TwinThread, "Tables + Records" in Tulip, ThredCloud's KG. Same shape as MIRA's component templates.
4. **Knowledge graph as the contextualization layer above raw OT** — ThredCloud most explicitly; TwinThread's "context model"; HighByte's modeled instances; **and MIRA's `kg_entities` + `kg_relationships`**. The category is real, and MIRA is in it.
5. **MCP as the agent ↔ industrial-data interface** — HighByte (announced), ProveIt 2026 analyst consensus, MIRA's existing `mira-mcp/`. This is the standard, not a side-bet.

## 6. What MIRA should study deeper next

Ranked by expected payoff:

1. **CESMII SM Profiles + SMIP GraphQL API** ([repo](https://github.com/cesmii)) — Could MIRA component templates round-trip to SM Profiles? Big credibility lever if yes.
2. **ThredCloud product surfaces** — Watch their KG / NL-query UX evolution closely. Quarterly cadence.
3. **HighByte's MCP services** when they ship — direct integration candidate. Re-review HighByte file as soon as the MCP services are publicly documented.
4. **MaintainX CoPilot's evidence/citation behavior** — Does it cite manuals + WO IDs? If yes, the AI-side gap with MIRA is narrower than it looks today.
5. **Sparkplug B TCK + Tahu reference** — Conformance bar for `mira-relay/`.

## 7. What MIRA should emulate

Concrete, file-pointed:

- **HighByte's "model = UNS, broker = plumbing" framing** — cite externally; matches MIRA's actual architecture.
- **HiveMQ's pedagogy on ISA-95 + Sparkplug B + UNS** — borrow style and (selectively) link from MIRA's own UNS docs.
- **ThredCloud's "medium-factory" ICP positioning + KG-as-context-layer** — same band as MIRA's PLG funnel; same architectural shape.
- **MaintainX's voice-to-WO + photo-to-recommendation mobile UX patterns** — re-skin for the Slack thread surface. Feature ideas, not full builds.
- **TwinThread's "triad" messaging shape (Predictive / Prescriptive / Generative)** — adapt to MIRA's three: **grounded / gated / cited**.

## 8. What MIRA should avoid

- **Replicating MES / SCADA / broker surfaces.** Ignition, Tulip, Fuuz, HiveMQ, MachineMetrics own those; competing wastes the wedge.
- **Mobile-first.** MaintainX owns it. Slack-first is the contrarian, defensible bet.
- **Generic "AI for manufacturing" language.** Every Tier 1 vendor uses it. MIRA differentiates on grounded + gated + cited, not on the word "AI."
- **Anthropic as a provider** — already off the table (PRs #610 / #649). Confirmed unchanged by research; MCP-the-protocol is provider-neutral and unaffected.
- **Building a digital twin visualization.** TwinThread owns it; MIRA doesn't need it.
- **Tying tightly to Ignition** — ThredCloud bet that way; MIRA stays vendor-neutral on the SCADA layer.

## 9. How Claude Code should use this library going forward

When Claude Code (or a human) lands on a prompt touching:

- **UNS / Ignition / MQTT / Sparkplug B** → open `companies/highbyte.md`, `companies/hivemq.md`, `companies/inductive-automation.md` and the relevant architecture-patterns files.
- **Competitive positioning / "how are we different from {X}"** → open `companies/{X}.md` § Threat-level + `mira-lessons/mira-wedge-and-positioning.md`.
- **CMMS integration / work-order flow** → open `companies/maintainx.md` first, then `companies/twinthread.md` (predictive → WO pattern), then Atlas docs.
- **AI agent / MCP / KG decisions** → open `mira-lessons/mira-architecture-decisions.md` (2026-05-19 MCP entry) + `companies/highbyte.md` + `companies/thredcloud.md`.
- **Standards / interoperability questions** → open `companies/cesmii.md` first.

The `.claude/skills/mira-industry4-research/` skill auto-triggers and points at these. If the answer isn't in the library, run `RESEARCH_ROUTINE.md` against the missing target *and then* answer — don't decide off vibes.

Quote file paths in responses. Don't paraphrase findings without a pointer. If a recommendation is material, append a new entry to `mira-lessons/mira-architecture-decisions.md` using `_templates/DECISION_LOG_TEMPLATE.md`.

## 10. Next research sprint (pre-loaded)

Ordered by expected value:

1. **CESMII SM Profile SDK deep dive** — pull repos, evaluate against `mira-crawler/ingest/uns.py` + component-template schema. Output: `repos/cesmii-sm-profiles.md` + `architecture-patterns/sm-profile-as-data-contract.md` + a decision-log entry on whether MIRA exports component templates as SM Profiles.
2. **Tier 2 first-pass triage** — read each Tier 2 entry's homepage + one analyst piece; convert from `_planned_` to either `stub` (low priority, written next-quarter) or `first-pass` (write a full file this month). Likely outcomes: AVEVA + Phoenix Contact + Google Cloud Manufacturing get full files; Portainer + Tatsoft get stubs.
3. **Architecture-patterns extraction round** — promote the five patterns identified in §5 into `architecture-patterns/` files. Each pattern cross-links back to the company files that exhibit it.
4. **Re-review MaintainX + ThredCloud** — both are high-velocity products; quarterly re-read.
5. **Open the Thred partnership conversation** (GTM, outside this library, but driven by it). Track outcome in the decision log.

## 11. Hard rules respected during this sprint

- ✅ No production code changes other than CLAUDE.md pointer + skill creation.
- ✅ No proprietary content copied — public sources only, all cited.
- ✅ Source links on every finding (~60 URLs total).
- ✅ UNCONFIRMED / INFERENCE labels applied wherever a fact wasn't directly verifiable.
- ✅ Facts separated from recommendations via the template structure.
- ✅ Every company file ends with a "MIRA lessons" section connecting findings back to MIRA.
- ✅ Two clean commits: scaffold first, researched content second.

## 12. Caveats and known gaps

- **First-pass only.** Each company file is ~300 lines and represents 20-30 minutes of research per company. Deeper dives (especially into HighByte's MCP services, ThredCloud's product, and MaintainX CoPilot's citation behavior) need follow-up.
- **No live video transcripts pulled.** YouTube / conference talks are listed in some company files but not transcribed. Next sprint should pull at least one (likely Inductive Automation ICC 2024 "Demystifying the UNS").
- **GitHub repo depth UNCONFIRMED for many vendors.** Listed as "UNCONFIRMED" where we did not verify the public repo footprint. CESMII and HiveMQ are confirmed-significant; others need a quick `gh api orgs/{org}/repos` pass.
- **Pricing models are mostly UNCONFIRMED** — vendors hide tiers behind sales calls. Capterra / G2 review pages are the cleanest secondary source.
- **No primary-source interviews.** Everything is from public-facing materials. A handful of customer conversations (or a single conference attendance — ProveIt 2027 if it runs) would deepen most files dramatically.

---

**Bottom line:** MIRA's existing architecture choices — UNS gate, KG, MCP, Slack-first, grounded answers with citations, multi-PLC, vendor-neutral — are validated by what the most-cited public vendors are actually doing. The largest delta we found is that **MaintainX is closer than expected on grounded AI**, and **ThredCloud is closer than expected on architecture**. Hold the wedge; tighten the messaging; ship the partnerships.
