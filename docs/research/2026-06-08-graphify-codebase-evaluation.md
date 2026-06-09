# Graphify for the MIRA codebase — evaluation & archive

**Status:** ARCHIVED / PARKED — 2026-06-08.
**Decision:** We are **not** integrating graphify deeper into coding/devops. CodeGraph
already covers the structural lane well; graphify's useful lane here is narrow and
partly overlapping. This document preserves the research in case we revisit.
**Author:** Claude (CHARLIE) on behalf of Mike Harper.

> TL;DR — Graphify is a good *code-comprehension / architecture-orientation* tool,
> but most of its surface duplicates **CodeGraph** (MIRA's mandated, always-fresh,
> sub-ms structural index). The one move that would make graphify "seamless" —
> letting it intercept codebase questions — would actively damage the CodeGraph-first
> workflow. So graphify stays a **periodic artifact**, invoked explicitly, not a
> daily driver. Parked here.

---

## What stays (already landed, low-cost, kept)

These shipped before the decision to park and are harmless to keep:

- **CLI installed** on CHARLIE: uv tool `graphifyy` 0.8.35 (`~/.local/bin/graphify`).
- **`/graphify` skill** published into Claude Code (`graphify install --platform claude`
  → `~/.claude/skills/graphify/`). Reversible via `graphify uninstall`.
- **Committed product graph** at `wiki/orchestrator/kg/` (graph.json / graph.html /
  GRAPH_REPORT.md / README.md) — built for the orchestrator-pulse routine. PR #1787.
- **graph.json union merge-driver** — `.gitattributes` + one-time local git config
  (PR #1821). Prevents merge conflicts on the 91k-line file. Independently useful.
- **Hub `/knowledge/map` analysis layer** (PR #1789) — unrelated to graphify the tool;
  it borrowed the *algorithms* (PageRank/Louvain) for the customer KG.

What was **deliberately not done**: deeper integration (below).

## Why we parked it — graphify vs CodeGraph

CodeGraph (`codegraph_*` MCP, `.claude/rules/codegraph-usage.md`) is the mandated
structural index. Graphify's `query`/`path`/`explain`/`affected` and its MCP server
(`query_graph`/`get_node`/`get_neighbors`/`shortest_path`/`god_nodes`) are a near-exact
duplicate — except:

| | CodeGraph | Graphify |
|---|---|---|
| Freshness | synced every merge/checkout (`.githooks`), sub-ms | snapshot rebuilt by CLI; was already **13 commits** behind in the scoped modules ~1 day after build (built at `debdc684`) |
| Matching | resolves symbols (AST) | case-folded substring + IDF — no stemming/synonyms; wording mismatch → noise, needs manual vocab-expansion |
| Mandate | CodeGraph-first doctrine in `CLAUDE.md` | — |

→ For "what calls X / what breaks if I change Y / where is Z / trace A→B", **CodeGraph
wins outright.** That is most of graphify's surface.

## The hijack risk (the reason "seamless graphify" is harmful, not just redundant)

Two graphify features would intercept codebase questions and route them to the stale
snapshot *before* CodeGraph. **Do not enable these:**

- **`graphify claude install`** — writes a `## graphify` section to `CLAUDE.md` **and a
  PreToolUse hook** that injects on every tool call:
  *"For codebase questions, run `graphify query \"<question>\"` … instead of reading
  source files"* (verified in `graphify/__main__.py`). Points at a `graphify-out/`
  snapshot. This actively diverts codebase questions away from CodeGraph.
- **`graphify-out/graph.json` location bridge** — the skill's "fast path" (`SKILL.md`
  line 52) says: if `graphify-out/graph.json` exists, *"treat codebase questions as a
  graphify query first, skip Steps 1–5."* Creating that bridge (symlink/copy to our
  graph) would make graphify shadow CodeGraph on every question. We kept the graph at
  the non-default `wiki/orchestrator/kg/graph.json` precisely so this never fires.
- **Adding graphify's MCP server** alongside CodeGraph — two code-graph MCPs force a
  tool-selection decision on every query for a stale duplicate. Don't.

## Graphify's genuine lane (the 3 things CodeGraph does NOT do) — if we ever revisit

1. **Architecture orientation** — God-Nodes (centrality), community detection,
   surprising cross-module connections, import cycles. Read
   `wiki/orchestrator/kg/GRAPH_REPORT.md`, or `graphify explain "Supervisor" --graph
   wiki/orchestrator/kg/graph.json`. For *getting bearings*, not precise lookups.
2. **Semantic / INFERRED edges** — LLM-inferred relationships across files/docs that
   AST can't see (tagged `INFERRED`/`AMBIGUOUS`).
3. **Merge-risk surfacing** — `graphify prs --conflicts` flags PRs sharing a community
   (collision risk); complements the merge-driver. (Needs GitHub/PR wiring; untested.)

## How graphify actually works (research notes, for future reference)

- **Pipeline:** detect → AST extract (tree-sitter, 28 grammars, free) ‖ semantic
  extract (LLM, costs tokens) → build → Leiden cluster (`--resolution` tunes
  granularity) → analyze (God-Nodes, surprising connections) → outputs
  (graph.json / graph.html / GRAPH_REPORT.md; optional Obsidian/wiki/SVG/GraphML/Neo4j).
- **Querying:** `query` (BFS, broad) / `query --dfs` (trace a path) / `path A B` /
  `explain X` / `affected X` (reverse-impact). Literal matcher → the skill expects a
  vocab-expansion step (extract node-label tokens, pick ≤12 matching ones) before
  querying, else 0 hits.
- **Freshness:** `graphify update <path>` — incremental; **code-only changes skip the
  LLM entirely** (pure AST, free). `graphify watch` — rebuild on change.
  `graphify hook install` — post-commit AST rebuild + sets up the merge-driver (we set
  the merge-driver up manually instead, to avoid the auto-rebuild hooks colliding with
  MIRA's existing `.githooks/` path).
- **MCP:** `python -m graphify.serve graph.json` (stdio) or `--transport http --host
  0.0.0.0 --api-key $SECRET` for a shared team server. Tools: `query_graph`, `get_node`,
  `get_neighbors`, `shortest_path`, `god_nodes`, `graph_stats`, `list_prs`,
  `get_pr_impact`, `triage_prs`.
- **Large repos:** `.graphifyignore` (gitignore syntax), `--no-viz` (skip HTML),
  `GRAPHIFY_MAX_OUTPUT_TOKENS` to raise the budget.
- **MIRA regen recipe + Gemini-403 caveat:** `wiki/orchestrator/kg/README.md`.
- **Backend:** Gemini OpenAI-compat, model `gemini-2.5-flash` (the default
  `gemini-3-flash-preview` returns malformed JSON). Key via Doppler `factorylm/dev`
  (`prd` Gemini key is 403-blocked).

## If we ever un-park

The honest revisit criteria: graphify earns daily-driver status only if (a) the graph
is kept fresh automatically (fold `graphify update` into orchestrator-pulse), AND (b)
we want community/architecture orientation or PR-conflict surfacing that CodeGraph
doesn't provide. Even then, keep it **explicitly invoked** and never let it intercept
codebase questions. Sources: this doc + `wiki/orchestrator/kg/README.md` +
`.claude/rules/codegraph-usage.md`.
