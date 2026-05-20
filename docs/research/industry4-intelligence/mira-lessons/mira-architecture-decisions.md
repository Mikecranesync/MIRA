# MIRA Architecture Decisions — driven by industry research

> Living decision log. Newer entries on top. One block per decision, using `_templates/DECISION_LOG_TEMPLATE.md`.
>
> This file is **not** the ADR registry (`docs/adr/`). ADRs are formal, code-binding records. This file tracks research-driven decisions and signals which of them have escalated to ADRs.
>
> **Last updated:** 2026-05-19

---

## 2026-05-19 — Industry 4.0 Intelligence Library bootstrapped

### Trigger

- **What prompted the decision:** Need a permanent learning surface so MIRA's architecture, positioning, and product decisions are informed by the best public Industry 4.0 / UNS / AI manufacturing examples — and so Claude Code can consult that knowledge instead of re-deriving it every session.
- **Source(s):** This entire `docs/research/industry4-intelligence/` tree.
- **Date:** 2026-05-19

### Options considered

1. **Ad-hoc research per question** — research only when asked. Cheap up-front, expensive in repeated re-derivation.
2. **One-off competitive-analysis doc** — single static doc. Decays fast; no compounding.
3. **Permanent intelligence library + skill + CLAUDE.md pointer (chosen)** — durable; compounds; routinely consulted by Claude Code.

### Decision

Build the library at `docs/research/industry4-intelligence/`, wire it into `CLAUDE.md` and a dedicated Claude Code skill, and run a recurring research routine (see `RESEARCH_ROUTINE.md`) keyed off Tier 1 targets first.

### Why

- Compounding knowledge beats episodic research — every entry is reusable across sessions.
- Skill + CLAUDE.md pointer means Claude Code actually reaches for it (otherwise the library rots).
- Templates enforce facts-vs-recommendations separation, which is the trap with competitive analysis docs.

### Implications

- **Code:** none yet (research only). One small CLAUDE.md edit + one new skill.
- **ADR:** none yet. Library entries that recommend code change escalate to ADRs.
- **Spec / plan update:** none yet — but expect updates to `docs/specs/maintenance-namespace-builder-spec.md` if HighByte / Ignition / Litmus first-pass reveals UNS patterns we should adopt.

### Status

- [x] Researched (scaffold + Tier 1 first-pass)
- [ ] ADR drafted
- [ ] Implemented (PR #)
- [ ] Verified in staging

### Receipts

- This file's existence is the receipt. See `INDEX.md` for the Tier 1 entries.

---

> **How to add a new entry:** copy `_templates/DECISION_LOG_TEMPLATE.md` to the top of this file (just under the heading), and fill it in. Keep entries short — anyone should be able to read a single decision in 60 seconds.
