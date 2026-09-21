# Staging Hub Root 404 Fix

**Issue:** #3936 (P0)
**PR:** (to be created)
**Fixed:** 2026-09-21
**Affects:** Staging Hub (`app-staging.factorylm.com`)

## Problem

Opening `https://app-staging.factorylm.com/` resulted in a 404 after the auth redirect:
1. User navigates to staging hub root
2. Next.js redirects to `/login` (via middleware)
3. After successful auth, redirects back to `/hub/`
4. `/hub/` doesn't exist on staging → 404

## Root Cause

The `redirects()` function in `mira-hub/next.config.ts` (lines 100-102) was **unconditionally** redirecting `/` → `/hub/`:

```typescript
async redirects() {
  return [{ source: "/", destination: "/hub/", basePath: false, permanent: false }];
},
```

This redirect worked in production because:
- Production nginx handles the root redirect (`location = / { return 301 /feed/; }`)
- The request never reaches Next.js
- The redirect never fires

But on staging:
- Nginx proxies all requests to the hub (no special root handling)
- The Next.js redirect fires
- Staging is built with `NEXT_PUBLIC_BASE_PATH=""` (empty)
- `/hub/` doesn't exist → 404

## Solution

Made the redirect conditional on `basePath`:

```typescript
async redirects() {
  if (basePath === "/hub") {
    return [{ source: "/", destination: "/hub/", basePath: false, permanent: false }];
  }
  return [];
},
```

When `basePath=""` (staging), the redirect doesn't apply. The middleware handles auth redirects, and authenticated users land on valid routes.

## Files Changed

1. **mira-hub/next.config.ts** — Made redirect conditional on basePath
2. **mira-hub/tests/e2e/basepath-redirect.spec.ts** — E2E regression test
3. **mira-hub/tests/unit/next-config-redirects.test.ts** — Unit test for redirect logic

## Production Safety

**Production behavior is preserved** because:

1. **Production nginx still owns the root redirect:**
   - `nginx-app-factorylm.conf` line 30-32: `location = / { return 301 /feed/; }`
   - The Next.js redirect never fires in production (nginx handles it first)

2. **Production basePath is also empty:**
   - After Phase 2 (2026-04-27), production runs with `basePath=""`
   - The conditional check `if (basePath === "/hub")` evaluates to `false`
   - So production behavior is identical to staging: nginx handles root, Next.js doesn't redirect

3. **Legacy `/hub/*` bookmarks still work:**
   - nginx handles them: `location ^~ /hub/ { rewrite ^/hub/(.*)$ /$1 permanent; }`
   - Production users with old bookmarks get redirected at nginx level

## Verification Steps

### Staging (after deploy)

**Bare root entry:**
```bash
curl -I https://app-staging.factorylm.com/
```
- Should NOT return 404
- Should redirect to `/login` (302/307) or land on a valid hub page
- Should NOT redirect to `/hub/`

**Signed-out flow:**
1. Open `https://app-staging.factorylm.com/` in incognito
2. Should redirect to `/login`
3. Should see the login form (not 404)

**Signed-in flow:**
1. Sign in to staging hub
2. Navigate to `https://app-staging.factorylm.com/`
3. Should land on a valid hub page (e.g., `/feed/` or `/namespace`)
4. Should NOT see 404

**Existing routes still work:**
- `/feed/` — work order feed
- `/v3/` — chat interface
- `/namespace` — namespace builder
- `/knowledge` — knowledge library
- `/login` — sign-in page

**Web → Hub handoff:**
- Navigate to `https://staging.factorylm.com` (mira-web)
- Click "Open Hub" or any link to the hub
- Should stay on `app-staging.factorylm.com` domain
- Should NOT 404

**Verify SHA matches approved RC:**
```bash
# On VPS after deploy
docker inspect stg-mira-hub --format '{{index .Config.Labels "git.commit"}}'
# Should match the post-merge SHA (40-char hex)
```

### Production (unchanged)

**Verify no behavior change:**
```bash
curl -I https://app.factorylm.com/
```
- Should redirect to `/feed/` (nginx-level redirect)
- Should NOT return 404

**Legacy `/hub/` bookmarks:**
```bash
curl -I https://app.factorylm.com/hub/
```
- Should redirect to `/` and then to `/feed/`
- Should NOT return 404

**Existing routes still work:**
- All current production routes should be unaffected
- nginx routing unchanged
- Hub app logic unchanged (only the unused redirect was removed)

## Test Coverage

1. **E2E:** `mira-hub/tests/e2e/basepath-redirect.spec.ts`
   - Verifies staging root doesn't redirect to `/hub/`
   - Verifies `/hub/` 404s on staging (expected)
   - Verifies production root still works

2. **E2E:** `mira-hub/tests/e2e/staging-verification.spec.ts` (existing)
   - Already tests root → /login redirect
   - Validates login form renders

3. **Unit:** `mira-hub/tests/unit/next-config-redirects.test.ts`
   - Tests redirect logic for both basePath values
   - Documents expected behavior

## Rollback Plan

If this breaks staging (unlikely) or production (should be impossible):

1. Revert the commit
2. Rebuild the hub container with the old config
3. Redeploy staging
4. Root cause: the redirect logic change didn't account for some edge case

The fix is minimal and well-scoped. The redirect was already unused in production (nginx handles it), so removing it from the staging code path has zero prod risk.

## Related Issues

- #3936 — Original staging 404 report
- Phase 2 migration (2026-04-27) — When production moved to basePath=""

## Notes

- The redirect was added for "bare-domain friendliness when the hub fronts the whole host" (tailscale serve / phone testing)
- That use case is handled by middleware auth redirects in the empty-basePath world
- The `/` → `/hub/` redirect is now truly dead code and could be removed entirely in a future cleanup
- For now, kept it conditional to preserve any hypothetical edge cases in local dev
