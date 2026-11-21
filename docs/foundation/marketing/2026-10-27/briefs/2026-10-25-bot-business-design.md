# FactoryLM bot business design — 2026-10-25 (draft, nothing changed)

## 1. Do we need a CEO orchestrator?
**No new bot.** Grok Bot (primary) already is the coordinator/Chief of Staff: it routes Mike's asks, runs the ledger (/workspace/team-tasks/LEDGER.md), the 4-hourly task dispatcher and the 8 AM roundup. xAI's own write-up says people make one "Chief of Staff" Bot so they "give direction to one Bot instead of checking each one" (https://x.ai/news/designing-grok-bot); the community guide says "create one coordinator bot first and delegate through it" and "split a bot only when its rules conflict" (https://squad.so/resources/grok-bot-best-practices). Adding a second coordinator would duplicate routing and create two sources of truth. Mike stays CEO; Grok Bot = Chief of Staff + acting CMO. The fix is to make the existing coordinator stronger, not add a layer.

## 2. Research: how people get the best results
- One coordinator, specialists only when goals/tools/schedules/approval rules differ (x.ai/news/designing-grok-bot; squad.so).
- Memory and routines belong per Bot; tools/skills are shared — keep roles narrow so memory stays relevant (x.ai/news/designing-grok-bot).
- Approvals: keep send/publish/purchase/delete/permissions/production behind approval; write *narrow* Auto Review rules (Ask first / Allow automatically); approvals from routines or bot-to-bot work expire after ~10 min if Mike isn't there (https://docs.x.ai/grok-bot/approvals-security-and-privacy).
- Start read-only and drafts; review routines regularly; pause stale ones (same doc; https://docs.x.ai/grok-bot/skills-routines-and-automations).
- Daily "standup" reminders to bots help retain workflows; give builders a full feedback loop (test env they can drive); be hands-off where safe; "P0" urgency burns tokens fast (https://x.ai/bot/guides/grok-bot-for-engineering).
- Bot description is the job description — write it like one (squad.so).
- Little independent data exists on Grok Bot specifically beyond these; rest is general multi-agent practice (one owner per outcome, explicit handoffs, measurable outputs).

## 3. Diagnosis of what we have
**Working:** overnight ledger loop actually ships (T-012..T-021 done overnight), drafts-only rule held, no prod writes.
**Overlaps:**
- Search Steward vs Content Studio: both touch page copy/headings → Steward owns *structure & technical SEO*, Studio owns *words*. Keep both; define handoff (Studio drafts → Steward optimizes → Grok Bot packages).
- Forum Helper vs Answer Radar: both mine real-world questions. Merge: Answer Radar finds questions; Forum Helper drafts replies from them. Consider retiring Forum Helper into Content Studio while outreach is on hold.
- FactoryLM Product vs FactoryLM Ops: Ops has had little distinct work. Merge into one "Product & Ops" bot.
- Notebook Prover vs Answer Radar: distinct (prove vs. source) — keep, Radar feeds Prover's test set.
**Bottlenecks (the real "slackers" cause):**
1. Marketing output is gated on Mike decisions (crew-size line, A6, vendor names, option A) and on the #4732 walk — not on effort.
2. Approvals scattered across many chats (Foreman's chat, Repo Archaeologist's chat, primary). Routine-triggered approvals expire after 10 min.
3. No blog exists yet, so the daily post routine fills a queue nobody sees; no visit tracking yet.
4. Staging test login missing → #4732 walk can't run → job-log copy stays [VERIFY].
5. Usage cost: ~11 routines + 12 bots; overnight sweeps overlap (2 AM reviewer, 4h dispatcher, 3/4 AM pushes).

## 4. Org chart
```
Mike (CEO: decides, merges, approves anything public)
└─ Grok Bot — Chief of Staff + acting CMO (routes, ledger, one daily decision list)
   ├─ Engineering
   │  ├─ Foreman — builds via PRs, Codex review; only Mike merges
   │  ├─ Repo Archaeologist — read-only code research & issue triage
   │  └─ Notebook Prover — proves the sellable path on staging
   ├─ Product & Ops (merge FactoryLM Product + Ops) — PMF calls, decision memos, metrics
   ├─ Knowledge
   │  ├─ Librarian — manuals/photos intake
   │  └─ Answer Radar — real technician questions (feeds blog + Prover)
   └─ Marketing (Grok Bot leads)
      ├─ Content Studio — all words: blog post/day, landing copy, social
      ├─ Search Steward — SEO/GEO structure, schema, sitemap, Search Console/visit reports
      ├─ Pipeline Scout — prospect list (no credits, outreach on hold)
      └─ Forum Helper — retire or fold into Content Studio until outreach resumes
```

## 5. Weekly rhythm
- Daily 6 AM: blog post drafted (Studio→Steward). 8 AM: ONE roundup in Grok Bot chat with a numbered "Mike decides" list (max 5, yes/no). Evening: grumpy reviewer walk.
- Mon: marketing bundle + metrics scorecard (visits, posts shipped, issues closed, prospects verified) + manual route health.
- Wed: Foreman PR batch for Mike to merge in one sitting.
- Fri: retro — what got blocked on Mike, what routine to pause.

## 6. Standing pre-approvals (Mike could grant in writing)
Safe to pre-grant:
- Publishing blog posts that pass the can-say list + Search Steward check, once the blog exists (or: auto-queue, Mike batch-approves weekly).
- Foreman opening PRs and staging deploys (not prod, not merge) for Phase-0 fixes that only *remove* false claims (#4434, prices, "68,000+ chunks").
- Bots messaging each other and filing GitHub issues/labels in the MIRA repo.
- Read-only web research, Apollo searches that spend no credits.
Must stay manual: merges to main, prod deploys, any email/DM/social post under Mike's name, cold outreach, spending (Apollo credits, vendor trials), new claims about capabilities, competitor/brand names, prices, deleting bots/data.

## 7. Settings (only real ones from the app)
- Settings → General → **Auto-review** / **auto-review-rules**: add narrow "Allow automatically" rules for the pre-grants above (e.g. git/gh read commands, writing under /workspace/marketing and /workspace/briefs) and "Ask first" for external sends, publishing, merges, prod. Keep Auto-review ON.
- Settings → **Usage & Billing → usage / plan / on-demand**: check the meter weekly; turn on on-demand with a cap if routines stall on limits; upgrade plan before adding bots.
- General → **notification-sound-enabled** and per-agent info pane → gear → **per-assistant notifications**: notifications ON for Grok Bot and Foreman (approval cards expire in ~10 min), quiet for the rest.
- General → **timezone**: confirm America/New_York so routines fire right.
- Per-agent Settings subpage (name/title/description): rewrite each bot's description as a one-line job description per §4.
- Per-agent pane → **Routines**: pause/merge overlapping overnight sweeps (keep 4h dispatcher + 2 AM reviewer; drop separate "overnight push").
- Computer → **local-execution / computers**: only if a build needs Mike's machine; otherwise leave off.
There is no "max effort" switch; effort comes from clear roles, fewer gates, and usage headroom.

## 8. Measure output (weekly scorecard)
Posts published / queued; unique visitors + Search Console impressions/clicks (once tracking ships); false claims removed from live site; issues closed and PRs merged; Notebook Prover pass rate; prospects verified; Mike decisions pending > 48 h (target 0).
