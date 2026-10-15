# What we can say vs. what MIRA does today (claims audit)
*Oct 14, 2026, ~7:15 PM ET. Acting CMO's audit for Mike Harper. This is a read-only review: no drafts were edited, nothing was posted or sent, and prod wasn't touched. I didn't test anything live. All evidence comes from workspace files and the MIRA repo (read-only).*

**Evidence keys used below**
- **PL** = `/workspace/punchlist/MIRA-customer-punch-list.md` (Oct 11, prod `ef0780ee`)
- **KD** = `/workspace/mira-known-defects-2026-10-11.md`
- **SCORE** = `/workspace/proofs/AR-FIRST-QUESTION-001/SCORE.md` (the Festo test)
- **POS** = `marketing/positioning-and-campaign.md`
- **PLAY** = `marketing/guerrilla-playbook.md`
- **#NNNN** = PR or issue in `Mikecranesync/MIRA`

> **Corrections, Oct 14 ~8:30 PM ET (Claude, CHARLIE; accuracy check on PR #4433).** Production was deployed on Oct 14: `app.factorylm.com/api/version` reports build `3236c23a7` (v3.403.7, built 14:38 UTC). Every fix below **except #4429 and #4432** is an ancestor of that build (`git merge-base --is-ancestor`), so those fixes are **deployed but not yet re-tested on production**. That proof run is tracked as **#4435**. PL is tracker **#4372** (C01–C29) on GitHub. KD and SCORE are workspace files that couldn't be checked here. The rows below are corrected where the code or live site showed otherwise.

**Status of fixes in the repo since the punch list.** Each of these is merged on main. Except #4429 and #4432, each is **deployed on production** (build `3236c23a7`), but **none has been re-tested on production yet** (#4435). Notebook Prover's prod run is still pending (PL L155).
- **#4360**, merged Oct 12: short fault codes like F4, oC and OC now reach the exact-match lane.
- **#4373**, merged Oct 13: ties are broken consistently, so the same question gets the same chunks.
- **#4374**, merged Oct 13: /v3 shows a plain error message.
- **#4357**, merged Oct 11: the quickstart uses OpenAI first.
- **#4355**, merged Oct 12: hard stop on OpenAI spend.
- **#4350**, merged Oct 12: a new phone account gets the composer.
- **#4424**, merged Oct 14: the review dates move to Nov 10, so M1 is handled.
- **#4429**, merged Oct 14 at 6:27 PM ET: signed-in users land in /v3. **Staging only so far.** Production still lands on the old `/feed` until it deploys.
- **#4432**, merged Oct 14 at 7:58 PM ET: a manufacturer-library answer that cites none of the retrieved passages becomes "insufficient evidence" with a fixed message instead of shipping uncited (#4426). It's on staging, and the release check passed 6/6 there (run 38657733310). Not on production yet.

**Still open (drafts):**
- **#4361:** New chat, and V3 for the notebook page, which is the citation-chip fix path.
- **#4303:** an honest "general guidance" label.
- **#4230:** the quickstart says so when it can't cite.
- **#4376:** add to home screen.
- **Open issues:** #4365 (chip click), #3900 (Grounded label), #4122 (LOTO safety), #4362 (day-8 lockout), #2562 (OCR).

---

## 1. Every product claim in our marketing, rated

Statuses:
- **SAFE:** say it as written.
- **CAVEAT:** use only with the exact wording given.
- **NOT YET:** don't say it until the stated fix is proven on prod.

| # | Claim | Where it appears | Status | Evidence / what must happen |
|---|---|---|---|---|
| 1 | We upload a plant's OEM manual, ask in plain English, and get an answer that names the manual and page | POS L13, L27–30; PLAY L6; market-analysis L9; cold-email L16; one-pager L11; clip-01; post-1 | **CAVEAT** | **Proven on one manual:** Micro810 p.57, 20.4–26.4 V DC, on prod Oct 4 and again Oct 11 at 2:28 PM (KD L31; PL L21, L114). **Use:** "In our tests, when the answer comes from your manual, MIRA shows the manual and page." **Avoid:** "every time" / "every answer" (see #3). |
| 2 | "Show me the page" / click to the cited page | PLAY L76 ("click to the cited page"); clip-01 shot 3 highlight; one-pager L11 ("your tech can open the page") | **NOT YET** for clicking | The chip does nothing on desktop prod (PL C08 L95–100; #4365 open). Fix path: #4361 commit 2 (draft). **Use for now:** "It tells you the page. You open the manual and check it." |
| 3 | "Every answer from your manuals shows the page" / "the page, every time" | POS L30, L35, L71; clip-01 end card; post-1 L18 ("the page on every answer that comes from them") | **NOT YET** as "every" | The same question missed ("I couldn't find that"), then answered (PL C12 L114). Older turns gave different voltages (KD L162–163). The tiebreak fix #4373 is merged but not proven on prod. **Proof needed:** the same question asked 5 times on prod returns the same page. **Use:** "shows the page when the answer comes from your manual." |
| 4 | It says when your manual doesn't cover it / "no guess" | POS L36, L113; post-1 L16; cold-email L16; clip-02; Stump post | **CAVEAT** | **Proven once:** Festo, Sept 5, on **staging**, with Groq as the provider (SCORE, Run A: `insufficient_evidence`, 0 citations). That provider is now dead, and the test hasn't been re-run on today's OpenAI path. **Counter-evidence:** on prod, a Micro820 question in a Micro810-only notebook was answered and labeled "Grounded" (PL C02 L60a; KD L164). The release check's scenario 2 (a TP700 with no manual in the library) shipped an uncited "answered" in 2 of its last 4 runs. #4432 makes that case abstain deterministically. It passed on staging and isn't on production yet. **Use:** "In a Festo test, it said the manual didn't cover a question instead of guessing." **Don't** generalize to "it never guesses." |
| 5 | Answers not from your manuals are clearly labeled "general" | one-pager L12; POS L113 battlecard | **NOT YET** | Unlabeled general answers (KD D3); the "Grounded" label is shown on wrong-model answers (PL C02). The fix is #4303 (draft, flag off) plus owner decision M7. |
| 6 | "Grounded in this notebook's sources" label as proof | clip-01 shot 3; clip-02 shot 5; post-1 L14 ("marked as grounded") | **NOT YET** as proof | *Corrected:* since #3945 (deployed) the label requires at least one citation actually shown (`chat/route.ts`, `emittedCitations.length > 0`), so it no longer comes from request scope. The remaining risk is an answer that cites a **wrong-model** passage and still gets the label (PL C02; #3900 open). It's fine to show it on screen, but don't present it as verification. Let the side-by-side page check do that job. |
| 7 | Any brand / mixed brands in one place | POS L13, L30, L37; cold-email L20; one-pager L9; community-college pitch | **CAVEAT** | Tested only on Rockwell (Micro810, on prod) and Festo (staging) (POS L37). Scanned PDFs can't be searched (PL C06; #2562). **Use:** "Works with text PDFs from any maker. So far we've tested Rockwell and Festo." |
| 8 | "We load manuals for up to 25 machines on one line" | cold-email L20; one-pager L9; linkedin-post-1 (original) L22 | **CAVEAT** (internal) / **NOT YET** (public) | Uploads with no machine picked are never indexed. There's a 50 MB per-file cap, and bulk uploads run one at a time (PL C14). Scanned manuals fail (C06). It's doable only as hand work by Mike, and the 25-PDF timing on prod hasn't been run (PL L163). **Use:** "We load your line's manuals for you." Drop the number until it's timed. |
| 9 | "Send us paper we can scan" | one-pager L16 | **NOT YET** | No OCR on the Hub PDF upload path (PL C06). The code says "viewable, but can't be searched". *Note:* #2562 covers the separate crawler/Tika pipeline, which has OCR that hasn't been proven end to end, not this upload path. |
| 10 | Crew asks from the web at app.factorylm.com | POS L37; one-pager L10 | **CAVEAT** | Web chat works (PL L23). **But:** until #4429 deploys, a signed-in tech lands on the old `/feed` dashboard (PL C04). Add-to-home-screen is broken (#4363; fix #4376 is a draft). Invite links expire in 15 minutes, and a send failure is silent (PL C18). **Use:** "Your crew uses it in a web browser, on a phone or PC," and Mike sets up each login with them. |
| 11 | "The FactoryLM app" / on your crew's phones | POS L13, L37; market-analysis L5 ("in your crew's pocket"), L12; one-pager L10 | **NOT YET** | No Play or App Store listing; the app is sideloaded (PL C04). Invited techs probably can't log into the native app (C05, unverified). "From the web" is the honest version. |
| 12 | 30-day pilot for $500, then $399/mo, up to 15 users, $500 credited | POS L30, L54, L72, L115; one-pager L4; cold-email L20 | **NOT YET** | Self-signup is a 7-day trial: the buyer gets locked out on day 8 (PL C03; #4362). Stripe only has a $97 price, and the site still sells something else (PL M6, C17). **Needs:** M6 decision, plus a 30-day pilot account (built status or a written runbook), plus a checkout or invoice that matches. |
| 13 | "Right-page scorecard" / day-30 summary of questions, % right page, gaps | POS L73; one-pager L20–27 | **CAVEAT** | A `/usage` page exists, but it counts work orders, not chat questions (PL C15; #4368). It's possible only as a hand-built report by Mike. **Use:** "We review the answers together at the end." Don't imply a dashboard. |
| 14 | "See it live on your manual" in 15 minutes, on a manual the manager names | POS L32, L73; PLAY L73; cold-email L22; one-pager L37 | **CAVEAT** | It's real but risky. Uploading and indexing a new manual live is untimed, and answers vary (C12). If the manager names a short code, it can miss (C07; #4360 is not proven on prod). The playbook already limits live looks to tested manuals before the gate (PLAY L73). **Keep that rule,** and add: "full-sentence questions, and Mike opens the cited page by hand." |
| 15 | Works beside your CMMS; no CMMS switch | POS L17, L72; post-1 L18; one-pager L30 | **SAFE** | It's true because MIRA doesn't touch the CMMS (POS L48, Security page "no automated write-backs"). Word it as "nothing to switch," not as an integration. |
| 16 | Fault-code lookup ("ask a fault code from your drive") | POS L120 battlecard landmine; trade-press L21 ("mark the fault-table pages"); market-analysis L5 implicitly | **NOT YET** | D2/C07: F0004 and oC miss or repeat the last answer. #4360 is merged but not proven on prod. #4238 and #4244 are still to do, and there's no New chat yet (#4361 draft). PLAY L154 already bans this claim. **The battlecard landmine must change** (see §4). |
| 17 | It won't give step-by-step lockout, arc flash or confined-space answers | one-pager L33; POS L53 | **NOT YET** | The opposite is on record: MIRA can tell a tech to re-energize under lockout, and an uploaded doc can override the safety gate (PL C01; #4122, #3790 open; not verified on prod). **This is the most dangerous line in our materials.** The **live website** makes the same false promise: /security and /limitations say these questions "never get an AI answer" and go to "your designated safety contact". No code routes to a safety contact, and flagged questions are answered under a warning banner (#4434). Use instead: "Lockout, arc flash and confined space: follow your site procedure. Don't use MIRA for them." |
| 18 | Your data is kept separate and isn't used to train outside AI models | one-pager L34 | **CAVEAT** | It restates the factorylm.com/security page. The provider list on that page is out of date (POS L59, now OpenAI-first via #4349). /security names Groq, Cerebras and Gemini, while /trust and /privacy name Anthropic "for chat, diagnosis, citations". The chat cascade has no Anthropic, but production does use Anthropic for print-photo reading (PR #2661), so the subprocessor list needs an owner review (#4434). Both /security and /trust also say "no passwords stored", yet the app stores bcrypt password hashes and offers password sign-in. Open security findings exist (PL C21: #4157, #4251). Confirm OpenAI's no-training terms for our API account before using it. Keep "not SOC 2 audited yet." |
| 19 | It doesn't connect to PLCs, read work-order history, or create work orders | one-pager L30–32; POS L122 | **SAFE** | These are honest limits (KD A1; POS L45, L48). |
| 20 | Answers in seconds | post-1 rewrite note L43 ("seconds") | **CAVEAT** | About 7 s on the server, about 10 s on a phone, and about 25 s with a photo (PL C25). **Use:** "in seconds" for text only, never "instantly." |
| 21 | A US founder on your floor (Central Florida in person, remote anywhere); published flat price | POS L18, L73, L117 | **SAFE** (founder) / **NOT YET** (price) | The founder part is a business fact. The price isn't published consistently yet (#12). |
| 22 | Website: CMMS write-back, PLC tags, 68,000+ chunks, F005 example, "no hallucinations", "every answer cites", voice→RCA, 480 V photo detection, Slack/Telegram, Atlas, Enterprise/SSO | factorylm.com (POS L44–60; KD A1) | **NOT YET: remove** | All confirmed live on Oct 14 by GET-only reads. Each quote, its page and its source file are listed in **Appendix A** below (also #4434). Re-run that phrase list against the live pages before relying on this row later. Also live: a false safety-escalation promise (claim 17), "no passwords stored", and provider lists that contradict each other (claim 18). The "68,000+" figure may actually be true: a June count found 83,553 library rows. It needs a fresh count, not removal. The fix is #4434 (P0) plus owner item M15. **It's live today, and it's the biggest exposure**, because any prospect we warm up will read it. |
| 23 | Drive Commander G120 page: 8 faults, 5 with cited detail | market-analysis L13 | **SAFE** (as a static page) | It's a public page, not the chat product. Don't present it as live chat. |
| 24 | Forum replies (no product mention) | drafts/forum-2026-10-12, -10-19 | **SAFE** | No product claims. Every citation was read from saved OEM PDFs. |
| 25 | Problem-only posts (2 a.m. PDF hunt, retiring tech, where manuals live), Plant Engineering abstract, Breakdown Stories | drafts | **SAFE** | The only product line is in linkedin-2am L16, and it's the CAVEAT wording from claim 1. The retiring-tech post's "Line 2 drive / jumper" detail is illustrative (marked). |

---

## 2. What a plant tech would actually go through in a $500 pilot today

This is based on the punch list (prod `ef0780ee`, Oct 11), adjusted for merges since then. Anything not proven on prod is treated as still broken.

1. **The manager signs up.**
   - The site says one thing ($500 Assessment, $2–5K pilot, $499/mo), Stripe charges $97, and the app starts a 7-day trial (PL M6, C17).
   - *Disappointment:* the price they were quoted isn't what they see.
2. **Mike loads the line's manuals.**
   - Text PDFs index fine. Scanned or old manuals stay "viewable but not searchable" (C06), and those are often the machines that break most.
   - Files uploaded without picking a machine are silently never indexed (C14).
   - *Disappointment:* "you loaded our manuals" turns out to cover only the ones that were digital.
3. **The crew gets invited.**
   - Invite links die after 15 minutes. If the email key is missing, the screen still says "sent" (C18).
   - There's no phone app in a store. The native app probably can't log in invited techs (C05).
   - Add to home screen doesn't work (C04; #4376 is a draft).
   - The browser lands on the old dashboard until #4429 (staging only today) deploys to production.
   - *Disappointment:* half the crew never gets in without Mike's help.
4. **A tech asks a full-sentence question about a covered machine.**
   - Often gets the right answer and a page number. This is the part that works (Micro810 p.57).
   - The same question can miss on one try and hit on the next (C12).
   - *Disappointment:* "it worked yesterday."
5. **The tech taps the page chip to check.**
   - Nothing happens (C08).
   - *Disappointment:* the core promise, "check the page," means finding the PDF yourself.
6. **The tech types a fault code the way it's on the drive: `F004`, `oC`.**
   - Misses, gets an uncited answer, or repeats the last answer (C07). #4360 may help once deployed, but it's unproven.
   - There's no New chat in the legacy notebook chat production shows today, so earlier questions bleed into new ones (C10). The `/v3` shell has New chat and reaches production with #4429.
   - *Disappointment:* this is the #1 thing techs will try.
7. **The tech asks about a machine whose manual isn't loaded, or a similar model.**
   - May get a confident answer still labeled "Grounded" (C02, the Micro820 case).
   - *Disappointment and risk:* a wrong spec that looks verified.
8. **A safety-adjacent question (isolation, lockout).**
   - Known repros can give unsafe guidance (C01).
   - *Risk:* a pilot-ending event.
9. **The answer service goes down.**
   - The tech sees a generic error. #4374 (plain message on /v3) is deployed, but /v3 isn't production's landing page until #4429 deploys. Nobody is alerted (C11).
10. **Day 8.**
    - The manager is locked out ("Your trial has ended") unless Mike edits the account by hand (C03).
11. **Day 30.**
    - There's no usage page for questions (C15), so the scorecard is Mike's manual work.

**Bottom line:** today a pilot works only as a white-glove, Mike-supervised trial on text manuals with full-sentence questions. Steps 3, 5, 6, 7, 8 and 10 would each embarrass us with a real crew. That's why the Oct 23 gate is the right call.

---

## 3. Approved claims: the marketing team can use these today

Plain words, and safe as written:

1. "Ask your plant's manuals a question in plain English. When the answer comes from your manual, it shows you the manual and the page."
2. "You get the page so you can check it yourself before you touch the machine."
3. "In our tests on a Rockwell Micro810 manual, the answer (20.4–26.4 V DC) pointed to page 57, and page 57 says exactly that." *Use the real, cropped screenshot. Mike opens the page by hand.*
4. "In a Festo test, it told us the manual didn't cover a question instead of guessing."
5. "It's not a CMMS and doesn't replace yours. There's nothing to switch."
6. "It doesn't connect to PLCs, doesn't use work-order history, and doesn't write work orders."
7. "For lockout, arc flash and confined space, follow your site procedure. Don't use any AI tool for those."
8. "We've tested Rockwell and Festo manuals so far, and we'll post our misses too."
9. "I'm Mike, I build FactoryLM, and I'm in Central Florida."

**Don't say yet:**
- "every answer" / "every time"
- "click to the page"
- "fault codes"
- "any brand" (on its own)
- "scanned manuals"
- "the app" / "on your phone"
- "25 machines"
- "$500 pilot" (publicly)
- "labeled general"
- "won't give lockout steps"
- "no hallucinations"
- "instantly"

---

## 4. Edits needed in existing drafts (for Content Studio; I haven't made them)

| File | Change |
|---|---|
| `assets/pilot-offer-one-pager.md` L33 | Replace "It doesn't give step-by-step answers for lockout, arc flash or confined-space work" with "Don't use it for lockout, arc flash or confined-space work. Follow your site's procedures." (claim 17; C01 open). |
| `assets/pilot-offer-one-pager.md` L9, L16 | Drop "(or let us scan)" and "paper we can scan" (C06). Change "up to 25 machines" to "the machines on one line" until the 25-PDF upload is timed (C14). |
| `assets/pilot-offer-one-pager.md` L10–12 | Cut "and the FactoryLM app once it's available." Keep L12 ("labeled as general") only after #4303 ships. Add "you open the page and check it" in place of any implied click. |
| `assets/pilot-offer-one-pager.md` L4, L27 | Hold the whole sheet until M6 is decided and a 30-day pilot account exists (C03). Reword the day-30 summary as "we review the answers with you" (C15). |
| `assets/cold-email-pilot.md` L16, L20 | Already on hold. When it's revived: change "If the manual doesn't cover it, it says so instead of guessing" to "In our tests, it says when the manual doesn't cover it." Remove "up to 25 machines." |
| `positioning-and-campaign.md` L35, L71 | Change "The page, every time it's from your manual" and "Every answer from your manuals shows the manual and page. Your tech checks it in ten seconds" to "When the answer is from your manual, you get the page, so you can check it." Remove "ten seconds" (unmeasured; the chip doesn't open). |
| `positioning-and-campaign.md` L112–113 battlecard | Change "Shows the manual page: Yes (proven…)" to "Yes, page number shown; tested on Rockwell and Festo." Change "Says when the manual doesn't cover it: Yes in testing" to "In one Festo test; general-answer labels pending." |
| `positioning-and-campaign.md` L120 battlecard landmine | Change "Ask ChatGPT a fault code from your drive. Then ask it what page that's on" to "Ask ChatGPT a spec from your manual. Then ask it what page that's on." Fault codes are our own open bug (C07). |
| `positioning-and-campaign.md` L116 | Change "We load your line's manuals for you" to add "(text PDFs; scanned manuals not yet)." |
| `guerrilla-playbook.md` L76 | Change "the answer → click to the cited page" to "the answer → Mike opens the manual to the cited page himself" (C08). |
| `drafts/show-me-the-page-clip-01.md` L26 end card | Change "The page on every answer that comes from them" to "The page, when the answer comes from them." Keep the HOLD. |
| `drafts/linkedin-post-1-rewrite.md` L18 | Change "with the page on every answer that comes from them" to "with the page when the answer comes from them." Keep the HOLD and the retake plan. |
| `drafts/clip-02-festo-spc200-p7.md` L7 | Add: "The proof was on staging with a provider we no longer use (SCORE.md). Re-run on prod before recording." |
| `drafts/linkedin-wk2-retiring-tech.md` L8 | Swap the illustrative "Line 2 drive / jumper" for a true detail from Mike, or make it generic. It's already flagged; it's not a product claim. |
| `assets/stump-mira-challenge-post.md` L8 | Change "Any brand" to "Any brand with a text PDF manual" unless OCR ships. The post stays gated. |
| `assets/community-college-pitch.md` L8 | Fine. Make sure the live demo uses a text PDF, and Mike opens the page by hand. |
| `pipeline/invite_drafts.md` L16, L24 (b1/b2) | Change "helps techs troubleshoot faster" to "answers from the plant's own manuals and shows the page." **Remove "and repair history"** (L24): it's not a product capability (one-pager L32). |
| `factorylm-market-entry-analysis.md` L5 | Change "in your crew's pocket. Every answer cites the page" to "from a browser on your crew's phones. Answers from your manuals show the page" (C04; claim 3). |
| factorylm.com (via #4345 + a site PR, M15) | Ship the removals in POS L44–60. It's live today, and it's our largest false-claim exposure. |

---

## 5. What would move claims from NOT YET to SAFE

Each of these must be proven on prod, not just merged.

1. The same question asked 5 times gives the same page (#4373 is deployed and needs the proof run, #4435). This unlocks "every time."
2. Clicking the chip opens the PDF at the page (#4361 commit 2 → #4365). This unlocks "click to the page."
3. The D2 fault-code replay passes (#4360 is deployed and needs the proof run, #4435; plus New chat via #4429/#4361). This unlocks fault codes.
4. #4303 is labeled, and wrong-model questions are refused (C02). This unlocks "labeled general" and "it says when it doesn't know."
5. The #4122 and #3790 safety repros are fixed on prod (C01). This unlocks any safety line.
6. Pilot account plus price (M6, C03, C17). This unlocks the "$500 pilot."
7. Add to home screen or a store track (#4376, M11). This unlocks "on your phone" and "the app."
8. OCR (C06). This unlocks "any manual / scanned."

---

## Appendix A: live-site evidence for claim 22 (GET-only, Oct 14, 2026, ~8 PM ET)

Each page was fetched with `curl -sL` (HTTP 200), its tags were stripped, and the exact phrase in the middle column was searched for. Every phrase was found on the page listed. The source column is the file in this repo (`origin/main` at `47bc07d66`) that renders it.

| Claim on the live site | Exact phrase found | Page | Source |
|---|---|---|---|
| No hallucinations | "No hallucinations" | factorylm.com/cmms | `mira-web/src/views/cmms.ts:303`; `mira-web/src/lib/feature-renderer.ts:62,122` |
| Corpus size | "68,000+ chunks of OEM documentation indexed" | factorylm.com/ | `mira-web/src/views/home.ts:582`; `mira-web/public/llms.txt:7` |
| F005 example | "Why is the Powerflex 755 tripping F005 at 1,200 RPM?" | factorylm.com/, /cmms | `mira-web/src/views/home.ts:163` |
| Automatic CMMS write-back | "writes work orders into it automatically" | factorylm.com/pricing | `mira-web/public/pricing.html:503` |
| …contradicted on the same site | "There are no automated write-backs" | factorylm.com/security | `mira-web/src/views/security.ts:231` |
| Photo hazard detection | "MIRA detected 480 V on a 240 V branch via the photo" | factorylm.com/ | `mira-web/src/views/home.ts:219` |
| Voice to RCA | "Senior tech's voice notes become structured RCA records" | factorylm.com/ | `mira-web/src/views/home.ts:194` |
| Every answer cites | "Every answer cites its source" | factorylm.com/security | `mira-web/src/views/security.ts:334` |
| AI providers (list 1) | "Groq, Cerebras, and Gemini" | factorylm.com/security | `mira-web/src/views/security.ts:197,332` |
| AI providers (list 2) | "Anthropic (Claude API)" | factorylm.com/trust | `mira-web/public/trust.html:163`; `mira-web/public/privacy.html:158` |
| No passwords | "no passwords stored" / "no passwords to steal" | factorylm.com/trust, /security | `mira-web/public/trust.html:235`; `mira-web/src/views/security.ts:207-208` |
| …but the app stores passwords | bcrypt hash compare; "Sign in with password" on app.factorylm.com/login | app.factorylm.com/login | `mira-hub/src/auth.ts:55-56` |
| Safety escalation | "trigger an immediate escalation to your designated safety contact" | factorylm.com/security, /limitations | `mira-web/src/views/security.ts:227,333`; `mira-web/src/views/limitations.ts:158` |
| …but no code routes to a safety contact | no match for `safety contact` / `escalat… to` in `mira-hub/src`, `mira-bots/shared`, `mira-pipeline` | — | `git grep` on `origin/main` |
| Slack and Telegram | "Telegram" | factorylm.com/, /cmms, /pricing, /limitations | `mira-web/src/views/cmms.ts:303` |
| Team plan price | "Team plan" ($497/mo) | factorylm.com/trust | `mira-web/public/trust.html:238` |
| No PLC streaming (limits page) | "No PLC tag streaming" | factorylm.com/limitations | `mira-web/src/views/limitations.ts:161` |

