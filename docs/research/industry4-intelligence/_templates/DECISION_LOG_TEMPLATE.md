# Decision Log Entry: {{YYYY-MM-DD}} — {{Short Title}}

> One block per entry. Append to `mira-lessons/mira-architecture-decisions.md`. This is a LIVING log — newer entries on top. Each entry should be small enough that someone can read it in 60 seconds.

## Trigger

- **What prompted the decision:** {{e.g., "Researched HighByte Intelligence Hub, saw a pattern we didn't have"}}
- **Source(s):** {{links to company files / architecture patterns / repos}}
- **Date:** {{YYYY-MM-DD}}

## Options considered

1. **{{Option A}}** — {{1 line}}
2. **{{Option B}}** — {{1 line}}
3. **{{Option C}} (chosen / rejected)** — {{1 line}}

## Decision

{{1-3 sentences. State the chosen direction in plain language.}}

## Why

{{Why this option beat the others. Tie to MIRA's wedge (Slack-first maintenance copilot grounded in UNS). If a public source proved a pattern wrong, say so.}}

## Implications

- **Code:** {{specific module(s) likely to change — e.g., `mira-bots/shared/engine.py`, `mira-crawler/ingest/uns.py`. May say "none yet — research only".}}
- **ADR:** {{ADR number if formal architecture change is required, else "none"}}
- **Spec / plan update:** {{which spec or plan needs to mirror this — e.g., `docs/specs/maintenance-namespace-builder-spec.md` §X}}

## Status

- [ ] Researched
- [ ] ADR drafted
- [ ] Implemented (PR #)
- [ ] Verified in staging

## Receipts

- {{quoted snippet or pointer to the source that anchored this decision}}
