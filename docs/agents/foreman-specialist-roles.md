# FactoryLM Foreman — Specialist dispatch roles

**Status:** Design draft (not implemented). No Gateway enum changes, no new Slack bots, no live-session disturbance.
**Date:** 2026-09-04
**Audience:** Foreman (Grok) + Claude implementing this with Foreman. Mike remains the only human Foreman talks to.
**Does not replace:** `docs/agents/subagent-development-handbook.md` §10 (investigator / implementer / test-engineer / Gate 7 / reviewers / release-verifier). This document is the **Foreman routing card** over those specialists plus fleet.

---

## 0. How Foreman actually runs today

```
Mike
  → Slack #factorylm-foreman (C0BTXHXBKML)
  → FactoryLM Foreman bot (`mira-bots/foreman/`)
  → one warm Grok cloud agent (this face)
  → Fleet Gateway MCP
       fleet_status | launch_worker | message_worker | task_status
       request_handoff | request_review | stop_worker
  → physical computers Alpha | Bravo | Charlie
  → node-local CAO → Claude or Codex in an isolated worktree
```

Facts that are load-bearing (proven 2026-09-04 on this thread, not guessed):

| Fact | Evidence |
|---|---|
| Foreman is one face. Specialists must be **roles Foreman dispatches**, not 8 Slack bots and not new Gateway node names. | `mira-bots/foreman/README.md`; live bot identity |
| Alpha / Bravo / Charlie are **computers**. Claude / Codex are **workers**. | Node map in root `CLAUDE.md`; Gateway `role` + `provider` enums |
| `current_session` is a **latest-running pointer**, not a census. After a new launch it moves; that does not prove the previous session was stopped. | `fleet_status` after `REMOTE-CONTROL-VISIBILITY-001` launch |
| `message_worker` accepts outbound text (`accepted: true`) and **does not return worker chat**. Bravo summaries are not review evidence. | Gateway tool result; Remote Control visibility FAIL |
| Gateway has **no tool** to enable Claude Code Remote Control or read a `https://claude.ai/code/session_…` URL. Do not invent one. | Same FAIL; draft #3568 mapper not on live Gateway |
| Charlie `launch_worker` with an isolated worktree **fails** if that clone has not fetched the object (`failed to create isolated worktree`). No session id → nothing to stop. | `SAFE-LEGACY-SESSION-ADOPTION-REVIEW-ONCE` vs SHA `6b2b71e4` |
| Duplicate Slack kickoffs will re-ask “retry once” after it already failed. Foreman must **de-dupe** and not launch again. | This thread, 2026-09-04 |
| Live session to leave alone unless Mike names it: `cao-REMOTE-CONTROL-VISIBILITY-001-3a81ed0a` (`REMOTE-CONTROL-VISIBILITY-001`). | Explicit hold |
| HELD: GitHub **#3533** / **#3558**. Do not merge or “fix while here.” | Foreman thread |
| Merge / deploy / SSH / PLC / plant networking / session stop require **Mike’s explicit OK**. | This design; `docs/environments.md`; safety skills |

**Done** means Git refs + worktrees + tests actually run + a durable handoff (PR comment, HANDOFF artifact, or `task_status` that cites the SHA checked out). Chat claims are not done.

---

## 1. Non-negotiable operating rules

1. **Mike talks only to Foreman.** Claude and Codex never become Slack faces for this system.
2. **Search before create.** Repo Archaeologist (or Foreman GitHub search for a narrow lookup) before any builder launch.
3. **Builder is never its own only reviewer.** Bravo Claude builds; Charlie Codex reviews a **named SHA** on a **different machine**.
4. **Split Adversarial Reviewer vs Verifier** even when both run on Charlie (different `task_id`s and prompts).
5. **Industrial / robotics is explicit opt-in.** No PLC/Ignition/COM3/hardware dispatch unless Mike names that scope in-thread. Exception: if a Bravo diff already touches those paths, **stop and ask** — do not silently continue.
6. **Claims require proof.** SHA, commands, session IDs touched / not touched, PASS / FAIL / BLOCKED.
7. **Reports to Mike in plain English.** Proven vs inferred vs blocked.
8. **No merge, deploy, or session disturb** without explicit approval.

---

## 2. Two planes

| Plane | Who | Use for |
|---|---|---|
| **Grok-side** (Foreman + GitHub/Slack/Gateway read tools) | Mission Planner, narrow archaeology, Product Researcher | Plans, lookups, research. **No fleet launch** unless the answer lives only on a node. |
| **Fleet** (isolated worktree on a real computer) | Software Engineer, Fleet Engineer, Adversarial Reviewer, Verifier | Code, Gateway infra, independent review, hermetic tests. |

Default computers: **Bravo + Claude** builds; **Charlie + Codex** reviews. Alpha is a computer of last resort and only if Mike says that mission may use it.

Use a Grok-side / Cursor specialist when the repo or GitHub is enough. Launch a node worker only when the job needs that computer.

---

## 3. Map onto existing handbook agents (do not fork)

Foreman role names are **aliases**. Implementation must reuse `.claude/agents/` rather than invent parallel personalities.

| Foreman role | Existing specialist (keep) | What is new |
|---|---|---|
| Mission Planner | Orchestrator duties in handbook §7.4 + product-orchestrator skill (money-path only when relevant) | Foreman-local brief + de-dupe + “do not touch” list |
| Repo Archaeologist | `investigator.md` (read-only) + CodeGraph / `explore` | Explicit search-before-create for fleet missions |
| Software Engineer | `implementer.md` + **not** `test-engineer.md` | Fleet: Bravo Claude isolated worktree |
| Fleet Engineer | **Does not exist today** | The only new specialist. Gateway / CAO / worktrees / session identity |
| Adversarial Reviewer | `gate7-adversarial-reviewer.md` + Charlie `request_review` | Hard rule: Codex on Charlie, exact SHA |
| Verifier / QA | `release-verifier.md` + mechanical pytest | Separate Charlie `task_id` from reviewer |
| Industrial & Robotics | `safety-reviewer.md` + `mira-industrial-safety` + PLC/fieldbus skills | Opt-in dispatch; never plant action |
| Product Researcher | Handbook §14.3 + product-orchestrator | BOM/sourcing stays here until volume justifies a split |

**Do not collapse Test Engineer into Software Engineer.** The builder may *run* tests; it does not own the only test write or the only review.

---

## 4. Role cards

### 4.1 Mission Planner

- **Owns:** Break the objective into missions, acceptance criteria, search-before-create, pick specialists / computers / SHA, stop conditions, de-dupe.
- **Call when:** Any multi-step ask, any launch, any hold (merge / deploy / session). Skip a full brief for a one-line status ask (`fleet_status`).
- **Must not:** Write product code, merge, launch duplicate work, disturb existing sessions, treat a plan as proof.
- **Worker:** Grok-side. Claude on a worktree only if a long planning pack must be a Git artifact.
- **Proof:** Mission brief: goal, out of scope, existing issues/PRs/sessions found, one worker, exact SHA/ref, success criteria, **do not touch** list.

### 4.2 Repo Archaeologist

- **Owns:** What already exists in `Mikecranesync/MIRA` (and factorylm when in scope) before anything new is built.
- **Call when:** Before Software / Fleet Engineer; any “is this already done?”
- **Must not:** Implement, refactor “while here,” open drive-by PRs, guess node-local state it cannot read.
- **Worker:** Foreman GitHub / this checkout first. Bravo Claude only if the answer lives on that machine (worktree, `~/.claude/sessions`).
- **Proof:** Paths, SHAs, PR/issue links, reuse-vs-new recommendation.

Work already found that must not be recreated blindly:

- Defect pipeline: handbook §14.1 + `.claude/skills/defect-workflow/`
- Foreman bot: `mira-bots/foreman/` (PR #3559)
- Legacy session discover/adopt: draft **#3568** (fail-closed `list_legacy_sessions` / `adopt_legacy_session`). Independent Charlie review is **blocked** on Charlie fetch/worktree provision, not on missing design. Do not merge #3568 from this PR.

### 4.3 Software Engineer

- **Owns:** MIRA / app implementation in an isolated worktree after archaeology + contracts + red tests exist. Maps to **implementer**.
- **Call when:** Planner + Archaeologist say build is needed.
- **Must not:** Be its own only reviewer; merge / deploy; touch PLC / Ignition / plant; expand scope; write the only tests.
- **Worker:** Claude on Bravo (default). Alpha only if Bravo is busy **and** Mike allows it for that mission.
- **Proof:** Branch, commits, exact tests run, draft PR, durable handoff. SHA of HEAD.

### 4.4 Fleet Engineer

- **Owns:** Fleet Gateway MCP, CAO adapters, node wiring, allowlist tools — **public HTTPS Gateway only**. Session identity, worktree provision, Charlie fetch/provision failures.
- **Call when:** Gateway / orchestration infra (not product features).
- **Must not:** Expose CAO / LAN / SSH; invent Remote Control URLs; merge HELD #3533 / #3558; change credentials / networking / tunnels without Mike; disturb sessions Mike did not name.
- **Worker:** Claude on Bravo for Gateway worktrees. Charlie Codex reviews the exact SHA.
- **Proof:** Gateway tests, draft PR, raw `fleet_status` / `task_status` JSON, sessions touched / not touched. `fleet_status` after any **approved** restart only.

Known live holes this role must not paper over:

1. No worker-stdout / chat read-back.
2. No Remote Control enable / `bridgeSessionId` on live Gateway (#3568 not deployed).
3. No session census (only `current_session` latch).
4. Charlie isolated worktree create fails closed when the object is missing — treat as FAIL, do not SSH around it.

### 4.5 Adversarial Reviewer

- **Owns:** Independent critique of an **exact Git ref** (bugs, safety, contract lies, missing tests). Try to **disprove**. Maps to Gate 7.
- **Call when:** After Software / Fleet Engineer claims ready; before Mike decides merge.
- **Must not:** Review its own implementation; trust Bravo chat summaries; edit; merge.
- **Worker:** **Codex on Charlie (hard rule).** Different computer than the builder. If Codex built it, Claude reviews.
- **Proof:** PASS / FAIL against the SHA that was **actually checked out**, finding list with `file:line`, “what was not checked.” No session / no checkout = **FAIL**.

### 4.6 Verifier / QA

- **Owns:** Run acceptance checks against Git artifacts (tests, commit-match, handoff completeness). Maps to release-verifier. Different person from the test author.
- **Call when:** After review PASS, or when Mike asks “is it actually done?”
- **Must not:** Rewrite product code to “make green”; merge / deploy; treat a skipped CI job as a pass.
- **Worker:** Codex or Claude on Charlie, **separate `task_id`** from Adversarial Reviewer.
- **Proof:** Exact command, pass/fail counts, failing names, CI run URL if used, SHA verified. Honest limit: live `task_status` often shows `tests: not_run` and no log body — the verifier must produce its own command output.

### 4.7 Industrial & Robotics Engineer

- **Owns:** PLC / Ignition / COM3 / robotics **design notes** and *planned* control work. Advisory vs control. Uses existing safety / PLC / fieldbus skills.
- **Call when:** **Only if Mike explicitly names** industrial / robotics scope.
- **Must not:** Touch live PLC / hardware, change plant networking, treat simulation as plant proof, claim equipment is safe, act as a safety function. MIRA stays advisory.
- **Worker:** Claude for design docs. Physical / specialized nodes only with Mike’s explicit approval (out of default fleet).
- **Proof:** Design + hazards (S0–S5) + “needs Mike OK before physical.” Never a silent plant action.

### 4.8 Product Researcher

- **Owns:** Product / business options, competitive briefs, BOM / sourcing options (until volume justifies a split).
- **Call when:** Decisions, pricing / sourcing, “should we build X?”
- **Must not:** Write production code, open infra PRs, invent metrics without sources.
- **Worker:** Grok-side (web + later HubSpot / Drive when connected). **Not** a fleet coding session.
- **Proof:** Cited primary sources + access date, options with tradeoffs, SHIP / FINISH / DEFER / KILL / GATE, clear ask-back if data is missing.

---

## 5. Default mission flow

```
Mike asks
  → Mission Planner (Grok-side brief)
  → Repo Archaeologist (search first)
  → Software Engineer or Fleet Engineer (Bravo / Claude, isolated worktree)
  → Adversarial Reviewer (Charlie / Codex, exact SHA)
  → Verifier / QA (Charlie, different task_id)
  → Foreman reports plain English + Git refs
```

- Industrial only on Mike’s explicit name (plus the stop-and-ask exception in §1.5).
- Product research may run **in parallel** and must not block code.
- One-line status asks skip Planner/Archaeologist launches; they still must not launch builders.

### De-dupe (required)

If this thread (or `task_status`) already shows the same `task_id` + SHA launch **failed or completed**, do **not** launch again because a delayed Slack “Got it — launching…” arrived. Report the existing result. “Retry once” means **one** `launch_worker` per Mike ask, not one per echo.

---

## 6. Proof schema (every specialist handoff)

Foreman must refuse a specialist claim that lacks:

- `task_id` / session id (or explicit “no session — launch failed”)
- computer + worker (e.g. Bravo/Claude, Charlie/Codex)
- Git ref actually used (`HEAD` SHA)
- commands run + verbatim outcome (or Gateway JSON)
- sessions / HELD PRs **not** touched
- PASS / FAIL / BLOCKED
- what was **not** checked

---

## 7. What to change (implementation slices — not done in this PR)

This PR is **docs only**. Do not implement the slices below until Mike picks (a) vs (b) on the PR.

### Slice A — Foreman skills / prompts only (recommended first)

Add routing that Foreman (and Claude) can load without new Slack apps or Gateway enums:

- `.claude/skills/foreman-dispatch/SKILL.md` — this document’s rules in skill form (Foreman remains the only face).
- Optional thin aliases under `.claude/agents/` **only** if they `description:`-point at existing handbook agents + this file. Do **not** copy handbook §10 into eight new agent files.
- `mira-bots/foreman/` system prompt / README pointer so the warm Grok agent loads the routing card.
- A short **mission template** (GitHub issue markdown) so state is not only in Slack. Suggested fields: objective, SHA/ref, computer, worker, do-not-touch, success criteria, proof expected.

### Slice B — standing Grok subagents for Planner / Archaeologist / Researcher

Only if Mike chooses (b). These would be **Grok-side** Cursor subagents, still not Slack bots, still not Gateway node names. Do not build B until A is in use.

### Slice C — Slack identity Option A (open, separate from specialists)

Prefer **Option A: distinct Foreman bot identity** so Foreman posts do not re-trigger the listener and do not show as Mike + “Sent using @Cursor.” Options B/C remain secondary. **Do not implement Slack identity in the specialist slice** unless Mike says so on this PR.

Related code already in tree: `mira-bots/foreman/bot.py` `_is_bot_message()` (bot_id / own user_id / bot subtypes). Live posts in this thread still showed Cursor send-as-you on some lines — treat identity as **still open**, not done.

### Slice D — Gateway (after #3568 independent review, not this PR)

Not authorized here. When Mike authorizes, in order:

1. Charlie clone must `git fetch` the review SHA (human / node unblock). Do not SSH around Gateway.
2. Independent Charlie Codex PASS on the exact #3568 SHA (HEAD has moved since `6b2b71e4` — always re-read the PR).
3. Then Mike decides merge / deploy of #3568.
4. After that: worker reply read-back; session census; fail-closed “missing object” instead of a bare worktree error; Remote Control URL only if Claude actually produced it.

### Explicitly out of this work

- New Gateway `role` enum values named after specialists
- Eight Slack bots
- Merging #3533 / #3558 / #3568
- Disturbing `REMOTE-CONTROL-VISIBILITY-001`
- PLC writes, tunnel/secret changes, VPS compose, prod `psql`

---

## 8. Asks still on Mike (do not assume)

Recorded 2026-09-04. Foreman will not start Slice A/B/C/D until answered on this PR or in #factorylm-foreman:

1. **Role map** — approve as-is, or send edits.
2. **Next slice** — (a) Foreman skills/prompts only, or (b) skills + standing Grok subagents for Planner / Archaeologist / Researcher.
3. **Slack identity** — Option A now vs keep posting-as-you for now.

Foreman default recommendation if Mike wants a default: **approve the map, start with (a), keep Option A as the Slack goal but not in this first slice.**

---

## 9. For Claude (building this with Foreman)

You are a **worker**, not a second Foreman face. Foreman stays the Slack/Mike conversation.

When implementing Slice A (only after Mike says (a) or “implement the routing card”):

1. Re-read this file and handbook §7 / §10. Do not duplicate those agents.
2. Isolated worktree. Conventional commits. Draft PR. Do not merge.
3. Do not change Gateway schemas or `launch_worker` role enums.
4. Do not stop, message, or adopt `cao-REMOTE-CONTROL-VISIBILITY-001-3a81ed0a` or `cao-SAFE-LEGACY-SESSION-ADOPTION-7a4b5c48`.
5. After your SHA exists, **you do not review it**. Foreman will ask Charlie Codex against that exact SHA. If Charlie cannot provision a worktree, that is FAIL, not a reason to self-review.
6. Proof: files added, SHA, tests if any (docs-only is OK), what you did not touch.

Foreman will report to Mike in plain English with Git refs.
