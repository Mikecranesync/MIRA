# PrintSense benchmark — SCU2 / AP31971 sheet 20 (Opto-Koppler, belegt)

A real field photo sent to `@Mira_stagong_bot` on 2026-07-12. The photo was
**rotated 90° CW on a workbench** (EXIF orientation normal = rotation baked into
pixels). This fixture measures the Anthropic PrintSynth interpreter on a *messy
field photo* and is the before/after gate for the auto-rotate preprocessing.

- Source (as sent, rotated): `4f3d69fc-1000007311.jpg`
- Upright reference (90° CCW): `print_correct.jpg`
- Cabinet: INTRASYS "Sensor Control Unit 2 V3.5", drawing **AP31971**, +SCU2, Hyper Launch, Orlando FL, dated 11.07.2022 (Bearb. Ascher / Kunde Mack), **sheet 20**, "Opto-Koppler, belegt".

## Ground truth (read from the upright image)

| Item | Value |
|---|---|
| Module 1 | **-21/A13**, type **ITS.LWL-K-01.2** (Im=P / Out=P), **Occupied Upstream** |
| Module 2 | **-21/A14**, type **ITS.LWL-K-01.2** (Im=P / Out=P), **Occupied Downstream** |
| Module pins | 24VDC, GND, **LWL IN**, **LWL OUT** (fiber/POF), DIG IN, DIG OUT |
| Wire 1 | **-W5497** (POF fiber) ← `+SD3/0/21.7 / +SCU2-BEL` → A13 LWL IN |
| Wire 2 | **-W5469** ← A14 LWL OUT → `+SCU1-BEL / +SCU1/21.2` |
| Xref 1 | **15.7 / -X3.9** ← A13 DIG OUT |
| Xref 2 | **16.6 / -X4.6** → A14 DIG IN |
| Power feed | **X24V.41 / 20.9** + **X0V.41 / 20.9** (24 V / 0 V from sheet 20.9) → both modules' 24VDC/GND |
| Nature | fiber-optic opto-couplers (LWL = Lichtwellenleiter / POF = plastic optical fiber) |

## Response A — rotated photo (as delivered on Telegram, 2026-07-12)

| Dimension | Score | Notes |
|---|---:|---|
| Package/sheet identity | 0/10 | "📐 Electrical print" — title block missed entirely (it WAS legible). |
| Structure / topology | 8/10 | Correct: 2 modules, Occupied Upstream/Downstream, DIG I/O, off-page refs. |
| Device tags | 2/10 | "UNREADABLE J1/A1x" — sensed "A13/A14" but misread -21→J1; missed type ITS.LWL-K-01.2. |
| Wire / cable | 1/10 | **Misread** -W5497/-W5469 → "-WK902/-WK901" and +SCU2/SCU1-BEL → "24VDC-BEL". |
| Cross-references | 4/10 | "157/X3.5" vs 15.7/-X3.9; "16.1/X4.6" vs 16.6/-X4.6 — flagged uncertain. |
| Continuations / power | 5/10 | Saw the 2 red arrows, flagged unreadable; missed X24V/X0V power feeds. |
| Grounding / no-invention | 6/10 | Mostly honest, but asserted "-WK902" in the path instead of UNREADABLE. |
| Honesty / hedging | 8/10 | Excellent, specific ⚠️ retake list + "meter before you act". |

**Overall: ~43% — D. Structurally right, factually thin, honestly hedged. NOT field-usable as-is** (wrong wire tags, no device IDs, no package ID) — but it did not confidently mislead, and it told the tech to retake.

**Root cause: the 90° rotation.** Every failed item (package, -21/A13, ITS.LWL-K-01.2, -W5497/-W5469, +SCU2-BEL, 15.7/-X3.9) is legible on the upright image → the fix is deterministic auto-upright preprocessing, not a model change.

## Response B — upright (auto-rotated)

_TBD — re-run interpret_print on the auto-rotated image and re-score here._
