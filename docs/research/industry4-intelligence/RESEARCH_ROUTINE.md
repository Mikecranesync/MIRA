# Research Routine

> The recurring process for adding to and using this library. Designed to be runnable by Claude Code or by a human.

## When to research

Trigger a research pass when **any** of these are true:

- A new company / repo / talk appears in a Tier-1 area (UNS, Sparkplug B, MES, CMMS, industrial AI).
- A MIRA architecture decision is on the table (UNS layout, KG schema, agent shape, broker choice, CMMS integration).
- A customer asks "how is MIRA different from {X}?" and {X} isn't in the library.
- A scheduled monthly refresh of the Tier 1 list.

## The five-step routine

### 1. Pick a target

Look at:
- `INDEX.md` for `_planned_` entries or Tier 2 candidates.
- The "Open questions" sections of existing company files.
- The "Next research sprint" list at the end of `summaries/initial-research-library-report.md`.

### 2. Gather public sources, in priority order

For each target company, in this order (the higher up the list, the harder the evidence):

1. **Public GitHub repos** — `github.com/{org}` and their open-source projects (look for SDKs, sample apps, manifests, helm charts, terraform).
2. **Official docs** — `docs.{company}.com`, developer portals, public API references.
3. **Conference talks / videos** — YouTube channels, IICS, Hannover Messe, ARC, ProveIt Live, Cumulocity / IIoT meetups.
4. **Articles / case studies / LinkedIn** — public blog posts, customer case studies, executive talks (last resort because marketing-heavy).

Each source goes into the company file's "Public sources" table with: title, type, URL, date read, 1-line note.

### 3. Extract using the rules

See `EXTRACTION_RULES.md` (in this folder) for the full checklist. Summary: capture data architecture, UNS approach, AI usage, maintenance relevance, screens / UX, business model, then translate to MIRA-specific emulate / avoid / integrate / own.

Discipline:
- **Quote where useful.** Verbatim snippets prevent paraphrase drift.
- **Mark UNCONFIRMED / INFERENCE.** Never let a guess slip into the "facts" section.
- **Separate facts from recommendations.** The template enforces this — keep them separated.

### 4. Cross-link

If a finding is a recurring shape across companies → write or update an `architecture-patterns/` file.

If a finding changes (or could change) MIRA direction → append to `mira-lessons/mira-architecture-decisions.md` using the `DECISION_LOG_TEMPLATE`.

Add the new file to `INDEX.md` in the right table.

### 5. Commit

`docs(research):` scope. One commit per logical batch (one company or one pattern; don't dump 10 companies into one commit). Keep the diff focused — a reviewer should be able to read it in a couple of minutes.

## Using the library to answer questions

When Claude Code (or a human) hits one of these moments:

- "Should MIRA adopt Sparkplug B?"
- "How does {company} structure their UNS?"
- "What's the right UX for a maintenance copilot on a phone?"
- "Is CMMS integration a wedge or a feature?"

Do this:

1. Open `INDEX.md`.
2. Find the relevant company file(s) and architecture pattern(s).
3. Read the **facts** sections first — that's what's actually publicly known.
4. Read the **MIRA lessons** sections second — that's our editorial layer.
5. If the answer isn't in the library, run the five-step routine on a fresh target and **then** answer.

## What the routine does NOT do

- It does not modify production code. Findings flow into ADRs (`docs/adr/`); ADRs flow into PRs.
- It does not produce marketing copy. The library is for internal architecture intelligence.
- It does not copy proprietary content. Public sources only; cite or summarize.

## Quality bar

A library entry is "good enough" when:

- Every claim has a source URL.
- The "MIRA lessons" section is concrete (file pointers, decision implications) — not generic.
- Unknowns are labeled, not hidden.
- The file is < 300 lines (anything longer → split or link out).

A library entry is **not** good enough if:

- It only lists marketing copy.
- It has no "what to avoid" — every company has anti-patterns worth flagging.
- It claims a feature that the sources cited don't actually show.
