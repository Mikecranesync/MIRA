# Autonomous Run Plan — Technician Beta Recovery, Workstream A

**Date:** 2026-08-29  
**Branch:** `codex/technician-beta-recovery-a`  
**Base:** `origin/main` at `89adee90b3ebb31b5117a5cfa23341ce90ff239e`  
**Operator:** Claude Code, supervised by Codex  
**Approved PRD source:** `C:\Users\hharp\Documents\GitHub\MIRA\docs\prd\2026-08-29-technician-beta-recovery-prd.md`

## Objective

Deliver **Workstream A only** from the approved Technician Beta Recovery PRD: make private-source retrieval coherent and testable for the synthetic design-partner gate. Produce a small, merge-ready PR with failing-before/green-after evidence and no production mutations.

## Required sequence

1. **Preflight and establish authority**
   - Read the approved PRD in full, repository instructions, relevant module instructions, and current architecture/retrieval docs.
   - Copy the approved PRD into this worktree at `docs/prd/2026-08-29-technician-beta-recovery-prd.md` without changing its approved product decisions.
   - Confirm the branch/worktree, hooks, production guard, clean starting diff, and relevant tests.
   - Review current retrieval/upload/chat authority paths and document the defect seam before editing implementation.
   - Treat open PR #3477 (`fix/3442-superseded-chat-scope`) as an active ownership boundary.

2. **Write regression tests first**
   - Encode all 11 Workstream A acceptance cases from the PRD.
   - Prefer new or clearly non-overlapping test files.
   - Demonstrate the production defect with focused failing tests before implementation. Preserve the exact red-test evidence in the handoff.
   - Include tenant isolation, unapproved/private-source denial, stale/superseded IDs, empty/mixed scope, approved current versions, and the existing beta NodeChat path required by the PRD.

3. **Implement the smallest coherent fix**
   - Use the PRD's preferred authority model: server-derived approved source document IDs at the retrieval boundary.
   - Keep tenant/factory/equipment authorization fail-closed.
   - Do not globally verify or broaden trust for private uploads.
   - Do not change public/global/manual trust semantics beyond what the tests and PRD require.
   - Avoid refactors not necessary to establish one source of truth for Workstream A.

4. **Prepare safe historical-repair support if required by the PRD**
   - Any repair/backfill must default to dry-run, be tenant-scoped, emit counts/evidence, and require a separate explicit apply action.
   - Do not run mutation mode against production or any shared environment.
   - If no repair is required after investigation, document why and provide detection/preflight evidence instead.

5. **Verify and hand off**
   - Run focused unit/integration tests, the relevant beta NodeChat coverage, type checking, and lint/static checks proportionate to changed packages.
   - Re-run the exact regression suite green and preserve command/output evidence.
   - Review the final diff for tenant widening, hidden fallback behavior, secrets, production endpoints, and unrelated changes.
   - Create/update `HANDOFF.md` with: root cause, changed files, red/green evidence, remaining risks, PR #3477 integration note, and exact follow-up commands.
   - Commit in coherent conventional commits, push the branch, and open a merge-ready PR if all gates pass. Do not merge it.

## Explicitly out of scope

- `mira-hub/src/lib/equipment-notebooks.ts`
- `mira-hub/src/lib/__tests__/equipment-notebooks-domain.test.ts`
- Any file substantively owned by open PR #3477 unless the session stops and obtains a new integration decision
- Workstreams B, C, D, or E
- Mobile UI/Expo changes
- Machine memory, knowledge graph, technician feedback, or analytics work
- Production deploys, shared-environment mutations, Doppler `prd` access, raw production SQL, or hardware changes
- Authentication redesign, new trust classes, global source verification, cross-tenant widening, or security-policy changes
- Archived/deferred modules unless needed only as read-only historical context
- Merging the PR

## Hard stops

Stop implementation and write `HANDOFF.md` if any of these occur:

- The defensible fix requires editing the two PR #3477-owned files or otherwise conflicts with that PR.
- Acceptance requires changing tenant isolation, authorization policy, trust semantics, or another security/product decision not already settled in the PRD.
- A required test can only pass using production data, a production mutation, hidden fallback, or disabled guard.
- Repository state or hooks do not match the asserted branch/worktree and cannot be made safe without operator authority.
- Existing unrelated failures prevent credible red/green evidence after focused isolation.

## Success criteria

- The approved PRD is present on the branch unchanged in substance.
- All 11 Workstream A acceptance cases exist as automated tests.
- New tests demonstrably fail for the expected reason before implementation and pass afterward.
- Retrieval derives the effective approved source scope server-side and fails closed for unauthorized, stale, empty, or cross-tenant scope.
- No private upload becomes globally verified or accessible outside its authorized tenant/factory/equipment context.
- Existing beta NodeChat/retrieval coverage relevant to the changed path remains green.
- Relevant type checks and lint/static checks pass, or any pre-existing unrelated failure is precisely evidenced.
- The diff excludes all out-of-scope files and contains no secrets or production mutation.
- `HANDOFF.md`, conventional commits, pushed branch, and a merge-ready unmerged PR exist.

## Operator notes

- The autonomous-run skill refers to `.Codex/settings.json`, but this repository's current hook authority is `.claude/settings.json`. Semantic hook coverage is present there: `SessionStart`, `PreToolUse`, `PostToolUse`, and `Stop`, including `tools/hooks/prod-guard.sh` and `tools/hooks/stop-gate.sh`.
- No override variables may be introduced or enabled. In particular, keep `MIRA_ALLOW_PROD` and `MIRA_SKIP_STOP_GATE` unset.
- Do not reinterpret “finish the PRD” as permission to leave Workstream A. This session ends at the Workstream A PR/handoff boundary.
