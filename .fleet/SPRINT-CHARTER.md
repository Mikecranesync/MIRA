# FactoryLM Fleet — 5-Hour Autonomous Product Sprint

**Window opened:** 2026-08-31 ~13:20Z (Mike unavailable ~5h). **Coordinator:** Charlie
(this session, `fleet-001-review-e9`). **Charter author:** Mike, verbatim below.

---

Mike is unavailable for approximately five hours.

Use this window for autonomous FactoryLM product development, not infrastructure expansion.

## Primary objective

Continue the ChatGPT-class FactoryLM unification program using the proven fleet workflow:
Bravo implements → Charlie independently reviews → Bravo corrects → Charlie verifies →
coordinator records result

The fleet must continue working without requiring Mike unless a genuine human-only gate is
reached.

## Priority 1 — Complete FLEET-002

Finish persisted safetyNotice client rendering.

Acceptance: safety identity survives persistence and hydration; reloaded safety hard-stops
render distinctly; applicable web/mobile surfaces preserve the same semantics; ordinary-answer
affordances do not incorrectly appear; streaming/truncation truth remains intact;
evidence/citation behavior is not regressed; relevant Vitest suites pass; `npx tsc --noEmit`
introduces zero new touched-file errors; Charlie independently verifies the durable commit.

If successful: push the branch; open/update a HELD PR; do not merge; record final evidence in
`.fleet/`.

## Priority 2 — Select the next product slice automatically

After FLEET-002 passes, inspect: ChatGPT-class UI PRD; ADRs; PRs #3514, #3515, #3516; current
main; existing `.fleet/` handoffs; unresolved acceptance criteria.

Choose the highest-value coherent unblocked slice that: advances the ChatGPT-class interface;
does not duplicate another active lane; requires no Mike decision; can be independently tested;
can remain safely HELD.

Prefer finishing existing partially implemented functionality over starting new architecture.

Examples: remaining hydration/persistence parity; attachments/upload plumbing; composer
behavior; streaming/Stop correctness; citation/evidence presentation; Notebook conversation
parity; accessibility/keyboard behavior; mobile/web semantic parity; regression tests for
previously discovered defects.

Do not invent a new product direction.

## Priority 3 — Repeat the fleet loop

For each additional slice: assign a new fleet task ID; create a fresh worktree from current
remote state; Bravo implements; run targeted tests; run applicable type checking/build gates;
create durable Git + handoff state; Charlie independently attempts to disprove the change;
route BLOCKING/IMPORTANT findings back to Bravo; correct; Charlie re-verifies; push the branch;
open a HELD PR if the slice is independently proven. Do not merge.

## Autonomous actions allowed

fetch remote Git state; create branches/worktrees; edit product code; write tests; run
tests/builds/type checks; run Claude/Codex workers; checkpoint sessions; compact/reconstruct
workers through Git + handoff; push feature/rescue branches; open HELD PRs; add PR comments;
update `.fleet/` task state; write documentation directly supporting completed work; perform
independent code review; inspect GitHub PR/check state from an authenticated node.

## Actions forbidden while Mike sleeps

Do NOT: merge PRs; deploy production or staging; trigger production-changing workflows; change
Doppler/credentials/secrets; rotate keys; change Tailscale/networking; install or upgrade fleet
infrastructure; change CAO architecture; modify Ansible desired state beyond already-approved
read-only planning; register CI runners; delete worktrees; prune Docker; delete
backups/logs/artifacts; alter Ignition; touch COM3, PLC, GS10, or other physical equipment;
install an APK on Mike's phone; make release-signing decisions; rewrite pushed history; resolve
ambiguous dirty work by guessing.

If one of these becomes necessary, record the blocker and move to another safe task.

## Blocked-work fallback

If the current product slice is blocked on Mike: do not idle. Move to the next safe activity
in this order: add missing regression tests around proven defects; independently inspect
another HELD ChatGPT-class UI slice; identify reusable historical implementation from Git
history; improve acceptance/evidence coverage; document an evidence-backed implementation plan
for the next slice; perform read-only repository archaeology.

Do not start speculative rewrites.

## Resource policy

Bravo remains primary Builder. Charlie remains independent reviewer/coordinator. Do not
overload Charlie with build artifacts because disk is constrained. Use Bravo for heavy
implementation/build work. Treat provider readiness separately from CAO health. Do not rely on
a single long Claude conversation; workers are disposable and Git + `.fleet/` are authoritative.

## Quality doctrine

For relevant mira-hub changes: Vitest green alone is insufficient. Run: relevant tests;
`npx tsc --noEmit`; appropriate build/CI-equivalent checks. Always distinguish newly introduced
failures from pre-existing baseline failures. Never trust an agent saying "done" without
inspecting the durable commit and gates.

## End-of-window deliverable

One consolidated report when Mike returns: Completed; HELD PRs (number, branch, purpose,
verdict); Charlie findings; Corrections; Tests (actual results); Product progress (user-visible
change); Fleet health (only meaningful issues); Human decisions waiting (short, prioritized);
Recommended next task (one). No flood of session transcripts.

## Final instruction

For the next five hours, behave like an autonomous engineering team with Mike as an
unavailable product owner. Keep producing safe, reviewable, independently verified FactoryLM
product progress until the window ends or every remaining task requires human authority.

---

## Coordinator's operating notes (added by Charlie, not part of Mike's charter text)

- **Collision discipline is non-negotiable.** Before dispatching ANY new slice: `git fetch
  origin`, `gh pr list --state all`, `git ls-remote --heads origin | grep -i fleet`, AND
  `git worktree list` (other peer sessions on this same box run parallel fleet work — a
  collision already happened once this window; see `.fleet/SPRINT-LOG.md` entry for FLEET-002).
- **Mobile (`mira-mobile/`) and `labs/chat-spike` are permanently off-limits** — PR #3516 and
  #3515 are separate, mature, active lanes. Do not touch either directory for any slice in this
  sprint.
- **ADR-0038/0039 are Proposed, not Accepted.** "Phase 1: vertical slice" (the assistant-ui
  rewrite) is NOT in scope for this window — that is architecture-affecting work requiring
  Mike's decision. Stay in the existing typed-contract system (additive `evidence[]` entries,
  existing SSE frame kinds), not the future protocol.
- **NodeChat/AssetChat use a different, untyped SSE dialect** with their OWN existing
  safety-alert system (`@/lib/agents/safety-alert`, `matchSafetyStop`/`scanBoth`/
  `handleSafetyAlert` — the H4 gap-admission net, #2542) — a different codebase-wide pattern
  than Notebook chat's typed `NotebookSafetyFrame`/`SafetyNoticeEntry`. Bringing them to full
  parity is a bigger, under-scoped effort — do NOT attempt it live in this window without a
  dedicated investigation slice first. Documented as a **candidate for future scoping**, not
  built this window.
