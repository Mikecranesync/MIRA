# Adding a new drive family

> Doctrine: [`drive-pack-trust-doctrine.md`](drive-pack-trust-doctrine.md). **The drive pack is
> not trusted because the extractor ran. It is trusted only when open, reproducible checks prove
> the JSON matches the source PDF within declared limits.** This is the checklist for turning a
> new manufacturer's manual into the next drive pack, following the same generate→grade→sign-off
> discipline as PowerFlex 525.

## 1. Onboard the manual

- **Fetch** the real, licensed manual PDF (user/parameter/fault-reference manual — whichever
  document actually contains the fault-code table and parameter definitions) to a local machine.
- **Hash it** (`sha256sum <file>` or Python's `hashlib.sha256`) — you'll record this in the manual
  identity block (below) and the generator will print it on every run.
- **Gitignore it.** Extend `tools/drive-pack-extract/.gitignore` with a pattern for the new
  family's filename/publication number, following the existing PF525 pattern (`pf525_*.pdf`,
  `*520-um001*`) — never rely on the generic `manuals/` catch-all alone if the filename is
  distinctive enough to name explicitly. The real PDF must never be committed, regardless of size.

## 2. Define source metadata (the manual identity block)

Every family needs an identity block recorded in the gold set and referenced in `PROVENANCE.md`,
matching the shape in `GRADING_SPEC.md`:

```jsonc
"manual": {
  "vendor": "...",
  "family": "...",
  "publication": "...",
  "revision": "...",
  "date": "...",
  "filename": "...",
  "sha256": "...",
  "page_numbering": "printed == pdfplumber page_number (1-indexed), no offset"   // confirm this per manual — some manuals DO have an offset
}
```

Confirm the **page-numbering convention** explicitly for the new manual — `GRADING_SPEC.md` notes
PF525's printed page number equals pdfplumber's 1-indexed `page_number` with no offset; a
different manual (e.g. one with a cover page or front-matter roman-numeral section) may not share
that property, and every `page` value downstream (gold set, citations, extractor) depends on
getting this right once, up front.

## 3. Create a gold set

`gold/<family>/gold.json`, transcribed **by hand from the real manual** — not generated, not
copied from another family's gold set with search-and-replace. Follow `GRADING_SPEC.md`'s format
exactly:

- **`faults[]`** — every row from the fault-code table, each with `fault_id`, `code`, `name`,
  `fault_type`, `references_parameters` (the fault→parameter cross-references the manual's action
  text states), `page`, and `diagnostic_critical` for comm-loss / over-under-voltage / anything a
  technician would treat as safety- or uptime-critical.
- **`parameters[]`** — at minimum every diagnostic-critical parameter (comm settings,
  protection thresholds, anything a fault references) with `name`, `range`, `default`, `unit`,
  `related_parameters`, `related_faults`, `page`, `diagnostic_critical`.
- **`edge_cases[]`** — the manual's own messiness, documented as an expectation the extractor must
  satisfy: comma-grouped rows that should be skipped, multi-id shared-description blocks, and any
  place a parameter's own "Related Parameters:" line must land in `related_parameters` and never
  `related_faults`.

**Precision over recall.** A gold set with 20 certain, hand-verified entries is worth more than 200
entries transcribed quickly with a few wrong. Every gold entry is a claim you're willing to defend
against the actual PDF page cited.

## 4. Expand parser support without weakening cite-integrity

If the new manual's tables don't match either layout `extractor.py` already handles (grid vs.
labeled-block), that's a **PR-A** change:

1. Reproduce the new layout's messiness in a **synthetic fixture** first — extend
   `_make_pf_sample_pdf.py`'s pattern (or add a sibling generator) so the new shape is exercised in
   CI without ever reading the real manual there.
2. Harden `extractor.py` against the synthetic fixture until its tests pass.
3. Run it against the real manual and **independently inspect the actual JSON output** (doctrine
   step 3 — don't trust the builder's self-report).
4. **Never loosen `cite_integrity.verify_excerpt_on_page`** to make a new layout's output pass. If
   a field can't be traced to a verbatim excerpt on its cited page, the extractor must drop it
   (`extractor.verify_and_filter_entries`), not the cite-integrity gate widen to let it through.
   The gate having teeth (a fabricated excerpt provably fails; a real one provably passes) is the
   whole point — see `tools/drive-pack-extract/README.md` § "The cite-integrity guarantee".
5. Add a **new generator script** for the family (mirroring `generate_pf525_pack.py`'s structure:
   baked-in page-range constants with comments explaining any excluded page, bleed sanitization,
   fail-closed duplicate-id check, `PROVENANCE.md` sidecar, schema validation of the written
   candidate via `drive_packs.loader._parse_pack`). Write the candidate to
   `tools/drive-pack-extract/candidates/<family>/`, matching `_DEFAULT_PACKS_DIR` in
   `generate_pf525_pack.py` — never write directly into the live served
   `mira-bots/shared/drive_packs/packs/` tree from a generator.

## 5. Preserve the anti-fabrication doctrine

- **Follow the 10-step acceptance flow** in `drive-pack-trust-doctrine.md` for every new family:
  build against synthetic → run against the real manual → independently inspect the JSON → confirm
  clean names/ranges/defaults/units/fault codes → confirm cross-reference direction
  (`references_parameters` vs `related_faults`) → confirm cite-integrity → fold the discovered
  messiness back into fixtures → only then open the PR.
- **The flywheel is mandatory, not optional.** Every real-manual defect you discover and fix
  (a new column layout, a new footnote-bleed pattern, a new comma-grouping shape) must be
  reproduced in the synthetic fixture before the PR merges. This is what makes the *next* manual
  easier — skipping it means the next family re-discovers the same defect from scratch.
- **Never let a pack's trust status exceed what the harness computed.** A new family's pack goes
  through the same grade → inspect → sign-off flow as PF525 — see
  [`runbook-pr-b-acceptance.md`](runbook-pr-b-acceptance.md). There is no "well-known vendor, skip
  the check" shortcut.
- **Generate and grade both stay staged.** The new family's candidate lives under
  `tools/drive-pack-extract/candidates/<family>/` throughout this whole flow — it never touches the
  live served `packs/` tree until the separate, human-gated **promotion** step (see "Promotion
  (candidate → live)" in [`runbook-pr-b-acceptance.md`](runbook-pr-b-acceptance.md)), which also
  requires repointing `test_resolve_pack_returns_none_for_unrelated_drive` at whichever family is
  still unpackaged after this one lands.

## Cross-references

- [`drive-pack-trust-doctrine.md`](drive-pack-trust-doctrine.md) — the doctrine + 10-step flow + flywheel
- [`workflow-generate-drive-pack.md`](workflow-generate-drive-pack.md) — running a family's generator
- [`workflow-grade-drive-pack.md`](workflow-grade-drive-pack.md) — grading the result
- [`runbook-pr-b-acceptance.md`](runbook-pr-b-acceptance.md) — full acceptance + sign-off flow
- `tools/drive-pack-extract/grading/GRADING_SPEC.md` — the gold-set format (canonical)
- `tools/drive-pack-extract/README.md` — the extractor's layout-dispatch + cite-integrity internals
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` — the product decision + family roadmap
