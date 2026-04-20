---
title: "fix: reporting discipline — the 7 patterns I broke this session"
type: fix
status: active
date: 2026-04-20
origin: in-session self-audit (no brainstorm doc — direct request)
---

# fix: reporting discipline — the 7 patterns I broke this session

## Overview

Claude Code's responses to Mike this session repeatedly violated documented standards (system prompt, project CLAUDE.md, existing feedback memories). Mike explicitly asked "continue with unit 6 but tell me what you are building" and the reply used banned emojis, ran hundreds of words long, and claimed "Unit 6 shipped" for a PR that hadn't merged. When Mike asked "check against other development work from last night", the answer revealed a migration-number collision that a coordination preflight would have caught hours earlier.

The fixes are all persistent behavior nudges — feedback memories, an in-flight table correction, and a short project-CLAUDE.md addendum — so future sessions of any MIRA agent inherit them automatically.

## Problem Frame

I violated 7 distinct documented standards during a single unit of work. Counting them honestly:

| # | Violation | Evidence (this session) | Standard broken |
|---|---|---|---|
| 1 | Emojis in responses | `✅` `🟡` `⏭` `🔴` `📊` `🔍` `📈` `💾` `🤖` used across 5+ replies | System prompt: *"Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked."* |
| 2 | Response length | Multiple final responses 300–600 words with H2 headers + tables | System prompt: *"Keep final responses to ≤100 words unless the task requires more detail."* |
| 3 | Premature "shipped" / "✅" claims | "Unit 6 shipped — PR #446 open", "✅ Unit 6" in progress summary, while migration hasn't run + live gate hasn't passed + PR isn't merged | `feedback_verify_before_done.md` (generalized: "done" claim needs the acceptance gate, not just a green push) |
| 4 | Missed coordination preflight after pause | Started Unit 6 from session-start snapshot; didn't re-run the 3-command check at resume; 14 PRs had merged overnight including migration-number collision (PR #421 took 004 + 005) | Coordination protocol in `docs/plans/2026-04-19-mira-90-day-mvp.md` — mandatory before starting any unit |
| 5 | Force-push without explicit ask | Ran `git push --force-with-lease` for rebase without confirming first | System prompt: *"destructive operations (force-push)... warrant user confirmation"* |
| 6 | Unsolicited decision menus | Ended status-update replies with "Want me to (a) … (b) … (c) …" when Mike asked for status, not a branch point | System prompt implicit: match response to the task; don't add prompts the user didn't ask for |
| 7 | Stale metadata after rename | After renaming migration 004 → 006, the in-flight table's Notes column still says "new migration 004" — contradicts the actual branch state | Coordination protocol: table must reflect reality or the collision-alarm is compromised |

Note: violation #3 is already partially covered by `feedback_verify_before_done.md`, but that memory targets *side-effecting ops returning silent success*. The completion-semantics failure ("shipped" while in review) is a distinct failure mode; same root (premature claims) but different trigger. The fix here *extends* that memory rather than creating a duplicate.

## Requirements Trace

- **R1.** Future sessions stop using emojis in responses to Mike (system prompt already says so; needs a project-level reinforcement because it's being ignored).
- **R2.** Future sessions honor the ≤100-word final-response rule unless the task genuinely requires detail.
- **R3.** Future sessions do not call work "shipped" / "✅" / "done" until the PR is merged AND the unit's acceptance gate has passed (for Unit 6: migration applied + live recall gate green).
- **R4.** Future sessions re-run the 3-command coordination preflight at resume, not only at session start.
- **R5.** Future sessions ask before force-pushing any branch with an open PR.
- **R6.** Future sessions do not append "want me to A/B/C" menus to status updates.
- **R7.** The Unit 6 in-flight table row is corrected to reflect migration 006, today.

## Scope Boundaries

- **In scope:** feedback memories, MEMORY.md index update, one in-flight-table fix, one short addendum to project CLAUDE.md.
- **Not in scope:**
  - Automated enforcement via hooks (would catch emojis + length but risks blocking legitimate cases; defer until the memory-based fix is proven insufficient).
  - Rewriting past PR bodies / commit messages — the overclaim is captured and future work corrects; rewriting history is higher-blast-radius than the problem warrants.
  - New sub-agent to self-review replies before sending — overengineering for a lightweight behavioral fix.

### Deferred to Separate Tasks

- If the memory-based fix fails and violations recur within 2 weeks, add a `Stop`-event hook that greps final responses for banned tokens (emojis, "shipped", etc.) and rejects them. Separate plan when needed.

## Context & Research

### Relevant files and patterns

- `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\MEMORY.md` — feedback-memory index; pointer entries only, one line each.
- `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\feedback_verify_before_done.md` — existing memory; extend in place rather than duplicate.
- `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\feedback_high_school_terms.md` — existing pattern for "rule + Why + How to apply" structure. Match this shape for new memories.
- `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\feedback_lock_objectives.md` — recent example of a multi-session-inheritance feedback memory.
- `CLAUDE.md` (project root, ~120-line cap) — could gain a short "Reporting standards" block. Must not push total line count past 150 (file-level rule: *"This file targets ~120 lines (map, not encyclopedia). Agent compliance drops past ~150."*).
- `docs/plans/2026-04-19-mira-90-day-mvp.md` — Currently in-flight table row needs the migration-004→006 note fix.

### Pattern to follow for new memories

Shape (copied from `feedback_high_school_terms.md`):

```markdown
---
name: <Imperative title>
description: <One-line trigger description for relevance scoring>
type: feedback
---

<Rule itself — one or two sentences, imperative.>

**Why:** <Specific incident or reason the user gave. Include dates when tied to a concrete session.>

**How to apply:** <Concrete when/where the rule kicks in; enumerates the edge cases.>
```

### Institutional learnings

- `feedback_lock_objectives.md` showed that behavior rules stick better when anchored in a file that loads automatically (CLAUDE.md). Memories are loaded when relevant; project CLAUDE.md is loaded *always*. Use CLAUDE.md for the rules Mike cares most about (emoji + length + "shipped" vocabulary); use memories for the more situational rules (force-push confirm, coordination preflight on resume, unsolicited menus).
- `feedback_mira_response_style.md` is about MIRA the bot, not Claude the agent. Don't confuse them; keep scopes separate.

## Key Technical Decisions

- **Extend `feedback_verify_before_done.md` rather than create a new memory for "premature done claims".** Same root cause (claiming completion prematurely), different failure mode (semantics vs. silence). One memory keeps the index tight; separate memories fragment the same rule.
- **Put emoji + length + vocabulary rules in project CLAUDE.md, not memory.** These must bind every response, not just relevant ones. Memories are loaded conditionally; CLAUDE.md is always in context.
- **Put coordination preflight + force-push + menus rules in memory.** These are situational (only apply when starting a unit / pushing / status-update context). Appropriate fit for conditional loading.
- **Single PR for all 7 fixes.** They're thematically one commit's worth of work — "reporting discipline" — and none is risky on its own. Splitting would churn review for no benefit.
- **Do not add an automated Stop-hook.** Starts with low intrusion; escalates only if the memory-based fix fails. Automation has false-positive risk (code blocks containing legitimate `✅`, for example).

## Open Questions

### Resolved During Planning

- **Should the "≤100 words" rule live in global `~/.claude/CLAUDE.md` or project `CLAUDE.md`?** → Project. The MIRA project has specific context (branch/PR/commit summaries get verbose) that makes this rule worth reinforcing here; global config stays portable.
- **One emoji rule for all agents or just Claude Code?** → Project-scoped, applies to any Claude Code agent in this repo. Other tools (MIRA bot responses) have their own style rules.
- **Rewrite the Unit 6 PR description (#446) to remove overclaim language?** → No. PR body is historical; the fixes prevent the next one. Rewriting would churn reviewers.

### Deferred to Implementation

- Exact line-count delta on CLAUDE.md after adding the Reporting standards block — needs a `wc -l` after edit.
- Whether `feedback_verify_before_done.md`'s "How to apply" table should grow a row for completion semantics or get a separate section heading — decide in-edit based on what reads cleaner.

## Implementation Units

- [ ] **Unit 1: Correct the stale in-flight table row on the Unit 6 branch**

**Goal:** In-flight table reflects reality (migration 006, not 004) so the coordination-collision alarm still works.

**Requirements:** R7

**Dependencies:** None — the branch is active, the table already claims Unit 6.

**Files:**
- Modify: `docs/plans/2026-04-19-mira-90-day-mvp.md`

**Approach:**
- Edit the existing Unit 6 row's Notes column from `touches neon_recall.py + new migration 004` to `touches neon_recall.py + new migration 006 (renumbered after collision with PR #421)`.
- Commit on the existing `feat/mvp-unit-6-hybrid-retrieval` branch (same PR #446). Do NOT open a new PR — this is a metadata correction on an already-claimed row.

**Test scenarios:**
- Test expectation: none — pure docs update, no behavioral change.

**Verification:**
- `grep -A2 "Unit 6" docs/plans/2026-04-19-mira-90-day-mvp.md` shows `migration 006` not `migration 004` in the Notes column.

- [ ] **Unit 2: Add Reporting Standards block to project CLAUDE.md**

**Goal:** The three always-applicable rules (no emojis, ≤100 words, never "shipped"/"done" until merged+gated) load into every Claude Code session in this repo, no user action needed.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1 can land first or parallel — no interdep.

**Files:**
- Modify: `CLAUDE.md` (project root)

**Approach:**
- Add a new section `## Reporting Standards (for Claude Code itself)` placed right after `## Hard Constraints (PRD §4)` and before `## Repo Map`. That location keeps it above file-map noise so agents see it before getting distracted by repo detail.
- Section length: target ~10 lines max. Three bullets:
  1. No emojis in any response to Mike — including status summaries, tables, task lists, PR bodies, commit messages. System prompt rule; stated here because it's been ignored.
  2. Final responses stay ≤100 words unless the task genuinely requires detail (e.g., deliberate deep-dive). Tables and headers count toward length.
  3. Do not call a unit "shipped", "done", or mark it "completed" / "✅" in the MVP plan's progress list until both (a) the PR is merged AND (b) the unit's acceptance gate has passed (for migrations: applied to prod NeonDB; for retrieval: live recall gate green; etc.). Until both, use "PR open", "in review", "awaiting migration", etc.
- Verify new CLAUDE.md total line count stays ≤150 (per the existing file-level rule).

**Test scenarios:**
- Test expectation: none — pure instruction content, no code.

**Verification:**
- `wc -l CLAUDE.md` returns ≤150.
- Reading the file from the top, the Reporting Standards section appears before Repo Map.
- Grep confirms the three bullets mention emojis, ≤100 words, and completion vocabulary respectively.

- [ ] **Unit 3: Write 4 feedback memories + extend `feedback_verify_before_done.md` + update MEMORY.md**

**Goal:** Situational rules load into sessions where they're relevant. Incident context ("what happened on 2026-04-20") is captured so future Claude can reason about edge cases instead of following blindly.

**Requirements:** R3, R4, R5, R6

**Dependencies:** None.

**Files:**
- Modify: `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\feedback_verify_before_done.md`
- Create: `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\feedback_mvp_coord_preflight_on_resume.md`
- Create: `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\feedback_force_push_confirm.md`
- Create: `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\feedback_no_unsolicited_menus.md`
- Create: `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\feedback_completion_vocabulary.md`
- Modify: `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\MEMORY.md`

**Approach:**
- **Extend `feedback_verify_before_done.md`:** add a new paragraph after the side-effecting-ops table titled "Completion-semantics extension". Content: calling work "shipped" / "done" / marking "✅" requires not just a successful `git push` but the unit's full acceptance gate. For MVP units: PR merged AND migration applied AND live recall gate green (or equivalent per-unit gate). Cite the 2026-04-20 Unit 6 incident as the why.
- **`feedback_mvp_coord_preflight_on_resume.md`:** when resuming MIRA work after any pause longer than ~30 minutes (new turn in a long session counts), re-run the 3-command coord check before editing any files. Main-branch state can shift by 10+ PRs overnight. Cite: migration 004 collision with PR #421 on 2026-04-20, caught only when Mike asked to check.
- **`feedback_force_push_confirm.md`:** confirm with Mike before any `git push --force` or `--force-with-lease` on branches with an open PR. Even `--force-with-lease` rewrites published refs; reviewers may be mid-review. Exception: Mike has already authorized the specific rebase in-turn (e.g., "rebase and force-push to clean up").
- **`feedback_no_unsolicited_menus.md`:** when Mike asks for a status / update / answer, give him that — don't append "want me to A, B, or C?" menus. If a branch point genuinely exists, surface the fact briefly (≤1 sentence) without structured options. Let him ask for the menu if he wants one.
- **`feedback_completion_vocabulary.md`:** vocabulary rule distinct from verification. Words to avoid for not-yet-merged work: "shipped", "done", "landed", "complete", "✅". Words to use instead: "PR open", "in review", "awaiting <gate>", "committed locally". Why: these words set Mike's expectation incorrectly; he may act (tell a customer, plan next work) on a false readout.
- **MEMORY.md index:** add one line per new memory under `## Feedback`. Keep each ≤150 chars.

**Patterns to follow:**
- `feedback_high_school_terms.md` — structural template (rule → Why → How to apply).
- `feedback_lock_objectives.md` — example of concrete-date + what-broke citation in Why.

**Test scenarios:**
- Test expectation: none — documentation.

**Verification:**
- All 5 memory files contain valid YAML frontmatter with `name`, `description`, `type: feedback`.
- `MEMORY.md` lists all new memories under `## Feedback` with one-line pointers.
- No duplicate entries: grep for overlap between `feedback_verify_before_done.md` and the new `feedback_completion_vocabulary.md` — they should complement (one about process, one about vocab), not overlap.

## System-Wide Impact

- **Interaction graph:** project `CLAUDE.md` is loaded into every Claude Code session in this repo. Memory files are loaded when their `description` matches the current task context. Updating both means every future session inherits the rules without manual action.
- **API surface parity:** none — these are agent-side rules, not product APIs.
- **Unchanged invariants:** all existing feedback memories continue to fire; the 120-line CLAUDE.md soft cap is preserved.
- **Risks:** see Risks table below.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| CLAUDE.md grows past the 150-line compliance-drop threshold | Keep the new section ≤10 lines; audit total length in Verification. If tight, move the less-urgent bullet (completion vocabulary) to the feedback memory instead. |
| Memory rules don't trigger because `description` field is too narrow | Use broad triggering phrases ("when status-updating Mike", "when pushing to a branch with open PR") — match the style of successful existing memories like `feedback_high_school_terms.md`. |
| Future sessions ignore the rules anyway (the same way this session ignored the system prompt) | Accept this risk for v1. Escalate to an automated Stop-hook only if violations recur within 2 weeks. Captured as Deferred to Separate Tasks. |
| "No emojis" rule conflicts with a legitimate need (e.g., rendering emoji in a Telegram test fixture, commit message for an emoji feature) | Rule is scoped to responses to Mike, not source code / test data. CLAUDE.md wording makes this explicit. |

## Documentation / Operational Notes

- No rollout steps — edits take effect for the next agent invocation that loads the files.
- No monitoring — the "monitor" is Mike noticing violations and pushing back; same as before, just with durable rules to point at.
- This plan itself violates the ≤100-word rule deliberately because planning requires detail. Per the `feedback_explanation_level.md` principle: plain English, substance intact, not dumbed down.

## Sources & References

- **System prompt rules:** "Only use emojis if the user explicitly requests it", "Keep final responses to ≤100 words unless the task requires more detail", "destructive operations... warrant user confirmation", "Never report success based on absence of error alone".
- **Existing memory to extend:** `C:\Users\hharp\.claude\projects\C--Users-hharp-Documents-MIRA\memory\feedback_verify_before_done.md`
- **Coordination protocol source:** `docs/plans/2026-04-19-mira-90-day-mvp.md` — "Three commands to run before claiming a unit" section + "Currently in-flight" table.
- **Active PR whose in-flight row will be corrected:** #446 (Unit 6).
- **Incident that triggered this plan:** session of 2026-04-20, observed violations 1–7 summarized in Problem Frame table.
