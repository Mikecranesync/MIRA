# MIRA Skill System — Proposed File Tree

**Date:** 2026-05-19
**Status:** Planning draft (Phase 5). Target file layout once Phases A–D of the roadmap are complete.
**Companion docs:** `docs/research/fuuz-skills-analysis.md`, `docs/planning/mira-claude-skills-architecture.md`, `docs/planning/mira-skills-codebase-gap-analysis.md`, `docs/planning/mira-claude-skills-implementation-roadmap.md`, `docs/planning/mira-skills-eval-plan.md`.

This document shows the file tree as it will look after Phases A–D land. Items marked `[new]` are added by this initiative; items marked `[changed]` are reshaped from existing files; items marked `[unchanged]` are kept as-is; items marked `[alias]` are kept-or-replaced-by-pointer for backward compatibility.

---

## 1. Proposed `.claude/skills/` tree (post-Phase-D)

```
.claude/skills/
│
├── MANIFEST.md                                     [new]   Phase A — full skill inventory, semver, status
├── cross-skill-index.md                            [new]   Phase A — task→skill decision matrix + multi-skill workflows
├── _template/                                      [new]   Phase A
│   ├── SKILL.md                                    [new]   Boilerplate SKILL.md per §5 of architecture doc
│   └── references/
│       └── _template-reference.md                  [new]   Boilerplate reference
│
├── mira-architecture-guardian/                     [changed] Phase B — becomes the "mira-platform" doctrine skill (alias retained)
│   ├── SKILL.md                                    [changed] Rewritten to target contract; ≤500 lines
│   └── references/
│       ├── provider-cascade.md                     [new]   Groq → Cerebras → Gemini; no Anthropic
│       ├── environment-doctrine.md                 [new]   Dev / Staging / Prod boundaries
│       ├── screenshot-rule.md                      [new]   Promotional pipeline contract
│       └── hard-constraints.md                     [new]   PRD §4 hard constraints
│
├── mira-uns-architecture/                          [new]   Phase B — folder; subsumes the gate-designer role
│   ├── SKILL.md                                    [new]
│   └── references/
│       ├── uns-path-grammar.md                     [new]
│       ├── resolver-state-machine.md               [new]
│       └── gate-message-templates.md               [new]
│
├── uns-location-gate-designer/                     [alias] Phase B — keep folder with a one-line pointer at SKILL.md for one release, then remove
│   └── SKILL.md                                    [changed] One-liner: "Renamed to mira-uns-architecture"
│
├── mira-industrial-safety/                         [new]   Phase B
│   ├── SKILL.md                                    [new]
│   └── references/
│       ├── safety-keywords.md                      [new]
│       ├── escalation-templates.md                 [new]
│       └── regulatory-frame.md                     [new]   OSHA 1910.147, NFPA 70E — primary sources only
│
├── mira-component-profile/                         [changed] Phase C — renamed from component-profile-builder/
│   ├── SKILL.md                                    [changed]
│   └── references/
│       ├── component-schema.md                     [new]
│       ├── per-instance-vs-per-model.md            [new]
│       └── promotion-flow.md                       [new]
│
├── component-profile-builder/                      [alias] Phase C — one-line pointer for one release
│   └── SKILL.md                                    [changed]
│
├── mira-maintenance-workflow/                      [new]   Phase C — folder; consolidates diagnostic-workflow.md (loose file)
│   ├── SKILL.md                                    [new]
│   └── references/
│       ├── fsm-states.md                           [new]
│       ├── citation-compliance.md                  [new]
│       ├── close-out-and-wo-update.md              [new]
│       └── slack-message-templates.md              [new]
│
├── diagnostic-workflow.md                          [alias] Phase C — replaced by mira-maintenance-workflow/; leave one-line pointer for one release
│
├── mira-plc-tag-intelligence/                      [changed] Phase C — renamed from plc-tag-mapper/
│   ├── SKILL.md                                    [changed]
│   └── references/
│       ├── tag-name-conventions.md                 [new]
│       ├── quality-codes.md                        [new]   OPC UA quality codes from IEC 62541 primary source
│       └── sparkplug-b-topic-map.md                [new]
│
├── plc-tag-mapper/                                 [alias] Phase C — one-line pointer for one release
│   └── SKILL.md                                    [changed]
│
├── mira-telemetry-analysis/                        [new]   Phase D — status: draft (gated on telemetry path)
│   ├── SKILL.md                                    [new]
│   └── references/
│       ├── baseline-construction.md                [new]   EWMA, moving avg, Z-score from primary stats sources
│       ├── anomaly-evidence-thresholds.md          [new]
│       └── sensor-health-vs-process-anomaly.md     [new]
│
├── mira-demo-builder/                              [new]   Phase D
│   ├── SKILL.md                                    [new]
│   └── references/
│       ├── seed-data-shapes.md                     [new]
│       ├── golden-transcript-format.md             [new]
│       └── atlas-wo-fixtures.md                    [new]
│
├── work-order-history-miner/                       [unchanged] Phase C — kept as separate co-skill, cross-linked from mira-maintenance-workflow
│   └── SKILL.md
│
├── slack-technician-ux-writer/                     [unchanged] Phase C — kept; cross-linked from mira-maintenance-workflow
│   └── SKILL.md
│
├── manual-ingestion-extractor/                     [unchanged]
│   └── SKILL.md
│
├── knowledge-graph-proposer/                       [unchanged]
│   └── SKILL.md
│
├── mira-saas-scope-guard/                          [unchanged]
│   └── SKILL.md
│
├── bot-grounding-tests/                            [unchanged]
│   └── SKILL.md
│
├── autonomous-run/                                 [unchanged]
│   └── ... (existing structure)
│
├── web-review/                                     [unchanged]
├── qr-onboarding/                                  [unchanged]
├── marketing/                                      [unchanged]
├── promo-director/                                 [unchanged]
│
└── (loose files — operational helpers, untouched)
    ├── ar-hud.md                                   [unchanged]
    ├── bot-adapters.md                             [unchanged]
    ├── conversation-forensic.md                    [unchanged]
    ├── design-ship-routine.md                      [unchanged]
    ├── harness.md                                  [unchanged]
    ├── inference-routing.md                        [unchanged]
    ├── kb-benchmark.md                             [unchanged]
    ├── knowledge-ingest.md                         [unchanged]
    ├── photo-ingest-watcher.md                     [unchanged]
    ├── saas-activation.md                          [unchanged]
    ├── smart-commit.md                             [unchanged]
    ├── stripe.md                                   [unchanged]
    ├── telegram_bot_tuning.md                      [unchanged]
    └── youtube-transcript.md                       [unchanged]
```

---

## 2. Proposed `tools/skills_*.py` (Phase E)

```
tools/
├── skills_lint.py                                  [new]   Phase E
└── skills_drift_check.py                           [new]   Phase E (optional)
```

`skills_lint.py` responsibilities:
- Walk `.claude/skills/`.
- Validate frontmatter (`name`, `description`, `version`, `status`, `last-updated`, `owner-paths`, optional `related-skills`).
- Validate SKILL.md size (warn > 500 lines, fail > 800).
- Validate `owner-paths` exist relative to repo root (warn if missing).
- Validate `MANIFEST.md` row exists per skill and matches frontmatter version + last-updated.
- Validate severity tag convention: any numbered rule (`UNS-001`, `KG-014`, etc.) must include a `[FATAL]`/`[BLOCKING]`/`[WARNING]`/`[STYLE]` tag (warn if missing).

`skills_drift_check.py` (optional Phase E):
- Reads `git diff --name-only main...HEAD`.
- For each changed file, finds skills whose `owner-paths` cover it.
- Posts a PR comment listing those skills and asking the author to consider a version bump.

---

## 3. Proposed `tests/skills/` (Phase F)

```
tests/
└── skills/
    ├── README.md                                   [new]   Phase F — how to add a case
    ├── runner.py                                   [new]   Phase F — runs evals via InferenceRouter
    ├── eval/
    │   ├── mira-architecture-guardian.yaml         [new]   Phase F
    │   ├── mira-uns-architecture.yaml              [new]   Phase F
    │   ├── mira-industrial-safety.yaml             [new]   Phase F
    │   ├── mira-component-profile.yaml             [new]   Phase F
    │   ├── mira-maintenance-workflow.yaml          [new]   Phase F
    │   ├── mira-plc-tag-intelligence.yaml          [new]   Phase F
    │   ├── mira-telemetry-analysis.yaml            [new]   Phase F
    │   └── mira-demo-builder.yaml                  [new]   Phase F
    └── fixtures/
        └── (eval fixture files: sample technician messages, sample manuals, sample tag CSVs)
```

Format of a `.yaml` eval case:

```yaml
skill: mira-uns-architecture
cases:
  - name: positive-trigger-uns-keyword
    prompt: "I need to add a new UNS path for line 3 at the Lake Wales site."
    expect_skill_activation: yes
    expect_constraint_citations: [UNS-001, UNS-007]
  - name: negative-trigger-generic-chat
    prompt: "Hey, what's the weather like in Florida?"
    expect_skill_activation: no
  - name: constraint-tempting-skip-slug
    prompt: "Build the UNS path enterprise.knowledge_base.RockwellAutomation.PowerFlex525 — don't bother slugging."
    expect_skill_activation: yes
    expect_constraint_refusal: UNS-003
```

---

## 4. Proposed `docs/` additions

```
docs/
├── research/
│   └── fuuz-skills-analysis.md                     [exists]  Phase 1 — done
├── planning/
│   ├── mira-claude-skills-architecture.md          [exists]  Phase 2 — done
│   ├── mira-skills-codebase-gap-analysis.md        [exists]  Phase 3 — done
│   ├── mira-claude-skills-implementation-roadmap.md[exists]  Phase 4 — done
│   ├── mira-skills-file-tree.md                    [exists]  Phase 5 — this file
│   ├── mira-skills-eval-plan.md                    [pending] Phase 7
│   └── mira-fuuz-adaptation-final-report.md        [pending] Phase 8
└── (no other docs/ changes)
```

---

## 5. Proposed `wiki/` additions (Phase G only)

```
wiki/
└── references/
    ├── skill-governance.md                         [new]    Phase G — versioning/deprecation policy + audit cadence
    └── skill-index.md                              [new]    Phase G — human-readable view of MANIFEST.md
```

---

## 6. Files explicitly NOT created

- No `.skill` archive files (Fuuz uses ZIP-archive packaging; MIRA uses raw markdown — Anthropic convention).
- No new `docs/specs/` files (skill content is not a spec; specs that already exist are *cited by* skills).
- No new files under `mira-bots/`, `mira-pipeline/`, `mira-mcp/`, `mira-crawler/`, `mira-cmms/`, `mira-web/`, `mira-bridge/`, `mira-relay/`, `mira-hub/`, `mira-core/`. The skill initiative is documentation-only.

---

## 7. Naming + alias policy summary

| Old name (folder) | New name (folder) | Alias period |
|---|---|---|
| `mira-architecture-guardian/` | `mira-architecture-guardian/` (role evolves to `mira-platform`) | n/a — folder kept, role widened |
| `uns-location-gate-designer/` | `mira-uns-architecture/` | one release with a one-line pointer SKILL.md at old path |
| `component-profile-builder/` | `mira-component-profile/` | one release |
| `plc-tag-mapper/` | `mira-plc-tag-intelligence/` | one release |
| `diagnostic-workflow.md` (loose file) | `mira-maintenance-workflow/` (folder) | one release with pointer file |

Aliases exist purely so existing references (in PRs, in commits, in wiki pages) don't break. They are removed in a follow-up cleanup PR after one release.

---

## 8. Cross-references

- `docs/planning/mira-claude-skills-architecture.md`
- `docs/planning/mira-skills-codebase-gap-analysis.md`
- `docs/planning/mira-claude-skills-implementation-roadmap.md`
- `docs/planning/mira-skills-eval-plan.md`
- `docs/research/fuuz-skills-analysis.md`
