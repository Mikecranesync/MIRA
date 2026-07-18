# Tower OP (Kid Power Towers) Print Benchmark — Real Telegram Backend

**Date:** 2026-07-18 · **Corpus:** 12 photos (Pixel 9a, 4000×3000) of the Heege "Tower OP" electrical
print set, doc **53-075-113-3 EN** (9 circuit sheets) + **53-075-101-4 EN** (3 PLC LED/diagnostic
table pages). Uploaded by Mike to Drive; SHA-256 cataloged in `~/Desktop/T7_Drive_Inventory` style.
**Path under test:** the LITERAL production handler `bot._try_print_translator_reply` via
`tools/internet_print_test/submit.py` (no mocks, no live token), worktree @ origin/main `2e6fdd0e`
(includes #2788 vision fix). **Provider config:** Doppler `factorylm/stg`.
**Judges:** independent Claude vision agents reading the actual photo + verbatim reply, adversarial rubric
(direct answer / invented tags / lookup accuracy / live-state honesty / groundedness).

## Environment findings (before any scoring)

| # | Finding | Status |
|---|---|---|
| E1 | **glm-ocr endpoint unresolvable** from this env (`nodename nor servname`) — primary OCR dead | needs prod check |
| E2 | **Paid interpreter quota-dead**: OpenAI `insufficient_quota` 429 on every attempt → `interpreter_used=false` on 12/12; ALL answers came from the free cascade (Together `gemma-3n-E4B-it` vision + text) | ACTION: check prod key/quota |
| E3 | Lane A ran with **0 OCR items on all 12 cases** (tesseract missing from agent PATH) → the deterministic spine (`deterministic_qa`) never fired once. Lane A therefore measures pure cascade-freestyle mode | Lane B re-runs with tesseract |

## Pinned routing bugs (deterministically reproduced)

| Bug | Evidence |
|---|---|
| **R1 — caption gate drops legit print questions.** `is_print_question()` (`shared/print_translator.py:270`, gate at `telegram/bot.py:1000`) returns **False** for: "Which switches monitor the pawl positions…", "Which relays switch the pretension magnets…", "According to the PLC display table, what does it mean when the FF LED is lit?" → c06/c08/c10 were declined in 0.3 s, **before vision ran**. A tech photographing a print + asking a real question gets bounced out of the print path on keyword luck. Same family as kiosk GFF-hijack (#2660) and UNSEEN-2 German-routing — the English signal set is still too narrow (no pawl/relay/magnet/LED/table/display vocabulary). |
| **R2 — LED/diagnostic table pages misclassified `EQUIPMENT_PHOTO`** (c11/c12): caption routes fine, vision classification rejects the page → print rung declines. Open PR **#2713 (visual-first photo routing)** is exactly this territory; these two photos are ready-made regression fixtures for it. |

## Lane A results (OCR dead — cascade freestyle). 12 cases: 0 pass / 2 partial / 7 fail / 3 not-handled

| Case | Sheet | Verdict | Score | Key failure |
|---|---|---|---|---|
| c01 K1 coordinates | control current p6 | FAIL | 1 | Answered "184C" — not the sheet/column grid convention; fabricated-looking ref |
| c02 motor ratings | main circuits | FAIL | 1 | Missed P=2.2 kW / 4.95 A entirely; **hallucinated 140+ nonexistent contactor tags (K2.5–K2.147)** |
| c03 K4.1–K4.4 role | inverter control | PARTIAL | 5.5 | Mapped relays to inverters correctly; dodged the readable "torque limitation (R1)" label as "unclear" |
| c04 TDC switch | inputs car 1 | FAIL | 2 | Named **S5.1** — print clearly shows **S7.1**; wrong device, confident tone |
| c05 sensor P/Ns | inputs car 2/3 | FAIL | 2 | Claimed part numbers "not labeled" — legend clearly shows XS1-N30PA340 / XS1-N18PC410 |
| c06 pawl switches | inputs car 3/4 | NOT HANDLED | 0 | Bug R1 (caption gate) |
| c07 S19 meaning | rope/pawl inputs | FAIL | 1 | "Not indicated on this diagram" — the label is printed above the switches; refusal-as-evasion |
| c08 pretension relays | outputs/e-stop | NOT HANDLED | 0 | Bug R1 |
| c09 supply feeds | wiring diagram | PARTIAL | 6 | 480V/240V 60 Hz correct — then credibility destroyed by a fabricated component inventory |
| c10 FF LED | LED table p24 | NOT HANDLED | 0 | Bug R1 |
| c11 IG 1 Hz flash | LED table p25 | NOT HANDLED | 0 | Bug R2 (EQUIPMENT_PHOTO) |
| c12 X6.3 elems 5–8 | LED table p26 | FAIL | 0 | Bug R2 → null reply |

**Lane A mean correctness: 1.7/10.** Dominant failure classes: (1) fabricated device tags,
(2) wrong-device confident answers, (3) "not shown" refusals for clearly printed text,
(4) wrong coordinate convention, (5) routing drops.

## Lane B results (tesseract in PATH — but the spine is glm-ocr-fed)

Lane B re-ran all 12 sequentially with tesseract 5.5.2 resolvable. **Result: still 0 OCR items on
every case.** Root cause: `ocr_items` are produced ONLY by **glm-ocr** (`vision_worker._call_ocr`,
model `GLM_OCR_MODEL=glm-ocr:latest` via `OLLAMA_BASE_URL`); tesseract feeds a separate backup
string (`tesseract_text`) that (a) is garbage on a 4000×3000 schematic photo (426 chars of noise)
and (b) is not what the deterministic layer consumes. Lane B therefore reproduced Lane A's
conditions — and its failure classes: c04 repeated the **same wrong device** (S5.1 instead of
S7.1), c05 repeated the **same "not labeled" refusal** for clearly printed part numbers, c02 found
2.2 kW this time but still missed 4.95 A (run-to-run variance in magnitude, stability in class).

## 🔴 The deployment smoking gun (verified live)

- **Staging bot:** `OLLAMA_BASE_URL=disabled://staging` — glm-ocr is *deliberately disabled*.
  Verified in stg container env + live logs: `glm-ocr call failed: unsupported protocol
  'disabled://'` → `classified as ELECTRICAL_PRINT (0 OCR items)` — **including Mike's own Tower OP
  test photos at 14:04/14:09 UTC today.**
- **Prod bot:** zero print-photo turns in 168 h of logs (nobody exercises prints on prod), and its
  `OLLAMA_BASE_URL` default (`host.docker.internal:11434`) points at an Ollama the VPS does not run.
- **Conclusion:** the deterministic print-QA spine (UNSEEN-1's zero-cost fast-path and everything
  that consumes `ocr_items`) is **structurally inert on every deployed chat surface**. Every real
  print question runs in free-cascade freestyle mode — the mode this benchmark scored at 1.7/10.
- Compounding: the paid interpreter is quota-dead (OpenAI 429 `insufficient_quota`), so there is no
  strong-model fallback either.

## Verdict

**The current Telegram backend fails this real-world print set.** 0/12 clean passes. The failures
are not model-quality noise — they are three specific, fixable system gaps:

1. **Routing drops (R1/R2):** 5 of 12 legitimate cases never reached the print pipeline at all.
2. **Evidence starvation:** with OCR dead in deployment, the deterministic layer — which the July
   UNSEEN work built precisely to answer these closed-form questions correctly — never runs. The
   cascade freestyles over a photo instead, producing fabricated tags, wrong devices, and
   "not shown" refusals for text that is plainly printed.
3. **No paid backstop:** interpreter quota exhausted → the worst model answers the hardest questions.

## Recommended actions (ranked)

1. **Restore an OCR evidence source in deployment** — either host glm-ocr somewhere reachable
   (BRAVO's Ollama over Tailscale for staging; a small OCR sidecar for prod) or wire the printsense
   Tesseract token path (`xref_extractor.ocr_tokens`) into the vision worker as a real fallback that
   POPULATES `ocr_items` (downscaled/tiled to make tesseract usable on phone photos). Until then,
   every deterministic print feature ships dark.
2. **Widen `is_print_question` signals (R1)** — pawl/relay/magnet/LED/display/table vocabulary;
   add c06/c08/c10 captions as routing fixtures. Same-family precedent: UNSEEN-2, kiosk #2660.
3. **Land visual-first photo routing (#2713) with c11/c12 as fixtures (R2)** — diagnostic-table
   pages must reach the print/document path.
4. **Fix or remove the OpenAI interpreter key** — 429 on 100% of attempts adds ~5 s latency to every
   print turn for nothing.
5. **Freeze this corpus as the first real-world benchmark case set** (12 photos + 12 rubrics +
   judge verdicts are all on disk under `scratchpad/printbench/`) — per the golden-corpus law,
   entering as *seen* truth. It measures exactly the failure classes customers will hit.

## Artifacts

- Evidence (verbatim replies, both lanes): `printbench/evidence/*.json`, `printbench/evidence-b/*.json`
- Cases + expected truths: `printbench/cases.json`
- Photos: `scratchpad/towerop/*.jpg` (SHA-256 logged in run output)
- Workflow: run `wf_b33ab427-1de` (20 agents, 12 submits + 12 judges, ~1.4M subagent tokens)
