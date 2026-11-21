# Problem-led inventory: "Where's the manual?" → MIRA (read-only), Oct 25 2026, 9:45 PM ET

Repo state used: shallow clone of `Mikecranesync/MIRA` main `e28bb182` (Oct 25, 1:58 PM ET). The clone is shallow, so **per-file history before Oct 1 couldn't be read here**. Every file below shows its last touch as the bulk commit `ecd1067f` (Oct 1, #4193), which isn't when it was written. Nothing was run, started, posted or edited.

## 1. Original research: what exists and what kind of evidence it is

| Item | Date | Link | Type |
|---|---|---|---|
| Mike's account: "about two years ago" he kept asking techs what they struggle with, and the answer was "Where's the goddamn manual?" | told Oct 25 2026 (Slack thread 1792977424.004059) | thread | **Mike's interpretation**. No artifact from about 2024 was found |
| Customer interview log: **1 entry**. A lead tech on Mike's own team wanted an AI pass-down summary, which is **not** a manual-access request | Apr 21 2026 | [docs/customer-interviews.md](https://github.com/Mikecranesync/MIRA/blob/main/docs/customer-interviews.md) | **Direct evidence** (n=1, internal), but for a different need |
| Expo discovery questionnaire. It asks "How easy is it to find the right manual…" and "1–5 how painful" | written for May 21 2026 | [expo-discovery-questionnaire.md](https://github.com/Mikecranesync/MIRA/blob/main/expo-discovery-questionnaire.md) | Question list only. **No recorded answers found** |
| "where's the manual" used as a test journey | Aug 3 2026 | [docs/prd/2026-08-03-…validation-engine.md](https://github.com/Mikecranesync/MIRA/blob/main/docs/prd/2026-08-03-mira-answer-integrity-and-validation-engine.md) (l.303) | Product **assumption** turned into a test case |
| Daily forum archaeology: about 37 PLCTalk/MrPLC questions frozen, each checked against MIRA's manual coverage | Sep 7–Oct 23 2026 | `/workspace/answer-radar/`, `/workspace/briefs/*-AR-*-archaeology.md` | **Direct evidence** that real techs ask manual-answerable questions in public |
| Scraped Reddit/forum snapshots (r/PLC, r/IndustrialMaintenance, MrPLC, PLCTalk) | Sep 16–Oct 1 2026 | `/workspace/reddit-*.json`, `/workspace/mrplc-*` | Raw data, never coded for "can't find the manual" |
| Drive search (read-only) | today | — | No early technician research found |
| Mikecranesync repos | — | MIRA created Mar 15 2026. The oldest repo, Nexus1, is from Aug 2025 | Nothing reaches back two years |

**Bottom line:** the "two years" research isn't in any source I could reach. It's Mike's account, and only he can supply the notes, texts or recordings.

## 2. Scouts, bots and schedules (source → detect → score → output → review → learn)

| Component | What it does | Status | Evidence |
|---|---|---|---|
| [reddit_intent.py](https://github.com/Mikecranesync/MIRA/blob/main/mira-crawler/tasks/reddit_intent.py) | Public Reddit JSON from 9 subs → keyword match → score → keep ≥60, alert ≥75 | **Implemented + configured** | Its keywords are buying signals ("alternative to MaintainX", "CMMS recommendation", "fault code", "VFD fault"). **No "manual" keyword**, so it hunts buyers, not the problem |
| [youtube_intent.py](https://github.com/Mikecranesync/MIRA/blob/main/mira-crawler/tasks/youtube_intent.py) | YouTube comments → score ≥60 store, ≥75 alert | Implemented + configured | same scorer |
| [_intent_scorer.py](https://github.com/Mikecranesync/MIRA/blob/main/mira-crawler/tasks/_intent_scorer.py) | One **Groq** call (`openai/gpt-oss-20b`), fails open, disabled if `GROQ_API_KEY` is unset | Implemented | Groq isn't retired. [docs/env-vars.md](https://github.com/Mikecranesync/MIRA/blob/main/docs/env-vars.md) says it's "billing-restricted" since Oct 11 and second in the chat cascade. So the scorer likely returns nothing (**unverified**) |
| [_intent_store.py](https://github.com/Mikecranesync/MIRA/blob/main/mira-crawler/tasks/_intent_store.py) | Writes to the Neon `intent_signals` table, deduped | Implemented | Row count **not checked** (read would need a DB credential, and I didn't use one) |
| [intent_digest.py](https://github.com/Mikecranesync/MIRA/blob/main/mira-crawler/tasks/intent_digest.py) | 6 AM ET Telegram digest to Mike, plus a `/hub/intent-signals` dashboard | Implemented | No digest output seen |
| Beat schedule, [celeryconfig.py](https://github.com/Mikecranesync/MIRA/blob/main/mira-crawler/celeryconfig.py) ~l.139–240 | The intent trio is only in the **default** profile | Configured, **probably not running** | [docker-compose.saas.yml](https://github.com/Mikecranesync/MIRA/blob/main/docker-compose.saas.yml) l.1111/1179 runs beat only with `CELERY_BEAT_PROFILE=synthetic-dogfood` or `historian`. The historian comment says it "deliberately excludes the intent monitors". **Scheduler exclusion confirmed in code.** Live containers not checked |
| [social.py](https://github.com/Mikecranesync/MIRA/blob/main/mira-crawler/tasks/social.py) | Approved Neon items → Buffer → FB/LinkedIn/IG/TikTok/X/Reddit, plus a weekly report | Implemented | Needs `BUFFER_ACCESS_TOKEN`. Not in either beat profile above. No Buffer account confirmed |
| [mira-bots/reddit/bot.py](https://github.com/Mikecranesync/MIRA/blob/main/mira-bots/reddit/bot.py) + [docker-compose.yml](https://github.com/Mikecranesync/MIRA/blob/main/mira-bots/docker-compose.yml) l.158 | Polls 5 subs → filter → GSD engine → **posts replies** (dry run defaults **off**) | Implemented, **dormant** | `profiles: ["dormant"]`. **Dormant posting confirmed.** It also uses the old bot engine, which is outside today's SUT |
| [tools/reddit_tg_pipeline](https://github.com/Mikecranesync/MIRA/tree/main/tools/reddit_tg_pipeline) | Apify Reddit scrape → upvote/keyword filter → Telegram via Telethon | Implemented (manual CLI, `run_charlie.sh`) | No schedule found in the repo. Whether it runs on Charlie is **unknown** |
| **Answer Radar** (a Grok Bot team agent, not repo code) | PLCTalk/MrPLC → pick 1 question/day → archaeology → freeze → live staging test → grade | **Running and demonstrated** | `/workspace/answer-radar/*SCAN.md`, briefs, `/workspace/live-test/2026-10-25-batch2.md` |

**The missing link:** none of the repo scouts listens for the actual problem. The only loop that does is Answer Radar, and its learning step is manual: a brief goes to Foreman or Mike, and then an issue gets filed.

## 3. Problem evidence mapped to MIRA today (staging/prod, Hub notebook SUT)

| Need | Status | Evidence |
|---|---|---|
| **Manual retrieval:** find the right page in a manual you already have | **Proven narrowly**: Micro810 p.57, 5/5 (prod, Oct 21, [#4607](https://github.com/Mikecranesync/MIRA/issues/4607)), ACS355 p.359, S7-1200 p.1047, ACS150 p.130. **Known gap**: PF525, Micro820 and TP700 abstain even though the answer is in the PDF, caused by the exact-model title filter (`manual-rag.ts:310-323`, `/workspace/briefs/2026-10-25-retrieval-diagnosis.md`). Readiness "1.0" is misleading ([#4788](https://github.com/Mikecranesync/MIRA/issues/4788)). Prod quickstart gets 0 citations ([#4780](https://github.com/Mikecranesync/MIRA/issues/4780)). No indexing status ([#4784](https://github.com/Mikecranesync/MIRA/issues/4784)). The attach sheet breaks after a project is created ([#4783](https://github.com/Mikecranesync/MIRA/issues/4783)) |
| **Getting the manual at all** (the literal "where's the manual") | **Known gap** for most forum hardware: archaeology briefs repeatedly mark OEM manuals ABSENT (e.g. Micro850/2080-IF4, Oct 23). The user has to supply the PDF |
| **Interpreting** the info (what it means for my case) | **Untested claim.** S7 card question PARTIAL: right page, but didn't apply it to the symptom |
| **Diagnosis** (why is my machine doing this) | **Untested / gap.** The PF525 no-output and Micro820 BOOTP questions didn't run. Forum fixes often weren't in any manual (a failed IGBT, a missing 3.3 V, a firewall) |

## 4. One traceable example (end to end)
1. **Stated problem (direct):** PLCTalk "ACS355" thread: *"…i get a fault code on drive a5001 … control pannel connection problem how can i solve this"* ([thread](https://www.plctalk.net/forums/threads/acs355.102851/)).
2. **Routine:** Answer Radar picked it for batch 2 (T-033) → staging notebook `8212012f` with ABB 3AUA0000066143.
3. **Ground truth:** manual p.356 lists 5001 "Drive is not responding. Check panel connection." (checked with pdftotext).
4. **MIRA:** "can't verify fault A5001… excerpts do not include that code." No citation. **FAIL** (false abstain). The same notebook cited fault 0001 on p.359.
5. **Missing links:** the cause is unresolved (maybe the "A5001" code format, needs one `NOTEBOOK_RETRIEVAL_DEBUG=1` run). Nothing went back to the poster, and correctly so (no posting). No repeat or outcome data exists.

## 5. Contrary evidence
- The only logged interview (Apr 21) asked for pass-down summaries, not manuals.
- In the forum threads, the best answers often came from experience, not the manual (PF525 IGBT, ACS355 3.3 V, Micro820 firewall/port 67). Manual access alone wouldn't have solved them.
- Techs on forums already have the manual, or it's one search away ("i have learned in manual…"). The pain is often **finding the right page or applying it**, not getting the PDF.
- The built scouts look for CMMS buying intent, which goes against the "don't imply MIRA needs a CMMS" positioning.

## 6. Keep these separate
- **Demand:** forum questions exist (about 37 frozen). That's not demand for a product.
- **Engagement:** none measured. Nothing was posted or replied.
- **Successful help:** narrow staging/prod citation passes. **0/6** on real forum questions (batch 2).
- **Repeat use:** no data.
- **Payment:** none proven. Checkout charge bug noted ([#4369](https://github.com/Mikecranesync/MIRA/issues/4369)).

## 7. Inaccessible or unresolved
Pre-Oct-1 git history (shallow clone). Any 2024 notes. Expo answers. The Neon `intent_signals` row count. Whether celery-beat (default profile), reddit_tg_pipeline or Buffer run anywhere. Prod shared-manual rows (#4780).

## 8. Smallest next step (existing work only)
Re-run Answer Radar's **same 6 batch-2 questions plus the 5 sanity facts** on staging after fix A (family-title rule) merges. No new scouts.
**Success measure:** 5/5 sanity facts cite the right page, and at least 3 of 6 forum questions are PASS or right-page PARTIAL, graded against the thread's best answer and labeled retrieval / interpretation / diagnosis. After that, code the existing 37 freezes by need type (got manual? found page? applied it? needed experience?) to test Mike's account with real counts.

## 9. Proposed repairs (for Mike's review, not started)
- A: family-title fix in `manual-rag.ts`, plus B: one debug-logged rerun (already in the 4 PM brief).
- Point the intent scanner at problem language ("manual", "can't find", "fault code meaning") or retire it. Its scorer depends on a billing-restricted Groq key.
- Keep the reddit bot dormant. If it ever comes back, set `REDDIT_DRY_RUN` to default 1.
- Mike to drop any 2024 notes into the repo so the origin story has a source.
