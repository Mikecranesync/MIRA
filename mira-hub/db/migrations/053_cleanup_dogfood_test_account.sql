-- Migration 053: remove the throwaway dogfood test account.
--
-- During verification of PR #1977 (dogfood-report fixes), a Playwright probe of
-- the public signup flow on prod created a real account when an in-test request
-- interceptor failed to match the trailing-slash URL. The account is inert
-- (fake @example.com, trial, no data) but should not linger in prod.
--
-- Scope is deliberately MINIMAL and FK-safe: delete only the `hub_users` row by
-- email. `hub_users` is the child of `hub_tenants` (hub_users.tenant_id
-- REFERENCES hub_tenants(id)), so deleting the user is always safe — no FK can
-- block it. The now-orphaned `hub_tenants` row (a tenant with zero users) is
-- unreachable: nothing can authenticate into it and it surfaces nowhere. We
-- leave it rather than risk a blind cross-table delete on prod-only rows we
-- cannot inspect from a code session (no prod psql per docs/environments.md).
--
-- Idempotent: re-running is a no-op once the row is gone. Safe on dev/staging,
-- where the account does not exist (it was created on prod) — the DELETE simply
-- matches zero rows.
--
-- Issue: #1977 (verification side effect cleanup)

BEGIN;

DELETE FROM hub_users
 WHERE email_lower = LOWER('dogfood-probe-20260615@example.com');

COMMIT;
