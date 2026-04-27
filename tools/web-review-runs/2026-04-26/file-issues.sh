#!/usr/bin/env bash
# File / reopen / comment issues for the 2026-04-26 web-review run.
# Generated alongside the audit. Re-runnable: dedupe checks happen via gh search.
set -euo pipefail

REPO=Mikecranesync/MIRA
TODAY=$(date -u +%F)

say() { echo ">>> $*" >&2; }

# ---------- regressions: reopen + comment ----------

say "Reopening #615 (ACAO:* on /api/register still set)"
gh issue reopen 615 --repo "$REPO" || true
gh issue comment 615 --repo "$REPO" --body "$(cat <<'EOF'
**Regression — re-detected by web-review on 2026-04-26.**

This was closed 2026-04-25 but `/api/register` still returns `Access-Control-Allow-Origin: *` in production today.

Verification:
```
$ curl -sI -X OPTIONS https://factorylm.com/api/register
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,HEAD,PUT,POST,DELETE,PATCH
```

The `Access-Control-Allow-Methods` is also overly permissive — `/api/register` only needs POST.

Don't know whether rate limiting was added (would need behavioral test that I declined to run on prod). Leaving rate-limit half of the original issue separate. Reopening for the CORS half.

Suggested fix: in nginx, set `Access-Control-Allow-Origin` explicitly to `https://factorylm.com` and `Access-Control-Allow-Methods POST` on the `/api/register` location.
EOF
)"

say "Reopening #620 (/favicon.ico still 404)"
gh issue reopen 620 --repo "$REPO" || true
gh issue comment 620 --repo "$REPO" --body "$(cat <<'EOF'
**Partial regression — re-detected by web-review on 2026-04-26.**

The `<link rel="icon">` part appears fixed (DOM scan finds the link tag now). But `/favicon.ico` itself still 404s:

```
$ curl -sI https://factorylm.com/favicon.ico
HTTP/1.1 404 Not Found
```

Browsers, Slack unfurls, RSS readers, and Google's favicon-fetching service all probe `/favicon.ico` first regardless of `<link rel=icon>`. Fix is one line: drop a real `favicon.ico` (or symlink to the SVG/PNG) at `mira-web/public/favicon.ico`, or add an nginx alias.
EOF
)"

# ---------- still-open dupes: comment seen-again ----------

say "Commenting on #616 (security headers — still missing)"
gh issue comment 616 --repo "$REPO" --body "$(cat <<'EOF'
Seen again on 2026-04-26 by web-review (customer-journey audit).

Verified across `/`, `/cmms`, `/pricing`, `/api/`. Still missing: HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy.

Combined with the still-open `Access-Control-Allow-Origin: *` (#615 reopened today), this is the largest single security gap on the customer-facing surface.
EOF
)"

say "Commenting on #625 (nginx banner)"
gh issue comment 625 --repo "$REPO" --body "$(cat <<'EOF'
Seen again on 2026-04-26 by web-review.

Still: `Server: nginx/1.24.0 (Ubuntu)` on every response (`/`, `/cmms`, `/pricing`, `/api/`). One-line fix: `server_tokens off;` in nginx http {} block, optionally `more_set_headers "Server: nginx";` if the headers-more module is loaded.
EOF
)"

say "Commenting on #619 (product naming) with CTA-copy variant"
gh issue comment 619 --repo "$REPO" --body "$(cat <<'EOF'
Adjacent finding from web-review on 2026-04-26 — CTA copy varies even when destination is identical:

| Where | CTA text | Destination |
|---|---|---|
| `/` nav | "Join the Beta" | /cmms |
| `/` hero | "$97/MO — SITE LICENSE / Join the Beta →" | /cmms |
| `/pricing` nav | "Get Started" | /cmms |
| `/pricing` $97 card | "Start with MIRA" | /cmms |
| `/pricing` $297 card | "Get MIRA Integrated" | /cmms |

Five labels, one destination. Pick one verb ("Start the trial" or "Join the beta") and use it everywhere the destination is the signup form. Keep "Get MIRA Integrated" only if it actually carries plan=integrated through the funnel (which it doesn't today — see new P0 filed in this run).
EOF
)"

# ---------- new issues ----------

create_issue() {
  local sev="$1" route="$2" title="$3" fp="$4" body_file="$5"
  local full_title="[web-review/${sev}] ${route} — ${title}"
  # Dedup against any-state existing
  local existing
  existing=$(gh issue list --repo "$REPO" --state all --search "in:title \"${fp}\"" --json number --limit 5 -q '.[0].number' 2>/dev/null || true)
  if [[ -n "${existing:-}" ]]; then
    say "  -> exists as #${existing}, commenting instead"
    gh issue comment "${existing}" --repo "$REPO" --body-file "$body_file"
    return
  fi
  say "  -> creating: ${full_title}"
  gh issue create --repo "$REPO" --title "$full_title" --body-file "$body_file" \
    --label bug --label web-review --label "severity:${sev}" --label plg-funnel
}

mkdir -p _bodies

# --- NEW #3 — Pricing plan intent lost ---
cat > _bodies/pricing-plan-lost.md <<'EOF'
## Severity: P0
## Route: `/pricing` -> `/cmms`
## Source: `dom + funnel`
## Fingerprint: `P0:/pricing:plan-intent-lost-on-cta`

### Reproduction
1. Visit https://factorylm.com/pricing
2. Click "Start with MIRA" ($97 card) — destination is `https://factorylm.com/cmms`
3. Click "Get MIRA Integrated" ($297 card) — destination is also `https://factorylm.com/cmms`
4. The signup form on `/cmms` has no plan field, no plan in URL, no plan in form payload to `/api/register`.

### Evidence
```
DOM scan on /pricing:
  ctas[0] text="Start with MIRA"     href="https://factorylm.com/cmms"
  ctas[1] text="Get MIRA Integrated" href="https://factorylm.com/cmms"
handleSignup() POST body: { email, company, firstName }   // no plan field
```

### Why this is a P0 for the 90-day MVP
The plan locked in CLAUDE.md is "10 paying SMBs at $97/mo by 2026-07-19", and the $297 plan exists specifically for the CMMS write-back upsell. A prospect who clicks "Get MIRA Integrated" has self-segmented as the higher-intent buyer — and we silently drop that signal. Sales follow-up cannot tell the two streams apart in HubSpot.

### Suggested fix
1. `mira-web/public/pricing.html` — change `href="/cmms"` to `href="/cmms?plan=integrated"` on the $297 CTA
2. `mira-web/public/cmms.html` — read the param, send `plan` in the `/api/register` POST body, also surface the chosen plan in the form copy ("You're signing up for MIRA Integrated — $297/mo")
3. Backend `/api/register` — accept and persist `plan`, sync to HubSpot property
EOF
create_issue P0 "/pricing" "Plan intent dropped — \$97 and \$297 CTAs both link to /cmms with no plan signal" "P0:/pricing:plan-intent-lost-on-cta" _bodies/pricing-plan-lost.md

# --- NEW #4 — Identical H1 ---
cat > _bodies/duplicate-h1.md <<'EOF'
## Severity: P1
## Route: `/` and `/cmms`
## Source: `dom`
## Fingerprint: `P1:duplicate-h1-landing-and-cmms`

### Reproduction
1. Visit https://factorylm.com/ — H1 = `The AI troubleshooter that knows your equipment.`
2. Visit https://factorylm.com/cmms — H1 = `The AI troubleshooter that knows your equipment.`

Two top-level pages with identical H1, different titles. Anyone clicking from landing to "CMMS" lands on what looks like the same hero — they don't see "this is the CMMS product page" until they read past the fold.

### Evidence
```
/        h1: "The AI troubleshooter that knows your equipment."  title: "FactoryLM — AI Maintenance Copilot for Industrial Equipment"
/cmms    h1: "The AI troubleshooter that knows your equipment."  title: "FactoryLM CMMS — Work Orders, PM Scheduling & AI Diagnostics"
```

### Suggested fix
`/cmms` H1 should reflect the CMMS positioning. Candidates that align with the existing copy:
- "Maintenance management with AI built in"
- "The CMMS that thinks for itself"
- "Work orders, PMs, and AI troubleshooting in one tool"

`mira-web/public/cmms.html` — single-line edit.
EOF
create_issue P1 "/cmms" "H1 on /cmms is identical to landing H1 — dilutes both pages" "P1:duplicate-h1-landing-and-cmms" _bodies/duplicate-h1.md

# --- NEW #5 — Tab focus off-screen ---
cat > _bodies/pricing-focus-offscreen.md <<'EOF'
## Severity: P1
## Route: `/pricing`
## Source: `keyboard a11y`
## Fingerprint: `P1:/pricing:tab-focus-jumps-offscreen`

### Reproduction
1. Open https://factorylm.com/pricing in a desktop browser (1366×900)
2. Press Tab three times from a fresh load
3. Focused element is at y=934, below the fold; `getBoundingClientRect().top > window.innerHeight`

Keyboard users have no idea where focus is. WCAG 2.4.7 (Focus Visible) failure.

### Evidence
```
focus_after_3tab: {
  tag: "A", text: "Start with MIRA",
  in_viewport: false,
  rect: { x: 53, y: 934, w: 269, h: 46 }
}
viewport: 1366x900
```

### Suggested fix
The likely cause is a hidden / off-screen "skip to content" link or a fixed-header element with `tabindex` that puts focus into the page body before the visible nav has been traversed. Check `mira-web/public/pricing.html` head/nav region for any element with `tabindex>=0` placed before `.nav-cta`. Either give it `:focus { transform: translateY(0); ... }` so it appears, or order DOM so first three Tab stops are: skip-link → nav-logo → "Get Started".
EOF
create_issue P1 "/pricing" "Tab focus lands off-screen at y=934 after 3 Tab presses" "P1:/pricing:tab-focus-jumps-offscreen" _bodies/pricing-focus-offscreen.md

# --- NEW #8 — Tap targets across all routes (superset of closed #622) ---
cat > _bodies/tap-targets-all-routes.md <<'EOF'
## Severity: P2
## Route: `/`, `/cmms`, `/pricing`
## Source: `dom (375x812 viewport)`
## Fingerprint: `P2:multi-route:tap-targets-under-44px`

### Background
Issue #622 (closed 2026-04-25) covered `/cmms` only. This new finding documents the broader pattern across all three customer-journey routes after re-running on mobile viewport. The /cmms count is reduced (13 → 6) but other routes regressed or were never measured.

### Reproduction
1. Open each route at 375×812 (iPhone viewport)
2. Count anchors/buttons with bounding box w<44 OR h<44 px

### Evidence
```
landing  : 12 violations  — incl. "FactoryLM" 105×24, "Join the Beta" 112×37, nav links 27–93×16
cmms     :  6 violations  — incl. "Privacy Policy" 60×37, footer "Home"/"Blog" 34–44×16–44
pricing  :  9 violations  — incl. "Get Started" 102×37, footer "Privacy"/"Terms" 38–46×16
```

WCAG 2.5.5 + Apple HIG both require 44×44px minimum on touch surfaces. SMB technicians on phones in the field are the target user — this is a real ergonomics issue, not just a checklist item.

### Suggested fix
Single CSS rule applied to nav and footer link sets in `mira-web/public/factorylm-cmms-brand.css` (or wherever shared nav styles live):
```css
nav a, footer a, .nav-cta { min-height: 44px; min-width: 44px; padding: 12px 8px; display: inline-flex; align-items: center; }
```
Re-run web-review on 375x812 to verify counts drop to 0.
EOF
create_issue P2 "multi-route" "Mobile tap targets <44px across landing/cmms/pricing (broader than closed #622)" "P2:multi-route:tap-targets-under-44px" _bodies/tap-targets-all-routes.md

# --- NEW #9 — No JSON-LD on /pricing ---
cat > _bodies/pricing-no-jsonld.md <<'EOF'
## Severity: P2
## Route: `/pricing`
## Source: `dom`
## Fingerprint: `P2:/pricing:no-product-jsonld`

### Reproduction
```
$ curl -s https://factorylm.com/pricing | grep -c 'application/ld+json'
0
```

Despite advertising explicit prices ($97/mo, $297/mo) and a 14-day money-back guarantee in the meta description, there is no `Product` / `Offer` / `SoftwareApplication` JSON-LD on the page.

### Suggested fix
Add a `Product` with two `Offer`s to `mira-web/public/pricing.html`. Example:
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "FactoryLM",
  "offers": [
    { "@type": "Offer", "name": "Starter",    "price": "97",  "priceCurrency": "USD", "url": "https://factorylm.com/cmms" },
    { "@type": "Offer", "name": "Integrated", "price": "297", "priceCurrency": "USD", "url": "https://factorylm.com/cmms?plan=integrated" }
  ]
}
```
Validates with Google Rich Results Test. Helps Google show price snippets in search.
EOF
create_issue P2 "/pricing" "No Product/Offer JSON-LD on pricing page" "P2:/pricing:no-product-jsonld" _bodies/pricing-no-jsonld.md

# --- NEW #11 — Plain-text 404 ---
cat > _bodies/plain-404.md <<'EOF'
## Severity: P3
## Route: `*` (404 handler)
## Source: `nginx`
## Fingerprint: `P3:host:plain-text-404-page`

### Reproduction
```
$ curl -s https://factorylm.com/this-route-does-not-exist
404 Not Found
$ curl -sI https://factorylm.com/this-route-does-not-exist
HTTP/1.1 404 Not Found
Content-Type: text/plain; charset=UTF-8
Content-Length: 13
```

13-byte plain-text 404 with no nav back to the site, no branding, no search. Visitors who mistype a URL or follow a stale link bounce off without recovery.

### Suggested fix
Add a custom 404 page at `mira-web/public/404.html` that includes the site nav, logo, and a search box or a "back to home / pricing / blog" set of links. Wire nginx: `error_page 404 /404.html;` Make sure the response keeps the 404 status code (i.e. `try_files ... /404.html =404`).
EOF
create_issue P3 "host" "404 page is 13-byte plain text — no nav back to site" "P3:host:plain-text-404-page" _bodies/plain-404.md

# --- NEW #12 — /activated silent bounce ---
cat > _bodies/activated-silent-bounce.md <<'EOF'
## Severity: P3
## Route: `/activated`
## Source: `client-side js`
## Fingerprint: `P3:/activated:silent-bounce-no-token`

### Reproduction
1. Visit https://factorylm.com/activated directly (no `?token=`)
2. Page loads briefly with title "Welcome to MIRA — let's learn your equipment", then JS calls `location.replace('/cmms')` and the user lands on `/cmms` with no message.

This is intentional security — the page only displays for visitors with a valid `?token=` from Stripe. But the bounce is silent: bookmarks, share-link clicks, and copied-from-email links all dump the user back at the marketing CMMS page with no signal that anything happened.

### Evidence
```
HTML <head> title: "Welcome to MIRA — let's learn your equipment"
Inline script:  if (!token) { location.replace('/cmms'); }
DevTools nav:   /activated -> /cmms (no warning, no toast)
```

### Suggested fix (cheap)
Replace the silent bounce with a brief friendly redirect that explains. Either:
- Redirect to `/cmms?from=activated-no-token` and read the param to show "It looks like your activation link expired — check your email for the latest link, or contact us."
- Or render a small panel on `/activated` itself: "This page is for paying customers — your activation link from Stripe should include a token. If you got here by mistake, [head back home]."

`mira-web/public/activated.html` — replace the `location.replace('/cmms')` block.
EOF
create_issue P3 "/activated" "Direct visitors silently bounced to /cmms with no message" "P3:/activated:silent-bounce-no-token" _bodies/activated-silent-bounce.md

say "DONE."
