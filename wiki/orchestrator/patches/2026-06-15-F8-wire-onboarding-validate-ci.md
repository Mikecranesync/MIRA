# F8 staged fix — wire the onboarding beta-gate into CI (COVERAGE-GAP, B-owned)

**Why (F8, 2026-06-15):** PR #1901 (`10eccc7d`) merged "onboarding upload→ask — beta-gate
close" — the stranger's first real experience on app.factorylm.com. But
`mira-hub/playwright.onboarding-validate.config.ts` (and `onboarding-walkthrough`,
`command-center`) still gate **0 workflows**. `smoke-test.yml` runs only
`playwright.smoke.config.ts` + `playwright.signup.config.ts`. So the freshly-closed
beta-gate ships with no regression gate — a silent break would reach the first beta tester.
KG: the onboarding/ask path anchors on `sessionOr401()` (god-node, degree 95) → high blast radius.

**This is a fix to ship via PR on a fresh branch off origin/main — NOT an in-place edit here.**

## Apply
1. `cd <repo> && git fetch origin && git checkout -b ci/gate-onboarding-validate origin/main`
2. In `.github/workflows/smoke-test.yml`, after the existing signup step
   (`npx playwright test --config playwright.signup.config.ts`) add:
   ```yaml
       - name: Onboarding upload→ask beta-gate (Playwright)
         working-directory: mira-hub
         run: npx playwright test --config playwright.onboarding-validate.config.ts
   ```
   Match the surrounding env / base-URL / `--frozen-lockfile bun install` setup of the signup step.

## Verify (must pass before PR)
- `cd mira-hub && npx playwright test --config playwright.onboarding-validate.config.ts` green locally
  against the staging URL (`stg.factorylm.com`, usable as of #2020).
- `actionlint .github/workflows/smoke-test.yml` clean.
- Confirm the step is INSIDE the deploy-blocking smoke job so a red gate blocks `deploy-vps.yml`.

## Notes
- Read the config first: it may need a seeded onboarding fixture / test tenant. If it requires
  prod data, gate it behind the staging base-URL only, never `@FactoryLM_Diagnose` / prod NeonDB.
- Leave `onboarding-walkthrough` + `command-center` configs for a follow-up; this patch closes
  the single most beta-critical path.
