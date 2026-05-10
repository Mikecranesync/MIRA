# Audit Fixes — 2026-05-09

**Branch:** `feat/mira-scan-monday-webhook-and-builder`  
**Audit reports:** `docs/audits/2026-05-09.md` · `wiki/reviews/2026-05-08-factorylm.com.md`  
**Scope:** factorylm.com (mira-web v0.5.3) + app.factorylm.com (mira-hub v1.5.1)  
**Status:** Batch 1 done — QA pending

---

## Batch 1 — Code fixes (committed 3ded94f)

| # | Finding | File(s) | Status |
|---|---------|---------|--------|
| CRA-104 | h2→h4 heading skip on homepage | `mira-web/src/lib/components.ts` | ✅ done |
| CRA-105 | /cmms missing JSON-LD | `mira-web/src/views/cmms.ts` | ✅ done |
| CRA-109 | factorylm.com 404 no home link | `mira-web/src/server.ts` | ✅ done |
| CRA-113 | /login icon-only buttons unlabelled | `mira-hub/src/app/login/page.tsx` | ✅ done |
| CRA-115 | /login og:image missing | `mira-hub/src/app/login/layout.tsx` (new) | ✅ done |
| CRA-117 | HTTP/2 missing on app.factorylm.com | `nginx-oracle.conf` | ✅ done (needs VPS deploy) |
| CRA-120 | /signup canonical points to / | `mira-hub/src/app/signup/layout.tsx` (new) | ✅ done |
| CRA-123 | Generic title "FactoryLM Hub" | `mira-hub/src/app/layout.tsx` | ✅ done |
| CRA-124 | /signup unlabelled inputs + toggle | `mira-hub/src/app/signup/page.tsx` | ✅ done |
| CRA-126 | mira-hub 404 no home link | `mira-hub/src/app/not-found.tsx` (new) | ✅ done |

---

## Batch 2 — QA proof of work

- [ ] **Write Playwright spec** — `mira-hub/tests/e2e/audit-fixes-2026-05-09.spec.ts`
  - [ ] /hub/login: verify magic-link button has `aria-label="Send magic link"`
  - [ ] /hub/login: verify password toggle has `aria-label` present
  - [ ] /hub/login: verify `<title>` contains "Sign In"
  - [ ] /hub/signup: verify Name/Email/Password inputs each have `id` + matching `for` on label
  - [ ] /hub/signup: verify password toggle has `aria-label` present
  - [ ] /hub/signup: verify `<title>` contains "Create Account"
  - [ ] /hub/404-test: visit a nonexistent path, verify 404 status + home link present
  - [ ] factorylm.com/: verify heading order (no h4 before h3 under any h2)
  - [ ] factorylm.com/cmms: verify JSON-LD `SoftwareApplication` present in DOM
  - [ ] factorylm.com/notapage: verify 404 response + "Back to home" link
- [ ] **Run spec** against live VPS (`https://app.factorylm.com`, `https://factorylm.com`)
- [ ] **Screenshot proof** — save to `tools/web-review-runs/2026-05-09-audit-fixes/`

---

## Batch 3 — Remaining findings (deferred)

| # | Finding | Effort | Notes |
|---|---------|--------|-------|
| CRA-96/97 | LCP 18.3s — no WebP, no lazy-load (3,238 KiB) | Large | Image pipeline + CDN decision |
| CRA-98 | HTTP/2 on factorylm.com | Deploy only | nginx-factorylm-marketing.conf already has `http2`; just needs `scp` + reload |
| CRA-99 | SVG console error `<rect> rx` | Unknown | Not reproduced locally; needs CDP console capture |
| CRA-108 | CSP missing on factorylm.com | Deploy only | conf already has CSP; needs `scp` + reload |
| CRA-110 | robots.txt blocks /pricing on app.* | Skip | Intentional — `X-Robots-Tag: noindex` set domain-wide for app subdomain |
| CRA-111 | /login LCP 4.6s / TBT 540ms | Medium | JS bundle split; remove render-blocking resources |
| CRA-114 | Unknown paths return 308 not 404 | Medium | Middleware intercepts before not-found; needs route-aware middleware |
| CRA-116 | 3-hop redirect chain on / | Medium | nginx + middleware coordination |

**CRA-98 + CRA-108 VPS deploy commands** (confirm before running):
```bash
scp deployment/nginx-factorylm-marketing.conf factorylm-prod:/etc/nginx/sites-available/factorylm-marketing
ssh factorylm-prod "sudo nginx -t && sudo systemctl reload nginx"
```

---

## Resume prompt

> **Branch:** `feat/mira-scan-monday-webhook-and-builder`
>
> We ran a Playwright + Lighthouse audit of factorylm.com and app.factorylm.com (2026-05-09).
> Reports are at `docs/audits/2026-05-09.md` and `wiki/reviews/2026-05-08-factorylm.com.md`.
> 31 findings total (GitHub #1092–#1119, Linear CRA-96–CRA-126).
>
> **Batch 1 code fixes are committed** (3ded94f — mira-hub v1.5.1 + mira-web v0.5.3):
> CRA-104/105/109/113/115/117/120/123/124/126 — see `docs/wip/audit-fixes-2026-05-09/tasks.md` for the full list.
>
> **Next step: Batch 2 — QA proof of work.**
> Write and run the Playwright spec at `mira-hub/tests/e2e/audit-fixes-2026-05-09.spec.ts`
> against the live VPS (app.factorylm.com + factorylm.com). Save screenshots to
> `tools/web-review-runs/2026-05-09-audit-fixes/`. Spec checklist is in the tasks.md.
>
> After QA passes: open a PR from this branch. Then decide whether to do the VPS deploy
> for CRA-98/CRA-108 (nginx-factorylm-marketing.conf already has http2 + CSP — just needs scp + reload).
> Batch 3 (image optimization, LCP, redirect chain) is deferred — see tasks.md.
