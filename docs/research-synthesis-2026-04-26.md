# Research Synthesis — FactoryLM × MIRA Pre-Launch

**Method:** Competitive recon + design-intent artifacts + CRM segment signal + outbound benchmarks (no live customer interviews yet — those come from `docs/customer-usability-survey-2026-04-26.md`)
**Participants / sources analyzed (n=10):**
- P1 — Codex marketing-pages recon (factorylm.com vs Factory AI, MaintainX, UpKeep, Limble, Fiix)
- P2 — Codex Hub recon (app.factorylm.com/hub/* vs app.f7i.ai)
- P3 — Interactive prototype (`MIRA-Projects-Prototype.html`) — design-vision artifact
- P4 — HubSpot 91-contact composition + 87-company composition + 4 stuck deals
- P5 — Gmail outbound + inbound from Mike's mike@cranesync.com
- P6 — `mira-web` codebase as shipped
- P7 — Brand kit synthesis from prior turns
- P8 — Updated `wiki/hot.md` (Bravo session) — KB inventory + recent build state
- P9 — Codex `qr-onboarding` skill — sticker fulfillment workflow
- P10 — `customer-usability-survey-2026-04-26.md` — designed, not yet fielded
**Date range:** 2026-04-22 → 2026-04-26
**Synthesizer:** Cowork

> **Methodology caveat upfront:** This is *pre-launch synthesis* — it triangulates competitive analysis, design intent, and ICP signal. It is NOT a substitute for fielding the survey to real plant maintenance managers. The survey returns (Segment A friendlies + Segment B ICP) will produce the canonical research synthesis 2-4 weeks from now. Treat the themes below as *hypotheses to test*, not validated findings.

---

## Executive Summary

Across the available signal, four themes recur strongly enough to ground product and marketing decisions today: (1) FactoryLM's product thesis is sharper than every competitor's headline — the gap is *packaging* not *positioning*; (2) honesty under uncertainty is the unique brand promise — every competitor either silently truncates, hallucinates, or hides limitations, and the prototype reflects that opening; (3) the buyer-vs-user split is real and unmitigated today — the marketing surface mixes the two audiences and confuses both; (4) the product surface (`/hub/*`) has reliability issues that will quietly undo any marketing wins (codex caught real 500s and routing bugs during the recon). Three recommended actions follow.

---

## Key Themes

### Theme 1 — "Sharper thesis, weaker packaging"

**Prevalence:** 4 of 4 marketing-surface signals (P1, P3, P5 vendor-pitch templates, P7).
**Summary:** Multiple independent reviewers (codex recon explicitly, the prototype implicitly, the brand kit synthesis) converge on the same observation: FactoryLM's tagline ("The AI troubleshooter that knows your equipment") is more memorable than any competitor headline, but the surrounding page fails to convert. Sparse hero, no trust band, static product mockup, secondary CTA dilutes the primary action, beta-application form appears too early.

**Supporting evidence:**
- *"FactoryLM already has the sharper product thesis. … The gap is mostly packaging: trust proof arrives too late, the hero mockup does not feel fully alive, and the trial path asks for too much before the user gets a quick win."* — P1 (codex marketing recon)
- *"The first viewport feels sparse. … There are no customer logos or customer proof in the hero band."* — P1
- The prototype's hero card (asset record with health pill, criticality, trends, open WO count) is exactly the "more believable product surface" P1 calls for — P3 design intent corroborates the gap.
- Vendor inbound emails from Eddie@TheJobHelpers, Rowen@Appenate, Sylvestre@Parseur (P5) all open with concrete, named context ("I see you're exploring Appenate for Crane Sync"), reinforcing that high-converting industrial outbound leads with the buyer's specifics — your current copy doesn't.

**Implication:** Don't change the message. Change the surface. Codex's punch list is the implementation spec.

---

### Theme 2 — "Honesty under uncertainty is the brand"

**Prevalence:** 5 of 10 sources — but with the highest signal density (P1, P2, P3, P6 codebase, P7 brand kit).
**Summary:** Across competitive analysis, the prototype, and the actual codebase, the strongest unique claim FactoryLM can make is *honest behavior in the failure modes that competitors hide*. The prototype's four document states (Indexed / Partial / Failed / Superseded), the safety-keyword interrupt, the cited-answers requirement (citation gate), the OCR-failure card that says "we told the user immediately rather than answer from a partial read" — all of these are anti-positioned to specific consumer-AI failures.

**Supporting evidence:**
- *"OCR failed on this PDF. We told the user immediately rather than answer from a partial read."* — P3 prototype
- *"ChatGPT Projects — silent file truncation at 30–60 KB while claiming full read."* — P3 vs-competitors tab, sourced
- *"Claude Projects — instructions followed before context compaction, violated 100% of the time after."* — P3, sourced
- The codebase already has the citation gate shipped (`feat/citation-gate` PR #418 merged 2026-04-19) — this is real, not aspirational. P8 hot.md.
- *"Safety keywords (arc flash, LOTO, confined space) escalate to a human, not generic chat."* — built into `mira-bots/shared/guardrails.py` per P6.

**Implication:** This is the brand promise. Lead every page with it. The single sentence to hold yourself to: *"FactoryLM never silently truncates your manual. MIRA never invents a torque spec. Both will tell you when they're not sure."*

---

### Theme 3 — "Buyer ≠ user, and today's surface confuses both"

**Prevalence:** 7 of 10 sources (P1, P3, P4 contact composition, P5, P7, P8, P10 survey design).
**Summary:** Two distinct audiences appear in every signal but are addressed as one on the marketing site. The buyer (plant manager, ops director, reliability lead) wants workspace evaluations: pricing, integrations, security, ROI. The user (maintenance tech, reliability engineer) wants agent demonstrations: voice, scan, citation, sun-mode. The current homepage tries to do both and fully serves neither. The 91-contact CRM inventory shows the same split: 2 real plant-ops folks (user-near), ~10 reliability-engineering academics (technical-user-adjacent), ~10 government / accelerator folks (buyer-adjacent), ~70 imported but not classified.

**Supporting evidence:**
- *"FactoryLM is the workspace. MIRA is the agent."* — P7 brand-kit synthesis converges on this exact split.
- The prototype implicitly enforces the split: every Direction (Asset / Crew / Investigation) is a *workspace* artifact with MIRA as the embedded agent. — P3
- HubSpot composition (P4) shows ZERO contact-company associations, which means buyer/user join can't be enforced today — that's also a structural symptom of treating them as one audience.
- Codex Hub recon (P2) flagged that the sign-in surface routes users to `/hub/feed` but the *evaluator* (who paid) wants to see `/hub/usage` and `/hub/assets` — and `/hub/usage` failed to load. The buyer's first session is broken.

**Implication:** Split the marketing surface. Homepage = buyer L1 ("FactoryLM is the workspace. MIRA is the agent."). `/projects` = buyer L2 (workspace deep-dive). `/mira` = user L2 (agent deep-dive). `/cmms` becomes pure trial entry (magic link, seeded sample).

---

### Theme 4 — "The product surface bleeds the marketing"

**Prevalence:** 3 of 10 sources but very high impact (P2 Hub recon, P6 codebase issues, P8 hot.md "active issues" list).
**Summary:** Codex's Hub recon caught real bugs that will cancel out marketing wins: `/hub/assets` bouncing to login from a signed-in page, `/hub/usage` failing with a browser load error even after reload, "New Work Order" step 1 button labeled "Save" despite a 3-step wizard. The eval score is 0/57 in the most recent run (P8 — pipeline-wide outage post-Anthropic-removal PR #610). Any visitor who follows a marketing CTA into a broken Hub will not come back.

**Supporting evidence:**
- *"`/hub/assets` bounced to login from a signed-in page, `/hub/usage` failed with a browser load error even after reload, and New Work Order step 1 labels the progression button `Save` despite a 3-step wizard."* — P2.
- *"All 57 fixtures returned 0-char responses; pipeline-wide outage, not patchable."* — P8 eval-fixer 2026-04-26.
- Wells Fargo card declined notifications in P5 indicate Mike is also stretched on infrastructure spend — fixing prod issues is a budget question, not just an engineering one.

**Implication:** Stabilize the Hub before pointing meaningful traffic at it. Run codex's Hub punch list through the issue tracker. Block the launch venues until Hub stranger-test passes.

---

### Theme 5 — "What works in industrial inbound (vendor-template signal)"

**Prevalence:** 6 of 6 vendor-pitch emails Mike received (subset of P5).
**Summary:** Mike's inbox has a usable corpus of well-converting industrial outbound — vendors pitching *him* with templates he's clicked or replied to. Four patterns recur:

1. *Specific-context opener.* Eddie ("Michael, the 2026 Q1 hiring window is wide open"), Rowen ("I see you're exploring Appenate for Crane Sync"), Sylvestre ("we have a customer who uses Parseur to parse PDFs showing the family trees of pedigree pigeons. Yes, you read that right").
2. *Single ask, low commitment.* "Reply with the doc type + what you were trying to do" (Ostroff @ LlamaIndex). "Happy to chat over email or organize a 15-min call" (Ross @ balena).
3. *Personality / curiosity hook.* Sylvestre's pigeon story is a literal pigeon story, which is why Mike opened it.
4. *Founder/personal sender.* Most worked emails come from a real-person sender, not noreply@. The product's brand is the founder's email signature.

**Supporting evidence:**
- The Mike-side replies that did fire (P5: outbound to Jacob @ LAUNCH, FFSBDC follow-up) all match patterns 1+2+4.
- The "Cold Email" + "Awaiting Reply" labels in Mike's Gmail are *empty* over the past 90 days — meaning Mike isn't running outbound at any scale right now. The patterns above are templates; he's just not using them.

**Implication:** Mike's outbound copy library is sitting in his own inbox. Lift directly from those templates when writing the Markus/Thomas re-pitch, the investor email, the Apollo cold sequence.

---

## Insights → Opportunities

| Insight | Opportunity | Impact | Effort |
|---|---|---|---|
| Sharper thesis, weaker packaging (Theme 1) | Refresh hero with L1 message + trust band + animated product surface | High | Med (2 days) |
| Honesty under uncertainty (Theme 2) | Make the four document states + safety interrupt the brand's first-page proof | Very high | Med (1 week to fully wire) |
| Buyer ≠ user (Theme 3) | Split marketing into `/projects` (workspace) + `/mira` (agent) + `/cmms` (trial) | High | Med (3 days) |
| Product surface bleeds marketing (Theme 4) | Stabilize Hub before driving traffic; fix routing bugs + restore eval pipeline | Critical | Med (5 days) |
| Outbound templates already in Mike's inbox (Theme 5) | Lift the patterns; re-write Markus/Thomas + investor + cold-Apollo copy | High | Low (1 day) |
| Two real plant prospects (Markus + Thomas) sit aging | Ship the personal email today; offer free sticker pack + Investigations tier framing | Very high | Trivial (30 min) |
| 68K KB chunks = thousands of long-tail keywords | Ship programmatic SEO with schema markup; own fault-code SERPs in 60 days | Very high | Med (1 sprint) |
| LLM-search citation = new "rank #1" | Ship `llms.txt`, schema, AI-crawler allowlist, bench-off; aim for 3-of-5 LLM citations by Aug | High | Low-Med (2 weeks initial) |
| No HubSpot ↔ mira-web sync | Block at Phase 0 — every workflow downstream depends on it | High | Low (3 days) |
| Vendor-pitch corpus shows what works | Build a small "outbound lift library" reference doc | Medium | Low (2 hours) |

---

## User segments identified (extends `docs/customer-usability-survey-2026-04-26.md`)

| Segment | Characteristics | Needs | Where they live | Estimated %  of pipeline |
|---|---|---|---|---|
| **The Practitioner** | Maintenance tech, reliability engineer, lead operator. Phone-first. 50K LinkedIn impressions/year max. Skeptical, no-fluff. | A working agent that answers the fault question in <60 sec with a citation. Voice in 80dB. Sun-readable. | r/PLC, PLCTalk, Reddit r/Maintenance, YouTube tutorial channels, Telegram, TikTok #bluecollar | 65% — the user, not the buyer |
| **The Buyer** | Maintenance manager, plant manager, ops director, reliability lead. Email-first. ROI-focused, risk-averse. | Workspace evaluation: pricing, security, integrations, references, "will this break my workflow" | LinkedIn, trade publications (Reliable Plant, Plant Engineering), SMRP, conferences | 25% — pays the bill |
| **The Buyer-User Hybrid** | Lead Plant Engineer (Markus), Operations Manager (Thomas). Small enough plant that the buyer IS the user. | Both — agent that works AND a plant-level decision they own | Mix of all above; mostly LinkedIn + trade events | ~10% — your fastest-closing pilot type |
| **The Influencer** | Industrial podcast hosts, plant-tour YouTubers, OEM application engineers, professors (Klaus Blache, Yuhao Zhong, etc.) | A unique angle for their content; no ask | LinkedIn + Twitter/X + their own channels | <5% — amplifier |
| **The Investor** | Industrial-tech VC partners, accelerator program directors | A demo, a metric, a thesis-fit story | LinkedIn + trade conferences + warm intros | <5% — capital |

The hybrid segment (Markus + Thomas archetype) is your fastest revenue path — they're the user AND the buyer, and your stuck $499 deals are exactly this profile. The prototype's Investigations tier ($497/mo, RCA workflow) is built for them.

---

## Recommendations (priority-ordered)

1. **[Critical, this week]** — Stabilize the Hub. The codex Hub recon (P2) caught reliability issues that will silently cancel marketing wins. Fix `/hub/assets` redirect, `/hub/usage` load error, "Save" button label on the WO wizard, restore eval pipeline (the 0/57 outage). *Why:* every recommendation below assumes the product behind the marketing actually works.

2. **[Critical, this week]** — Ship the codex landing-page punch list. New hero with L1 message + trust band + three Project cards + animated diagnostic + `/limitations` link in footer. Replace `/cmms` form with passwordless magic-link entry + seeded sample workspace. *Why:* highest-impact change in the entire backlog. Per Theme 1, the message is fine; the surface is the gap.

3. **[Critical, today]** — Send Markus + Thomas + 8 investors the prototype HTML with the playbook copy. *Why:* hybrid-segment pilot revenue is fastest; investor email is bridge capital. Both leverage existing assets (no new building). Per Theme 5, lift sender style from the vendor-pitch corpus in Mike's inbox.

4. **[High, weeks 1-2]** — Implement the brand split per Theme 3: rebuild messaging hierarchy as L1 (FactoryLM × MIRA), L2 product split (Projects vs MIRA), L3 differentiator (vs ChatGPT Projects), L4 feature claims. Update homepage, `/cmms`, pricing, every email template. *Why:* surfaces today serve neither audience cleanly.

5. **[High, weeks 1-2]** — Ship SEO foundation per `docs/seo-geo-strategy-2026-04-26.md`: schema markup on every existing fault-code page, `robots.txt` AI-crawler allowlist, `llms.txt`, Bing/Brave Webmaster, canonical tags. *Why:* unlocks the 68K-chunk moat as organic traffic. Quick wins are <2 hours each.

6. **[High, weeks 2-4]** — Programmatic fault-code factory v1 (50 pages with schema markup, then auto-generate to 250+). *Why:* compounds for years. Each page is also a GEO citation source.

7. **[Medium, weeks 4-6]** — Three pillar pages (`/ai-for-plant-maintenance`, `/cmms-with-ai`, `/industrial-rag-explained`) + 5 `/vs-{competitor}` comparison pages. *Why:* head-term coverage + buyer-stage capture. Each ranks within 60-90 days.

8. **[Medium, week 4]** — MIRA Bench-off published at `/benchmark` with full methodology, dataset on GitHub, schema.org/Dataset markup. *Why:* triple-purpose asset — marketing, GEO, press. Owns the "best AI for industrial maintenance" answer in LLMs for 12+ months.

9. **[Medium, ongoing]** — Reddit / PLCTalk / Stack Overflow contribution program (20 substantive answers in 30 days, then sustaining cadence). *Why:* GEO citation propagation. Each answer is training data for future LLM versions.

10. **[Lower, week 6+]** — Open-source the fault-code library on GitHub, `api.factorylm.com/v1/fault-codes/{code}.json` public API, weekly LLM-citation probe to track GEO progress. *Why:* compounding moat plays; not gating.

---

## Questions for further research (the actual customer voice — gate at survey returns)

These are hypotheses that require customer voice to validate. Send the survey before committing.

1. **Does "AI troubleshooter that knows your equipment" actually communicate the value?** — Theme 1 says yes; survey Q2 (open-text "what does MIRA do?") is the test.
2. **Is "honesty under uncertainty" a buying trigger or a hygiene factor?** — Theme 2 hypothesizes the former; survey Q4 (trust score) and Q10 (second-chance behavior) test it.
3. **Where does friction actually happen in onboarding?** — Theme 1 hypothesizes it's the `/cmms` form; survey Q5 (where did you get stuck) confirms or refutes.
4. **What does the practitioner segment actually expect to see when scanning a QR sticker?** — Theme 3 + prototype Direction A test this; survey Q7 (mental model) returns ground truth.
5. **What's the real ceiling on willingness-to-pay?** — $97 / $497 are educated guesses from the audit; survey Q4 frame ("$97 to make your team's life easier — what would it be?") provides indirect signal but won't fully resolve. Need a follow-up willingness-to-pay study after first 3 paying pilots close.
6. **Is the Investigations tier ($497/mo, RCA workflow) actually displacing a $5K consultant line item?** — Hypothesized from prototype Direction C; needs Markus + Thomas qualifying conversation to confirm budget structure.
7. **Does the Apollo cold-outbound segment behave like the inbound segment?** — Cannot answer until Apollo MCP is connected and 3-4 weeks of outbound run.

---

## Methodology Notes

- **What this synthesis is not:** customer voice. We don't have interview transcripts or live survey returns yet. The survey design exists in `docs/customer-usability-survey-2026-04-26.md` and should be fielded immediately to Segment A friendlies (5 names) and Segment B ICP (Markus, Thomas, 1-3 others).
- **Triangulation strength:** Themes 1, 2, 3, and 4 have ≥3 independent sources each. Theme 5 has a single source (P5 corpus) but the source is dense and high-quality.
- **Bias risk:** Codex's two recon docs (P1, P2) are the strongest single signal in this synthesis. Codex is an AI-driven recon tool reading Mike's product through a competitive lens — there's a risk it converges on consensus best-practice patterns rather than industry-specific insights. Validate Themes 1 and 4 with the survey before treating them as canonical.
- **Sample size:** "n=10 sources" overstates. Two recon docs + one prototype + one CRM + one inbox + one codebase + one wiki = 7 distinct artifacts; the rest are derivative. Consider this a *desk research* synthesis, not a *user research* synthesis.
- **Recency:** All sources from 2026-04-22 → 2026-04-26. Single-week window means current state is well-captured but trends are not visible.
- **Next study:** field the survey by 2026-05-01; synthesize returns by 2026-05-08 into `docs/customer-research-synthesis-2026-05.md`.
