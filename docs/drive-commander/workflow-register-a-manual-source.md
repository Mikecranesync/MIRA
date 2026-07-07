# Workflow — Register a manual source

Add a drive manual to the source registry so its packs can be kept current
without ever committing the proprietary PDF. Part of the DriveSense
trust-preserving update pipeline (`discovery-manual-ingest-and-update-workflow.md`).

## Where it lives

- Registry data: `tools/drive-pack-extract/registry/sources.json` (committed, human-curated).
- Loader/validator + classify logic: `tools/drive-pack-extract/registry/registry.py`.
- **Never** commit the source PDF. Local PDFs go in `tools/drive-pack-extract/manuals/`
  (git-ignored) — the registry references them by `local_pdf_hint` + `pdf_sha256` only.

## Entry fields

| Field | Meaning |
|---|---|
| `manual_id` | Stable identity (`vendor_family_publication`), unique across the registry |
| `vendor`, `product_family`, `applicable_drive_models` | What the manual covers |
| `manual_title`, `publication`, `revision`, `revision_date` | Human/document identity |
| `source_url` | Where it was retrieved (nullable — leave `null` if login-gated/unknown) |
| `source_classification` | any of `official`/`unofficial`/`downloadable_pdf`/`metadata_only`/`update_advisory_only`/`requires_login`/`manual_review_only` |
| `automatable` | `true` only if a reproducible `generator` + `gold_path` exist (validated) |
| `retrieved_date`, `local_pdf_hint` | When/where the local copy lives |
| `pdf_sha256` | The **approved** hash. A different hash later = a change → candidate |
| `pack_id`, `pack_version`, `gold_path`, `generator`, `candidate_dir` | How to (re)generate + grade its pack |
| `pack_trust_status` | last-known status: `candidate`/`internal_only`/`beta`/`trusted`/`rejected`/`superseded` |
| `known_residuals`, `approval` | declared gaps + the human sign-off record |

## Steps

1. Obtain the manual PDF locally (do **not** commit it). Put it under `manuals/`.
2. Get its hash: `python registry/check.py --manual manuals/<file>.pdf --json` → copy `sha256`.
3. Add an entry to `sources.json` with the fields above; set `pdf_sha256` to that hash.
4. If a reproducible extractor path exists for this family (a `generate_*_pack.py` + a
   `gold/<family>/gold.json`), set `automatable: true` and point `generator`/`gold_path` at them.
   Otherwise set `automatable: false` (**manual-review-only**) and leave `generator`/`gold_path` null.
5. Validate: `python -m pytest registry/tests/test_registry.py -q` (parses + no duplicate ids).

## Rules

- `automatable: true` **requires** both `generator` and `gold_path` — the loader fails closed otherwise.
- `manual_id` must be unique. Duplicates fail the load (and CI).
- Do not invent a `source_url`. Null is honest; a wrong URL is worse than none.
- The `pdf_sha256` you register is the **approved** baseline. Changing the PDF later is a
  detected change, not a silent overwrite — see `workflow-check-for-manual-updates.md`.
