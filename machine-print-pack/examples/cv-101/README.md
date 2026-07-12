# CV-101 Print Pack

Approval tier: **APPROVABLE WITH FIELD VERIFICATION**. Start with `prints/CV-101_print_set.pdf` — page 0 is the cover/status page, then E-001 (legend + device schedule), then forward.

## Two rules make every sheet readable at a glance

- **Solid line = verified.** The fact is cited — a photo, a manual locator, a PLC program line, or a dated, named technician statement backs it.
- **Dashed line + red FIELD VERIFY tag = not yet confirmed.** A real, located gap, not a guess dressed up as a fact.

On this pack, 37 of 40 modeled conductors and 34 of 96 modeled terminals are still FIELD VERIFY. That is not a shortcoming — it is the honesty the pack is built on. `open_items/field_verify_register.csv` is the punch-list; `worksheets/field_verification_worksheet.pdf` is that punch-list made physical, grouped by where you would actually stand at the panel.

## What's in the box

| # | Sub-artifact | Where |
|---|---|---|
| 1 | Searchable PDF print set | `prints/` |
| 2 | Connections & component data | `data/*.csv`, `data/pack_model.{json,yaml}` |
| 3 | Evidence & provenance report | `evidence/` |
| 4 | Field-verify register | `open_items/` |
| 5 | Field-verification worksheet | `worksheets/` |
| 6 | Revision / approval record | `approval/` |
| 7 | Machine-readable model | `data/pack_model.json` (+ `.yaml`) |

## Included / excluded / never inferred

**Included:** every drawn sheet; every modeled conductor and terminal, tagged verified or field_verify (never silently upgraded); every device with model/role/evidence status; the full open-items docket; the QA summary; the machine-readable model; the redacted bench-photo evidence backing each verified device-identity claim.

**Excluded:** the PLC program/ladder itself (cited as evidence, not delivered); any asset other than the one this pack documents; a certified as-built (this is APPROVABLE WITH FIELD VERIFICATION, not AS-BUILT VERIFIED); load/arc-flash/short-circuit/NEC studies; internal terminal-strip layouts not observed; any control-write capability.

**Never inferred:** conductor destinations not directly observed; terminal ids not read off a nameplate/manual/photo; ratings not read off a nameplate/manual; device relationships not directly evidenced; a technician's field statement unless directly quoted and dated; anything filled in for drawing completeness.

This bundle is complete on its own — a technician with the PDFs and CSVs needs nothing else installed.

Questions — contact prints@factorylm.com.
