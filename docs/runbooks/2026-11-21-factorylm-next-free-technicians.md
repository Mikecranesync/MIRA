# FactoryLM next site and verified free technician access

Mike retained **free for technicians** on November 21, 2026. This is prepared source, not a deployment or approval of every product claim.

## Account and workspace policy

`MIRA_FREE_TECHNICIANS=true` enables approved, non-expiring personal workspaces. Each technician can create their own one-person workspace with no credit card. Team workspaces and plant pilots are separately arranged. The durable `hub_tenants.signup_offer` marker enforces the personal boundary at invite creation and redemption, including after the flag is off. Existing paid/trial/pilot tenants keep their controls.

Free password registration is rejected. A new free workspace requires a consumed, single-use email token or a verified Google identity; the canonical signup adapter offers only configured providers. Missing email configuration returns 503 and never creates/logs a bearer link or claims delivery. Email requests are rate limited. An address owner's verified claim clears a legacy unproven password and increments a protected `hub_users.credential_epoch`. Credentials carry the epoch at authentication time; session refresh and protected requests reject stale epochs. User preferences cannot reset it. Existing account access terms are not promoted by the claim.

Two additive fields are installed by the existing idempotent auth schema initializer: `hub_users.credential_epoch INTEGER NOT NULL DEFAULT 0` and `hub_tenants.signup_offer TEXT`. No production schema change or account migration was run. Old rows retain their status, plan and expiry.

Plant applications use `/signup/?intent=pilot`. With pilot approval enabled, the bounded adapter submits explicit pilot intent, creates a pending tenant and records the existing pilot application event. It offers no Google button that could lose that intent. An existing account holder can email Mike directly from that screen to request a separately reviewed pilot without changing their personal workspace. If pilot intake is unavailable, the screen offers that contact path instead of creating a free workspace as a substitute. Keep the existing global pilot flag intact.

## Public website

Start free and Sign in go directly to MIRA; the website collects no account details or simulates signup success. The no-store public signup-policy contract drives the current offer. The canonical `/free-technicians` policy is available when free signup is enabled, even before the marketing cutover. It links to the preserved full Terms and Privacy Policy. Legacy Terms is byte-identical and has no new markup dependency.

`FACTORYLM_MARKETING_NEXT=true` enables the eight-page/seven-asset public adapter only alongside the free flag. Clean routes, canonical/share metadata and a supplemental sitemap are included. Private notices, draft policies and walkthrough files are excluded. API, app, policy/status, original sitemap, dynamic blog index and articles remain upstream. Staging account links follow the configured hub origin and staging pages receive noindex headers.

Rollout redirects use temporary 302 responses with `Cache-Control: no-store`. Demo requests open a reviewable email draft with optional context. Calendar availability opens the existing external Calendly page; no iframe/CSP change is needed. Earlier read-only calendar checks showed no November/December 2026 openings; availability and meetings were not changed.

## Build and qualification

In the private preview checkout, run `python3 build/build.py`, `python3 build/check.py`, `python3 build/release.py`, `python3 build/check_release.py`, then `python3 build/sync_mira.py --checkout /absolute/path/to/the/codex/MIRA/worktree`. Synchronization copies only the checked payload and never deploys.

Evidence and command details are under `docs/architecture/convergence/evidence/free-technicians-20261121/`. Local unit, real PostgreSQL, actual NextAuth/HTTP and browser checks qualify the prepared source. TypeScript retains existing baseline errors, and the locked framework reports an existing security advisory. Current-release product claims, actual delivered email, physical devices and legal approval remain separate gates.

## Reviewed activation order

1. Obtain exact-head/body native Codex review and required CI. Resolve the recorded framework, current-product and legal release gates.
2. Deploy the paired source to authorized staging through the existing release process, keeping marketing off. Confirm the two additive fields and existing pilot migrations are present. Enable the free flag consistently for web and hub while retaining the global pilot-approval value.
3. Verify both public policies, delivered email to an authorized test inbox, token consumption/replay, a new approved non-expiring personal session, stale credential/cookie revocation, personal invite denial, and an explicit pending pilot with its recorded application. Test paid and active pilot controls.
4. Enable marketing on staging. Check real account destinations, preserved full Terms and dynamic blog, external calendar, temporary redirects and same-profile rollback. Verify required current-release document/source claims separately.
5. Use the existing authorized production cutover process. This document grants no deploy, secret, DNS, production-account, paid or plant authority. No new hosting service or DNS connection is needed.

## Rollback

Turn marketing off to restore existing public rendering. Turn free signup off to stop issuing new personal free workspaces. Existing free accounts stay approved and non-expiring; their one-person boundary persists. Keep the credential-revocation fixes and additive fields in any rollback runtime: an older image that ignores credential epochs must not restore revoked sessions. Do not drop those fields or migrate account access during a flag rollback. Existing paid and pilot controls remain active.
