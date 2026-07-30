# CLAUDE.md Policy Changelog

## 2.0 - 2026-07-28

**Supersedes:** `98a617a9` (`chore(worktrees): make teardown an obligation + clean up on every exit path`)

### Intent

Refactor root `CLAUDE.md` from a mixed build-state encyclopedia into a compact
bootstrap policy for agentic engineering sessions. The policy remains a rule
card, while procedures and inventory live in canonical docs.

### Policy Changes

- Explicitly permits LangChain and removes the named LangChain ban.
- Removes the broader ban on "any framework that abstracts the LLM call".
- Adds framework adoption criteria: prefer direct provider calls for simple
  paths; adopt orchestration frameworks only when they reduce total complexity,
  preserve provider portability, and include tests; do not rewrite stable
  production paths solely to adopt a framework.
- Keeps LangGraph excluded unless separately approved, preserving ADR-0011 as
  the current LangGraph decision.
- Removes TensorFlow and n8n from the blanket LLM-framework prohibition. No
  standalone root ban is retained without scoped architecture or safety
  documentation.
- Preserves licensing, secrets, UNS, production, migration, Git, worktree,
  destructive-command, and security protections.
- Removes stale root-level priority language such as "no unrelated dev
  projects"; active priorities route to planning docs instead.
- Corrects provider order to Groq -> Cerebras -> Together.
- Changes the wiki obligation to: after substantive project-state changes,
  update `wiki/hot.md`.

### Content Moved From Root

| Content | Destination |
|---|---|
| Container and service inventory | `docs/architecture/container-map.md` |
| Node/network inventory | `deployment/network.yml` |
| Start, stop, promotion, hotfix, migration rules | `docs/environments.md` |
| Code-review pipeline details | `docs/agents/code-review.md` |
| Visual proof and screenshot procedure | `docs/runbooks/visual-proof.md` |
| Archived/deferred module details | `docs/known-issues.md` |
| Gotchas and session history | `wiki/hot.md`, `docs/known-issues.md` |
| Agent issue/label/domain routing | `docs/agents/` |

### Rollout Rule

Sessions started before the merge may finish only their current scoped task.
Before new work, they must update from `main`, start a fresh session, run
`/memory`, and confirm Policy revision 2.0 is loaded.
