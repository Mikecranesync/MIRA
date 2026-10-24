# Synthetic (test / QA / probe) accounts — lifecycle runbook

**Tracking:** #4696. **Why it exists:** on 2026-10-24 prod held 94 accounts, about 45 of them
synthetic and 55 lapsed trials. The long-lived prod QA probe account had silently lapsed,
so every prod behavioural probe tested the `/upgrade` page instead of the product (#4676).

Agents create, use and retire test accounts. A human only signs off on deletions in prod.

## The three kinds of synthetic account

| Kind | Examples | Lives | Who renews / retires it |
|---|---|---|---|
| **Long-lived QA** | Doppler `BETA_PROBE_QA*_EMAIL`, `SYNTHETIC_*_EMAIL` (prd) | indefinitely | Must be `approved`, never `trial`. The **census** alerts if one is not. |
| **Disposable / synthetic** | `notebook-qa-*`, `notebook-live-*`, `adversarial-*@factorylm.com`; `playwright`/`e2e`/`probe`/`stranger`/`test` on factorylm.com or a test domain; anything on `example.*`, `*.test`, `factorylm-test.com` | days | `qa-cleanup.yml` (manual dispatch, dry-run first). Skips a tenant when **any** user is real, long-lived (Doppler), verified-document-owning, or not on a no-plan trial. |
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
- **Approve/Revoke on `/admin/users` was broken on prod until 2026-10-24.** The button posted to a hard-coded
  `/hub/api` (#4698). It was fixed by #4702, deployed to prod in v3.417.13.
- **psql jobs need `ubuntu-24.04`**: `ubuntu-26.04` has no `postgresql-client-16` (#4697).

## What is still a human decision

- Every `qa-cleanup.yml` run with `mode=apply` against prod. Run a dry-run first and compare the counts.
  First prod apply: 2026-10-24, 45 tenants removed (run 40088089602). The next dry-run selected 0.
- Synthetic-looking accounts the cleanup deliberately skips: outside domains, mixed tenants, or verified documents.
  Review them on `/admin/users` with "show system accounts" ticked.
