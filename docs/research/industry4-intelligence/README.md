# Industry 4.0 Intelligence Library

> **Purpose:** Permanent research library that studies the best public Industry 4.0, ProveIt, UNS, AI manufacturing, MES, SCADA, CMMS, PLC, and industrial data architecture examples — so MIRA learns from companies that are ahead of us.
>
> **Status:** Research and architecture intelligence — **not** a production code surface. Do not change runtime behavior based on entries here without an ADR.

## What lives here

```
docs/research/industry4-intelligence/
├── README.md                  # this file
├── INDEX.md                   # navigation hub — start here
├── RESEARCH_ROUTINE.md        # recurring process for adding to the library
├── _templates/                # reusable templates
│   ├── COMPANY_TEMPLATE.md
│   ├── SOURCE_TEMPLATE.md
│   ├── ARCHITECTURE_PATTERN_TEMPLATE.md
│   └── DECISION_LOG_TEMPLATE.md
├── companies/                 # one file per company (Fuuz, Tulip, HighByte, …)
├── repos/                     # notable public repos worth studying
├── videos/                    # YouTube/conference talk notes + transcripts
├── architecture-patterns/     # extracted patterns (UNS topic layouts, payload shapes, …)
├── mira-lessons/              # MIRA-specific takeaways (wedge, architecture decisions)
└── summaries/                 # executive summaries + initial-research reports
```

## How to read this library

1. **Start at [INDEX.md](INDEX.md)** — that's the navigation hub. It lists every researched company, repo, video, and pattern, with a one-line hook.
2. **Skim [summaries/executive-summary.md](summaries/executive-summary.md)** for the cross-cutting story.
3. **For a specific decision** (UNS layout, MES competition, CMMS positioning, MQTT broker choice, etc.), follow the INDEX cross-references to the relevant company files and architecture patterns.
4. **MIRA-specific takeaways** live in [mira-lessons/](mira-lessons/) — the wedge / positioning doc and the architecture decision log.

## How Claude Code uses this library

The root `CLAUDE.md` has a "Research Intelligence Library" pointer that tells Claude Code to consult this library **before** making major architecture / product / UNS / Ignition / MQTT / AI-agent / CMMS / competitive decisions. The `.claude/skills/mira-industry4-research/` skill triggers automatically on those topics.

## Hard rules

- **Cite every claim.** Public sources only. Link to the URL we read.
- **Mark uncertainty.** If a fact isn't confirmed by a public source, label it `UNCONFIRMED:` or `INFERENCE:`.
- **Separate facts from recommendations.** Use the template sections.
- **Never copy proprietary content.** Summarize and cite.
- **Always connect findings back to MIRA.** Every file ends with a "MIRA lessons" section.
- **Date-stamp everything.** `last_reviewed` field on every company / source file.
- **No production behavior changes** from this folder. Recommendations flow to ADRs; ADRs flow to code.

## Contributing

Adding a new company / repo / video?

1. Copy the matching template from `_templates/` into the right subfolder.
2. Fill in the public-sources fields first; mark unknowns explicitly.
3. Add a one-line entry to [INDEX.md](INDEX.md) under the right section.
4. If the finding changes MIRA's direction, add an entry to [mira-lessons/mira-architecture-decisions.md](mira-lessons/mira-architecture-decisions.md).
5. Commit with `docs(research):` scope.
