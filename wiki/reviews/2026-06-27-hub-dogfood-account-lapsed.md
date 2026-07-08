# 2026-06-27 — Hub dogfood: blocked again (QA account lapsed)

**Goal:** test app.factorylm.com/hub, file issues for improvements.

## What happened
- `/hub` → `/login`. Per skill, checked #2013 (Hub access). It's marked **resolved**
  (durable account provisioned 2026-06-16) but left OPEN.
- Minted session via `qa-login-save-state.mjs` → reported `ok:true` BUT landed on
  `/login/` with a 401 and only 2 cookies (no session-token).
- Hand-login in browser with Doppler creds → **"Email or password is incorrect."**

## Findings (both NEW, pre-flight clean) → commented on #2013
1. **Durable QA account no longer authenticates.** Provisioned as a 7-day trial
   2026-06-16; today is day 11 → trial lapsed. "Durable" account isn't durable.
2. **`qa-login-save-state.mjs:43` prints `ok:true` unconditionally** — no
   session-token / URL check. False positive that masked the regression (the 4/4
   "verified" in #2013's resolve comment trusted this flag).

## Coverage
- Tested: login page only (unauthenticated). Found + commented on the dup-email
  validation residual on **#1956** (closed; sync fix works, dual error renders).
- **NOT tested:** any authenticated Hub surface (feed, work orders, assets,
  command-center, knowledge, ask-MIRA) — no working login. No coverage claimed.

## Evidence
`dogfood-output/qa-runs/2013-recheck-2026-06-27/finding.md`; live snapshots;
cookie dump (2 cookies, no session-token); 401 on auth POST.

## Next
Human: renew/make-durable the QA tenant + harden the helper to fail loudly. Then
re-run the full Hub customer journey.
- Filed **#2331** \u2014 credentialed persona spec (6 roles + platform-admin + 2nd-tenant); cross-linked from #2013. Seed script seeds all personas as owner = matrix not exercised.
