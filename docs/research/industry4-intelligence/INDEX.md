# INDEX — Industry 4.0 Intelligence Library

> Navigation hub. Every entry is a one-line hook + link. Add to this file when you add to the library.
>
> **Last refreshed:** 2026-05-19
> **Active research sprint:** Tier 1 first-pass (see [summaries/initial-research-library-report.md](summaries/initial-research-library-report.md))

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
| Fuuz | UNS / MES platform | High | [companies/fuuz.md](companies/fuuz.md) | first-pass |
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
| _none yet_ | | | |

> Populate as we deep-dive specific GitHub orgs. Tier 1 first-pass surfaced candidate repos in each company file's "Public sources" section — promote the strongest ones here.

---

## Videos

| Video | Speaker / event | Why it matters | File |
|---|---|---|---|
| _none yet_ | | | |

> Populate as conference talks / demo recordings come in.

---

## Architecture Patterns

| Pattern | One-line hook | File |
|---|---|---|
| _none yet — first patterns will be extracted after Tier 1 first-pass review_ | | |

> Candidate patterns identified during Tier 1 research (to write up next sprint):
> - ISA-95 + Sparkplug B topic layout (HighByte / Ignition / Litmus convergence)
> - UNS modeling layer separate from broker (Industrial DataOps thesis)
> - "Frontline app" UX as the front door (Tulip pattern vs MIRA's Slack-first)
> - CMMS-as-aggregator vs CMMS-as-record (MaintainX vs Atlas)

---

## MIRA lessons

| File | Purpose |
|---|---|
| [mira-lessons/mira-wedge-and-positioning.md](mira-lessons/mira-wedge-and-positioning.md) | How MIRA positions vs the Tier 1 landscape |
| [mira-lessons/mira-architecture-decisions.md](mira-lessons/mira-architecture-decisions.md) | Living decision log driven by research findings |

---

## Summaries

| File | Purpose |
|---|---|
| [summaries/executive-summary.md](summaries/executive-summary.md) | Cross-cutting story across the library |
| [summaries/initial-research-library-report.md](summaries/initial-research-library-report.md) | Output of the first Tier 1 sprint (2026-05-19) |
