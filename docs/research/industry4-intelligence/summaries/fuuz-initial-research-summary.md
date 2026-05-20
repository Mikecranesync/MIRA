# Fuuz Deep-Dive — Plain English Summary

**For:** Mike
**By:** claude-code
**Date:** 2026-05-20
**Time invested:** ~one autonomous research session
**Status:** Complete first pass; Tier-2/3 Fuuz videos queued for later.

---

## Why this matters in one sentence

Fuuz is the **closest publicly-visible analogue to where MIRA is heading** — they ship a UNS-anchored industrial platform, they use Claude Code to build apps, they've publicly released their skill library, and they're getting real customer traction. Watching them is the cheapest possible way to validate our bet and spot what they do better than we do.

## What I looked at

1. **A 58-minute Craig Scott video** from May 2026 ("Episode 6 — AI on the Factory Floor: Inside Fuuz's 2026 ProveIt! Demo"). He walks through the entire ProveIt! 2026 build live — UNS architecture, Claude Code workflow, ML pipeline, screen patterns. Full transcript saved.
2. **Their public GitHub** — 7 Claude Code skills (~43,000 lines of reference docs) and 3 demo applications (100 data models, 73 screens, 94 flows) covering MES, WMS, and an integration broker.
3. **10 additional Fuuz YouTube videos** catalogued for next pass.

## The three things that matter most

### 1. We're on the right architectural track

Craig's whole pitch boils down to: **UNS is the live nervous system, and a queryable data model + GraphQL is the memory.** Two separate layers. That's exactly the bet MIRA made — UNS via MQTT/Sparkplug-B, KG in NeonDB, query via MCP. We're not weird; we're aligned with where this industry is moving.

His thesis on AI:
> "It's a great enabler, but … it's an assistance. It's not a replacement for anybody. Learn your domain, be really good at your domain."

That's MIRA's UNS confirmation gate in different words. We arrived at the same constraint from different angles, which is a useful validation.

### 2. They have a lead on us in two specific places

**Public skills library with rigor.** Their `fuuz-packages` skill has 71 numbered "golden rules" — every one prevents a specific past failure. Their `SKILLS_VERSION_MANIFEST.md` tracks every skill with semver, status, and deploy log. MIRA's `.claude/skills/` and `.claude/rules/` already do this informally; we should formalize the numbering, versioning, and manifest.

**Live debugging surface.** Their "Developer Mode" pops a screen into a side-panel that shows every query, transform, and binding firing live. When MIRA Hub eventually ships a "show me how MIRA decided this answer" view, this is the shape to aim for.

### 3. They will never build what MIRA builds

Fuuz is a **platform**. Their AI is **developer-facing** — Claude builds Fuuz apps faster. Their customer is the manufacturing IT engineer who likes building dashboards.

MIRA is a **copilot**. Our AI is **technician-facing** — Claude answers grounded maintenance questions in Slack. Our customer is the maintenance manager who never wants to build a dashboard, just wants the broken machine fixed.

That gap is the moat. As long as we don't get distracted into "let's build an app builder," we win the technician seat while they win the engineer seat.

## What I'd do this week, in order

1. **Number the rules** in `.claude/rules/uns-compliance.md`, `karpathy-principles.md`, etc. (UC-1, UC-2…). One hour per file. Big readability win.
2. **Add `version: 1.0.0`** to every `.claude/skills/*/SKILL.md` and create `.claude/skills/MANIFEST.md`. Two hours total.
3. **Write `mira-platform-utilities` skill** — a router that tells Claude "before you write a date helper, look at `mira-bots/shared/...`." Stops Claude reinventing platform code. Four hours.

## What I'd plan for the quarter

- Standard event envelope for MIRA-published UNS messages (~2 weeks).
- Add publish path to `mira-relay` (~2 weeks).
- Hub "show me the trace" view (~3–4 weeks).
- Hub "component application graph" view (~4–6 weeks).

## What surprised me

- Their **entire ProveIt! 2026 demo was built by two people** (Craig + Claude) in 2–3 weeks part-time. That's the speed an AI-native platform unlocks. Not because Claude is magic — because the *platform's conventions* are tight enough that Claude can fill them in.
- They **publish their skills publicly**. That's bold. Mike, this is the choice we have to make: do we publish ours (thought-leadership + recruiting + partner integrations) or keep them private (defensive against competitors)?
- Their **ML pipeline is pure vanilla JavaScript in a flow node** — no TensorFlow, no scikit, no nothing. Just Math.* + JSON.stringify. EWMA + Z-score + linear regression + Pearson correlation. Validates PRD §4 (no LangChain / TF / framework abstractions over the call).

## What I'd ask Craig if we got the chance

1. What does the Fuuz MCP-tool catalog look like, and how do you handle RBAC?
2. Why no LICENSE file on the public skills repo? Strategic, or oversight?
3. What's your CMMS module's actual depth — MaintainX-level, or marketing-shaped?
4. How do customers with existing MaintainX/Limble/Fiix reconcile your CMMS module?
5. What's your pricing model?

## Bottom line

Fuuz isn't a threat in the next 12 months because their AI surface is developer-facing, not technician-facing. They are a **strong validator** of MIRA's architecture and a **template for skill-library rigor** we should adopt. If they pivot to a technician copilot product, the threat tightens substantially — watch their MCP roadmap and any new product surface.

The four follow-up files to read:
- [Top lessons + 10-item action plan](../mira-lessons/mira-lessons-from-fuuz.md) — what to do
- [Proposed MIRA skill roster](../mira-lessons/mira-fuuz-skill-adaptation-plan.md) — 10 skills inspired by Fuuz
- [Final detailed report](fuuz-first-action-final-report.md) — full pattern list, MIRA lessons, open questions
- [Fuuz company profile (refreshed)](../companies/fuuz.md) — competitive intel
