# Phone tests — log-derived timeline (PROD bot @FactoryLM_Diagnose, 2026-07-15 04:24–04:42Z)

**Surface correction:** Mike ran the kit against the **production** bot (staging appeared dead
to him — see the staging note below). This is still a valid test of the merged ladder:
deploy-vps ran green three times after the merges, and the deploy live during these tests was
run 29386341745 on `571b5af6` (completed 03:21:48Z), which contains all six ladder PRs.

Timeline reconstructed read-only from `docker logs mira-bot-telegram` (token-bearing URLs
redacted; the raw log lines print full bot tokens — that defect + the rotation are tracked
separately):

| # | sent (UTC) | caption | classification | interpret | replied | wall | maps to |
|---|---|---|---|---|---|---|---|
| 1 | 04:24:03 | "Explain this print to me" | ELECTRICAL_PRINT 0.85, 18 OCR items | printsense `claude-opus-4-8`, **devices=2** | 04:27:20 | 3m17s | kit-01 sheet-20 belegt (2 devices = -21/A13/A14) |
| 2 | 04:28:56 | "Explain this print to me" | ELECTRICAL_PRINT 0.90, 5 OCR items | printsense `claude-opus-4-8`, **devices=10** | 04:32:11 | 3m15s | kit-02 sheet 5 (10 devices = A100–A107 + U1/U2) — the reply Mike pasted; graded PASS in `../mira-staging/2026-07-15_kit-02_sheet5_single.md` (file predates the surface correction; content of the assessment stands) |
| 3 | 04:35:28 | "Explain this print to me" | ELECTRICAL_PRINT 0.90, **0 OCR items**; autorotate OSD failed ("too few characters"); glm-ocr call failed | printsense `claude-opus-4-8`, **devices=4** | 04:39:45 | 4m17s | kit-03 sheet 6 **upside-down** (4 devices = A101–A104) — interpreted despite failed OSD/OCR; response text not yet captured (Mike: paste/screenshot it) |
| 4 | 04:41:21 | ALBUM ×2: "What do these mean together" / "Analyze this equipment photo" (re-sent the same two files as #2+#3) | both ELECTRICAL_PRINT | **NOT printsense** — `photo_batch_worker` batch_id=3 n=2 → groq `llama-3.3-70b-versatile` (284 in / 155 out) | 04:42:04 | ~43s | Test-2 album — **bypassed the print interpreter** (finding below) |

## Findings

1. **Album path bypasses the print interpreter (product gap).** Multi-photo albums route to
   `photo_batch_worker` → free-cascade vision QA, never `interpret_print` — so the multi-page
   print capability (which exists in the CLI, #2700: multiple inputs = ONE package) has no
   Telegram surface. The 155-token llama reply is not a print interpretation. Filed as a
   GitHub issue.
2. **Single-photo path is healthy on the new stack**: 3/3 interpreted by `claude-opus-4-8`
   in 3m15s–4m17s including an upside-down page (devices=4 correct count despite OSD+OCR both
   failing — model-native rotation tolerance carried it; the F2 EXIF fix on the iterate branch
   remains the deterministic answer).
3. **Free cascade warnings on every turn** ("All providers exhausted — cascade returned empty",
   groq scout model) on a pre-step, while later groq calls succeed — known degraded-cascade
   follow-up (check prd GROQ/CEREBRAS/TOGETHER keys).
4. **Bot logs print full token-bearing Telegram URLs** (httpx INFO on getUpdates/getFile).
   Both bot tokens were pulled into a session transcript during this debugging → both added to
   the rotation list (plan file Phase 2 §5, names only). Redaction fix filed as a GitHub issue.

## Staging bot verdict

`stg-mira-bot-telegram` is **healthy and polling** (getUpdates 200 every ~10 s, no 409/webhook
conflict, no errors) but received **zero incoming updates** in the test window — Telegram never
delivered anything to it. Dominant hypothesis: the messages went to a different handle. The
real staging bot username is the oddly-spelled **@Mira_stagong_bot** ("stagong"). Mike: check
which handle the phone chat actually targeted; if it WAS the exact handle, next probe is
BotFather-side (the poller itself is provably alive).
