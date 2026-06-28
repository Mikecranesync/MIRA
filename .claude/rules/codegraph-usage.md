# CodeGraph Usage

CodeGraph is the SQLite semantic index of the MIRA codebase (symbols, edges,
files, call paths). It is wired into every Claude Code session via the
`codegraph` MCP server in `.mcp.json`. Reference: `wiki/references/codegraph.md`.

**CodeGraph is the one and only code-navigation graph for this repo.** Graphify
is explicitly excluded from code navigation — see `.claude/rules/graphify-excluded.md`.

These rules govern **when** to use CodeGraph vs. grep / Read, and — equally
important after the 2026-06 corruption episode — **when to trust its results.**
They complement `karpathy-principles.md` (think before coding, surgical changes).

## Trust model — earned, not assumed

The old doctrine was "trust CodeGraph because it's AST-based." That is **wrong**
for the call-graph: the incremental watcher silently dropped call edges, and
`status`/`sync` reported "healthy" the whole time (`resolve_uns_path` → 0 callers
when the truth was 20). See `docs/tech-debt/2026-06-09-codegraph-evaluation.md`.

New doctrine: **use CodeGraph first, but trust call-graph results (`callers`,
`callees`, `trace`, `impact`) only after freshness + health pass.**

1. **Run the preflight before any non-doc coding task.**
   `tools/codegraph-preflight.sh ["task description"]` — checks install, MCP,
   index presence, freshness (source files newer than the index), the sync
   marker, and the corruption canary, then prints a markdown report you paste
   into the PR. Verdict **READY / STALE / BROKEN**.
2. **If the preflight says STALE or BROKEN, STOP and fix it first** —
   `npx -y @colbymchenry/codegraph sync` (fast) or `index --force` (repairs
   corruption) — then re-run. Do not trust call edges from a stale/broken index.
3. **Symbol *lookup* (`search`/`query`/`node`/`files`) is trustworthy on any
   non-broken index** — that layer never corrupted. It's the *call-graph* layer
   that needs the freshness gate.
4. **Periodic benchmark:** `tools/codegraph-benchmark.sh` is the heavier,
   fail-loud regression suite (run in CI / after upgrades / when something looks
   off). Preflight = per-task gate; benchmark = periodic confidence check.

## Rules

1. **CodeGraph is the primary exploration tool.** For any "how does X work",
   "where is Y", "what calls Z", "what would breaking W impact" question, the
   first 1–3 tool calls MUST be CodeGraph. Reach for `Grep` / `Read` only for
   details CodeGraph didn't cover (a specific string match, a comment, a
   line-level detail in a file CodeGraph already pointed you at).

2. **Use `codegraph_context` FIRST to map any task area.** Before editing,
   designing, or even diagnosing a feature, call `codegraph_context` with the
   task description. It composes search + node + callers + callees in one call.

3. **Use `codegraph_impact` BEFORE editing `engine.py` or any shared module.**
   Modules in scope: `mira-bots/shared/engine.py`,
   `mira-bots/shared/inference/router.py`, `mira-bots/shared/uns_resolver.py`,
   `mira-bots/shared/citation_compliance.py`, `mira-bots/shared/guardrails.py`,
   `mira-crawler/ingest/uns.py`, `mira-mcp/server.py`, or any module >5 files
   import. If the impact list is non-trivial, surface it in the PR.
   **Caveat:** `impact`/`callers` on a **class** are blind spots — see below.

4. **Never ignore a blast-radius warning.** If `codegraph_impact` returns a
   symbol you weren't expecting to touch, stop and decide explicitly whether the
   change should propagate there. If not, narrow it before continuing.

5. **Use `codegraph_trace` for "how does X reach Y" questions.** Trace handles
   dynamic-dispatch hops (callbacks, async workers, FSM transitions) grep can't
   follow.

6. **Use `codegraph_explore` for multi-symbol surveys.** One capped call for
   several related symbols. Don't loop `codegraph_node` or `Read`.

7. **Do NOT re-read files CodeGraph already returned source for** — except to
   validate a known blind spot (below). The `node`/`explore` responses include
   the symbol body.

8. **Run `codegraph sync` after major branch operations.** `.githooks/post-merge`
   and `.githooks/post-checkout` do this automatically (then run the canary and
   write a `.codegraph/.last-sync` freshness marker). After cherry-picks or
   hand-edits without those hooks, run `npx -y @colbymchenry/codegraph sync`
   manually. The watcher debounces ~500 ms after edits — don't query immediately
   after a `Write`.

9. **Skip CodeGraph only when it cannot help** — plain-text searches in comments,
   prompts, markdown, log lines, env vars, shell scripts (`Grep`), and inspecting
   a fresh never-seen file (`Read`). Anything *symbol-shaped* goes to CodeGraph
   first.

10. **Trust CodeGraph's lookup output; verify its call-graph against the blind
    spots.** `kind` / file / line / signature / symbol body are reliable on any
    non-broken index — don't re-grep those. But `callers` / `callees` / `trace` /
    `impact` are subject to the blind spots in the next section: for those, the
    index is authoritative ONLY for the cases it actually models.

11. **If CodeGraph and grep disagree, that's a benchmark-worthy defect — document
    it.** When grep finds a relationship CodeGraph misses (or vice-versa) that
    isn't a known blind spot, treat it as a real index defect: note it in the PR,
    and if reproducible, add a case to `tools/codegraph-benchmark.sh` and/or file
    upstream (`colbymchenry/codegraph`). Don't silently pick one and move on.

## Known blind spots — verify these with grep (do NOT trust CodeGraph alone)

These are real limitations that persist even on a fresh index (confirmed in the
2026-06-10 re-benchmark). The preflight prints them; honor them:

1. **Class instantiation `ClassName()` is not a caller edge.** `callers <Class>`
   returns 0 even when the constructor is called from many sites
   (`Supervisor` → 0 vs 26 real `Supervisor(...)` sites). **For class
   blast-radius, cross-check `grep -rn 'ClassName('`.** Upstream:
   `colbymchenry/codegraph#774`.

2. **`impact <Class>` returns containment, not dependents.** It lists the class's
   *own* members, not the code that depends on it — the opposite of "blast
   radius" for a class. Use `callers` on the constructor/instantiated name **plus
   grep** instead. This directly qualifies rule #3 for classes.

3. **Import-alias calls aren't resolved.** `from m import f as _f` then `_f(...)`
   → `callers f` returns 0. Grep the alias name.

4. **Same-name symbols can't be scoped.** `callers`/`callees`/`trace` union across
   every definition sharing a name (`resolve_uns_path` is defined twice;
   `process`, `__init__`, `_make_result` collide widely). The MCP tool tags this
   "aggregated across N symbols" — you cannot scope to one def. Grep the specific
   file when it matters.

When a result depends on any of the above, the honest answer is CodeGraph **plus**
a targeted grep — say so in the PR's "manual checks" line.

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

- ❌ Trusting `callers`/`callees`/`trace`/`impact` without a passing preflight
  (stale index silently returns 0/wrong).
- ❌ Calling `Grep` for a symbol name before trying `codegraph_search`.
- ❌ Looping `codegraph_node` over a list — use `codegraph_explore`.
- ❌ Editing `engine.py` without a prior `codegraph_impact` on the target.
- ❌ Re-reading a file CodeGraph already returned the relevant source from.
- ❌ Treating `impact <Class>` output as the class's dependents (it's containment).
- ❌ Using Graphify to answer a codebase question — excluded
  (`.claude/rules/graphify-excluded.md`).
- ❌ Delegating CodeGraph lookups to a sub-agent — the index is pre-built.
- ❌ Querying CodeGraph immediately after a `Write` — wait ~500 ms or `sync`.

## Cross-references

- `wiki/references/codegraph.md` — full reference (real CLI usage, preflight,
  benchmark, hooks, rollback)
- `.claude/rules/graphify-excluded.md` — Graphify is excluded from code navigation
- `tools/codegraph-preflight.sh` — per-task navigation gate
- `tools/codegraph-benchmark.sh` — periodic fail-loud regression suite
- `docs/tech-debt/2026-06-09-codegraph-evaluation.md` + `…2026-06-10-codegraph-rebenchmark.md`
