# Pixel 9a — first MIRA Staging session log (2026-09-22 00:16–00:20Z)

**Device:** Pixel 9a, Android 16, `com.factorylm.mira.staging` v1.2.0 (11), debug-signed, from main `fe1aea37e` (#3938).
**Backend:** `https://app-staging.factorylm.com` at `dd41c7f8e` (v3.351.7). Verified from inside the running app via WebView devtools.
**Captured how:** WebView `Runtime.evaluate` (DOM text + the app's own session calling `GET /api/equipment-notebooks/{id}/`), `adb pull` of the two photos, `screencap`. No backend SSH used. Raw: `2026-09-22-pixel9a-staging-session/persisted-turns.json`.
**Notebook:** "Conveyor 4 (host-l0 proof)" `93d8c68e-…` — **0 sources, no asset binding, identityStatus `unknown`, manufacturer/model null.** Every turn below ran with `basis: general_reasoning` and rendered the "General guidance — not grounded in this machine's documents" badge. No `safety_notice` on any turn.

## The turns

| # | Time (Z) | Input | MIRA | Latency* |
|---|---|---|---|---|
| 1 | 00:16:55 photo → 00:17:02 | Camera photo of a **cardboard box label** + "What is this" | "a product label stuck to cardboard… part number 'X0026705…', width 2.5 in, made in China… cross-reference with the parts list" | ~7 s |
| 2 | 00:18:16 photo → 00:18:28 | Gallery photo of a **Siemens TP700 Comfort nameplate** + "Can you help me replace this screen" | LOTO first, then 9 generic steps (remove front cover, unplug display module, …), ATEX Zone 2 caution, IP65, 24 VDC; ends with a diagnostic question | ~12 s |
| 3 | → 00:19:28 | Text only: "It has sunspots on it because it's unprotected from direct sunlight. Can you find in the manual what it says about the limitations of this screen in weather and outdoor environments?" | "I don't have the specific operator or service manual for this unit… typically IP65… –20 °C to +60 °C… request it from the supplier" | n/a |

*photo `capturedAt` → turn `createdAt`; the send happened somewhere in between, so these are upper bounds.

## What the photos actually say (vs what MIRA said)

**Photo 1** (`turn1-photo-bearing-box-label.jpg`): barcode `X0026E67Q5`; text `32906X Tapered Roller Bea… Width 2pcs`; `s1905 1600ux0961`; `9268-0717059-10231519`; MADE IN CHINA.
- MIRA misread the barcode (`X0026705…` vs `X0026E67Q5`) and **missed the one useful line: `32906X Tapered Roller Bearing`** — a standard ISO bearing designation (30×47×12 mm) that fully identifies the part. It also invented "width 2.5 in" (label says "Width 2pcs"). Vision extraction on small rotated text is the weak point; the answer then sent Mike to a parts list for a part the label already names.

**Photo 2** (`turn2-photo-siemens-tp700-nameplate.jpg`): SIEMENS **TP700 Comfort**, **1P 6AV2124-0GC01-0AX0**, S/N LBS3073983, Ta 0…+50 °C vertical, F-State 41, CE/Ex/UKCA/FM, ATEX II 3 G/D, DEKRA cert numbers, **"Indoor use only, Watertight"**, **"Front face only: Type 4X/12 · IP65"**, Supply 24 Vdc max 0.85 A, plus the moulded "WARNING – EXPLOSION HAZARD – DO NOT DISCONNECT WHILE CIRCUIT IS LIVE…".
- MIRA read TP700, ATEX Zone 2, IP65, 24 VDC — decent. It did **not** extract the order number `6AV2124-0GC01-0AX0`, the serial, or the temperature/indoor limits, and did not propose the obvious next moves: *identify this notebook as a Siemens TP700 Comfort* (identity stayed `unknown`), *fetch/attach the Comfort Panels operating instructions*, or *bind to the asset*.
- Turn 3 is the sharpest finding. **The nameplate MIRA looked at 60 seconds earlier answers Mike's question directly**: "Indoor use only", "Ta 0…+50 °C", "IP65 front face only". MIRA said it had no information and gave generic advice, including a wrong-for-this-device temperature range (–20 °C to +60 °C; the label says 0 to +50). Why: turn 3 carried no `visual_observation` evidence, and multi-turn history is text-only, so the photo's content was gone; and turn 2 never materialized the nameplate fields as durable evidence (contra `.claude/rules/materialized-evidence.md` rule 3/14 — the discovery lived only in the answer prose).

## Product / engineering observations to work on

1. **Nameplate → identity → manual is the flow this session begged for and never got.** After photo 2 the right reply is one line of identification + "I can attach the Siemens Comfort Panels operating instructions to this notebook" (or a search of the OEM corpus for `6AV2124`). Check whether Siemens Comfort Panel docs exist in `knowledge_entries` on staging; the general notebook path never consulted the OEM corpus regardless.
2. **Visual evidence must persist across turns.** A follow-up about "this screen" should re-use the turn-2 observation (recall, not re-inference). Today the model answers from text history only.
3. **Turn 3 should have been `insufficient_evidence` with a path forward, not `answered` general prose.** "Find in the manual" with 0 sources is an evidence request; the honest status plus an upload/fetch offer beats confident generic text. The generic text was also partly wrong for this device.
4. **Small-text vision accuracy** (photo 1): barcode misread, key line missed, a unit hallucinated ("2.5 in"). Worth a fixture in the vision eval set — this label is a good hard case.
5. **Safety:** turn 2 led with LOTO unprompted and referenced ATEX; the moulded explosion-hazard warning on the housing was not quoted. No `safety_notice` fired (no keyword hit). Acceptable, but "do not disconnect while circuit is live" is exactly the sentence a technician replacing this panel should see verbatim.
6. **UI nit:** the "↓ Latest" pill overlaps answer text at the bottom of the thread (`screen-after-turn3.png`).
7. **Latency** felt fine: 7–12 s photo turns.

## Not captured

Server-side per-turn traces (provider/model, retrieval decision, timings) live in staging `decision_traces` / hub logs and need the staging SSH + `db-inspect` path; not pulled for this quick log.
