# Graphify is Excluded from AI Code Navigation

**Status:** ACTIVE exclusion (2026-06-10). **Override:** only Mike, explicitly, in a future instruction — or automatically once CodeGraph reaches 100% benchmark confidence (`tools/codegraph-benchmark.sh` green with zero Tier-2 limitations outstanding).

## The rule

**CodeGraph is the single code-navigation graph for this repo. Graphify must not be used to answer questions about this codebase, its architecture, file relationships, call paths, or symbols.**

When a coding/navigation question arises ("how does X work", "what calls Y", "trace the flow from X to Y", "where is Z", "what breaks if I change W"), the answer comes from **CodeGraph** (`codegraph_*` MCP tools / `npx -y @colbymchenry/codegraph …`), per `.claude/rules/codegraph-usage.md`. Never from Graphify.

This exists to prevent **two competing graph brains** for code navigation while CodeGraph is being hardened. One graph, one source of truth.

## What is specifically forbidden (code navigation)

- ❌ Using the global `graphify` skill's "fast path" to answer a codebase question (the skill says: *if `graphify-out/graph.json` exists and the request is a natural-language codebase question, skip exploration and run `graphify query`*). **That fast path is OVERRIDDEN in this repo.** Repo rules + CLAUDE.md take precedence over a global skill (instruction priority). Do not take it.
- ❌ Treating a `graphify-out/` artifact at the repo root as an authoritative code index. It isn't. If one appears, it's stale scratch output — ignore it for navigation (the preflight WARNs about it; see below).
- ❌ Adding a Graphify MCP server to `.mcp.json`.
- ❌ Adding a Graphify PreToolUse/PostToolUse/any hook, or a Graphify step to a runbook, that intercepts or pre-empts codebase questions.
- ❌ Recommending Graphify for code navigation in any doc, rule, skill, or PR.

## Carve-out — the orchestrator product KG is NOT code navigation (preserve it)

Graphify legitimately powers **one** thing in this repo, and it is **not** code navigation:

- `wiki/orchestrator/kg/` (`graph.json` / `graph.html` / `GRAPH_REPORT.md`) — the **orchestrator-pulse product knowledge graph**: God Nodes, communities, surprising connections, knowledge gaps. A business/product-intelligence artifact, regenerated periodically and consumed by `tools/orchestrator/render.py` + queried by `tools/orchestrator/kg_query.py`.

This product KG **stays**. It answers product/strategy questions for the orchestrator routine, never "what calls `Supervisor`". Its regeneration recipe (`wiki/orchestrator/kg/README.md`) builds in a **temp `$RUN/build/graphify-out/`** dir and copies the three files into `wiki/orchestrator/kg/` — it never depends on a repo-root `graphify-out/`, so the navigation exclusion and the preflight's repo-root warning do not touch it.

The boundary: **Graphify-for-product-KG (orchestrator-pulse) = allowed. Graphify-for-code-navigation = excluded.**

## Enforcement (deterministic where possible, doctrine where a hard block would false-positive)

1. **Doctrine (primary):** this rule + `.claude/rules/codegraph-usage.md` + the CLAUDE.md CodeGraph sections. They override the global skill's code-nav fast path for this repo.
2. **Preflight WARN (deterministic, non-blocking):** `tools/codegraph-preflight.sh` emits a loud `⚠ GRAPHIFY` line if a repo-root `graphify-out/graph.json` exists, reminding the agent it must not be used for navigation. **Warn, not block** — a hard block on `graphify-out/` existence could false-positive against an in-flight orchestrator regen that stages there.
3. **No silent reintroduction:** adding a Graphify MCP server, hook, or "use graphify for code" doc line is a rule violation reviewers should reject.

## Why warn, not hard-block, on `graphify-out/`

The orchestrator product-KG regen and the global skill both default to a `graphify-out/` directory. A guard that *fails* on its existence could kill a legitimate regen mid-run. The deterministic layer therefore only **warns**; the real enforcement is doctrine (this rule) plus keeping no stale repo-root `graphify-out/` lying around to trigger the global skill's fast path.

## When this applies / does not

- **Applies:** any code-navigation, architecture, impact, trace, or "where/what-calls" question in any indexed module; any proposal to wire Graphify into navigation tooling.
- **Does NOT apply:** the orchestrator-pulse product KG (`wiki/orchestrator/kg/`, `tools/orchestrator/`), and non-code Graphify uses (papers, docs corpora, product strategy). Those are out of scope of this exclusion.

## Cross-references

- `.claude/rules/codegraph-usage.md` — the CodeGraph-first navigation doctrine this rule pairs with
- `wiki/references/codegraph.md` — CodeGraph reference (usage, preflight, benchmark)
- `tools/codegraph-preflight.sh` — emits the Graphify WARN
- `wiki/orchestrator/kg/README.md` — the preserved product-KG regen recipe (out of scope)
