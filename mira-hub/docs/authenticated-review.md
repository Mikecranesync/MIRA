# Authenticated review & monitoring of the Hub

Closes three blind spots from the 2026-05-28 `app.factorylm.com` web-review.
The Hub is auth-gated: every route 302s to `/login` for anonymous requests, so
synthetic monitors, uptime checks, and the `web-review` skill only ever see the
login page. This doc gives review tooling an authenticated path.

> **Environment:** intended target is **staging** (the `127.0.0.1:4101` tunnel).
> Never run the capture against `@FactoryLM_Diagnose`-class prod surfaces with the
> shared test account — see the prod-guard in the capture script. Prod monitoring,
> if ever needed, uses a dedicated low-privilege account.

## 1 — Capture a session (the review-tooling cookie)

`scripts/capture-review-session.ts` logs in once via the **real** credentials
provider and writes a Playwright `storageState`. It does **not** forge a JWE — it
exercises the actual auth path, needs no `AUTH_SECRET`, and can't drift from a
NextAuth bump. (Its interactive sibling, `tests/e2e/fixtures/create-auth-state.ts`,
is for a human logging in by hand; this one is for CI / cron / unattended monitors.)

```bash
cd mira-hub
HUB_URL=http://127.0.0.1:4101 \
E2E_HUB_EMAIL=playwright@factorylm.com E2E_HUB_PASSWORD=TestPass123 \
bun run scripts/capture-review-session.ts
# → tests/e2e/.state/review-session.json   (gitignored)
```

> **Treat the output as a secret.** `review-session.json` holds a live session
> cookie (a valid login). It is gitignored, but don't paste it into logs, CI
> artifacts, or issues, and re-capture rather than long-lived reuse.

Consume it:
- **web-review skill / Playwright:** open the context with
  `{ storageState: "tests/e2e/.state/review-session.json" }` (or, via the MCP
  `browser_run_code_unsafe`, add the cookies from that file), then run the 5 passes
  against authed routes instead of bouncing to `/login`.
- **curl-based monitors:** extract the `next-auth.session-token` (or
  `__Secure-next-auth.session-token`) cookie and send it as a `Cookie:` header.

## 2 — Soft-404 on unknown routes (disposition: mostly by design)

Web-review flagged `GET /<random>` → 200 (and "404 page has no home link").
**Both were artefacts of the auth wall, not bugs:**

- The edge probe was **anonymous**, so middleware redirected it to `/login` (a 200)
  before Next's not-found handler ran — it never saw the real 404 page. The
  "no home link" finding was therefore a **false positive**: `src/app/not-found.tsx`
  has a "Back to dashboard" link.
- For an **authenticated** request, an unmatched route is not caught by middleware
  and Next.js renders `not-found.tsx`, which returns a **404 status by default**
  (framework behavior). So real users hitting a broken internal link get a 404.
- Anonymous unknown-route → `/login` is **intentional**: it avoids leaking which
  routes exist to unauthenticated visitors, and `robots.txt` already `Disallow: /`,
  so there is no SEO soft-404 to index.

The genuine residual — broken internal links don't surface to *unauthenticated*
external monitors — is closed by the authenticated crawl in §1: run web-review (or a
link checker) with the captured session and unmatched routes will return real 404s.

## 3 — Confirm the `?_rsc=` 503s are runtime/infra, not code

Public routes returned **200** on `?_rsc=` prefetch (e.g. `/signup/?_rsc=…`), so the
503s the manual QA saw are auth-gated-route or load-specific — consistent with the
VPS-OOM pattern, not a Next.js defect. To confirm on **staging** with the §1 session:

```bash
# 1. capture (see §1) → tests/e2e/.state/review-session.json
# 2. pull the session cookie value
COOKIE=$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("tests/e2e/.state/review-session.json")).cookies.find(c=>c.name.endsWith("next-auth.session-token")).value)')
# 3. probe an authed route's RSC prefetch repeatedly; watch for 503s under load
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Cookie: next-auth.session-token=$COOKIE" \
    "http://127.0.0.1:4101/feed/?_rsc=probe$i"
done
# Correlate any 503s with `docker stats` / container memory on the staging host.
```

If 503s appear only under memory pressure (not deterministically per route), the fix
is the `mem_limit` / restart-policy lane (infra), not application code — matching the
WS-A hypothesis in `docs/plans/2026-05-28-hub-qa-fixes.md`.

## Status

- §1 capture script + this doc: **shipped**.
- §1 run, §3 confirmation: **pending a reachable staging Hub** (the `127.0.0.1:4101`
  tunnel is set up ad hoc on CHARLIE; not reachable from every node). Run there.
- §2: no code change — disposition documented above.
