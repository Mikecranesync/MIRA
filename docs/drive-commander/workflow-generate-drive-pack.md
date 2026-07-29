# Generate a drive pack from a PDF manual

> Doctrine: [`drive-pack-trust-doctrine.md`](drive-pack-trust-doctrine.md). **The drive pack is
> not trusted because the extractor ran. It is trusted only when open, reproducible checks prove
> the JSON matches the source PDF within declared limits.** This doc is the *generate* half of
> that story (PR-A tool → a candidate pack). Grading (PR-B trust) is a separate step — see
> [`workflow-grade-drive-pack.md`](workflow-grade-drive-pack.md).

## What this produces

A **staged candidate** `pack.json` + `PROVENANCE.md` under
`tools/drive-pack-extract/candidates/<pack_id>/` — **NOT** the live served
`mira-bots/shared/drive_packs/packs/<pack_id>/` tree. "Staged candidate" is load-bearing: nothing
this workflow does assigns trust, and nothing this workflow does deploys the pack — the runtime
`resolve_pack()` cannot see anything under `candidates/`. It only proves the JSON is well-formed,
schema-valid, and every field traces to a specific page of the manual it was generated from.
**Promotion** of a candidate into the live `packs/` tree is a separate, later, human-gated step —
see "Promotion (candidate → live)" in
[`runbook-pr-b-acceptance.md`](runbook-pr-b-acceptance.md) — required by
`.claude/rules/train-before-deploy.md`.

## Required inputs

- The real, licensed OEM manual PDF, downloaded to a **local, gitignored** path. It is never
  committed (see "Never commit the manual" below).
- A generator script for the target family. Today: `generate_pf525_pack.py` (PowerFlex 525). Each
  new family gets its own generator — see
  [`runbook-adding-a-drive-family.md`](runbook-adding-a-drive-family.md).

## Where to put the manual locally

Anywhere under `tools/drive-pack-extract/` that matches the tool's `.gitignore`. The existing
patterns already cover a `manuals/` scratch subdirectory and any `pf525_*.pdf` / `*520-um001*`
filename — so `tools/drive-pack-extract/manuals/pf525_520-um001.pdf` is a safe, git-ignored drop
location. You may also point `--manual` at a path entirely outside the repo (e.g. your
Downloads folder) — the generator only reads it, and its own writes never touch the manual.

## The exact extraction command (PowerFlex 525)

```bash
cd tools/drive-pack-extract
python generate_pf525_pack.py --manual "<absolute path to manual.pdf>"
```

This writes:

- `tools/drive-pack-extract/candidates/powerflex_525/pack.json`
- `tools/drive-pack-extract/candidates/powerflex_525/PROVENANCE.md`

Neither file lands under `mira-bots/shared/drive_packs/packs/` — the live served tree is
untouched by this command, so there is **no runtime resolver behavior change** from running it.

Page ranges are **baked into the generator**, not passed on the command line — see
`FAULT_PAGES` / `PARAM_PAGES` in `generate_pf525_pack.py`. For PF525 today: fault table pp.
161–165; parameters pp. 65, 66, 99–103. Page 98 is deliberately excluded (see "Partial extraction
/ page-range scoping" below).

To write somewhere other than the default candidate directory (e.g. a scratch location to inspect
output before it's even added to the candidates tree), pass `--out <dir>`.

## Expected outputs

- **`pack.json`** — a full schema-v2 pack: `pack_id`, `schema_version`, `family`, `nameplate`,
  `live_decode.fault_codes` (cited), `parameters[]` (cited), `envelope`/`knowledge` (empty —
  no bench data for a manual-only pack), `provenance`, `keypad_navigation` (empty — see below).
- **`PROVENANCE.md`** — human-readable record of what was generated and how.
- Console output reporting the fault count and parameter count, and confirming the just-written
  candidate validates against `drive_packs.loader._parse_pack(...)` — the real, unmodified schema
  validation logic, run directly against the candidate file since the loader's own
  `load_pack(pack_id)` only reads the live served `packs/` tree (the generator **fails closed** —
  non-zero exit — if the candidate it just wrote doesn't pass schema validation).

A real run against the licensed PF525 manual (520-UM001O-EN-E rev O) recovers 48 fault rows off
pp. 161–165 and the diagnostic-critical parameter set off the grid + labeled-block pages — see
`tools/drive-pack-extract/README.md` § "Verified against the real manual" for the exact recovered
sample.

## How provenance is recorded

`PROVENANCE.md` (auto-written by the generator, never hand-edited) captures:

- **Manual identity** — vendor, family, publication number, revision, date, source filename.
- **`sha256`** of the source PDF, computed from the file the script actually read. The generator
  also prints a NOTE (non-fatal) if the hash doesn't match the previously-verified PF525 manual
  (`b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6`) — a different edition can
  still be processed, this is a sanity signal, not a gate.
- **Page ranges used**, per table (fault-code table vs. the two parameter layouts).
- **Extraction command** — the literal `extractor.extract(...)` call with its page-range
  arguments, plus the exact CLI invocation (`python generate_pf525_pack.py --manual ...`).
- **Extractor git short-sha** (`tools/drive-pack-extract/extractor.py` at generation time) — so a
  later extractor change is distinguishable from the manual content itself.
- **Result counts** — fault codes and parameters extracted, both already cite-integrity verified
  (the extractor drops anything that fails verification before the generator ever sees it — see
  `tools/drive-pack-extract/README.md` § "The cite-integrity guarantee").
- **Sanitized fields** — any `parameter_id.field` the generator nulled out as unreliable cross-row
  bleed (see below), listed explicitly rather than silently dropped.

## Avoiding a proprietary/large manual in git

`tools/drive-pack-extract/.gitignore` blocks the real manual by three independent patterns
(`pf525_*.pdf`, `*520-um001*`/`*520-UM001*` case variants, and a whole `manuals/` directory), with
an explicit `!fixtures/pf_sample.pdf` allowlist for the committed **synthetic** fixture. Never add
a `git add -f` override for the real PDF, and never rename it to dodge the pattern — the point is
that the licensed, ~34 MB manual has no business in version control at all.

## Partial extraction / page-range scoping

The generator's `FAULT_PAGES` / `PARAM_PAGES` constants are the scoping knob. When a page's layout
defeats the position-aware parser (a multi-column region that produces duplicate or bled fields),
the right move is:

1. **Exclude the page** from the relevant constant, with a comment explaining why (see the PF525
   generator's page-98 comment: a 3-column Analog Output block that isn't diagnostic-critical and
   isn't in the gold set).
2. **Declare it a residual** — in `PROVENANCE.md`'s notes and later at grading time via
   `grade.py --residual "..."` (see [`workflow-grade-drive-pack.md`](workflow-grade-drive-pack.md)).
   Precision over recall: an honestly-scoped gap beats a duplicate or bled value.
3. **Widening the scope is an extractor change (PR-A), not a pack change.** If a messy page later
   needs to be included, harden `extractor.py` first, fold the discovered messiness into the
   synthetic fixture (`_make_pf_sample_pdf.py`), and only then widen the generator's page list.

The generator also **fails closed on duplicate `parameter_id`s** (`_coerce_parameters` raises
rather than silently keeping one) — a page range that reintroduces an ambiguous multi-code row
must be narrowed, not worked around downstream. It also **sanitizes cross-row bleed**
(`_sanitize_param_bleed`): a `default`/`unit`/`range` value that carries a foreign parameter-id
token, a `=` sign, a model-conditional phrase, or an unrecognized unit is nulled rather than
shipped, and every nulled field is listed in `PROVENANCE.md`.

## Cross-references

- [`drive-pack-trust-doctrine.md`](drive-pack-trust-doctrine.md) — the doctrine
- [`workflow-grade-drive-pack.md`](workflow-grade-drive-pack.md) — the trust check on this output
- [`runbook-pr-b-acceptance.md`](runbook-pr-b-acceptance.md) — the full generate→grade→sign-off flow
- [`runbook-adding-a-drive-family.md`](runbook-adding-a-drive-family.md) — onboarding a new family
- `tools/drive-pack-extract/grading/GRADING_SPEC.md` — the grading contract
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` — the product decision
- `tools/drive-pack-extract/README.md` — the extractor internals
