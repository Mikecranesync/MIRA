---
status: active
owner: Mike
tags: [velocity, dx, ci, cd, eval]
linked: ../../ideation/2026-04-19-mira-dev-velocity-ideation.md
---

# MIRA Dev-Velocity Roadmap

**Goal:** Execute the 7 survivors from the 2026-04-19 dev-velocity ideation in a logical sequence so a 1-2 engineer team can finish MIRA meaningfully faster, with each step compounding on the prior.

**Source artifact:** `docs/ideation/2026-04-19-mira-customer-experience-ideation.md` (CX side) and `docs/ideation/2026-04-19-mira-dev-velocity-ideation.md` (this side).

**Architecture:** Ship in seven increments, each behind its own PR. Sequencing is chosen so prerequisites land first — fast CI before auto-deploy; shift-left eval before auto-minted evals; spec index before the AI-director commands that lean on it. Each step has a status chip here and lives as its own plan file once brainstormed via `/ce-brainstorm`.

**Tech Stack:** GitHub Actions, pytest-xdist, Docker `cache-from: type=gha`, bash, Python 3.12, Claude Code pre-commit hooks, Doppler, Tailscale, NeonDB, existing MIRA eval harness.

---

## Summary Table

| # | Survivor | Status | Complexity | Est. | Depends on |
|---|----------|--------|-----------|------|-----------|
| 6 | Frontmatter spec index + semantic grep | `in-progress` (this PR lands Phase 1) | Low | 2-3 days | — |
| 2 | Impact-graph CI: pytest-xdist + selective + Docker gha + parallel SAST | `next` | Low | ~3 days | — |
| 3 | Pre-commit + on-save smoke eval (15 cases, <2min) + SAST parity | `queued` | Medium | 3-5 days | #2 (needs fast offline-judge path) |
| 1 | Auto-deploy to staging on green main + one-click prod promote | `queued` | Medium | ~1 week | #2, #3 (green gates must be trustworthy) |
| 4 | Auto-mint regression evals from every `fix:` PR | `queued` | Medium | 3-5 days | #3 (eval infra shifted left) |
| 5 | Prompt registry + CI eval-diff gate | `queued` | Medium | 1-2 weeks | #3, #4 (eval gate is the payoff) |
| 7 | Unified devcontainer + compose profiles + Doppler default-shell | `queued` | Medium-High | ~1 week | — (parallel-safe, land last to minimize dev disruption) |

Total: ~5-8 calendar weeks depending on parallelism and review bandwidth.

---

## Sequence Rationale

**#6 first** — cheapest (~60 min for the index generator), safest (docs-only), compounds immediately. Every subsequent planning session starts with a queryable source of truth instead of `Grep` archaeology.

**#2 second** — pure win. `pytest-xdist -n auto` is free parallelism; Docker `type=gha` drops builds from 3-4min to 30-60s on warm cache; selective test runs cut 40-60% of CI on feature branches. No architectural risk. Unblocks trust in CI for every survivor after this.

**#3 third** — depends on #2 because the smoke-eval loop needs fast offline judge (Groq-free) to run in <2min pre-commit. Once landed, prompt-engineering becomes a REPL instead of guess-and-push; 10-100x diagnosis-window compression.

**#1 fourth** — depends on #2+#3 because auto-deploy without trustworthy CI + eval gates is gun-to-foot. With gates in place, auto-deploy to staging eliminates the #1 recurring time tax (manual SSH-through-Charlie dance).

**#4 fifth** — depends on #3 infrastructure; this is the compounding payoff: every `fix:` PR mints its own regression eval. After 3 months the eval set grows from 51 → 200+ for free.

**#5 sixth** — depends on #3+#4 because a prompt registry without eval-diff feedback on change is just filesystem reorganization. With the eval gate, every prompt tweak becomes a measured experiment with PR-comment diff.

**#7 seventh** — parallel-safe with the rest but lands last because the devcontainer migration changes every developer's flow. Do it when the CI + CD + eval loop is already solid so Windows/Mac divergence is the last remaining major friction.

---

## Parallelization Notes

Pairs that can be worked in parallel by different contributors or worktrees:

- **#6 + #2** — completely independent (#6 is docs/scripts, #2 is CI YAML). Can land in the same week.
- **#4 + #5** — once #3 is live, these are both eval-infrastructure and touch similar files; better to do them sequentially to avoid merge conflicts.
- **#7** — orthogonal to all others; can be brainstormed and planned while others are being built.

Anti-parallel: **#1 must not ship before #3**. Auto-deploy without a reliable smoke gate is how you ship a prompt regression to every user on a Sunday night.

---

## Tracking

- **This roadmap** is the top-level tracker. Update the status column above as each survivor lands.
- **Per-survivor brainstorm doc** lives in `docs/superpowers/specs/2026-04-19-velocity-<n>-<slug>-design.md`, produced by `/ce-brainstorm` when starting that item.
- **Per-survivor plan doc** lives in `docs/superpowers/plans/2026-04-19-velocity-<n>-<slug>.md`, produced by `/ce-plan` after brainstorm.
- **Each PR** merges on its own branch (`feat/velocity-<n>-<slug>`) and updates this file's status chip in the same PR.
- **Index** (`docs/superpowers/INDEX.md`) regenerates on pre-commit once #6 Phase 2 lands; until then, run `python tools/generate_docs_index.py` manually.

---

## Non-Goals

- **Not** adopting the "AI-director `/ship <issue-url>`" enabler yet. That goes after the 7 survivors are in place — the plumbing needs to be trustworthy before we hand the full loop to an agent.
- **Not** ripping out mira-sidecar here. Already tracked in ADR-0008 / OEM migration.
- **Not** rebuilding the Makefile. Compose profiles in #7 replace most of what a Makefile would do.
- **Not** moving to a new CI platform. GitHub Actions is fine; #2 makes it faster, not different.

---

## Verification

Per-survivor acceptance criteria will be written into the brainstorm doc for that item. At the roadmap level:

- [ ] #6 Phase 1 landed: `INDEX.md` exists, regenerator script committed, frontmatter schema documented.
- [ ] #6 Phase 2 landed: semantic-grep command wired to local nomic-embed.
- [ ] #2 landed: CI time-to-green on a typical feature-branch PR drops by >50%.
- [ ] #3 landed: a prompt-only change triggers a smoke eval in <2min pre-commit and fails commit on regression.
- [ ] #1 landed: a merge to `main` produces a staging deploy with health-check green inside 5 minutes, end-to-end, no human intervention.
- [ ] #4 landed: a synthetic `fix:` PR auto-appends an eval case and the case blocks if the fix is reverted.
- [ ] #5 landed: a prompt PR comment shows pass@1 and judge-score delta per scenario.
- [ ] #7 landed: `git clone && code .` in VS Code opens into a working devcontainer where `pytest` and `doppler run -- docker compose up` both work out of the box on Windows, macOS, and Linux.

---

## Source Links

- Ideation: `docs/ideation/2026-04-19-mira-dev-velocity-ideation.md`
- Companion ideation (CX side): `docs/ideation/2026-04-19-mira-customer-experience-ideation.md` (PR #402)
- Plugin that generated this: `compound-engineering@compound-engineering-plugin` v2.68.1
