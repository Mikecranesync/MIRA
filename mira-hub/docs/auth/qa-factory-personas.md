# QA Factory Personas

This runbook provisions the production-safe synthetic factory used by
`tests/e2e/synthetic-day.spec.ts`.

Do not run `scripts/seed-synthetic-users.ts` against production. That seed uses
hardcoded weak credentials and `@synthetic.test` emails for local/dev only.

## 1. Choose Persona Credentials

Create four strong passwords outside git and store/share them through the
operator-approved secret path. The Playwright spec reads these env vars:

```powershell
$env:SYNTHETIC_CARLOS_EMAIL = "qa+carlos@factorylm.com"
$env:SYNTHETIC_CARLOS_PASSWORD = "<strong-password>"
$env:SYNTHETIC_DANA_EMAIL = "qa+dana@factorylm.com"
$env:SYNTHETIC_DANA_PASSWORD = "<strong-password>"
$env:SYNTHETIC_PLANTMGR_EMAIL = "qa+plantmgr@factorylm.com"
$env:SYNTHETIC_PLANTMGR_PASSWORD = "<strong-password>"
$env:SYNTHETIC_CFO_EMAIL = "qa+cfo@factorylm.com"
$env:SYNTHETIC_CFO_PASSWORD = "<strong-password>"
```

Passwords must be at least 16 characters. Production refuses `@synthetic.test`
addresses and the local `SynthTest2026!` password.

## 2. Dry-Run Provisioning

Run this first. It connects to the target database through Doppler, starts a
transaction, validates the target users/data, and rolls back.

```bash
doppler run --project factorylm --config prd -- \
  bun run qa:factory:provision
```

Expected ending:

```text
[qa-factory] DRY RUN: transaction will be rolled back
[qa-factory] dry-run complete; rolled back
```

## 3. Apply Provisioning

Only after the dry-run is clean:

```bash
QA_FACTORY_APPLY=1 \
QA_FACTORY_CONFIRM=PROVISION_QA_FACTORY_PROD \
doppler run --project factorylm --config prd -- \
  bun run qa:factory:provision
```

Expected ending:

```text
[qa-factory] applied
```

## 4. Run The Persona Suite

```bash
HUB_URL=https://app.factorylm.com \
SYNTHETIC_USERS_ENABLED=1 \
npx playwright test tests/e2e/synthetic-day.spec.ts --project=chromium
```

Expected result after provisioning:

```text
23 passed
```

If the suite fails with `Synthetic persona login failed`, the account exists with
the wrong password, is missing, or is not approved for the target tenant.
