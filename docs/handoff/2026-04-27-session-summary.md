# Session Handoff — 2026-04-27

## What Was Shipped

All work is on **`claude/frosty-swirles-f4ce2a`** → PR #767 (targeting `feat/hub-741-login-gate`).
All items deployed to production VPS (`prod` / 100.68.120.99) via `docker-compose.saas.yml`.

### Security + P0/P1 fixes (all CLOSED)
| Issue | Fix | Commit |
|-------|-----|--------|
| #616 | nginx HSTS, CSP, X-Frame, X-XSS, Referrer-Policy | `05de2d3` |
| #615 | Rate limit 5/hr/IP + CORS allowlist on /api/register | `d92465d` |
| #620 | favicon.svg + Next.js metadata wired | `408848d` |
| #588 | /api/me endpoint; sidebar shows real NeonDB user | `40148c3` |
| #658 | /cmms H1 → "FactoryLM Works Setup" (no duplicate H1) | `63734d9` |

### Features shipped
| Feature | Commits | Notes |
|---------|---------|-------|
| FactoryLM Works rebrand | `8ddc365` | Atlas CMMS → "FactoryLM Works" everywhere: hub, nginx sub_filter, all 4 locales |
| AI Reports | `0dbad60` | POST /api/reports/generate; Groq→Cerebras→Gemini cascade; narrative card on /reports |
| CMMS live stats | `d877639` | GET /api/cmms/stats; Atlas JWT auth (23h cache); real WO/asset/PM counts; Live badge + refresh |
| Stripe checkout | `e649848`, `5b3068c` | Direct Checkout, no upfront email; webhook creates tenant from customer_details.email |
| mira-web copy audit | `94ee5dd` | MIRA casing, dead links, broken tel href |

### Data persistence epic (CLOSED — issues #757, #758)
Completed on `feat/hub-741-login-gate` (separate branch):
- Phase 1: NextAuth → NeonDB (hub_users, hub_sessions, hub_accounts)
- Phase 2: tenant_id indexes, pm_schedules NOT NULL, preferences + slug columns
- Phase 3: RLS enforcement via `withTenantContext()` + `factorylm_app` role

## What's Deployed on VPS

Container `mira-hub` running commit `d877639`. Key routes live:
- `GET /api/me` — real user from NeonDB
- `GET /api/cmms/stats` — live Atlas data (needs ATLAS_API_USER/PASSWORD in env ✓)
- `POST /api/reports/generate` — AI narrative (needs GROQ_API_KEY ✓)
- `POST /api/checkout/session` → Stripe redirect (on mira-web)

All env vars confirmed in mira-hub process env (Doppler injected at deploy time):
`GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY`, `ATLAS_API_USER`, `ATLAS_API_PASSWORD`, `HUB_CMMS_API_URL`

## What Mike Needs to Do

### High priority
1. **Resend domain verification** — Magic link emails fail with 403 "domain not verified".
   Go to resend.com/domains → Add Domain → `factorylm.com` → add SPF + DKIM CNAMEs.
   Until done: magic link, welcome, activation emails all silently fail.

2. **Stripe test mode** — Issue #766 is still open. To test checkout:
   - Add `STRIPE_SECRET_KEY=sk_test_...` and `STRIPE_PRICE_ID=price_test_...` to Doppler
   - Rebuild mira-web
   - After QA, swap back to live keys

3. **PR #767** — Review and merge `claude/frosty-swirles-f4ce2a` → `feat/hub-741-login-gate`
4. **PR #748** — Review magic link + 7-day trial PR (also open)

### Lower priority
- #756: clean up wrong-namespace tag `mira-web-v0.2.0`
- Lead hunter HubSpot push blocked: `HUNTER_API_KEY` + `HUBSPOT_ACCESS_TOKEN` missing from Doppler

## Open PRs (as of session end)

| PR | Branch | Title | Action |
|----|--------|-------|--------|
| #767 | `claude/frosty-swirles-f4ce2a` | This session's work | **Merge when reviewed** |
| #748 | `bounty/1777253191` | Magic link + free trial | Review |
| #728 | `feat/wiki-raw-ingest` | Wiki auto-ingest pipeline | Review |
| #652 | `chore/gitignore-playwright-artifacts` | Gitignore playwright | Low-risk, merge |
| #646, #644, #643, #642 | `feat/mvp-unit-*` | MVP unit features | Backlog |
| #608 | `feat/comic-pipeline-openai-panels` | Comic pipeline | Backlog |

## Branch State

- **`main`** — 23+ commits behind `feat/hub-741-login-gate`. No tag since v1.x.
- **`feat/hub-741-login-gate`** — Active dev branch. 24 commits ahead of main. Unpushed: nothing (pushed after lead-hunter commit).
- **`claude/frosty-swirles-f4ce2a`** — This session's work. PR #767 open. Deployed but not merged.

**Version tag** — `mira-hub/v1.5.0` should be cut after PR #767 merges to feat and that branch merges to main.

## Next Priorities (from 90-day MVP plan)

1. Merge PR #767 → PR feat→main → tag `mira-hub/v1.5.0`
2. Fix Resend domain (email blocker)
3. Stripe test mode QA (#766)
4. PR #748 (magic link login) — critical for paid signup flow
5. Issue #689: stranger smoke test gating deploys
6. Issue #705: catch-up release tags + CHANGELOGs

## Quick Commands for Next Session

```bash
# Start from current state
cd /Users/charlienode/MIRA
git checkout feat/hub-741-login-gate
git pull

# Deploy after any hub change
git push origin feat/hub-741-login-gate
ssh prod "cd /opt/mira && git fetch origin && git reset --hard origin/feat/hub-741-login-gate && docker compose -f docker-compose.saas.yml build mira-hub && docker compose -f docker-compose.saas.yml up -d mira-hub"

# Check hub logs
ssh prod "docker logs mira-hub --tail 50"

# Doppler secrets
doppler secrets get GROQ_API_KEY --project factorylm --config prd --plain
```
