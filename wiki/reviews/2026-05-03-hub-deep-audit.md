# Hub Deep-Crawl Web Review — app.factorylm.com — 2026-05-03

Adversarial Playwright crawl of all hub routes after the 30-PR cowork
hardening sweep. Authenticated as `playwright@factorylm.com`, drilled
every nav link / sidebar entry / mobile drawer / modal trigger / dropdown
on each of 25 routes × 2 viewports (desktop 1440×900, mobile 390×844).

## Summary

- **Total findings:** 19 (deduped from 217 raw signals)
- 🔴 P0: 2
- 🟠 P1: 6
- 🟡 P2: 8
- 🟢 P3: 3
- **Filed this run:** 15 (GH #960–#974 / Linear CRA-37 → CRA-51)
- **Skipped as dupes:** 4 of existing GH/Linear issues

## Findings (most obvious first)

| # | Sev | Route | Title | GitHub | Linear |
|---|---|---|---|---|---|
| 1 | 🔴 P0 | `/cmms` | 503 on /api/cmms/stats/ | [#960](https://github.com/Mikecranesync/MIRA/issues/960) | [CRA-37](https://linear.app/cranesync/issue/CRA-37) |
| 2 | 🔴 P0 | `/knowledge` | 500 on /api/uploads/ | [#961](https://github.com/Mikecranesync/MIRA/issues/961) | [CRA-38](https://linear.app/cranesync/issue/CRA-38) |
| 3 | 🟠 P1 | `(site-wide)` | Console error: [hubDataProvider] NEXT_PUBLIC_PIPELINE_API_UR | [#962](https://github.com/Mikecranesync/MIRA/issues/962) | [CRA-39](https://linear.app/cranesync/issue/CRA-39) |
| 4 | 🟠 P1 | `(site-wide)` | 404 on /admin/users/ | [#963](https://github.com/Mikecranesync/MIRA/issues/963) | [CRA-40](https://linear.app/cranesync/issue/CRA-40) |
| 5 | 🟠 P1 | `(site-wide)` | 1 button(s) without accessible name | [#964](https://github.com/Mikecranesync/MIRA/issues/964) | [CRA-41](https://linear.app/cranesync/issue/CRA-41) |
| 6 | 🟠 P1 | `/admin/roles` | Initial page load returned 404 | [#965](https://github.com/Mikecranesync/MIRA/issues/965) | [CRA-42](https://linear.app/cranesync/issue/CRA-42) |
| 7 | 🟠 P1 | `/admin/users` | Initial page load returned 404 | [#966](https://github.com/Mikecranesync/MIRA/issues/966) | [CRA-43](https://linear.app/cranesync/issue/CRA-43) |
| 8 | 🟠 P1 | `/magic/` | Page has no H1 | [#967](https://github.com/Mikecranesync/MIRA/issues/967) | [CRA-44](https://linear.app/cranesync/issue/CRA-44) |
| 9 | 🟡 P2 | `(site-wide)` | Missing canonical link | [#968](https://github.com/Mikecranesync/MIRA/issues/968) | [CRA-45](https://linear.app/cranesync/issue/CRA-45) |
| 10 | 🟡 P2 | `(site-wide)` | Incomplete Open Graph tags | [#969](https://github.com/Mikecranesync/MIRA/issues/969) | [CRA-46](https://linear.app/cranesync/issue/CRA-46) |
| 11 | 🟡 P2 | `(site-wide)` | 6 clickable(s) did not respond within 2s | [#970](https://github.com/Mikecranesync/MIRA/issues/970) | [CRA-47](https://linear.app/cranesync/issue/CRA-47) |
| 12 | 🟡 P2 | `(site-wide)` | Heading levels skipped | [#971](https://github.com/Mikecranesync/MIRA/issues/971) | [CRA-48](https://linear.app/cranesync/issue/CRA-48) |
| 13 | 🟡 P2 | `(site-wide)` | 5 tap target(s) < 44px (mobile) | [#972](https://github.com/Mikecranesync/MIRA/issues/972) | [CRA-49](https://linear.app/cranesync/issue/CRA-49) |
| 14 | 🟡 P2 | `/login` | Lighthouse performance score 73 | [#973](https://github.com/Mikecranesync/MIRA/issues/973) | [CRA-50](https://linear.app/cranesync/issue/CRA-50) |
| 15 | 🟡 P2 | `/__webreview_404_1777850046` | Random nonexistent path returned 308 instead of 404 | #956 (existing) | CRA-26 (existing) |
| 16 | 🟡 P2 | `/sitemap.xml` | Missing or invalid /sitemap.xml | #954 (existing) | CRA-27 (existing) |
| 17 | 🟢 P3 | `(site-wide)` | Missing twitter:card | [#974](https://github.com/Mikecranesync/MIRA/issues/974) | [CRA-51](https://linear.app/cranesync/issue/CRA-51) |
| 18 | 🟢 P3 | `/__webreview_404_1777850046` | 404 page has no home link | #662 (existing) | — |
| 19 | 🟢 P3 | `/robots.txt` | /robots.txt does not reference a sitemap | #955 (existing) | CRA-28 (existing) |

## Big-ticket flags

1. **`NEXT_PUBLIC_PIPELINE_API_URL` env var unset in production** ([CRA-39](https://linear.app/cranesync/issue/CRA-39) / [GH#962](https://github.com/Mikecranesync/MIRA/issues/962))
   Fires on every page load. Easy fix: rebuild mira-hub with the ARG passed at build time.

2. **`/admin/users` and `/admin/roles` are 404'd** ([CRA-42](https://linear.app/cranesync/issue/CRA-42), [CRA-43](https://linear.app/cranesync/issue/CRA-43))
   Sidebar still links to them, causing site-wide RSC prefetch 404s ([CRA-40](https://linear.app/cranesync/issue/CRA-40)).
   Either implement the pages or gate the sidebar entries on admin role.

3. **`/cmms` 503** ([CRA-37](https://linear.app/cranesync/issue/CRA-37))
   atlas-api may be down or proxy mis-routed on cmms-net.

4. **`/knowledge` 500 on uploads list** ([CRA-38](https://linear.app/cranesync/issue/CRA-38))
   Backend handler error or wrong proxy target.

5. **~138 dead UI surfaces site-wide** ([CRA-47](https://linear.app/cranesync/issue/CRA-47))
   ~6 buttons per page click but produce no observable state change. Worth a manual audit pass.

## Run artifacts

- Per-route findings JSON: `mira-hub/test-results/audit-2026-05-03/findings/`
- Screenshots (desktop + mobile per route): `mira-hub/test-results/audit-2026-05-03/screenshots/`
- Aggregated findings: `tools/web-review-runs/2026-05-03-hub-deep-audit/findings.aggregated.json`
- How to re-run: `tools/web-review-runs/2026-05-03-hub-deep-audit/README.md`

## Tooling added

- `mira-hub/tests/e2e/audit-2026-05-03-deep-crawl.spec.ts` — the crawl spec
- `mira-hub/tests/e2e/audit-setup.ts` — auth setup project (login → storageState)
- `mira-hub/tests/e2e/fixtures/auth.ts` — login helper (idempotent register + password sign-in)
- `mira-hub/tests/audit/playwright.audit.config.ts` — isolated config so audit projects don't pollute the shared `playwright.config.ts`
- `tools/web-review-runs/2026-05-03-hub-deep-audit/aggregate.py` — per-route → Findings + dedup + site-wide collapse + cascade suppression

---

_Generated by `web-review` skill (extended for auth + Linear filing) — 2026-05-03._
