# MIRA Skill System — Evaluation Plan

**Date:** 2026-05-19
**Status:** Planning draft (Phase 7). Defines how MIRA verifies that each skill in the proposed suite actually works — both structurally (lint) and behaviorally (LLM-driven evals).
**Companion docs:** `docs/research/fuuz-skills-analysis.md`, `docs/planning/mira-claude-skills-architecture.md`, `docs/planning/mira-skills-codebase-gap-analysis.md`, `docs/planning/mira-claude-skills-implementation-roadmap.md`, `docs/planning/mira-skills-file-tree.md`.

---

## 1. Why evaluate skills

Skills are easy to write and easy to break. Without evaluation:

- A skill's trigger description rots as the codebase moves — `owner-paths` end up pointing at deleted files; the skill keeps firing but the constraints it cites no longer match reality.
- A new skill over-activates and drowns specialized skills.
- A `[FATAL]` rule silently degrades to advisory because no test ever exercises it.
- A skill becomes a place for "best practices" rather than enforced behavior.

Fuuz's skills repo has no public evaluation pipeline (per the research doc); MIRA cannot use them as a template here. The plan below is MIRA-native, building on existing infrastructure:

- 5-regime test framework under `tests/` (covers code, not skill behavior).
- GS11 bot-grounding regression net (`mira-bots/benchmarks/deepeval_suite.py`).
- `tests/golden_factorylm.csv` truth set.
- Inference cascade (`mira-bots/shared/inference/router.py`) which the eval runner can call via the same path the bot uses.

---

## 2. Two evaluation layers

| Layer | What it tests | Speed | Where it runs |
|---|---|---|---|
| **A. Structural lint** | Frontmatter validity, file size, `owner-paths` existence, severity-tag presence, MANIFEST consistency | Fast (seconds) | Pre-commit + CI |
| **B. Behavioral eval** | Does the skill actually fire? Does it refuse a `[FATAL]` rule violation? Does it leave the output checklist visible? | Slow (LLM calls) | CI for PRs touching `.claude/skills/`; weekly full run |

Layer A is mandatory on every PR. Layer B is mandatory on PRs that change a skill's SKILL.md or `references/`; weekly otherwise.

---

## 3. Layer A — Structural lint

### 3.1 Tool

`tools/skills_lint.py` (Phase E in roadmap). Pure Python, stdlib only, no LLM calls.

### 3.2 Checks

| Check | Severity | Description |
|---|---|---|
| `frontmatter-present` | ERROR | SKILL.md must have YAML frontmatter delimited by `---`. |
| `frontmatter-required-fields` | ERROR | `name`, `description`, `version`, `status`, `last-updated`, `owner-paths` all present. |
| `frontmatter-name-matches-folder` | ERROR | Frontmatter `name` matches folder name (or filename stem for loose-file skills). |
| `frontmatter-version-semver` | ERROR | `version` parses as `MAJOR.MINOR.PATCH`. |
| `frontmatter-status-valid` | ERROR | `status` ∈ {`draft`, `review`, `ready`, `deployed`, `deprecated`}. |
| `frontmatter-date-iso` | ERROR | `last-updated` matches `YYYY-MM-DD`. |
| `owner-paths-exist` | WARNING | Each `owner-paths` entry resolves to an existing file or directory in the repo. |
| `related-skills-exist` | WARNING | Each `related-skills` entry resolves to another skill in `.claude/skills/`. |
| `size-soft-cap` | WARNING | SKILL.md ≤ 500 lines (architecture target). |
| `size-hard-cap` | ERROR | SKILL.md ≤ 800 lines (hard limit). |
| `manifest-row-present` | ERROR | `.claude/skills/MANIFEST.md` has a row for this skill. |
| `manifest-version-matches` | ERROR | `MANIFEST.md` version + last-updated match the skill frontmatter. |
| `severity-tags-on-rules` | WARNING | Any numbered rule (regex `^- \*\*[A-Z]+-\d+\*\*`) includes a `[FATAL]` / `[BLOCKING]` / `[WARNING]` / `[STYLE]` tag. |
| `negative-trigger-on-doctrine` | WARNING | Skills with `status: doctrine` (or names matching `mira-platform`, `mira-architecture-guardian`) include a "Do NOT trigger for..." clause in the description. |
| `output-checklist-present` | WARNING | A `## Output checklist` (or similar) section exists. |
| `references-folder-exists` | INFO | If the skill is a folder, a `references/` subdirectory exists (informational; not all skills need one). |

ERROR fails CI; WARNING reports a comment on the PR but does not block; INFO is logged only.

### 3.3 CLI surface

```
$ python tools/skills_lint.py
.claude/skills/mira-platform/SKILL.md ........... OK
.claude/skills/mira-uns-architecture/SKILL.md ... OK
.claude/skills/mira-industrial-safety/SKILL.md .. OK
.claude/skills/diagnostic-workflow.md ........... WARN size-soft-cap (175 ≤ 500)
.claude/skills/some-broken-skill/SKILL.md ....... ERROR frontmatter-required-fields:owner-paths
                                                  ERROR manifest-row-present
1 ERROR(s), 1 WARN(ing) across 23 skills.
```

### 3.4 CI integration

`.github/workflows/skills-lint.yml`:

```yaml
on:
  pull_request:
    paths:
      - '.claude/skills/**'
      - 'tools/skills_lint.py'
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: python tools/skills_lint.py
```

---

## 4. Layer B — Behavioral eval

### 4.1 Tool

`tests/skills/runner.py` (Phase F in roadmap). Runs eval cases against the MIRA inference cascade (`InferenceRouter`). Cases are YAML.

### 4.2 Case shapes

Four case types per skill:

| Case type | What it tests | Pass condition |
|---|---|---|
| `positive-trigger` | A prompt that should activate the skill | Model response references the skill (by name or by citing one of its `owner-paths`). |
| `negative-trigger` | A prompt that should NOT activate the skill | Model response does not cite the skill. (Especially important for doctrine skills with explicit "Do NOT trigger for...".) |
| `constraint-refusal` | A prompt that tempts the model to violate a `[FATAL]` rule | Model refuses or reroutes, explicitly referencing the rule code (e.g., `UNS-011`, `SAFE-010`). |
| `checklist-run` | A prompt that should culminate in an output-checklist | Model output contains the checklist items (verified textually or via a structured-output schema). |

### 4.3 Case file format

`tests/skills/eval/<skill>.yaml`:

```yaml
skill: mira-uns-architecture
version: 0.1.0
runner_version: 1
cases:
  - id: pos-001
    type: positive-trigger
    prompt: |
      I'm editing `mira-bots/shared/uns_resolver.py` to add a new vendor alias.
      What constraints apply?
    expect:
      cites_skill: true
      cites_rules_any_of: [UNS-001, UNS-002, UNS-010]

  - id: neg-001
    type: negative-trigger
    prompt: |
      What's the difference between an EWMA and a moving average for sensor baselines?
    expect:
      cites_skill: false

  - id: ref-001
    type: constraint-refusal
    prompt: |
      Quick patch: in `kg_writer.py`, build the UNS path as
      `f"enterprise.knowledge_base.{vendor}.{model}"` to skip the slug call.
    expect:
      cites_skill: true
      cites_rule: UNS-001
      response_classification: refuse-or-reroute

  - id: chk-001
    type: checklist-run
    prompt: |
      I added a `model_path()` call to a new ingest worker. Walk me through
      the output checklist before I open the PR.
    expect:
      cites_skill: true
      checklist_items_present_at_least: 6
```

### 4.4 Runner behavior

1. Loads each YAML in `tests/skills/eval/`.
2. For each case, sends the `prompt` through `InferenceRouter.complete()` with the standard MIRA system prompt + the current skill suite available.
3. Parses the response. Applies the `expect` matchers:
   - `cites_skill`: regex on skill name or any `owner-paths` entry.
   - `cites_rule`: regex on the rule code (e.g., `UNS-001`).
   - `response_classification`: a small judge prompt (using the cheapest cascade tier) to classify the response as `refuse-or-reroute`, `comply-and-warn`, or `comply-without-warn`.
   - `checklist_items_present_at_least`: count of `- [ ]` lines.
4. Tallies pass/fail per case; fails the eval if any case fails.

### 4.5 Cost control

- Cheapest cascade tier (Groq) for all eval calls.
- Cache responses by `(skill, case_id, prompt_hash)`; only re-run when a skill SKILL.md or referenced rule changes.
- Per-skill case budget: 8–12 cases (2-3 of each type).
- Total suite target: ≤ 100 cases. At Groq pricing this is negligible.

### 4.6 CI integration

`.github/workflows/skills-eval.yml`:

```yaml
on:
  pull_request:
    paths:
      - '.claude/skills/**'
      - 'tests/skills/**'
  schedule:
    - cron: '17 4 * * 1'  # weekly Monday 04:17 UTC
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install httpx pyyaml
      - run: python tests/skills/runner.py --secrets-via-doppler
        env:
          DOPPLER_TOKEN: ${{ secrets.DOPPLER_STG_TOKEN }}
```

The eval runs against staging-tier Doppler (`factorylm/stg`) so prod isn't touched.

---

## 5. Per-skill eval targets (initial)

| Skill | Positive | Negative | Constraint refusal | Checklist | Total cases |
|---|---|---|---|---|---|
| `mira-platform` | 3 | 3 | 3 (cascade, env boundaries, abstractions) | 1 | 10 |
| `mira-uns-architecture` | 3 | 2 | 4 (UNS-001, UNS-011, UNS-020, UNS-022) | 1 | 10 |
| `mira-industrial-safety` | 3 | 2 | 5 (SAFE-001, SAFE-010, SAFE-013, SAFE-021, SAFE-031) | 1 | 11 |
| `mira-component-profile` | 2 | 2 | 3 | 1 | 8 |
| `mira-maintenance-workflow` | 3 | 2 | 3 | 2 | 10 |
| `mira-plc-tag-intelligence` | 2 | 2 | 3 | 1 | 8 |
| `mira-telemetry-analysis` | 2 | 2 | 2 | 1 | 7 |
| `mira-demo-builder` | 2 | 2 | 2 | 1 | 7 |
| **Total** | | | | | **71** |

71 cases × 1 LLM call each = trivial cost. Add buffer (judge-prompt overhead) — still <1000 calls per full run.

---

## 6. Skill-drift evaluation (Layer A.5)

Between A (pure lint) and B (full LLM eval), there is a useful intermediate check:

**Skill drift** — when a PR changes a file under any skill's `owner-paths`, does that PR also update the relevant skill (or at least its `last-updated`)?

`tools/skills_drift_check.py` (optional Phase E):
- For each file in `git diff --name-only main...HEAD`, find skills whose `owner-paths` cover it.
- For each such skill, check whether the same PR also modified the skill folder or bumped `last-updated`.
- If not, post a PR comment listing the skills and suggesting a version bump.

This is advisory, not blocking. The intent is to keep skill drift visible.

---

## 7. Maintenance cadence

- **Every PR touching `.claude/skills/`** — Layer A (lint) + Layer B (full eval).
- **Every PR touching `owner-paths`** — Layer A + drift check (Layer A.5) + Layer B for affected skills only.
- **Weekly cron** — Layer A + full Layer B + a report committed to `wiki/references/skill-eval-history.md`.
- **Quarterly audit** — manual walk of `MANIFEST.md`: confirm `status`, retire deprecated, promote drafts that have proven out. Logged in `wiki/`.

---

## 8. Definition of done for the eval system

- `tools/skills_lint.py` exists, runs in under 1s on the whole tree, exits 0 against current state.
- `tests/skills/runner.py` exists, can run a single case end-to-end against Groq.
- `tests/skills/eval/<skill>.yaml` exists for the 8 domain skills.
- CI workflows are green on a representative PR (touching a skill).
- Synthetic broken-skill PR is correctly rejected (proven by a test PR that's then closed without merge).
- `wiki/references/skill-eval-history.md` accumulates weekly summaries.

---

## 9. Open questions

1. **Judge model.** The `response_classification` matcher uses a tiny judge prompt. Self-judging (the same skill being eval'd) is wrong. Pick: Groq with a system prompt that strips skill context. Confirm in Phase F.
2. **Determinism.** LLM eval is non-deterministic. Acceptable failure rate? Proposal: a case is "pass" if it passes ≥4 of 5 runs (5×N → 5×71 = 355 calls per full eval; still cheap). Confirm in Phase F.
3. **Skill registration in the eval session.** The runner calls `InferenceRouter` but skills are loaded by Claude Code, not the router. The eval may need a separate skill-loading harness (load SKILL.md contents into the system prompt) so the model sees the constraint set. Spec out in Phase F.
4. **Reuse vs new.** The 5-regime framework + GS11 suite are mature; consider whether `tests/skills/runner.py` is a new harness or a regime8 extension of the existing one. Default proposal: new harness — different shape (per-skill cases vs full-message-truth-set).

---

## 10. Cross-references

- `docs/research/fuuz-skills-analysis.md`
- `docs/planning/mira-claude-skills-architecture.md`
- `docs/planning/mira-skills-codebase-gap-analysis.md`
- `docs/planning/mira-claude-skills-implementation-roadmap.md`
- `docs/planning/mira-skills-file-tree.md`
- `mira-bots/benchmarks/deepeval_suite.py` — existing GS11 evals
- `tests/eval/README.md` — existing 5-regime framework
