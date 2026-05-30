# CodeGraph

Local-first semantic index of the MIRA codebase for faster AI-assisted navigation.

- **Package:** `@colbymchenry/codegraph` (npm, v0.9.4 at install)
- **Installed:** 2026-05-25 on CHARLIE
- **Index location:** `.codegraph/codegraph.db` (gitignored — local + regenerable)
- **Backend:** node:sqlite with WAL journal

## Install / re-index

```bash
npx -y @colbymchenry/codegraph init -i      # first time
npx -y @colbymchenry/codegraph sync          # incremental update
npx -y @colbymchenry/codegraph index -f      # force full re-index
npx -y @colbymchenry/codegraph status        # stats
```

## Index stats (2026-05-25 baseline)

| Metric | Value |
|---|---|
| Files indexed | 1,221 (of 1,444 scanned) |
| Nodes | 18,955 |
| Edges | 35,361 |
| DB size | ~35 MB |
| Index time | ~5 s |

Languages: 744 Python · 364 TypeScript · 223 YAML · 79 TSX · 28 JS · 6 JSX.
Node kinds: 5,374 imports · 5,008 functions · 2,957 variables · 2,352 methods · 1,221 files · 874 constants · 690 classes · 275 interfaces · 135 type aliases · 69 routes.

## Useful queries

```bash
codegraph query <symbol>          # fuzzy symbol search with scores
codegraph callers <symbol>        # who calls this
codegraph callees <symbol>        # what does this call
codegraph impact <symbol>         # blast radius of changing this
codegraph affected <files...>     # tests touched by file changes
codegraph context "<task>"        # markdown context bundle for a task
codegraph files                   # project tree with per-file symbol counts
```

## MCP server

**Enabled 2026-05-25** — wired into `.mcp.json` (project-scoped, not global). Every Claude Code session in this repo gets 10 codegraph tools without bash:

| Tool | When to call |
|---|---|
| `codegraph_context` | PRIMARY — "how does X work / what's the deal with this feature" |
| `codegraph_search` | Quick name lookup |
| `codegraph_callers` / `codegraph_callees` | Caller / callee audit |
| `codegraph_impact` | Blast radius of changing a symbol |
| `codegraph_trace` | "How does X reach Y" — call path with dynamic-dispatch hops |
| `codegraph_node` | One symbol's signature/docstring + trail |
| `codegraph_explore` | Source for several related symbols in one call |
| `codegraph_files` | File/folder structure |
| `codegraph_status` | Index health |

**Anti-patterns** (per the server's own instructions):
- Don't grep first when looking up a symbol — `codegraph_search` is faster and returns kind + location + signature.
- Don't loop `codegraph_node` — use `codegraph_explore` to batch.
- Don't query immediately after editing — watcher needs ~500 ms to debounce.

To disable: remove the `codegraph` entry from `.mcp.json`.

Validation: see [codegraph-benchmark-2026-05-25.md](../../docs/evaluations/codegraph-benchmark-2026-05-25.md) — 49/49 caller relationships verified, 5/5 impact samples valid.

## Workflow integration

- **Mandatory exploration tool:** `.claude/rules/codegraph-usage.md` — CodeGraph-first before grep/Read for any architecture, impact, or trace question.
- **Auto-sync hook:** `.githooks/post-merge` and `.githooks/post-checkout` run `codegraph sync` after every merge / pull / branch-switch (incremental, <1 s, no-op if codegraph not installed).
- **Manual sync:** `npx -y @colbymchenry/codegraph sync` — run if hook didn't fire (e.g. cherry-pick, hand-edit) or after large file moves.

## Rollback

```bash
npx -y @colbymchenry/codegraph uninit    # deletes .codegraph/
```

Pre-install state tagged `pre-codegraph-install` (commit `748bf2b4`).
