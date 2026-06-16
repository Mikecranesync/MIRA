---
name: manual-ingestion-extractor
description: Use when extracting structured maintenance data from manuals, datasheets, or wiring PDFs. Triggers on edits to `mira-crawler/ingest/`, new customer doc uploads, or when a manual ingestion run produces unusual extractions.
---

# Manual Ingestion Extractor

Pull structured maintenance data from manuals/PDFs so MIRA can ground answers in real documentation.

Underlying pipeline lives in `mira-crawler/ingest/` (`chunker.py`, `converter.py`, `embedder.py`, `kg_writer.py`, `dedup.py`). Use those — don't reinvent.

## What to extract

1. **Periodic maintenance schedules** — interval, task, target component, tools, parts
2. **Lubrication intervals** — sub-case of PM; track separately so tribology-aware logic can use it
3. **Inspection steps** — visual checks, measurements, expected values, tolerances
4. **Safety warnings** — LOTO, arc flash, PPE, confined space, lift, hot work
5. **Troubleshooting tables** — symptom → cause → action rows
6. **Fault codes** — code → description, source page, optional reset procedure
7. **Wiring references** — terminal blocks, panel/cabinet location, drawing sheet refs
8. **Parts lists** — part number, vendor, description, BOM context
9. **Torque specs** — fastener size → torque value → unit, ordered by section
10. **Consumables** — oils, grease, gaskets, filters with grade specs
11. **Recommended PM calendar entries** — derived from #1, normalized to a calendar form
12. **Component metadata** — manufacturer, model, serial pattern, certifications (UL, CE, ATEX)
13. **Operating limits** — temperature, pressure, voltage, current, RPM ranges
14. **Alarm codes** — distinct from fault codes (alarms = warnings; faults = stops)
15. **Reset procedures** — explicit steps to clear a fault or alarm

## Rules

- **Preserve source.** Every extracted record carries `{doc_id, page}` (or `section` if pagination unreliable). Use `mira-crawler/ingest/chunker.py` section-aware splitting.
- **Don't invent missing data.** A manual that doesn't list fault codes → don't extrapolate from related manuals. Leave the field empty / `unknown`.
- **Flag low-confidence extractions.** If the section header was ambiguous, mark `confidence: low` and add a `notes` field describing the ambiguity.
- **De-dup.** Use `mira-crawler/ingest/dedup.py` before insert; manuals re-uploaded with minor changes should not duplicate rows.
- **Normalize into component profiles.** When extraction supports a complete profile, hand off to `component-profile-builder`. When only partial, leave as raw chunks tagged with the component id.
- **UNS-tag every chunk.** `uns_path` is mandatory per `.claude/rules/uns-compliance.md`.
- **No filename inference.** A file named `PF525_Manual.pdf` doesn't justify writing manufacturer/model in extraction output without internal evidence.
- **Preserve tables.** Use the table-detection path in `converter.py`; don't flatten tables into prose.

## Confidence buckets

- **high** — extracted from a structured table or section header explicitly labeling the data ("Section 4: Maintenance Schedule")
- **medium** — extracted from prose with consistent format across the manual
- **low** — extracted from one-off prose, OCR'd image, ambiguous section, or partial scan
- Always include `confidence` per record. Records below `medium` need a `notes` field.

## Output shape (per record)

```jsonc
{
  "kind": "pm_task|fault_code|wiring_ref|parts|torque|...",
  "data": { /* kind-specific */ },
  "source": {"doc_id": "...", "page": 17, "section": "Chapter 4 — Maintenance"},
  "confidence": "high|medium|low",
  "notes": "optional: why low confidence",
  "uns_paths": ["enterprise...."],   // empty if generic template
  "component_link": "component:..."  // null if not linked
}
```

## Anti-patterns (these introduce hallucinations)

- Filling unknown fields with "typical" values from training data
- Promoting a `confidence: low` extraction to higher confidence without re-verification
- Skipping the source citation to keep the JSON shorter
- Merging two manuals from different model years without noting the discrepancy
- Inferring fault-code meaning from numeric prefix patterns

## What to do when invoked

1. Locate the manual(s) — `mira-core/data/`, `mira-core/scripts/`, customer-uploaded paths
2. Run conversion + chunking via existing pipeline (don't replace it)
3. For each of the 15 extraction categories, produce records per the schema above
4. Cite real pages — use `pdfplumber` page index when present
5. Hand off to `component-profile-builder` if extraction is complete enough
6. Write extraction summary to `docs/ingestion-runs/<doc_id>-<date>.md` (audit trail)

## Cross-references

- `mira-crawler/ingest/chunker.py` — section-aware splitting
- `mira-crawler/ingest/converter.py` — docling + pdfplumber
- `mira-crawler/ingest/embedder.py` — vector embeddings
- `mira-crawler/ingest/kg_writer.py` — KG persistence
- `mira-crawler/ingest/dedup.py` — content de-dup
- `.claude/skills/component-profile-builder/SKILL.md`
- `.claude/mcp/mira-doc-ingestion-mcp-spec.md`
- `.claude/rules/uns-compliance.md`
