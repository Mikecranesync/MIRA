# Workflow — Check for manual updates

Detect whether a local drive manual is new, unchanged, or changed vs. the
registry — and, when changed, generate a **candidate** pack for human review.
The core rule: **a changed manual produces a candidate, never an automatic
trusted replacement** (`runbook-do-not-silently-trust-updated-manuals.md`).

## 1. Check a manual against the registry (read-only, non-gating)

```bash
cd tools/drive-pack-extract
python registry/check.py --manual manuals/<file>.pdf            # identify by hash
python registry/check.py --manual manuals/<file>.pdf --id <manual_id>
python registry/check.py --manual manuals/<file>.pdf --json     # machine-readable
```

`check.py` computes the PDF's SHA-256 and classifies it. It **never** downloads,
extracts, grades, writes, or promotes; it always exits 0.

| State | Meaning | Next |
|---|---|---|
| `unchanged` | hash == the approved `pdf_sha256` | nothing to do |
| `new_manual` | no registry entry matches | register it first (`workflow-register-a-manual-source.md`) |
| `changed_by_hash` | entry exists, hash differs | generate a candidate (below) |
| `needs_initial_candidate` | registered but no approved hash yet | generate the first candidate |

## 2. Generate a candidate when changed

```bash
python registry/update_candidate.py --manual manuals/<file>.pdf --id <manual_id>
```

This reuses the existing tools verbatim:
1. classify (no-op if `unchanged`, unless `--force`);
2. run the entry's declared `generator` (writes `candidates/<pack>/pack.json` + `PROVENANCE.md`);
3. run `grading/grade.py` (schema + cite-integrity + gold + domain → trust status);
4. write `candidates/<pack>/candidate_report.{json,md}` combining the manual's
   source identity + the grading report + a **reviewer checklist**.

It writes **only** under `candidates/` — it structurally cannot touch the live
`mira-bots/shared/drive_packs/packs/` tree (guarded). It never promotes.

- A **manual-review-only** source (`automatable: false`, e.g. GS10 today) is **refused** —
  there's no reproducible generator/gold to run. Wire those first, or review by hand.
- `--force` re-grades an unchanged manual (e.g. after a gold-set or extractor change).

## 3. Review + (maybe) promote

Read `candidate_report.md`, run the reviewer checklist, and follow
`runbook-drive-manual-update-acceptance.md`. Promotion into the live `packs/`
tree — and updating the registry's `pdf_sha256`/`pack_trust_status` — is a
separate, human-gated step. The old pack stays live until a replacement is approved.

## What is verified in CI vs. locally

- **CI (synthetic only):** registry parsing, duplicate-identity detection, hash-change
  classification, no-auto-promote, report provenance/trust — `registry/tests/`. No real manual.
- **Local (real manual):** the full generate→grade run. Deterministic; artifacts land under
  `candidates/<pack>/` (git-ignored run output). Large PDFs never enter CI.
