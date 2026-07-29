# MIRA Outside-In QA Runbook (for the Hermes desktop agent)

This directory configures the **Hermes desktop agent** (v0.16.0, profile `default`)
to run as an outside-in product QA agent — a maintenance-manager persona that tests
the real user-facing surfaces and files evidence-backed GitHub issues.

> **Audience:** Hermes (and any human driving a QA pass). Hermes's own browser
> toolset does most of this directly. The Playwright scripts here are a **fallback
> for the two things Hermes cannot do**: upload a file through a web form, and
> capture network requests.

---

## What Hermes can and cannot do (capability matrix, verified 2026-06-12)

| Capability | Hermes browser toolset | Use the fallback? |
|---|---|---|
| Navigate, click, type, scroll, press | ✅ `browser_navigate` etc. | no |
| Accessibility snapshot (DOM tree) | ✅ `browser_snapshot` | no |
| Screenshot | ✅ `browser_screenshot` | no |
| Console messages / page errors | ✅ `browser_console` | no |
| **Upload a file via a form** | ❌ **none** (no `setInputFiles`) | **yes → `upload_manual_smoke.mjs`** |
| **Capture network requests / failures** | ❌ **none** (CDP backend dep not met) | **yes → `capture_console_network.mjs`** |
| Vision / image analysis of a page | ✅ `browser_vision` | no |

Backend: `engine: auto` → local **Camoufox** (Playwright Firefox). `browser-cdp` is
disabled (system dependency not met), which is why network capture is unavailable.

### Resetting a stuck browser session

Hermes browser sessions self-recover, but a page that throws a JS **dialog**
(`confirm`/`beforeunload`) blocks until answered (`dialog_policy: must_respond`,
300 s timeout) — this is the usual cause of a "hang after a namespace refresh".
To reset:

1. In Hermes: call `browser_dialog` to answer/dismiss, or `browser_close` to drop
   the session; the next `browser_navigate` opens a fresh one.
2. Inactivity auto-closes the session after `browser.inactivity_timeout` (120 s).
3. Playwright fallback is **stateless** — every script run launches and closes its
   own browser, so there is nothing to reset.

Do **not** run `hermes doctor --fix` / `hermes setup` / config migrations to "fix"
the browser. The desktop agent is working; a config migration is the most likely
way to break it.

---

## Start an outside-in pass

1. **Targets** (production):
   - Marketing: <https://factorylm.com>
   - App / Command Center: <https://app.factorylm.com>
   - Staging/dev: only if explicitly configured (none wired by default).
2. **Persona:** a maintenance manager evaluating MIRA for the first time. Sign up
   fresh, build a namespace/asset, upload a manual, ask a troubleshooting question,
   judge whether you get a **grounded, cited** answer. The beta gate is: *a stranger
   uploads their own manual and gets a cited answer with no manual fix.*
3. **Evidence dir:** save everything under
   `dogfood-output/<persona>-<timestamp>/` (notes) and
   `dogfood-output/qa-runs/<script>-<timestamp>/` (script artifacts).
4. **File issues** only with evidence (screenshot + console/network + repro steps).

## Authenticated access — legacy single-account path

The original #2013 path used one owner-level production account. Keep this path
only as a backwards-compatible smoke check: #2331 supersedes it for real QA
because an owner bypasses the RBAC matrix, and #2013 recorded that the old
trial-backed account lapsed. Credentials, if renewed, live in **Doppler
`factorylm/dev`** (the approved secret path — never in git, never in an issue):

| Doppler key | What it is |
|---|---|
| `HERMES_QA_EMAIL` | `hermes-qa-maint@example.com` (legacy owner smoke account) |
| `HERMES_QA_PASSWORD` | password login (no OTP/magic-link needed) |
| `HERMES_QA_NAME` | display name `Hermes QA Maintenance Manager` |

Mint a fresh authenticated session (writes `dogfood-output/.auth/app-state.json`):

```bash
doppler run --project factorylm --config dev -- bash -c \
  'node dogfood-output/qa-login-save-state.mjs "$HERMES_QA_EMAIL" "$HERMES_QA_PASSWORD"'
```

`ok: true` with a `landed` URL under `/feed|/namespace|/hub|/onboarding` means the
session is saved; the Playwright fallback scripts (and Hermes via the saved cookies)
reuse it. If the account lapses or the password is wrong, the helper exits non-zero
instead of writing a false `ok:true`.

Fresh throwaway `*@example.com` signups are still fine for ad hoc multi-tenant /
isolation checks, but the seeded #2331 role matrix below is the preferred path for
repeatable edge testing.

## RBAC matrix accounts for edge testing (#2331)

The single durable owner account proves only the happy path. For real Hub QA, seed
the synthetic tenant and store one password per role in Doppler `factorylm/dev`.
`mira-hub/scripts/seed-synthetic-users.ts` now creates deterministic logins for
all tenant roles, plus a second-tenant login for isolation probes:

| Email | Tenant role | Doppler/env password key | Proves |
|---|---|---|---|
| `carlos@synthetic.test` | `technician` | `SYNTHETIC_CARLOS_PASSWORD` | Work-order create/edit allowed; asset create, WO delete, reports, team denied. |
| `dana@synthetic.test` | `manager` | `SYNTHETIC_DANA_PASSWORD` | Asset/WO/report buyer workflow. |
| `scheduler@synthetic.test` | `scheduler` | `SYNTHETIC_SCHEDULER_PASSWORD` | Schedule CRUD + reports; denied asset/WO mutation. |
| `operator@synthetic.test` | `operator` | `SYNTHETIC_OPERATOR_PASSWORD` | Most-restricted list/show/request path. |
| `plantmgr@synthetic.test` | `admin` | `SYNTHETIC_PLANTMGR_PASSWORD` | Tenant team CRUD and admin workspace UX. |
| `cfo@synthetic.test` | `owner` | `SYNTHETIC_CFO_PASSWORD` | Owner bypass baseline. |
| `isolation@synthetic.test` | `technician` in a different tenant | `SYNTHETIC_ISOLATION_PASSWORD` | Cross-tenant/RLS leakage probes. |

The seeder is idempotent and updates `role` on conflict, so re-running repairs
older all-owner rows from pre-#2331 seeds.

```bash
doppler run --project factorylm --config dev -- \
  bun run mira-hub/scripts/seed-synthetic-users.ts
```

The Playwright auth helper is deliberately strict: `ok: true` means the saved
state contains a `next-auth.session-token` / `__Secure-next-auth.session-token`
cookie and the browser is no longer on `/login`. A bad password, lapsed account,
or 401 exits non-zero so Hermes cannot silently proceed unauthenticated.

**Platform admin is human-owned:** platform-staff access is keyed off the
platform allowlist/status, not the tenant role. Create or elevate that account
through the approved prod config/DB path, then store its password in Doppler;
do not model it by changing a tenant role in the synthetic seed.

## Find duplicates before filing (required)

```bash
gh issue list -R Mikecranesync/MIRA --state all --search "<key terms>" --limit 10
```

Search **open AND closed** — a finding may already be triaged or fixed.
`create_issue.sh` does this for you.

> Real example from 2026-06-12: a "Mike Harper · Admin on a fresh feed" finding
> already existed as **#1904**; a second copy was filed as **#1906**. Always run
> the dedupe search and prefer **commenting on the existing issue** over a new one.

## Create a labeled issue

```bash
tools/qa/create_issue.sh \
  --title "P1(hub): <surface> <symptom>" \
  --body-file dogfood-output/qa-runs/<run>/finding.md \
  --labels "bug,P1,hub,needs-triage" \
  --dry-run        # drop --dry-run to actually create
```

Common labels: `bug`, `security`, `severity:P0..P3` (or `P0..P3`), `hub`,
`needs-triage`, `ready-for-agent`, `ready-for-human`, `beta-readiness`.
Body should contain: surface/URL, environment, steps to reproduce, expected vs
actual, evidence (paths to screenshot + console/network JSON), severity rationale.

To comment on an existing issue instead:

```bash
gh issue comment -R Mikecranesync/MIRA <number> --body-file dogfood-output/qa-runs/<run>/finding.md
```

---

## Playwright fallback scripts

Reuse the Playwright install in `mira-hub/node_modules` — nothing new is installed.
Run from the repo root.

```bash
# 1) Smoke a public page: title + screenshot + console errors
node tools/qa/qa_browser_smoke.mjs https://factorylm.com/

# 2) Full console + network evidence for one page load
node tools/qa/capture_console_network.mjs https://app.factorylm.com/

# 3) Manual-upload smoke (needs auth — see below)
node tools/qa/upload_manual_smoke.mjs --login https://app.factorylm.com/   # one-time
node tools/qa/upload_manual_smoke.mjs \
  --url 'https://app.factorylm.com/<upload-page>' \
  --input 'input[type=file]' \
  --submit 'button:has-text("Upload")' \
  --pdf dogfood-output/samples/powerflex-fault-code-sample.pdf
```

Each run writes a timestamped dir under `dogfood-output/qa-runs/` with
`summary.json`, `console.json`, `network-*.json`, and `screenshot.png`.

### Uploading the sample PDF

Sample manual (synthetic, safe to upload anywhere):
`dogfood-output/samples/powerflex-fault-code-sample.pdf`
— contains `PowerFlex 525`, `F004 UnderVoltage`, `F005 OverVoltage`,
"Check incoming line voltage", "Verify DC bus", and a lockout/tagout safety line,
so you can verify ingestion → retrieval → citation end to end.

Upload path A (preferred): use the app's own UI in Hermes' browser, then verify
retrieval by asking MIRA a `F004`/`F005`/PowerFlex 525 question and checking the
answer cites the manual. **Hermes cannot click the OS file picker** — when you hit
the file `<input>`, hand off to `upload_manual_smoke.mjs` (it has auth state and
`setInputFiles`).

Auth state is saved to `dogfood-output/.auth/app-state.json` — **this is a secret
(session cookies); it is gitignored. Never commit it, never paste it into an issue.**

---

## Safety rules (non-negotiable)

- **No real payments.** Stripe is in test mode (#1831); never run a real checkout.
- **No real customer data.** Use throwaway signups (`*@example.com`) and the
  synthetic sample PDF only. Nothing copyrighted or private.
- **No destructive deletes.** Don't delete tenants/assets/data you didn't create,
  and never delete production data.
- **No repo mutations / pushes / commits** without explicit human approval.
- **Evidence-only issues.** Every issue carries a screenshot + console/network +
  repro steps. No "trust me" findings.
- **Leave Hermes config alone.** No `doctor --fix`, no `setup`, no `approvals.mode`
  change. `smart` is verified sufficient for read-only `gh`, `curl`, `mkdir`,
  report-writing, and browser QA.
- **Read-only product.** MIRA is read-only troubleshooting intelligence in beta —
  QA never attempts control writes to any PLC/HMI.

## Files in this directory

| File | Purpose |
|---|---|
| `lib.mjs` | Shared Playwright loader + run-dir + console/network instrumentation |
| `qa_browser_smoke.mjs` | Public-page smoke: title + screenshot + console errors |
| `capture_console_network.mjs` | Full console + network-request evidence for one load |
| `upload_manual_smoke.mjs` | Parameterized manual-upload template (needs saved auth state) |
| `create_issue.sh` | Dedupe-first GitHub issue creator (`Mikecranesync/MIRA`) |
| `README.md` | This runbook |
