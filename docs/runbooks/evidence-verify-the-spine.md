# Runbook — verify the spine is healthy

**Audience:** agents + humans (reviewers) · **Hub:** [`bravo-evidence-lane.md`](../architecture/bravo-evidence-lane.md)

Run this before merging any change to `materialized_evidence/` or the catalog. "Healthy" = the
contract tests pass, the read-only gate holds, and the catalog matches the code.

## What to run

The repo `.venv` is Python 3.12 but has **no pytest**, and `tests/conftest.py` needs `pyyaml`.
Use the isolated uv workflow (adds no production dependency):

```bash
WT=$(git rev-parse --show-toplevel)
PYTHONPATH=$WT uv run --no-project --python 3.12 \
  --with pytest --with pytest-asyncio --with pyyaml \
  python -m pytest \
    "$WT/tests/test_context_contract.py" \
    "$WT/tests/test_evidence_catalog_sync.py" \
    "$WT/materialized_evidence/tests/" \
    -q -p no:cacheprovider
```

The **drift-guard** alone (stdlib only — no deps needed) can also run bare:

```bash
python -m pytest tests/test_evidence_catalog_sync.py -q
```

Lint the touched Python:

```bash
uv run --no-project --with ruff ruff format --check <files>
uv run --no-project --with ruff ruff check <files>
```

> Gotcha: `uv run --directory <worktree>` builds a 3.13 venv and won't install project deps
> (pyproject has no `[project].dependencies`). Always use `--no-project --python 3.12 --with …`.

## What "healthy" means

| Check | Green means |
|---|---|
| `test_context_contract.py` | The read-only gate catches every `agent_registry._WRITE_VERBS` verb; `validate_context` / `to_prompt_block` hold. |
| `test_evidence_catalog_sync.py` | Every `EvidenceKind` value and every `evidence_from_*` adapter in `context_contract.py` appears in [`evidence-catalog.md`](../architecture/evidence-catalog.md). No drift. |
| `materialized_evidence/tests/` | Manifest hashing, registry, resolver, invalidation invariants hold (ADR-0029). |
| ruff clean | Style gate (the repo CI gate). |

## If the drift-guard fails

It means the code and catalog disagree — a kind or adapter was added/renamed without updating
the catalog. Fix the **catalog** ([add-a-producer runbook](./evidence-add-a-producer.md) step 6),
not the test. The guard keys on names, so a rename needs the catalog updated to match.

## Scope note

`mira-bots/tests/test_visual_*` (the producer-side tests) need the bot package harness
(PIL/httpx/`shared.*`) and are out of this spine slice's footprint. They are orthogonal — run
them from the `mira-bots` harness when touching the visual workers themselves.
