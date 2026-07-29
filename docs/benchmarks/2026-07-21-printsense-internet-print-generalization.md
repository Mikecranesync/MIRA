# PrintSense — Internet-Print Generalization Benchmark (2026-07-21)

Durable record of the five-case generalization bench (program plan:
`docs/plans/2026-07-21-printsense-generalization-next-steps.md` §2). This exists so the result is
reproducible evidence, not an unverifiable anecdote.

## Result (the exact claim)

> PrintSense scored approximately **8.6/10 across five previously unseen internet electrical prints
> from five manufacturers**, covering **NEMA and IEC** conventions, with **100% correct document
> classification** and **no identified fabrication**, using the **MiniMax free cascade on the
> no-OCR path** for approximately **$0.07 total inference cost**.

**Defensible framing (use this, not "PrintSense understands any print"):**

> **PrintSense demonstrated strong generalization across unseen industrial electrical prints
> without corpus-specific training or OCR assistance.**

N=5 is a directional signal, not a validated milestone. The success gate (≥15 prints, ≥8 diagram
classes, ≥95% classification, zero unsupported claims, warnings surfaced on every applicable case)
is defined in the program plan and is **not** met by this run alone — Phase 3 pursues it.

## Configuration (config id: `minimax-slim-verify-fullres-noocr@2026-07-21`)

| Setting | Value |
|---|---|
| Vision provider (paid) | **OFF** (`PRINT_VISION_PROVIDER=""` — no Anthropic, no OpenAI) |
| Vision model | `together : MiniMaxAI/MiniMax-M3` (free cascade Groq→Cerebras→Together) |
| Theory style | `PRINT_THEORY_STYLE=slim` |
| Verify pass | `PRINT_THEORY_VERIFY=1` (generate → verify-against-source) |
| Full-res theory | `PRINT_THEORY_FULL_RES=1` |
| OCR floor | **Tesseract unavailable → DEGRADED** (pure-vision path; no OCR grounding) |
| Path | REAL production Telegram rung `bot._try_print_translator_reply` (in-process, no live Telegram) |
| Runner | `tools/internet_print_test/runner.py --telegram-production-path` |
| Cost | ~$0.01/case (≈21k Together tokens/case; envelope shows est-$0 as Together isn't in the cost table) → ≈$0.07 total |

## Grading method (honest)

- **Hand-graded** by the session against each rendered page. The runner's built-in LLM judge was
  **broken at run time** (it called Anthropic and 400'd under the No-Anthropic staging config) — that
  bug is fixed in v3.185.0 (judge repointed to the free cascade), but these five verdicts predate the
  fix and are the author's, not the automated judge's.
- The **$0 per-turn autoeval** (`shared/print_autoeval.py`) ran on every case (severity + flags below).
- Grade scale: 0–10, holistic (identity + component/terminal accuracy + theory-of-operation + honesty +
  absence of fabrication). PROVISIONAL — no calibrated rubric.

## Cases + reproducibility evidence

All sources are public manufacturer literature; original ownership retained by the publisher, retained
for testing only. `access_date_utc` and `original_sha256` are from each case's `source.json`.

| # | test_id | Class | Standard | Grade | Autoeval |
|---|---------|-------|----------|-------|----------|
| 1 | `rockwell-509-nema-starter` | Motor starter (dense pictorial+ladder) | NEMA ICS 2 | **8–9** | ok |
| 2 | `mitsubishi-fx3u-input-wiring` | PLC input-wiring caution sheet | Industrial 24VDC | **8** | ok |
| 3 | `abb-star-delta-starter` | Star-delta contactor (3-diagram) | IEC 60947-4-1 | **9** | ok |
| 4 | `banner-esfl-estop-relay` | E-stop safety relay | ISO 13850 / EN 418 | **9** | ok |
| 5 | `schneider-atv340-vfd` | VFD, multi-connector | IEC 61800-5-1 | **9** | P1 (false positive*) |

Mean ≈ **8.6/10**. Classification: **5/5 `ELECTRICAL_PRINT`** (conf 0.80–0.85).

### Sources (URL · SHA-256 · accessed)

1. **rockwell-509** — `https://literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf`
   · `9d3f977104c86a6ee38aa3f85630a3ad9ff890ec138a43b0d85977479bde6993` · 2026-07-21T05:57:06Z · page 12
2. **mitsubishi-fx3u** — `https://dl.mitsubishielectric.com/dl/fa/document/manual/plc_fx/jy997d19001(e)/jy997d19001(e)e.pdf`
   · `ed5d909ee1874af1c2b7f88bfc2d0f9a61687135b62b799421a079a420c9930e` · 2026-07-21T06:27:41Z · page 0
3. **abb-star-delta** — `https://library.e.abb.com/public/ac6b6e46df1ea3e6c1256e35004c9145/Star-delta%20Starters%20Open%20Type_technical%20data.pdf`
   · `f9eb30746fd22c91bbe160b889fbbbecd93d5997c9fa438fd9a57a7847f1f07f` · 2026-07-21T06:29:17Z · page 4
4. **banner-esfl** — `https://info.bannerengineering.com/cs/groups/public/documents/literature/46262.pdf`
   · `51d7f43177b840657e8ef155ac2d6d6dc5ab554c27b6dd86c05926bc07476587` · 2026-07-21T06:30:09Z · page 4
5. **schneider-atv340** — `https://download.schneider-electric.com/files?...&p_Doc_Ref=NVE97896`
   (301 → `https://download.se.com/files?...`) · `5d8d99b51ecee2eb5e8f085552c3e4b72f0b63295497b88aa7978135ee204785`
   · 2026-07-21T06:30:32Z · page 0

Full per-case artifacts (source.json, sha256.txt, tested_page.png, telegram_response.json,
deterministic_grade.json, report.md, run.log) are preserved under `internet_print_tests/<id>/` on the
run host (`tested_page.png` is gitignored by design).

### Grader notes (per case)

1. **Rockwell 509** — exact caption ("Bulletin 509 Sizes 7 and 8… START-STOP push button station"),
   terminal numbers (L1/L2/L3→20/22/24, CTs on T1-T3, CR A1X–A4X/A1Y–A4Y, 1RES/2RES on 5-7 & 12-6),
   the control ladder + seal-in (Stop→Start→CR A1Y/A1X hold→coil→OL→4), and the economizer/rectifier/MOV
   theory — correct. No fabrication.
2. **Mitsubishi FX3U** — correctly identified as a **generic caution notice, not a device schematic**
   (no hallucinated circuit) and got the AC-vs-DC terminal distinction, including the subtle `(0V)/(24V)`
   parenthesization for DC vs bare `0V/24V` for AC. Truncated slightly by the verify step; zero errors.
3. **ABB star-delta** — star/delta/line contactor roles (KM3/KM2/KM1) + timer-transfer sequence
   textbook-correct; exact doc# (1SBC 0095 00 R1001); FR1 95-96/97-98 correct.
4. **Banner ES-FL-2A** — all terminals (A1/A2, S13-S24, 13-14/23-24, 41-42, S33-S34), redundant outputs,
   feedback loop, and current ratings (4A safety / 0.5A aux) correct. **Gap:** did NOT surface the two
   printed WARNINGs (arc-suppressor placement; never wire a PLC between relay and MSC) → **motivated the
   safety-warning elevation shipped in v3.186.0.**
5. **Schneider ATV340** — every connector/terminal correct (CN1/CN9/CN10 power, CN2 STO, CN3 ENC RS422,
   CN6 DI/DO/AI/AO/R1A-C/R2A-C, CN7 HMI+ETH/Sercos), doc#, torque (0.5 N·m), PTO→second-drive PTI
   daisy-chain. **The two items that historically fooled MIRA here (inventing `DQ1`, mis-wiring RS422)
   are correct.** *The autoeval P1 `tag_flood_without_ocr` is a **false positive** of the no-OCR path
   (many correct tags + zero OCR items) — fixed in v3.186.0 by suppressing that lane when Tesseract is
   structurally unavailable.*

## What this run drove (before → after)

- **Runner/judge infra hardening** (v3.185.0): the broken Anthropic judge, the batch-killing catalog
  fetch, the un-typed skips, and the no-OCR `tag_flood` false positive were all found here.
- **Safety-warning elevation** (v3.186.0): the Banner gap made surfacing printed warnings a product duty.
- **Phase 3** (pending): 10 structurally-different classes to find where PrintSense stops generalizing.
