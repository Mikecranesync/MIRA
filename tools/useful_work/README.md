# Useful Work Automation

Small, constrained work packs for Dana, Linda, and CPU-only scheduled agents.

## PrintSense Filing Worker

The first worker files completed PrintSense packages into Hub evidence. It expects
a package directory containing:

- `graph.json`
- `grade.json`
- `source_manifest.json`
- any local source files named by `source_manifest.json`

Dry-run is the default and never attaches files:

```bash
py -3 tools/useful_work/printsense_filing.py path/to/printsense_pkg \
  --evidence-root dogfood-output/useful-work \
  --ledger dogfood-output/runner-ledger.jsonl
```

Commit mode requires an explicit Hub URL:

```bash
py -3 tools/useful_work/printsense_filing.py path/to/printsense_pkg \
  --commit \
  --hub-url "$MIRA_HUB_URL" \
  --hub-cookie "$MIRA_HUB_COOKIE" \
  --evidence-root dogfood-output/useful-work \
  --ledger dogfood-output/runner-ledger.jsonl
```

Guardrails:

- Exact `tenant_id` and `target.node_id` are required for direct attachment.
- `target.uns_path` can be resolved only when a caller injects a node resolver.
- `import_verdict=FAIL`, `hard_failures`, or `import_blocking_failures` stop as review.
- Drive file IDs require a separately approved injected fetcher; otherwise the worker reports `infra`.
- Ambiguous or unavailable sources never report green.
- Filing does not verify PrintSense facts or knowledge graph relationships.
