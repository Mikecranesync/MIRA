# Routing verdict — 2026-05-04

Probed both hosts with curl `-sI` (and POST where the endpoint is POST-only). All probes against production (no headers indicating non-prod backends).

## factorylm.com (apex) → mira-web :3200

| Path | HTTP | Verdict |
|---|---|---|
| `/` | 200 | OK — nginx-factorylm-marketing.conf reaches mira-web |
| `/api/health` | 200 | OK |
| `/api/magic-link` (POST) | 200 | **OK — magic-link route works.** Initial probe of `/api/magic` (no hyphen) returned 404 because that endpoint doesn't exist; the real endpoint is `/api/magic-link`. False alarm corrected. |
| `/api/register` (POST) | 400 | Endpoint exists, returned validation error (expected) |
| `/sitemap.xml` | 200 | OK — `application/xml` |
| `/robots.txt` | 200 | OK — `text/plain` |
| `/__webreview_404_*` | 404 | Returns plain text "404 Not Found" (13 bytes). No home link in body. **STILL BROKEN — 2026-05-03 canary P3.** |
| **CSP header** | **MISSING** | `nginx-factorylm-marketing.conf` defines a CSP block but it's NOT in the live response. Either the config wasn't deployed or it's overridden upstream. **STILL BROKEN — 2026-05-03 canary P1.** |

## app.factorylm.com → mira-hub :3101 with surgical mira-web :3200 carve-outs

| Path | HTTP | Routes to | d881bb9 intent | Verdict |
|---|---|---|---|---|
| `/` | 301 → `/feed/` | (nginx redirect) | catch-all hub | OK |
| `/feed/` | 307 → `/login?callbackUrl=/feed/` | mira-hub | catch-all hub | OK — auth gate |
| `/login` | 308 → `/login/` | mira-hub | catch-all hub | OK |
| `/sample` | 200 | mira-web (Bun nginx X-Powered-By absent — content matches mira-web template) | mira-web | **CRA-25 SHIPPED ✅** |
| `/activated` | 200 | mira-web | mira-web | **CRA-25 SHIPPED ✅** |
| `/pricing` | 200 | mira-web | mira-web | **CRA-25 SHIPPED ✅** |
| `/qr-test` | 200 | mira-web | mira-web | OK |
| `/m/test-asset` | 302 | mira-web | mira-web | OK |
| `/admin/` | 404 | nginx → mira-web → 404 | mira-web | **STILL BROKEN — was supposed to be admin landing page; mira-web has no `/admin` route, only `/admin/qr-print` & `/admin/qr-analytics`. d881bb9 routed `/admin/` to mira-web but the bare path 404s.** |
| `/api/health` | 308 → `/api/health/` | mira-hub | catch-all hub | OK |
| `/api/magic-link` (POST) | 429 | mira-web | mira-web | OK (rate-limited from earlier probe — backend reachable) |
| `/api/register` (POST) | 400 | mira-web | mira-web | OK (validation error — backend reachable) |
| `/sitemap.xml` | 307 → `/login` | mira-hub | should be public | **STILL BROKEN — CRA-27 not yet deployed.** Worktree branch `claude/silly-rhodes-caa1e5` has Next.js sitemap.ts/robots.ts; per runbook, mira-hub container needs rebuild + redeploy. |
| `/robots.txt` | 307 → `/login` | mira-hub | should be public | **STILL BROKEN — CRA-27 not yet deployed.** Same as sitemap. |
| **CSP header** | PRESENT | nginx-phase2-live.conf | — | OK — full CSP shipped on app subdomain |

## Net routing assessment

- **CRA-25 (sample/activated/pricing → mira-web): SHIPPED ✅** — d881bb9 deployed on app.factorylm.com, all three return 200 from mira-web.
- **CRA-26 (default_server → 404): IN BRANCH NOT MAIN** — code on `claude/silly-rhodes-caa1e5`, not yet deployed.
- **CRA-27 (sitemap.xml + robots.txt on hub): NOT DEPLOYED** — both still 307 to login.
- **factorylm.com CSP missing** — apex P1 unfixed despite nginx-factorylm-marketing.conf containing the directive.
- **app.factorylm.com/admin/** is a routing-vs-application mismatch — either remove the nginx block (since mira-web has no `/admin` index) or add an `/admin` index page in mira-web.
