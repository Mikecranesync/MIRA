# MIRA Skill System — Implementation Roadmap

**Date:** 2026-05-19
**Status:** Planning draft (Phase 4). Sequences the gap-closure work from `mira-skills-codebase-gap-analysis.md` into seven phases, A–G.
**Companion docs:** `docs/research/fuuz-skills-analysis.md`, `docs/planning/mira-claude-skills-architecture.md`, `docs/planning/mira-skills-codebase-gap-analysis.md`, `docs/planning/mira-skills-file-tree.md`, `docs/planning/mira-skills-eval-plan.md`.

This is the **execution sequence**, not a calendar. Calendar dates are deliberately omitted; the roadmap composes with the 90-day MVP plan (`docs/plans/2026-04-19-mira-90-day-mvp.md`) and the namespace-builder plan (`docs/plans/2026-05-15-maintenance-namespace-builder.md`) — the maintainer slots each phase between other work.

---

## Guiding rules across all phases

1. **No production code changes.** Each phase touches only `.claude/skills/`, `docs/planning/`, `docs/research/`, `tools/skills_*.py`, and `tests/skills/`. Engine, bot, crawler, MCP, pipeline, web, and CMMS code are untouched.
2. **Each phase is atomic.** Phases land as one PR each (or one small series). No phase depends on a half-merged earlier phase.
3. **Each phase ends with proof.** Either a passing lint, a passing eval, or — for phases without automated checks — a written diff summary and a `wc -l` of the new skill content.
4. **Reversible.** Every phase can be reverted with `git revert` of its PR. No phase imposes a structural change that can't be undone.
5. **Fuuz is not imported.** No phase clones, imports, or paraphrases Fuuz content. Phase A artifacts are MIRA-native.

---

## Phase A — Foundation (manifest, template, decision matrix)

**Goal:** Set up the scaffolding that every subsequent phase depends on.

**Artifacts:**
- `.claude/skills/MANIFEST.md` — full skill inventory with semver, status, last-updated, owner-paths, short description. Includes ALL existing skills (domain + operational), not just the 8 target domain skills, so the index is complete.
- `.claude/skills/cross-skill-index.md` — task → skill decision matrix. Includes multi-skill workflows (e.g., "onboard a new customer plant", "ingest a new manual", "debug a low-grounding episode").
- `.claude/skills/_template/SKILL.md` — boilerplate with required frontmatter, recommended H2 order, severity-tag convention, output-checklist stub.
- `.claude/skills/_template/references/_template-reference.md` — boilerplate for reference files.

**Decisions to resolve during Phase A:**
- Folder vs loose-file convention (default: folder when references exist).
- Skill rename policy (do we rename `uns-location-gate-designer` → `mira-uns-architecture` immediately, or keep alias?).
- Whether `mira-architecture-guardian` becomes `mira-platform` or stays under its current folder name with the new role.

**Definition of done:**
- All three files exist.
- `MANIFEST.md` has a row for every skill currently under `.claude/skills/`.
- `_template/SKILL.md` shows the convention from §5 of the architecture doc.
- One PR; reviewed; merged.

**Risks:** Bikeshedding on naming. Mitigation: pick names; document alternatives considered in a "Decisions" section of the architecture doc; move on.

---

## Phase B — Doctrine + safety skills (Phase 6 of this initiative)

**Goal:** Ship the three skills that gate every future skill: `mira-platform`, `mira-uns-architecture`, `mira-industrial-safety`. These are the three explicitly requested in the user's task brief.

**Artifacts:**
- `.claude/skills/mira-architecture-guardian/SKILL.md` rewritten to the target contract (or renamed to `mira-platform/` — Phase A decision).
- `.claude/skills/mira-architecture-guardian/references/` (4 files): provider-cascade, environment-doctrine, screenshot-rule, hard-constraints.
- `.claude/skills/mira-uns-architecture/SKILL.md` (new folder, or evolution of `uns-location-gate-designer/`).
- `.claude/skills/mira-uns-architecture/references/` (3 files): uns-path-grammar, resolver-state-machine, gate-message-templates.
- `.claude/skills/mira-industrial-safety/SKILL.md` (new).
- `.claude/skills/mira-industrial-safety/references/` (3 files): safety-keywords, escalation-templates, regulatory-frame.

**Verification:**
- Each SKILL.md ≤ target size (500 lines, hard cap 800).
- Each owner-path in frontmatter actually exists in the repo (lint script not yet built; verify manually in PR review).
- Severity tags present on every constraint.
- `MANIFEST.md` updated.
- Cross-references in `cross-skill-index.md` updated.

**Definition of done:**
- Three new/rewritten SKILL.md files merged.
- Reference files merged.
- `MANIFEST.md` reflects the changes.
- One commit per skill (or one PR per skill, depending on review preference). The user brief asks the skill drafts to be committed *separately* from planning docs — honor that.

**Risks:** Severity tagging on the safety skill could be over-cautious (every rule `[FATAL]`) or under-cautious. Mitigation: pair-review with someone who knows the codebase — currently Mike.

---

## Phase C — Workflow + component skills

**Goal:** Reshape the next tier: `mira-maintenance-workflow`, `mira-component-profile`, `mira-plc-tag-intelligence`.

**Artifacts (per skill):** SKILL.md + 3-4 references.

**Order within Phase C:**
1. `mira-component-profile` first — it's the most mechanically clear (existing skill is already the closest to the target contract).
2. `mira-plc-tag-intelligence` second — bounded scope, similar shape.
3. `mira-maintenance-workflow` last — depends on the others and on the consolidation decision (subsume `work-order-history-miner` and `slack-technician-ux-writer` vs keep as separate co-skills).

**Definition of done:**
- Each ships with its own PR.
- Behavioral eval pairs land alongside the skill (see Phase F).
- `MANIFEST.md` + `cross-skill-index.md` updated each time.

**Risks:** Workflow-skill consolidation decision blocks Phase C. Mitigation: make the decision in Phase A; document it in the architecture doc.

---

## Phase D — Telemetry + demo skills

**Goal:** Ship the two new L1/L2 skills that don't yet have any existing material: `mira-telemetry-analysis` and `mira-demo-builder`.

**Special consideration:** `mira-telemetry-analysis` describes a system that is still partially built. The skill must explicitly mark intended-but-not-yet-shipped behavior with TODO callouts and a "Not yet operational" status banner. This prevents Claude from over-claiming capability.

**Artifacts (per skill):** SKILL.md + 3 references.

**Definition of done:**
- Both skills merged, status: `draft` until the underlying paths are operational, then promote to `ready`.
- TODO callouts explicit.
- Linked from `mira-demo-builder` to the existing `mira-create-demo-plant` slash command.

**Risks:** `mira-telemetry-analysis` could ship guidance that doesn't match production reality. Mitigation: keep status `draft`, gate on the actual telemetry path shipping.

---

## Phase E — Tooling (lint + drift signal)

**Goal:** Replace manual review with automated checks where possible.

**Artifacts:**
- `tools/skills_lint.py` — validates frontmatter, file size, owner-paths existence, related-skills existence, MANIFEST.md consistency, severity-tag presence on numbered rules.
- `.githooks/pre-commit` (extend, don't replace) — runs `skills_lint.py` against any staged change under `.claude/skills/`.
- `.github/workflows/skills-lint.yml` — CI job for PRs touching `.claude/skills/`.
- Optional: a "skill drift" detector — when a PR changes a file listed in any skill's `owner-paths`, comment with the relevant skills and ask the author to consider a version bump.

**Definition of done:**
- `python tools/skills_lint.py` exits 0 against the entire `.claude/skills/` tree.
- CI job green on a PR that touches a skill.
- CI job red on a synthetic PR with a malformed skill (proven by a test PR closed without merge).

**Risks:** Lint becomes a chore-blocker. Mitigation: lint warns; only frontmatter+size violations fail CI. Owner-paths missing → warning. Severity-tag missing → warning. Author can override with a comment.

---

## Phase F — Behavioral evaluation (Layer B)

**Goal:** Per-skill behavioral evals so we know each skill actually triggers correctly.

**Artifacts:**
- `tests/skills/eval/<skill>.yaml` — 5–10 cases per skill: positive triggers, negative triggers, constraint-tempting, output-checklist-following.
- `tests/skills/runner.py` — runs evals via the existing inference cascade (`InferenceRouter`).
- `tests/skills/README.md` — how to add a case.

**Definition of done:**
- Eval suite exists for every domain skill listed in `mira-claude-skills-architecture.md` §3.
- Each suite passes against the latest skill content.
- Runner produces a markdown summary similar to the existing `bot-grounding-tests` regime.

**Risks:** Eval cost (LLM calls per case). Mitigation: run on PR-touching-skills only, not every CI build; use the cheapest cascade tier for routine runs.

---

## Phase G — Drift loop + governance

**Goal:** Close the loop so skills stay in sync with the code they describe.

**Artifacts:**
- `wiki/references/skill-governance.md` — when to bump a skill version, when to mark `deprecated`, who owns each skill.
- Update PR template to include a "Skills touched / bumped" checkbox.
- Quarterly skill audit calendar entry: walk `MANIFEST.md`, run lint + evals, retire stale skills, promote `draft` skills that have proven out.
- A `wiki/references/skill-index.md` rendered from `MANIFEST.md` for human consumption (optional, derived).

**Definition of done:**
- Governance doc merged.
- PR template updated.
- First quarterly audit completed and logged in `wiki/`.
- One stale skill identified (or zero, if MANIFEST already reflects truth).

**Risks:** Governance work is the easiest to skip. Mitigation: bind the quarterly audit to a recurring routine (`mira-routines/`) so it's not a manual reminder.

---

## Phase ordering rationale

A precedes everything because the manifest + template + index are infrastructure that every other phase writes against.

B is the user-requested deliverable (Phase 6 of this initiative). It ships value immediately: three skills that strengthen the most consequential parts of MIRA's behavior (doctrine, UNS architecture, safety).

C extends the pattern to the next tier. By this point the convention is proven and the team is fast.

D is the most speculative — the underlying systems are not all shipped. It runs after C so we already have the template down.

E and F automate what was previously manual. They run after the skill content is stable enough to lint against.

G is the steady-state governance pass; it institutionalizes maintenance.

---

## Cross-references

- `docs/planning/mira-claude-skills-architecture.md`
- `docs/planning/mira-skills-codebase-gap-analysis.md`
- `docs/planning/mira-skills-file-tree.md`
- `docs/planning/mira-skills-eval-plan.md`
- `docs/research/fuuz-skills-analysis.md`
- `docs/plans/2026-04-19-mira-90-day-mvp.md` — overall MVP plan (this initiative is complementary, not blocking).
- `docs/plans/2026-05-15-maintenance-namespace-builder.md` — namespace-builder plan (the UNS skill phases are sequenced to land after the namespace-builder Phase 1 has stabilized).
