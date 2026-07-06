# Runbook — Drive manual update acceptance

What a human reviewer must check before a **candidate** drive pack (from a
changed/new manual) may replace a trusted one. This is the human gate the
automated pipeline deliberately stops short of. Companion to
`runbook-pr-b-acceptance.md` (first-time pack acceptance); this one covers
**updates** to an already-shipped pack.

## Preconditions

- A candidate exists under `tools/drive-pack-extract/candidates/<pack>/` with
  `pack.json`, `PROVENANCE.md`, `grading_report.md`, and `candidate_report.md`
  (produced by `update_candidate.py` — see `workflow-check-for-manual-updates.md`).
- You have the source PDF locally (never committed).

## Reviewer checklist (all must pass)

1. **Trust status** in `candidate_report.md` is `beta` — or `internal_only` with residuals you
   explicitly accept. A `rejected` candidate is **not** promotable; fix the extractor/gold first.
2. **Cite-integrity passed** — every diagnostic-critical fault/parameter value is citation-backed;
   nothing unverifiable slipped in (the grader drops those, but confirm no critical drop).
3. **Domain rules passed** — no parameter id in any `related_faults`; no duplicate codes/ids; no
   PDF header/footer/page-number junk in names.
4. **Gold-set** — no fabricated or contradicted value vs. the hand-approved gold.
5. **Pack diff vs. previous** (in `candidate_report.md`) — review `faults_added/removed` and
   `parameters_added/removed`. A **removed** fault/parameter that a technician relies on is a red
   flag: confirm the new manual genuinely dropped it, not a parsing regression.
6. **Residuals** — every `known_residual` is understood and acceptable, or newly declared.
7. **For `trusted`** (not just `beta`): bench-verified `live_decode` is present **or** an explicit
   manual-only waiver is recorded. Automation can never grant this.
8. **Sign-off** — record reviewer name + date + note.

## Promote (human-gated, deliberate)

1. Copy the reviewed `candidates/<pack>/pack.json` into the live tree
   `mira-bots/shared/drive_packs/packs/<pack>/pack.json` (and keep the graded
   `grading_report.md` next to it, per the tool `.gitignore` note).
2. Commit the pack's `grading_report.md` as the durable acceptance record.
3. **Update the registry** (`registry/sources.json`) for this `manual_id`:
   - `pdf_sha256` → the new approved hash (from `candidate_report.md`),
   - `revision`/`revision_date`/`retrieved_date` → the new manual's,
   - `pack_trust_status` → `beta` or `trusted` per your decision,
   - `known_residuals` → the accepted list,
   - `approval` → your name + date + note.
4. The previous pack version is now `superseded` — the new one is live.

## Do not

- ❌ Promote a `rejected` candidate.
- ❌ Let any automated job perform steps 1–3.
- ❌ Overwrite the live pack before the checklist passes — the old pack stays live until then
  (`runbook-do-not-silently-trust-updated-manuals.md`).
