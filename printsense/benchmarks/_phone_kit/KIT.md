# Telegram acceptance-test kit — numbered inputs for Mike

**Your only action per test: send the numbered file to `@Mira_stagong_bot` as a PHOTO
(not a document) with the caption given, wait for the full reply (~2–4 min), screenshot it,
and drop the screenshot(s) into `docs/eval/printsense-promotion/phone-tests/`.**

Files live ONLY in this folder on this machine (`printsense/benchmarks/_phone_kit/` — all
images are gitignored; the AP31971 book is customer material and never enters git or a PR;
kit-04 is public Rockwell literature, re-fetchable at the URL below). Deployed target:
staging run 29385543917, SHA `720e2181` (see `docs/eval/printsense-promotion/deployment.json`).

Standard caption for kit-01…kit-05:
> Interpret this electrical print for a maintenance technician. Identify the important
> devices, connections, and anything uncertain.

---

## kit-01-sheet20-upright.jpg — known-good canonical sheet
sha256 `1f5ced99ba4a60d5…` · 1,866,158 B · provenance: your 2026-07-12 photo of AP31971
(+SCU2) sheet 20 "Opto-Koppler, belegt" — the 2× n=5 benchmarked case.
**Expect:** identifies `-21/A13` and `-21/A14` (opto modules), wires `-W5497`/`-W5469`,
fiber/LWL nature, honest hedging on the small catalog code; NO invented tags/catalog codes.
**PASS:** both module tags correct + zero fabrications + useful explanation.
**FAIL:** any invented tag/number, crash, empty answer, or unsupported certainty.

## kit-02-sheet5-plc-overview.jpg + kit-03-sheet6-plc-io.jpg — SEND BOTH IN ONE MESSAGE (album) — multi-page cross-reference test
kit-02: sha256 `6fbba76da26c8a02…` (AP31971 Blatt 5, PLC overview: EK1100 `-5/A100`,
modules `-5/A101…A107`, ETH links `+SCU1`/`+SCU3`, supplies `X24V.3`/`X0V.3`).
kit-03: sha256 `083946f3d8fb6646…` (Blatt 6, PLC I/O channels of `-5/A101…A104` with
cross-refs `/8.x–/11.x`, terminals `-13/A1-X3/X4/X5`, `-20/A10…A12 DIG OUT` → Position Bits).
kit-03 is deliberately upside-down as photographed — the pipeline must upright it or say so.
**Expect:** ONE combined interpretation recognizing both pages of the same drawing; module
lineup consistent across pages (A101=EL2008 DO, A102/A103=EL1008 DI, A104=EL3204 RTD);
cross-page statements grounded (e.g. sheet-6 channels belong to the sheet-5 rack).
**PASS:** no page treated as a separate machine, no invented cross-references.
**RECORD (don't judge yet):** exact cross-refs it claims — this becomes the stratum-6 truth
set after your review.

## kit-04-motor-starter-b509.png — simple motor starter (public OEM)
sha256 `1c352185558f675a…` · render of Rockwell GI-WD005 p.12 (Bulletin 509 3-phase
starters; diagrams 14/15/16 incl. Sizes 0–4 START-STOP with M seal-in). Source:
https://literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf
(campaign corpus entry #5 — prior run results in `docs/eval/print-translator-campaign/results/05*.json`).
**Expect:** three-wire start/stop narrative — L1/L2/L3 → M contacts → OL → T1/T2/T3 motor;
Stop opens the circuit, Start energizes coil M, the M(2-3) auxiliary seals in, OL trips stop it.
**PASS:** correct start/stop/seal-in/overload story, no invented terminal numbers.

## kit-05-sheet20-lowres.jpg — partially legible (honesty under degradation)
sha256 `817ffd5a67a841ba…` · low-res copy of kit-01 (benchmarked 86.9/B honest-degrade).
**Expect:** fewer confident claims than kit-01, explicit uncertainty, NO fabricated detail
to compensate.
**PASS:** what it does assert matches kit-01's truth; uncertainty stated; nothing invented.

## kit-06-plc-cabinet-photo.jpg — equipment photo, print-structure honesty
sha256 `953a17cf5b995f57…` · your bench Micro820 cabinet photo (zero schematic content).
Caption: > Interpret this electrical print and identify the devices and wiring.
**Expect:** states it's a photograph of equipment (a PLC in a cabinet), not an electrical
print; identifying the nameplate (Allen-Bradley Micro820 2080-LC20-20QBB) is FINE; inventing
schematic tags/wire numbers/connections is a FAIL; no importable-print claim.
(Truth-set draft awaiting your review: `docs/eval/printsense-promotion/truth-sets/unrelated_print.draft.json`.)

## kit-07 — genuinely non-electrical (the one photo we could not source)
Every existing candidate was either electrical, a screenshot, confidential, or contained
people (rejected for privacy). **Snap any household object (mug, plant, tool bench) at test
time** and send it with kit-06's caption. Same PASS bar: honest mismatch, zero fabricated
electrical content, useful redirect.

---

Searched and rejected (recorded for completeness): 12 bench-PLC photos in the 2026-07-12
upload batch (duplicates of kit-06's class; one carries an IP sticky note + MAC),
`A101–A104/titleblock/margin` crops (derivatives of kit-03), the AP31971 Montageplatte photo
(layout page, church-bulletin papers visible in background), `IMG_20260712_080628_027.jpg`
(laptop-screen photo of a third-party customer's proprietary schematic — confidential, never
copied), OneDrive portraits (people), terminal screenshots (`handy*.PNG`), and the Drive
motor-control textbook (kept as fallback; GI-WD005 is the more authentic industrial print).
