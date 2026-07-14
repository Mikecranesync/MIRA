# drive-pack-extract

Offline tool: turns an OEM drive manual PDF into structured, **cited**
drive-pack fragments — fault codes, configurable parameters, and (where a
clean procedure exists) keypad navigation — matching the shapes in
`mira-bots/shared/drive_packs/schema.py`.

This is **PR-A**: the reusable extractor + its cite-integrity framework. It
does not ship the real PowerFlex pack (that's **PR-B**, a separate offline
run over the licensed manual) and it never touches
`mira-bots/shared/drive_packs/` runtime code.

**Hardened (this pass):** the first version of this tool passed only against
an idealized synthetic fixture and produced dirty/wrong output on the real
PowerFlex 520-UM001 manual (polluted fault names, dropped grid Min/Max and
Default columns, and a semantically-backwards `related_faults`). It has
since been rewritten to parse **position-aware** (`extract_words()`
x0/top coordinates, not `extract_text()` line-regex) and re-verified against
the real manual's fault table (pp.161-165) and parameter tables (grid
p.65-66, labeled-block p.100-103) — see "Verified against the real manual"
below for the actual recovered sample.

## Read-only, no fieldbus, no writes beyond the returned JSON

This tool reads a PDF file and returns a Python dict / JSON fragment. It
never opens a fieldbus socket, never touches a PLC/VFD, never writes to a
database, and never writes the shipped `pack.json` files under
`mira-bots/shared/drive_packs/packs/` — see `.claude/rules/fieldbus-readonly.md`
and ADR-0025. The only file I/O is: read the source PDF (once per call,
plus once more per entry during cite-integrity verification), read the
generated fixture PDF in tests.

## What it does

- **`extractor.parse_faults(pdf_path)`** — opens the PDF itself and parses
  every page's fault table, **position-aware**: it bins each page's
  `extract_words()` into a Code/Name/Fault-Type band (left of the
  Description column) and an Action band (right of it), using x-coordinates
  discovered from that page's own header row. Returns `{code:int, fault_id,
  name, fault_type, action, references_parameters, page, excerpt}` dicts.
  Handles the real manual's SHARED multi-code rows (e.g. `F038/F039/F040
  "Phase U/V/W to Gnd"` sharing one Fault-Type) by emitting **one entry per
  code**, never a merged entry — including the case where the shared
  Fault-Type value renders BETWEEN member lines rather than after the last
  one (confirmed on the real manual).
- **`extractor.parse_parameters(pdf_path)`** — dispatches PER PAGE by header
  shape between the two layouts a real manual uses:
  - **grid layout** (`P042 [Decel Time 1] ... Min/Max ... Display ...
    Default ...`, columns separated ONLY by x-position, wrapping
    independently across multiple lines) — parsed position-aware via
    `extract_words()`, recovering Min/Max and Default even when they wrap
    across several lines and the code+name line itself renders in the
    MIDDLE of that span (the real manual's actual P031 "Motor NP Volts" row).
  - **labeled-block layout** (`C125 [Comm Loss Action] Related Parameters:
    P045` followed by `Default:` / `Values Min/Max:` / `Options:` label
    lines, or the real manual's quoted `0 "Fault" (Default)` per-line enum
    shape) — parsed off `extract_text()` lines, which are already clean for
    this layout.
- **`references_parameters`** (on a fault) / **`related_faults`** (on a
  parameter) are populated **only** from explicit manual text, and the
  DIRECTION matters — this is the semantic fix from the hardening pass:
  - A fault's action text says "Modify using C125 [Comm Loss Action]" — that
    is a FAULT → PARAMETER reference, captured as `references_parameters`
    on the fault (e.g. `F081.references_parameters == ["C125"]`).
  - A parameter's `related_faults` is the **inverse** of that relationship,
    built by `extractor.link_fault_actions_to_parameters(faults, parameters)`
    AFTER both tables are parsed (e.g. `C125.related_faults == ["F081",
    "F082", "F083"]` — all three faults whose action references C125).
  - A parameter's OWN "Related Parameters: Pxxx" line (param↔param) is
    captured separately as `related_parameters` and NEVER feeds
    `related_faults` — putting a parameter id in `related_faults` was the
    critical bug this hardening pass fixed (verified on the real manual: the
    old code produced `t091.related_faults == ["P043", "t092", "t093"]`,
    all parameter ids).
  - Nothing here is ever inferred from co-mention. A fault/parameter with no
    explicit cross-ref gets an empty list — sparse but honest.
- **`extractor.assemble_pack_fragment(faults, parameters, doc=...)`** —
  reshapes the parsed entries into a drive-pack-shaped JSON **fragment**:
  `fault_codes` (int→name, for `live_decode.fault_codes`), `fault_citations`
  (per-fault manual references — not part of the frozen schema, but not
  discarded either), `parameters[]` (`ParameterCard`-shaped dicts with
  `source_citation`, `provenance_tier="manual_cited"`), and an empty
  `keypad_navigation` (PR-A found no clean button-press procedure worth
  citing in the fault/parameter pages it targets — that's fine, an empty
  list is honest, not a gap to paper over).
- **`extractor.extract(pdf_path, doc=None)`** — the end-to-end entry point:
  reads the PDF, parses faults + parameters, links fault→parameter
  references into each parameter's `related_faults`, runs the
  cite-integrity gate (below) on every entry, and returns the assembled
  fragment.

## Citations stay honest even though extraction is position-aware

Building `name`/`fault_type`/`range`/`default`/`references_parameters` from
column-binned words (rather than a single `extract_text()` line) means the
words that produced a field aren't necessarily one contiguous run of the
page's own text. Excerpts are NOT reassembled from those bins — each entry's
`excerpt` is the ONE physical `extract_text()` line that literally starts
with its code (`_find_raw_line`), so it is guaranteed to be a verbatim,
contiguous substring of the page regardless of how the structured fields
were derived. Cite-integrity verification is unchanged and still re-derives
the ground truth independently (below).

## The cite-integrity guarantee (`cite_integrity.py`)

Every entry the extractor emits claims a manual excerpt lives on a specific
page. `cite_integrity.verify_excerpt_on_page(pdf_path, page, excerpt)`
**re-opens the PDF from disk** and checks that `excerpt`'s words genuinely
appear on that page (in order, tolerant of `extract_text()`'s line-wrapping
via whitespace normalization) — it never trusts what the caller claims.

`extractor.verify_and_filter_entries(...)` calls this on **every** parsed
entry before it's allowed into the output; anything that fails is **dropped**
(and logged), never emitted. This means the extractor is structurally
incapable of shipping a fabricated citation — even a bug in the regex
parsing that produced a bogus excerpt gets caught here rather than
propagating into a pack.

`tests/test_extract.py` proves this gate has teeth (mirrors
`mira-bots/tests/test_drive_packs_readonly.py`'s catch-synthetic-violations
self-test): a real excerpt verifies, a fabricated one does not, and feeding
`verify_and_filter_entries` a mix of a real + a fabricated entry keeps only
the real one.

## Verified against the real manual

Re-run offline against the real, licensed `pf525_520-um001.pdf` (kept out of
git — not present in this repo) after the position-aware rewrite:

**Faults (pp.161-165, all 48 rows on those pages) — clean names, correct type,
correct cross-refs:**

| Fault | Name | Type | references_parameters |
|---|---|---|---|
| F000 | No Fault | — | [] |
| F004 | UnderVoltage | 1 | [] |
| F013 | Ground Fault | 1 | [] |
| F038/F039/F040 | Phase U/V/W to Gnd | 2/2/2 | [] |
| F081 | DSI Comm Loss | 2 | ["C125"] |
| F082 | Opt Comm Loss | 2 | ["C125"] |
| F083 | EN Comm Loss | 2 | ["C125"] |

(previously: `F004 → "UnderVoltage 1"`, `F000 → "No Fault — No fault present. —"`
— footnote/description text bled into the name.)

**Parameters (grid p.65-66) — range/default recovered, not `None`:**

| Param | Name | Range | Default | Unit |
|---|---|---|---|---|
| P032 | Motor NP Hertz | 15/500 | 60 | Hz |
| P035 | Motor NP Poles | 2/40 | 4 | poles |
| P036 | Motor NP RPM | 0/24000 | 1750 | rpm |
| P041 | Accel Time 1 | 0.00/600.00 | 10.00 | s |
| P042 | Decel Time 1 | 0.00/600.00 | 10.00 | s |
| P043 | Minimum Freq | 0.00/500.00 | 0.00 | Hz |
| P044 | Maximum Freq | 0.00/500.00 | 60.00 | Hz |

(previously: `P031 Motor NP Volts → range=None, default=None` for every grid
row — `extract_text()` silently dropped the Min/Max and Default columns.)

**`related_faults` semantics — the critical fix:**

```
C125 [Comm Loss Action]
  related_faults      = ["F081", "F082", "F083"]   # FAULT codes (correct)
  related_parameters  = ["P045"]                    # its OWN "Related Parameters:" line
```

Before the fix, `C125.related_faults` (and every other parameter's) held
**parameter ids** captured off the wrong text — e.g. `t091.related_faults ==
["P043", "t092", "t093"]`. `related_faults` on a parameter now ONLY ever
contains fault codes, derived by inverting each FAULT's own outbound
`references_parameters` (from its "Modify using <PARAM>" action text) —
never sourced from a parameter's own "Related Parameters:" line.

**Honest residual gaps** (not fixed, not required by the current scope):
- Grid rows sharing a comma-separated code group (e.g. `P046, P048, P050
  [Start Source 2]`, each with its OWN default) are detected and SKIPPED
  entirely rather than emitting one with an invented/ambiguous attribution
  — "invent nothing" over partial recall. Their Min/Max/Default text can
  still bleed onto whichever surviving single-code parameter is nearest.
- A handful of grid rows with compound, non-numeric ranges (`P031 "10V (for
  200V Drives)...`) or enum-style labeled-block defaults with no `Default:`
  line keep `range`/`default` as `None` — genuinely not a clean numeric
  value in the source, not a parsing failure.
- Purpose/description free text is best-effort (nearest-row assignment) and
  can pick up a neighboring row's text at a column-overlap boundary; it is
  not part of the cite-integrity-checked citation (see below) and is not
  graded by this hardening pass.

## The synthetic fixture

`_make_pf_sample_pdf.py` generates `fixtures/pf_sample.pdf` — reproducible
(`python _make_pf_sample_pdf.py`, no network), reuses reportlab (the same
library `tests/beta/fixtures/_make_gs10_pdf.py` uses). It is **not** the real
manual: every page carries a "SYNTHETIC TEST FIXTURE — not a licensed
manual" footer, and none of its fault/parameter text is copied from any
licensed source.

Unlike the original (idealized, column-collapsed) version, this fixture
reproduces the real manual's MEASURED messiness by drawing each logical
column as its own text object at an explicit (x, y) coordinate — position-only
column separation, exactly like the real PDF:

- a fault row's Description rendering on a DIFFERENT physical line than its
  own Code/Name/Fault-Type line (the real F004 row's actual layout)
- a footnote paren glued directly onto a code (`F015(3)`) and onto a
  Fault-Type value instead (`F013 ... 1(2)`)
- the em-dash Fault-Type/Action for the "no fault" row (`F000`)
- a shared multi-code group whose Fault-Type value renders BETWEEN member
  lines, not after the last one (`F038`/`F039` close on a bare "2"; `F040`
  still follows)
- a fault→parameter cross-reference ("Modify using C125 [...]") whose action
  text renders ABOVE its own code line (the real F081 row's inversion)
- a grid parameter whose Min/Max wraps across 4 lines with its own code+name
  line landing in the MIDDLE of that span (the real P031 row)
- a footnote-DEFINITION line gluing a bracket reference to another
  parameter's id with no space (`"A535[Motor"`), between two real rows
- a labeled-block parameter's quoted, one-per-line enum options with an
  inline `"(Default)"` marker, instead of a synthetic `"Options: ..."` line

So the parser and its tests exercise every documented real-manual defect
without ever reading the real manual in CI.

## How PR-B will use this

PR-B is a separate, offline run: point `extractor.extract()` at the real
`pf525_520-um001.pdf` (kept out of git — 32.9 MB, licensed), inspect what it
extracts, and hand-merge the resulting fragment (`fault_codes`,
`fault_citations`, `parameters`) with the family/nameplate/
`live_decode.status_bits`/`cmd_word`/envelope data that only bench
verification (not manual text) can supply, into a full `pack.json` under
`mira-bots/shared/drive_packs/packs/<new_family>/`. That PR is where the
real manual gets read; this one only proves the tool works, on fixture data
that ships with the repo.

## Running the tests

```bash
python -m pytest tools/drive-pack-extract/tests/ -q
```

`tools/drive-pack-extract/tests/conftest.py` puts the tool directory on
`sys.path` so `extractor` and `cite_integrity` import as plain top-level
modules (the tool lives in a hyphenated directory, so it can't be a normal
importable Python package).

---

## Universal VFD Manual Compiler (generalize beyond PowerFlex/Magnetek)

The original `extractor.py` is a set of **exact-header dialects**: a page yields
records only if it carries a verbatim header phrase (`"Description"`+`"Action"`
for PowerFlex faults, `"Name/Description"` for Magnetek). On five unseen vendors
(Yaskawa GA500, ABB ACS580, Schneider ATV320, Siemens G120X, Delta VFD-E) that
gate never fires — recovery was **0/5**.

The **Universal Compiler** replaces exact-header gating as the *primary*
architecture with a vendor-agnostic pipeline. Exact vendor phrases still *boost*
confidence; they are never *required*.

```
document_ir  ->  table_discovery  ->  [dialect_registry | generic_table_parser]
             ->  llm_region_repair (optional)  ->  evidence_validator
             ->  universal_extract (canonical JSON + evidence)
```

| Module | Role |
|---|---|
| `document_ir.py` | One-pass pdfplumber normalization: words+bbox, ruling edges, ruled `extract_tables`, text, OCR status. |
| `table_discovery.py` | Finds fault/parameter table candidates by a repeated **identifier column** + role vocabulary. No exact phrase required. |
| `schema_inference.py` | Maps arbitrary vendor headers (`What to do`/`Remedy`/`Possible Solutions`) onto canonical roles; classifies id shapes (numeric/alnum/dotted). |
| `generic_table_parser.py` | `ruled` (pdfplumber cells) / `unruled` (word-position columns) / `block` (id + `Cause:`/`Remedy:` prose) routes. Source-preserved string ids; wrapped-row merge. |
| `dialect_registry.py` | Wraps the proven PowerFlex + Magnetek parsers as scored plugins. Generic is the fallback where no dialect fires — so existing dialect tests stay green. |
| `evidence_validator.py` | Reuses `cite_integrity` to prove every record's excerpt on its page; rejects unverifiable; attaches field-level evidence. |
| `llm_region_repair.py` | Region-bounded, **offline by default** (`MIRA_DRIVE_LLM_REPAIR=1`), cascade Groq→Cerebras→Together (no Anthropic), source-validated, emits learning artifacts. |
| `universal_extract.py` | Orchestrator + CLI. Honest status: `COMPLETE` / `PARTIAL` / `NO_TABLES_FOUND` / `TABLES_FOUND_NOT_PARSED` / `FAILED`. A zero-record run is never a success. |

```bash
python universal_extract.py MANUAL.pdf --output result.json --evidence-dir evidence/
```

Canonical output: `faults[]` and `parameters[]` (string `id`, casing preserved),
document identity + provenance (sha256), status + coverage, rejected candidates
with reasons, and field-level citations. The legacy integer `fault_codes` map is
**derived** (numeric ids only) — a mnemonic code is never assigned an invented
integer. Still read-only / offline; never writes a shipped `pack.json`.

Benchmark results (before/after per manual) and measured-vs-gap gate analysis:
`docs/eval/universal-vfd-compiler-results.md`.
