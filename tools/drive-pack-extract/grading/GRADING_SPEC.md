# Drive-Pack Grading Spec (the contract)

This spec defines the gold-set format, the five grading layers, and the
trust-status rules. It is the single source of truth shared by the gold set
(`gold/<family>/gold.json`), the grading harness (`grading/*.py`), and the
generated pack. Doctrine: `docs/drive-commander/drive-pack-trust-doctrine.md`.

> The drive pack is not trusted because the extractor ran. It is trusted only
> when open, reproducible checks prove the JSON matches the source PDF within
> declared limits.

## Page numbering convention

For the PowerFlex 525 manual (`520-UM001O-EN-E`), **printed page number ==
pdfplumber `page_number` (1-indexed), no offset.** All `page` values in the gold
set, the pack citations, and the extractor use this same 1-indexed number.

## Gold-set format — `gold/<family>/gold.json`

A human-approved reference drawn from the real manual. Precision over recall:
prefer fewer, certain entries over broad, shaky ones.

```jsonc
{
  "manual": {
    "vendor": "Rockwell Automation",
    "family": "PowerFlex 525",
    "publication": "520-UM001O-EN-E",
    "revision": "O",
    "date": "September 2025",
    "filename": "pf525_520-um001.pdf",
    "sha256": "b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6",
    "page_numbering": "printed == pdfplumber page_number (1-indexed), no offset"
  },
  "faults": [
    {
      "fault_id": "F081", "code": 81, "name": "DSI Comm Loss",
      "fault_type": "2", "references_parameters": ["C125"],
      "page": 162, "diagnostic_critical": true,
      "note": "cross-vendor comm-loss proof (parallel to GS10 CE10->P09.03)"
    }
    // ... all fault rows from the fault-code table (F000..F127)
  ],
  "parameters": [
    {
      "parameter_id": "C125", "name": "Comm Loss Action",
      "range": null, "default": "0 \"Fault\"", "unit": null,
      "related_parameters": ["P045"], "related_faults": ["F081", "F082", "F083"],
      "page": 102, "diagnostic_critical": true
    }
    // ... the diagnostic-critical parameters (comm, protection, fault-linked)
  ],
  "edge_cases": [
    {
      "kind": "comma_group_skip", "ids": ["P046", "P048", "P050"], "page": 88,
      "expectation": "extractor SKIPS comma-grouped rows (no single-id attribution); pack must NOT contain a P046/P048/P050 entry"
    },
    {
      "kind": "multi_id_shared_desc", "ids": ["C129","C130","C131","C132"], "page": 103,
      "expectation": "four param IDs share one description block; pack must not merge them into one junk id or bleed the desc across unrelated params"
    },
    {
      "kind": "related_parameters_not_faults", "ids": ["t094"], "page": 99,
      "expectation": "t094 [Anlg In V Loss] 'Related Parameters: P043,P044,...' must land in related_parameters, NEVER related_faults"
    }
  ]
}
```

Field rules:
- `range`/`default`/`unit` = `null` when the manual has no clean numeric value
  (worded/conditional default) — this is honest, not a miss.
- `default` = the verbatim string as printed (e.g. `0 "Fault"` for an enum default,
  `5.0` for a numeric one). Compared normalized (whitespace/quotes-insensitive).
- `diagnostic_critical: true` marks the fields that MUST be right for a pack to
  clear `beta`. All comm-loss faults (F081/F082/F083), UnderVoltage/OverVoltage,
  and the comm params (C125/C126/C123/C124/C127) are diagnostic-critical.

## The five grading layers

### A. Schema validation (`grading/schema_check.py`)
Load the candidate pack through the **real runtime loader**
(`mira-bots/shared/drive_packs/loader.py::load_pack`). Any `ValueError` /
`FileNotFoundError` = **fail-closed**. Reuse the loader — do not reimplement
schema rules (single source of truth with the runtime).

### B. Citation integrity (`grading/cite_check.py`)
Re-read the source PDF. For every `source_citation` in `pack.parameters[]` and
`pack.keypad_navigation[]` (and every entry in a `provenance.sources`/citation
list that carries `{page, excerpt}`):
- an **integer page** ("162") is verified ON that page —
  `cite_integrity.verify_excerpt_on_page(pdf, page, excerpt)` (strong,
  page-pinned);
- a **chapter-section page label** ("4-188", "3-6" — the AutomationDirect GS10
  convention) can't be resolved to a physical page index, so it is verified
  **whole-document** — `cite_integrity.verify_excerpt_in_document(pdf, excerpt)`
  (the excerpt must appear on some page; still catches fabrication, just not
  pinned to one page; tallied as `verified_by_label_count`).

Report verified / unverifiable counts. A dropped **diagnostic-critical**
citation is a hard fail. The PDF is the source of truth. Requires the manual
locally; if absent, this layer reports `skipped (manual not available)` and the
trust status caps at `internal_only`.

### C. Gold-set scoring (`grading/gold_score.py`)
Compare the pack against `gold.json`. Precision over recall.
- **Fault present** = gold `code` is a key of `pack.live_decode.fault_codes` and
  the name matches (normalized). **Fault->param link present** = for a gold fault
  with `references_parameters:[X]`, the pack has a parameter `X` whose
  `related_faults` contains the gold `fault_id`.
- **Param present** = gold `parameter_id` is in `pack.parameters[]`; then compare
  `name`, `range`, `default`, `related_parameters`, `related_faults` (normalized).
- **Fabrication** (hard fail) = a pack entry whose value **contradicts** gold
  (wrong name/range/default), or a param id appearing in any `related_faults`.
- Report: precision = correct_pack_entries / graded_pack_entries; recall =
  matched_gold / total_gold; plus separate precision/recall over
  `diagnostic_critical` entries only. Report every `edge_case` expectation as
  pass/fail.

### D. Domain-quality rules (`grading/domain_rules.py`) — deterministic, gold-independent
Hard fail on any of:
- a `live_decode.fault_codes` name containing header/footer junk
  (`Rockwell Automation Publication`, a bare page number, `Chapter \d`).
- a `parameters[].parameter_id` that is not `^[APCTBDapctbd]\d{2,3}$` **or** is a
  fault id (`^F\d+$`).
- any `related_faults` entry that is not `^F\d+$` (i.e. a param id leaked in).
- a param id appearing in its own or another param's `related_faults`.
- duplicate fault codes; duplicate parameter ids.
- a param with a non-null `range`/`default`/`unit` but an empty
  `source_citation.excerpt` or `page` (uncited value).
- a `keypad_navigation[]` entry with empty/whitespace `view_only_warning`.
- a `provenance.items` / `provenance_tier` value not in
  `{bench_verified, manual_cited}`.
- an `inferred` relationship not marked `inferred` (if the pack ever emits one).

### E. Reproducible grading report (`grading/report.py` + `grade.py` CLI)
Emit BOTH `grading_report.json` (machine-readable) and `grading_report.md`
(human-readable) containing: pack name; source manual identity; source PDF
sha256; extractor commit (git short sha of the extractor source); schema
version; extraction command/config/page ranges; fault count; parameter count;
schema-validation result; cite-integrity result; gold-set score (overall +
diagnostic-critical); domain-rule result; known residuals; and the final
**trust status**.

## Trust status (exactly one)

Computed fail-closed, worst-wins:

| status | criteria |
|---|---|
| **rejected** | schema fails; OR any hard domain-rule violation; OR any gold fabrication; OR a diagnostic-critical citation dropped by cite-integrity |
| **internal_only** | schema + domain pass, but cite-integrity could not run (manual absent) OR gold recall of diagnostic-critical faults < 100% OR undeclared residuals |
| **beta** | schema + domain + cite-integrity all pass; gold **precision on diagnostic-critical == 100%**; overall fault recall >= 90%; residuals declared; NO bench-verified `live_decode` (manual-cited-only pack) |
| **trusted** | all `beta` criteria met **AND** a recorded human sign-off (`runbook-pr-b-acceptance.md`) **AND** (bench-verified live_decode present OR explicit human waiver noting manual-only scope) |

The harness computes the automated ceiling (max `beta` for a manual-only pack).
Promotion to `trusted` is a documented human action, never automatic.
