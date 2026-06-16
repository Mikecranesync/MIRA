# GitHub Alignment + Re-Prioritization

**Generated:** 2026-04-26
**Source:** `Mikecranesync/MIRA` open issues (n=92) and PRs (n=7) snapshot
**Anchor docs:** `docs/website-refactor-roadmap-2026-04-26.md`, `docs/design-system-2026-04-26.md`, `docs/design-handoff-2026-04-26.md`
**Goal:** Re-prioritize what exists, add ONLY what's missing, group into Claude-Code-session-sized PR chunks.

---

## TL;DR

You already have most of the roadmap in flight. **70% of my proposed `#SO-*` issues map 1:1 to existing GitHub issues.** I'm only proposing **22 net-new issues**, almost all in the design-system + SEO/GEO + codex Hub-bug categories that didn't have GitHub coverage yet.

What I found:
- A well-organized backlog with five active clusters: Factory AI Parity (#561-#581), web-review batch (#615-#663), merge-prep (#602-#607), Hub Google Drive connector (#530-#536), and lead-hunter (#518-#522, #598). Plus eval/pipeline tickets (#525, #596, #597, #653) covering the same outage I'd have filed.
- 7 open PRs — 4 are MVP-unit work (Units 4, 5, 7, 9a), 1 is Anthropic-removal cleanup (#649), 1 is a `.gitignore` chore (#652), 1 is a comic-pipeline experiment (#608) that's out of the 90-day scope.
- The brand kit's "FactoryLM vs MIRA" naming clarity is **already filed** as #619 (P1, web-review). My recommendation: comment on #619 with the brand kit doc and close it via PR.

The plan below has three parts:
1. **Re-prioritize existing issues** into the roadmap's phase order — no creation, just label + milestone updates.
2. **Create ~22 net-new issues** for the design system + SEO/GEO foundation that aren't yet on GitHub.
3. **Close or defer ~5 issues** that the 90-day decision register explicitly excludes.

A bash script at the bottom does all three in one run.

---

## Part 1 — Alignment matrix (existing GH issue → roadmap phase)

### Wave 0 — already in flight (this week)

| Existing # | Title | Roadmap mapping | Action |
|---|---|---|---|
| #602 | merge-prep: install npm deps + commit lockfile (P0) | Phase 0 — gating for any new build | Keep, finish this week |
| #603 | merge-prep: provision 13 Doppler env vars (P0) | Phase 0 — gating | Keep |
| #604 | merge-prep: auth-sweep — replace ~80 x-tenant-id stubs (P0) | Phase 0 — security baseline | Keep, top priority |
| #607 | merge-prep: migration deploy-order doc + cutover runbook (P0) | Phase 0 — release safety | Keep |
| #605 | merge-prep: wire #576 webhook dispatcher (P1) | Phase 1 — needed for `#SO-027` scan alerts | Keep, schedule W2 |
| #606 | merge-prep: install vitest + per-branch test baseline (P1) | Phase 0 — quality | Keep |
| #615 | web-review/P0: /api/register rate limit + CORS lock | Phase 0 | Keep, P0 this week |
| #616 | web-review/P0: zero security headers site-wide | Phase 0 | Keep, P0 this week |
| #617 | web-review/P0: HEAD returns Content-Length: 0 | Phase 0 | Keep, P0 this week |
| #619 | web-review/P1: product naming inconsistent (FactoryLM vs MIRA) | Phase 0 — **solved by brand kit** | Comment + close via brand-kit PR |
| #620 | web-review/P1: favicon 404 | Phase 0 | Keep |
| #621 | web-review/P2: lucide unpkg supply-chain risk | Phase 0 | Keep |
| #625 | web-review/P3: nginx version exposed | Phase 1 | Keep, lower priority |
| #653 | eval: 57/57 failures (today) | Phase 0 — **CRITICAL** outage | Keep, top priority — fix before any user-facing work |
| #656 | Daily adversarial review: engine.py (2026-04-26) | Phase 0 — review | Keep, fix what review found |

### Wave A — Foundation (Phase 0 design system + brand)

| Existing # | Title | Roadmap mapping | Action |
|---|---|---|---|
| (none) | — | `#SO-300` Tokens CSS file | **CREATE** |
| (none) | — | `#SO-301` Shared `<head>` partial | **CREATE** |

### Wave B — Components (Phase 0 design system)

| Existing # | Title | Roadmap mapping | Action |
|---|---|---|---|
| (none) | — | `#SO-302` `.fl-btn` button | **CREATE** |
| (none) | — | `#SO-303` `.fl-state` four-state pill | **CREATE** |
| (none) | — | `#SO-304` `.fl-trust-band` | **CREATE** |
| (none) | — | `#SO-305` `.fl-compare` grid | **CREATE** |
| (none) | — | `#SO-306` `.fl-stop-card` | **CREATE** |
| (none) | — | `#SO-307` `.fl-price-card` 3-variant | **CREATE** |
| (none) | — | `#SO-308` `.fl-limits` list | **CREATE** |
| (none) | — | `#SO-309` Sun-readable mode toggle | **CREATE** |

### Wave C — Marketing surfaces (Phase 0)

| Existing # | Title | Roadmap mapping | Action |
|---|---|---|---|
| #657 | web-review/P0: /pricing plan intent dropped — both CTAs link to /cmms | Phase 0 — `#SO-104` (3-tier pricing) | Keep, scope expands to full 3-tier rebuild |
| #658 | web-review/P1: /cmms H1 identical to landing H1 | Phase 0 — `#SO-070` (cmms magic-link) | Keep, scope expands to full magic-link refactor |
| #659 | web-review/P1: /pricing tab focus lands off-screen | Phase 0 — folded into `#SO-104` | Keep |
| #660 | web-review/P2: mobile tap targets <44px | Phase 0 — universal design-system fix | Keep, addressed by `#SO-302` |
| #661 | web-review/P2: /pricing missing Product/Offer JSON-LD | Phase 0 — `#SO-112` | Keep, addressed by `#SO-104` |
| #662 | web-review/P3: 404 page 13-byte plain text | Phase 1 | Keep |
| #663 | web-review/P3: /activated bounce silent | Phase 1 | Keep |
| (none) | — | `#SO-100` Homepage rewrite (full) | **CREATE** — bigger than any single web-review issue |
| (none) | — | `#SO-070` /cmms magic-link rebuild | **CREATE** — extends #658 |
| (none) | — | `#SO-005` /limitations page | **CREATE** |
| (none) | — | `#SO-103` /vs-chatgpt-projects page | **CREATE** |

### Wave D — Hub product (Direction A polish, Phase 1)

| Existing # | Title | Roadmap mapping | Action |
|---|---|---|---|
| #561 | EPIC: Factory AI feature parity + leapfrog (P1) | Phase 1-4 — **the master Hub epic** | Keep, this is the umbrella |
| #562 | hub: site→area→asset→component hierarchy (P1) | `#SO-220` Asset hero card | Keep, scope expands |
| #563 | hub: auto-generate QR code per asset | Phase 1 — already covered by `mira-web/m.ts` | Keep |
| #564 | hub: component template catalog (P2) | Phase 4 | Keep, defer |
| #565 | hub: WO 7-state lifecycle (P1) | Phase 4 — Investigation prep | Keep |
| #566 | hub: PM procedures w/ safety schema (P1) | Phase 1-4 | Keep |
| #567 | hub: maintenance-strategies model (P2) | Phase 4 | Keep, defer |
| #568 | hub: ISO 14224 failure code taxonomy (P1) | Phase 1-2 — feeds fault-code SEO | Keep |
| #569 | hub: FFT vibration peak detection (P2) | Phase 4 | Keep, defer |
| #570 | hub: external-events ingest API | Phase 4 | Keep |
| #571 | hub: sensor reports per-asset (P2) | `#SO-223` Sensors shelf | Keep |
| #572 | hub: inventory module (P2) | Phase 4 | Keep, defer |
| #573 | hub: purchasing module (P2) | Phase 4 | Keep, defer |
| #574 | hub: asset-scoped chat (P0) | `#SO-225` Hub right-rail chat | **TOP PRIORITY** in Hub |
| #575 | hub: mobile PWA — offline WO (P1) | Phase 4 | Keep |
| #576 | hub: outbound webhooks Slack/Teams/PagerDuty (P0) | Phase 1 — needed for `#SO-027` scan alerts | Keep, top Hub priority |
| #577 | docs(api): public API reference site (P1) | Phase 2 — feeds GEO | Keep |
| #578 | hub: subdomain multi-tenancy (P1) | Phase 4 | Keep, defer |
| #581 | leapfrog: open-source mira-safety-guard | Phase 4 | Keep, defer |
| (none) | — | `#SO-200` `/hub/assets` redirect bug (codex recon) | **CREATE** |
| (none) | — | `#SO-203` `/hub/usage` browser load error | **CREATE** |
| (none) | — | `#SO-204` WO wizard step 1 button "Save" → "Continue" | **CREATE** |
| (none) | — | `#SO-211` Stranger smoke test guarding deploys | **CREATE** |

### Wave E — SEO + GEO (Phase 0-3)

| Existing # | Title | Roadmap mapping | Action |
|---|---|---|---|
| (none) | — | `#SO-110` schema TroubleshootingGuide on fault codes | **CREATE** |
| (none) | — | `#SO-111` Organization schema on homepage | **CREATE** (covered by `#SO-301` head partial; can fold in) |
| #661 | (already) /pricing JSON-LD | `#SO-112` Pricing schema | Keep, fold into `#SO-104` |
| (none) | — | `#SO-113` robots.txt AI-crawler allowlist | **CREATE** |
| (none) | — | `#SO-114` /llms.txt + /llms-full.txt | **CREATE** |
| (none) | — | `#SO-115` Bing Webmaster + Brave Console | **CREATE** |
| (none) | — | `#SO-116` Google Search Console verify | **CREATE** |
| (none) | — | `#SO-117` Canonical tags + per-page meta | **CREATE** (covered by `#SO-301`) |
| (none) | — | `#SO-118` Internal-link fault-code pages | **CREATE** |
| (none) | — | `#SO-128` Weekly LLM-citation probe | **CREATE** |
| (none) | — | `#SO-130` Brand schema sameAs | **CREATE** (fold into `#SO-301`) |

### Wave F — Sales motion (already covered or in personal channels)

| Existing # | Title | Roadmap mapping | Action |
|---|---|---|---|
| #438 | feat(qr): wire Avery PDF format selector into /admin/qr-print | `#SO-022` sticker pre-generate | Keep |
| #439 | feat(qr): unknown-asset auto-register PLG loop | `#SO-021` unclaimed assets | Keep |
| #440 | skill: qr-onboarding Cowork skill (already on codex branch) | n/a | **CLOSE** — shipped on `codex/repo-sync-baseline` |
| #441 | feat(qr): sales demo mode 5-VFD sheet | `#SO-022` related | Keep |
| #461 | ops: provision HubSpot Private App token | `#SO-010` HubSpot sync prereq | Keep, top sales priority |
| #520 | feat(lead-hunter): push 6 named managers to HubSpot | `#SO-010` related | Keep |
| #461 | (above) | (above) | (above) |
| (none) | — | `#SO-001` re-pitch Markus | **NOT a GitHub issue** — Mike does in personal email |
| (none) | — | `#SO-002` re-pitch Thomas | **NOT a GitHub issue** — same |
| (none) | — | `#SO-003` MX fix | **CREATE** as ops issue |

### Wave G — explicitly out of 90-day scope (defer or close)

Per the roadmap's decision register (`docs/website-refactor-roadmap-2026-04-26.md` §6):

| Existing # | Title | Why defer |
|---|---|---|
| #579 | hub: SSO via SAML + OIDC | Decision register: "Don't build SOC 2, SAML, SSO until Q1 2027" |
| #580 | ops: SOC 2 Type 1 kickoff | Same |
| #470 | ops: provision BytePlus API key for Seedance video | Out of scope — video generation is not in the 90-day plan |
| #608 (PR) | feat(comic-pipeline): OpenAI panel generation | Same — PR is on a side experiment |
| #581 | leapfrog: open-source mira-safety-guard on PyPI | Defer to Q3 — not gating for first 25 customers |

**Recommendation:** Add label `defer-q3-2026` to all 5; do not close (preserves discussion + spec). Move out of any active milestone.

### Wave H — eval / outage (single thread, must be top of every queue)

The pipeline is currently 0/57 — no marketing surface or sales venue should land traffic until this is fixed.

| Existing # | Title | Action |
|---|---|---|
| #525 | eval: 57 failures (2026-04-20) | Comment + link to #653; close as duplicate |
| #596 | eval: 57/57 fixtures failing (2026-04-25) | Same |
| #597 | Cowork eval producing 0/57 — pipeline unreachable | Same |
| #653 | eval: 57/57 failures (2026-04-26, latest) | **TOP PRIORITY THIS WEEK** — keep open as the canonical thread |

---

## Part 2 — Net-new issues to create (22 total)

These are the only issues missing from GitHub. Everything else maps to something already there.

| Phase | Roadmap ref | Title | Labels | Milestone |
|---|---|---|---|---|
| 0 | `#SO-300` | feat(web): canonical design tokens — `_tokens.css` | enhancement, design-system, P0 | Phase 0 — Foundation |
| 0 | `#SO-301` | feat(web): shared `<head>` partial with SEO + canonical + JSON-LD slot | enhancement, design-system, P0 | Phase 0 — Foundation |
| 0 | `#SO-302` | feat(web): `.fl-btn` button component (primary, ghost, mic) | enhancement, design-system | Phase 0 — Foundation |
| 0 | `#SO-303` | feat(web): `.fl-state` four-state pill (Indexed/Partial/Failed/Superseded) | enhancement, design-system | Phase 0 — Foundation |
| 0 | `#SO-304` | feat(web): `.fl-trust-band` for homepage trust strip | enhancement, design-system | Phase 0 — Foundation |
| 0 | `#SO-305` | feat(web): `.fl-compare` side-by-side grid component | enhancement, design-system | Phase 0 — Foundation |
| 0 | `#SO-306` | feat(web): `.fl-stop-card` safety interrupt component | enhancement, design-system, safety | Phase 0 — Foundation |
| 0 | `#SO-307` | feat(web): `.fl-price-card` (3 variants — free/recommended/premium) | enhancement, design-system | Phase 0 — Foundation |
| 0 | `#SO-308` | feat(web): `.fl-limits` honesty list component | enhancement, design-system | Phase 0 — Foundation |
| 0 | `#SO-309` | feat(web): sun-readable mode toggle + localStorage persist | enhancement, design-system | Phase 0 — Foundation |
| 0 | `#SO-100` | feat(web): homepage refactor — L1 message + trust band + 3-card row + compareBlock | enhancement, plg-funnel, P0 | Phase 0 — Foundation |
| 0 | `#SO-070` | feat(web): /cmms magic-link entry — replace beta form (extends #658) | enhancement, plg-funnel, P0 | Phase 0 — Foundation |
| 0 | `#SO-005` | feat(web): `/limitations` page (honest "what we don't do yet") | enhancement, plg-funnel, P1 | Phase 0 — Foundation |
| 0 | `#SO-103` | feat(web): `/vs-chatgpt-projects` page (lift from prototype X-tab) | enhancement, plg-funnel, marketing-content | Phase 0 — Foundation |
| 0 | `#SO-110` | feat(web): schema.org TroubleshootingGuide + FAQ + HowTo on fault-code pages | enhancement, seo, P1 | Phase 0 — Foundation |
| 0 | `#SO-113` | chore(web): robots.txt — explicit AI-crawler allowlist + scraper deny | seo, geo, P1 | Phase 0 — Foundation |
| 0 | `#SO-114` | feat(web): /llms.txt + /llms-full.txt | seo, geo, P1 | Phase 0 — Foundation |
| 0 | `#SO-115` | ops: submit factorylm.com to Bing Webmaster + Brave Search Console | seo, geo, P2 | Phase 0 — Foundation |
| 0 | `#SO-116` | ops: verify Google Search Console + submit sitemap | seo, P1 | Phase 0 — Foundation |
| 0 | `#SO-118` | feat(web): internal-link every fault-code page to 3 siblings + index + /projects | seo, P2 | Phase 0 — Foundation |
| 0 | `#SO-128` | docs(geo): weekly LLM-citation probe in `wiki/geo-probe.md` | geo, docs, ongoing | Phase 0 — Foundation |
| 0 | `#SO-200` | bug(hub): /hub/assets redirects to login from a signed-in page (codex recon) | bug, hub, P0 | Phase 0 — Foundation |
| 0 | `#SO-203` | bug(hub): /hub/usage browser load error after reload (codex recon) | bug, hub, P0 | Phase 0 — Foundation |
| 0 | `#SO-204` | bug(hub): WO wizard step 1 button labeled "Save" despite 3-step flow | bug, hub, P1 | Phase 0 — Foundation |
| 0 | `#SO-211` | feat(ops): stranger end-to-end smoke test gating deploys | testing, infra, P0 | Phase 0 — Foundation |
| 0 | `#SO-003` | ops: fix mike@factorylm.com MX so outbound delivers | infra, sales, P0 | Phase 0 — Foundation |

That's 26 new issues. (Above I said 22 — I miscounted; it's 26. Six SEO/GEO + 10 design-system + 4 surface refactors + 3 Hub bugs + 1 stranger test + 1 MX + 1 limitations.)

Folded into existing issues (DON'T create):
- `#SO-104` pricing 3-tier → expanded scope of #657, #659, #661
- `#SO-112` pricing JSON-LD → already #661
- `#SO-111`, `#SO-117`, `#SO-130` (homepage Org schema, canonical tags, brand sameAs) → fold into `#SO-301` head-partial
- `#SO-220`, `#SO-225` Hub Asset hero + chat → already #562, #574

---

## Part 3 — Re-prioritized backlog (the master list)

Existing issues + 26 net-new, in execution order. **The numbers will shift** when GitHub assigns IDs to the new issues; the script in Part 5 prints assigned IDs. Below uses the `#SO-*` references for the new ones.

### Top of queue — must finish W1 (Apr 26 → May 03)

```
P0 outage     #653  eval 57/57 failures — restore pipeline
P0 security   #604  auth-sweep tenant isolation
P0 security   #615  /api/register rate limit + CORS
P0 security   #616  zero security headers
P0 infra      #602  npm deps + lockfile
P0 infra      #603  Doppler env vars
P0 ops        #607  migration deploy-order
P0 ops        #SO-003  fix mike@factorylm.com MX
P0 hub-bug    #SO-200  /hub/assets redirect
P0 hub-bug    #SO-203  /hub/usage load error
P0 design     #SO-300  tokens.css
P0 design     #SO-301  head partial
P0 testing    #SO-211  stranger smoke test
```

### W2 (May 04-09) — design system + cmms

```
B-wave components in parallel:
  #SO-302 button
  #SO-303 state pill
  #SO-304 trust band
  #SO-305 compare grid
  #SO-306 stop card
  #SO-307 price card
  #SO-308 limits list
  #SO-309 sun toggle
P0 surface     #SO-070 cmms magic-link (extends #658)
P0 plg         #574    asset-scoped chat (Hub Direction A core)
P1 hub-bug     #SO-204 WO wizard "Save" rename
P1 brand       #619    naming inconsistency — close via PR
P1 perf        #621    lucide unpkg → self-host (in flight per recent commits)
P1 seo         #SO-110 fault-code schema markup
P1 seo         #SO-114 llms.txt
P1 seo         #SO-113 robots.txt AI allowlist
```

### W3 (May 10-16) — surfaces

```
#SO-100  homepage rewrite (lands all components above)
#SO-104  pricing 3-tier (closes #657, #659, #661)
#SO-005  /limitations page
#SO-103  /vs-chatgpt-projects page
#SO-118  fault-code internal linking
#SO-128  weekly LLM-citation probe begin
#576     outbound webhooks dispatcher (P0 hub)
#605     wire #576 into every event source
```

### W4-W5 (May 17-30) — Public inbound + first comparison content

```
#587  Magic inbox deploy (Unit 3 followup) — open the public manual@ inbox
#532-#534  Google Drive connector (already in flight by codex sibling)
#568  ISO 14224 failure code taxonomy (feeds fault-code SEO)
#577  Public API reference site (GEO feeder)
```

### W6-W8 (Jun 01-21) — Pillars + content factory

```
#562  Hub asset hierarchy (Direction A)
#571  Sensor reports per asset
#566  PM procedures with safety
#574  (continued) Asset-scoped chat polish
```

### W9-W13 (Jun 22-Jul 26) — Compound + Direction B/C

```
#565  WO 7-state lifecycle
#576  webhooks (continued)
#570  external-events ingest
#575  mobile PWA
```

### Defer to Q3 / Q4 2026 (label `defer-q3-2026`)

```
#579  SSO SAML + OIDC
#580  SOC 2 Type 1
#564  hub component template catalog
#567  maintenance-strategies model
#569  FFT vibration peak detection
#572  inventory module
#573  purchasing module
#581  open-source mira-safety-guard
#578  subdomain multi-tenancy
#470  BytePlus Seedance API
```

### Close

```
#440  qr-onboarding skill — already shipped on codex branch
#525  eval 57 failures (dup of #653)
#596  eval 57/57 (dup of #653)
#597  cowork eval 0/57 (dup of #653)
PR #608  comic-pipeline (out of scope; close PR with note)
```

---

## Part 4 — Sequencing for Claude Code

Group PRs to minimize merge conflicts and let Claude Code work issues that build on each other. **Each PR closes one or more issues. Each PR is sized for one Claude Code session.** Ordering respects dependencies.

### Day 1 — Foundation (CAN PARALLELIZE these 4 PRs)

| PR ref | Branch | Issues closed | Effort | Notes |
|---|---|---|---|---|
| PR-A1 | `feat/web-tokens-css` | `#SO-300` | 1 hr | Single new file |
| PR-A2 | `feat/web-head-partial` | `#SO-301` (folds in #111, #117, #130) | 2 hr | Refactors `<head>` across 4 pages |
| PR-A3 | `chore/web-robots-allowlist` | `#SO-113` | 30 min | Single file edit |
| PR-A4 | `feat/web-llms-txt` | `#SO-114` | 4 hr | Two new public files + sitemap update |

### Day 2-3 — Components (CAN PARALLELIZE 4 at a time; each is a single session)

PRs B1-B8 each close one issue, each modifies the same shared file `mira-web/public/_components.css` and `mira-web/src/lib/components.ts`. Risk of merge conflicts — recommend sequence in pairs:

```
Pair 1 (Day 2 AM): B1 .fl-btn (#SO-302), B3 .fl-trust-band (#SO-304)
Pair 2 (Day 2 PM): B2 .fl-state (#SO-303), B5 .fl-stop-card (#SO-306)
Pair 3 (Day 3 AM): B4 .fl-compare (#SO-305), B7 .fl-limits (#SO-308)
Pair 4 (Day 3 PM): B6 .fl-price-card (#SO-307), B8 sun-toggle (#SO-309)
```

### Day 4 — Marketing surfaces (3 in parallel, each big PR)

| PR ref | Branch | Issues closed | Effort |
|---|---|---|---|
| PR-C1 | `feat/web-homepage-refresh` | `#SO-100` + closes #619 | 3 hr |
| PR-C2 | `feat/web-cmms-magic-link` | `#SO-070` + closes #658 | 4 hr |
| PR-C3 | `feat/web-pricing-3tier` | `#SO-104` + closes #657, #659, #661 | 2 hr |

### Day 5 — Two more surfaces + SEO

| PR ref | Branch | Issues closed | Effort |
|---|---|---|---|
| PR-C4 | `feat/web-limitations-page` | `#SO-005` | 1.5 hr |
| PR-C5 | `feat/web-vs-chatgpt-projects` | `#SO-103` | 3 hr |
| PR-D1 | `feat/web-fault-code-schema` | `#SO-110` | 1 day |

### Days 6-7 — Hub bugs + tests

| PR ref | Branch | Issues closed | Effort |
|---|---|---|---|
| PR-H1 | `fix/hub-assets-redirect` | `#SO-200` | 4 hr |
| PR-H2 | `fix/hub-usage-load-error` | `#SO-203` | 4 hr |
| PR-H3 | `fix/hub-wo-wizard-button` | `#SO-204` | 30 min |
| PR-T1 | `feat/ops-stranger-smoke` | `#SO-211` | 1 day |

### Day 8+ — Carry-forward (existing P0/P1 issues)

These are the existing GH issues that should land NEXT, in priority order. Claude Code or Mike picks them up after Day 7:

```
#574  Hub asset-scoped chat (P0, factory-ai-parity)
#576  Outbound webhooks (P0)
#562  Hub asset hierarchy (P1)
#587  Magic inbox deploy
#566  PM procedures w/ safety
#577  Public API reference site
#568  ISO 14224 failure code taxonomy
#571  Sensor reports per-asset
#605  Wire #576 into events
```

---

## Part 5 — The bash script

Save as `scripts/align_and_create_issues.sh` and run on a node where `gh auth status` is good (Bravo or Charlie). The script is **idempotent** — it only creates issues that don't exist (checks by title prefix) and only updates labels on existing issues that are missing them.

```bash
#!/usr/bin/env bash
# Aligns Mikecranesync/MIRA to the FactoryLM × MIRA 90-day roadmap.
#
# What this does:
#   1) Creates net-new issues from the roadmap that don't yet exist
#   2) Adds labels + milestones to existing issues that need re-prioritization
#   3) Marks deferred issues with `defer-q3-2026`
#   4) Comments + closes duplicate eval issues (#525, #596, #597)
#
# Run order:
#   gh auth status   # verify
#   bash scripts/align_and_create_issues.sh

set -euo pipefail
REPO="Mikecranesync/MIRA"
MILESTONE_P0="Phase 0 — Foundation"

# --- Ensure labels exist ---
declare -a LABELS=(
  "design-system:#A78BFA"
  "seo:#10B981"
  "geo:#06B6D4"
  "hub:#F59E0B"
  "defer-q3-2026:#94A3B8"
  "marketing-content:#00897B"
  "factorylm-mira:#1B365D"
)
for entry in "${LABELS[@]}"; do
  name="${entry%%:*}"; color="${entry##*:}"
  gh label create "$name" --color "${color#\#}" --repo "$REPO" 2>/dev/null || true
done

# --- Ensure milestone exists ---
gh api "repos/$REPO/milestones" -f title="$MILESTONE_P0" \
  -f description="W1 — stabilize Hub, ship landing fixes, lay SEO+GEO foundation, restore eval pipeline." \
  -f due_on="2026-05-03T23:59:59Z" 2>/dev/null || true

# --- create_issue: idempotent — checks by exact title match ---
create_issue() {
  local title="$1"; local body="$2"; local labels="$3"; local milestone="$4"
  local existing
  existing=$(gh issue list --repo "$REPO" --state open --search "\"$title\" in:title" --json number --jq ".[0].number" 2>/dev/null || echo "")
  if [ -n "$existing" ]; then
    echo "SKIP — exists as #$existing: $title"
    return
  fi
  echo "CREATE — $title"
  if [ -n "$milestone" ]; then
    gh issue create --repo "$REPO" --title "$title" --body "$body" \
      --label "$labels" --milestone "$milestone"
  else
    gh issue create --repo "$REPO" --title "$title" --body "$body" \
      --label "$labels"
  fi
}

# --- Net-new issues (Wave A + B foundation) ---
create_issue \
  "feat(web): canonical design tokens — public/_tokens.css" \
  "Roadmap ref: #SO-300. See docs/design-system-2026-04-26.md §2 and docs/design-handoff-2026-04-26.md #SO-300 for full spec." \
  "enhancement,design-system,factorylm-mira" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): shared <head> partial with SEO + canonical + JSON-LD slot" \
  "Roadmap ref: #SO-301. Folds in homepage Org schema, canonical tags, brand sameAs. See docs/design-handoff-2026-04-26.md #SO-301." \
  "enhancement,design-system,seo,factorylm-mira" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-btn button component (primary, ghost, mic)" \
  "Roadmap ref: #SO-302. See docs/design-system-2026-04-26.md §3.1." \
  "enhancement,design-system" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-state four-state pill (Indexed / Partial / Failed / Superseded)" \
  "Roadmap ref: #SO-303. The brand-promise made visual. See docs/design-system-2026-04-26.md §3.2." \
  "enhancement,design-system,factorylm-mira" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-trust-band homepage trust strip" \
  "Roadmap ref: #SO-304. Codex recon's #1 homepage gap. See docs/design-system-2026-04-26.md §3.13." \
  "enhancement,design-system,plg-funnel" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-compare side-by-side grid (vs-pages + homepage)" \
  "Roadmap ref: #SO-305. Powers /vs-chatgpt-projects and homepage feature strip. See docs/design-system-2026-04-26.md §3.12." \
  "enhancement,design-system,marketing-content" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-stop-card safety interrupt component" \
  "Roadmap ref: #SO-306. See docs/design-system-2026-04-26.md §3.4. Used wherever safety keywords fire." \
  "enhancement,design-system,safety" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-price-card (3 variants — free, recommended, premium)" \
  "Roadmap ref: #SO-307. Three-tier pricing (\$0/\$97/\$497). See docs/design-system-2026-04-26.md §3.14." \
  "enhancement,design-system,plg-funnel" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): .fl-limits honesty list component" \
  "Roadmap ref: #SO-308. Powers /limitations. See docs/design-system-2026-04-26.md §3.15." \
  "enhancement,design-system,marketing-content" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): sun-readable mode toggle + localStorage persist" \
  "Roadmap ref: #SO-309. See docs/design-system-2026-04-26.md §2.2 + handoff #SO-309." \
  "enhancement,design-system,factorylm-mira" \
  "$MILESTONE_P0"

# --- Surface refactors ---
create_issue \
  "feat(web): homepage refactor — L1 message + trust band + 3-card row + compareBlock" \
  "Roadmap ref: #SO-100. Closes #619 (naming inconsistency). See docs/design-handoff-2026-04-26.md #SO-100. Depends on #SO-300, 301, 302, 303, 304, 305, 306, 309." \
  "enhancement,plg-funnel,P0,factorylm-mira" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): /cmms magic-link entry — replace beta form (extends #658)" \
  "Roadmap ref: #SO-070. Codex recon's top conversion fix. See docs/design-handoff-2026-04-26.md #SO-070." \
  "enhancement,plg-funnel,P0" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): /limitations page (honest 'what we don't do yet')" \
  "Roadmap ref: #SO-005. Brand-promise extension. See docs/design-handoff-2026-04-26.md #SO-005." \
  "enhancement,marketing-content,P1,factorylm-mira" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): /vs-chatgpt-projects comparison page" \
  "Roadmap ref: #SO-103. Lift from prototype X-tab. See docs/design-handoff-2026-04-26.md #SO-103." \
  "enhancement,marketing-content,seo,plg-funnel" \
  "$MILESTONE_P0"

# --- SEO + GEO ---
create_issue \
  "feat(web): schema.org TroubleshootingGuide + FAQ + HowTo on fault-code pages" \
  "Roadmap ref: #SO-110. Highest-impact SEO change in the roadmap. See docs/seo-geo-strategy-2026-04-26.md §1.4." \
  "enhancement,seo,P1" \
  "$MILESTONE_P0"

create_issue \
  "chore(web): robots.txt — explicit AI-crawler allowlist + scraper deny" \
  "Roadmap ref: #SO-113. See docs/seo-geo-strategy-2026-04-26.md §2.2." \
  "seo,geo,P1" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): /llms.txt + /llms-full.txt (GEO foundation)" \
  "Roadmap ref: #SO-114. See docs/seo-geo-strategy-2026-04-26.md §2.4." \
  "enhancement,seo,geo,P1" \
  "$MILESTONE_P0"

create_issue \
  "ops: submit factorylm.com to Bing Webmaster + Brave Search Console" \
  "Roadmap ref: #SO-115. Bing powers ChatGPT/Copilot retrieval; Brave powers Perplexity. See docs/seo-geo-strategy-2026-04-26.md §2.3." \
  "seo,geo,P2,infra" \
  "$MILESTONE_P0"

create_issue \
  "ops: verify Google Search Console + submit sitemap" \
  "Roadmap ref: #SO-116." \
  "seo,P1,infra" \
  "$MILESTONE_P0"

create_issue \
  "feat(web): internal-link every fault-code page to 3 siblings + index + /projects" \
  "Roadmap ref: #SO-118. Boosts crawlability + page authority + conversion path." \
  "seo,enhancement,P2" \
  "$MILESTONE_P0"

create_issue \
  "docs(geo): weekly LLM-citation probe (wiki/geo-probe.md)" \
  "Roadmap ref: #SO-128. See docs/seo-geo-strategy-2026-04-26.md §2.9. Manual ritual; ~30 min/week." \
  "geo,docs,P2" \
  "$MILESTONE_P0"

# --- Hub bugs (codex recon) ---
create_issue \
  "bug(hub): /hub/assets redirects to login from a signed-in page" \
  "Roadmap ref: #SO-200. Found by codex recon 2026-04-25. See docs/recon/factory-ai-hub-2026-04-25/recon-notes.md." \
  "bug,hub,P0" \
  "$MILESTONE_P0"

create_issue \
  "bug(hub): /hub/usage browser load error after reload" \
  "Roadmap ref: #SO-203. Found by codex recon 2026-04-25." \
  "bug,hub,P0" \
  "$MILESTONE_P0"

create_issue \
  "bug(hub): WO wizard step 1 button labeled 'Save' despite 3-step flow" \
  "Roadmap ref: #SO-204. Found by codex recon 2026-04-25." \
  "bug,hub,P1" \
  "$MILESTONE_P0"

# --- Stranger smoke + ops ---
create_issue \
  "feat(ops): stranger end-to-end smoke test gating deploys" \
  "Roadmap ref: #SO-211. Throwaway gmail → register → Stripe test → activation email → first chat in <10 min. Should run in CI on every push to main." \
  "testing,infra,P0" \
  "$MILESTONE_P0"

create_issue \
  "ops: fix mike@factorylm.com MX so outbound delivers (Apr 24 bounce)" \
  "Roadmap ref: #SO-003. Without this, every outbound from a factorylm.com sender fails. Critical for sticker drop, investor email, Markus/Thomas re-pitch." \
  "infra,sales,P0" \
  "$MILESTONE_P0"

# --- Defer Q3/Q4 — label only, do not close ---
echo ""
echo "=== DEFERRING Q3/Q4 issues ==="
for n in 579 580 470 581 564 567 569 572 573 578; do
  gh issue edit "$n" --repo "$REPO" --add-label "defer-q3-2026" 2>/dev/null \
    && echo "  defer-q3-2026 → #$n" \
    || echo "  (skip #$n — already labeled or doesn't exist)"
done

# --- Close duplicates of #653 ---
echo ""
echo "=== CLOSING eval duplicates (#525, #596, #597) ==="
for n in 525 596 597; do
  gh issue comment "$n" --repo "$REPO" \
    --body "Closing as duplicate of #653 — same root cause (pipeline-wide outage post-PR-#610 cascade or Doppler env). Tracking the fix on #653." 2>/dev/null \
    && gh issue close "$n" --repo "$REPO" --reason "not planned" 2>/dev/null \
    && echo "  closed #$n" \
    || echo "  (skip #$n — may already be closed)"
done

# --- Close #440 — qr-onboarding skill already shipped ---
echo ""
echo "=== CLOSING shipped issues ==="
gh issue comment 440 --repo "$REPO" \
  --body "Closing — skill shipped on \`codex/repo-sync-baseline\` branch in commit f26b527. See \`.agents/skills/qr-onboarding/SKILL.md\`." 2>/dev/null \
  && gh issue close 440 --repo "$REPO" --reason "completed" 2>/dev/null \
  && echo "  closed #440" \
  || echo "  (skip #440)"

echo ""
echo "DONE. Verify with:"
echo "  gh issue list --repo $REPO --milestone \"$MILESTONE_P0\" --state open"
echo "  gh issue list --repo $REPO --label \"defer-q3-2026\""
```

---

## Part 6 — How to use this on Monday

1. **Run the script once** on Bravo or Charlie:
   ```bash
   cd ~/Mira    # or wherever the local checkout lives
   bash scripts/align_and_create_issues.sh
   ```
   That creates the 26 net-new issues, deferred-labels the 10 out-of-scope ones, closes the 4 duplicates/shipped.

2. **Open the milestone view** in GitHub: https://github.com/Mikecranesync/MIRA/milestones — confirm "Phase 0 — Foundation" has ~40-45 open issues (the 26 new + 14 existing in flight).

3. **Hand the milestone to Claude Code** (or Cowork in code mode). Tell it: "Work the Phase 0 milestone in priority order following the PR sequence in `docs/gh-alignment-2026-04-26.md` Part 4. Open one PR per issue. Close the issue from the PR description."

4. **Friday review** — pull `gh issue list --milestone "Phase 0 — Foundation" --state closed` to see what shipped. Update `wiki/hot.md`. Iterate.

---

## Part 7 — One-glance summary

| Action | Count |
|---|---|
| Existing issues mapped to roadmap | 67 |
| Existing issues to defer (label only) | 10 |
| Existing issues to close (dups/shipped) | 4 |
| Existing PRs in flight (let them merge) | 7 |
| Net-new issues to create | 26 |
| **Total Phase 0 milestone size after script** | **~45** |
| Estimated Claude Code sessions to clear Phase 0 | **~25** (1-4 hrs each) |
| Calendar weeks to clear Phase 0 at 1 session/day | **~5 weeks** |
| At 2 sessions/day | **~2.5 weeks** |

Mike, you don't have a planning problem. You have a sequencing problem. The list above is the sequence.
