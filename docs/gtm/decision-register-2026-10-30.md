# GTM Decision Register — 2026-10-30

Prepared by the CHARLIE GTM lane (claim: [#4982 comment 6515893002](https://github.com/Mikecranesync/MIRA/issues/4982#issuecomment-6515893002)). Read-only against the repo; no merges, deploys, spend, outreach, or employer-data access happened to produce this register. Pilot remains **NO-GO** (T-1 11/29 lexical, 15/29 hybrid — both below the 70% bar; [#4983](https://github.com/Mikecranesync/MIRA/issues/4983), [#4875](https://github.com/Mikecranesync/MIRA/pull/4875)). `.planning/` paths cited below are gitignored and live only on CHARLIE — not openable from a GitHub link.

**Default if Mike says nothing by the stated date, for every Section B row:** no spend, no external contact, no publish, no merge/deploy of anything money- or production-impacting. Silence is "don't."


> Lane-owner note (CHARLIE, 2026-10-30): the SMRP facts in O1 were verified directly against https://exchange.smrp.org/events/calendar (Florida Chapter "Chapter Meeting", Fri 2026-11-06, 10:00–15:00 ET, Owens Corning Roofing Plant, 1035 Talleyrand Ave, Jacksonville FL 32206; cost not listed; chapters@smrp.org). ISA Tampa Bay Section (isatampasection.org) lists no event on Nov 4; that line stays unverified.

## A. Resolved by recommendation (no money, no external contact, no production change)

| # | Decision | Evidence | Recommendation | If Mike says nothing | Needed by |
|---|---|---|---|---|---|
| O2 | Single accountable owner for prep work | [#4982 comment 6515893002](https://github.com/Mikecranesync/MIRA/issues/4982#issuecomment-6515893002) — WORK-CLAIM already posted today | Affirm the existing claim; no new assignment needed. A claim names a slice, not a person — **Mike stays the accountable human** for anything the claim can't authorize (merge/deploy/spend/contact). | Nothing changes; the claim stands as the de facto owner for this lane. | No deadline. |
| O3 | #4980 (GTM source map PR) | `.planning/2026-10-30-gtm-prep/map-pr4980.json`; PR diff confirms a 40+ row index with an explicit "not a second tracker" disclaimer on every section; still **OPEN/DRAFT** at `02e6edfd6` | **Merge as an informative index**, not a competing tracker — it points at canonical sources rather than restating their status. One flag for Mike: its "Strategy reconciliation" section proposes a revised critical-path table (feeds O5 below) — fine to merge since it disclaims authority throughout, but confirm it shouldn't instead be folded into the canonical plan artifact. | #4980 stays open/draft; no harm, just unmerged clutter. | No deadline. |
| O6 | PR backlog triage (257 PRs) | `.planning/2026-10-30-gtm-prep/pr-triage.json`: 40 release-critical / 96 useful / 96 defer / 19 close-superseded / 6 needs-human | See **Appendix B** below. Spot-verified the three riskier close calls via `gh api`: #4471's fix landed on main at `0029f6063`, #4469's at `0067b81de`, #3565's canonical twin #3559 merged 2026-09-04 — all three confirmed superseded. **#4465 does not belong in close-superseded** (confirmed still OPEN/CONFLICTING, no evidence it landed on main, and its own triage note calls it a safety/correctness fix) — moved to needs-human, leaving **18** confidently closable. No PRs closed by this register. | 18 stale/superseded PRs stay open; clutter only, no functional risk. | No deadline. |
| O9 | Written employer authorization before real Universal data/naming | [#4982 body](https://github.com/Mikecranesync/MIRA/issues/4982) already states this constraint; `.planning/STATE-2026-10-30-gtm-prep-lane.md` confirms the CAT Pumps 3520 demo uses only public manufacturer PDFs, kept out of git | Standing rule, already honored — no real Universal data or naming has occurred in this lane. **The first time real Universal data or the Universal name is proposed for anything customer-facing, that instantly becomes a Section B item** — flag it then, don't pre-clear it now. | Nothing changes; the existing ban holds. | No deadline (re-trigger on first real-data proposal). |
| O10a | Mission Control plan link — the code | `.planning/2026-10-30-gtm-prep/map-mission-control.json`: smallest safe change is a new `MC_PLAN_URL` env var, validated to the `https://claude.ai/artifact/` prefix, rendered in a header slot outside the existing GitHub-only card-link guard (`server.py:122-124`); ~30-line diff, 3 new tests | A separate agent is already preparing this draft PR — do not duplicate. Recommend proceeding with the smallest-change shape above; it does not touch the existing `test_render_refuses_non_github_links` guard. | Draft PR proceeds on its own timeline; no code risk either way. | No deadline. |

## B. Awaiting Mike

| # | Decision | Evidence | Recommendation | If Mike says nothing | Needed by |
|---|---|---|---|---|---|
| O1 | Event registration | SMRP Florida Chapter meeting, Fri 2026-11-06, 10:00–15:00 ET, Owens Corning plant, Jacksonville, ~3.5h from Lake Wales — **facts from the mission brief, unverified by this lane, cost not listed.** ISA Tampa Bay "Nov 4" event: **no matching event found**, line unverified. | Confirm the SMRP meeting's actual cost and open-attendance policy before committing; treat ISA Tampa Bay as not happening until a real listing turns up. Do not register or pay without Mike's go-ahead. | Neither event is attended. No registration, no cost incurred. | **Nov 3** (Mon) — 3 days of runway before the Fri Nov 6 date. |
| O4 | Merge + deploy PR #4970 (HubSpot lead capture) | `.planning/2026-10-30-gtm-prep/map-pr4970.json`; **re-verified today**: `gh pr checks 4970` lists **46** checks, all `pass`; sampled 3 individual check-runs plus the main CI workflow run via `gh api .../commits/f14c42e8ad4.../check-runs`, all confirmed at the PR's exact current head `f14c42e8a`; `doppler secrets --project factorylm --config prd` shows `HUBSPOT_API_KEY` **present** in prd (Doppler listing — value not read). | Merge-ready on the evidence. Per `.claude/rules/multi-session-protocol.md`, the Codex exact-head GREEN at `f14c42e8a` (cited in map-pr4970.json) is still the actual merge gate, not this register. Still a human gate (production deploy) either way — recommend doing it now since it closes one of O7's remaining items below. Post-deploy: create a prod Hub signup, confirm the HubSpot contact lands, delete the test contact. | O7's remaining CRM-forwarding gap stays open. | **Nov 21** (tie to the gate review). |
| O5 | Keep conditional dates (never commitments) | [#4372 comment 6511884124](https://github.com/Mikecranesync/MIRA/issues/4372#issuecomment-6511884124), read directly (not secondhand): posted under the owner's account 2026-10-30T00:31Z, text: "**Critical path:** gate review on Nov 21, then pilots installed by Dec 1, then 3 paying by Dec 31 (pilots are free for 30 days). The pilot is still NO-GO." The comment is itself an agent-authored status post (opens "One plan from here, CHARLIE, 2026-10-30") via the owner's GitHub account — #4980 separately flags "owner approval not independently established." | Treat Nov 21 / Dec 1 / Dec 31 as **agent-reported planning targets for Mike to ratify**, not an already-decided commitment. Keep using them internally only; never publish or promise them externally. They hold **only if** T-1 through T-5 pass — today T-1 is still failing both lanes (11/29 lexical, 15/29 hybrid). | Dates quietly become the plan's assumed trajectory with no explicit ratification — risk of a stale target outliving its gate. | Ratify (or correct) at the **Nov 21 gate review** itself. |
| O7 | $150 ad spend ($100 Google Search + $50 Meta) | [#4873](https://github.com/Mikecranesync/MIRA/issues/4873): planning-only, no spend authorized. The Oct-28 engineering blocker list is **partly stale** — re-verified live today, four items: (1) PostHog key is live and the script fires a real `posthog.init("phc_qWJ…")` plus `cta_click` capture on `[data-cta]` clicks (confirmed by curling `factorylm.com/posthog-init.js`) — but **whether any event actually lands in PostHog was not verified** (not queried this pass). (2) Lead-intake backend ([#4881](https://github.com/Mikecranesync/MIRA/pull/4881)/[#4893](https://github.com/Mikecranesync/MIRA/pull/4893)) is merged and in prod, but **nothing on the live site posts to it** — the standalone `GET /pilot` page was deliberately removed per #4881's own text, the homepage still shows a `mailto:` link and the retired `hero-assessment` CTA, and the planned path (Meta/Google native lead forms → export → intake) is untested end to end. (3) Landing copy still conflicts with the live offer — #4552/#4434/#4570 all still open. (4) #4970 not yet deployed (see O4). | **Still hold.** Two things are closer than the Oct-28 snapshot suggested (key live, intake code shipped) but none of the four conditions is fully proven yet. Unhold needs: landing copy reconciled, #4970 deployed, and one end-to-end proof — a test click shows up as a PostHog event, a test Hub signup records attribution, and one simulated native-lead export reaches the intake. | $150 is not spent; campaign stays in planning. | Revisit at the **Nov 21 gate review**, once O4 and the landing-copy PRs resolve. |
| O8 | Pricing — which offer ships | See **Pricing Appendix** below. | **Recommend M6a (first five free)** as the only thing actually offered right now. Do not send the Section 10 notice on PR #4845's current text — confirmed by reading its diff, that text defines a $500/30-day pilot with "no automatic renewal," which M6a superseded for these five pilots; since nothing is charged today, letting the Nov 17 effective date slide costs nothing. Separately, drop commit `c63ad681c` in #4552 — its "Oct-17-locked" $399/mo continuation price (which predates M6 and was never part of #4845's text) conflicts with M6a and shouldn't stay in public copy. | Public copy stays in its current, already-flagged-false-claim state (old Assessment/$500/$2–5K copy, per #4434); #4845 and #4552 sit unresolved and risk colliding if either merges alone. | **Nov 2** (Mon) — the last day to send the §10 notice if Mike instead wants to keep the Nov 17 effective date for #4845's text as written. Past Nov 2 with no notice sent, Nov 17 simply slides (matches the recommendation). |
| O10b | Mission Control deploy to CHARLIE | `.planning/2026-10-30-gtm-prep/map-mission-control.json`: deploy needs `git archive`, symlink `current/`, LaunchAgent bootstrap, Tailscale MagicDNS verification — node-level, not a code decision. | Deploy once the draft PR (being prepared by another agent) is ready and reviewed. | Plan link stays unpublished; no functional loss, just a convenience delayed. | No deadline. |

---

## Pricing Appendix (O8 detail)

Three options exist on the record. Naming them by content, not by the inconsistent A/B/C letters different source files used for them:

1. **M6 D1 paid pilot** ([#4552](https://github.com/Mikecranesync/MIRA/pull/4552), [#4845](https://github.com/Mikecranesync/MIRA/pull/4845), both OPEN/DRAFT) — $500/site, 30 days, decided 2026-10-27.
2. **M6a first-five-free** ([#4372 comment 6459876206](https://github.com/Mikecranesync/MIRA/issues/4372#issuecomment-6459876206)) — decided 2026-10-28, **supersedes M6's price for these five pilots only**.
3. **Enterprise tier** (`pricing_and_tier_architecture.md` memory doc + MSA draft §2.2, both low-evidence — no implementation, no Order Form pricing filled in) — $899 base + $19/seat/mo.

The **live-today public copy** (Assessment $500 / Pilot $2–5K/mo / Operating Layer $499/mo, on `mira-web/public/pricing.html` and the Hub `/upgrade` page) is none of these three — it's the thing all three are meant to retire, and it's still flagged as a false-claims problem (#4434).

| | M6 D1 paid pilot | M6a first-five-free | Enterprise |
|---|---|---|---|
| **Price** | $500/site, one-time, 30 days, "arranged directly with FactoryLM" (#4845's own text — read directly, confirmed it says nothing about a continuation number). #4552 separately carries a $399/mo-or-$3,990/yr continuation price, but that's the **Oct-17 lock** (commit `c63ad681c`), which predates M6 and conflicts with M6a. | $0 for 30 days, first five approved pilots only. $499/mo is a *proposed* post-validation option — not advertised, not wired to any checkout. | $899/mo base + $19/seat/mo. No implementation, no filled-in Order Form number. |
| **Who pays** | Customer, upfront, before any pilot access. | No one, during the pilot window. | A larger prospective customer wanting isolation/multi-seat. |
| **What they get** | 30 days access, one team, up to 15 technicians (#4552), no self-serve checkout. | 30 days access, one team, agreed equipment/manual coverage, 5-user cap, no auto-renewal. | Claimed tenant isolation + integrations — **unverified for this tier specifically**. (The repo does have general RLS machinery elsewhere; that's not the same as this tier being built and tested.) |
| **Legal/Terms impact** | Requires Terms v2 (#4845) to go live, plus the Section 10 14-day subscriber notice before the effective date. | None for the free window — no payment, no checkout exists to need Terms changes. A future $499/mo activation would need its own Terms + checkout work. | Needs its own Order Form tier definition (MSA §2.2 defers all four tiers there; none are priced yet). |
| **Must NOT publish** | The $399/mo figure (`c63ad681c`) anywhere unreconciled with #4845's text; two different $500 offers side by side (the exact conflict #4845 exists to fix); any self-serve-checkout claim — none exists. | The $499/mo figure as a *current* price; any claim that pilots convert automatically. | The $899+$19/seat number as committed/current; any isolation or integration capability claim until it's actually built and tested. |

**Recommended option: M6a (first-five-free).** It's the most recent owner decision (2026-10-28, explicitly superseding M6 for the pilots that matter right now), requires no Terms change because nothing is charged, and matches reality — no self-serve checkout exists on either `mira-web` or `mira-hub` today, so a paid-D1 offer has nowhere to actually collect payment. Keep M6's paid-pilot draft (#4552/#4845) in reserve for whenever a real continuation price is approved, and drop `c63ad681c`'s $399 figure before anything ships. Treat Enterprise as a later roadmap item pending real isolation/integration evidence — not something to price or publish today.

Onboarding/setup services (separate from subscription, per MSA §4.6): no defensible rate exists yet. **Rates TBD after the first pilots ship**; MSA §4.6 already permits Order-Form professional-services line items, so the mechanism exists — only the number is missing.

---

## PR Backlog Appendix (O6 detail)

### Close-superseded (18, after moving #4465 out — see Needs-human)

The 15 `docs(wiki): eval-fixer run …` rows below are routine automated wiki fragments, each superseded by a newer eval-fixer run and/or made obsolete by the 2026-10-23 switch to direct-to-main eval-fixer commits (`0926f634d`) — no unique content either way, so the disposition doesn't depend on which mechanism applies.

| # | Title | Superseded by / reason |
|---|---|---|
| #4933 | eval-fixer run 2026-10-29 | #4984 (2026-10-30 run) |
| #4472 | eval-fixer run 2026-10-17 | Newer run / direct-to-main switch |
| #4464 | eval-fixer run 2026-10-16 | Newer run / direct-to-main switch |
| #4440 | eval-fixer run 2026-10-15 | Newer run / direct-to-main switch |
| #4422 | eval-fixer run 2026-10-14 | Newer run / direct-to-main switch |
| #4395 | eval-fixer run 2026-10-13 | Newer run / direct-to-main switch |
| #4378 | eval-fixer run 2026-10-12 | Newer run / direct-to-main switch |
| #4346 | eval-fixer run 2026-10-11 | Newer run / direct-to-main switch |
| #4338 | eval-fixer run 2026-10-10 | Newer run / direct-to-main switch |
| #4317 | eval-fixer run 2026-10-08 | Newer run / direct-to-main switch |
| #4304 | eval-fixer run 2026-10-07 | Newer run / direct-to-main switch |
| #4242 | eval-fixer run 2026-10-05 | Newer run / direct-to-main switch |
| #4220 | eval-fixer run 2026-10-04 | Newer run / direct-to-main switch |
| #4204 | eval-fixer run 2026-10-03 | Newer run / direct-to-main switch |
| #4199 | eval-fixer run 2026-10-02 | Newer run / direct-to-main switch |
| #4471 | fix: block hazardous notebook answers and lockout contradictions | **Verified landed on main** at `0029f6063` ("remounted on current main (#4471, #4122)") |
| #4469 | fix(hub): reject wrong-model notebook manual evidence | **Verified landed on main** at `0067b81de` ("notebook manual applicability reads the declared title only") |
| #3565 | fix(foreman): serialize warm-agent send through wait | Duplicate of #3559, **verified MERGED** 2026-09-04 |

### Needs-human (7 — the triaged 6, plus #4465 moved in; reordered by urgency)

| # | Title | Why it needs Mike |
|---|---|---|
| #4223 | security(hub): bump next 16.3.5→16.3.6 (GHSA-vcvr-r3jv-pc5j) | Security fix for a Next.js RCE. **Confirmed CONFLICTING**, draft, idle 21 days. Needs manual conflict resolution — highest-severity item in this list. |
| #4465 | fix(engine): enforce answer evidence and identity boundaries | **Misbucketed by the original triage** — moved here from close-superseded. Confirmed still OPEN, CONFLICTING, idle since Oct 16, no evidence it landed on main; its own triage note calls it a safety/correctness fix. Needs an explicit decide-and-land call, not a close. |
| #4845 | [HELD] Terms v2 amendment, retire old offers for the D1 pilot | Explicit "Do not merge" pending Mike + counsel review; see O8 above. |
| #4023 | fix(hub): safety judge reaches its verdict (no more truncated "unknown") | Explicit ⛔ "Do not merge without Mike's decision" — an over-block case where correct answers were being withheld. |
| #3918 | docs(release): NAP-5H HANDOFF + Mike's wake-up decision card | Idle 40 days; header gates merge on Mike's decision at a checkpoint that has long since passed — likely moot, but closing it is still Mike's call, not this register's. |
| #4276 | chore(deps): Bump stripe (major, 22.2.0→23.0.0) | Breaking major version bump; CI and pack tests currently failing. |
| #3300 | fix(workflow): converge manual and Files flow across clients | 80-file change, 2 days old, touches security-critical upload/service-request seams; scope and acceptance criteria unclear from the PR body alone — needs real security/architecture review. |

---

## Hazard Ledger

- A Doppler listing command run without `--only-names` during this session printed truncated value prefixes for `HUBSPOT_API_KEY` and `HUBSPOT_PERSONAL_ACCESS` into this session's transcript (not into this file). Mike decides whether rotation is warranted.
- Every `.planning/` source cited above is CHARLIE-local and gitignored — not visible from GitHub or another node.
- All PR/CI/Doppler/live-site states above are as of the check time today (2026-10-30); re-verify before acting if time has passed.

**File:** `/private/tmp/claude-501/-Users-charlienode/298151bf-dd04-4429-98cd-8c7d997a90a2/scratchpad/docs-out/decision-register-2026-10-30.md`
