# Open Questions

> Centralized list of unresolved questions across the research library. Each question carries source (which file raised it), priority, and proposed path to an answer. Last refreshed 2026-05-20.

---

## Priority 1 — Decisions blocked or strategically valuable

### Fuuz

- [ ] **What's in the Fuuz MCP-tool catalog?** Roadmap-named in Episode 6 `[33:30]`, not yet public. Affects: how to position MIRA's own `mira-mcp` against theirs.
  - *Source:* [companies/fuuz.md](companies/fuuz.md), [repos/fuuz-repo-analysis.md](repos/fuuz-repo-analysis.md).
  - *Path:* Watch Fuuz GitHub org for new repo announcements; monitor Craig's LinkedIn; ask via support.fuuz.com.

- [ ] **License on `fuuz-skills` and `proveit2026`?** No LICENSE files exist. Treating as proprietary today. Affects: whether MIRA could reference their alarm-management schema directly (with attribution) vs re-deriving.
  - *Source:* [repos/fuuz-repo-analysis.md](repos/fuuz-repo-analysis.md).
  - *Path:* Open a GitHub issue asking; reasonable to ask given the public repo posture.

- [ ] **Should MIRA publish or keep private its skills?** Strategic call for Mike. Trade-off: publishing = thought-leadership / recruiting / partner integrations. Keeping private = defensive against competitors copying our prompt engineering.
  - *Source:* [mira-lessons/mira-fuuz-skill-adaptation-plan.md](mira-lessons/mira-fuuz-skill-adaptation-plan.md).
  - *Path:* Mike's decision; surface in next strategy review.

### MaintainX (carry-over from Tier 1 sprint)

- [ ] **Does MaintainX CoPilot have a UNS-equivalent confirmation gate?** Or does it answer immediately from work-order history alone? Affects: whether MIRA's gate is genuinely differentiating or just slower UX.
  - *Source:* [companies/maintainx.md](companies/maintainx.md).
  - *Path:* Direct trial of MaintainX CoPilot; reverse-engineer behavior from public demos.

### HighByte (carry-over)

- [ ] **What does HighByte's MCP service look like in practice?** Announced in IDC MarketScape (April 2026), implementation details unclear.
  - *Source:* [companies/highbyte.md](companies/highbyte.md).
  - *Path:* Request a demo; check their docs page quarterly.

---

## Priority 2 — Tactical, would clarify the picture

### Fuuz

- [ ] **Sparkplug B support in Fuuz's MQTT broker?** Episode 6 mentions MQTT but not Sparkplug. UNCONFIRMED whether they support the Sparkplug-B spec.
  - *Source:* [architecture-patterns/uns-mqtt-patterns.md](architecture-patterns/uns-mqtt-patterns.md) (Pattern U-11).
  - *Path:* Check `fuuz-skills/fuuz-industrial-ops/` references; ask via support.

- [ ] **Fuuz pricing model?** Per-module / per-tenant / per-data-volume? Affects: competitive deal-shaping.
  - *Source:* [companies/fuuz.md](companies/fuuz.md).
  - *Path:* Request a quote (anonymized); analyst coverage might leak this.

- [ ] **Depth of Fuuz CMMS module?** MaintainX-level or marketing-shaped checkbox? Affects: integration vs replacement positioning.
  - *Source:* [companies/fuuz.md](companies/fuuz.md).
  - *Path:* Inspect Fuuz CMMS documentation; or try to import the proveit2026 packages into a free-tier tenant.

- [ ] **Multi-tenant data isolation strategy at scale?** Database-per-tenant is heavy. Does Fuuz plan to consolidate?
  - *Source:* [architecture-patterns/fuuz-patterns.md](architecture-patterns/fuuz-patterns.md) (Pattern P-10).
  - *Path:* UNCONFIRMED in public sources; possible signal in customer-conf videos.

### MIRA-internal

- [ ] **Is row-level security (RLS) actually wired up for `tenant_id` isolation in Hub?** CLAUDE.md says "row-level by tenant_id" but I haven't verified.
  - *Source:* [architecture-patterns/fuuz-patterns.md](architecture-patterns/fuuz-patterns.md) (Pattern P-10).
  - *Path:* Audit `mira-hub/db/migrations/` and any RLS-enabling SQL.

- [ ] **Does MIRA's component-template export pass the LLM round-trip test?** Export → ask Claude to summarize → grade for accuracy.
  - *Source:* [architecture-patterns/industrial-ai-agent-patterns.md](architecture-patterns/industrial-ai-agent-patterns.md) (Pattern A-8).
  - *Path:* Build the test in `tests/eval/`; target ≥80% accuracy.

---

## Priority 3 — Curiosity / longer-horizon

### Fuuz

- [ ] **What's in the Tier-2 / Tier-3 Fuuz videos that Episode 6 didn't cover?** Customer outcomes? Competitive positioning?
  - *Source:* [videos/video-index.md](videos/video-index.md).
  - *Path:* Watch F0oaVkVj2EQ + uxk3NkUEHsA + i0lj8quQsDM next.

- [ ] **How are skills retired in Fuuz's manifest?** `deprecated` vs `baked-in` distinction unclear.
  - *Source:* [repos/fuuz-repo-analysis.md](repos/fuuz-repo-analysis.md).
  - *Path:* Read more of `SKILLS_VERSION_MANIFEST.md` deeper.

- [ ] **How does Fuuz handle the staging-vs-prod-tenant flow for AI-generated artifacts?** Importing a screen JSON straight into prod seems risky.
  - *Source:* [companies/fuuz.md](companies/fuuz.md).
  - *Path:* Read `package-deployment-lifecycle.md` reference; ask in a sales call.

- [ ] **What's Craig's view of mira-style "answer the question" copilots vs Fuuz's "build the app" copilots?** Direct competitive framing.
  - *Source:* Not yet surfaced in available content.
  - *Path:* Watch his future videos / Manufacturing Matrix episodes.

### Cross-vendor

- [ ] **Is there a CESMII i3X reference implementation MIRA could conform to?** Fuuz claimed i3X compliance — what does that practically mean?
  - *Source:* [companies/fuuz.md](companies/fuuz.md), [companies/cesmii.md](companies/cesmii.md).
  - *Path:* Read CESMII's i3X spec; compare against MIRA's GraphQL surface.

- [ ] **ThredCloud public artifacts?** Any open repos, public skills, public videos at their level of detail?
  - *Source:* [companies/thredcloud.md](companies/thredcloud.md).
  - *Path:* Search their GitHub org; check for ProveIt! 2026 coverage that named them.

---

## Resolved this sprint (for the record)

- [x] *Any shipping Fuuz LLM features as of 2026-05-19?* → **YES** — public Claude skills + active demo applications + roadmapped MCP catalog. (Resolved in [companies/fuuz.md](companies/fuuz.md).)
- [x] *Public API for reading the Fuuz UNS / models?* → **YES** — Application + System GraphQL APIs. (Resolved.)
- [x] *Did Fuuz present at ProveIt 2026?* → **YES** — Thursday morning, immediately after CESMII. Built apps for Enterprise B + C. (Resolved.)

---

## How to use this file

- Add a new question with source (which file raised it) + priority (1–3) + path to an answer.
- When a question is resolved, move it to the "Resolved this sprint" section with the resolution and link to the file where the answer lives.
- Review every quarter; reprioritize.
