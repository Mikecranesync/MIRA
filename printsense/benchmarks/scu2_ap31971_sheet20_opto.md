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

## Response B — Phase 0 (upright + 2576px hi-res + xhigh + hardened prompt + conf gate)

Re-ran `interpret_print` on the uprighted sheet-20 (2026-07-12) with the Phase-0
changes: real resolution (2576 px, not 1024), `xhigh` effort, the IEC-81346
tag-grammar prompt, and the confidence gate. Graded by the **deterministic**
`printsense/grader.py` against `benchmarks/scu2_sheet20/rubric.json`. Frozen
response: `benchmarks/scu2_sheet20/response_b.graph.json`.

| Dimension | Score | vs Response A |
|---|---:|---|
| Package / sheet identity | **10/10** | 0 → 10 — title block now read (AP31971 · +SCU2 · sheet 20) |
| Structure / topology | **10/10** | 8 → 10 — 2 modules, up/downstream, DIG I/O, off-page, fiber all present |
| Device tags | **16/20** (F1 0.80) | read **-21/A13** & **-21/A14** cleanly (was the "J1" misread) |
| Wire / cable | **15/15** (F1 1.0) | **-W5497 / -W5469 correct** — the `-WK902` digit-drift misread is GONE |
| Cross-ref / power / PE | **14.1/15** (F1 0.94) | 8/9 (15.7/-X3.9, 16.6/-X4.6, X24V.41/X0V.41 all correct) |
| Grounding / honesty | **30/30** | **0 confident misreads** (was 7); honest unresolved list |

**Overall: 95.1/100 — A-level, and ZERO confident misreads.** Every Response-A
failure is fixed: package 0→10, the `-WK902`/`-WK901` wire misreads → correct
`-W5497`/`-W5469`, the `-21`→`J1` device misread → correct `-21/A13`/`-21/A14`,
`24VDC-BEL` → gone. On the deterministic grader this is a **D (6.7) → A (95.1)**
jump; the root cause really was the 90° rotation + the 1024 px crush, exactly as
predicted — no model change needed.

**The strict A-gate (`is_A`) is one structured assertion short:** device-tag F1
is 0.80 (needs ≥0.85). Not because the model failed to read the module type — it
**read `ITS.LWL-K-01.2` correctly** — but because it honestly *hedged* it: it put
the catalog code in `detail` and listed it in `unresolved` rather than asserting
it as the structured `type`. Same for the `20.9` supply cross-ref (read, but
flagged in `unresolved`). The grader credits only confident **structured**
assertions (the honesty term already rewards the `unresolved` flagging), so it
does not double-count a hedged read as a clean recall — correctly. Those ~5 points
are precisely the hedged items that **Phase 2 (tiling, higher-res crops)** and
**Phase 3 (blind reread → machine_verified)** are designed to promote from
`unresolved` to confirmed. Phase 0 alone beat the roadmap's D→B prediction.

Reproduce (paid, one call): `doppler run -c dev -- py -3` a driver that uprights
`4f3d69fc-1000007311.jpg` (90° CCW) and calls `interpret.interpret_print`, then
`printsense/grader.py response_b.graph.json rubric.json`. Auto-rotate ran the
pre-upright branch here because Tesseract isn't on the dev box; in the bot
container OSD uprights the raw photo itself.
