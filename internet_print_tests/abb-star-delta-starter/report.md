# MIRA Print Translator Test — abb-star-delta-starter

## 1. Source & drawing metadata
- Publisher: ABB
- Title: STAR-DELTA Open-Type Starter — Technical Data
- Sheet: Terminal arrangement & wiring, sheet 1-2
- Equipment: IEC open-type star-delta reduced-voltage starter
- Standard: IEC 60947-4-1
- Category: contactor
- Source URL: https://library.e.abb.com/public/ac6b6e46df1ea3e6c1256e35004c9145/Star-delta%20Starters%20Open%20Type_technical%20data.pdf
- Access date (UTC): 2026-07-13T20:28:15Z
- Original sha256: `f9eb30746fd22c91bbe160b889fbbbecd93d5997c9fa438fd9a57a7847f1f07f`

## 2. Why selected
European/IEC three-phase star-delta reversal starter with main + delta + star contactors, overload, and terminal-to-terminal wiring. Page 4 is the campaign-verified rendered schematic page (corpus_manifest.md first-10, entry #3). Publicly published on library.e.abb.com; provenance verified 2026-07-10 (httpx application/pdf).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
📋 Sheet 2/4 of an ABB open-type star-delta motor starter (YKA/YDA ..-30) — the wiring diagrams for the power circuit plus two control-circuit options (local and remote), protected by a thermal overload relay.

This sheet shows how to wire a star-delta (wye-delta) motor starter. Three contactors switch the motor: KM1 is the line/main contactor (marked 'L'), KM2 is the star contactor (marked 'Y'), and KM3 is the delta contactor (marked '△'). To limit inrush at start, the motor windings are first connected in star (KM1 + KM2). A timing relay KT then times out and hands over to delta (KM1 + KM3) for normal running. The thermal overload relay FR1 sits in the motor current path and its 95-96 trip contact opens the control circuit on overload. The bottom two diagrams give two ways to build the control side: 'Local Control' (start/reset pushbuttons on the panel) and 'Remote Control' (start/stop/reset from a remote station). The control supply is taken as Us/N, with reference points tied to KM3 terminals 5/L3 and 3/L2.

🔑 Signals
• Three-phase motor supply (line side)
• Motor load / winding connections
• Overload trip (control-circuit break)
• Overload signalling contact
• Star/delta transition timing
• Control supply live reference
• Control supply return reference
• Reset / Auto-Manual selection at overload

🔧 Devices
• Line/main contactor ('L') (KM1)
• Star contactor ('Y') (KM2)
• Delta contactor ('△') (KM3)
• Thermal overload relay (FR1)
• Star-delta changeover timing relay (KT)
• Three-phase induction motor (M 3~)

🩺 If you're chasing a fault
… (more — reply "map")

❓ Couldn't confirm (verify on the sheet):
• Supply/control voltage not printed on this sheet (check the rating/order-data sheet 1/4 or 4/4).
• FR1 97-98 contact and its destination not clearly legible.
• KT timer contact terminal routing (15/16/18, t1 vs t1+t2) is small and needs a zoom to confirm.
• No explicit -W#### wire numbers appear on this wiring diagram; connections are shown graphically only.

⚠️ No voltage value is printed anywhere on this sheet — the drawing does NOT establish the control-circuit or motor voltage, so do not assume a level. For continuity/resistance checks on FR1 contacts, contactor coils or the timer, de-energize, lock out, and verify absence of voltage first. If live verification of the control supply (Us/N) or the three-phase power terminals is required, treat it as energized work and use appropriately rated PPE and instruments; the drawing does not prove the present field state of the panel.
🔎 Read from the drawing. Verify field conditions and use the correct procedure for the measurement.

Reply "map" for the full terminal and wire list.
```

- classification: **ELECTRICAL_PRINT** (conf 0.85)
- interpreter used (Anthropic PrintSynth): **True**
- model: claude-opus-4-8 · effort xhigh · latency 137.56s

## 4. Automated grade (PROVISIONAL — not technician approval until Mike calibrates)
- score: **78/100** (B)
- hard failure: **False**
- summary: The response correctly identifies the sheet, title, and the star/delta/line contactor roles (KM2/KM3/KM1) matching the Y/Δ/L labels in the drawing, and appropriately flags the absence of any printed voltage and several genuinely small/illegible details. However, it mislabels the KM3:5/L3 and KM3:3/L2 references as 'off-page' when they point within the same sheet, and its description of FR1 as being in the 'delta current path' is inconsistent with its own identification of KM1 as the line contactor. No hard failures (invented tags, fabricated voltages, or false certainty on illegible text) were found, so the response merits a solid but not perfect grade.

## 5. Verified strengths
- Correctly extracts the title 'YKA ..-30, YDA ..-30 Star-Delta Starters, Open Type Version, Protection by Thermal O/L Relay' and sheet number 2/4.
- Correctly maps KM2→Y (star), KM3→Δ (delta), KM1→L (line), matching the labels under the contactors in the Local/Remote Control diagrams.
- Correctly notes the absence of any printed voltage value on the sheet and appropriately defers to other sheets for ratings.
- Appropriately flags illegible/small details (FR1 97-98 destination, KT contact routing) instead of asserting them as fact.

## 6. Suspected errors / hallucinations
- "Thermal O/L relay in the motor (delta) current path — heater elements on 2/T1, 4/T2, 6/T3" — FR1's heater terminals (2/T1,4/T2,6/T3) are drawn immediately below KM1, which the same response identifies as the 'L' (line) contactor, not specifically the delta path; calling it the 'delta current path' is an unsupported/inconsistent characterization.
- "🧩 2 off-page ref(s): KM3 : 5/L3, KM3 : 3/L2" — These dashed references point to KM3 terminals in the power circuit diagram on the same page, not to another sheet, so labeling them 'off-page' misrepresents the drawing's cross-reference structure.

## 7. Items requiring technician review
- Confirm whether FR1's heater elements truly sense only delta-run current or full line current through KM1, per actual panel wiring.
- Verify KT 15/16/18 contact assignment to KM2/KM3 coils by zooming into the timer symbol.
- Confirm FR1 97-98 contact destination, which the response could not read.
- Check sheets 1/4 and 4/4 for actual control/motor voltage ratings, as none appear on this sheet.

## 8. Build & runtime
- commit: `688d331e9aeeb85caab5a7c9359d4d044d5d3932` · branch: feat/internet-print-test-runner · version: 3.137.2
- judge model: claude-sonnet-5 · run: 2026-07-13T20:32:01Z

## 9. Source URL
https://library.e.abb.com/public/ac6b6e46df1ea3e6c1256e35004c9145/Star-delta%20Starters%20Open%20Type_technical%20data.pdf