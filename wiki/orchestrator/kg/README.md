# Orchestrator Product Knowledge Graph (Graphify)

Queryable code knowledge graph of MIRA's core modules, built with
[Graphify](https://github.com/safishamsi/graphify) (Tree-sitter AST + LLM
semantic extraction). Consumed by the **orchestrator-pulse** scheduled task
(`tools/orchestrator/render.py`, 4h cadence).

## Files

| File | What |
|---|---|
| `graph.json` | The graph — networkx node-link format (`directed`, `nodes`, `links`, `built_at_commit`). Query with `graphify query/path/explain/affected`. |
| `graph.html` | Interactive vis-network visualization (open in a browser). |
| `GRAPH_REPORT.md` | Human report — God Nodes, surprising connections, import cycles, communities, knowledge gaps. |

## Current build

- **Tool:** graphify `0.8.35` (PyPI package `graphifyy`, **install the `[gemini]` extra**)
- **Backend:** Gemini (OpenAI-compat endpoint), model `gemini-2.5-flash`
  - **Not Anthropic** — banned per PRD §4 / removed PR #610. Cascade-aligned (Gemini).
- **Scope:** `mira-bots/shared/`, `mira-hub/src/`, `mira-pipeline/`, `mira-mcp/`
- **Excludes:** `node_modules`, `__pycache__`, `.git`, `dist`, `.next`, `build`,
  `coverage`, test fixtures (`__tests__`, `__mocks__`, `__snapshots__`,
  `*.test.*`, `*.spec.*`, `*.stories.tsx`, `e2e`, `fixtures`), and the i18n
  locale catalogs (`mira-hub/src/messages/*.json`) — 1539 translation-key nodes
  (~30% of the raw graph) that drowned out real symbols in `query`/God-Nodes.
- **Stats:** 3509 nodes · 5416 edges · 294 communities · code state at commit `debdc684`
- **Cost:** ~$0.13 Gemini (one extract + one cluster pass)

Node `file` paths are **repo-relative** (e.g. `mira-bots/shared/engine.py`) — the
extract runs against a staged copy under `/tmp` whose layout mirrors the repo, so
the committed graph references real repo paths, not temp paths.

## Regenerate

The orchestrator-pulse sandbox has no LLM key; regeneration runs on **CHARLIE**
with Doppler (`factorylm/dev` carries `GEMINI_API_KEY`). The `prd` Gemini key is
403-blocked — use `dev`.

```bash
# 0. one-time install (global, does not touch the repo)
uv tool install "graphifyy[gemini]" --force   # the [gemini] extra pulls the openai client

# 1. stage the scoped modules into a temp tree mirroring repo layout
RUN=/tmp/mira-kg-build
mkdir -p $RUN/scope/mira-bots $RUN/scope/mira-hub
EXCL=(--exclude __pycache__ --exclude '*.pyc' --exclude .git --exclude node_modules \
  --exclude dist --exclude .next --exclude build --exclude coverage \
  --exclude __tests__ --exclude __mocks__ --exclude __snapshots__ \
  --exclude '*.test.ts' --exclude '*.test.tsx' --exclude '*.spec.ts' --exclude '*.spec.tsx' \
  --exclude '*.stories.tsx' --exclude e2e --exclude fixtures --exclude '*.map' \
  --exclude messages)   # messages = i18n locale catalogs (translation-key noise)
rsync -a "${EXCL[@]}" mira-bots/shared/ $RUN/scope/mira-bots/shared/
rsync -a "${EXCL[@]}" mira-hub/src/     $RUN/scope/mira-hub/src/
rsync -a "${EXCL[@]}" mira-pipeline/    $RUN/scope/mira-pipeline/
rsync -a "${EXCL[@]}" mira-mcp/         $RUN/scope/mira-mcp/

# 2. extract (AST + semantic) and 3. cluster (report + html)
export GRAPHIFY_GEMINI_MODEL=gemini-2.5-flash GRAPHIFY_NO_BACKUP=1 GRAPHIFY_VIZ_NODE_LIMIT=6000
doppler run -p factorylm -c dev -- graphify extract $RUN/scope --backend gemini --out $RUN/build
doppler run -p factorylm -c dev -- graphify cluster-only $RUN/build --backend=gemini

# 4. copy the three artifacts into this dir (graph.json is already repo-relative)
cp $RUN/build/graphify-out/{graph.json,graph.html,GRAPH_REPORT.md} wiki/orchestrator/kg/
```

After code changes you can refresh AST-only edges with **no API cost**:
`graphify update <path>` (semantic edges go stale until the next full extract).

## Known limitations

- **Community names are `Community N` placeholders.** Graphify labels all 344
  communities in a single LLM call; at this graph size the response truncates and
  graphify falls back to placeholders. The graph, edges, God Nodes, call paths,
  and cycles are unaffected — only human-readable community labels are missing.
  (`graphify query/path/explain` don't use community names.)
- **`graph.html` viz limit** is raised to 6000 nodes (`GRAPHIFY_VIZ_NODE_LIMIT`);
  the default 5000 skips HTML generation for this graph. A 5k-node vis-network
  page is heavy in-browser — for large-graph navigation prefer `GRAPH_REPORT.md`
  or `graphify tree`.
- **CLAUDE.md doc chunks** were skipped during semantic extraction (graphify's
  JSON parser doesn't strip the model's ```json fences on doc-type chunks). Code
  extraction was unaffected.
- **Gemini 403 throttle.** After a burst of runs (~5 LLM calls in 30 min) the dev
  key started returning `403 PERMISSION_DENIED` ("project denied access") — a
  temporary quota/abuse throttle. `cluster-only` degrades gracefully (placeholder
  labels). This graph was finalized by pruning the locale nodes out of the
  already-extracted graph (`json` node-drop on `source_file` under
  `mira-hub/src/messages/`) rather than re-running the LLM. For a clean from-scratch
  rebuild, wait for the throttle to clear and add `--exclude messages` to the rsync.

> 2026-06-08 (orchestrator, Lens B): +8 hand-extracted nodes / +6 edges appended to graph.json (`_origin: hand-extracted`, `lens: B`) — proposal-queue canonical-source drift, missing ADR-0017 helper, Playwright config map. Sandbox has no LLM key; next CHARLIE regen will rebuild from AST and these annotations should be re-checked.
