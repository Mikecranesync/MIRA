# Security Policy

## Reporting a vulnerability

- **Intake channel:** open a GitHub Security Advisory draft on this repository ("Report a vulnerability" under
  the Security tab). If that is unavailable, open an issue titled `security: <short description>` **without**
  exploit details and the owner will move it to a private advisory.
- **Triage owner:** the repository owner (Mike, `@Mikecranesync`). Automated agents working in this repository
  do not triage or close security reports.
- **Response expectation:** acknowledgement within 3 business days; an initial assessment (confirmed /
  not reproducible / out of scope) within 10 business days. Fixes ship through the normal gates as
  `Risk: R3 — security` pull requests (`docs/architecture/mira-sdlc-v1.md` §2, §4.3), with an exact-head
  independent review before merge; a production-degrading issue follows the hotfix path (§10.1).
- **Please do not** test against `factorylm.com` / `app.factorylm.com` production tenants you do not own,
  exfiltrate data, or run denial-of-service traffic. Staging is not public.

## Supported versions

The commit currently serving production — the `gitSha` reported by the production `/api/health` endpoint,
identified by its `v*` tag on `main` — is the only supported version. A production receipt existed when it
was deployed (receipts are retained 90 days; support does not lapse when the artifact expires). Older tags
are rollback addresses, not supported releases.

## Scope notes

- Secrets are Doppler-managed (`factorylm/{dev,stg,prd}`); a secret found in git history is a report even
  if it is believed rotated.
- Tenant isolation (`knowledge_entries` read/write filters, RLS, session tenancy) and safety-banner behaviour
  are in scope for reports; see `.claude/rules/security-boundaries.md` and
  `.claude/rules/knowledge-entries-tenant-scoping.md` for the intended boundaries.
- Repository security features (secret scanning, push protection, Dependabot alerts) are being enabled under
  SDLC v1 Part B step 8; `docs/architecture/mira-sdlc-v1.md` §11.2 records the current state.
