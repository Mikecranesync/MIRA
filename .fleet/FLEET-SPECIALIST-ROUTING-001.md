# FLEET-SPECIALIST-ROUTING-001 — Foreman specialist subagent system (design)

**Status:** DESIGN ONLY — docs PR for Claude / fleet review. Do **not** merge, deploy, change Gateway, create agents, or disturb live sessions until Mike explicitly approves a next slice in `#factorylm-foreman`.

**Source thread:** `#factorylm-foreman` parent `1788543419.685639` (2026-09-04).  
**Repos:** Mikecranesync/MIRA.  
**Authoring role:** FactoryLM Foreman (orchestration). Claude builds; Codex adversarially reviews.

---

## 0. Non-negotiables

| Rule | Meaning |
|---|---|
| One Foreman face | Mike talks only to Foreman. Specialists are **dispatch roles**, not Slack bots and not Gateway node names. |
| Computers vs workers | Alpha / Bravo / Charlie = physical computers. Claude / Codex = workers via Fleet Gateway. |
| Done | Git + worktrees + tests + durable handoffs — never a chat claim. |
| Hard gates | No merge, deploy, delete work, credentials/networking, sign releases, PLC/Ignition/COM3/plant action, or session disturb without Mike’s explicit OK. |
| HELD | `#3533` and `#3558` stay HELD / unmerged unless Mike explicitly approves a merge. |
| Control plane | Grok → authenticated public HTTPS Fleet Gateway → loopback-only CAO. No direct Tailscale/CAO/LAN/`:9889` from Foreman. |
| Live session | Do not disturb `cao-REMOTE-CONTROL-VISIBILITY-001-3a81ed0a` (or successor) without Mike OK. |

---

## 1. How Foreman works today (inspected)

- Slack in `#factorylm-foreman` wakes Foreman (Grok).
- Fleet Gateway tools: `fleet_status`, `launch_worker`, `message_worker`, `task_status`, `request_handoff`, `request_review`, `stop_worker`.
- Workers launch Claude or Codex on a physical node in an **isolated worktree**.
- Foreman today still does planning, archaeology, review orchestration, and fleet ops in one head.
- Known holes (do not invent fixes here): no reliable worker reply read-back; `current_session` is a latest pointer not a census; Charlie worktree create fails if the SHA object is missing on Charlie; Remote Control URL not always available.

### Existing handbook specialists (reuse — do not fork)

| Already exists | Path | Job |
|---|---|---|
| Investigator | `.claude/agents/investigator.md` | Reproduce/trace. Read-only. |
| Contract architect | `.claude/agents/contract-architect.md` | Map behavior to contract IDs. Read-only. |
| Test engineer | `.claude/agents/test-engineer.md` | Red tests only. No production edits. |
| Implementer | `.claude/agents/implementer.md` | Smallest fix in isolated worktree. |
| Gate 7 adversarial reviewer | `.claude/agents/gate7-adversarial-reviewer.md` | Try to disprove the change. Read-only. |
| Safety / security / conversation reviewers | `.claude/agents/` | Independent review. Read-only. |
| Release verifier | `.claude/agents/release-verifier.md` | Prove tests/CI/deploy readiness. No state change. |
| Defect workflow | `.claude/skills/defect-workflow/` | Ordered software-defect pipeline. |
| Product orchestrator | `.claude/skills/product-orchestrator/` | Money-path scoring. Never merges. |

**Core recommendation:** Do **not** invent eight new personalities that fork that handbook. Give Foreman a **routing card** that aliases Mike’s eight names onto these agents, and add only what is missing (**Fleet Engineer**).

---

## 2. Recommended specialist role cards

Foreman decides who to call, checks proof, and talks to Mike. A builder never reviews its own work. Claims without proof are rejected.

### 1. Mission Planner

- **Owns:** Break objectives into missions/tasks; acceptance criteria; search-before-create; pick specialists/nodes; stop conditions; what “done” looks like.
- **Call when:** Any product objective or multi-step ask. **Tightening:** skip a full brief for one-line status (`fleet_status`); still write a brief before any worker launch.
- **Must not:** Write product code; merge; launch duplicate work; disturb existing sessions; treat a plan as proof.
- **Worker:** Grok-side (Foreman + read-only GitHub/Slack/Gateway). Claude only if a long planning pack needs a worktree doc.
- **Proof:** Mission brief, existing issues/PRs/sessions found, task graph, success criteria, “do not touch” list.

### 2. Repo Archaeologist

- **Owns:** “What already exists?” in Mikecranesync/MIRA (+ factorylm) before anything new is built.
- **Call when:** Before Software/Fleet Engineer; anytime “is this already done?”
- **Must not:** Implement; refactor “while here”; open drive-by PRs; guess node-local state it cannot read.
- **Worker:** **Tightening:** search GitHub / this checkout first. Bravo Claude only if the answer lives on that machine (worktree, `~/.claude/sessions`).
- **Proof:** Paths, SHAs, PR/issue links, reuse-vs-new recommendation; what *not* to recreate.

### 3. Software Engineer

- **Owns:** MIRA/app feature implementation in isolated worktrees. Maps to **implementer**, not a generic coder. Tests stay with Test Engineer.
- **Call when:** Mission Planner + Archaeologist say build is needed and red tests/contracts exist (or are in flight per defect workflow).
- **Must not:** Be its own only reviewer; merge/deploy; touch PLC/Ignition; expand scope.
- **Worker:** Claude on Bravo (default). **Tightening:** may run tests but does **not** own the only test write or the only review. Alpha is last-resort computer only if Mike says that mission may use it.
- **Proof:** Branch, commits, tests/typecheck, draft PR, handoff artifact (SHA, files/symbols, contract IDs, remaining risk, what was left unchanged).

### 4. Fleet Engineer

- **Owns:** The missing specialist today. Fleet Gateway MCP, CAO adapters, node wiring, allowlisted tools — still via public HTTPS Gateway only. Alpha/Bravo/Charlie as computers.
- **Call when:** Gateway/orchestration infra (not product features); launch/status/adopt/stop; Remote Control visibility; Charlie fetch/provision failures.
- **Must not:** Expose CAO/LAN/SSH; invent fake session URLs; merge HELD `#3533`/`#3558`; change credentials/networking without Mike; disturb sessions Mike did not name.
- **Worker:** Claude on Bravo for Gateway worktrees; Charlie Codex reviews the exact SHA. Node worker only for a named, allowed node action after Mike approves that class of action.
- **Proof:** Gateway tests, draft PR, raw Gateway JSON plus “touched / not touched”; `fleet_status` after any **approved** restart.

### 5. Adversarial Reviewer

- **Owns:** Try to *disprove* a named SHA (bugs, safety, contract lies, missing tests). Maps to Gate 7 + Charlie `request_review`.
- **Call when:** A draft PR or exact SHA is claimed ready; before Mike decides merge.
- **Must not:** Edit; approve from the author’s summary; merge; review the same session/machine that built it; trust Bravo chat summaries.
- **Worker:** **Hard rule:** Codex on Charlie against the exact SHA. If Codex built it, Claude reviews. Different machine from the builder.
- **Proof:** PASS or BLOCK; SHA actually checked out; findings with `file:line`; tests that ran; NOT REVIEWED. No session / no checkout = **FAIL**. Durable artifact only (PR review comment, HANDOFF, or `task_status` citing the SHA). Note: `#3568` was review-blocked when Charlie could not create a worktree; HEAD moved after the FAIL — do not treat old SHAs as current.

### 6. Verifier / QA

- **Owns:** Re-run acceptance checks against Git artifacts (tests, commit-match, handoff completeness). Maps to release-verifier + mechanical pytest. Different from the person who wrote the tests.
- **Call when:** After a review PASS, or when Mike asks “is it actually done?” / before any merge/deploy decision.
- **Must not:** Rewrite product code to “make green”; merge/deploy; treat a skipped CI job as a pass.
- **Worker:** Codex for hermetic pytest (or Claude on Charlie with a **separate `task_id`** from Adversarial Reviewer). Read-only verifier for CI and probes Mike authorizes.
- **Proof:** Exact command, pass/fail counts, failing names, CI run URL, SHA verified, and that the test actually executed. Honest limit: live `task_status` often shows `tests: not_run` with no log body — “done” means the verifier’s own command output plus the SHA it ran.

### 7. Industrial & Robotics Engineer

- **Owns:** PLC, fieldbus, motion, LOTO, UNS, advisory-vs-control; Ignition/COM3/robotics **design** notes and *planned* control work. Uses existing safety/PLC skills.
- **Call when:** **Only if Mike explicitly names** industrial/robotics scope. Exception: if a Bravo diff already touches PLC/Ignition/hardware, Foreman **stops and asks** — does not silently continue and does not touch the plant.
- **Must not:** Write PLC/OT; claim equipment is safe; bypass interlocks; act as a safety function; touch live PLC/hardware; change plant networking; treat simulation as plant proof. MIRA stays advisory.
- **Worker:** Claude + separate safety reviewer. Not Codex as the only reader. Physical/specialized nodes only with Mike’s explicit approval (still out of default fleet).
- **Proof:** Hazard class (S0–S5), advisory vs control, citations, approve / approve-with-conditions / block, and “needs Mike OK before physical.” Never a silent plant action.

### 8. Product Researcher

- **Owns:** Market, ICP, BOM/sourcing, ship vs defer, competitive/research briefs, “should we build this?” Reuses product-orchestrator. Keep BOM/sourcing inside this role for now; split later if volume grows.
- **Call when:** Scope, buy-vs-build, vendor parts, pricing/sourcing, or “does this get a stranger to pay?”
- **Must not:** Write product/production code; open infra PRs; treat a blog as doctrine; invent metrics without sources; merge.
- **Worker:** Foreman or read-only Claude. No fleet coding session unless the source is only on that machine. Web (+ later HubSpot/Drive when connected).
- **Proof:** Primary source + date; SHIP / FINISH / DEFER / KILL / GATE (or options with tradeoffs); what would change the call; clear ask-back if data missing.

---

## 3. Default mission flow

```
Mike asks
  → Mission Planner
  → Repo Archaeologist
  → Software Engineer OR Fleet Engineer (Bravo / Claude)
  → Adversarial Reviewer (Charlie / Codex, different machine)
  → Verifier / QA (Charlie, separate task_id)
  → Foreman reports plain English with Git refs
```

- Industrial only when Mike explicitly names that scope.
- Product Research can run in parallel without blocking code.
- Local vs fleet: use Cursor/GitHub specialists when the repo is enough; launch a node worker only when the job needs that computer.
- Merge / deploy / SSH / PLC / session stop only on Mike’s explicit OK.

### Claude vs Codex convention

- **Claude** builds and does industrial/product reasoning.
- **Codex** independently reviews and re-runs tests.
- Never the same session for both.
- Prefer Bravo Claude / Charlie Codex because that is the working convention — not because the machine has a personality.

---

## 4. What Foreman recommends changing (awaiting Mike OK)

Still design — **none of this is approved production work** until Mike answers in-thread.

1. **Keep one Foreman face.** Do not create 8 Slack bots. Specialists = dispatch roles + saved prompts/skills.
2. **Do not rename Gateway nodes to specialist names.** Bravo/Charlie/Alpha stay computers. Roles map onto Claude/Codex + which computer (fixes old “role vs computer” confusion).
3. **Formalize the 8 role cards** as durable Foreman skills (generic) + a short mission template in GitHub issues so state is not only in Slack.
4. **Hard gate the default pipeline:** Planner → Archaeologist before any builder launch; Charlie Codex before “ready for Mike.”
5. **Split Adversarial Reviewer vs Verifier** even on the same Charlie box (different `task_id`s / prompts). Builder never self-approves.
6. **Industrial stays explicit opt-in.**
7. **BOM/sourcing** stays inside Product Researcher for now.
8. **Slack identity:** prefer **Option A** (distinct FactoryLM Foreman bot identity) so Foreman posts do not re-trigger the `#factorylm-foreman` listener. Options B/C remain secondary for specialists.
9. **Do not disturb** the live Remote Control visibility session while adopting this.
10. **No production changes yet** — including no new agents created, no Gateway enum changes, no merges — until Mike picks a first slice.

### Suggested first implementation slice (if Mike chooses)

- **(a) preferred:** Foreman skills/prompts only (routing card that aliases the eight names onto handbook agents). No merge, no deploy, no session changes.
- **(b) later:** skills + standing Grok subagents for Planner / Archaeologist / Researcher.
- Fleet Engineer is the only net-new specialist content; do not duplicate `.claude/agents/`.
- De-dupe launches: “retry once” after a documented FAIL must not re-launch without a new unblock (example: Charlie missing object → fetch first).
- Gateway follow-ups **after** independent review of related drafts (e.g. `#3568`): worker reply read-back; session census; fail-closed “Charlie missing object X”; Remote Control URL only if Claude actually produced it.
- Charlie must have the exact SHA before another review launch.

---

## 5. Proof schema (every handoff)

Every specialist return must include at least:

- Exact SHA / ref checked out (or “not checked out”)
- Commands run + pass/fail
- Session IDs touched / not touched
- PASS / FAIL / BLOCKED / NOT REVIEWED
- Paths / PR numbers / artifact paths
- Remaining risk and what was left unchanged

---

## 6. Asks still on the table for Mike

Reply in the Slack thread (or on this PR) with:

1. **Role map** — approve as-is, or send edits.
2. **Next slice** — (a) Foreman skills/prompts only, or (b) skills + standing Grok subagents for Planner / Archaeologist / Researcher.
3. **Slack identity** — Option A (distinct Foreman bot) vs keep posting-as-you for now.

Foreman default recommendation if Mike wants a default: approve the map, start with **(a)**, keep Option A as the Slack goal without doing it inside the first skills-only slice.

---

## 7. Explicit non-actions for this PR

This PR adds **documentation only**. It does **not**:

- Create agents or change Gateway enums
- Merge or deploy anything
- Launch Bravo/Charlie workers
- Touch `REMOTE-CONTROL-VISIBILITY-001` or other live sessions
- Change credentials, networking, Tailscale, CAO, or plant systems
- Un-HOLD `#3533` / `#3558`

---

## 8. Audience note for Claude

Claude: treat this file as the durable Foreman design brief. When implementing the next approved slice, search existing `.claude/agents/` and `.claude/skills/` first, wire a routing card rather than duplicating personalities, keep builders off self-review, and return Git-proofed handoffs. Coordinate with Foreman; do not merge without Mike.
