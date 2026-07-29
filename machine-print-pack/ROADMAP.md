# MIRA Print Pack — Roadmap

Three stages, from a hand-built service to a live leg of MIRA's diagnostic evidence chain. Each
stage is grounded in tooling that's either already proven on the CV-101 reference pack or already
built and proven elsewhere in MIRA — no stage requires inventing new infrastructure from scratch.
This is a packaging and sequencing roadmap, not a research plan.

For each stage: what exists today, what's still needed, and the one dependency that actually
unblocks it. Marked plainly — built vs. planned.

---

## Stage (a) — Productized manual service

**Sellable today.** The electrical content, the grading discipline, AND the deterministic build
wrapper now all exist end-to-end on the CV-101 reference pack. What remains is business packaging,
not engineering.

### What exists today

- `render_sheet.py`, `validate_model.py`, and `emit_matrices.py` — proven end-to-end on the CV-101
  reference pack (9 sheets, `validate_model.py` 12/12 checks passing).
- The 100-point, 4-reviewer grading rubric — already run on CV-101, unanimous **APPROVABLE WITH
  FIELD VERIFICATION**. See `RUBRIC.md`.
- The customer intake manifest schema, a blank template, and one real, filled example
  (`schema/intake_manifest.schema.yaml`, `schema/intake_manifest.template.yaml`,
  `examples/cv-101/intake_manifest.yaml`).
- `SPEC.md` — the build contract every piece below satisfies.
- `machine-print-pack/build/build_pack.py` — the deterministic orchestrator `SPEC.md` §2 describes
  (gate → render → matrices → data export → documents → manifests/cover → checksums). Built and
  proven: same inputs + `--as-of` produce a **byte-identical** bundle (double-build `diff -rq`
  clean). It composes the proven tools above — no new drawing engine.
- `machine-print-pack/build/validate_pack.py` — the bundle-level commercial gate (`SPEC.md` §4,
  checks M–R: missing evidence, broken cross-references, duplicate conductors, unsupported claims,
  sheet consistency, incomplete approval status). Reserves a critical FAIL for the real hard-fails
  and surfaces low-severity gaps as documented warnings.
- The full generated bundle — cover/status page, searchable PDF (metadata + bookmarks + links), the
  field-verification worksheet PDF, the structured field-verify register (severity, status,
  closed_by, closed_date, as_found as real fields), the revision/approval record, and the combined
  `pack_model.json`/`.yaml` export — all produced by the tooling and committed as the CV-101 example
  bundle (`examples/cv-101/`), plus `redact.py` for the redacted example.
- A CI guard (`tests/test_machine_print_pack.py`, wired into `.github/workflows/ci.yml`) that proves
  the build stays deterministic and the validator stays green against the golden CV-101 bundle.

### What's needed

- A pricing unit and a one-page "what to send" intake checklist — packaging and business decisions,
  not technical ones.
- A second hand-built pack on a different machine family, to prove the manual process generalizes
  past CV-101's conveyor (also the open sequencing question in Stage (b)).

### Dependency that unblocks it

None external, and the engineering is done. The pricing unit is a business call, not a blocker:
device-count, sheet-count, and open-item-count come straight out of the model, so a pack's own
generated artifacts double as the basis for a quote whenever that call gets made.

---

## Stage (b) — MIRA Print Studio

**Assisted / self-serve intake**, once Stage (a)'s deterministic build exists to draft into.

### What exists today

- The MIRA Hub's upload doors — folder upload, MiraDrop, Telegram photo/document intake — already
  built and already used elsewhere in MIRA.
- The vision-assist path (image → symbols → traced connections) — already scoped elsewhere in the
  codebase.
- The `ai_suggestions` review surface — MIRA's one approval system. Every proposal lands unreviewed
  until a human promotes it; there is no second, parallel review tool to build.
- An already-written extraction-workflow sequence for turning photos into a wiring-model draft, which
  this stage generalizes rather than reinvents.

### What's needed

- Generalizing that workflow from wiring-only to the full print-pack model — devices, terminals,
  wires, sheets, and open items — so a technician can drop a batch of panel photos in an inbox and
  get back a **DRAFT** candidate pack, with every fact `field_verify`/proposed until a human reviews
  it, instead of hand-authoring the model file by file.
- Routing that draft through the same grading and validation gate Stage (a) builds. Print Studio
  speeds up intake and first-draft modeling — it does not shortcut grading.

### Dependency that unblocks it

Stage (a)'s build/validate pipeline landing first — an assisted draft needs a deterministic target
to build into and grade against; there's no point automating intake into a format nothing can
validate yet. There's also an open sequencing question, not yet decided: whether to build Print
Studio before or after a second hand-built pack, on a different machine family, proves the manual
process generalizes past CV-101's conveyor.

---

## Stage (c) — Connected Machine Pack

**The pack's data becomes a live leg of MIRA's diagnostic evidence chain**, once a pack has real
verified rows for a customer's machine.

### What exists today

- `tools/wiring_map_import.py` — a proven, already-built, idempotent CLI with a dry-run mode,
  already exercised against CV-101. It reads the exact same source model that produces the print
  pack and writes rows into the MIRA Hub's `wiring_connections` table as tenant-scoped,
  `approval_state='proposed'` rows. Nothing is upgraded or invented in transit — a `field_verify`
  fact stays a `field_verify` fact on the way in.

### What's needed

- Pointing the importer at a real paying customer's tenant. Today it's proven against the reference
  asset; it isn't yet routine, per-customer production use.
- Device-level linkage from a pack's device schedule to MIRA's reusable component templates — this
  is explicitly out of scope for `wiring_map_import.py` today (its own documentation names this a
  separate, smaller follow-on, not a gap in this roadmap).
- The broader Machine Pack composition this becomes a layer of — wiring map alongside live tag
  state, PLC interlock analysis, and drive-pack cards, composed by MIRA's deterministic diagnostic
  evidence chain. This is scoped in the separate Machine Pack plan, not invented here.

### Dependency that unblocks it

A Print Pack with real verified rows for the target customer's machine. The import seam itself is
not the blocker — it already works — it's waiting on Stage (a) or (b) to produce something worth
importing.

---

## What doesn't change across stages

Three things hold at every stage, not just Stage (a):

- **The bundle is useful standalone.** A technician with the files needs nothing from MIRA at any
  stage.
- **Nothing is ever silently upgraded.** A `field_verify` or `proposed` fact stays that way until a
  human, not a script, promotes it.
- **"APPROVABLE WITH FIELD VERIFICATION" stays a distinct, sellable tier at every stage.** Stage (c)
  connects a pack's data to a live diagnostic system — it does not quietly turn a field-verified pack
  into an as-built.
