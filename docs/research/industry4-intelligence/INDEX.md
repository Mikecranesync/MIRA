# INDEX — Industry 4.0 Intelligence Library

> Navigation hub. Every entry is a one-line hook + link. Add to this file when you add to the library.
>
> **Last refreshed:** 2026-05-20
> **Active research sprint:** Fuuz deep-dive (Episode 6 video + fuuz-skills + proveit2026 repos). See [summaries/fuuz-first-action-final-report.md](summaries/fuuz-first-action-final-report.md).

## How to use this page

- **Browsing by company?** Jump to [Companies](#companies).
- **Looking for a decision rationale?** Read [mira-lessons/](#mira-lessons).
- **Looking for a pattern (UNS topic layout, payload shape, agent skeleton)?** See [Architecture Patterns](#architecture-patterns).
- **Need the recurring process?** Read [RESEARCH_ROUTINE.md](RESEARCH_ROUTINE.md).

---

## Companies

### Tier 1 — direct relevance to MIRA

| Company | Category | MIRA overlap | File | Status |
|---|---|---|---|---|
| Fuuz | UNS / MES platform + Claude Code skill library | **Very High** | [companies/fuuz.md](companies/fuuz.md) | **deep-dive complete (2026-05-20)** |
| Tulip | Frontline Operations (low-code apps + AI) | High | [companies/tulip.md](companies/tulip.md) | first-pass |
| CESMII | National Smart Manufacturing Institute (non-profit) | Medium-High (standards) | [companies/cesmii.md](companies/cesmii.md) | first-pass |
| HighByte | Industrial DataOps + UNS | Very High | [companies/highbyte.md](companies/highbyte.md) | first-pass |
| Inductive Automation (Ignition) | SCADA / IIoT platform | Very High | [companies/inductive-automation.md](companies/inductive-automation.md) | first-pass |
| Litmus | Edge / UNS + analytics | High | [companies/litmus.md](companies/litmus.md) | first-pass |
| HiveMQ | MQTT broker + Sparkplug B steward | Medium-High (infra) | [companies/hivemq.md](companies/hivemq.md) | first-pass |
| MaintainX | CMMS / mobile maintenance + AI | Very High (CMMS adjacency) | [companies/maintainx.md](companies/maintainx.md) | first-pass |
| MachineMetrics | Discrete production analytics | High | [companies/machinemetrics.md](companies/machinemetrics.md) | first-pass |
| TwinThread | Predictive ops + asset modeling | Medium-High | [companies/twinthread.md](companies/twinthread.md) | first-pass |
| ThredCloud (Thred) | KG + AI on Ignition | **Very High** (closest architectural twin) | [companies/thredcloud.md](companies/thredcloud.md) | first-pass |

### Tier 2 — adjacent / partial relevance

| Company | Category | MIRA overlap | File | Status |
|---|---|---|---|---|
| Opto 22 | Controller + REST-native PLC | Medium | _planned_ | not yet |
| FlowFuse | Node-RED commercial DevOps | Medium | _planned_ | not yet |
| Software Toolbox | OPC / connectivity tooling | Medium | _planned_ | not yet |
| DYNICS / AnyLog | Edge networking + distributed DB | Medium | _planned_ | not yet |
| Siemens (Industrial Edge / Insights Hub) | Tier-1 OT incumbent | Low (scale mismatch) | _planned_ | not yet |
| Phoenix Contact (PLCnext) | OT controller + open Linux runtime | Medium | _planned_ | not yet |
| AVEVA (incl. PI System) | Process historian / OI platform | Medium | _planned_ | not yet |
| Critical Manufacturing | MES (semiconductor) | Medium | _planned_ | not yet |
| Google Cloud Manufacturing | Cloud / connect / analytics | Medium | _planned_ | not yet |
| Tatsoft | SCADA / FactoryStudio | Medium | _planned_ | not yet |
| Flow Software | Operational manufacturing intelligence | Medium | _planned_ | not yet |
| Portainer | Container management for edge | Low-Medium (ops only) | _planned_ | not yet |
| TDengine | Time-series DB for industrial telemetry | Medium | _planned_ | not yet |

---

## Repos

| Repo | Owner | Why it matters | File |
|---|---|---|---|
| fuuz-skills + proveit2026 | Fuuz Industrial Intelligence | 7 Claude Code skills (~43k lines) + 3 demo `.fuuz` packages (100 models / 73 screens / 94 flows). Public reference for AI-native industrial development. | [repos/fuuz-repo-analysis.md](repos/fuuz-repo-analysis.md) |

> Populate as we deep-dive specific GitHub orgs. Tier 1 first-pass surfaced candidate repos in each company file's "Public sources" section — promote the strongest ones here.

---

## Videos

| Video | Speaker / event | Why it matters | File |
|---|---|---|---|
| Episode 6 — AI on the Factory Floor (ProveIt! 2026 demo) | Craig Scott (Fuuz CEO) | Live walk-through of how Craig + Claude built 100 data models, 73 screens, 94 flows in 2–3 weeks. UNS architecture, ML pipeline, "mini UNS at screen level," Claude Code workflow, anti-patterns. | [videos/fuuz-video-analysis.md](videos/fuuz-video-analysis.md) |
| (10 more Fuuz videos catalogued) | Fuuz / Manufacturing Matrix / Fuuz Unplugged | Queued for Tier-2/3 analysis | [videos/video-index.md](videos/video-index.md) |

---

## Architecture Patterns

| Pattern file | One-line hook |
|---|---|
| [architecture-patterns/fuuz-patterns.md](architecture-patterns/fuuz-patterns.md) | 12 patterns extracted from Fuuz — event-driven monolith, UNS-as-nervous-system, mini-UNS-at-screen, mutex on data-point, hybrid ML pipeline, etc. |
| [architecture-patterns/industrial-ai-agent-patterns.md](architecture-patterns/industrial-ai-agent-patterns.md) | 12 patterns for how AI-native industrial vendors compose skills, MCP, guardrails. Cross-vendor signal table. |
| [architecture-patterns/screens-workflows-patterns.md](architecture-patterns/screens-workflows-patterns.md) | Layout consistency, action pipelines, page-load flows, Developer Mode, HMI subtype, "build app with Claude" loop. |
| [architecture-patterns/data-modeling-patterns.md](architecture-patterns/data-modeling-patterns.md) | 14 schema patterns — master/setup/transactional taxonomy, FK + inverse-relation discipline, UoM-as-FK, sequence-backed IDs, etc. |
| [architecture-patterns/uns-mqtt-patterns.md](architecture-patterns/uns-mqtt-patterns.md) | 12 UNS patterns — topic structure, optional-level sentinel, standard envelope, persistence pairing, read+write, alarm lifecycle, Sparkplug-B gap. |

> Candidate next patterns: HighByte UNS modeling, Ignition Perspective screen patterns, MaintainX CoPilot prompt patterns, ThredCloud KG + AI integration patterns.

---

## MIRA lessons

| File | Purpose |
|---|---|
| [mira-lessons/mira-wedge-and-positioning.md](mira-lessons/mira-wedge-and-positioning.md) | How MIRA positions vs the Tier 1 landscape |
| [mira-lessons/mira-architecture-decisions.md](mira-lessons/mira-architecture-decisions.md) | Living decision log driven by research findings |
| [mira-lessons/mira-lessons-from-fuuz.md](mira-lessons/mira-lessons-from-fuuz.md) | **Top lessons from Fuuz deep-dive, 10-item action plan ordered by impact/effort** |
| [mira-lessons/mira-fuuz-skill-adaptation-plan.md](mira-lessons/mira-fuuz-skill-adaptation-plan.md) | **Proposed MIRA-native skill roster (10 skills) inspired by Fuuz's public library** |
| [mira-lessons/mira-twilio-of-industry4-analysis.md](mira-lessons/mira-twilio-of-industry4-analysis.md) | **"Twilio of Industry 4.0" — reality-check of Fuuz onboarding vs MIRA's vision; 30/60/90 plan; competitive table; companion to onboarding spec** |
| `docs/specs/mira-customer-onboarding-spec.md` | **Companion spec: customer-facing onboarding flow MIRA Hub must deliver — personas, journey, connectors, MVP scope, success metrics** |

---

## Summaries

| File | Purpose |
|---|---|
| [summaries/executive-summary.md](summaries/executive-summary.md) | Cross-cutting story across the library |
| [summaries/initial-research-library-report.md](summaries/initial-research-library-report.md) | Output of the first Tier 1 sprint (2026-05-19) |
| [summaries/fuuz-initial-research-summary.md](summaries/fuuz-initial-research-summary.md) | **Plain-English summary of the Fuuz deep-dive for Mike** |
| [summaries/fuuz-first-action-final-report.md](summaries/fuuz-first-action-final-report.md) | **Final report — top 10 patterns, top 10 MIRA lessons, proposed skills, open questions** |
