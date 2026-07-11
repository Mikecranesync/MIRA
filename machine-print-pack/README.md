# MIRA Print Pack

*Verified Machine Print Pack — pack-format version 1.0.0*

> Your machine's cited electrical print set — evidence-graded, gap-honest, and ready before the panel ever comes apart.

## What a Print Pack is (and is not)

A **Print Pack** is a per-machine electrical print set where every drawn fact traces to a cited photo, manual, PLC file, or dated technician confirmation — or is explicitly flagged **FIELD VERIFY**. It's generated model-first (a structured data model, rendered deterministically) and independently graded against a published rubric before it ships (`RUBRIC.md`).

It is **not** a certified as-built, an engineering-stamped drawing, a SCADA or CMMS, a live-connected tool, an arc-flash/short-circuit/NEC study, or a control-write capability. It's paper and data — read-only by construction — and it's useful with nothing else installed.

A Print Pack is **instance-keyed, not family-keyed**: it documents one physical machine's actual wiring, not a reusable template for every machine that shares its model number. You buy one per asset.

## What's in the box

Every pack ships as a plain directory of files — no installer, no login, no account, nothing that expires. Seven pieces:

| # | Sub-artifact | Where it lives | What it's for |
|---|---|---|---|
| 1 | Searchable PDF print set | `prints/` | The sheet package your team actually works from — a bound multi-sheet PDF plus individually addressable per-sheet PDFs/PNGs, a cover/status page, PDF bookmarks, every "see E-0xx" as a real clickable link, and real (searchable, copyable) text — not a scanned image. |
| 2 | Connections & component CSVs | `data/*.csv` | `components.csv`, `connections.csv`, `terminals.csv` — every device, every conductor, every terminal as plain rows, untruncated, that you can filter, sort, or import into a spreadsheet or CMMS without re-typing anything off a PDF. Terminals that are verified but not yet wired to anything are still listed — nothing named silently disappears. |
| 3 | Evidence & provenance report | `evidence/` | Walks every "verified" claim to the source that backs it — a photo, a manual page/line, a PLC program file/line, or a dated technician statement — with the actual photo shown, not just a filename. Closes with a plain-language summary of how the pack was reviewed. |
| 4 | Field-verify register | `open_items/` | The structured list of everything still open: what it is, which sheet it affects, how serious it is, exactly how to check it, and — once closed — who closed it and what evidence closed it. |
| 5 | Field-verification worksheet | `worksheets/` | A printable, fillable checklist built directly from the register — grouped by physical work sequence, with a MEASURED field and a PASS/FAIL box for every item, and the pack's LOTO/e-stop safety reminder printed at the top. |
| 6 | Revision / approval record | `approval/` | Who prepared the pack and who technically reviewed it, a plain-language definition of the approval tier this pack shipped at, and three separate signature lines — prepared / engineering-reviewed / customer field-accepted — instead of one signature standing in for two different moments. |
| 7 | Machine-readable model | `data/pack_model.json` (+ `.yaml`) | The whole model — devices, terminals, wires, sheets, open items — combined losslessly into one file, so you're never locked into the PDF. This is also the file that plugs into MIRA, if you use it (see below). |

## How to read this pack

Start with sheet E-001 in `prints/` for the legend and device schedule, then work forward. Two rules make every other sheet readable at a glance:

- **Solid line = verified.** The fact is cited — a photo, a manual locator, a PLC program line, or a dated, named technician statement backs it.
- **Dashed line + red FIELD VERIFY tag = not yet confirmed.** This is a real, located gap, not a guess dressed up as a fact. There is no third state — nothing in a Print Pack is ever drawn with unstated confidence.

On the CV-101 reference pack, 37 of the 40 modeled conductors and 34 of the 96 modeled terminals are still FIELD VERIFY — and the pack still earned unanimous **APPROVABLE WITH FIELD VERIFICATION** (see `RUBRIC.md`). That's not a shortcoming to apologize for; it's the honesty the product is built to sell. Most plants have no as-built at all for a panel like this. A Print Pack tells you exactly what's known, exactly what isn't, and exactly what to go check next — instead of a drawing that looks complete and is quietly wrong in places nobody flagged.

The `worksheets/` PDF is that "what to go check next," made physical. It's grouped by physical work sequence — by where you'd actually stand at the panel, not by open-item number — so a technician can work it start to finish in one pass instead of hunting across nine sheets for what's still open.

## The approval ladder

Every pack ships at one of three tiers. The ladder is deliberately not a single done/not-done bit:

| Tier | What it means | What has to be true |
|---|---|---|
| **NOT APPROVABLE** | Not sellable. | Any hard-fail present (see `RUBRIC.md`), or any reviewer scored a sheet below 90. |
| **APPROVABLE WITH FIELD VERIFICATION** | The standard, sellable tier — the tier this pack ships at. | No hard-fails; every reviewer scored ≥90 on every sheet; every remaining unknown is explicit and sitting in the open-items register. |
| **APPROVABLE** | Same bar, plus the open items have been worked and closed. | Zero remaining field-verify items that would block safe energization — each one closed with a resolving citation and a named technician's field sign-off. |

**"APPROVABLE WITH FIELD VERIFICATION" is a distinct, sellable status — never silently upgraded to "APPROVABLE," never represented as "AS-BUILT VERIFIED."** When you order a pack, you request a tier (`requested_tier: field_verification` or `approvable` in the intake manifest); the build computes what was actually achieved and fails rather than labels up if it falls short of what you asked for.

## What's included, what's excluded, and what's never inferred

This is the core trust promise of the product. Read it before you rely on anything in the pack.

### Included

- The full set of drawn sheets, each with a stated scope line.
- Every conductor modeled in the source data (40 on CV-101), tagged verified or field_verify — never silently upgraded from one to the other.
- Every terminal modeled in the source data (~90 on CV-101), with its status — including terminals that are verified but not yet wired to anything (for example, CV-101's drive control-block terminals FWD/REV/DI3-5 are name-verified but their wiring is still open as OI-22), so nothing named silently disappears from the deliverable.
- Every device, with its model, role, and evidence status.
- The full open-items docket, each with a stated verify procedure.
- Every citation, independently checked by four reviewers plus a dedicated evidence auditor before delivery.
- The underlying machine-readable model.
- The bench-photo evidence backing every "verified" device-identity claim, embedded — not just cited by filename.

### Excluded — stated plainly, not left for you to assume

- The PLC program or ladder logic itself. It's cited as evidence, not delivered as a controls artifact.
- Any asset other than the machine you bought a pack for. On CV-101, a second panel device and its network identifier are visible in bench photos and are explicitly logged, not wired in — the pack makes no claim about them, positive or negative.
- A certified as-built. This is **"APPROVABLE WITH FIELD VERIFICATION,"** not **"AS-BUILT VERIFIED"** — we say the difference in words, not just with a dashed line.
- Load calculations, an arc-flash study, a short-circuit study, or an NEC code-compliance sign-off.
- Internal terminal-strip layouts that weren't directly observed — a terminal block's own internal wiring map, as opposed to what lands on its external terminals.
- Any control-write or PLC-modification capability. This bundle is pure paper and data.

### Never inferred — the hard rule

These are the categories of fact a Print Pack will never fill in for the sake of looking complete, with the real examples that anchor the rule on the CV-101 reference pack:

- **Conductor destinations not directly observed.** CV-101's Q1 auxiliary contacts are verified as wired — visible in a bench photo — but where those contacts land is still open (OI-26), stated as open, never asserted.
- **Terminal ids not read off a nameplate, manual, or photo.** CV-101's CB1 terminals are labeled "(proposed)" precisely because no CB1 device has been identified or photographed yet (OI-15) — the ids are placeholders, not readings.
- **Ratings not read off a nameplate or a manual table.** CV-101's motor (M1) has its voltage technician-confirmed, but its FLA, kW, RPM, and pole count are explicitly not — each stays open rather than assumed from a typical motor of that frame size.
- **Device relationships not directly evidenced.** A Siemens 1212C sits in the same panel photo as several verified CV-101 devices, but its role is unknown and it isn't connected to any CV-101 sheet (OI-23) — proximity in a photo is not a relationship.
- **A technician's field statement, unless directly quoted and dated.** CV-101's motor voltage confirmation (OI-27) cites the literal quote — "it's 230" — with its date, not a paraphrase, and not an engineer's inference dressed up as a field confirmation.
- **Anything "filled in" for drawing completeness.** The source rule is simple: no conductor is drawn that isn't in the model. This document's job is to make that existing engineering discipline an explicit promise to you, not to invent a new one.

## How a pack is built

Every pack is produced by one deterministic command:

```
python machine-print-pack/build/build_pack.py \
  --package plc/conv_simple_electrical \
  --intake  machine-print-pack/examples/cv-101/intake_manifest.yaml \
  --as-of   2026-07-11 \
  --out     machine-print-pack/examples/cv-101
```

`--as-of` is the only source of "now" anywhere in the build — no wall clock, no random seed, no unpinned timestamp in the pipeline. The same inputs and the same `--as-of` produce a byte-identical bundle every time, which `CHECKSUMS.txt` proves rather than asserts. Practically, that means you can re-derive your own copy of a pack from its intake manifest and its source model and get exactly what you were handed — not "something close."

## How it's graded

Every pack is scored against the same published rubric before it ships: 100 points across 12 categories, four independent reviewer roles, six zero-tolerance hard-fail conditions, and the three-tier verdict above. See `RUBRIC.md` for the full rubric and the CV-101 reference result.

## Using it with MIRA (optional)

The bundle is complete on its own. A technician with the PDF set and the CSVs needs nothing else installed, logged into, or subscribed to.

If you're also running MIRA/FactoryLM, the pack's machine-readable model (`data/pack_model.json`) is a stable contract other MIRA tools already consume: the same source model that builds this pack already lands as reviewable wiring proposals in the MIRA Hub, becoming one cited leg of MIRA's diagnostic evidence chain. Nothing from the pack is ever auto-verified on the way in — it lands for human review, the same way every other proposal in MIRA does. This is additive, never required. See `ROADMAP.md` stage (c) for how the two connect.

## Support

Questions about a delivered pack, or about a specific open item on your worksheet — contact prints@factorylm.com.
