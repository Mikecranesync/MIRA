# FactoryLM next site and free technician access

Owner decision: Mike retained **free for technicians** on November 21, 2026. This change is prepared source, not a deployment or approval of all product claims.

## Behavior

`MIRA_FREE_TECHNICIANS=true` makes new personal workspaces approved, with no trial expiry and plan `technician_free`. Existing users, paid tenants, expired trials, invitations, administrative roles and explicit plant-pilot requests retain their existing controls. No migration runs. Keep the global pilot-approval setting intact: a personal free workspace and a governed plant pilot are different signup intents.

The public, no-store `/api/public/signup-policy/` contract drives the signup offer label. The marketing site's Start free and Sign in actions go directly to MIRA's real account pages. Registration still uses work email and password; existing alternative sign-in methods remain available. The website collects no account details and simulates no signup success. A scoped paragraph in the existing Terms distinguishes new free accounts from separately ordered paid services.

`FACTORYLM_MARKETING_NEXT=true` activates the bounded public adapter only when the free-technician flag is also true. Eight generated public pages and seven assets live under `mira-web/src/factorylm-ui/marketing-next/`; source is the private factorylm-site-preview repository. The adapter preserves existing API, application, policy, status, legacy sitemap and blog-article routes. Existing policy content is not replaced by preview drafts. Staging signup links follow `PLG_HUB_URL` and receive noindex headers.

Demo requests use a reviewable email draft to Mike, with optional context. The existing Calendly event remains an alternative. Its November and December 2026 calendars showed no available times during browser review; no availability or meetings were changed.

## Rebuild and synchronize

From the private preview checkout, run `python3 build/build.py`, `python3 build/check.py`, `python3 build/release.py` and `python3 build/check_release.py`. Then run `python3 build/sync_mira.py --checkout /absolute/path/to/the/codex/MIRA/worktree` and review the generated adapter payload. This command copies only the checked release files; it does not deploy.

The release package removes the private preview notice and draft policies, creates clean routes and canonical/share metadata, excludes retired walkthrough assets, and retains indexing controls for 404. Old pricing/pilot URLs redirect to the demo request; article paths remain with the existing application.

## Qualification

The evidence directory is `docs/architecture/convergence/evidence/free-technicians-20261121/`. Local synthetic registration and an actual NextAuth credentials session proved an approved, non-expiring account and matching workspace. Disposable PostgreSQL integration covers persistence, old trials, explicit pilots, existing-account behavior and duplicate registration. Router tests cover opt-in activation, rollback, HEAD, staging, allowlisting and preserved paths.

Whole-project TypeScript checks have existing baseline failures; compare exact diagnostics rather than claiming a green typecheck. The locked Next.js CLI also reports an existing security advisory. This change does not upgrade framework dependencies or certify that advisory as resolved. Current-build document/source behavior, physical-phone acceptance and recorded product/legal review holds remain separate from marketing and signup tests.

## Reviewed activation order

1. Complete exact-head and exact-body native Codex review, required CI and the recorded framework/security and product/legal release gates.
2. Deploy the paired app and web source to staging through the existing release process. Enable `MIRA_FREE_TECHNICIANS=true` consistently for hub and web; preserve the existing pilot-approval value. Leave marketing off initially.
3. Verify `/api/public/signup-policy/` reports version 1, `free_technician`, no approval and null trial days. Qualify a new approved, non-expiring account and real session in the authorized staging environment.
4. Enable `FACTORYLM_MARKETING_NEXT=true` on staging; check real signup/login destinations, Terms scope, demo email draft and unchanged API/policy/article routes. Verify required current-release product claims separately.
5. Use the existing approved release/cutover process for production. This runbook does not authorize deployment, secret edits, production account creation, DNS or access changes. No new hosting service or DNS connection is needed.

## Rollback

Set `FACTORYLM_MARKETING_NEXT=false` to restore existing public pages. Set `MIRA_FREE_TECHNICIANS=false` to stop issuing new free workspaces and restore the prior signup policy for new accounts. Already-created free accounts remain approved and non-expiring; rollback must not revoke them or rewrite existing tenant rows. The two flags default to false. No schema rollback is necessary.
