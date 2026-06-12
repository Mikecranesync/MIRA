# CodeGraph

Local-first semantic index of the MIRA codebase — **the single code-navigation
graph for this repo.** (Graphify is excluded from code navigation; see
`.claude/rules/graphify-excluded.md`.)

- **Package:** `@colbymchenry/codegraph` (npm). Running on CHARLIE: **v0.9.5**.
- **Index location:** `.codegraph/codegraph.db` (gitignored — local + regenerable, WAL + FTS5).
- **MCP:** wired into `.mcp.json` (`serve --mcp`) — every session gets the `codegraph_*` tools.

## Operating doctrine (read first)

- **Trust is earned, not assumed.** The call-graph layer (`callers`/`callees`/
  `trace`/`impact`) silently corrupted under the incremental watcher in 2026-06
  (0 callers where the truth was 20), while `status`/`sync` reported "healthy."
  **Trust call-graph results only after a freshness + health check passes.**
  Symbol *lookup* (`query`/`files`/`node`) is reliable on any non-broken index.
- **Run the preflight before non-doc code work:** `tools/codegraph-preflight.sh`.
- **Rules:** `.claude/rules/codegraph-usage.md` (when to use + trust model + blind spots).
- **History:** `docs/tech-debt/2026-06-09-codegraph-evaluation.md` (the corruption
  finding) → `…2026-06-10-codegraph-rebenchmark.md` (fix verified, D→A−).

## Real CLI usage (v0.9.5)

```bash
npx -y @colbymchenry/codegraph <command>
```

| Command | What it does |
|---|---|
| `init [-i] [path]` | Initialize CodeGraph in a project (`-i` also runs the first index) |
| `index [-f\|--force] [path]` | Index all files; `--force` rebuilds the whole graph (**repairs corruption**, ~9 s) |
| `sync [path]` | Incremental update since last index (fast; does **not** repair a corrupted edge set) |
| `status [path]` | Index stats (files / nodes / edges / db size) |
| `query <search>` | Fuzzy symbol search (kind + location + signature, ranked) |
| `files` | Project file structure from the index |
| `context <task>` | Markdown context bundle for a task (entry points + related + code) |
| `callers <symbol>` | Functions/methods that call a symbol |
| `callees <symbol>` | What a symbol calls |
| `impact <symbol>` | What changing a symbol affects (⚠ containment, not dependents, for a **class**) |
| `affected [files...]` | Test files affected by changed source files |
| `serve [--mcp]` | Run as an MCP server (this is what `.mcp.json` launches) |
| `status` / `unlock` | health / remove a stale lock blocking indexing |
| `uninit` | Remove `.codegraph/` |
| `install` / `uninstall` | Wire/unwire the MCP server into agents |

### MCP tools (in-session, no bash)

`codegraph_context` (PRIMARY orientation) · `codegraph_search` · `codegraph_callers` /
`codegraph_callees` · `codegraph_impact` · `codegraph_trace` ("how does X reach Y") ·
`codegraph_node` · `codegraph_explore` (several symbols, one call) · `codegraph_files` ·
`codegraph_status`. See `.claude/rules/codegraph-usage.md` for tool-selection rules.

## Preflight — the per-task navigation gate

```bash
tools/codegraph-preflight.sh ["task description"]
```

Checks install / MCP / index presence / **freshness** (any source file newer than
the index) / sync marker / **corruption canary**, optionally runs `codegraph context`
for the task and flags shared modules needing `impact`, lists the known blind spots,
and prints a markdown report to paste into the PR. **Verdict + exit:** `0` READY ·
`1` STALE (sync/`index --force` then re-run) · `2` BROKEN (no index / no npx).

## Benchmark — periodic fail-loud regression suite

```bash
tools/codegraph-benchmark.sh [output.md]      # default: docs/tech-debt/<date>-codegraph-benchmark.md
```

Two tiers. **Tier-1 gates the exit code:** the previously-corrupted symbols must
return correct callers (floors + known-caller-file presence), coverage resolves,
canary healthy, stale-detection logic works, MCP/CLI parity (best-effort). **Tier-2
is reported, not gating:** the known blind spots (class instantiation, import-alias,
same-name) — it fails loud only if one **regresses** (a good case breaks) or
**resolves** (limitation gone → update docs + close the upstream issue). Latest run:
`docs/tech-debt/2026-06-11-codegraph-benchmark.md`.

## Known blind spots (verify with grep)

1. **Class instantiation `ClassName()` is not a caller edge** — `callers <Class>` = 0
   despite many `Class(...)` sites. grep for class blast-radius. (upstream `colbymchenry/codegraph#774`)
2. **`impact <Class>` returns containment, not dependents.**
3. **Import-alias calls** (`import f as _f` → `_f()`) don't resolve — grep the alias.
4. **Same-name symbols** aggregate; can't scope to one def — grep the file.

## Freshness & operations (how the index is kept honest)

- **Hooks:** `.githooks/post-merge` + `.githooks/post-checkout` → `sync` → corruption
  canary (`index --force` if call edges collapsed) → write `.codegraph/.last-sync`
  marker. Non-blocking; logs to `.codegraph/hook.log`. Requires `git config
  core.hooksPath .githooks` (set on CHARLIE).
- **Daily reindex:** `tools/codegraph-force-reindex.sh` via launchd
  `com.factorylm.codegraph-reindex` (04:17) bounds watcher drift to ≤24 h. Setup:
  `tools/launchd/README.md`.
- **Corruption canary:** `tools/codegraph-canary.sh` — `callers resolve_uns_path`
  must be ≥1; 0 ⇒ auto `index --force`. Exit 0 healthy / 1 repaired / 2 failed.
- **Manual:** `npx -y @colbymchenry/codegraph sync` (light) or `index --force`
  (repairs corruption) after cherry-picks / hand-edits. Upstream bugs:
  `colbymchenry/codegraph#773` (FK edge drops) + `#774` (class instantiation).

## Rollback

```bash
npx -y @colbymchenry/codegraph uninit    # deletes .codegraph/
```

To disable the MCP server: remove the `codegraph` entry from `.mcp.json`.
