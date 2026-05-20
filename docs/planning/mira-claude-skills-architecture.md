# MIRA Claude Code Skill System — Architecture Plan

**Date:** 2026-05-19
**Status:** Planning draft (Phase 2 of the Fuuz-adaptation initiative). Not yet implementation.
**Companion docs:** `docs/research/fuuz-skills-analysis.md`, `docs/planning/mira-skills-codebase-gap-analysis.md`, `docs/planning/mira-claude-skills-implementation-roadmap.md`, `docs/planning/mira-skills-file-tree.md`, `docs/planning/mira-skills-eval-plan.md`.

---

## 1. Purpose

MIRA already has 15+ Claude Code skills under `.claude/skills/`, written ad-hoc as the codebase grew. The Fuuz analysis (`docs/research/fuuz-skills-analysis.md`) surfaced several **structural patterns** that MIRA's skill suite can adopt to become more accurate, maintainable, and easier for Claude to navigate:

- Two-tier `SKILL.md` + `references/` layout
- Numbered, domain-prefixed golden rules (`UNS-001`, `KG-014`, `ENG-022`)
- Severity tiers (`[FATAL]` / `[WARNING]` / `[STYLE]`)
- Output checklists as final gates
- Error-message-to-cause reference sections
- A central `cross-skill-index.md` + `MANIFEST.md` so Claude (and humans) can find the right skill quickly
- Explicit negative triggers on reference-style skills

This document proposes the **target architecture** of MIRA's skill suite — not the implementation plan (that lives in the roadmap). It states the principles, the planned skill inventory, the layering, the triggering model, the dependency graph, and the contracts each skill must satisfy.

It is explicitly **not** a port of the Fuuz skill content. MIRA's product wedge (maintenance intelligence + grounded technician chat) is fundamentally different from Fuuz's wedge (no-code industrial app builder). The Fuuz repo informs *how* MIRA structures its skills; the *content* is MIRA-native, written from scratch, and grounded in the existing MIRA codebase.

---

## 2. Principles

### 2.1 MIRA-native by construction

Every skill describes MIRA's actual code, schemas, or doctrine. If a skill cannot point to specific MIRA files (modules, migrations, specs, ADRs) it does not belong in the suite. Skill content is verified against the codebase before merge; "advice-shaped" or aspirational content goes to `docs/specs/` or a plan, not a skill.

### 2.2 Grounded-by-default

MIRA's product principle is grounding (`docs/THEORY_OF_OPERATIONS.md`). Skills reflect that: every rule in a skill must trace to an MIRA contract — a spec, a migration, a `CLAUDE.md` clause, an ADR, an existing rule file under `.claude/rules/`, a Karpathy-style behavior law, or a tested code path. No floating "best practices."

### 2.3 Small surface, deep references

Following the Fuuz two-tier pattern, each MIRA SKILL.md stays scannable (target: ≤500 lines; hard cap: 800). Depth lives in `references/`. Reference files may carry their own frontmatter when standalone activation is useful, but most are pure references read by Claude only when SKILL.md tells it to.

### 2.4 Explicit triggers (positive AND negative)

Each skill's frontmatter declares both when to fire and — for reference/platform skills — when not to fire. This is the Fuuz negative-trigger pattern, adopted because MIRA's skill count is growing and over-activation causes Claude to drown specialized skills under reference noise.

### 2.5 Versioned and auditable

Skills carry semantic versions in their frontmatter and roll up to `.claude/skills/MANIFEST.md`. Any PR that changes a skill bumps its version. Any PR that changes the code a skill describes either updates the skill in the same PR or files a follow-up issue tagged `skill-drift`.

### 2.6 Promote behavior, not facts

Skills tell Claude **how to behave** when facing a class of task. They are not a wiki. Pure factual reference (ports, env vars, container map) stays in `CLAUDE.md`, `docs/env-vars.md`, `wiki/hot.md`. A skill that is read-mostly-once and not action-shaping should not be a skill.

### 2.7 Severity-coded constraints

Constraints in skills carry a severity tag — borrowed from Fuuz, MIRA-specific:

| Tag | Meaning | Examples |
|---|---|---|
| `[FATAL]` | Breaks the product. Never do. | Auto-promote `proposed → verified` without admin review. Begin troubleshooting before UNS gate confirms. Reintroduce Anthropic as provider. |
| `[BLOCKING]` | Must do before merge. | Run `mira-run-hallucination-audit` after engine edits. Add a golden case for any new gate behavior. |
| `[WARNING]` | Almost always required; document an exception in PR. | Sanitize PII before logging an LLM call. Cite a manual page when extracting a fact. |
| `[STYLE]` | Best-practice; reviewer judgment. | Naming, formatting, ordering of imports. |

Severity is enforced socially (PR review + reviewer skill) and, where automatable, programmatically (`tools/hooks/prod-guard.sh`, `pre-commit`).

### 2.8 Independent of Fuuz

No Fuuz prose, no Fuuz numbered-rules lists, no Fuuz JSON templates appear in MIRA skills. The Fuuz repo is consulted as a structural reference and discarded.

---

## 3. Skill catalogue (target state)

MIRA's target skill suite is **eight core skills** + supporting reference indexes. Several already exist in some form. Naming is normalized; existing skills are mapped to their new role where applicable.

Each row below shows:
- **Skill name** (target)
- **Status:** `EXISTS` (already in `.claude/skills/`), `EVOLVE` (exists but needs restructuring), `NEW` (does not exist)
- **Existing path** (if any)
- **Trigger** (positive)
- **Owner directories in MIRA**

| # | Skill | Status | Existing path | Trigger (positive) | Owner directories |
|---|---|---|---|---|---|
| 1 | `mira-platform` | NEW (rooted in existing `mira-architecture-guardian`) | `.claude/skills/mira-architecture-guardian/SKILL.md` | Read-only reference: any task that needs MIRA's North Star, environment boundaries, provider cascade, or architectural invariants. Auto-activates as a co-skill when other skills fire. | `CLAUDE.md`, `.claude/CLAUDE.md`, `docs/THEORY_OF_OPERATIONS.md`, `docs/ARCHITECTURE.md`, `.claude/rules/` |
| 2 | `mira-uns-architecture` | EVOLVE | `.claude/skills/uns-location-gate-designer/SKILL.md` | Any change touching UNS path construction, the resolver, the location gate, MQTT/Sparkplug topic mapping, or `kg_entities.uns_path`. | `mira-crawler/ingest/uns.py`, `mira-bots/shared/uns_resolver.py`, `mira-bots/shared/engine.py` (FSM), `docs/specs/uns-*.md`, `.claude/rules/uns-compliance.md` |
| 3 | `mira-component-profile` | EVOLVE | `.claude/skills/component-profile-builder/SKILL.md` | Building, editing, validating, or promoting reusable component profiles; per-instance vs per-model decisions; schema field changes. | `mira-crawler/ingest/`, `docs/specs/mira-component-intelligence-architecture.md`, NeonDB component-related tables |
| 4 | `mira-maintenance-workflow` | EVOLVE | `.claude/skills/diagnostic-workflow.md` (file, not folder), `.claude/skills/work-order-history-miner/`, `.claude/skills/uns-location-gate-designer/` | Designing or modifying the technician troubleshooting flow: gate → triage → diagnose → cite → step-by-step → close-out → WO update. | `mira-bots/slack/bot.py`, `mira-bots/shared/engine.py`, `mira-bots/shared/citation_compliance.py`, `mira-mcp/server.py` (CMMS tools), `docs/specs/dialogue-state-tracker-spec.md` |
| 5 | `mira-industrial-safety` | NEW | — | Any feature that could surface advice for live equipment work (LOTO, arc-flash, energized PLCs, confined spaces, hot work, chemical exposure). Auto-activates alongside `mira-maintenance-workflow`. | `mira-bots/shared/guardrails.py` (SAFETY_KEYWORDS), `.claude/rules/security-boundaries.md`, `docs/THEORY_OF_OPERATIONS.md` |
| 6 | `mira-plc-tag-intelligence` | EVOLVE | `.claude/skills/plc-tag-mapper/SKILL.md` | Mapping PLC tags to UNS / components; ingesting tag CSV exports; reasoning about Modbus / OPC UA quality codes. | `plc/`, `mira-connect/` (deferred), `mira-relay/`, Ignition tag exports, `docs/specs/uns-kg-unification-spec.md` |
| 7 | `mira-telemetry-analysis` | NEW | — | Reasoning about live tag data, baselines, anomaly detection, sensor health, MTBF/MTTR/OEE-adjacent metrics derived from customer telemetry. Distinct from PLC tag *mapping*. | `mira-relay/`, `mira-bridge/` (Node-RED), future analytics path |
| 8 | `mira-demo-builder` | NEW | (partial overlap with `mira-create-demo-plant`) | Creating reproducible demo plants/customers: seed data, Atlas WO history, fake UNS structures, golden chat transcripts. | `tools/` (seeders), `mira-cmms/` (Atlas), `tests/golden_*.csv` |

### 3.1 Supporting indexes (not skills)

| Asset | Path | Purpose |
|---|---|---|
| Skill version manifest | `.claude/skills/MANIFEST.md` | Semver + status + last-updated date per skill. Mirrors Fuuz `SKILLS_VERSION_MANIFEST.md`. |
| Cross-skill decision matrix | `.claude/skills/cross-skill-index.md` | Task → skill mapping. Includes multi-skill workflows (e.g., "ingest a new manual + map its tags + propose KG entries"). |
| Skill template | `.claude/skills/_template/SKILL.md` | Boilerplate frontmatter + section headers + checklist stub for any new skill. |

### 3.2 Existing skills retained as-is (out of scope of this initiative)

These keep their current shape; they are operational utilities, not domain skills:

- `autonomous-run/` (pre-flight for overnight runs — already excellent)
- `bot-grounding-tests/` (GS11 regression — already excellent)
- `harness.md` (5-regime test framework)
- `web-review/` (synthetic adversarial UI review)
- `promo-director/`, `qr-onboarding/`, `marketing/`, `saas-activation.md`, `stripe.md` (GTM-facing)
- `smart-commit.md`, `youtube-transcript.md`, `design-ship-routine.md`, `conversation-forensic.md`, `photo-ingest-watcher.md`, `telegram_bot_tuning.md`, `kb-benchmark.md`, `inference-routing.md` (operational helpers)
- `mira-saas-scope-guard/` (scope guard — overlaps with `mira-platform` but stays as a dedicated trigger for SaaS-scope discussions)

The domain-skill suite (rows 1–8) is what this plan restructures.

---

## 4. Layering

Skills layer top-down. Higher layers fire freely; lower layers gate-keep what the higher layers can produce.

```
┌─────────────────────────────────────────────────────────────┐
│ L0 — Doctrine (read-only, co-activates with anything below) │
│       mira-platform                                          │
│       mira-saas-scope-guard (preserved)                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ L1 — Domain knowledge (specialized triggers)                 │
│       mira-uns-architecture                                  │
│       mira-component-profile                                 │
│       mira-plc-tag-intelligence                              │
│       mira-telemetry-analysis                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ L2 — Workflow (orchestrates L1 skills around a user goal)    │
│       mira-maintenance-workflow                              │
│       mira-demo-builder                                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ L3 — Safety (cross-cuts everything; never auto-deactivates)  │
│       mira-industrial-safety                                 │
└─────────────────────────────────────────────────────────────┘
```

Cross-cutting from below: `mira-industrial-safety` is a floor. Any L1/L2 output that touches energized equipment, lockout, or confined-space work must pass through it; the skill carries `[FATAL]`-tagged rules that supersede contrary suggestions from other skills.

Cross-cutting from above: `mira-platform` is the ceiling — it states the doctrine ("Slack is the front door", "Anthropic must never be reintroduced", "every reply is grounded") and an L1/L2 skill cannot override its `[FATAL]` rules.

---

## 5. SKILL.md contract (every domain skill must satisfy this)

Frontmatter:

```yaml
---
name: <kebab-case-skill-name>
description: <when-to-trigger sentence(s); for reference skills include "Do NOT trigger for...">
version: <semver, starts at 0.1.0>
status: draft | review | ready | deployed | deprecated
last-updated: YYYY-MM-DD
owner-paths:
  - <repo path the skill is authoritative for>
related-skills:
  - <other skill name>
---
```

Body (recommended H2 order; deviations require justification):

1. **When to invoke** — positive triggers. Optional "Do NOT trigger for..." for reference skills.
2. **What this skill grounds in** — list of authoritative MIRA files (specs, ADRs, migrations, rules). This is the audit trail.
3. **Constraints** — numbered, severity-tagged rules. Domain prefix codes:
   - `UNS-NNN` (UNS architecture)
   - `KG-NNN` (knowledge graph)
   - `ING-NNN` (ingestion)
   - `ENG-NNN` (engine / FSM)
   - `SLK-NNN` (Slack UX)
   - `SAFE-NNN` (safety)
   - `PLC-NNN` (PLC / OPC UA)
   - `TLM-NNN` (telemetry / analytics)
   - `COMP-NNN` (component profiles)
   - `WO-NNN` (work-order / CMMS)
4. **Workflows** — step-by-step procedures. Each step explicit; checkpoints between steps where Claude should pause and verify.
5. **Common errors** — error-message-to-cause table (Fuuz pattern).
6. **Output checklist** — checkbox list Claude runs through before declaring done. The checklist is the final gate.
7. **References** — list of files under `references/` and what each covers.

Length target: ≤500 lines. Reference files absorb depth.

---

## 6. references/ contract

Reference files are read on-demand by Claude when SKILL.md instructs it to. They do not have to follow the SKILL.md structure but should:

- Start with a one-paragraph purpose statement.
- Cite the MIRA file(s) they describe.
- Be self-contained enough to be read without the parent SKILL.md.
- Avoid duplicating SKILL.md content; SKILL.md is rules, references/ is depth.

Optional standalone frontmatter (for references useful on their own):

```yaml
---
name: <skill-name>:<reference-name>
description: <when Claude should jump straight to this reference>
parent-skill: <skill-name>
---
```

---

## 7. Triggering and co-activation

### 7.1 Independent activation

Domain skills fire on their natural keyword surface:
- `mira-uns-architecture` — "UNS path", "resolve to", "ltree", changes under `uns.py` or `uns_resolver.py`.
- `mira-component-profile` — "component profile", "per-instance vs per-model", changes under `component_*` modules.
- `mira-plc-tag-intelligence` — "PLC tag", "Modbus", "Sparkplug B", "OPC UA quality", PLC tag CSVs.
- etc.

### 7.2 Mandatory co-activation

When any domain skill fires that could surface technician-facing or energized-equipment guidance, `mira-industrial-safety` **must** co-activate. This is enforced via:
- A clause in each domain skill's "When to invoke" section ("Co-activate `mira-industrial-safety` for any output that reaches a technician.")
- A pre-output check in the workflow skill that aborts if `mira-industrial-safety` has not been consulted on safety-keyword-bearing content.

### 7.3 Doctrine co-activation

`mira-platform` is the default ceiling skill. Any time a domain or workflow skill fires, `mira-platform` is consulted for cross-cutting constraints (provider cascade, environment boundaries, North Star). It is the equivalent of Fuuz's `fuuz-platform` skill with the explicit negative trigger.

### 7.4 Negative triggers

- `mira-platform` does NOT trigger as the *primary* skill for UNS resolution, KG proposals, ingestion, or workflow design — those have dedicated skills. It triggers as a *co-activated* reference.
- `mira-saas-scope-guard` does NOT trigger for already-in-scope feature work — only for scope/expansion discussions.

---

## 8. Dependency graph (skill → MIRA artifacts)

For each domain skill, the planning doc commits to an explicit ownership map. This is what the gap analysis will check against the current codebase.

```
mira-platform
  ↳ CLAUDE.md, .claude/CLAUDE.md, docs/THEORY_OF_OPERATIONS.md,
    docs/ARCHITECTURE.md, .claude/rules/*, docs/environments.md, NORTH_STAR.md

mira-uns-architecture
  ↳ mira-crawler/ingest/uns.py, mira-bots/shared/uns_resolver.py,
    docs/specs/uns-kg-unification-spec.md, docs/specs/uns-message-resolver-spec.md,
    docs/migrations/004_kg_entities.sql, .claude/rules/uns-compliance.md

mira-component-profile
  ↳ mira-crawler/ingest/, docs/specs/mira-component-intelligence-architecture.md,
    mira-hub/db/migrations/, NeonDB component-related tables

mira-maintenance-workflow
  ↳ mira-bots/slack/bot.py, mira-bots/shared/engine.py,
    mira-bots/shared/citation_compliance.py, mira-mcp/server.py,
    docs/specs/dialogue-state-tracker-spec.md, tests/golden_*.csv

mira-industrial-safety
  ↳ mira-bots/shared/guardrails.py (SAFETY_KEYWORDS),
    .claude/rules/security-boundaries.md, docs/THEORY_OF_OPERATIONS.md

mira-plc-tag-intelligence
  ↳ plc/, mira-connect/, mira-relay/, ignition/ (when present),
    docs/specs/uns-kg-unification-spec.md

mira-telemetry-analysis
  ↳ mira-relay/, mira-bridge/, future telemetry path (TBD)

mira-demo-builder
  ↳ tools/, mira-cmms/ (Atlas), tests/golden_*.csv,
    docs/plans/*-demo-*.md
```

The gap analysis (`mira-skills-codebase-gap-analysis.md`) checks each of these paths exists and is current.

---

## 9. Evaluation contract

Skills must be testable. Two evaluation layers:

**Layer A — Structural lint.** A static checker (`tools/skills_lint.py`, to be built) validates:
- Frontmatter completeness (name, description, version, status, last-updated, owner-paths).
- SKILL.md size cap (≤800 lines, target ≤500).
- All `owner-paths` exist in the repo.
- All `related-skills` exist.
- Severity tags present where claimed.
- `MANIFEST.md` row exists and matches frontmatter.

**Layer B — Behavioral eval.** Per-skill prompt eval pairs (`tests/skills/eval/<skill-name>.yaml`) that exercise:
- Positive trigger: a prompt that should activate the skill; assert Claude references it.
- Negative trigger: a prompt that should *not* activate the skill; assert Claude does not pull it in.
- Constraint enforcement: a prompt that tempts Claude to break a `[FATAL]` rule; assert Claude refuses or reroutes.
- Output-checklist pass: a successful run; assert Claude's response references the checklist.

The full eval plan lives in `docs/planning/mira-skills-eval-plan.md`.

---

## 10. Non-goals

To prevent scope creep — this initiative does **not**:

- Copy or paraphrase Fuuz content.
- Touch production code (`mira-bots/`, `mira-pipeline/`, `mira-mcp/`, etc.) during the planning + Phase A drafting phases.
- Replace `CLAUDE.md` or `.claude/rules/`. Skills are complementary; they are read by Claude on a trigger, not loaded into every context.
- Build new MIRA functionality. Skills describe what exists.
- Introduce a new artifact format (no `.skill` ZIP archives). MIRA uses raw markdown under `.claude/skills/` per Anthropic's current convention.
- Lock anyone into the proposed skill names — names are reviewed in Phase A.

---

## 11. Open questions (resolve in roadmap Phase A)

1. **Skill folder vs file convention.** Many existing MIRA skills are loose `.md` files (`bot-adapters.md`, `diagnostic-workflow.md`). The Fuuz pattern (and the deeper MIRA skills) use folders. Standardize on folders for any skill with a `references/` subdirectory; keep loose `.md` for trivial skills.
2. **Where to live: `.claude/skills/` vs `wiki/`?** Skills stay under `.claude/skills/`. The `wiki/` keeps its ops-wiki role. Cross-references between the two are explicit.
3. **`mira-demo-builder` overlap with `mira-create-demo-plant`.** Likely the existing command becomes a workflow inside the new skill. Confirm in Phase A.
4. **Telemetry skill scope.** The line between `mira-plc-tag-intelligence` (mapping) and `mira-telemetry-analysis` (analytics) needs a crisp boundary; default proposal: mapping = static (tag → UNS path → component), analytics = dynamic (tag values over time → anomaly / baseline / signal). Confirm in Phase A.
5. **MCP/skill duplication.** Some skills currently describe behavior also enforced by MCP tools (`mira-mcp/server.py`). Avoid duplicating tool docs in skills; skills cite the MCP server, MCP server documents its own surface.

---

## 12. Cross-references

- `docs/research/fuuz-skills-analysis.md` — Fuuz research, adaptation map.
- `docs/planning/mira-skills-codebase-gap-analysis.md` — what exists vs what this plan requires.
- `docs/planning/mira-claude-skills-implementation-roadmap.md` — Phases A–G.
- `docs/planning/mira-skills-file-tree.md` — target file tree.
- `docs/planning/mira-skills-eval-plan.md` — evaluation strategy.
- `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/` — current doctrine.
- `docs/THEORY_OF_OPERATIONS.md` — primary product doctrine.
