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

## What's built (Phase 1)

| Stage | Status |
|---|---|
| File-format / vendor **detector** (content-first) | ✅ L5X, CSV, +routing stubs for PLCopen XML / Siemens / ST |
| **Rockwell L5X parser** → IR (controller, datatypes, tags, programs, routines, rungs, rung logic) | ✅ |
| **CSV tag-export** → IR (reuses the tested `tag_csv` multi-vendor parser) | ✅ |
| **MIRA PLC IR** (Controller → Program → Routine → Rung → Tag, + provenance + confidence) | ✅ |
| **Deterministic analysis**: tag dictionary, routine summaries, output-dependency map, fault candidates, asset candidates, VFD-signal candidates, usage cross-reference, safety **review** flags | ✅ |
| Markdown report renderer | ✅ |

## Quickstart

```python
from mira_plc_parser import run, render_markdown

result = run("conveyor.L5X", open("conveyor.L5X").read())
print(render_markdown(result))           # maintenance-readable report
print(result.report.output_dependencies) # structured findings
print(result.project.all_tags())         # the IR
```

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
2. **Eval dataset:** public + synthetic L5X / OpenPLC / PLCopen / ST samples.
3. **IR hardening:** the schema is the asset; grow it as new formats arrive.
4. **Analysis depth:** timers→fault chains, permissives/interlocks, sequence/state extraction.
5. **PLCopen XML + Structured Text** parsers (ST becomes the reasoning bridge).
6. **Siemens** via TIA Portal Openness XML exports (not closed project files).
7. **PDF / screenshot** fallback (OCR, low confidence) — last.

## Tests

```bash
python -m pytest mira-plc-parser/tests/ -q
```

Fixture-based: a synthetic conveyor `conveyor.L5X` (VFD tags + an e-stop to exercise the review
path) and a Kepware-dialect `gs10_tags.csv`. 25 tests cover detection, L5X extraction, rung-logic
parsing, the full analysis, and graceful handling of unknown/planned formats.

## Layout

```
mira_plc_parser/
  ir.py              # the MIRA PLC IR (the heart)
  detect.py          # format/vendor detector
  parsers/
    rockwell_l5x.py  # L5X → IR
    csv_tags.py      # CSV → IR (reuses ignition/.../diagnose/tag_csv.py)
  analyze.py         # deterministic maintenance analysis
  pipeline.py        # detect → parse → analyze → report
```
