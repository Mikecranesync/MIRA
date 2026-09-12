# FactoryLM Agent & Fleet Standard

**Status:** Proposed canonical fleet standard  
**Scope:** Alpha, Bravo, Charlie, Travel Laptop, PLC Laptop, VPS, Claude, Codex, and future agents  
**Objective:** Maximize verified product progress per token while making any supported agent able to continue FactoryLM work from repository state rather than private conversation history.

## 1. Non-negotiable principle

The **repository is the brain; the agent is replaceable compute**.

A fresh Claude, Codex, or future coding agent must be able to enter a clean task worktree, read a small set of canonical artifacts, discover only the code context it needs, implement a bounded task, verify it, and hand off without needing the previous agent's chat history.

We standardize **behavior and authority**, not operating-system paths or hardware. Mac and Windows machines may have different shells, container runtimes, or hardware roles; those differences are overlays, not separate engineering systems.

## 2. Canonical source-of-truth order

When sources disagree, use this precedence and report the conflict:

1. Current Git commit and source/tests.
2. Root `AGENTS.md`.
3. Provider-neutral engineering standard under `docs/agent-standard/`.
4. Spec Kit constitution and active feature artifacts under `.specify/` / `specs/` once installed.
5. Current architecture/ADR documents.
6. `wiki/hot.md` for short-lived current state.
7. Relevant Obsidian `wiki/` references/runbooks.
8. CodeGraph for structural code discovery and impact.
9. Machine overlay in `wiki/nodes/<node>.md`.
10. Provider-specific adapter (`.claude/`, Codex configuration, etc.).

Conversation history is **context**, never authoritative project state.

## 3. Framework

Use **GitHub Spec Kit** as the provider-neutral work-contract framework.

Target lifecycle:

`constitution -> specify -> clarify -> plan -> tasks -> analyze -> implement -> converge`

Do not create a second custom planning framework. Until Spec Kit is installed in a reviewed PR, use the same artifact semantics manually and do not claim Spec Kit is active.

### Permanent memory vs task state

- **Obsidian `wiki/`** = durable facts, decisions, runbooks, gotchas, node notes, lessons.
- **Spec Kit** = bounded feature/change contracts and acceptance criteria.
- **CodeGraph** = code structure, symbols, call paths, impact, relevant source.
- **Git/GitHub** = versioned implementation, task branches, PR evidence.
- **Tests/CI/Playwright** = proof.
- **Fleet/Gateway** = worker ownership and execution coordination.

Do not make Graphify a second code-navigation authority. Follow the repository's existing CodeGraph policy. Graphify may remain in its already-approved higher-level knowledge/analysis lane.

## 4. Provider-neutral boot sequence

For every coding task:

1. Identify node, provider, task ID, repo path, branch/worktree, and current HEAD.
2. Confirm you are not inside another agent's owned task/worktree.
3. Read root `AGENTS.md`.
4. Read this standard.
5. Read `wiki/hot.md` only for current cross-project state.
6. Read the active spec/task contract.
7. Read only ADRs/architecture documents referenced by that contract.
8. Run the existing CodeGraph preflight for non-doc coding tasks.
9. If CodeGraph is READY, use `codegraph_context` before grep/file-by-file exploration.
10. Implement the smallest change satisfying acceptance criteria.
11. Run the required verification.
12. Record exact evidence and handoff state.

Do **not** read six months of history “just in case.”

## 5. Context/token rules

Agents MUST:

- Prefer existing code, installed dependencies, platform features, and mature OSS before new infrastructure.
- Use CodeGraph to locate relevant code before broad file reads.
- Avoid re-reading source already returned by CodeGraph unless validating a known blind spot.
- Load only the active spec and directly referenced architecture.
- Use one research pass; do not have multiple agents independently rediscover the same facts unless independent review is the explicit task.
- Keep summaries fact-dense and discard narrative history after durable state is written.
- Stop when acceptance criteria are met. Do not “improve nearby things.”
- Escalate architectural uncertainty rather than spawning speculative subsystems.

### Product-yield metric

Track when practical:

- model/provider
- node
- task ID
- input/output tokens or best available estimate
- wall time
- files/LOC changed
- existing components reused
- acceptance criteria passed
- review defects
- rework required

Primary metric: **tokens per accepted requirement**, not tokens per session.

## 6. Work ownership

One writable task has:

- one task ID
- one owned worktree
- one branch
- one current writer

Machine names are nodes, not worker identities. Worker naming should remain provider + session number on the node.

Never:

- change another active session's branch
- reuse another writer's worktree
- force-clean another session's files
- stop an unowned session
- merge/deploy merely because implementation is complete

If ownership is ambiguous, fail closed and report it.

## 7. Git/worktree behavior

- Prefer task-specific worktrees for writable work.
- Do not develop directly in a shared canonical checkout.
- Do not switch branches in a checkout that may be serving another session.
- Fetching is observational; rebasing, resetting, branch switching, worktree pruning, merging, deploying, and deleting are mutations requiring the appropriate task authority.
- Do not auto-update an active worktree merely to “standardize” it.
- A machine that is behind main is **not** automatically defective; record drift and update only through the safe workflow.

## 8. Configuration parity

The shared configuration belongs in Git.

Provider-neutral rules belong in:
- `AGENTS.md`
- `docs/agent-standard/`
- `docs/architecture/`
- `docs/adr/`
- Spec Kit artifacts

Claude-specific integration belongs in `.claude/` but must not contain unique architectural truth.

Codex-specific integration must point to the same provider-neutral truth.

Machine-local configuration may contain:
- credentials
- absolute local paths
- hardware-specific settings
- shell/runtime differences
- local caches/indexes

Machine-local configuration MUST NOT contain the only copy of:
- product architecture
- acceptance criteria
- engineering principles
- deployment policy
- code ownership rules

Secrets never enter committed standardization files.

## 9. Required functional capabilities

Every general development node should be able to provide or access:

- Git repository and GitHub authentication
- canonical `AGENTS.md`
- provider-neutral standards
- current Obsidian/wiki content
- CodeGraph or a documented remote/CLI path to the same index capability
- active spec/task artifacts
- test commands required by the touched subsystem
- one supported coding agent

Not every node needs identical local services. Hardware/deployment nodes keep their designated roles.

## 10. Verification contract

No agent may claim **fixed, tested, working, synchronized, standardized, installed, merged, deployed, or ready** without evidence.

Every closeout must report:

### Current state
Node, provider, task, branch/worktree, exact HEAD.

### What changed
Files/configuration changed and why.

### Verification
Commands/checks actually run and outcomes.

### Remaining differences
Anything preventing parity.

### Blockers
What cannot safely be changed by the current agent.

### Decision required
Only decisions that genuinely require the human.

### Best next action
One concrete continuation step.

## 11. Machine parity definition

A machine is `STANDARD` only when:

- [ ] repository/provider-neutral instructions are accessible
- [ ] no conflicting private architecture instructions are active
- [ ] active agent can follow the same task-contract lifecycle
- [ ] code-navigation path is usable and health-checked
- [ ] Obsidian/wiki current state is accessible
- [ ] Git identity/auth works for its authorized role
- [ ] worktree ownership rules are followed
- [ ] verification commands for its role are available
- [ ] secrets stay local/managed
- [ ] machine-specific deviations are documented
- [ ] parity evidence is recorded at an exact commit

Use `PARTIAL` when optional role-specific capabilities differ. Use `FAIL` only for a difference that prevents safe execution of the node's intended role.

## 12. Anti-drift rule

When an agent discovers a machine-specific workaround:

1. Decide whether it is truly machine-specific.
2. If universal, fix the canonical repo standard instead of copying the workaround to five machines.
3. If machine-specific, record it in the node overlay and keep canonical behavior unchanged.
4. Do not paste the same policy into multiple files; link to this standard.

## 13. Standardization stop conditions

Stop and report instead of mutating when:

- another active worker owns the affected worktree/session
- change would modify production/deploy state
- credentials or secrets would need to be copied into Git
- the action would alter PLC/industrial hardware
- required authority is unclear
- canonical sources materially disagree
- “making machines identical” would remove a valid role-specific capability

The target is **same engineering behavior, different legitimate hardware roles**.
