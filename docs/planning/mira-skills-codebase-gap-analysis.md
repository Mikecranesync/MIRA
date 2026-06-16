# MIRA Skill System — Codebase Gap Analysis

**Date:** 2026-05-19
**Status:** Planning draft (Phase 3). Compares the target architecture in `mira-claude-skills-architecture.md` against what exists today.
**Source for "target":** `docs/planning/mira-claude-skills-architecture.md`
**Source for "current":** `.claude/skills/`, `.claude/rules/`, `CLAUDE.md`, `.claude/CLAUDE.md`, `docs/specs/`, `docs/migrations/`

This document is the **delta** between current state and the proposed architecture. It is the input to the implementation roadmap.

---

## 1. Method

For each of the eight target domain skills, the analysis records:

1. What exists today (file path, size, shape).
2. Which architecture-doc principles the existing material already satisfies.
3. Where the gap is (missing content, missing structure, missing severity tags, missing references, missing checklist, missing MIRA-file linkage).
4. Whether the existing skill is `EXISTS`, `EVOLVE`, or effectively `NEW`.
5. Concrete artifacts that must be produced.

Underlying assumption: **no production code changes** during this gap closure. Skills describe code; they do not modify it.

---

## 2. Inventory of current `.claude/skills/`

Existing skills, grouped by role:

### 2.1 Domain skills (in scope of this initiative)

| Path | Lines | Folder/File | Frontmatter | Has `references/` | Severity tags | Output checklist |
|---|---|---|---|---|---|---|
| `mira-architecture-guardian/SKILL.md` | 56 | folder | name+description | no | no | no |
| `uns-location-gate-designer/SKILL.md` | 89 | folder | name+description | no | implicit only | partial |
| `plc-tag-mapper/SKILL.md` | 103 | folder | name+description | no | no | no |
| `component-profile-builder/SKILL.md` | 144 | folder | name+description | no | no | no |
| `diagnostic-workflow.md` | 175 | **file (no folder)** | name+description | no | no | no |
| `work-order-history-miner/SKILL.md` | 97 | folder | name+description | no | no | no |
| `manual-ingestion-extractor/SKILL.md` | 88 | folder | name+description | no | no | no |
| `knowledge-graph-proposer/SKILL.md` | 96 | folder | name+description | no | no | no |
| `slack-technician-ux-writer/SKILL.md` | ? | folder | name+description | no | no | no |
| `bot-grounding-tests/SKILL.md` | ? | folder | name+description | no | implicit | yes (GS11 cases) |
| `mira-saas-scope-guard/SKILL.md` | ? | folder | name+description | no | no | yes (classify) |

### 2.2 Operational utilities (out of scope; kept as-is)

`autonomous-run/`, `harness.md`, `kb-benchmark.md`, `inference-routing.md`, `smart-commit.md`, `youtube-transcript.md`, `design-ship-routine.md`, `conversation-forensic.md`, `photo-ingest-watcher.md`, `telegram_bot_tuning.md`, `web-review/`, `qr-onboarding/`, `marketing/`, `promo-director/`, `saas-activation.md`, `stripe.md`, `bot-adapters.md`, `knowledge-ingest.md`, `ar-hud.md`.

### 2.3 Indexes (do not exist yet)

- `.claude/skills/MANIFEST.md` — **NEW**
- `.claude/skills/cross-skill-index.md` — **NEW**
- `.claude/skills/_template/SKILL.md` — **NEW**

---

## 3. Per-skill gap analysis

### 3.1 `mira-platform` (rooted in existing `mira-architecture-guardian`)

**Status:** EVOLVE.

**What exists:** `.claude/skills/mira-architecture-guardian/SKILL.md` (56 lines). Covers North Star, architecture invariants, scope guard.

**What the target architecture requires:**
- Doctrine-layer skill, reference-style, co-activates with others.
- Explicit negative trigger ("Do NOT trigger as the primary skill for...").
- Constraint list with severity tags covering provider cascade, environment boundaries, secrets via Doppler, screenshot rule, conventional commits, no Anthropic, etc.
- Owner-paths frontmatter listing `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*`, `docs/THEORY_OF_OPERATIONS.md`, `docs/ARCHITECTURE.md`, `docs/environments.md`, `NORTH_STAR.md`.
- Cross-references to `mira-saas-scope-guard`, `mira-industrial-safety`, and every L1/L2 skill.
- `references/` for deeper content: provider-cascade detail, environment doctrine, screenshot rule, commit conventions, hard constraints from PRD §4.

**Gaps:**
- No negative trigger.
- No severity tags.
- No owner-paths.
- No references/ folder.
- Name conflict: should the file rename to `mira-platform/` or stay `mira-architecture-guardian/`? Recommended: keep folder name (no churn for existing references) but add an alias entry in `MANIFEST.md` and treat `mira-architecture-guardian` as the *deployed* name.

**Artifacts to produce:**
1. Rewrite `mira-architecture-guardian/SKILL.md` to the target contract (Phase 6, this initiative).
2. Add `references/provider-cascade.md`, `references/environment-doctrine.md`, `references/screenshot-rule.md`, `references/hard-constraints.md`.
3. Add a `MANIFEST.md` row.

---

### 3.2 `mira-uns-architecture` (rooted in existing `uns-location-gate-designer`)

**Status:** EVOLVE.

**What exists:** `uns-location-gate-designer/SKILL.md` (89 lines). Covers the UNS confirmation gate.

**What the target architecture requires:**
- L1 domain skill, owns UNS path construction, resolver behavior, the location gate, MQTT/Sparkplug topic mapping, and `kg_entities.uns_path`.
- Owner-paths: `mira-crawler/ingest/uns.py`, `mira-bots/shared/uns_resolver.py`, `mira-bots/shared/engine.py` (gate portion), `docs/specs/uns-*.md`, `.claude/rules/uns-compliance.md`, `docs/migrations/004_kg_entities.sql`.
- Numbered rules with `UNS-NNN` prefix.
- Severity tags. (Begin troubleshooting before gate = `[FATAL]`. Use raw f-strings instead of `uns.slug()` = `[WARNING]`.)
- Workflows: (a) extracting candidate context from a message, (b) constructing a UNS path, (c) writing the confirmation message, (d) handling correction.
- Common errors: fault-code-before-model bug, reserved label collision, model token mistakes.
- Output checklist: every assertion grounded; confirmation message format; path lowercased; reserved labels avoided.
- `references/uns-path-grammar.md` (drawing from the existing `.claude/rules/uns-compliance.md`).
- `references/resolver-state-machine.md`.
- `references/gate-message-templates.md`.

**Gaps:**
- Scope is narrow today (just the gate). The new skill subsumes UNS path construction + resolver behavior.
- No numbered constraints.
- No references/.
- Naming: the existing skill is the *gate*; the broader skill is the *architecture*. Recommend: rename to `mira-uns-architecture/`, leave a deprecation note in the old path for one release, or alias.

**Artifacts to produce:**
1. New `mira-uns-architecture/SKILL.md` (Phase 6, this initiative).
2. Three references (above).
3. Deprecation pointer at old `uns-location-gate-designer/` path.

---

### 3.3 `mira-component-profile` (rooted in existing `component-profile-builder`)

**Status:** EVOLVE (mostly rename + reshape).

**What exists:** `component-profile-builder/SKILL.md` (144 lines). The most thorough existing domain skill.

**What the target architecture requires:**
- L1 domain skill. Owns the component-profile schema, per-instance vs per-model semantics, proposal/verification flow.
- Numbered rules with `COMP-NNN` prefix.
- Severity tags. (`[FATAL]` for missing evidence on a verified row; `[WARNING]` for ambiguous per-model vs per-instance attribution.)
- Owner-paths: `mira-crawler/ingest/`, `docs/specs/mira-component-intelligence-architecture.md`, NeonDB component-related tables, `mira-hub/db/migrations/`.
- Cross-link to `mira-uns-architecture` (every component sits on a UNS path or `equipment_entity_id` FK).
- `references/component-schema.md` (field-level reference).
- `references/per-instance-vs-per-model.md` (decision matrix).
- `references/promotion-flow.md` (proposed → verified, admin sign-off).

**Gaps:**
- No references/.
- No numbered rules.
- Rename to `mira-component-profile/` (shorter, parallel to other skill names). Keep `component-profile-builder/` as alias.

**Artifacts to produce:**
1. Rewrite SKILL.md to target contract (later phase; not in initial Phase 6).
2. References (as above).

---

### 3.4 `mira-maintenance-workflow` (consolidates several existing skills)

**Status:** EVOLVE + consolidate.

**What exists (related):**
- `diagnostic-workflow.md` (175 lines, **loose file**) — engine FSM, workers, confidence scoring.
- `work-order-history-miner/SKILL.md` (97 lines).
- `uns-location-gate-designer/SKILL.md` (89 lines) — the gate sub-flow.
- `slack-technician-ux-writer/SKILL.md` — Slack output format.

**What the target architecture requires:**
- L2 workflow skill. Orchestrates L1 skills around the technician troubleshooting flow.
- Pipeline: receive message → extract context → call `mira-uns-architecture` for resolution → emit confirmation → wait for confirmation → consult `mira-component-profile` + `work-order` references → produce grounded steps → close out → update WO.
- Owner-paths: `mira-bots/slack/bot.py`, `mira-bots/shared/engine.py`, `mira-bots/shared/citation_compliance.py`, `mira-mcp/server.py` (CMMS tools), `docs/specs/dialogue-state-tracker-spec.md`, `tests/golden_*.csv`.
- Numbered rules with `ENG-NNN` and `WO-NNN` prefixes.
- Workflow stages each with their own checklist.
- `references/fsm-states.md`.
- `references/citation-compliance.md`.
- `references/close-out-and-wo-update.md`.
- `references/slack-message-templates.md` (could absorb `slack-technician-ux-writer`).

**Gaps:**
- Major one: `diagnostic-workflow.md` is a *loose markdown file* not a folder. Convert to `mira-maintenance-workflow/SKILL.md`.
- No explicit pipeline stages with checklists.
- No reference files.
- The existing `work-order-history-miner/` and `slack-technician-ux-writer/` likely become references inside this skill, OR remain separate but cross-linked (decision in Phase A of the roadmap).

**Artifacts to produce (later phase, not Phase 6):**
1. `mira-maintenance-workflow/SKILL.md`.
2. References (as above).
3. Decision: subsume vs cross-link the related skills.

---

### 3.5 `mira-industrial-safety`

**Status:** NEW.

**What exists:**
- `mira-bots/shared/guardrails.py` contains `SAFETY_KEYWORDS` (21 phrase-level triggers per `.claude/rules/security-boundaries.md`).
- `.claude/rules/security-boundaries.md` documents the safety keyword mechanism.
- No skill currently centralizes the safety behavior contract.

**What the target architecture requires:**
- L3 cross-cutting skill. Auto-co-activates with any user-facing workflow.
- Owner-paths: `mira-bots/shared/guardrails.py`, `.claude/rules/security-boundaries.md`, `docs/THEORY_OF_OPERATIONS.md`.
- Numbered rules with `SAFE-NNN` prefix.
- `[FATAL]`-tagged rules covering:
  - Never advise an action on energized equipment without a verified isolation step.
  - Never suggest skipping LOTO or arc-flash PPE.
  - Never write to a PLC tag during troubleshooting (read-only).
  - Always reroute confined-space, hot-work, or chemical-exposure topics to a STOP + escalate message.
- Workflow: detect → reroute → emit STOP message → log episode → require human confirmation.
- `references/safety-keywords.md` (the 21 phrases + future additions).
- `references/escalation-templates.md` (STOP messages).
- `references/regulatory-frame.md` (OSHA 1910.147 LOTO, NFPA 70E arc flash — *cited from primary sources*, not Fuuz).

**Gaps:**
- The skill does not exist.
- The mechanism (SAFETY_KEYWORDS list) exists in code but is not in a skill Claude can read when reasoning about features that touch live equipment.

**Artifacts to produce (Phase 6, this initiative):**
1. New `mira-industrial-safety/SKILL.md`.
2. The three reference files.
3. Cross-link from `mira-maintenance-workflow` and `mira-platform`.

---

### 3.6 `mira-plc-tag-intelligence` (rooted in existing `plc-tag-mapper`)

**Status:** EVOLVE.

**What exists:** `plc-tag-mapper/SKILL.md` (103 lines).

**What the target architecture requires:**
- L1 domain skill, scope = mapping tags to components and UNS paths.
- Owner-paths: `plc/`, `mira-connect/` (deferred), `mira-relay/`, future `ignition/` exports.
- Numbered rules with `PLC-NNN` prefix.
- Severity tags (e.g., `[FATAL]` for inferring meaning from a tag name without evidence).
- `references/tag-name-conventions.md` (Rockwell, Siemens, Allen-Bradley, generic OPC UA).
- `references/quality-codes.md` (OPC UA quality codes from IEC 62541 primary source).
- `references/sparkplug-b-topic-map.md`.

**Gaps:**
- No numbered rules.
- No references/.
- No Sparkplug B coverage.

**Artifacts to produce (later phase):**
1. Reshape SKILL.md.
2. Three references.

---

### 3.7 `mira-telemetry-analysis`

**Status:** NEW.

**What exists:** No skill. `mira-relay/`, `mira-bridge/` partially document telemetry stream architecture.

**What the target architecture requires:**
- L1 domain skill. Distinct from `mira-plc-tag-intelligence` — that maps static identity; this reasons about dynamic values.
- Numbered rules with `TLM-NNN` prefix.
- `[FATAL]` rules: never assert an anomaly without a baseline; never claim a setpoint deviation without a documented setpoint source.
- `references/baseline-construction.md` (EWMA, moving average, Z-score, drawn from primary statistical sources).
- `references/anomaly-evidence-thresholds.md`.
- `references/sensor-health-vs-process-anomaly.md`.

**Gaps:**
- Skill does not exist.
- Underlying telemetry analytics pipeline is also partially built — the skill describes the path as it is *intended*, with explicit "TODO" markers where MIRA hasn't shipped yet.

**Artifacts to produce (later phase):**
1. New skill SKILL.md.
2. References. (Some content may temporarily live under `docs/specs/` until the analytics path is built.)

---

### 3.8 `mira-demo-builder`

**Status:** NEW (partial overlap with existing command `mira-create-demo-plant`).

**What exists:**
- `.claude/commands/mira-create-demo-plant.md` (slash command).
- Seed scripts under `tools/`.
- `mira-cmms/` (Atlas) work-order fixtures.
- `tests/golden_*.csv` truth sets.

**What the target architecture requires:**
- L2 workflow skill. Used when creating reproducible demo plants for sales / launch / regression-testing.
- Owner-paths: `tools/`, `mira-cmms/`, `tests/golden_*.csv`, `docs/plans/*-demo-*.md`.
- Workflow: define plant identity → seed UNS → seed assets/components → seed WO history → seed golden chat transcripts → verify end-to-end.
- `references/seed-data-shapes.md`.
- `references/golden-transcript-format.md`.
- `references/atlas-wo-fixtures.md`.

**Gaps:**
- No skill exists; demo construction is currently a slash command + ad-hoc tools.

**Artifacts to produce (later phase):**
1. New skill SKILL.md.
2. References.
3. Decision: does the slash command stay (as a quick-fire shortcut) or get absorbed?

---

## 4. Cross-cutting infrastructure gaps

### 4.1 No skill version manifest

**Gap:** No `.claude/skills/MANIFEST.md`.

**Impact:** Skills drift behind code; there is no audit trail. (Documented case: `diagnostic-workflow.md` predates PR #1266's RESOLVED-state rebuild fix per memory.)

**Artifact:** create `MANIFEST.md` listing every skill with semver, status, last-updated date, owner-paths, and short description. (Phase A artifact in the roadmap.)

### 4.2 No cross-skill decision matrix

**Gap:** No `.claude/skills/cross-skill-index.md`.

**Impact:** With 15+ skills (and 8 domain skills proposed), Claude cannot consistently pick the right skill for a task. A decision matrix mirrors Fuuz's `cross-skill-index.md`.

**Artifact:** `cross-skill-index.md` with task → skill mapping and multi-skill workflow recipes.

### 4.3 No skill template

**Gap:** No `.claude/skills/_template/SKILL.md`.

**Impact:** Each new skill is structured ad-hoc; the contract from §5 of the architecture doc isn't enforced.

**Artifact:** `_template/SKILL.md` with the required frontmatter, section headers, and checklist stub.

### 4.4 No structural lint

**Gap:** Nothing checks that skill frontmatter is well-formed or that `owner-paths` exist.

**Impact:** A skill can claim ownership of a deleted file and Claude will follow it.

**Artifact:** `tools/skills_lint.py` (Phase E in the roadmap).

### 4.5 No per-skill behavioral eval

**Gap:** Skills are not tested. The 5-regime test framework covers code; it does not cover skill activation behavior.

**Impact:** A skill that fails to trigger on its target keywords goes unnoticed.

**Artifact:** `tests/skills/eval/<skill>.yaml` and a runner. Detailed in `mira-skills-eval-plan.md` (Phase 7).

### 4.6 Loose-file vs folder inconsistency

**Gap:** Mixed convention — some skills are folders (`uns-location-gate-designer/SKILL.md`) and some are loose files (`diagnostic-workflow.md`, `inference-routing.md`).

**Recommendation:** Folder for any skill that owns `references/`. Loose file is OK for trivial utility skills with no references and no expected growth. The eight target domain skills become folders.

### 4.7 No severity-tag convention

**Gap:** Constraints in existing skills are stated as prose without explicit severity.

**Impact:** Claude doesn't reliably distinguish a `[FATAL]` rule (must refuse) from a `[STYLE]` rule (reviewer discretion).

**Artifact:** Apply the severity convention from §2.7 of the architecture doc to every constraint in every domain skill.

### 4.8 No negative triggers

**Gap:** No existing skill uses a negative trigger clause.

**Impact:** `mira-architecture-guardian` (and any future doctrine skill) will tend to over-activate.

**Artifact:** Add "Do NOT trigger for..." clauses to every doctrine/reference skill (Phase 6 starts this with `mira-platform`).

### 4.9 Skill drift signal not surfaced

**Gap:** No CI signal exists when a skill describes code that has since changed.

**Impact:** Skill content silently goes stale.

**Possible artifacts (Phase E):**
- A pre-commit hook that warns when a file under `owner-paths` is changed without a matching skill version bump.
- A GitHub action that fails PRs editing `owner-paths` without `last-updated` in the relevant skill being bumped.

---

## 5. Risks identified during the gap walk

1. **Consolidation risk** (`mira-maintenance-workflow` swallowing several existing skills). If we collapse `work-order-history-miner` and `slack-technician-ux-writer` into a single workflow skill, we lose the precise triggers those skills have today. Mitigation: keep them as separate referenced skills, owned by the workflow but not dissolved into it.
2. **Rename churn.** Renaming `uns-location-gate-designer` → `mira-uns-architecture` changes a name that may be referenced elsewhere. Mitigation: add an alias in `MANIFEST.md`, leave a one-line pointer at the old path for one release.
3. **Skill bloat.** The target architecture adds three new skills (`mira-platform` proper, `mira-industrial-safety`, `mira-telemetry-analysis`, `mira-demo-builder`) and grows several others. Mitigation: enforce SKILL.md size cap (≤800), push depth to references/.
4. **Eval cost.** Behavioral evals (Layer B) require Claude calls. Mitigation: small N (5–10 cases per skill), run on PR-touching-skills only, not every CI build.
5. **Doctrine-vs-skill duplication.** `CLAUDE.md`, `.claude/rules/`, and the new `mira-platform/SKILL.md` will overlap. Mitigation: `mira-platform` *cites* `CLAUDE.md`/`.claude/rules/`, does not duplicate them. Frontmatter `owner-paths` makes the ownership visible.
6. **MCP overlap.** Some skills describe behavior also implemented by MCP tools in `mira-mcp/server.py`. Mitigation: skill cites MCP tool, doesn't re-document it. `.claude/mcp/<name>-spec.md` remains authoritative for MCP surface.

---

## 6. Summary

| Skill | Status | Lines to write/touch (rough) | Phase |
|---|---|---|---|
| `mira-platform` (from `mira-architecture-guardian`) | EVOLVE | 250 + 4 refs (≈600) | **Phase 6 (this initiative)** |
| `mira-uns-architecture` (from `uns-location-gate-designer`) | EVOLVE | 400 + 3 refs (≈900) | **Phase 6 (this initiative)** |
| `mira-industrial-safety` | NEW | 300 + 3 refs (≈700) | **Phase 6 (this initiative)** |
| `mira-component-profile` (from `component-profile-builder`) | EVOLVE | 400 + 3 refs | Later (Phase B/C in roadmap) |
| `mira-maintenance-workflow` (consolidates) | EVOLVE | 500 + 4 refs | Later |
| `mira-plc-tag-intelligence` (from `plc-tag-mapper`) | EVOLVE | 350 + 3 refs | Later |
| `mira-telemetry-analysis` | NEW | 350 + 3 refs | Later (gated on telemetry pipeline maturity) |
| `mira-demo-builder` | NEW | 350 + 3 refs | Later |
| `MANIFEST.md`, `cross-skill-index.md`, `_template/` | NEW | ≈400 total | Phase A in roadmap |
| `tools/skills_lint.py` | NEW | ≈200 | Phase E |
| `tests/skills/eval/` | NEW | ≈600 | Phase F |

Total Phase-6 (this initiative) writing target: ≈2200 lines of skill markdown, no production code changes. Everything else is queued in the roadmap.

---

## 7. Cross-references

- `docs/research/fuuz-skills-analysis.md`
- `docs/planning/mira-claude-skills-architecture.md`
- `docs/planning/mira-claude-skills-implementation-roadmap.md`
- `docs/planning/mira-skills-file-tree.md`
- `docs/planning/mira-skills-eval-plan.md`
- `CLAUDE.md`, `.claude/CLAUDE.md`
- `.claude/rules/uns-compliance.md`, `.claude/rules/security-boundaries.md`, `.claude/rules/python-standards.md`, `.claude/rules/karpathy-principles.md`
- `docs/THEORY_OF_OPERATIONS.md`, `docs/ARCHITECTURE.md`, `docs/environments.md`
