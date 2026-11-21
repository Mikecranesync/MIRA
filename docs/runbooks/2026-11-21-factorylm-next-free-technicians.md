# FactoryLM next site and verified free technician access

Mike retained **free for technicians** on November 21, 2026. This is prepared source, not a deployment or approval of every product claim.

## Account and workspace policy

`MIRA_FREE_TECHNICIANS=true` enables approved, non-expiring personal workspaces. Each technician can create their own one-person workspace with no credit card. Team workspaces and plant pilots are separately arranged. The durable `hub_tenants.signup_offer` marker enforces the personal boundary at invite creation and redemption, including after the flag is off. Existing paid/trial/pilot tenants keep their controls.

New free and pilot workspaces require the canonical email-verification and agreement-confirmation flow. `POST /api/public/onboarding/` binds intent, agreement version and attribution to a purpose-scoped token. Opening the link shows a confirmation screen; it creates no account automatically. Token consumption, agreement validation and workspace creation share one transaction; a failed commit leaves the same token available for retry, and concurrent confirmations commit once. Confirmation persists the agreement version, sentence hash and timestamp. Ordinary login links and unknown Google identities cannot create a free/pilot workspace. Existing eligible identities keep their returning sign-in options. Missing email configuration returns 503; no bearer link is logged or delivery claimed. Public delivery responses and cooldowns are uniform for eligible and ineligible addresses; the UI makes no unconditional delivery claim. New email links carry their credential only in a URL fragment, captured and removed before confirmation, then submitted in a POST body. Valid requests are limited to five per recipient and 100 per network per hour, with remaining cooldown returned.

A verified email claim removes an unproven legacy password and increments protected `credential_epoch`. Password authentication, JWT refresh and protected requests reject stale epochs. A setup link never retires or recovers an existing account: an address that already holds a legacy pending pilot (or any other non-free account) is told to sign in or contact Mike, and its password, application and cohort eligibility are untouched until an operator decides. The `hub_onboarding_recoveries` table from 116/117 remains in the schema but nothing writes to it. Returning Google sign-in through an already-linked subject works over an unknown-provenance password without touching it. Paid/active/expired accounts are not silently promoted.

Apply `mira-hub/db/migrations/116_verified_personal_onboarding.sql` and `117_auth_schema_and_identity_provenance.sql` through the existing `apply-migrations.yml` dev-to-staging-to-production process **before deploying this runtime**, even while flags are off. 116 is immutable. Additive reconciliation 117 installs the complete original bootstrap auth contract, durable identity/credential provenance and recovery cascade semantics. Recovery audits exist for the lifetime of the linked accounts and are removed when any linked identity or tenant is deleted; the existing bounded QA cleanup remains authoritative. No auth traffic runs DDL. Health returns 503 when prerequisites are absent, and readiness can recover after migration without caching a rejected promise. The local test used a runtime role that cannot ALTER tables; migration reapplication passed twice. No shared/production schema or accounts were changed.

Plant applications use `/signup/?intent=pilot`, independently of the free flag. With approval intake on, verified setup creates a pending tenant and records the existing application. With intake off, only the contact path is offered. A concurrent personal-account winner cannot receive a false pilot application. Existing account holders can email Mike from that screen to arrange a separate reviewed pilot.

## Public website

Start free and Sign in go directly to MIRA; the website collects no account details or simulates signup success. The no-store public signup-policy contract drives the current offer. The canonical `/free-technicians` policy and its assets remain available with both rollout flags off. `MIRA_MARKETING_ORIGIN` gives the Hub an agreement link on its active environment, with separate production/staging defaults. It links to the preserved full Terms and Privacy Policy. Legacy Terms is byte-identical and has no new markup dependency.

`FACTORYLM_MARKETING_NEXT=true` enables the eight-page/seven-asset public adapter only alongside the free flag. Clean routes, canonical/share metadata and a supplemental sitemap are included. Private notices, draft policies and walkthrough files are excluded. API, app, policy/status, original sitemap, dynamic blog index and articles remain upstream. Staging account links follow the configured hub origin and staging pages receive noindex headers.

Rollout redirects use temporary 302 responses with `Cache-Control: no-store`. Demo requests open a reviewable email draft with optional context. Calendar availability opens the existing external Calendly page; no iframe/CSP change is needed. Earlier read-only calendar checks showed no November/December 2026 openings; availability and meetings were not changed.

## Build and qualification

In the private preview checkout, run `python3 build/build.py`, `python3 build/check.py`, `python3 build/release.py`, `python3 build/check_release.py`, then `python3 build/sync_mira.py --checkout /absolute/path/to/the/codex/MIRA/worktree`. Synchronization copies only the checked payload and never deploys.

Evidence and command details are under `docs/architecture/convergence/evidence/free-technicians-20261121/`. Local unit, real PostgreSQL, actual NextAuth/HTTP and browser checks qualify the prepared source. TypeScript retains existing baseline errors, and the locked framework reports an existing security advisory. Current-release product claims, actual delivered email, physical devices and legal approval remain separate gates.

## Reviewed activation order

1. Obtain exact-head/body native Codex review and required CI. Resolve the recorded framework, current-product and legal release gates.
2. Deploy the paired source to authorized staging through the existing release process, keeping marketing off. Apply migrations 116 and 117 through the governed migration workflow and verify readiness using the non-DDL runtime role. Enable the free flag consistently for web and hub while retaining the global pilot-approval value.
3. Verify environment-specific policy links and policy retention with signup closed, delivered email to an authorized test inbox, token consumption/replay, a new approved non-expiring personal session, stale credential/cookie revocation, personal invite denial, and an explicit pending pilot with its recorded application. Test paid and active pilot controls.
4. Enable marketing on staging. Check real account destinations, preserved full Terms and dynamic blog, external calendar, temporary redirects and same-profile rollback. Verify required current-release document/source claims separately.
5. Use the existing authorized production cutover process. This document grants no deploy, secret, DNS, production-account, paid or plant authority. No new hosting service or DNS connection is needed.

## Rollback

Turn marketing off to restore existing public rendering. Turn free signup off to stop issuing new personal free workspaces. Existing free accounts stay approved and non-expiring; their one-person boundary persists. Keep the credential-revocation fixes, purpose-bound onboarding, canonical policy and additive schema in any rollback runtime: an older image that ignores credential epochs must not restore revoked sessions. Do not drop those fields or migrate account access during a flag rollback. Existing paid and pilot controls remain active.
