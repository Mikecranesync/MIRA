# registry — DriveSense manual source registry + update-candidate workflow

The trust-preserving **update** layer on top of the drive-pack extractor/grader.
Turns one-off manual extraction into a repeatable loop that keeps drive packs
current **without letting a changed vendor PDF silently rewrite MIRA's
diagnostic truth**: a changed manual creates a *candidate*, never a trusted pack.

Discovery + rationale: `docs/drive-commander/discovery-manual-ingest-and-update-workflow.md`.

## Files

| File | Role |
|---|---|
| `sources.json` | The manual source registry (identity, approved sha256, generator/gold, trust status). **Never commit source PDFs** — `../manuals/` is git-ignored. |
| `registry.py` | Pure, read-only: load/validate, duplicate-identity detection, SHA-256, `classify()` state machine. |
| `check.py` | Read-only CLI: is a local PDF new / unchanged / changed vs. the registry? Non-gating. |
| `update_candidate.py` | Orchestrator CLI: reuses the existing generator + grader to produce a **candidate** pack + review report. Never promotes; guarded against writing into the live `packs/` tree. |
| `tests/` | Phase-8 tests (registry parse, dup identity, hash change, no-auto-promote). CI-safe, synthetic only. |

## Quick use

```bash
cd tools/drive-pack-extract
python registry/check.py --manual manuals/<file>.pdf --id <manual_id>
python registry/update_candidate.py --manual manuals/<file>.pdf --id <manual_id>
```

Workflows: `docs/drive-commander/workflow-register-a-manual-source.md`,
`…/workflow-check-for-manual-updates.md`. Acceptance:
`…/runbook-drive-manual-update-acceptance.md`. Trust rule:
`…/runbook-do-not-silently-trust-updated-manuals.md`.
