# CodeGraph Usage

CodeGraph is the SQLite semantic index of the MIRA codebase (symbols, edges,
files, call paths). It is wired into every Claude Code session via the
`codegraph` MCP server in `.mcp.json`. Reference: `wiki/references/codegraph.md`.

These rules govern **when** to use CodeGraph vs. grep / Read. They complement
`karpathy-principles.md` (think before coding, surgical changes) — CodeGraph is
the "think" step's cheapest, fastest information source.

## Rules

1. **CodeGraph is the primary exploration tool.** For any "how does X work",
   "where is Y", "what calls Z", "what would breaking W impact" question, the
   first 1–3 tool calls MUST be CodeGraph. Reach for `Grep` / `Read` only for
   details CodeGraph didn't cover (a specific string match, a comment, a
   line-level detail in a file CodeGraph already pointed you at).

2. **Use `codegraph_context` FIRST to map any task area.** Before editing,
   designing, or even diagnosing a feature, call `codegraph_context` with the
   task description. It composes search + node + callers + callees in one
   call — the cheapest possible orientation.

3. **Use `codegraph_impact` BEFORE editing `engine.py` or any shared module.**
   Before any code change to `mira-bots/shared/engine.py`,
   `mira-bots/shared/inference/router.py`, `mira-bots/shared/uns_resolver.py`,
   `mira-bots/shared/citation_compliance.py`, `mira-bots/shared/guardrails.py`,
   `mira-crawler/ingest/uns.py`, `mira-mcp/server.py`, or any other module
   that >5 files import, run `codegraph_impact <target_symbol>` and read the
   blast-radius result. If the impact list is non-trivial, surface it in the
   PR description.

4. **Never ignore a blast-radius warning.** If `codegraph_impact` returns a
   symbol you weren't expecting to touch (e.g. an alias in another adapter,
   a test that depends on a private helper, a cross-module callback), stop
   and decide explicitly: do you intend the change to propagate there? If
   not, the change isn't surgical — narrow it before continuing.

5. **Use `codegraph_trace` for "how does X reach Y" questions.** Trace
   handles dynamic-dispatch hops (callbacks, async workers, FSM transitions)
   that grep + read can't follow. One trace call beats a dozen file reads.

6. **Use `codegraph_explore` for multi-symbol surveys.** When you need source
   for several related symbols (e.g. the four classifier methods, the three
   engine state handlers), `codegraph_explore` returns them in one capped
   call. Don't loop `codegraph_node` or `Read`.

7. **Do NOT re-read files CodeGraph already returned source for.** The
   `codegraph_node` / `codegraph_explore` responses include the symbol's
   source body. Re-opening the file with `Read` for the same range repeats
   work and bloats context.

8. **Run `codegraph sync` after major branch operations.** The
   `.githooks/post-merge` and `.githooks/post-checkout` hooks do this
   automatically. If you've cherry-picked, hand-edited, or used a worktree
   without those hooks active, run `npx -y @colbymchenry/codegraph sync`
   manually before the next exploration call. The file watcher debounces
   for ~500 ms after edits — don't query immediately after a `Write`.

9. **Skip CodeGraph only when it cannot help.** Plain-text searches in
   comments, prompts, markdown, log lines, env vars, and shell scripts are
   `Grep`'s job. Inspecting a fresh file you've never seen is `Read`'s job.
   Anything *symbol-shaped* (function, class, method, route, import,
   variable) goes to CodeGraph first.

10. **Trust CodeGraph's signature/kind output.** It returns `kind` (function /
    class / method / route / etc.), file path, line, and the symbol body. If
    CodeGraph says `foo` is a method on class `Bar` at `path/x.py:123`, do
    not re-verify with grep before acting — the index is built from the AST.

## When this applies

- Any task in `mira-bots/`, `mira-core/`, `mira-mcp/`, `mira-crawler/`,
  `mira-pipeline/`, `mira-bridge/`, `mira-hub/`, `mira-web/`, `mira-cmms/`,
  or any other indexed module.
- Any architecture, impact, trace, or "where is" question.
- Any pre-edit orientation on a module touched by >1 caller.

## When this does NOT apply

- Pure documentation edits (`docs/`, `wiki/` markdown).
- Pure config edits (`docker-compose*.yml`, `.env*`, `pyproject.toml`).
- One-line fixes to a file you just opened from a stack trace.
- Searching prompt text, log strings, or test fixtures — `Grep` is correct.

## Anti-patterns to avoid

- ❌ Calling `Grep` for a symbol name before trying `codegraph_search`.
- ❌ Looping `codegraph_node` over a list — use `codegraph_explore`.
- ❌ Editing `engine.py` without a prior `codegraph_impact` on the target.
- ❌ Re-reading a file CodeGraph already returned the relevant source from.
- ❌ Delegating CodeGraph lookups to a sub-agent — the index is pre-built;
  spawning an exploration agent just re-does the work CodeGraph already did.
- ❌ Querying CodeGraph immediately after a `Write` — wait ~500 ms or run
  `codegraph sync` first.
