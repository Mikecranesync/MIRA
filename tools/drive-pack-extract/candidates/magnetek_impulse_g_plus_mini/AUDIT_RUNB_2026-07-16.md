# Run B — independent adversarial audit (2026-07-16)

Independent verification of the **already-merged** Magnetek IMPULSE G+ Mini Run-B
extraction (PR #2695) against the real manual. Requested as the verification half
of the Run-A/B/C plan ("adversarially verify … fix confirmed defects"). Read-only
reproduction + two adversarial Sonnet agents + manual-ground-truth adjudication.

## Method
- **Manual verified identical to Run A/B:** downloaded from the recorded provenance
  URL; sha256 `56075883…00be`, 2,915,657 bytes — exact match. (Copyrighted; NOT
  committed — `manuals/` is gitignored.)
- **Extraction reproduced deterministically:** `extractor.extract(manual)` →
  **77 fault_entries / 468 parameters** — matches the merged candidate exactly.
- **Regression suite:** `pytest tools/drive-pack-extract` → **225 passed, 1 xfailed**
  (pre-existing) — 0 failures.
- **Two adversarial Sonnet agents** (instructed to falsify, not confirm) read the
  actual PDF pages: one on the 77 faults (pp.135–140), one on the 468 params
  (pp.144–173). Every claim was then **adjudicated by me against the manual** (the
  extractor's own cited excerpts + pdfplumber page reads) — adversarial leads are
  not findings until ground-truthed.

## Verdict: extraction is **substantially correct**, with **5 confirmed fault-field defects**

| Area | Result |
|---|---|
| Fault coverage | ✅ 77 (76 unique + `oV` ×2); **0 fabricated**, **0 missed**, casing exact, auto-tune p.141 correctly excluded |
| Ambiguous glyphs | ✅ correct; **nothing normalized** (verbatim preserved) |
| Parameters (468) | ✅ **no confirmed defects** — see false-positive note |
| Citations | ✅ verbatim substrings of cited pages (both tables) |
| **Fault name/action fields** | ❌ **5 confirmed defects** (below) |

### Confirmed defects — multi-line Name/Description cell bleed (p.138)
Faults whose Name/Description cell **wraps across multiple lines** have the wrap
text bled into `name` and `action`. Root cause: the description wrap line sits
**past `action_x0`** and is x-binned into the action column by
`magnetek_dialect.parse_magnetek_fault_page`; the name (from
`desc_text.split(". ")[0]`) loses its numeric suffix.

| fault_id | field | manual (ground truth, p.138) | extraction (defective) | severity |
|---|---|---|---|---|
| `oH3` | name | `Motor Overheating 1` | `Motor Overheating detected motor overheating` | **critical** (safety: lost the 1/2 channel distinction) |
| `oH4` | name | `Motor Overheating 2` | `Motor Overheating detected motor overheating` (identical to oH3) | **critical** |
| `LL1` | name | `Lower Limit 1—SLOW DOWN Indicator` | `Lower Limit 1—SLOW Limit 1—SLOW DOWN changed)` | **major** (safety: crane lower-limit) |
| `LL2` | name | `Lower Limit 2—STOP Indicator` | `Lower Limit 2—STOP 2—STOP is input (switch` | **major** |
| `LL1`/`LL2`/`oH3`/`oH4`/`oL1` | action | steps `1. … 2. …` | description text interleaved between steps | **major** |

Safety weight: these are a **crane/hoist** drive. `oH3`/`oH4` are the two
independent motor-overheat channels; `LL1`/`LL2` are the lower-limit slow-down vs
stop indicators — exactly the fields a technician relies on. A wrong meaning is a
lifting-safety issue, so these rank above cosmetic.

### Adversarial claims that did NOT survive adjudication (false positives)
- **"27.9% of parameters (131) are fabricated numeric ranges"** — **REJECTED.** The
  agent used `pdftotext`, which linearizes the 6-column table and misreads it.
  Ground truth from the extractor's own cited excerpts: `B05.12` = *"Accel Time 3
  3.0 0.0–6000.0 sec"* and `C01.02` = *"Quick Stop Time 1.0 0.0–25.5 sec"* are
  verbatim manual substrings — real numeric params, not enums. `A01.02`
  (`range="00, 02"`, 2 enum meanings) / `A01.03` (`"00, 01, 04"`, 3 enums) are the
  manual's real **comma-enumerated** ranges *with* enums correctly attached. No
  parameter defect confirmed.
- **`oPE04` name should be "Terminal"** — **REJECTED.** The manual text after
  `oPE04` is *"Parameters do not match"*, which is what the extraction has.

## What this means for the grade
The merged pack graded **A (100.0) INCOMPLETE** because field-accuracy categories
were **N/A** (no gold set) — the grade measured provenance + citation fidelity,
NOT name/action correctness. This audit found exactly what the automated grade
could not: **field-accuracy defects hiding under a clean citation gate** (garbled
text is still a verbatim substring of the cited page, so it passes cite-integrity).

## Deliverable + why the fix is NOT in this pass
- **Regression test:** `tests/test_magnetek_fault_bleed_audit.py` pins the 5
  correct values (manual-ground-truthed). It **skips** on CI (manual gitignored),
  **xfails** locally (documents the defect), and is `strict=True` so it flips to a
  hard failure the instant the dialect fix lands — the signal to delete the marker.
- **Fix deferred deliberately.** The name half is contained, but the action half is
  description text *interleaved between* action steps — a **column-geometry rework**
  of `parse_magnetek_fault_page` (the desc/action x-boundary is not cleanly
  separable on these wrapped rows). That touches merged, actively-owned parser code
  with 225 tests + 72 correct faults + 468 params at regression risk, and
  `test_magnetek_dialect.py` may encode current behavior. Shipping a rushed rewrite
  would violate surgical-change discipline. Recommend the dialect owner take the
  geometry fix with this test as the exact target.

## Reproduce
```
# manual at manuals/drives-g-mini-manual.pdf (sha256 56075883…00be)
python3.12 -c "import extractor; f=extractor.extract('manuals/drives-g-mini-manual.pdf', doc='Magnetek IMPULSE G+ Mini Technical Manual (144-25085)'); print(len(f['fault_entries']), len(f['parameters']))"
python3.12 -m pytest tests/test_magnetek_fault_bleed_audit.py -q   # 3 xfailed (defect present)
```
