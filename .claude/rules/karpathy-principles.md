# Karpathy Coding Principles (MIRA-adapted)

Source: Andrej Karpathy's coding behavior principles (github.com/forrestchang/andrej-karpathy-skills), adapted for the MIRA project.

These complement — not replace — `python-standards.md` (style) and `security-boundaries.md` (safety). They govern *behavior*, not syntax.

> **Tradeoff note:** these bias toward caution over speed. For trivial, single-line, or obviously-correct changes use judgment — don't ceremoniously apply all four principles to a typo fix.

---

## 1. Think Before Coding

Before any non-trivial change:

- **State assumptions explicitly.** What inputs, environments, contracts are you assuming? Write them down before editing.
- **Present multiple interpretations when ambiguous.** If the user's request maps to ≥2 reasonable implementations, surface the fork before picking one.
- **Push back when a simpler approach exists.** If the user asks for X and Y would meet the same goal with less code, say so. Defer to user judgment, but flag.
- **Stop and ask when confused.** Better to pause than to ship the wrong thing. The cost of one clarifying question is much lower than the cost of a wrong PR.

**MIRA hook:** the spec-first convention already lives at `docs/superpowers/specs/` — for any feature larger than a one-line fix, the spec doc *is* the place where assumptions and interpretations get written down. If a spec exists, read it first; if it doesn't and the change is non-trivial, write one (or at minimum a `PLAN.md` block) before code.

## 2. Simplicity First

- Write the **minimum code that solves the problem**. No more.
- **No features beyond what was asked.** "While I'm here" additions belong in a separate PR or a follow-up issue.
- **No abstractions for single-use code.** Three similar lines beats a premature factory.
- **No speculative flexibility.** Don't add config knobs, plugin hooks, or "future-proofing" that has no current caller.
- **If 200 lines could be 50, rewrite it.** Length is a code smell, not a virtue.

**MIRA hook:** PRD §4 already bans LangChain/n8n-style abstraction over the LLM call — extend that mindset to *all* code in the repo. Engine layer, bot adapters, and ingest pipelines should be readable top-to-bottom, not chained through 4 indirections.

## 3. Surgical Changes

- **Don't improve adjacent code.** If it's not broken and not in scope, leave it.
- **Don't refactor things that aren't broken** as part of an unrelated change.
- **Match existing style** in the file you're editing, even if you'd write it differently in a greenfield context.
- **Mention unrelated dead code, but don't delete it** in this PR. Open an issue or note it in the PR description.
- **Remove only imports/variables/functions that *your* changes made unused.** Don't sweep pre-existing dead code into the diff.

**Test:** every changed line should trace to the user's request. If you can't justify a hunk, revert it.

**MIRA hook:** this is also enforced socially via the automated review pipeline (`.github/workflows/code-review.yml`) — reviews flag scope creep. Make the reviewer's job easy by keeping diffs tight from the start.

## 4. Goal-Driven Execution

- **Transform tasks into verifiable goals.** "Add validation" → "write tests for these specific invalid inputs, then make them pass." Vague tasks produce vague work.
- **State a brief plan with verify steps** before implementing anything non-trivial. Two or three sentences is enough — what you'll change, and how you'll know it worked.
- **Strong success criteria let the loop run independently.** When the goal is measurable (test passes, command returns expected output, screenshot matches), you can iterate without checking in after every step.
- **Evidence beats assertion.** "I think it's done" is not done — see Cluster 7 Laws (Law 1: Evidence-Only Completion) in `~/factorylm/CLUSTER.md`.

**MIRA hook:** the 5-regime testing framework (`tests/`) and the eval harness (`tests/eval/`) are the verify steps for most diagnostic-engine work. Use them. For UI changes, the screenshot rule (CLAUDE.md "Screenshot Rule") is your evidence.

---

## Meta-Test

These guidelines are working if:

- **Fewer unnecessary changes in diffs** — PRs touch only what the request demands.
- **Fewer rewrites due to overcomplication** — first draft solves the problem; second pass is polish, not redesign.
- **Clarifying questions come before implementation, not after mistakes** — confusion surfaces in chat, not in a reverted commit.

If diffs are still sprawling, rewrites still common, and clarifications still post-hoc — these principles aren't being applied; revisit them.
