# MIRA — Claude Code adapter

@AGENTS.md

Everything about **what FactoryLM/MIRA is, how it is built, and how work is done here** lives in
`AGENTS.md` (imported above) and the documents it points at. This file adds only what is specific
to Claude Code as a tool. If a line here would also be true for Codex, it belongs in `AGENTS.md`
or the canonical doc — not here (`docs/agent-standard/providers/claude.md`, §8 of the fleet standard).

## Product rules companion

`.claude/CLAUDE.md` is the product operating guide Claude must honor while editing (UNS gate,
grounding, KG proposal rules, environment boundaries). `.claude/rules/*.md` are loaded into every
session automatically; the index of when each applies is in `.claude/CLAUDE.md § Rules for code
changes`, and `.claude/rules/fleet-standard.md` is the pointer back to the provider-neutral standard.

## CodeGraph through MCP

The `codegraph` MCP server is wired in `.mcp.json`; the `codegraph_*` tools are the primary way to
read code in this repo. Run `tools/codegraph-preflight.sh` before non-doc code work, start a task
with `codegraph_context`, and `codegraph_impact` before editing `engine.py` or any module imported
by >5 files. Trust `callers`/`callees`/`trace`/`impact` only on a READY index, and honor the blind
spots (class instantiation, import aliases, same-name symbols): `.claude/rules/codegraph-usage.md`.
Don't delegate CodeGraph lookups to a subagent — the index is pre-built.

## Sub-agents and worktrees

Any dispatched agent that will Edit/Write runs with `isolation: "worktree"` on the `Agent` tool,
or with explicit confirmation the shared checkout holds no foreign WIP. The harness auto-removes a
worktree only when the agent made **no** changes — so every useful worktree survives until you
remove it. Never leave one holding `main` (`--detach origin/main` instead). Verify every symbol a
subagent emits against CodeGraph before committing it. `.claude/rules/subagent-worktree-isolation.md`.

## Hooks that will stop you (by design)

Wired in the repo's `.claude/settings.json` (so they run on every node): `PreToolUse(Bash)` —
`tools/hooks/prod-guard.sh` blocks prod mutations (override, human only: `MIRA_ALLOW_PROD=1`);
`tools/hooks/git-state-guard.sh` blocks git mutators mid-rebase or on a detached HEAD except
`rebase --continue/--abort/--skip/--quit` — if a rebase wedges beyond those, stop and ask rather
than `MIRA_ALLOW_GIT_WEDGE=1` or `reset --hard`; `tools/hooks/rm-guard.sh` hard-blocks a
recursive-force `rm` resolving to `/`, `$HOME`, the repo root, or any `.git` (`MIRA_ALLOW_RM=1`).
`PreToolUse(Write|Edit)` — `tools/hooks/worktree-file-guard.sh`. `Stop` — `tools/hooks/stop-gate.sh`.
A `VERSION`/`CHANGELOG.md`/`wiki/hot.md` edit guard exists only as a **machine-local** hook on
some nodes (`~/.claude/hooks/shared-file-guard.sh`, e.g. CHARLIE); don't assume it — the rule
itself is in `AGENTS.md`. A hook is a floor, not a substitute for printing the resolved target
before a destructive command. When a hook blocks a legitimately authorized action, ask once and
act on the answer — never loop, retry verbatim, or route around it.

## Claude-only surfaces

- Skills: `.claude/skills/` (plus `/resume`, `/ship-pr`, `/ship`, `finish-capability`,
  `defect-workflow`, `autonomous-run` — invoke via the Skill tool). Commands: `.claude/commands/`.
- Agents: `.claude/agents/` — `investigator` / `test-engineer` / `implementer` /
  `contract-architect` and the conversation, safety, security, release reviewers.
- Session memory (`~/.claude/projects/…/memory/`) is *your* context, never project state; a
  discovery worth keeping goes to `wiki/` or the canonical doc.

## Maintaining this file

Keep it under ~60 lines. Facts about the project go to `AGENTS.md` (bootloader, ≤150 lines) or
the document `AGENTS.md` points at. The read-only check that the entry points stay wired:
`tools/fleet-parity-check.sh`.
