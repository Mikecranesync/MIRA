# Synthetic (test / QA / probe) accounts — lifecycle runbook

**Tracking:** #4696. **Why it exists:** on 2026-10-24 prod held 94 accounts, about 45 of them
synthetic and 55 lapsed trials. The long-lived prod QA probe account had silently lapsed,
so every prod behavioural probe tested the `/upgrade` page instead of the product (#4676).

Agents create, use and retire test accounts. A human only signs off on deletions in prod.

## The three kinds of synthetic account

| Kind | Examples | Lives | Who renews / retires it |
|---|---|---|---|
| **Long-lived QA** | Doppler `BETA_PROBE_QA*_EMAIL`, `SYNTHETIC_*_EMAIL` (prd) | indefinitely | Must be `approved`, never `trial`. The **census** alerts if one is not. |
| **Disposable prod verification** | `notebook-qa-*`, `notebook-live-*`, `adversarial-*@factorylm.com` | days | `qa-cleanup.yml` (manual dispatch, dry-run first) |
| **Staging strangers / e2e** | beta-gate stranger, `e2e-*`, `playwright*` | one run | `mira-hub/scripts/provision-beta-gate.ts --cleanup <tenant>` in the same job |

## Daily census — `.github/workflows/qa-accounts-census.yml`

- Runs daily at 11:17 UTC against prod, **read-only**:
  - the session is forced read-only;
  - the job first proves a write is refused, and stops if it is not.
- Finds long-lived accounts **by Doppler key name**, so a new probe credential is enrolled automatically.
- Healthy means the Hub gate (`mira-hub/src/middleware.ts` `gateRedirect`) lets the account in with nothing
  to expire: status is not `pending`, `trial` or `expired`.
- Any other state opens or updates **one** issue: *"QA account census: a long-lived prod test account
  needs attention"*. The issue names the Doppler key, never the email. It closes itself once all
  accounts are healthy.
- The step summary also prints synthetic-account **counts** by class and state, and how many the cleanup
  selector covers. Counts only: real customer emails never reach a log.
- Manual run: `gh workflow run qa-accounts-census.yml -f target=prod` (or `staging`).

**Fixing an alert:** set the account to `approved` on `/admin/users` (tick "show system accounts").
Then sign the probe in again: status is baked into the session token, so an old token keeps the old status.

## Traps (learned 2026-10-23/24)

- **Prod self-serve signup creates a HubSpot lead** (`captureHubSpotLead`). Never script prod signups. Long-lived
  prod accounts are created once, by a human, and stored in Doppler `factorylm/prd`.
- **A login outlives its account.** Hub sessions are stateless JWTs, and a deleted account's token still
  worked on staging. Per-user revocation is #4665.
- **Approve/Revoke on `/admin/users` was broken on prod** because the button posted to a hard-coded
  `/hub/api` (#4698). Until that fix deploys, change status with a console
  `fetch('/api/admin/users/<id>/', {method:'PATCH', …})`.
- **psql jobs need `ubuntu-24.04`**: `ubuntu-26.04` has no `postgresql-client-16` (#4697).

## What is still a human decision

- Widening `tools/qa/cleanup_qa_tenants.sql` to the classes the census shows are uncovered. That is a separate
  PR with security review, sized from real census counts.
- Every `qa-cleanup.yml` run with `mode=apply` against prod.
