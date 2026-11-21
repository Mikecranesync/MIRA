*Problem-led loop: read-only findings*

*Origin research:* I couldn't find anything from about 2 years ago in the repo (created Mar 2026), in Drive or on the box. The only interview logged (Apr 21) asked for pass-down summaries, not manuals. The expo questionnaire has questions but no recorded answers. So "Where's the manual?" is your account for now, not traced evidence.

*Scouts in the repo:*
• `reddit_intent` / `youtube_intent` / `intent_digest`: built, but the keywords hunt CMMS buyers, with no "manual" keyword. Beat only runs the `synthetic-dogfood` and `historian` profiles, so they're excluded. The scorer needs Groq, which is billing-restricted, not retired.
• `mira-bots/reddit`: in the `dormant` compose profile, and it would post (dry run is off by default).
• `reddit_tg_pipeline`: a manual CLI, no schedule found.
• The only loop actually running is Answer Radar (forum question → manual check → staging test).

*End-to-end example:* PLCTalk ACS355 "A5001" → staging notebook → MIRA said it "can't verify". The manual p.356 has it. FAIL. Batch 2 went *0/6*. The cause is the exact-model title filter, plus https://github.com/Mikecranesync/MIRA/issues/4788. Related: https://github.com/Mikecranesync/MIRA/issues/4780, https://github.com/Mikecranesync/MIRA/issues/4783, https://github.com/Mikecranesync/MIRA/issues/4784

*Contrary evidence:* the best forum fixes were often field experience (a failed IGBT, a missing 3.3 V, a firewall), not the manual. Many posters already had the PDF. The gap is finding the right page and applying it.

*Kept separate:* demand = public questions exist. Engagement = none. Help = narrow citation passes, 0/6 on real threads. Repeat use and payment = no data.

*Smallest next step:* after the family-title fix, rerun the same 6 questions plus 5 facts. Success = 5/5 facts cited and at least 3/6 threads PASS or right-page PARTIAL. Then tag the 37 saved forum questions by need type.

Repairs are listed separately for your review. Full report: `/workspace/briefs/2026-10-25-problem-led-inventory.md`
