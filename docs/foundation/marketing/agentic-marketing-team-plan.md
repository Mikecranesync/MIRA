# FactoryLM agentic marketing team: plan
*Draft for Mike Harper, Oct 10, 2026*

## 1. Recommendation
Start small. Use **one lead bot and three specialist bots**, all built in this app, that **write drafts but never publish**. Mike approves everything in one Slack channel, and he posts or sends by hand. The engine is the one thing we already have that competitors don't: **Answer Radar finds real fault questions every day on PLCTalk and Reddit**, and MIRA can answer them with manual citations. Turn each of those into a cited fault page, a LinkedIn post from Mike, and (only where the forum allows it) a helpful no-link reply. Add careful outbound to plants and integrators in month 2. Current best practice for B2B AI agents says the same: start with one bounded workflow, put a human approval gate on anything customer-facing, log what agents do, and widen their freedom only once results prove it (Storylane, FlickBloom, Dashly). **One open question for Mike:** the site sells the $500 Assessment, $2–5K/mo Pilot and $499/mo Operating Layer to plants, but the Sept 5 product brief locks first-dollar on **Drive Commander Pro ($29/mo) for individual technicians**. Content serves both. Outbound only fits the plant offer, so Mike should pick which one the team pushes first.

## 2. The team (4 bots)
| Bot | Job | Inputs | Outputs | Schedule | Never without Mike |
|---|---|---|---|---|---|
| **Marketing Lead** | Runs the team. Writes the weekly brief, collects all drafts into one approval list, reports numbers. | Answer Radar finds, last week's metrics (GA4, Search Console, LinkedIn stats Mike shares), Mike's notes | Monday brief (1 page), Friday scorecard (5 numbers), one Slack approval thread | Mon 8:00 ET, Fri 3:00 ET | Change positioning or pricing, or spend money |
| **Fault Page Writer** (content + SEO) | Turns each real question into a cited fault/how-to page for factorylm.com (e.g. Drive Commander pages) | Answer Radar freezes, MIRA's cited answer, the OEM manual section, Search Console queries | 2 page drafts per week as PRs or Markdown, each with manual citations | Tue and Thu | Publish or merge anything, or state a fact without a manual or MIRA citation |
| **Field Voice** (LinkedIn + community) | Drafts posts for **Mike's own LinkedIn** and no-link reply drafts for forums/Reddit | The week's pages, real anonymized MIRA wins, Answer Radar threads | 3 LinkedIn drafts per week, 0–3 forum reply drafts | Wed | Post, comment, like or DM anywhere; create any account |
| **Pipeline Scout** (outbound, from day 31) | Finds a short list of maintenance managers, reliability engineers and integrators and drafts personal emails | ICP rules, Apollo free search, public plant news, HubSpot | Up to 10 researched, personal email drafts per week, logged in HubSpot | Thu | Send any email or LinkedIn message; buy lists; scrape LinkedIn |

Existing bots stay as they are. **Answer Radar** is the raw-material feed, **Notebook Prover** can spot-check MIRA answers before a page ships, and **FactoryLM Product** owns positioning facts. No separate analytics or strategist bot at first: the Lead does both.

## 3. How it runs each week
- **Mon:** Lead posts the brief in a new Slack channel, **#factorylm-marketing**: this week's 2 topics (from Answer Radar), the 3 post angles, the outbound focus, and last week's numbers.
- **Tue–Thu:** specialists draft against the brief and drop each draft as a reply in the **one weekly approval thread**.
- **Mike, about 30–45 min a week:** reply "ok", edit, or "no" on each draft. Approved pages get merged. Mike pastes LinkedIn posts himself (or schedules them in Buffer), and sends approved emails himself.
- **Fri:** Lead posts the scorecard and one thing to stop or change. If a draft sits unapproved for 7 days, it gets dropped instead of re-nagged.

## 4. Connectors and accounts
| Need | Status |
|---|---|
| Slack (factorylm workspace), new #factorylm-marketing channel | **Exists** (channel is new) |
| GitHub repo for site pages (Foreman's lane) | **Exists** |
| Answer Radar output, shared box browser | **Exists** |
| Grok Bot email inbox for drafts/replies | Exists in app; **claim one for marketing if wanted** |
| Image/video generation (diagrams, post images) | **Exists** in app |
| Google Search Console + GA4 for factorylm.com | **New/verify**: free; Mike grants read access |
| LinkedIn: Mike's profile + a FactoryLM company page | **Verify**: posting stays manual |
| Buffer (free: 3 channels, 10 queued posts each) | **New**, optional, free |
| HubSpot free CRM (contacts + deal pipeline) | **New**, free |
| Apollo free plan (about 75 contact credits a month) | **New**, month 2, free |

## 5. Guardrails
1. **Every claim cites a MIRA fact**: a manual section, the site, or a real logged result. No invented stats, customers, quotes or savings numbers. Google requires fact-checking AI content and treats mass-made pages that add no value as spam ("scaled content abuse").
2. **No auto-posting or auto-sending at first.** Bots draft and Mike publishes. Revisit after 60 days only if quality has held.
3. **No fake accounts, sockpuppets, fake reviews or bought engagement.** LinkedIn bans bots that post, comment, like or message, and bans scraping. The FTC's 2024 rule bans fake or AI-made reviews and testimonials.
4. **Reddit and forums:** reply only as Mike's real, disclosed account. Answer the question in full, with no link unless the sub allows it, and read each sub's rules first. Reddit treats bots and generative-AI tools that spread spam as spam, and its rule of thumb is that only about 1 in 10 posts should be your own content. **PLCTalk bans commercial posts and signatures** (a profile homepage link is the only one allowed), so there it's pure help or nothing.
5. **Email:** follow CAN-SPAM (true sender, honest subject line, postal address, working opt-out honored within 10 business days). Keep volume small and personal.
6. **Safety:** never give energized-work or safety advice beyond what the manual says. Mirror MIRA's "escalate, don't act" stance.

## 6. First 30 days
1. **Days 1–2:** Mike picks the first offer (Drive Commander Pro or the $500 Assessment) and approves the 4 bot personas. Create #factorylm-marketing.
2. **Days 2–4:** Lead writes a 1-page "facts we may claim" sheet from the site, the PRD and FactoryLM Product, and Mike approves it. Connect Search Console and GA4, and record the baseline numbers.
3. **Week 2:** first full cycle. Brief, 2 fault pages, 3 LinkedIn drafts, up to 2 forum replies. Mike approves in the thread.
4. **Week 3:** second cycle. Lead reports which topics drew the most search impressions and clicks, and adjusts.
5. **Week 4:** third cycle, plus set up HubSpot and Apollo free and have Pipeline Scout draft its first 5 test emails for review (none sent without Mike).
6. **Day 30:** review the scorecard together. Keep, cut or add one bot.

## 7. Metrics (Friday scorecard)
1. Pages shipped and their Search Console impressions/clicks
2. LinkedIn: posts published, plus comments and DMs from real maintenance people
3. Approval rate (drafts approved ÷ drafted) and minutes Mike spent
4. Sign-ups and paid conversions (Drive Commander Pro or Assessment requests) traced to a page or post
5. Outbound (month 2+): replies and meetings booked per 10 emails

## 8. Rough cost
- **Tools:** $0 to start (Buffer, HubSpot CRM, Apollo, GA4 and Search Console all have free tiers).
- **Bots:** 4 bots on a weekly schedule, at this app's normal usage cost. Volume is kept low on purpose (about 10 drafts a week).
- **Later, only if it's working:** Apollo paid from about $65/user/month (third-party pricing check, Sept 2026), Buffer paid, or LinkedIn ads.
- **Mike's time:** about 30–45 min a week of approvals.

## 9. Sources
- Storylane, Agentic Marketing in B2B (2026): https://www.storylane.io/blog/agentic-marketing-b2b
- FlickBloom, governed marketing agents: https://flickbloom.com/blog/enterprise-adoption-of-governed-marketing-agents-governance
- Dashly, agentic AI for B2B marketing (2026): https://www.dashly.io/blog/agentic-ai-for-b2b-marketing/
- Google, guidance on generative AI content: https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- Google, AI content and Search (2023): https://developers.google.com/search/blog/2023/02/google-search-and-ai-content
- LinkedIn, prohibited software and extensions: https://www.linkedin.com/help/linkedin/answer/a1341387
- LinkedIn User Agreement: https://www.linkedin.com/legal/user-agreement
- Reddit Help, Spam: https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam
- Reddit Help, Reddiquette (9:1 rule of thumb): https://support.reddithelp.com/hc/en-us/articles/205926439-Reddiquette
- Reddit, self-promotion guide: https://www.reddit.com/wiki/selfpromotion/
- PLCTalk User Agreement: https://www.plctalk.net/user-agreement/
- FTC, fake reviews and testimonials rule (2024): https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials
- FTC, CAN-SPAM compliance guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- Buffer pricing: https://buffer.com/pricing
- HubSpot free CRM: https://www.hubspot.com/products/crm
- Apollo plan details: https://knowledge.apollo.io/hc/en-us/articles/4677130104333-Customize-and-Manage-Your-Apollo-Plan ; pricing check: https://frontdeskreview.com/software/sales-intelligence/apollo-io/
- Internal: factorylm.com, the FactoryLM Product brief "Drive Commander technician PMF loop" (2026-09-05), Answer Radar scans in /workspace/answer-radar
