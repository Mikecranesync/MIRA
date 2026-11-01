# Synthetic signup investigation — 2026-11-01

Base: `31c8e324c00bfe330d5e528466689d9babe7b2c2` (`origin/main`). Service investigation was read-only.

## Confirmed evidence

- Gmail search `subject:"New FactoryLM pilot application" after:1793404800 before:1793577600`, both pages exhausted: **141 delivered messages**, latest November 1 10:21:45 UTC. October 31: 89 Beta Gate and 10 Stranger Walk; November 1: 42 Beta Gate. All match exact harness address formats. No genuine applicants were identified in this result set; other subjects and missing messages are outside this census.
- [November 1 09:11:04 UTC example](https://mail.google.com/mail/u/?authuser=mike%40cranesync.com#all/1a1966073d1a80a1): `betagate-1793524261387@factorylm.com`, Beta Gate Stranger, delivered to the real owner. Headers show DKIM selector `resend` for factorylm.com; body matches the current owner notification template.
- [October 31 22:51:25 UTC warning](https://mail.google.com/mail/u/?authuser=mike%40cranesync.com#all/1a194291f399f4ed) explicitly reports 80% of 100 daily emails for team cranesync. **81 matching synthetic notifications preceded the warning that UTC day.** The warning is legitimate operational mail. It does not establish 100% exhaustion or identify the counted sends.
- Doppler `factorylm/stg` and `factorylm/prd` currently hold identical nonempty values for `HUBSPOT_API_KEY`, and likewise `RESEND_API_KEY`. Comparison printed only read-success/configured/equality booleans; no values or fingerprints were persisted. This verifies configuration sources, not running containers.
- Resend's read-only sent-email listing returned HTTP 401 `restricted_api_key`: the configured key is send-only. Provider send history and rejected-send evidence were unavailable.
- FactoryLM HubSpot portal 245594539 still contains **843** contacts matching firstname `Beta` AND lastname `Gate Stranger`; latest creation is September 27 22:31:31.225 UTC. [Latest matching contact](https://app.hubspot.com/contacts/245594539/record/0-1/559622683353?utm_source=app_12360546_mcp&utm_medium=ai_agent&utm_campaign=search). Separate email-token searches for `betagate-*` OR `strangerwalk-*` created since October 1 returned total 0. This does not establish that every other synthetic naming convention is absent.
- GitHub returned **46** Beta Gate runs created October 31, all pull-request events. [Example run](https://github.com/Mikecranesync/MIRA/actions/runs/41254333047). A run may provision multiple lanes or fail before registration; run counts are not email counts.

## Current paths

1. `mira-hub/scripts/provision-beta-gate.ts` generates `betagate-<timestamp>@factorylm.com`, name Beta Gate Stranger, and registers over HTTP. `.github/workflows/beta-gate.yml` starts a local Hub via Doppler using the staging environment, then provisions upload and notebook lanes. Docker Compose environment omissions do not restrict this process.
2. `mira-hub/tests/stranger-walk/walk.spec.ts` generates `strangerwalk-<sanitized-run-id>@factorylm.com`, using real signup. Its staging helper rejects any base other than app-staging.factorylm.com.
3. Register creates the user and tenant under the normal approval policy, invokes HubSpot capture when a key is present, then invokes the application funnel.
4. The funnel stores attribution in `pilot_applications`, captures PostHog telemetry if configured, and emails the owner through Resend when approval is required. No synthetic guard existed. Cleaning database fixtures cannot unsend email or remove external CRM records.
5. [#4893](https://github.com/Mikecranesync/MIRA/pull/4893) added owner notifications and staging forwarding; [#4900](https://github.com/Mikecranesync/MIRA/pull/4900) added production forwarding. [#4970](https://github.com/Mikecranesync/MIRA/pull/4970), merged October 31, forwards HubSpot to production Compose only. Current staging Compose omits HubSpot but forwards Resend. CI still inherits staging's HubSpot key. Exact deployed configuration and a per-message initiating-run join were not inspected.
6. [#4928](https://github.com/Mikecranesync/MIRA/pull/4928) and the Stranger Walk correction recorded on [#5046](https://github.com/Mikecranesync/MIRA/issues/5046) release their own pending fixture to a one-day user trial with tenant pilot status NULL, never active. Signup alone consumes no cohort slot; the five-org count counts active tenants. This investigation has not established that any real pilot slot was consumed by tests.

## Assessment

**Confirmed:** synthetic registrations send unnecessary real-owner notifications; current CI code can attempt CRM writes using the shared staging key. **Strong inference:** these sends contribute to the shared Resend allowance. **Unresolved:** exact quota accounting, exhaustion, lost legitimate messages, deployed credential values and why recent synthetic CRM contacts are absent.

[#4427](https://github.com/Mikecranesync/MIRA/issues/4427) remains open: shared credentials persist, but resumed recent CRM inflow is not established. Staging Compose's omission mitigates one path without isolating CI.

## Bounded fix and review requirements

One narrow classifier recognizes the two reserved harness formats on factorylm.com, with case/whitespace normalization. It excludes those identities from CRM capture and application persistence/telemetry/email. Cohort approval checks the stored owner's email and returns 409 for a harness identity. No display-name heuristics or caller-supplied test flags suppress applicants. Ordinary registration and approval gates remain intact; harness release and retrieval coverage are unchanged.

This protects the two evidenced harness families, not every possible test account. Existing CRM contacts, application rows and telemetry are untouched. New fixture conventions need explicit classifier review and tests.

Before merge, require exact-head independent review and CI. No merge or deployment is authorized by this report.

## Follow-up

- Separately isolate staging/CI credentials: HubSpot sandbox or no CRM write key; Resend test transport or separate test team. Routing mail to another real inbox on the same quota does not isolate allowance use. Credential changes require owner approval.
- Obtain read access to Resend send history to reconcile the quota window, sending key/team and rejected sends. Do not claim legitimate mail loss without that evidence.
- Inspect deployed environment and CI HubSpot responses/scopes before closing #4427. Avoid creating additional live signups solely for investigation.
- After approved rollout, observe existing test runs for absent synthetic notifications/CRM writes. Legitimate applicant behavior is checked with mocks; any live probe needs a separately approved plan.

## Local validation

- Regression check before the fix: six failures exposed synthetic CRM writes, funnel persistence and missing cohort refusal; 83 existing cases passed.
- Current lockfile installed in the isolated worktree; nine focused/neighboring suites: **126 passed**.
- ESLint on all changed TypeScript files: passed. Production `npm run build`: passed.
- Standalone `tsc --noEmit`: 77 diagnostics on both candidate and a clean checkout of the exact base, at the same locations/codes. No changed-file diagnostics; three messages only reorder the same Request/URL union. This is not a clean repository-wide standalone typecheck.
- No live signup probe or database integration suite was run. Mocked service/transaction tests validate the isolation behavior; a real rollout remains subject to review and approval.
