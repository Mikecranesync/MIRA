# Pilot-application funnel events (#4877)

Mike's decision: the Hub signup at `app.factorylm.com` **is** the free 30-day
pilot application. Ads use native Meta/Google lead forms — they are NOT part
of this repo. This doc covers the Hub-side plumbing: `mira-hub/src/capabilities/pilot-funnel.ts`.

## Event names and where each fires

| Event | Fires from | Status |
|---|---|---|
| `pilot_application_submitted` | `mira-hub/src/app/api/auth/register/route.ts`, via `handlePilotApplicationSubmitted` (`mira-hub/src/capabilities/pilot-funnel.ts`), after a NEW account is created | **Wired in this PR** |
| `pilot_approved` | `mira-hub/src/app/(hub)/api/admin/pilots/[tenantId]/approve/route.ts` (introduced by PR #4882) | Not wired — obvious single seam, next PR |
| `pilot_first_manual_uploaded` | `mira-hub/src/lib/node-knowledge-ingest.ts` or `mira-hub/src/app/api/documents/upload/route.ts`, gated on "is this the tenant's first `knowledge_entries` row" | Not wired — needs a "first" check added at that seam |
| `pilot_first_cited_answer` | `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` (or `/api/assets/[id]/chat`), gated on "first turn with a citation for this tenant" | Not wired — needs the same "first" check |
| `pilot_answer_rated` | the rating path inside `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` | Not wired — confirm the exact rating route before wiring |

Only `pilot_application_submitted` is wired by this PR. The event-name union
lives in `PILOT_FUNNEL_EVENTS` in `pilot-funnel.ts` so the next four have a
typed home to land in without renegotiating names.

## Owner notification

`notifyOwnerOfApplication` emails `PILOT_OWNER_EMAIL` (default
`mike@factorylm.com`) via Resend — same call shape as `sendInviteEmail` in
`mira-hub/src/app/api/team/route.ts`. It only fires when
`MIRA_PILOT_APPROVAL_REQUIRED=1`, so open-signup mode (the flag's default)
does not email Mike on every signup.

## Required Doppler keys

| Key | Project/config | Notes |
|---|---|---|
| `PLG_POSTHOG_KEY` | `factorylm/stg` then `factorylm/prd` | **Same env var name as `mira-web/src/lib/posthog-server.ts`** — one Doppler key serves both services. Mike sets this; staging first, then prod once the staging test-event checklist below passes. |
| `PLG_POSTHOG_HOST` | `factorylm/stg`, `factorylm/prd` | Optional. Defaults to `https://us.i.posthog.com`. Set to the EU ingest host if the PostHog project is EU-hosted. |
| `RESEND_API_KEY` | already set (used by `sendInviteEmail`) | No new key needed — this PR reuses it. |
| `PILOT_OWNER_EMAIL` | `factorylm/stg`, `factorylm/prd` | Optional. Defaults to `mike@factorylm.com` in code if unset. |
| `MIRA_PILOT_APPROVAL_REQUIRED` | `factorylm/stg`, `factorylm/prd` | Introduced by PR #4882; default off. Gates the owner email in this PR too. |

### ⚠️ Doppler alone is not enough — compose wiring is a separate, NOT-YET-DONE step

`docker-compose.saas.yml` and `docker-compose.staging-vps.yml` are **guarded
root-compose files** under `.claude/rules/factorylm-unified-ui-cutover.md`
(`tools/ui_surface_lifecycle_guard.py`), so this PR does not edit them. None
of `PLG_POSTHOG_KEY`, `PLG_POSTHOG_HOST`, `PILOT_OWNER_EMAIL`, or
`MIRA_PILOT_APPROVAL_REQUIRED` is forwarded into the `mira-hub` service's
`environment:` block in either compose file today — and neither is
`PLG_POSTHOG_KEY` for `mira-web`'s own existing server-side capture
(`mira-web/src/lib/posthog-server.ts`), which has the identical gap. This is
the exact "Doppler says one thing, the container reads its code default"
failure class `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml` was
written to catch (#3328).

**Before any staging test-event checklist below can pass, a separate guarded
compose PR must add these four lines to the `mira-hub` service's
`environment:` block** in `docker-compose.saas.yml` (and the `stg-mira-hub`
equivalent in `docker-compose.staging-vps.yml`):

```yaml
      - PLG_POSTHOG_KEY=${PLG_POSTHOG_KEY:-}
      - PLG_POSTHOG_HOST=${PLG_POSTHOG_HOST:-https://us.i.posthog.com}
      - PILOT_OWNER_EMAIL=${PILOT_OWNER_EMAIL:-mike@factorylm.com}
      - MIRA_PILOT_APPROVAL_REQUIRED=${MIRA_PILOT_APPROVAL_REQUIRED:-0}
```

Until that lands, setting the Doppler key alone does **nothing** — the
container still reads `undefined` for all four.

## Test-event checklist (staging, before any ads run)

Run this only after BOTH (a) the compose-wiring PR above has merged and
deployed to staging, and (b) `PLG_POSTHOG_KEY` is set in `factorylm/stg`.

1. `curl -s https://stg.app.factorylm.com/api/version` — confirm the deployed
   SHA includes this PR and the compose-wiring PR.
2. Register a brand-new account at the staging signup URL with a UTM query
   string, e.g. `https://stg.app.factorylm.com/signup?utm_source=test&utm_medium=checklist&utm_campaign=pilot-funnel-verify`.
3. In the PostHog project, confirm one `pilot_application_submitted` event
   landed with `distinct_id` equal to the new tenant id and
   `properties.utm_source == "test"`.
4. Query `pilot_applications` on staging (read-only `db-inspect.yml`, or
   `psql` against `factorylm/stg` — never prod) and confirm one row for that
   tenant with the same UTM values and `has_gclid=false`.
5. With `MIRA_PILOT_APPROVAL_REQUIRED=1` in `factorylm/stg`, repeat step 2 and
   confirm an email lands at `PILOT_OWNER_EMAIL` (or Mike's staging test inbox)
   with the applicant's email, name, tenant name, UTM fields, and the
   `POST /api/admin/pilots/<id>/approve` line as plain text (not a link).
6. Register the SAME email again (expect `409 account already exists`) and
   confirm NO second PostHog event, DB row, or email fired.
7. Only after 1–6 pass on staging: set `PLG_POSTHOG_KEY` (and the other three
   vars as needed) in `factorylm/prd`, confirm the prod compose deploy picked
   them up, and repeat steps 2–3 once against a disposable prod test account
   before turning on any ad spend.

## Known gaps (not fixed by this PR — see PR #4877 body)

- Google-OAuth and magic-link signups (`mira-hub/src/auth.ts`, which also
  calls `ensureUserAndTenant`) do not go through `/api/auth/register` and so
  get no attribution row, no event, and no owner email.
- `isPilotApprovalRequired()` is duplicated here from
  `mira-hub/src/capabilities/pilot-access.ts` (PR #4882, not yet on `main`).
  Consolidate once #4882 merges.
