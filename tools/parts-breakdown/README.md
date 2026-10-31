# parts-breakdown — OEM parts breakdown → structured evidence (free toolkit, rung 1)

Deterministic extractor that turns the tables of a manufacturer data sheet
(parts list, optional parts, service parts, seal kits, valve kits) into one
JSON record an agent, a Work Packet, or an inventory count can use. No model
calls. Founder directive: #4982.

Today it understands the CAT Pumps data-sheet layout. Other OEM layouts are a
new parser module each; the output record is meant to stay the same.

## Run

```bash
# from a PDF (needs pypdf at run time) or from a per-page text dump
python tools/parts-breakdown/catpumps_breakdown.py 5CP6120_G.pdf --json out.json
python tools/parts-breakdown/catpumps_breakdown.py --diff rev_f.json rev_g.json
pytest tests/test_parts_breakdown.py -q
```

Manufacturer PDFs are **not** committed (they are copyrighted literature).
Fetch them from the manufacturer's site and pin the sha256 in your evidence
note; the tool records the file hash in `source.sha256`.

## What the record holds

| Key | Meaning |
| --- | --- |
| `source` | file, sha256, document part number, revision (`Rev G 5/22`), page count, exploded-view page |
| `models` | the pump models the sheet's parts list covers |
| `parts[]` | item, part number, description, material code, `qty_raw` as printed, `qty_by_model` when it can be resolved, `qty_status` (`single` / `resolved` / `ambiguous`), `applies_to` (models named in the row), RoHS flag, production-part-differs flag, tech-bulletin notes, `source_page` |
| `optional_parts[]`, `service_parts[]` | part, description, qty, notes, `source_page` |
| `kits[]` | kind (`seal` / `valve`), kits required per pump, models, kit number per material, the items each kit contains with part numbers per material and qty per kit |
| `checks[]` | deterministic consistency checks: every kit item exists in the parts list, and `qty_per_kit × kits_required` equals the parts-list quantity |
| `unknowns[]` | everything the sheet does not state unambiguously, e.g. a quantity cell with fewer values than models |

Nothing is inferred. A quantity like `8–4` on a three-model sheet stays
`ambiguous` with the raw string preserved; it is never split by guesswork.

## Why this matters for the maintenance use case

- **Repair kits are the inventory unit.** For the CAT Pumps 5CP6120 the sheet
  says one seal kit (33628) and two valve kits (30820) per pump; the checks
  prove those kits cover the parts list quantities. A reseal consumes exactly
  those kits, so stock can be counted in kits, not loose O-rings.
- **Revision drift is visible.** `--diff` between two revisions shows which
  rows changed; a technician holding a Rev F printout can see what Rev G
  changed before ordering.
- **Provenance travels with every row** (`source_page`, document part
  number, revision, file hash), which is what a Work Packet needs to cite.

## Limits (honest)

- Text-based: the exploded-view drawing is referenced by page, not parsed.
- Photo input is not handled here. A photographed sheet must first become
  text (the Hub's photo OCR path), and that transcription is unverified until
  a person confirms it.
- One layout (CAT Pumps). Rows that do not fit the regexes are skipped, not
  guessed; compare `len(parts)` with the printed list when adopting a new sheet.
