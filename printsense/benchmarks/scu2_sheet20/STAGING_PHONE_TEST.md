# Staging phone-test protocol — `@Mira_stagong_bot` (PrintSense Phase 0)

The interpreter *quality* was evaluated rigorously off-bot (see the acceptance eval:
same Phase-0 code, full artifacts). This protocol covers the two things that can
**only** be proven end-to-end on the deployed staging bot — which the agent cannot
drive (bots can't message bots; staging has no Telethon *user* session) and which
need the container's Tesseract (the dev box has none):

1. **Bot routing + reply** — a print photo actually reaches the Anthropic interpreter and replies.
2. **Auto-rotate (rotation-invariance)** — a rotated photo is uprighted in-container by Tesseract OSD.

Staging bot: **`@Mira_stagong_bot`** (token `TELEGRAM_BOT_TOKEN_STG`). Deploy: `stg-mira-bot-telegram`
recreated on SHA `1221aca9` (VERSION 3.136.0). Do **not** use the prod bot `@FactoryLM_Diagnose`.

## What a healthy reply looks like
On a print photo + a print question, the bot should first ack:
`🔍 Reading your electrical print — a full interpretation takes ~30–60 s…`
then reply with a typed summary: `📐 <cabinet · drawing · sheet>`, devices, wires/terminals,
an `⚠️ Couldn't read (retake…)` list, and always the caveat
`🔎 Proposed interpretation … not yet field-verified. Meter before you act.`

## The five sends (caption each with a print question, e.g. "explain this print")

| # | Send | Expect / check |
|---|---|---|
| 1 | **SCU2 sheet-20, upright** (`_eval_inputs/01_sheet20_upright.jpg`) | Reads `📐 …AP31971 · +SCU2 · sheet 20`; devices `-21/A13`,`-21/A14`; wires `-W5497`,`-W5469` (NOT `-WK…`). Matches the 95/A off-bot result. |
| 2 | **SCU2 sheet-20, rotated 90°** (`_eval_inputs/02_sheet20_rotated_asdelivered.jpg`) | **Auto-rotate proof:** materially the SAME facts as #1 (same wires/devices/package). This is the criterion the dev box can't test (no Tesseract). |
| 3 | **SCU2 sheet-20, low-res** (`_eval_inputs/03_sheet20_lowres.jpg`) | Reads the big items; MORE items in the `⚠️ Couldn't read` list; **no wrong tags** (degrades to unresolved, never guesses). |
| 4 | **SCU2 sheet-5** (`_eval_inputs/04_scu2_sheet5.jpg`) | Reads `-5/A100` (EK1100), `-5/A101` (EL2008)… — a different sheet, still grounded. |
| 5 | **Unrelated print / a non-SCU2 device** | Reads its own labels; must **not** invent SCU2 tags. Generalization + no cross-contamination. |

## No-regression check (ordinary Telegram image handling)
Send a **nameplate / equipment photo** (a motor or drive nameplate) with a caption like
"what drive is this?". It must route to the **existing nameplate/drive flow**, NOT the print
interpreter — i.e. the print path only claims `ELECTRICAL_PRINT` photos with a print question.
(Covered by 15 fall-through unit tests; this is the live confirmation.)

## Acceptance (staging)
- #1 reads package + `-21/A13/A14` + `-W5497/-W5469` (no `-WK`), 0 confident misreads.
- #2 (rotated) ≈ #1 on the facts (auto-rotate works in-container).
- #3 degrades to more-unresolved, no new wrong tags.
- #5 no SCU2 hallucination.
- No-regression: a nameplate photo still hits the nameplate flow.

Report back what each reply said (or screenshot) and the agent folds it into the staging report.
The images above are the exact files used off-bot; you can also send the originals from your phone.
