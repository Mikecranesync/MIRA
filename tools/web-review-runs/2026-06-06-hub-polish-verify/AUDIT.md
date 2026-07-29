# Hub Polish Sweep — Live Prod Audit (2026-06-06)

> Plan: `docs/plans/2026-06-06-hub-polish-sweep.md` task #7
> Target: `https://app.factorylm.com/hub`
> First baseline probe: 2026-06-07 02:18Z
> Post-merge re-probe: 2026-06-07 02:57Z–03:00Z

## Status per issue

| # | Issue | PR | Tag | Closed? | Deploy verify |
|---|---|---|---|---|---|
| #1761 | `/api/usage` KB Chunks tile = 0 | #1768 (merged `13565a83`) | `mira-hub/v2.1.1` | ✅ CLOSED | ⏳ needs authed probe (`/api/usage` allTime.totalKbChunks ≈ 83553) |
| #1762 | Sec headers + `/scan` CSP | #1771 (merged `07ac27dd`) | `mira-hub/v2.1.4` | ✅ CLOSED | ⚠️ **app-layer ✅; nginx-layer XFO=SAMEORIGIN blocker remains** |
| #1763 | `/scan` 412px overflow | #1770 (merged `5f5843b4`) | `mira-hub/v2.1.2` | ✅ CLOSED | ⏳ needs Playwright mobile viewport check |
| #1764 | Unauth `/api/*` → 401 JSON | #1769 (merged `a93f88cc`) | `mira-hub/v2.1.3` | ✅ CLOSED | ✅ **VERIFIED** (live probe below) |
| #1756 | Google OAuth | Mike-side (GCP Console URI add) | n/a | OPEN | Mike-blocked |
| #1765 | Command Center new-tab handoff | #1765 (merged `ec63b814`) | `mira-hub/v2.2.0` | ✅ MERGED | ✅ deploy 27081726006 success; `/api/health` 200; `/command-center` route resolves (307→login). Authed visual check pending Mike's browser. |

## Post-deploy probes (executed 2026-06-07 02:57Z–03:00Z)

### #1764 ✅ VERIFIED

```
$ curl -sI https://app.factorylm.com/api/usage/
HTTP/1.1 401 Unauthorized
Content-Type: application/json
content-security-policy: default-src 'self'; …; frame-ancestors 'self'
$ curl -s https://app.factorylm.com/api/usage/
{"error":"Unauthorized"}
```

Pre-fix returned `308 → 307 → 200 HTML login page`. Post-fix: clean 401 JSON. CSP attached.

### #1762 ⚠️ APP-LAYER ✅ / NGINX-LAYER ❌

App-layer (mira-hub middleware) post-deploy headers on a non-`/scan` 307 from the unauth gate:

```
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-frame-options: DENY
content-security-policy: …; frame-ancestors 'self'
```

But the FINAL `/scan/` 200 response shows nginx-layer headers winning:

```
$ curl -sIL https://app.factorylm.com/scan/
HTTP/1.1 200 OK
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: SAMEORIGIN          ← NGINX adds; overrides app's omission
```

**Remaining work for Mike — nginx config update on VPS:**

```nginx
# /etc/nginx/sites-available/app.factorylm.com — scope global add_header off /scan
location ~ ^/scan {
    add_header X-Frame-Options "" always;     # clear inherited SAMEORIGIN
    proxy_set_header ...
    proxy_pass http://mira-hub:3000;
}
```

Or simpler: delete the global `add_header X-Frame-Options SAMEORIGIN always;` line from the server block entirely — the new `applySecurityHeaders` helper in mira-hub already handles XFO correctly per-path.

Until this lands, monday.com iframe embedding of `/scan` will continue to be blocked by SAMEORIGIN regardless of the app-layer CSP `frame-ancestors`.

### #1761, #1763 ⏳ needs additional probes

- **#1761:** verify with authed probe — `curl -sL -b $JAR https://app.factorylm.com/api/usage | jq '.allTime.totalKbChunks'` should return ~83553 (was 0).
- **#1763:** verify with Playwright mobile (412×915) — `/scan` page no horizontal overflow (`scrollWidth - clientWidth <= 0`).

### #1756 — awaiting Mike

Exact `redirect_uri` posted in issue: `https://app.factorylm.com/api/auth/callback/google`.
OAuth Client: `246891599587-usbnoa7g6agveginmbb62rvi2p3rmb83.apps.googleusercontent.com`.
Add in GCP Console → APIs & Services → Credentials → that Client ID → Authorized redirect URIs.

### #1765 — rebased, not merged

PR #1765 rebased onto current `main` and version-bumped to `mira-hub/v2.2.0`. CI checks green. Merge blocked by `feedback_merge_needs_explicit_ok` enforcement — Mike's explicit one-word OK required. Once merged + tagged + deployed:

- Visual check `/hub/command-center` — selecting a node with a live display renders **"Open Live View"** button (not embedded iframe).
- Click button → opens HMI in new tab (target=`_blank`, rel=`noopener noreferrer`).

## Versioning summary

| Tag | Commit | Issue | Pushed? |
|---|---|---|---|
| `mira-hub/v2.1.1` | `13565a83` | #1761 | ✅ |
| `mira-hub/v2.1.2` | `5f5843b4` | #1763 | ✅ |
| `mira-hub/v2.1.3` | `a93f88cc` | #1764 | ✅ |
| `mira-hub/v2.1.4` | `07ac27dd` | #1762 | ✅ |
| `mira-hub/v2.2.0` | `ec63b814` | #1765 | ✅ |

## Remaining Mike-side actions

1. **Merge PR #1765** → push tag `mira-hub/v2.2.0` → trigger `deploy-vps.yml -f services=mira-hub` → visual check Command Center "Open Live View"
2. **Edit nginx config on VPS** to drop `X-Frame-Options: SAMEORIGIN` from `/scan` location (or globally) — see §#1762
3. **Add OAuth `redirect_uri` in GCP Console** for #1756 — see §#1756
4. **Authed probe for #1761** (Mike's session cookie) to confirm `totalKbChunks` ≈ 83553
5. **Playwright mobile check for #1763** at 412×915 (`scan-mobile-no-overflow.spec.ts` runs after auth setup)

## Probe re-run (after Mike's actions)

```bash
BASE=https://app.factorylm.com
JAR=cookies.txt
CSRF=$(curl -sL -c $JAR -b $JAR "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
# ... authenticate ...

# #1761
curl -sL -b $JAR "$BASE/api/usage" | jq '.allTime.totalKbChunks'   # expect ~83553

# #1762 — app + nginx
curl -sIL "$BASE/scan/" | grep -i 'x-frame-options'                # expect EMPTY after nginx fix
curl -sIL "$BASE/" | grep -i x-powered-by                          # expect EMPTY

# #1764 — already VERIFIED
curl -s "$BASE/api/usage/"                                          # {"error":"Unauthorized"} ✅

# #1765 — visual check
# browser → https://app.factorylm.com/hub/command-center → click node → click "Open Live View"
```
