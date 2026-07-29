# MIRA Print Pack — Specification

**Product:** MIRA Print Pack
*(descriptive subtitle: "Verified Machine Print Pack")*
**Pack-format version:** `1.0.0` (see `machine-print-pack/VERSION`; **distinct** from the repo `/VERSION`)
**Status:** DRAFT spec for the standalone, sellable print-pack product.
**Reference implementation / golden pack:** the CV-101 (Conv_Simple) 9-sheet package in
`plc/conv_simple_electrical/` (PR #2631), graded **APPROVABLE WITH FIELD VERIFICATION**.

> One-liner: *Your machine's cited electrical print set — evidence-graded, gap-honest, and
> ready before the panel ever comes apart.*

This document is BOTH the product specification (deliverable 1) and the **build contract** the
tooling (`build_pack.py`, `validate_pack.py`) and the golden CI guard must satisfy. If code and
this spec disagree, that is a bug in one of them — reconcile, don't diverge.

---

## 0. What a Print Pack is (and is not)

A **Print Pack** is a **per-machine, evidence-graded electrical print set**. Every drawn fact
traces to a cited photo / manual / PLC-file / dated technician confirmation, **or** is explicitly
flagged **FIELD VERIFY**. It is model-first generated (YAML source of truth → deterministic
renderer) and independently graded against a published rubric (`RUBRIC.md`).

It **is not**: a certified as-built, an engineering-stamped drawing, a SCADA/CMMS, a live-connected
tool, an arc-flash/short-circuit/NEC study, or a control-write capability. It is **paper + data**:
read-only by construction.

**Instance-keyed, not family-keyed.** Unlike a Drive Pack (reusable across every GS10 in the world),
a Print Pack documents *one physical machine's* wiring. The **tooling** is build-once; each **pack**
is bespoke per asset.

### The three-tier approval ladder (preserve exactly — do not collapse)

| Tier | Meaning | Gate |
|---|---|---|
| **NOT APPROVABLE** | Any hard-fail present, or any reviewer < 90. Not sellable. | `validate_pack.py` reports a **critical FAIL (exit 2)**, or a rubric hard-fail, or a reviewer score < 90. |
| **APPROVABLE WITH FIELD VERIFICATION** | No hard-fails; every reviewer ≥ 90; **every** unknown is explicit and docketed. This is CV-101's current, **first-class, sellable** tier. | `validate_pack.py` reports **no critical FAIL (exit 0 or 1 — WARN-level findings are documented, docketed gaps, per §4)** + all reviewers ≥ 90 + every field-verify item present in the register. |
| **APPROVABLE** | Same bar, **plus** zero remaining field-verify items that block safe energization, closed by a **named** technician sign-off. | Additionally: every `open_item.status == closed` with a resolving citation, and `approval.customer_field_accepted_by` populated. |

**"APPROVABLE WITH FIELD VERIFICATION" is a distinct, sellable status — never silently upgraded to
"APPROVABLE", never represented as "AS-BUILT VERIFIED".** Check R enforces the boundary in code.

---

## 1. Customer intake (deliverable 2)

A pack is built from an **intake manifest** (`schema/intake_manifest.schema.yaml`, blank at
`schema/intake_manifest.template.yaml`). The manifest is the customer's declared machine + the
evidence they hand over. It is the *only* customer-authored input; everything else is generated.

The manifest names the asset (UNS-style path + free-text label), the customer/site (redactable),
the model source directory (the `model/*.yaml` set for this machine), the evidence bundle (photos,
manuals, PLC exports — each a path + a one-line provenance note), the requested build (`as_of` date,
output tier requested), and the sign-off names known at build time. **Unknowns stay blank** — the
build never invents a destination, terminal, rating, or relationship to fill a manifest gap.

---

## 2. Deterministic build (deliverable 3)

```
python machine-print-pack/build/build_pack.py \
  --package plc/conv_simple_electrical \
  --intake  machine-print-pack/examples/cv-101/intake_manifest.yaml \
  --as-of   2026-07-11 \
  --out     machine-print-pack/examples/cv-101
```

`--as-of` is **mandatory** and is the ONLY source of "now": no `datetime.now()`, no `Math.random`,
no unpinned timestamps anywhere in the pipeline. Same inputs + same `--as-of` ⇒ **byte-identical**
bundle (verified by `CHECKSUMS.txt` stability and the golden CI guard).

### Build steps (ordered; each REUSES existing tooling — never re-implements it)

1. **Gate.** Run `plc/conv_simple_electrical/validate_model.py` (checks A–L). Abort on any failure —
   a pack never builds from an ungated model.
2. **Render.** Invoke `render_sheet.py` `SET` target → all 9 sheets as `.svg`/`.png`/`.pdf` +
   the bound `CV-101_print_set.pdf`. Do not re-implement the renderer.
3. **Matrices.** Invoke `emit_matrices.py` → evidence / cross-ref / field-verify matrices.
4. **Data export.** Generate the machine-readable sub-artifacts (§3 b, g) from `model/*.yaml`.
5. **Documents.** Generate the derived documents (§3 c, d, e, f) from the model + matrices.
6. **Manifests + cover.** Write `pack_manifest.{json,yaml}`, the cover/status page, the bundle
   `README.md`.
7. **Checksums.** Compute `CHECKSUMS.txt` (sorted, relative paths, sha256) LAST, over every other
   file in the bundle.

### Determinism rules (hard)

- All JSON emitted with `sort_keys=True`, `ensure_ascii=False`, fixed separators, trailing newline.
- All YAML emitted with `sort_keys=True`, block style, fixed width.
- All CSV rows sorted by a stable key (sheet, then id/number); `\n` line endings.
- PDF metadata `creationDate`/`modDate` pinned from `--as-of` (never the wall clock).
- No archive/tar (mtimes leak) — the bundle is a plain directory tree.
- Pack-id (`source_ref`) derived from a **content hash of the source model**
  (`model/*.yaml`, line endings normalized) + `--as-of` — stable across git history,
  checkouts, and platforms. A live `git HEAD` would be circular (committing the bundle
  changes it) and unreliable on shallow CI clones, so it is deliberately not used.

---

## 3. Bundle layout — the 7 sub-artifacts (deliverable 4)

```
<bundle>/
├── README.md                       # bundle "start here" (§3 onboarding; G-05)
├── pack_manifest.json              # machine-readable pack index (+ .yaml)
├── pack_manifest.yaml
├── CHECKSUMS.txt                   # sha256 of every file (determinism/integrity)
├── prints/                         # (a) searchable PDF print set
│   ├── CV-101_print_set.pdf        #     bound 9-sheet + cover page, metadata, bookmarks, links
│   └── sheets/E-00N_*.{pdf,png}    #     per-sheet
├── data/                           # (b)+(g) connections/component data + machine-readable model
│   ├── components.csv              #     one row per device (untruncated)
│   ├── connections.csv             #     one row per conductor (40 on CV-101)
│   ├── terminals.csv               #     one row per terminal (~90, incl. unwired-but-named)
│   ├── pack_model.json             #     combined, normalized, lossless model export (+ .yaml)
│   └── pack_model.yaml
├── evidence/                       # (c) evidence & provenance report
│   ├── provenance_report.md        #     per-claim → citation, plain-language QA rollup
│   ├── evidence_matrix.csv         #     wire-level (from emit_matrices)
│   ├── crossref_matrix.csv         #     device+terminal-level
│   └── photos/                     #     redacted bench-photo thumbnails backing "verified" claims
├── open_items/                     # (d) unresolved-items register
│   ├── field_verify_register.csv   #     structured: id, sheet, severity, status, closed_by, ...
│   └── field_verify_register.md    #     human-readable docket
├── worksheets/                     # (e) field-verification worksheet
│   └── field_verification_worksheet.pdf   # printable, fillable; LOTO header; MEASURED/PASS/FAIL
└── approval/                       # (f) revision/approval record
    ├── revision_approval_record.yaml      # rev table + tier definition + 3 signature blocks
    └── cover_status.md                    # the customer-facing cover/status text (feeds prints/ page 0)
```

### Contents contract per sub-artifact

**(a) Searchable PDF print set.** The existing 9-page render, PLUS: a **page-0 cover/status** page
(asset, customer/site, scope line, **printed approval tier**, disclaimer); populated PDF **metadata**
(Title/Author/Subject/Keywords); a **bookmark** per E-0xx sheet; every "see E-0xx" cross-reference as
a real PDF **link**; and the **`·` (U+00B7) glyph text-extraction fix** so copy/search/KB-ingest get
clean tokens. Enhancements are additive to the already-commercial-grade text layer.

**(b) Connections / component data.** `components.csv` = one **untruncated** row per `devices.yaml`
entry (Tag/Type/Model/Role/Evidence/Source). `connections.csv` = one row per `wires.yaml` +
`e007_rs485.yaml` conductor (40 on CV-101): Wire#/From/To/Signal/Type/Status/Sheet/Notes. `terminals.csv` =
one row per `terminals.yaml` entry (~90): Device/Terminal/Function/Status — **including
verified-but-unwired terminals** (e.g. VFD1 FWD/REV/DI3-5) so nothing named silently disappears.

**(c) Evidence & provenance report.** Organized by sheet (E-002..E-009); each entry = claim, status
(verified/field_verify), citation (doc+line or photo+date). Device-identity "verified" claims
reference the **embedded redacted photo thumbnail** in `evidence/photos/`. Closes with a
**plain-language** QA rollup (per-reviewer scores, hard-fail history + fix confirmation, final
verdict) — distilled from `review/GRADES_FINAL.md`, **never** the raw adversarial ledgers (G-11).

**(d) Unresolved-items register.** The 28(+) open items, each with structured fields:
`id, sheet, item, verify, severity (safety-code | functional | informational), status (open |
closed), closed_date, closed_by, as_found, tooling_needed`. Resolutions are **fields, not prose
prepended to the item string**. This structured shape is the input to (e).

**(e) Field-verification worksheet.** Printable PDF generated from `open_items.yaml` + `wires.yaml`
+ `terminals.yaml` (never hand-maintained → can't drift). Header = asset id + date + technician name
+ **LOTO/e-stop safety reminder**. Body = checklist grouped by physical work sequence, each row:
id, location, what-to-check, expected/acceptance value ("24 VDC ±10%") or "record as found",
**MEASURED** blank, **PASS/FAIL** box, initials, date. Footer = "field verification completed by"
signature + date.

**(f) Revision/approval record.** A structured Rev/Date/Description/Author table (seeded from the
real V2→V3 history + this bundle's commercial delta); the **plain-language definition** of
"APPROVABLE WITH FIELD VERIFICATION"; and **three** signature blocks that separate the two sign-off
moments this pack currently conflates — `prepared_by`, `engineering_reviewed_by` (the 4-reviewer
panel, done), and `customer_field_accepted_by` (blank until the customer's technician signs after
their own review).

**(g) Machine-readable model.** One generated `data/pack_model.json` (+ `.yaml`) combining
devices+terminals+wires+e007+e002+open_items+sheets **losslessly**; the confirmed-status key
**normalized to one field name** (`status`) across the whole export (source files split
`status:`/`evidence:` — normalize on export, do not edit the sources); citations structured as
`{doc, locator}` / `{photo, date}`; an explicit top-level `pack_format_version` separate from the
drawing `revision`. "Generated — do not hand-edit," same discipline as the matrices.

---

## 4. Commercial validation (deliverable 7) — checks M–R

`validate_pack.py --bundle <dir>` runs the **bundle-level** commercial gate. It **complements**
`validate_model.py` (drawing correctness, A–L); both must be green for a bundle to be
commercial-ready. Exit `0` = pass, `1` = recoverable warnings, `2` = critical (never ship).

- **M — Missing evidence.** Every `verified` entry across devices/terminals/wires/e007/e002 must
  carry a citation that **resolves**: `<file> L<N>[-<M>]` ⇒ file exists and has ≥ N (or M) lines;
  `photo <path>` ⇒ path exists. (Closes the D/E gap that let a wrong-line-number citation ship.)
- **N — Broken cross-references.** Every `E-0\d\d` token in any annotation/lineage/note names a real
  sheet; any device appearing on ≥ 2 sheets whose annotations don't reciprocally cross-cite fails.
- **O — Duplicate conductors.** Normalize each wire to `frozenset({from, to})`; any physical
  conductor claimed by two wire numbers (incl. reversed endpoints) fails.
- **P — Unsupported claims.** For every open item whose text contains "RESOLVED", the citing
  `source:` must point at the **highest-versioned** `PHOTO_EVIDENCE_V*.md` that mentions that item id
  (the exact rule HF-A violated). Secondary: flag any rendered sentence with a number+unit / model /
  "confirmed|verified|RESOLVED" and **no** citation in its annotation block.
- **Q — Sheet consistency.** (i) each rendered "N of 9" equals live `sheets.yaml` position; (ii) each
  rendered subtitle is byte-identical to `sheets.yaml.subtitle`; (iii) any `sheets.yaml` field
  referenced by no annotation list is dead data → fail; (iv) E-008 rows == `len(wires)+len(e007)`,
  E-009 rows == `len(open_items)`.
- **R — Incomplete approval status.** (i) the bundle may be labeled plain **APPROVABLE** only if
  **zero** open items lack `status: closed`; (ii) every "RESOLVED" item's citation resolves under M;
  (iii) `approval.prepared_by` is non-blank when bundle status is `released` —
  `customer_field_accepted_by` may stay blank (it is the customer's field moment, not ours).

---

## 5. Included / Excluded / Never-Inferred (drives README §honesty)

**INCLUDED:** the 9 sheets; every modeled conductor (40 on CV-101) tagged verified/field_verify (never silently
upgraded); every modeled terminal (~90); every device (14) with evidence status; the full open-items
docket; the distilled QA record; the combined machine-readable model; the redacted bench-photo
evidence behind each "verified" device-identity claim.

**EXCLUDED (state plainly):** the PLC program/ladder itself (cited as evidence, not delivered); any
asset other than the documented machine (adjacent panel devices are logged, not wired in); a
certified as-built; load/arc-flash/short-circuit/NEC studies; internal terminal-strip layouts not
observed; any control-write capability.

**NEVER INFERRED (the hard rule):** conductor destinations not directly observed; terminal ids not
read off a nameplate/manual/photo; ratings not read off a nameplate/manual; device relationships not
directly evidenced (proximity in a photo is not a relationship); a technician's field statement
unless directly quoted and dated; anything "filled in" for drawing completeness.

---

## 6. MIRA integration (additive, through stable schemas)

The exported bundle is **useful standalone** (a technician with the PDF + CSVs needs no MIRA). MIRA
integration is **additive** and flows through already-built seams — it never becomes a build
dependency:

- `data/pack_model.json` is the stable contract other tools consume.
- `tools/wiring_map_import.py` already turns the same `model/*.yaml` into proposed
  `wiring_connections` rows (evidence-preserving, `approval_state='proposed'`) — a Print Pack becomes
  a Machine Pack's `wiring_map` section and one cited leg of the deterministic diagnostic evidence
  chain. See `ROADMAP.md` stage (c).

---

## 7. Roadmap (deliverable 9) — see `ROADMAP.md`

(a) **Productized manual service** — build packs today with the existing tooling (zero new code
beyond this product); (b) **MIRA Print Studio** — assisted/self-serve intake reusing Hub upload doors
+ vision-assist + the `ai_suggestions` review surface; (c) **Connected Machine Pack** — the model
flows through `wiring_map_import.py` into `wiring_connections` as the electrical-documentation layer
of the larger MIRA Machine Pack.

---

## 8. Non-negotiables (repeat of the hard rules)

1. Never represent generated content as field-verified. Generated = model-drawn; verified = cited;
   field_verify = must be metered.
2. Preserve "APPROVABLE WITH FIELD VERIFICATION" as a distinct, sellable status.
3. Unknowns stay explicit — never invent conductor destinations, terminals, ratings, or device
   relationships.
4. The exported bundle is useful without MIRA.
5. All MIRA integration is additive, through stable schemas.
6. Deterministic: same inputs + `--as-of` ⇒ byte-identical bundle.
