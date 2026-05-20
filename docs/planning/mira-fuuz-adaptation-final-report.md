# MIRA × Fuuz — Adaptation Final Report

**Date:** 2026-05-19
**Status:** Final report (Phase 8 of the Fuuz-adaptation initiative).
**Companion docs:** see §6 below.

This report closes the planning initiative the user requested on 2026-05-19: *"Study the Fuuz Industrial Intelligence public repositories and create a planning-first implementation strategy for applying the same general approach to MIRA."*

It summarizes:

1. What was studied.
2. What was decided.
3. What was produced.
4. What was deliberately **not** produced.
5. Risks and mitigations.
6. Next actions.

---

## 1. What was studied

Two Fuuz public repositories (cloned read-only to `/Users/charlienode/reference-repos/`):

- **`Fuuz-Industrial-Intelligence/fuuz-skills`** — 7 Claude Code skills (~50,000 lines of markdown across SKILL.md + references), covering Fuuz's platform: packages, schema, screens, flows, platform fundamentals, industrial ops, ML/telemetry.
- **`Fuuz-Industrial-Intelligence/proveit2026`** — 3 production `.fuuz` package archives (gzipped tarballs containing platform JSON for a Data Broker, an Enterprise WMS, and an Enterprise C MES).

The Fuuz GitHub org has 5 public repos in total; the 3 units-of-measure packages were excluded as out of scope.

**Critical license finding:** neither Fuuz repo has a LICENSE file. Under default US copyright, that means all rights reserved by Fuuz Industrial Intelligence. The full audit is in `docs/research/fuuz-skills-analysis.md` §2.

---

## 2. What was decided

### 2.1 Reuse posture

| Category | Decision |
|---|---|
| Structural patterns (skill layout, manifest, references/ pattern, severity tiers, checklists, error tables) | **Adopt** — these are ideas/formats, not copyrightable expression. |
| Open industrial standards cited in Fuuz skills (ISA-95, ISO 22400, ISA-88, OPC UA, ISA-101, OSHA 1910.147, NFPA 70E) | **Cite from primary sources** — independently citable. |
| Specific prose, numbered golden-rules lists, JSON templates, named checklists | **Do not copy verbatim.** Write MIRA content from scratch. |
| Fuuz-specific abstractions (JSONata, Relay-style GraphQL, Relationship TRIPLET constraint, `.fuuz` package format, `usable`/`active` tiers, ES5 sandbox, craft.js component registry, vendor-prefixed UNS) | **Do not adapt.** No MIRA analog; importing them would introduce category errors. |

### 2.2 Target architecture

MIRA's target skill suite is **8 domain skills** layered as:

```
L0 Doctrine    : mira-platform, mira-saas-scope-guard
L1 Domain      : mira-uns-architecture, mira-component-profile,
                 mira-plc-tag-intelligence, mira-telemetry-analysis
L2 Workflow    : mira-maintenance-workflow, mira-demo-builder
L3 Safety      : mira-industrial-safety (cross-cuts everything)
```

Plus supporting infrastructure: `MANIFEST.md`, `cross-skill-index.md`, `_template/`, lint tool, eval suite.

Full rationale + skill-by-skill contract in `docs/planning/mira-claude-skills-architecture.md`.

### 2.3 Patterns adopted from Fuuz (independently re-expressed)

1. Two-tier SKILL.md + `references/` layout.
2. Numbered constraints with domain-prefix codes (e.g., `UNS-001`, `SAFE-010`, `PLT-020`).
3. Severity tags: `[FATAL]` / `[BLOCKING]` / `[WARNING]` / `[STYLE]`.
4. Explicit "Do NOT trigger for..." clauses on doctrine/reference skills.
5. Error-message-to-cause reference tables.
6. Output-checklist as the final gate before declaring a task done.
7. Version manifest with status labels (`draft` / `review` / `ready` / `deployed` / `deprecated`).
8. Cross-skill index document.
9. Failure-mode teaching (anti-patterns) over example teaching.
10. Runtime-limitation callouts elevated to H2 with severity tag.

### 2.4 Patterns rejected

1. `.skill` ZIP-archive packaging — MIRA uses raw markdown per Anthropic convention.
2. The Fuuz UNS path prefix `fuuz/{site}/...` — MIRA's UNS is ltree without vendor prefix.
3. Fuuz's Relationship TRIPLET constraint (FK + forward + inverse) — MIRA uses standard PostgreSQL FKs.
4. ES5 JavaScript runtime constraints — irrelevant to MIRA's Python 3.12 stack.
5. craft.js screen JSON conventions — MIRA's UI is Slack + Hono/Bun web.

---

## 3. What was produced

### 3.1 Research artifact

| File | Lines | Status |
|---|---|---|
| `docs/research/fuuz-skills-analysis.md` | 1027 | ✅ complete |

### 3.2 Planning artifacts

| File | Lines | Status |
|---|---|---|
| `docs/planning/mira-claude-skills-architecture.md` | 341 | ✅ complete |
| `docs/planning/mira-skills-codebase-gap-analysis.md` | 408 | ✅ complete |
| `docs/planning/mira-claude-skills-implementation-roadmap.md` | 193 | ✅ complete |
| `docs/planning/mira-skills-file-tree.md` | 257 | ✅ complete |
| `docs/planning/mira-skills-eval-plan.md` | 281 | ✅ complete |
| `docs/planning/mira-fuuz-adaptation-final-report.md` | (this file) | ✅ complete |

### 3.3 Initial skill drafts (Phase 6 deliverables)

| Skill | File | Lines | Status |
|---|---|---|---|
| `mira-platform` | `.claude/skills/mira-platform/SKILL.md` | 213 | ✅ draft (status: `draft` in frontmatter) |
| `mira-uns-architecture` | `.claude/skills/mira-uns-architecture/SKILL.md` | 205 | ✅ draft |
| `mira-industrial-safety` | `.claude/skills/mira-industrial-safety/SKILL.md` | 196 | ✅ draft |

Reference files under each skill's `references/` are **stubs** (folders created, content deferred to roadmap Phase B). The architecture doc and file-tree doc commit to producing them; Phase B PRs will add content.

### 3.4 Reference clone (outside repo)

| Path | Purpose |
|---|---|
| `/Users/charlienode/reference-repos/fuuz-skills/` | Read-only clone for analysis. Will be deleted after audit period; not referenced by any MIRA code. |
| `/Users/charlienode/reference-repos/proveit2026/` | Same. |

These directories are outside the MIRA working tree and outside any commit. They are reference material only.

### 3.5 Total writing produced

```
Research      : 1,027 lines
Planning      : 1,480 lines (across 5 docs)
Final report  :   170 lines (this file, approx)
Skill drafts  :   614 lines (3 SKILL.md files)
              ─────────────
Total          ~3,300 lines of markdown, in 8 commitable files.
```

No production code changed. The audit trail is auditable: every constraint in every skill draft cites a specific MIRA file path under the skill's `owner-paths` frontmatter.

---

## 4. What was deliberately not done

Per the user's hard rules + Karpathy "surgical changes" + Cluster 7 Laws:

1. **No production code changes.** `mira-bots/`, `mira-pipeline/`, `mira-mcp/`, `mira-crawler/`, `mira-cmms/`, `mira-web/`, `mira-bridge/`, `mira-relay/`, `mira-hub/`, `mira-core/`, `plc/` — all untouched.
2. **No Fuuz content imported.** No prose, no numbered-rules lists, no JSON templates, no checklists copied. The clones are external reference material only.
3. **No license-restricted content reused.** Quotation in the research doc is limited to YAML frontmatter (for technical analysis), file paths (factual), and section header lists (factual). No prose.
4. **No `mira-architecture-guardian/` rewrite.** The existing skill keeps working. The new `mira-platform/` folder sits alongside it as a draft. The rename/alias work is queued for Phase A/B in the roadmap, not this initiative.
5. **No `uns-location-gate-designer/` rewrite.** Same — both coexist; the alias work is in the roadmap.
6. **No deletions.** No existing skill, doc, or rule file was removed.
7. **No new GitHub Actions, hooks, or CI workflows.** The eval-plan describes them; their creation is queued for Phases E/F in the roadmap.
8. **No new MCP servers, no schema changes, no migrations.** All planning, no shipping.
9. **No commits made automatically.** The user explicitly asked for separation of planning docs from skill drafts. Commits are left for explicit user-driven approval.
10. **No removal of any `mira-` slash command or skill that already triggers.** Drafts use `status: draft` to coexist.

---

## 5. Risks and mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Copying Fuuz expression (no license) | **HIGH** | Audit trail: this report + research doc explicitly state the all-rights-reserved finding and the no-verbatim policy. Skill drafts written from scratch with MIRA citations. |
| 2 | Skill bloat: 8 domain skills + references + indexes is more surface than MIRA had | **MEDIUM** | Architecture caps SKILL.md at 500 lines target / 800 hard. Lint tool enforces. References push depth out of SKILL.md. |
| 3 | Skill rot: skills drift behind code | **MEDIUM** | `MANIFEST.md` + version bumps in PRs + drift-check tool + quarterly audit (roadmap Phase G). |
| 4 | Over-activation of doctrine skills | **MEDIUM** | Explicit negative triggers on `mira-platform` ("Do NOT trigger as the primary skill for..."). Lint warns when missing. |
| 5 | Cost of behavioral evals (LLM calls) | **LOW** | Cheap cascade tier (Groq), cached responses, ≤100 cases total. Runs on PR-touching-skills only, plus weekly cron. |
| 6 | Eval non-determinism (LLM jitter) | **LOW** | Pass = 4/5 runs (or threshold TBD in Phase F). |
| 7 | Naming churn (renaming existing skills) | **LOW** | Alias period of one release per the file-tree doc; pointers at old paths. |
| 8 | Workflow-skill consolidation may dissolve smaller specialized skills | **LOW** | Default is *keep separate, cross-link*; only dissolve if Phase A decision-meeting agrees. |
| 9 | `mira-telemetry-analysis` describes a system not fully shipped | **LOW** | Keep status `draft` until the analytics pipeline is operational; explicit TODO callouts. |
| 10 | Doctrine duplication between `CLAUDE.md`, `.claude/rules/`, and `mira-platform/SKILL.md` | **LOW** | Skill *cites* the rule files via `owner-paths`; does not duplicate them. Cross-references are explicit. |

---

## 6. Next actions

In recommended order. Each is a separate PR (or small series). None is automatic; the user approves each.

| # | Action | Phase | Estimated diff |
|---|---|---|---|
| 1 | Review + commit the planning bundle (research + 5 planning docs + this report) as a single PR — **planning only, no skill content**. | Initiative wrap-up | 3,300 lines of new markdown under `docs/research/` + `docs/planning/`. |
| 2 | Commit the three draft skills (mira-platform, mira-uns-architecture, mira-industrial-safety) as a second PR, status `draft`. | Phase 6 ship | 614 lines + 3 empty `references/` folders. |
| 3 | Phase A — `MANIFEST.md` + `cross-skill-index.md` + `_template/`. | Phase A | ~400 lines. |
| 4 | Phase B — Promote the three drafts from `draft` to `review` after PR feedback. Fill out the 10 reference files committed to in the file tree. | Phase B | ~2,000 lines across 10 references. |
| 5 | Phase C — Evolve `mira-component-profile`, `mira-plc-tag-intelligence`, `mira-maintenance-workflow`. | Phase C | ~2,500 lines. |
| 6 | Phase D — Ship `mira-telemetry-analysis` (draft), `mira-demo-builder`. | Phase D | ~1,500 lines. |
| 7 | Phase E — `tools/skills_lint.py` + CI workflow + drift-check tool. | Phase E | ~400 lines of Python + YAML. |
| 8 | Phase F — `tests/skills/runner.py` + eval YAMLs per skill. | Phase F | ~1,000 lines of Python + YAML. |
| 9 | Phase G — Governance doc + quarterly audit calendar entry. | Phase G | ~200 lines. |

Total queued: roughly 8,000 additional lines of markdown + ~1,500 lines of Python/YAML, spread across 7 phases.

---

## 7. Decisions deferred to phase A

These remain open by design (the architecture doc explicitly leaves them open):

1. **Naming.** Keep `mira-architecture-guardian/` folder name (with widened role to "mira-platform") vs rename to `mira-platform/`. Current state: both exist, drafts coexist, decision in Phase A.
2. **Loose-file vs folder.** Confirm the convention: folder when references exist, loose `.md` otherwise.
3. **Workflow-skill consolidation.** Subsume `work-order-history-miner` + `slack-technician-ux-writer` into `mira-maintenance-workflow`, or keep them as cross-linked co-skills? Default proposal: keep separate.
4. **Telemetry boundary.** Where does `mira-plc-tag-intelligence` end and `mira-telemetry-analysis` begin? Proposal: mapping = identity (tag → UNS path → component), analytics = values over time. Confirm in Phase A.
5. **MCP duplication.** Skills cite MCP tools, do not re-document them; `.claude/mcp/<name>-spec.md` stays authoritative for MCP surface. Confirm in Phase A.

---

## 8. Companion docs

- `docs/research/fuuz-skills-analysis.md` — full Fuuz research, license posture, adaptation map.
- `docs/planning/mira-claude-skills-architecture.md` — target architecture, principles, contracts.
- `docs/planning/mira-skills-codebase-gap-analysis.md` — what exists vs what's needed.
- `docs/planning/mira-claude-skills-implementation-roadmap.md` — Phases A–G.
- `docs/planning/mira-skills-file-tree.md` — target file layout.
- `docs/planning/mira-skills-eval-plan.md` — structural lint + behavioral eval design.
- `.claude/skills/mira-platform/SKILL.md` — doctrine skill draft.
- `.claude/skills/mira-uns-architecture/SKILL.md` — UNS architecture + gate draft.
- `.claude/skills/mira-industrial-safety/SKILL.md` — safety cross-cut draft.

---

## 9. Summary of changed files (this initiative)

```
docs/research/
  fuuz-skills-analysis.md                                    [new]   1027 lines
docs/planning/
  mira-claude-skills-architecture.md                         [new]    341 lines
  mira-skills-codebase-gap-analysis.md                       [new]    408 lines
  mira-claude-skills-implementation-roadmap.md               [new]    193 lines
  mira-skills-file-tree.md                                   [new]    257 lines
  mira-skills-eval-plan.md                                   [new]    281 lines
  mira-fuuz-adaptation-final-report.md                       [new]   ~170 lines
.claude/skills/
  mira-platform/SKILL.md                                     [new]    213 lines
  mira-platform/references/                                  [new dir, empty]
  mira-uns-architecture/SKILL.md                             [new]    205 lines
  mira-uns-architecture/references/                          [new dir, empty]
  mira-industrial-safety/SKILL.md                            [new]    196 lines
  mira-industrial-safety/references/                         [new dir, empty]
```

Files modified: **none**. Files deleted: **none**. Production code touched: **none**. Existing skills modified: **none**. Existing rules, specs, ADRs, migrations modified: **none**.

The branch (`claude/vigilant-margulis-196164`) contains only additions. Reverting the entire initiative is a single revert of the resulting PR(s).
