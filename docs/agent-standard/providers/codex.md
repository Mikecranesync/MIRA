# Codex Compliance Adapter

**Provider:** Codex  
**Purpose:** Make Codex execute the same FactoryLM architecture and work contract as Claude.

Read `docs/agent-standard/FLEET_STANDARD.md` first.

## Authority

Codex must not require Claude conversation history or `.claude/`-only knowledge to work correctly.

Provider-neutral sources are authoritative:
- `AGENTS.md`
- `docs/agent-standard/`
- active Spec Kit/task artifacts
- architecture/ADR documents
- `wiki/`
- CodeGraph
- code/tests

If a critical rule exists only under `.claude/`, report `PROVIDER DRIFT` and propose a provider-neutral representation. Do not duplicate the text into a second private rule set.

## Startup contract

For every coding task:

1. identify node/session/task/worktree/HEAD
2. verify ownership
3. read `AGENTS.md`
4. read fleet standard
5. read active spec/task
6. read referenced architecture only
7. run CodeGraph preflight
8. use CodeGraph before broad search
9. implement smallest accepted delta
10. run required tests/evidence
11. close out in the canonical format

If the Codex environment does not expose the CodeGraph MCP directly, use the repository-documented CLI path rather than replacing CodeGraph with a different navigation framework.

## Token discipline

- use repository indexes instead of rediscovering structure
- no speculative whole-repo archaeology
- no duplicate research already captured in the active spec/wiki
- no unrelated cleanup
- do not keep large narrative histories in prompts
- stop at acceptance

## Review role

When reviewing Claude-authored work, evaluate the code/spec/evidence independently. Do not reject merely because Claude authored it. Likewise, do not assume correctness because another frontier model approved it.

Independent review should attack:
- acceptance coverage
- unintended blast radius
- tests that can pass without proving behavior
- architecture duplication
- lifecycle/ownership violations
- unsupported readiness claims

## Codex closeout

Return the same evidence schema as Claude, including exact SHA. No provider-specific status vocabulary is allowed to redefine PASS/FAIL/HOLD.
