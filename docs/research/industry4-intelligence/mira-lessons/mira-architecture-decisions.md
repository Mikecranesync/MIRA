# MIRA Architecture Decisions — driven by industry research

> Living decision log. Newer entries on top. One block per decision, using `_templates/DECISION_LOG_TEMPLATE.md`.
>
> This file is **not** the ADR registry (`docs/adr/`). ADRs are formal, code-binding records. This file tracks research-driven decisions and signals which of them have escalated to ADRs.
>
> **Last updated:** 2026-05-19

---

## 2026-05-19 — Keep MCP + KG as MIRA's agent substrate (validated externally)

### Trigger

- **What prompted the decision:** Tier 1 research surfaced explicit external validation that **Model Context Protocol (MCP) + knowledge graphs + UNS** is the emerging stack for industrial AI agents.
- **Source(s):**
  - [HighByte IDC MarketScape coverage](https://www.businesswire.com/news/home/20260407774829/en/HighByte-Positioned-as-a-Leader-in-IDC-MarketScape-for-Worldwide-Industrial-DataOps-Platforms) (April 2026): HighByte "developing Model Context Protocol (MCP)-oriented services to better support the rapidly growing demand for agentic AI integration and governance."
  - [LNS Research, ProveIt 2026 coverage](https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code): "Model Context Protocol (MCP) emerged as the interface for exposing industrial data to AI agents."
  - [companies/highbyte.md](../companies/highbyte.md), [companies/thredcloud.md](../companies/thredcloud.md)
- **Date:** 2026-05-19

### Options considered

1. **Pivot to a vendor-bound agent API** (Anthropic Tools, OpenAI Assistants, etc.) — fastest to ship; locks in.
2. **Roll our own RPC contract** between agent and KG / UNS — flexible; reinvents MCP.
3. **Stay on MCP via `mira-mcp/` (chosen / continued)** — open standard; matches HighByte's direction; matches the analyst consensus from ProveIt 2026.

### Decision

Continue investing in `mira-mcp/` as the agent-facing surface for KG / UNS / CMMS context. Plan for **federated MCP** — MIRA reads from external MCP servers (HighByte and others) and exposes its own grounded-answer MCP — rather than re-modeling the plant ourselves.

### Why

- External validation removes ambiguity about MCP as the standard.
- Federated MCP is the natural extension of "ground in whatever the customer already has," consistent with MIRA's wedge.
- Anthropic-removal stance (PR #610, #649) was correct as a *provider* decision but does not affect MCP-the-protocol — MCP is provider-neutral.

### Implications

- **Code:** `mira-mcp/` roadmap should explicitly plan for "consume external MCP servers" alongside "expose our own." None today.
- **ADR:** A short ADR documenting the MCP-as-agent-substrate decision is warranted before any architectural change. Not yet drafted.
- **Spec / plan update:** Update `docs/specs/maintenance-namespace-builder-spec.md` to mention MCP as the read/write substrate to/from the namespace.

### Status

- [x] Researched
- [ ] ADR drafted
- [ ] Implemented (PR #)
- [ ] Verified in staging

### Receipts

- Quote from LNS Research: *"Model Context Protocol (MCP) emerged as the interface for exposing industrial data to AI agents."*
- Quote from IDC MarketScape coverage: HighByte is *"developing Model Context Protocol (MCP)-oriented services to better support the rapidly growing demand for agentic AI integration and governance."*

---

## 2026-05-19 — Hold the UNS confirmation gate as the wedge (no Tier 1 competitor enforces it)

### Trigger

- **What prompted the decision:** Tier 1 research did not surface a single competing AI surface that enforces a **UNS / asset confirmation gate** before answering. The gate remains MIRA's clearest, most-demoable wedge.
- **Source(s):** [companies/maintainx.md](../companies/maintainx.md), [companies/thredcloud.md](../companies/thredcloud.md), [companies/tulip.md](../companies/tulip.md), [companies/twinthread.md](../companies/twinthread.md), [mira-lessons/mira-wedge-and-positioning.md](mira-wedge-and-positioning.md)
- **Date:** 2026-05-19

### Options considered

1. **Soften the gate** for faster time-to-answer (e.g., infer + answer + flag) — closes the demo gap with competitors faster, but kills the differentiator.
2. **Hold the gate (chosen)** — keep `mira-bots/shared/engine.py` enforcing site → area → line → asset → component → fault confirmation before troubleshooting.
3. **Strengthen the gate** with multi-evidence presentation (UNS hit + WO history + manual ref + technician hint) every time — more work; potentially better demo.

### Decision

**Hold (and document) the gate.** Don't soften. Don't refactor away the confirmation step. The `mira-run-hallucination-audit` command stays mandatory.

### Why

- No Tier 1 competitor enforces it; this is a defensible difference.
- The gate is the visible signature of "grounded maintenance copilot" vs "yet another industrial chatbot."
- Customers comparing MIRA to MaintainX CoPilot, ThredCloud, Tulip AI Chat will see the gate as the demo moment that separates products.

### Implications

- **Code:** None (defensive). Audit before any engine refactor.
- **ADR:** Worth a small ADR re-affirming the gate as architectural — preventing future "let's skip it for speed" pressure.
- **Spec / plan update:** [`docs/specs/maintenance-namespace-builder-spec.md`](../../../specs/maintenance-namespace-builder-spec.md) already covers this. Confirm cross-references in `.claude/CLAUDE.md` UNS-gate section.

### Status

- [x] Researched
- [ ] ADR drafted (re-affirmation)
- [x] Implemented (current state)
- [ ] Verified in staging (recurring — every release)

### Receipts

- See competitor files: none enforce a confirmation gate prior to AI answer surfacing.

---

## 2026-05-19 — Open a partnership conversation with Thred / ThredCloud

### Trigger

- **What prompted the decision:** [ThredCloud](../companies/thredcloud.md) is the closest architectural twin in the Tier 1 cohort: KG + AI on Ignition + medium-factory ICP. The differentiation (Slack-first chat vs dashboard-first NL search) is real but the substrate is so similar that partnership is more attractive than competition.
- **Source(s):** [companies/thredcloud.md](../companies/thredcloud.md), [LNS Research ProveIt 2026 coverage](https://blog.lnsresearch.com/proveit-2026-all-about-uns-knowledge-graphs-and-claude-code).
- **Date:** 2026-05-19

### Options considered

1. **Ignore (default)** — track quarterly; no outbound.
2. **Compete head-on** — race them in the medium-factory band.
3. **Open a partnership conversation (chosen)** — reference integration: ThredCloud KG → MIRA Slack maintenance copilot.

### Decision

Reach out (outside this code change) to Thred (parent consultancy) with a reference-integration proposal. Lightweight scope: prove MIRA grounds in a ThredCloud KG for a shared customer.

### Why

- Architectural twin → integration is technically natural.
- Their motion is consulting + product; consulting firms welcome partner-integration stories.
- Mutual customer benefit: ThredCloud sells the KG + BI surface; MIRA sells the Slack-first conversational maintenance copilot.

### Implications

- **Code:** None until partnership scoped.
- **ADR:** None — this is a GTM decision, not architectural. Track in `STRATEGY.md` if appropriate.
- **Spec / plan update:** None today.

### Status

- [x] Researched
- [ ] Outreach scheduled
- [ ] First call
- [ ] Reference integration shipped

### Receipts

- See [companies/thredcloud.md](../companies/thredcloud.md) § Integration opportunity.

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
