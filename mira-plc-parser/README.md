# MIRA PLC Parser

**Read-only, vendor-agnostic PLC program-export analysis.**

> Mission: take PLC program exports from different vendors, parse them into **one** common MIRA
> format (the IR), and extract **maintenance intelligence** — tags, routines, outputs, faults,
> interlocks, sequences, and asset mappings — **without ever writing to a PLC or translating between
> vendor languages.**

This is a parser + normalizer + analysis pipeline, not a PLC program writer. The first question it
answers is *"what can we reliably extract from this export?"* — not *"can we rewrite this program
into another vendor's language?"* (That is a much harder, later, higher-risk product.)

## Why an intermediate representation

Different vendors store logic differently — Rockwell L5X, Siemens TIA/Openness XML, PLCopen XML,
CODESYS/OpenPLC Structured Text, AutomationDirect, plain CSV tag exports, even PDFs. Rather than
teach MIRA every file format, each **parser** converts its input into the **MIRA PLC IR**, and all
analysis runs against the IR. The schema matters more than any single parser — it is what lets MIRA
eventually support *almost any* PLC program, and it is the foundation for document analysis, tag
mapping, the i3X/MCP surfaces, and customer-facing APIs.

```
upload → detect format → vendor parser → MIRA PLC IR → deterministic analysis → report
                                          (the neutral model)   (rule-based first; LLM explains later)
```

## What's built (Phase 1–2)

| Stage | Status |
|---|---|
| File-format / vendor **detector** (content-first) | ✅ L5X, CSV, PLCopen XML, ST; +routing stub for Siemens |
| **Rockwell L5X parser** → IR (controller, datatypes, tags, programs, routines, rungs, rung logic) | ✅ |
| **CSV tag-export** → IR (reuses the tested `tag_csv` multi-vendor parser) | ✅ |
| **Structured Text (.st) parser** → IR (VAR decls → tags, POU body → ST routine, assignments → synthetic rungs) | ✅ |
| **PLCopen XML parser** → IR (namespace-agnostic tc6; interface vars → tags, ST body reuses the ST lift) | ✅ |
| **MIRA PLC IR** (Controller → Program → Routine → Rung → Tag, + provenance + confidence) | ✅ |
| **Deterministic analysis**: tag dictionary, routine summaries, output-dependency map, fault candidates, asset candidates, VFD-signal candidates, usage cross-reference, safety **review** flags | ✅ |
| Name tokenizer handles **camelCase humps** (`fault` in `FaultRoutine`) as well as `_`/digit breaks | ✅ |
| Markdown + JSON report renderers; JSON shape pinned by **golden snapshots** (`report@1`) | ✅ |

## Install & CLI

Run it from source (no install needed), or install the console command:

```bash
# from mira-plc-parser/
python -m mira_plc_parser analyze tests/fixtures/conveyor.L5X --out ./_out   # from source
pip install -e .                                                              # then:
mira-plc-parser analyze tests/fixtures/conveyor.L5X --out ./_out              # console command
```

`analyze` runs the read-only detect → parse → IR → analysis pipeline and writes local report files
into `--out` (default: current dir):

- `<stem>.report.md` — the maintenance-readable Markdown report.
- `<stem>.report.json` — the same findings as structured JSON (`--format md|json|both`, default
  `both`).

The CLI is **offline by construction** — stdlib-only, no LLM, no network. Exit codes: `0` parsed ·
`3` a closed vendor **project** file (it prints the precise export instructions and still writes a
report) · `1` unrecognized format or read error.

Building a standalone Windows `.exe` (no Python needed on the target): see [PACKAGING.md](PACKAGING.md).

## Quickstart (library)

```python
from mira_plc_parser import run, render_markdown, render_json

result = run("conveyor.L5X", open("conveyor.L5X").read())
print(render_markdown(result))           # maintenance-readable report
print(render_json(result))               # structured, json.dumps-safe dict
print(result.report.output_dependencies) # structured findings
print(result.project.all_tags())         # the IR
```

## Report schema (`mira-plc-parser/report@1`)

`render_json(result)` returns a stable, `json.dumps`-safe dict — the contract downstream MIRA
ingest consumes. Its shape is pinned by golden snapshots (`tests/fixtures/golden/`); any change to
fields, counts, ordering, or candidate sets is a deliberate, reviewed bump.

```jsonc
{
  "schema": "mira-plc-parser/report@1",
  "detection": { "fmt": "structured_text", "confidence": "high", "reason": "...", "needs_export": "" },
  "handled": true,                       // false for closed-project / unknown (then only the keys below it)
  "controller": "ConveyorControl",
  "vendor": "IEC 61131-3",
  "counts": { "controllers": 1, "tags": 12, "programs": 1, "routines": 1, "rungs": 3,
              "outputs": 2, "fault_candidates": 4, "asset_candidates": 3,
              "vfd_signal_candidates": 4, "review_required": 1 },
  "review_required":      [ {"kind","name","detail","confidence","evidence":[...]} ],
  "output_dependencies":  [ {"kind":"output","name","detail":"true when: ...","confidence","evidence"} ],
  "fault_candidates":     [ {"kind":"fault", ...} ],
  "asset_candidates":     [ {"kind":"asset", ...} ],
  "vfd_signal_candidates":[ {"kind":"vfd_signal","detail":"candidate role: frequency", ...} ],
  "routine_summaries":    [ {"program","routine","type","rungs","outputs_controlled",...} ],
  "tag_dictionary":       [ {"name","data_type","scope","description","address","roles","used_count",...} ],
  "warnings": [ ... ]
}
```

An unhandled result (`handled: false`) carries only `schema`, `detection`, `handled`, and
`warnings` — e.g. a closed `.ACD` returns `detection.needs_export` with the precise export steps.

## Confidence grading

Every extracted/inferred fact is graded (this protects you and looks professional):

- **high** — structured extract from L5X / XML (e.g. *"rung 0 energizes Motor_Run"*).
- **medium** — inferred from names / comments / usage (e.g. *"VFD_Frequency looks like a frequency signal"*).
- **low** — OCR from a PDF / screenshot (Phase 7).
- **review** — safety / e-stop / bypass / guarding logic a human **must** verify before trusting.

## Explicitly NOT in scope (yet)

No PLC writes. No full vendor-to-vendor translation. No ladder→ST round-trip as a customer promise.
No safety validation. No guarantee of correctness of unknown customer logic. The first commercial
product is **read-only analysis of exported programs** — safer and easier to sell.

## Roadmap

1. **Phase 1 (done):** Rockwell L5X + CSV → IR + deterministic analysis.
2. **Eval dataset (done):** synthetic L5X / CSV / ST / PLCopen fixtures + golden `report@1` snapshots.
3. **IR hardening (done):** `report@1` shape pinned by golden tests; camelCase tokenizer fix.
4. **PLCopen XML + Structured Text (done):** ST is the reasoning bridge; PLCopen reuses the ST lift.
5. **Analysis depth (next):** timers→fault chains, permissives/interlocks, sequence/state extraction.
6. **Siemens** via TIA Portal Openness XML exports (not closed project files) — recognized, parser pending.
7. **PDF / screenshot** fallback (OCR, low confidence) — last.

## Tests

```bash
python -m pytest mira-plc-parser/tests/ -q
```

Fixture-based across all four formats: a synthetic conveyor `conveyor.L5X` (VFD tags + an e-stop to
exercise the review path), a Kepware-dialect `gs10_tags.csv`, a camelCase `conveyor.st`, and a
`conveyor.plcopen.xml`. The suite covers detection, every parser's extraction, rung-logic parsing,
the tokenizer's camelCase handling, the full analysis, golden `report@1` snapshots, graceful
handling of unknown/planned/closed-project formats, and the CLI/packaging path resolution.

## Layout

```
mira_plc_parser/
  ir.py              # the MIRA PLC IR (the heart)
  detect.py          # format/vendor detector
  parsers/
    rockwell_l5x.py  # L5X → IR
    csv_tags.py      # CSV → IR (reuses ignition/.../diagnose/tag_csv.py)
    structured_text.py # IEC 61131-3 ST → IR (VAR decls + assignments → rungs)
    plcopen_xml.py   # PLCopen tc6 XML → IR (reuses the ST body lift)
  analyze.py         # deterministic maintenance analysis (camelCase-aware tokenizer)
  pipeline.py        # detect → parse → analyze → report (render_markdown / render_json)
  cli.py             # offline CLI (analyze → local report files)
  __main__.py        # `python -m mira_plc_parser`
mira-plc-parser.spec # PyInstaller spec for the standalone .exe (see PACKAGING.md)
```
