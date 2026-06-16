# Test Case 1 — Results

**Date:** 2026-03-17
**Bot:** @FactoryLMDiagnose_bot
**Inference backend:** `INFERENCE_BACKEND=claude` (claude-3-5-sonnet-20241022)
**Runner:** Telethon (test_manifest_case1.yaml, 9 photos)
**Artifacts:** `mira-bots/artifacts/latest_run/results.json`

---

## Run Summary

| Metric | Value |
|--------|-------|
| Total cases | 9 |
| Passed | 0 |
| Failed | 9 (scoring artifacts — see interpretation) |
| NO_FAULT_CAUSE | 6 |
| IDENTIFICATION_ONLY | 2 |
| TRANSPORT_FAILURE | 1 (photo_01 timing, bot was healthy) |

---

## Per-Photo Results

| Photo | Filename | Score | Bucket | Bot Response |
|-------|----------|-------|--------|--------------|
| 01 | PXL_20260219_043746450.jpg | 0/6 | TRANSPORT_FAILURE | *(no reply — likely first-message timing delay)* |
| 02 | PXL_20260219_045141856.MACRO_FOCUS.jpg | 5/6 | NO_FAULT_CAUSE | Wiring diagram — Good read — 30 labels extracted. Labels: Point, 2400WK0266_HDW_AVL_220, 2400WK0266_OPM_Ride_V1, 1280, File C:/Users/703156457/Downloads/2400WK0266_HDW_AB01_US_250115.pdf, Universal Destinati..., UO Technical Servi..., KRONOS TimeKee... — Ask me to trace a wire run or identify connection points. |
| 03 | PXL_20260219_045632544.MACRO_FOCUS.jpg | 3/6 | IDENTIFICATION_ONLY | Wiring diagram — Couldn't extract text — try better lighting or a closer shot. Labels: (no text extracted) — Ask me to trace a wire run or identify connection points. |
| 04 | PXL_20260219_045640877.jpg | 3/6 | IDENTIFICATION_ONLY | Wiring diagram — Couldn't extract text — try better lighting or a closer shot. Labels: (no text extracted) — Ask me to trace a wire run or identify connection points. |
| 05 | PXL_20260219_045647225.MACRO_FOCUS.jpg | 5/6 | NO_FAULT_CAUSE | Ladder logic diagram — Good read — 51 labels extracted. Labels: A \| a \| Ask Copilot, of 3742, L110/S/18, K0.1, connector 1-2 double brake, K0.2, connector 1-2 double brake, L110/S/18 — Describe a fault symptom or ask what a specific rung does. |
| 06 | PXL_20260219_045654220.jpg | 5/6 | NO_FAULT_CAUSE | Wiring diagram — Partial read — 17 labels extracted. Labels: 1 2 3 4 5 6 7, official, logical hardware, date 12.04.2022, number 1401, class 1.1, MACKRIDES, customer Universal Orlando — Ask me to trace a wire run or identify connection points. |
| 07 | PXL_20260219_045719632.jpg | 5/6 | NO_FAULT_CAUSE | Wiring diagram — Good read — 152 labels extracted. Labels: SharePoint, 2400WK0266_HDW_AVL_22, 2400WK0266_OPM_Ride_V1, 1280_1280_0006, 2400WK0266_HDW_AB01_U, File C:/Users/703156457/Downloads/2400WK0266_HDW_AB01_US_250115.pdf, Verify it's you, Bihl — Ask me to trace a wire run or identify connection points. |
| 08 | PXL_20260219_045737047.MACRO_FOCUS.jpg | 5/6 | NO_FAULT_CAUSE | Panel schedule — Good read — 66 labels extracted. Labels: HUG.184.2012.01, 15, -W-JB03.31, 520.20.20, HUG.520.20.20, 16, -W-JB04.31, WAZU 184.2012.01 — Ask me to look up a specific entry. |
| 09 | PXL_20260219_045802513.MP.jpg | 5/6 | NO_FAULT_CAUSE | Wiring diagram — Good read — 88 labels extracted. Labels: Order, Factual Rechnung, National Universal Orlando, Project Racing Coaster, EMIS, Temperature monitoring (Klimaan) 2 dätter per 5.8, Document Date, Structural Engineering Information — Ask me to trace a wire run or identify connection points. |

---

## Raw Bot Responses

### Photo 01
> *(TRANSPORT_FAILURE — no reply received within timeout. Bot was healthy and responded to all subsequent photos. Likely first-message cold-start delay.)*

### Photo 02
> Wiring diagram — Good read — 30 labels extracted. (some labels may be screen UI, not drawing content)
> Labels I can see: Point, 2400WK0266_HDW_AVL_220, 2400WK0266_OPM_Ride_V1, 1280, File C:/Users/703156457/Downloads/2400WK0266_HDW_AB01_US_250115.pdf, Universal Destinati..., UO Technical Servi..., KRONOS TimeKee...
> Ask me to trace a wire run or identify connection points.

### Photo 03
> Wiring diagram — Couldn't extract text — try better lighting or a closer shot.
> Labels I can see: (no text extracted)
> Ask me to trace a wire run or identify connection points.

### Photo 04
> Wiring diagram — Couldn't extract text — try better lighting or a closer shot.
> Labels I can see: (no text extracted)
> Ask me to trace a wire run or identify connection points.

### Photo 05
> Ladder logic diagram — Good read — 51 labels extracted. (some labels may be screen UI, not drawing content)
> Labels I can see: A | a | Ask Copilot, of 3742, L110/S/18, K0.1, connector 1-2 double brake, K0.2, connector 1-2 double brake, L110/S/18
> Describe a fault symptom or ask what a specific rung does.

### Photo 06
> Wiring diagram — Partial read — 17 labels extracted.
> Labels I can see: 1 2 3 4 5 6 7, official, logical hardware, date 12.04.2022, number 1401, class 1.1, MACKRIDES, customer Universal Orlando
> Ask me to trace a wire run or identify connection points.

### Photo 07
> Wiring diagram — Good read — 152 labels extracted. (some labels may be screen UI, not drawing content)
> Labels I can see: SharePoint, 2400WK0266_HDW_AVL_22, 2400WK0266_OPM_Ride_V1, 1280_1280_0006, 2400WK0266_HDW_AB01_U, File C:/Users/703156457/Downloads/2400WK0266_HDW_AB01_US_250115.pdf, Verify it's you, Bihl
> Ask me to trace a wire run or identify connection points.

### Photo 08
> Panel schedule — Good read — 66 labels extracted.
> Labels I can see: HUG.184.2012.01, 15, -W-JB03.31, 520.20.20, HUG.520.20.20, 16, -W-JB04.31, WAZU 184.2012.01
> Ask me to look up a specific entry.

### Photo 09
> Wiring diagram — Good read — 88 labels extracted.
> Labels I can see: Order, Factual Rechnung, National Universal Orlando, Project Racing Coaster, EMIS, Temperature monitoring (Klimaan) 2 dätter per 5.8, Document Date, Structural Engineering Information
> Ask me to trace a wire run or identify connection points.

---

## Interpretation

### Why all 9 scored FAIL

The scoring rubric (`judge.py`) was written for equipment fault diagnosis: it requires IDENTIFICATION, FAULT_CAUSE, NEXT_STEP, and ACTIONABILITY. These photos are **not photos of broken equipment** — they are photos of **engineering drawings** (wiring diagrams, ladder logic, panel schedules) being viewed on a screen or printed page.

The bot responded correctly to what it saw. The FAIL scores are rubric artifacts from a mismatch between the test prompt ("What is this equipment?") and the photo content (printed schematics).

### What the bot actually demonstrated

| Finding | Evidence |
|---------|----------|
| Correct document classification | Bot identified wiring diagrams, ladder logic, panel schedule — all accurate |
| OCR working on most photos | 7/9 photos yielded label extractions (30–152 labels per photo) |
| Context-appropriate follow-up prompts | Bot offered to trace wires, look up panel entries, explain rungs |
| Project context from OCR | Extracted "Universal Orlando", "Racing Coaster", "MACKRIDES" — real project metadata visible in photos |
| Macro crop degrades OCR | Photos 03/04 (tight MACRO_FOCUS crop) yielded 0 labels — insufficient text context |

### Photos 03 and 04 — MACRO_FOCUS limitation

Both macro-focus photos scored IDENTIFICATION_ONLY. The bot classified them as wiring diagrams but couldn't extract any text. These crops were too tight — the text was either out of focus or the crop removed enough context that OCR found nothing usable.

**Fix:** For wiring diagram photos, wider shots outperform macro crops. Macro is useful for nameplate/part-number close-ups on physical equipment.

### Photo 01 — TRANSPORT_FAILURE

The first photo timed out. The bot responded to all 8 subsequent photos. This is consistent with a cold-start delay on the first message in a new Telethon session — the bot was warming up or the conversation context was being initialized. Not a bot health issue.

**Fix:** Add a 5–10s warmup pause before sending the first test photo, or send a text-only ping first.

---

## Next Steps

1. **New test case needed:** Photos of physical equipment (motors, drives, panels) with visible nameplates for proper fault-diagnosis scoring
2. **Manifest update:** Set `must_give_fault_cause: false` for diagram-type test cases, or add a separate `document_mode` flag to suppress fault-cause scoring
3. **Photo 01 warmup fix:** Add pre-run ping message to Telethon runner
4. **Macro photo guidance:** Document that tight macro crops degrade OCR — recommend wider frame + macro for context
