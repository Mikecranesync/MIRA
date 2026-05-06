# app.factorylm.com audit fixes — 2026-05-04

Branch: `claude/silly-rhodes-caa1e5` (do NOT merge to main).

## What's in this branch (code-only)

| Linear | Issue | Fix |
|--------|-------|-----|
| CRA-43, CRA-40 | `/admin/users` 404 + RSC prefetch 404s | Removed sidebar/drawer/more/access-control entries pointing at `/admin/users` |
| CRA-45 | Missing canonical link on hub pages | Added `metadata.alternates.canonical` + `metadataBase` in `mira-hub/src/app/layout.tsx`; `/login` has its own canonical |
| CRA-46 | Incomplete Open Graph tags | Added full `openGraph` + `twitter` blocks in `mira-hub/src/app/layout.tsx`; `/login` has its own |
| CRA-27 | sitemap.xml missing | Added `mira-hub/src/app/sitemap.ts` + `mira-hub/src/app/robots.ts` (Next.js convention — auto-served at `/sitemap.xml` and `/robots.txt` once mira-hub is rebuilt) |
| CRA-50 | `/login` Lighthouse perf | Split client form into `login-form.tsx`, made `page.tsx` a server component with proper `metadata` (title/description/OG/canonical) — improves SEO score and avoids client-side `<head>` work |
| CRA-37 (defensive) | `/api/cmms/stats` 503 | Improved error logging — now reports specific reason (`credentials_missing` / `signin_<status>` / `network_<msg>`) so the 503 diagnoses itself in container logs |
| CRA-38 (defensive) | `/api/uploads` 500 | Wrapped GET in try/catch with structured error log; returns 503 instead of 500 with full stack in logs |
| CRA-26 | Unknown paths return 308 instead of 404 | Added `default_server` block at top of `nginx-phase2-live.conf` returning 404 for unmatched hosts |
| CRA-25 | `/sample` and `/activated` route to OWU | Already in `nginx-phase2-live.conf` (commits d881bb9 + 38676e5). Just needs deploy. |

## VPS steps Mike must run

The code lives in the worktree branch. Once merged or built, Mike needs to:

### 1. Deploy nginx config (CRA-25 + CRA-26)

```bash
ssh root@100.68.120.99
# from local machine first:
scp nginx-phase2-live.conf root@100.68.120.99:/etc/nginx/sites-enabled/mira
# then on VPS:
ssh root@100.68.120.99 "nginx -t && systemctl reload nginx"
```

### 2. Rebuild mira-hub image (CRA-43, 40, 45, 46, 27, 50)

```bash
# from VPS, in deploy dir:
docker compose pull mira-hub  # if image is built+pushed via CI
# OR rebuild on VPS:
docker compose up -d --build mira-hub
```

After rebuild, verify:
- `curl -sI https://app.factorylm.com/sitemap.xml | head -1` → `200`
- `curl -sI https://app.factorylm.com/robots.txt  | head -1` → `200`
- `curl -s https://app.factorylm.com/login | grep -oE '<meta property="og:title"[^>]*>'` → present
- `/admin/users` no longer in any rendered nav (hub UI inspection)

### 3. Diagnose CRA-37 (`/api/cmms/stats` 503) — needs production logs

After mira-hub rebuild with the better logging, hit `/cmms` once then run:

```bash
docker logs mira-hub --tail 200 | grep -i 'cmms/stats'
```

Look for the `reason` field. Likely outputs:
- `credentials_missing` → set `ATLAS_API_USER` + `ATLAS_API_PASSWORD` in mira-hub container env (Doppler `factorylm/prd`)
- `signin_401` → wrong password
- `signin_503` / `signin_502` → cmms.factorylm.com (Atlas) is down — check `docker ps | grep atlas`
- `network_*` → DNS or network issue

### 4. Diagnose CRA-38 (`/api/uploads` 500) — needs production logs

Same flow:

```bash
docker logs mira-hub --tail 200 | grep -i 'api/uploads'
```

The new try/catch logs the full error. Most likely causes:
- NeonDB `hub_uploads` schema not migrated → `ensureUploadsSchema()` failing silently? Run a one-shot query against NeonDB.
- Missing `tenant_id` on session → look for the upstream `sessionOr401()` behavior.

## Things deliberately NOT changed (and why)

- **`/admin/users` page itself** — left in place at `mira-hub/src/app/(hub)/admin/users/page.tsx`. Removing it would shrink the diff but it's currently unreachable through nginx anyway (which routes `/admin/` to mira-web :3200). Safe to delete in a follow-up if confirmed dead.
- **`trailingSlash: true` in `next.config.ts`** — this is the root cause of some of the 308s the auditor saw. Flipping to `false` would likely fix more 308 cases but interacts with the `/hub/` legacy redirect (active until 2026-07-28). Defer to after that redirect is sunset.
- **mira-web `public/sitemap.xml`** — references `factorylm.com` (apex), correctly. Not touched. The new `mira-hub` sitemap covers `app.factorylm.com`.
