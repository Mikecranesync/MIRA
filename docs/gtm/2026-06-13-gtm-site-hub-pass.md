# GTM pass — public site + Hub onboarding (2026-06-13)

Working-tree changes only. **No commit / push / deploy.** Scoped patch:
`docs/gtm/2026-06-13-gtm-site-hub-pass.patch`.

Strategic direction applied: position FactoryLM as the **maintenance knowledge
layer** (structure manuals/assets/fault-history/PLC-tags into a Maintenance
Intelligence Namespace; MIRA answers with citations), and make the funnel
**assessment-led** rather than self-serve-SaaS-led.

## Reality check (important)

The directive was a list of *desired end-states* written against an older
**deployed** build. The current code is materially more mature, so several items
were **already true** and several flagged "trust-breakers" **do not exist in
current source**. Per the no-fake-claims constraint, I fixed real gaps, left
already-correct surfaces alone, and did **not** fabricate fixes or claims for
things that aren't there. Specifics below.

## Changed files (8)

| File | Change |
|---|---|
| `mira-web/src/views/_topbar.ts` | Primary nav CTA `Get Started` → **`Book $500 Assessment`** (kept ghost `Sign in` → `/cmms`). |
| `mira-web/src/views/home.ts` | Hero rewrite (outcome-led H2/H3 + namespace as support); CTAs primary `Book $500 Assessment`→`/buy`, secondary `Try a sample MIRA answer`→`/quickstart`, foot `Already a customer? Sign in`; mobile-sticky → assessment; **new** `How it works` 6-step strip + `Who it's for` buyer-fit section + CSS. |
| `mira-web/src/views/security.ts` | **New** buyer-friendly "What matters, in plain terms" summary before the technical sections; CTA → `Book a $500 assessment`. Removed dead `btnGhost` import. |
| `mira-web/src/views/limitations.ts` | CTA → assessment-led. Removed dead `btnGhost` import. |
| `mira-web/public/buy.html` | Tier CTAs: `Book Assessment — $500`, **`Request pilot scope`**, **`Check plant fit`**, **`Talk enterprise deployment`**; added `See a sample report` + `What a pilot includes` links. |
| `mira-web/public/pricing.html` | Same tier-CTA relabel; added `#pilot-deliverables` (30/60/90) and `#sample-assessment` (report contents) stub sections; `See sample report` / `What a pilot includes` links. |
| `mira-web/src/views/__tests__/home.test.ts` | Re-baselined from the superseded "AI Workspace/Projects" design to the live assessment-led page + new CTA spine. |
| `mira-hub/src/app/signup/page.tsx` | Value copy ("Create your workspace to:" + 3 truthful bullets + "No credit card"); honest "Want to try first? Ask a sample question — no signup" → `/quickstart`. |
| `mira-hub/src/components/layout/sidebar.tsx` | **No change shipped** — see "Found bug (not fixed here)" below. An initial role-gating fix was reverted after verification showed it wouldn't solve the reported symptom and risked a regression. |

## Public-site summary

- **Assessment is now the single primary motion** end-to-end: topbar, home hero,
  home mobile-sticky, home pricing teaser (already), Security CTA, Limitations
  CTA, and all `buy.html` / `pricing.html` tier cards. No `Try MIRA Free` /
  `Try it free` / `free trial` CTAs remain (verified by grep).
- **Hero** leads with the concrete outcome ("Cited troubleshooting answers from
  your manuals, assets, and fault history" / "Without rebuilding your CMMS") and
  keeps "Maintenance Intelligence Namespace / AI-ready infrastructure" as support.
- **Added** a linear `How it works` strip (scan → bind → map → ask → cite → draft)
  and a `Who it's for` / `Not the right fit` buyer-fit block (links to Limitations).
- **Security** opens with 5 plain-English trust bullets before the technical detail.
- **Pilot 30/60/90** and **sample-report contents** scaffolded as concise factual
  sections (scope, not promised metrics) on `pricing.html`.
- Already present, left as-is: 68k-chunk + OEM trust band, the generic-AI-vs-MIRA
  PowerFlex F005 compare block, the assessment-first offer cards, the
  FactoryLM-vs-generic comparison table + "we integrate, don't replace" line, and
  the Limitations page (kept prominent).

## Hub / onboarding summary

- **Signup** now explains value truthfully and routes the "try first" path to the
  **real** public `/quickstart` (cite-or-refuse over the OEM corpus).
- **Onboarding wizard** already implements a clean Company→Site→Line→Review→Try-MIRA
  flow with PowerFlex-F0004 example asks — left as-is.
- **Admin/Review over-exposure — found, not fixed here** (see below).
- **Trust-breakers that did NOT exist in current source** (so nothing to "fix"):
  `MIRA_KB_BASE_URL not configured`, "monday context loading…", and
  "Grounded in OEM manual" while KB unconfigured — none appear in the codebase.
  The **Settings 404** is also absent: the "Settings" nav label maps to
  `/integrations`, a real route.

## Found bug (not fixed here) — Hub Admin/Review over-exposure

`mira-hub/src/app/(hub)/layout.tsx:23` hardcodes `<Sidebar role="admin" />`, so
the role gating in `providers/access-control.ts` (`NAV_ITEMS[].roles`) is defeated
for every user — everyone sees the Admin + Review-queue nav items, which then
403 at the API for non-privileged roles. This matches the flagged symptom.

I drafted a fix (gate on the real role from `/api/me`, which the sidebar already
fetches) but **reverted it** after verification, because:

1. `admin` → `["manager","admin","owner"]` and `admin-review` → `["admin","owner"]`
   both include **`owner`** — and the reported symptom is specifically "Review
   Queue appears **for Owner**, API 403." Gating on the real role would NOT change
   what an owner sees, so the reported symptom would survive.
2. `src/lib/auth/session.ts:52` hardcodes `role: "member" // TODO(#578): derive
   from hub_members.role column` — and `"member"` is not in the `Role` union. If
   `/api/me`'s `user.role` is similarly `"member"`/null/capitalized, gating on it
   would filter the sidebar to near-empty for **every** user. I could not
   runtime-verify the actual `user.role` value across roles.

**Recommended real fix (separate, verified PR):** (a) thread the session's role
into `(hub)/layout.tsx` instead of the `"admin"` literal; (b) resolve TODO #578 so
session role derives from `hub_members.role` as a clean lowercase `Role`; (c) align
nav `roles` with the API's actual authz so an `owner` who can't call
`/admin/review` doesn't see the link (or grant the API). Verify live with
technician/operator/owner accounts. This is authz, needs runtime verification, and
should not ride on a copy patch.

## No-fake-claims decisions

- **Did NOT** write "Sample data included" / "Sample Plant → Line 3 → PowerFlex
  525 → sample manual" for Hub signup. Verified: `mira-hub`'s register route
  seeds **no** sample plant (the `demo-data.ts` seeder lives in `mira-web`/Atlas,
  not the Hub). A new Hub tenant starts empty. The honest sample path is the
  public `/quickstart`, which is what the copy points to.
- Pilot/sample-report sections describe **service scope**, not customer outcomes.
- Comparison content names only the CMMS integrations already named elsewhere
  (MaintainX/Limble/UpKeep/Atlas); no invented competitor or customer claims.

## Tests / build (exact)

**mira-web** (`bun test`):
- Baseline (pre-change): **265 pass / 30 fail / 7 errors** (295 tests).
- After: **276 pass / 20 fail / 7 errors** (296 tests). Net **−10 failures, +11 pass, zero regressions.**
- The −10 came from re-baselining `home.test.ts` (8/18 → 19/19).
- Guard suites green: `topbar.test.ts` 23/0, `site-wide-topbar.test.ts` 56/0.
- Remaining 20 failures are **pre-existing, in files I did not touch**: `cmms.test.ts`
  ×4 (stale, same superseded-design rot as home — recommend re-baseline) + others.
- 7 errors are an environment issue: `@neondatabase/serverless` `Client` export
  mismatch (node_modules drift; resolves with `bun install`), unrelated to changes.

**mira-hub**:
- `npx eslint` on both changed files: **clean (exit 0).**
- `npx vitest run`: **339 tests passed, 0 failures.** 2 test *files* fail to load
  because they `import "bun:test"` under vitest (pre-existing harness mismatch,
  untouched files).
- `npx next build`: **exit 0 — "Compiled successfully".**

## Deferred (with reasons)

1. **Demo library page** — needs real recorded clips/GIFs I can't produce; the
   hero secondary already links to the live `/quickstart` demo. TODO noted.
2. **Downloadable sample assessment PDF** — `#sample-assessment` currently routes
   to an email CTA; replace with a redacted sample PDF once one exists (TODO in file).
3. **Standalone `/pilot` and `/compare` pages** — content scaffolded as sections
   on `pricing.html`; promote to full pages if/when a case study ships.
4. **Hub sample-plant seeder** — to honestly offer "choose Sample PowerFlex demo"
   as a pre-seeded tenant, the register/onboarding path would need to seed a
   Sample Plant → Line → PowerFlex asset + bound manual. Real feature, out of scope
   for a copy pass; flagged so it isn't faked.
5. **Admin/Review 403 — runtime cross-role verification.** The sidebar fix is
   correct by construction but should be confirmed live with a non-admin account
   (technician/operator) before relying on it.
6. **`cmms.test.ts` re-baseline** — 4 stale failures predate this work; left
   untouched (I didn't edit `cmms.ts`).
7. **CMMS/Review empty-state copy** — not audited this pass; bound to scope.

## Note on workspace

Edits were made in the shared `~/MIRA` checkout on branch
`feat/realtime-datapoint-clock` (unrelated in-flight branch). Per the no-commit
constraint, changes live in the working tree only; the scoped patch above is the
durable artifact if a peer session reverts uncommitted edits.

**Path note / resolution:** the goal specified `/Users/bravonode/Mira` (a BRAVO-node
path). This session ran on **CHARLIE** (`CharlieNodes-Mac-mini`, user `charlienode`),
where that path does not exist and BRAVO's filesystem is unreachable (Tailscale-only,
no mount). Work was done in the only MIRA checkout present here, `/Users/charlienode/MIRA`
(the same repository). The user reviewed the mismatch and chose **Accept CHARLIE work**.
The patch is path-relative and also applies on BRAVO via
`git apply docs/gtm/2026-06-13-gtm-site-hub-pass.patch` if desired.
