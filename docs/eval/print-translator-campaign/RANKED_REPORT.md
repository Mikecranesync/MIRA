# Print Translator Campaign — Ranked Findings

**Date:** 2026-07-10
**Scope:** Bounded real-inference run against real official-OEM PDFs, driving the actual
production handler (`mira-bots/telegram/bot.py::_try_print_translator_reply`) with a spied
`engine.vision` / `engine.router` — no Telegram network, no mocks of the print-translator logic
itself. Full method + honesty contract: `tools/print_translator_eval/run.py`.

Every number below traces to a result JSON in `docs/eval/print-translator-campaign/results/`
(ids `03, 05, 07, 09, 13, 14, 17, 18, 20, 21, 22, 25`). No number, quote, or classification here
is estimated or invented.

---

## Headline number: the trigger rate

**11 of 25 corpus entries were genuinely fetchable and run. 1/11 (9%) reached the LLM cascade
(`ELECTRICAL_PRINT`). 10/11 (91%) were mis-classified before the print translator ever ran.**

| # | OEM | Category | Classification | Triggered? | Result JSON |
|---|---|---|---|---|---|
| 3 | ABB | European/IEC | `EQUIPMENT_PHOTO` (0.65) | N | `results/03.json` |
| 5 | Rockwell Automation | NEMA Starters | `EQUIPMENT_PHOTO` (0.65) | N | `results/05.json` |
| 7 | AutomationDirect | NEMA Starters | `EQUIPMENT_PHOTO` (0.65) | N | `results/07.json` |
| 9 | Rockwell Automation | Safety Relays | `EQUIPMENT_PHOTO` (0.65) | N | `results/09.json` |
| 13 | AutomationDirect | PLC I/O | `EQUIPMENT_PHOTO` (0.75) | N | `results/13.json` |
| 14 | AutomationDirect | PLC I/O | `EQUIPMENT_PHOTO` (0.70) | N | `results/14.json` |
| 17 | AutomationDirect | VFD | `EQUIPMENT_PHOTO` (0.65) | N | `results/17.json` |
| 18 | ABB | VFD | **`ELECTRICAL_PRINT` (0.76)** | **Y** | `results/18.json` |
| 20 | WEG | VFD | `EQUIPMENT_PHOTO` (0.70) | N | `results/20.json` |
| 21 | AutomationDirect | Reversing/Braking | `NAMEPLATE` (0.65) | N | `results/21.json` |
| 25 | Yaskawa | Reversing/Braking | `EQUIPMENT_PHOTO` (0.75) | N | `results/25.json` |
| 22 | Rockwell Automation | Reversing/Braking | — | not run | `results/22.json` (unfetchable) |

**By category (of the entries actually run):**

| Category | Run | Gate-pass | Mis-classified |
|---|---|---|---|
| European/IEC | 1 | 0 | 1 (EQUIPMENT_PHOTO) |
| NEMA Starters | 2 | 0 | 2 (EQUIPMENT_PHOTO) |
| Safety Relays | 1 | 0 | 1 (EQUIPMENT_PHOTO) |
| PLC I/O | 2 | 0 | 2 (EQUIPMENT_PHOTO) |
| VFD | 3 | 1 | 2 (EQUIPMENT_PHOTO) |
| Reversing/Braking | 2 | 0 | 1 EQUIPMENT_PHOTO, 1 NAMEPLATE |
| **Total** | **11** | **1** | **10** |

Every single mis-classification is a case where the vision model **correctly identified the
image as an electrical drawing/wiring diagram** in its own description — the gate defect, not
the vision model, is the bottleneck. See the exact vision-model text for every mis-classified
entry in the linked JSON files.

---

## Ranked findings (worst-blocking-issue first)

### #1 — The classifier gate blocks the great majority of real prints (measured, not estimated)

`mira-bots/shared/workers/vision_worker.py::_classify_photo` mis-routed 10/11 (91%) of real
official-OEM electrical prints run in this campaign, spanning every manifest category. Two
independent, deterministic defects, both reproduced against real captured vision-model output
(see `regression_fixtures/test_classifier_gate.py`):

1. **Substring matching, not word-boundary matching.** `EQUIPMENT_FACE_KEYWORDS` /
   `NAMEPLATE_KEYWORDS` are checked with plain `kw in combined`. Common English words that
   happen to *contain* a keyword false-positive:
   - `"titled"` contains `"led"` → entries #17 (GS20) and #14 (D0-06) tripped
     `EQUIPMENT_PHOTO` off a vision description that literally says *"the diagram is titled
     'Control Circuit Wiring Diagrams ... Full I/O Wiring Diagram'"*.
   - `"displays"` contains `"display"` → entries #5 (Rockwell 509) and #25 (Yaskawa V1000).
   - `"illustrating"` contains `"rating"`, and `"tables"` contains `"table"` → entry #21
     (AutomationDirect AN-GS-022 reversing note) tripped the `NAMEPLATE` structural
     `_spec_table` detector, a *different* misclassification target than
     `EQUIPMENT_PHOTO` — proving the substring defect isn't confined to one keyword list.

2. **Wrong precedence, even on genuine whole-word matches.** Real prints almost always *name
   the equipment they depict* — "wiring diagram for a DI Safety Relay", "wiring diagram for
   3-phase starters ... Bulletin 509", "Star-Delta Starters ... Protection by Thermal O/L
   Relay". `_classify_photo` checks `EQUIPMENT_FACE_KEYWORDS` **before** `PRINT_KEYWORDS`, so
   the equipment-keyword branch wins even when the same sentence explicitly says "wiring
   diagram" or "electrical drawing." Entries #3 (ABB star-delta, keyword `relay`), #9
   (Guardmaster 440R, keyword `relay`), #13 (CLICK PLC, keyword `plc`), #20 (WEG CFW-11W,
   keyword `hmi`), #25 (Yaskawa V1000, keyword `drive`) all show this pattern.

**This is the single highest-value next improvement.** A small, deterministic fix:

- Word-boundary matching (`re.search(rf"\b{re.escape(kw)}\b", combined)` instead of
  `kw in combined`) for every keyword set in `vision_worker.py`.
- Print-keyword precedence: when a strong, unambiguous print signal is present in the vision
  description ("wiring diagram", "schematic", "ladder diagram", "control diagram", "electrical
  drawing", "connection diagram") the `ELECTRICAL_PRINT` branch should be checked *before* the
  equipment/nameplate keyword branches, not after.

Both defects are captured as deterministic, real-data `xfail` regression tests in
`regression_fixtures/test_classifier_gate.py` — five cases, all traced to real captured
`vision_result` strings from this campaign's JSON records.

### #2 — OCR is genuinely unreachable from this box (measured, caveated everywhere)

Every single result in this campaign — including the one gate-passer (#18) — shows
`"ocr_item_count": 0`. Both OCR paths failed for structural, machine-specific reasons that are
**not** a code defect in the print translator itself:

- `glm-ocr call failed: [Errno 11001] getaddrinfo failed` — the glm-OCR endpoint is not
  DNS-reachable from this dev machine (compose-network-only service).
- `OCR extraction failed: tesseract is not installed or it's not in your PATH` — no local
  Tesseract binary on this box.

Because classification runs off the vision *description* (which reaches Groq successfully every
time — see `LLM_CALL provider=groq ... latency_ms=...` in every run's log), the **trigger-rate
measurement above is production-representative**. But any generated response *content* in this
campaign is OCR-degraded (grounded only in the image + a "No OCR labels were extracted; rely on
the image" fallback line, never real extracted terminal/wire labels) and must be read as
illustrative of the prompt/format layer only — not of production answer quality. Every quote in
this report and in `review_worksheet.csv` carries `"ocr_grounding": "unavailable_on_this_box"`.

### #3 — Manifest URL rot (7 of 25 URLs were literal `"..."` placeholders)

Of the 25 manifest entries, most contained a literal `"..."` in the URL — not a real path.
Resolving real URLs via web search succeeded for 7 (#3, #5, #7, #9, #13, #20, #25 — corrected in
the manifest, see the `Retrieval Note` column, all reachable + `content-type: application/pdf`
verified before running) and failed for 1 (#22 — the only real search hit resolves to a
document already used for entry #5's citation; the literal manifest URL for #22 redirects to
the Rockwell marketing homepage, which PyMuPDF happily renders as a flowable HTML "PDF" — this
was caught and NOT run, to avoid manufacturing a false result). This is a corpus-curation gap,
not a Print Translator defect, but it materially bounded how many of the 25 entries could be
run in this campaign (11/25 fetchable, not 25/25).

---

## Where the translator is EXCELLENT: the prompt/grounding/format layer

Once a print clears the gate, the layer that actually explains the print is solid, on both real
and pre-existing evidence.

> **New evidence (2026-07-10 gate-bypass runs):** so a reviewer has actual output to judge, all
> 10 first-10 prints were also run through the REAL production prompt path directly
> (`print_translator.build_theory_messages` → real `engine.router.complete` → real
> `format_theory_reply`), skipping ONLY the buggy classifier gate — same production prompt, real
> cascade, real image, real captured vision output (`ocr_items` empty). Records:
> `results/<id>.gate_bypassed.json` (`mode: gate_bypassed_real_prompt_real_model_real_image_ocr_empty`).
> **10/10 produced a real, correctly-structured 6-section explanation** with hedged framing and no
> invented labels beyond what's visible — e.g. the Yaskawa V1000 (`results/25.gate_bypassed.json`)
> correctly reads forward/reverse run-stop digital inputs, fault output, motor U/V/W, and single-
> vs three-phase supply terminals off the connection diagram. Still OCR-degraded
> (`ocr_grounding: unavailable_on_this_box`) — illustrative of the prompt/format layer, not of
> production answer quality. These are the reviewable "EXCELLENT-layer" artifacts in the package.

- **Real gate-passer (entry #18, ABB ACS355 VFD manual, page 50 — a genuine "Connection
  diagram" page).** The model produced a correctly-structured 6-section reply (see excerpt
  below) with hedged framing ("This appears to be...") and no invented terminal numbers beyond
  what's visible in the image, exactly per `mira-bots/shared/print_translator.py`'s system
  prompt contract.
- **43 pre-existing unit tests, all passing** (`mira-bots/tests/test_print_translator.py` — 28
  tests on `is_theory_request` / `build_theory_messages` / `format_theory_reply` — and
  `mira-bots/tests/test_telegram_print_translator.py` — 15 tests on the real handler wired
  against a mocked vision/router, covering trigger conditions, the grounding contract (OCR-only,
  no invented labels), the read-only/no-writes contract, and LLM-failure fallback). Verified in
  this campaign: `python -m pytest mira-bots/tests/test_print_translator.py
  mira-bots/tests/test_telegram_print_translator.py -q` → **43 passed**.

### The one real gate-passer response, verbatim (entry #18, ABB ACS355)

> `"ocr_grounding": "unavailable_on_this_box"` — grounded only in the rendered image (0 OCR
> items); illustrative of the prompt/format layer only, NOT of production answer quality
> (production has real glm-OCR + Tesseract grounding).

```
## **1. What this appears to be**
This appears to be a connection diagram for connecting power cables to a drive and motor system.

## **2. Main visible components**
- A drive with input and output connections
- A motor
- Grounding points (PE)
- Brake resistor connections (BRK+, BRK-)
- Optional common DC connection

## **3. Plain-English theory of operation**
The drive appears to be connected to a three-phase motor (U1, V1, W1). The drive has input
connections for power (U1/L, V1/N, W1) and output connections to the motor. There are also
connections for a brake resistor (BRK+, BRK-). The diagram shows grounding points (PE) for both
the drive and motor.

## **4. What must be true for it to work**
- Proper phase connections from the drive to the motor (U1, V1, W1)
- Correct grounding of the drive and motor (PE)
- Optional: Brake resistor connected (BRK+, BRK-)

## **5. What would stop it from working**
- Incorrect phase connections
- Missing or improper grounding
- Open brake resistor connections (if used)

## **6. Unclear or unreadable items**
Nothing major unreadable.
```

Full record: `results/18.json` (`router_usage`: groq/meta-llama/llama-4-scout-17b-16e-instruct,
2800 input / 270 output tokens).

---

## Bottom line

The classification gate — not the prompt, not the LLM, not the vision model — is the reason a
technician sending a real print to the bot today would get "handled" only about 1 time in 11.
The fix identified is small, deterministic, and testable against the exact real defects captured
here (`regression_fixtures/test_classifier_gate.py`). Everything downstream of the gate (prompt
construction, grounding discipline, hedged framing, six-section format) is already solid per 43
passing unit tests and the one real end-to-end pass captured in this campaign.
