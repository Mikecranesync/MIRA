# 2026-05-03 — Hub Deep-Crawl Audit

Adversarial Playwright audit of `app.factorylm.com` (post-Phase-2 root mount;
`/hub/*` redirects to root). Authenticated as `playwright@factorylm.com` and
walks 25 hub routes × 2 viewports, drilling clickables until exhausted.

## Files

| Path | What |
|------|------|
| `raw/headers.json` | `audit.py --headers` output |
| `raw/edges.json` | `audit.py --edges` output (sitemap, robots, 404 quality) |
| `raw/lh-login.json` | Lighthouse JSON for `/login` |
| `raw/lh-findings.json` | Lighthouse → Findings shape |
| `findings.aggregated.json` | All findings, deduped within run + against existing GH/Linear |
| `findings.table.md` | Human-readable rank table (printed to chat for filing review) |
| `aggregate.py` | Walks per-route findings + raw/* into the aggregated JSON |
| `file_linear.py` | Sibling of `.claude/skills/web-review/scripts/file_issues.py` |

## How to re-run

```bash
# 1. Crawl (uses isolated config so it doesn't touch shared playwright.config.ts)
cd mira-hub
npx playwright test --config=tests/audit/playwright.audit.config.ts \
    --project=audit-desktop --project=audit-mobile

# 2. Lighthouse + headers + edges
cd ../tools/web-review-runs/2026-05-03-hub-deep-audit
npx --yes lighthouse https://app.factorylm.com/login --quiet \
    --output=json --output-path=raw/lh-login.json \
    --only-categories=performance,accessibility,seo,best-practices \
    --chrome-flags="--headless --no-sandbox"
python ../../../.claude/skills/web-review/scripts/audit.py --lighthouse raw/lh-login.json > raw/lh-findings.json
python ../../../.claude/skills/web-review/scripts/audit.py --headers https://app.factorylm.com > raw/headers.json
python ../../../.claude/skills/web-review/scripts/audit.py --edges   https://app.factorylm.com > raw/edges.json

# 3. Aggregate + dedup
python aggregate.py

# 4. File (after human review of findings.table.md)
python ../../../.claude/skills/web-review/scripts/file_issues.py --finding '<json>'
python file_linear.py --finding '<json>'
```

## Forms not submitted (per audit policy)

- `/workorders/new`, `/requests/new`, `/team`, `/admin/users`, `/admin/roles`,
  `/integrations`, `/documents` (upload), `/upgrade` (Stripe placeholder).
- Drill enumerates and clicks safe controls but skips any element whose text
  matches `submit|create|save|upload|delete|invite|publish|sign out|...`
  (see `DENY_TEXT_PATTERNS` in `audit-2026-05-03-deep-crawl.spec.ts`).
