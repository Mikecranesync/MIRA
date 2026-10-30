# Work Packet WO-DEMO-0001 — CAT Pumps 5CP6120 [proposed]

DRAFT — not approved for use.

Scope [proposed]: Reseal (seal kit) and valve service (two valve kits); plungers inspected, replaced only if scored
Seal material [proposed]: the data sheet lists five seal materials (NBR standard, FPM .0110, EPDM .0220, HT .3000, STHT .3400); the pump's suffix decides which kit numbers apply (data sheet p.4)

## Sources
- DS: CAT Pumps 5CP6120 / 5CP6120CS / 5CP6120CSSG1 Data Sheet (Rev G 5/22) pages [1, 2, 3, 4]
- SM: CP Plunger Pump Service Manual (3CP, 5CP, 7CP) (unknown (text shows 'Rev J' marker; confirm on the PDF cover)) pages [1, 2, 3, 5, 6]
- FIELD: Rev F 11/20 copy photographed on site 2026-10-30 (unknown) pages []

## Safety
- ISOLATION [unknown]: Isolate per the SITE-APPROVED procedure and verify zero pressure before any step below. This packet does not generate lockout or isolation steps; a qualified person applies the site procedure and signs below.
- [verified] All systems require both a primary pressure regulating device (i.e., regulator, unloader) and a secondary pressure safety relief device (i.e., pop-off valve, safety valve). Failure to install such relief devices could result in personal injury or damage to the pump or to system components. (SM p.1)
- [verified] Read all CAUTIONS and WARNINGS before commencing service or operation of any high-pressure system. (DS p.4)
- [verified] DO NOT RUN PUMP WITHOUT OIL IN CRANKCASE. (SM p.1)

## Parts
| Part | Description | Qty | Label | Condition |
|---|---|---|---|---|
| 33628 | Kit, Seal – Standard NBR | 1 | proposed | ONLY if the pump's seal material is NBR (standard). Other materials: FPM 31628, EPDM 31648, HT 31638, STHT 76536 (DS p.4) |
| 30820 | Kit, Valve – Standard NBR | 2 | proposed | NBR standard; FPM 31263, EPDM 31259 (DS p.4) |
| 6107 | Oil, Bottle (21 oz) ISO 68 Hydraulic | 1 | verified |  |
| ~~6124~~ | ~~Gasket, Liquid (3 oz)~~ | ~~1~~ | ~~proposed~~ | ~~only if Tech Bulletin 053 applies to this model/application~~ |

Kit coverage [verified]: seal kit items 98, 106, 121, 125 and valve kit items 162, 163, 164, 166, 167, 168, 172 at their expected per-pump quantity on the parts list; item 120 is NOT verified for the standard NBR (STD) seal kit — DS p.4 shows no NBR (STD) part number for item 120, only STHT (.3400) (49436); ordering the standard NBR kit alone will not supply a replacement for item 120 (DS p.2 vs p.4)

## Tools
- M24 hex socket (CAT tool P/N 44046) — valve plugs, 5CP M22 thread (SM p.6 torque chart)
- M6 Allen key (CAT tool P/N 30941) — manifold head socket-head screws M8 (item 188) (SM p.6; DS p.2)
- M10 hex (CAT tool P/N 25082) — plunger retainer M6 (item 99) (SM p.6)
- Reverse pliers (CAT P/N 30696) — seats, seal cases, lo-pressure seals (DS p.3 optional parts; SM p.2 and p.5)
- Needle-nose pliers; two flat screwdrivers; soft mallet — valve assemblies; separating the manifold head (SM p.2 and p.3)
- Torque wrench, in-lb range to 870 in-lb (72.5 ft-lb) — valve plugs 870 in-lb; manifold screws 115 in-lb; plunger retainer 55 in-lb (SM p.6)
- Silicone-base lubricant — ONLY if EPDM elastomers (SM p.5 note)

## Draft steps [proposed]
1. Isolate and relieve pressure per the SITE procedure; verify zero pressure at the manifold. [unknown] (site procedure (not in the manufacturer documents))
2. Remove the hex valve plugs (top discharge, bottom inlet). Examine the O-ring under each plug; replace if worn; lubricate new O-rings. [proposed] (SM p.2 §1–2)
3. Remove each spring retainer by its tab; remove spring and valve; with reverse pliers remove the seat; remove the O-ring at the bottom of the chamber. Note: the 5CP6120 has an O-ring AND a backup ring on each seat. [proposed] (SM p.2 §3)
4. Examine valve parts for pitting, gouges or wear; replace with the preassembled valve assemblies from the kits (two valve kits for a complete change). Immerse each new assembly in oil and push in until fully seated. [proposed] (SM p.2 §4–5)
5. Remove the socket-head screws from the manifold head; rotate the crankshaft by hand to start separation; separate with two flat screwdrivers and light mallet taps, supporting the head. CAUTION: keep the manifold aligned with the ceramic plungers. [proposed] (SM p.3 disassembly §1–3 and CAUTION)
6. Remove the seal retainer from each plunger rod and examine for wear; examine each ceramic plunger for cracks or scoring (replace only if damaged). [proposed] (SM p.3 §4–5)
7. With the crankcase side of the manifold facing up: remove the lo-pressure seal, the press-in seal case, its O-ring, and the hi-pressure seal (usually by hand). [proposed] (SM p.5 disassembly §1–4)
8. Reassemble seals: lubricate each seal chamber; press the hi-pressure seal in grooved side down (metal back facing out); fit new seal-case O-rings; press each seal case in until seated. Service with the SAME seal type the pump was built with. [proposed] (SM p.5 reassembly §1–4 and NOTE)
9. Install seal retainers (tab down, holes toward the manifold); rotate the crankshaft so the two outside plungers extend equally; lightly lubricate the plungers; slide the manifold head on, supporting from underneath. [proposed] (SM p.3 reassembly §2–4)
10. Fit the manifold socket-head screws and torque to 115 in-lb (9.58 ft-lb, 13 Nm). [proposed] (SM p.3 §5; torque chart SM p.6 'Manifold Screw M8')
11. Torque the valve plugs to 870 in-lb (72.5 ft-lb, 98 Nm). [proposed] (SM p.6 'Valve Plugs 3CP, 5CP M22')
12. Crankcase check: inspect oil seals and rear cover, drain plug and bubble gauge for leaks; check oil level and for water in oil; rotate the crankshaft by hand for smooth bearing movement. [proposed] (SM p.5 crankcase §1–5)
13. Fill the crankcase to specification (17 oz / 0.50 l). Do not run the pump without oil. [proposed] (DS p.1; SM p.1 LUBRICATION)
14. Return to service per the site procedure; run and check for leaks at the manifold; confirm rated performance (7.4 gpm at 1725 rpm, 100–1500 psi). [proposed] (site procedure + DS p.1 specifications; acceptance limits are site-defined (unknown))

## Measurements
- Crankcase oil fill: 17 oz (0.50 l) [verified] (DS p.1 'Crankcase Capacity 17 oz 0.50 l'; SM p.1 '5CP-17 oz.')
- Torque, manifold head screws (M8): 115 in-lb / 9.58 ft-lb / 13 Nm [verified] (SM p.6)
- Torque, valve plugs (5CP, M22): 870 in-lb / 72.5 ft-lb / 98 Nm [verified] (SM p.6)
- Torque, plunger retainer (M6): 55 in-lb / 4.6 ft-lb / 6.2 Nm [verified] (SM p.6)
- Rated flow and pressure: 7.4 gpm (28 lpm); 100–1500 psi (6.9–103 bar); 1725 rpm [verified] (DS p.1)
- Max liquid temperature (NBR): 160 °F (71 °C) [verified] (DS p.1)
- Functional-test acceptance (pressure held, leak-free minutes): unknown [unknown] (site-defined)

## Exceptions
- Seal material suffix not confirmed; kit numbers above assume NBR standard [unknown] → nameplate photo (task 10)
- Whether Tech Bulletin 053 (liquid gasket) applies to this model/application [unknown] → CAT Pumps tech bulletin 053
- Plunger and seal-retainer condition decides whether items 90/100 are needed [unknown] → inspection at steps 6
- Your printed data sheet is Rev F (11/20); current is Rev G (5/22). Kit numbers unchanged; three parts-list rows differ [verified] → use Rev G

## Sign-off
- isolation: required
- technician review: reviewed
- supervisor approval: pending

## Technician edits
- set job.seal_material_suffix = NBR (standard) — nameplate shows no suffix — Demo Technician 2026-10-30T14:00:00Z · confirmed on the nameplate photo
- confirm parts.required[0] — Demo Technician 2026-10-30T14:01:00Z
- confirm steps.items[12] — Demo Technician 2026-10-30T14:02:00Z
- strike parts.required[3] — Demo Technician 2026-10-30T14:03:00Z · TB053 not applicable per distributor
