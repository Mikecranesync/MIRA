## Why
Factory AI: no SSO documented. Users get temp credentials via email (7-day expiry). This is a deal-blocker for enterprise. **Whoever ships SSO first wins a procurement tier.**

## Source
- https://docs.f7i.ai/docs/predict/user-guides/user-management
- `docs/competitors/factory-ai-leapfrog-plan.md` item in 60-day section

## Acceptance criteria
- [ ] OIDC via Auth.js (NextAuth) — ships Google/Microsoft/Okta/Auth0 out of the box
- [ ] SAML 2.0 via `@boxyhq/saml-jackson` (open-source, Apache 2.0) — compatible with Okta, Azure AD, Google Workspace
- [ ] Per-tenant IdP configuration stored encrypted in NeonDB
- [ ] SCIM 2.0 provisioning endpoint for user sync
- [ ] Role mapping from IdP groups → MIRA roles
- [ ] Fallback: local password auth still works (admin break-glass)
- [ ] Audit log: every login, role change, IdP config change

## Files
- `mira-hub/src/app/api/auth/[...nextauth]/route.ts`
- `mira-hub/src/app/api/auth/saml/**`
- `mira-hub/src/app/api/scim/**`
