# Web Review — factorylm.com — 2026-04-25

## Summary

- Total findings: **13**
- 🔴 P0: 5
- 🟠 P1: 3
- 🟡 P2: 4
- 🟢 P3: 1
- Sources: headers=4, dom=3, console=2, strategic=2, behavioral=1, network=1

## Findings (most obvious first)

| # | Sev | Route | Title | Source | Evidence |
|---|---|---|---|---|---|
| 1 | 🔴 P0 | `/cmms` | JS TypeError every 6s on /cmms ticker — list.lastChild returns Text node | console | console: cmms:508:14 fires 13× in 84s on a single load (every setInterval tick). Root cause: initTicker uses `list.inner |
| 2 | 🔴 P0 | `/cmms` | Terms-of-Service checkbox is decorative — handleSignup() never reads it | dom | Hero signup card has `<input type='checkbox' id='f-terms' required>` with label linking to /terms and /privacy. handleSi |
| 3 | 🔴 P0 | `/api/register` | /api/register has no rate limiting + Access-Control-Allow-Origin: * — signup-flood / SMTP-bomb vector | behavioral | 10 sequential POSTs from one IP all returned HTTP 200 with {success:true,pending:true}. No 429, no CAPTCHA, no proof-of- |
| 4 | 🔴 P0 | `/` | Site-wide: zero security response headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) | headers | curl -sI on /, /cmms, /pricing, /blog returns only Server, Date, Content-Type, Content-Length, Connection, ACAO: *. No S |
| 5 | 🔴 P0 | `/` | HEAD requests return Content-Length: 0 on a 34KB body — breaks LinkedIn/Slack previews and uptime monitors | headers | `curl -sI https://factorylm.com/cmms` (HEAD) → 200 with Content-Length: 0. `curl -s -o /dev/null -w '%{size_download}' h |
| 6 | 🟠 P1 | `/` | Marketing site has zero analytics, conversion tracking, or pixel installed — flying blind on PLG funnel | strategic | Grep on full HTML of /, /cmms, /pricing, /blog for /(gtag\|analytics\|posthog\|plausible\|hotjar\|gtm\|fbq\|pixel\|mixpa |
| 7 | 🟠 P1 | `/` | Product naming inconsistent across surfaces — FactoryLM vs MIRA vs Mira; Troubleshooter vs Copilot vs Assistant | strategic | <title>: 'FactoryLM — AI Maintenance Copilot for Industrial Equipment'. <h1>: 'The AI troubleshooter that knows your equ |
| 8 | 🟠 P1 | `/cmms` | favicon.ico → 404 + no <link rel='icon'> in <head> | network | Console error on /cmms: GET https://factorylm.com/favicon.ico → 404 (nginx). HTML <head> has `apple-touch-icon` (/public |
| 9 | 🟡 P2 | `/cmms` | Render-blocking <script src='unpkg.com/lucide@latest'> in <head> — supply-chain + perf risk | dom | /cmms HTML line ~96: `<script src='https://unpkg.com/lucide@latest/dist/umd/lucide.js'></script>` in <head> with no defe |
| 10 | 🟡 P2 | `/cmms` | 13 tap targets smaller than 44×44 px on /cmms (WCAG 2.5.5 / Apple HIG) | dom | DOM scan on desktop viewport: footer/nav links e.g. 'Privacy' 60×37, 'Blog' 26×20, 'Fault Codes' 39×40, 'PRIVACY POLICY' |
| 11 | 🟡 P2 | `/` | www subdomain serves a duplicate 200 instead of 301 redirecting to apex | headers | GET https://www.factorylm.com/ → 200, Content-Length: 48219 (full duplicate of apex). Page does have `<link rel='canonic |
| 12 | 🟡 P2 | `/cmms` | Deprecated meta tag: apple-mobile-web-app-capable (no modern companion) | console | Browser console warning: `<meta name='apple-mobile-web-app-capable' content='yes'> is deprecated. Please include <meta n |
| 13 | 🟢 P3 | `/` | nginx version exposed in Server response header (info disclosure) | headers | All responses include `Server: nginx/1.24.0 (Ubuntu)` — discloses exact nginx version + OS, which helps automated CVE sc |

## Detail

### 1. [P0] /cmms — JS TypeError every 6s on /cmms ticker — list.lastChild returns Text node

- **Fingerprint:** `P0:/cmms:js-error-cssText-ticker`
- **Source:** `console`
- **Occurrences this run:** 13

**Evidence:**

```
console: cmms:508:14 fires 13× in 84s on a single load (every setInterval tick). Root cause: initTicker uses `list.innerHTML += tickerCardHTML(...)` which seeds whitespace Text nodes between elements. The cleanup branch `if (list.children.length > 3) { const last = list.lastChild; last.style.cssText += ... }` then picks a Text node, which has no .style — TypeError. Memory leak too: the list grew to 13 children after a few ticks instead of staying at 3, because cleanup removes a Text node, not a card.
```

**Suggested fix:** Two changes at /cmms:506-509 — (1) build cards with document.createElement and list.appendChild instead of `innerHTML +=` (eliminates whitespace Text nodes), (2) use `list.lastElementChild` instead of `list.lastChild` and guard with `if (last)`. Either alone fixes the TypeError; both together also fix the slow leak.

### 2. [P0] /cmms — Terms-of-Service checkbox is decorative — handleSignup() never reads it

- **Fingerprint:** `P0:/cmms:terms-checkbox-decorative`
- **Source:** `dom`
- **Occurrences this run:** 1

**Evidence:**

```
Hero signup card has `<input type='checkbox' id='f-terms' required>` with label linking to /terms and /privacy. handleSignup() at /cmms:431 reads only f-email, f-company, f-firstname — never f-terms. Compounding: there is no <form> on the page (querySelectorAll('form').length === 0), so the HTML5 `required` attribute is a no-op. Net: a user can submit /api/register and reach Stripe without ever consenting to ToS or Privacy Policy.
```

**Suggested fix:** Wrap the inputs in `<form onsubmit='event.preventDefault(); handleSignup();'>` and change the button to `type='submit'`. This (a) makes `required` work natively for the checkbox, (b) enables Enter-to-submit, (c) improves browser autofill. Or, add `if (!document.getElementById('f-terms').checked) return showError(...);` to handleSignup() — but the form approach is the right structural fix.

### 3. [P0] /api/register — /api/register has no rate limiting + Access-Control-Allow-Origin: * — signup-flood / SMTP-bomb vector

- **Fingerprint:** `P0:/api/register:no-rate-limit-open-cors`
- **Source:** `behavioral`
- **Occurrences this run:** 10

**Evidence:**

```
10 sequential POSTs from one IP all returned HTTP 200 with {success:true,pending:true}. No 429, no CAPTCHA, no proof-of-work. Endpoint also returns ACAO: *, so any third-party page can trigger it from a browser. Successful registration triggers walkthrough emails (per CMMS copy), so an attacker can submit attacker-controlled OR victim emails as fast as they want, generating outbound mail from FactoryLM SMTP infrastructure.
```

**Suggested fix:** Per-IP rate limit on /api/register (5/min, 20/hour) at nginx limit_req or app middleware. Add Cloudflare Turnstile or hCaptcha on the form. Remove ACAO: * from /api/register specifically (leave it on /demo/* if needed). Implement double-opt-in (confirm-email link) so even if the queue is flooded, no third party gets unsolicited mail beyond the first confirmation.

### 4. [P0] / — Site-wide: zero security response headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)

- **Fingerprint:** `P0:host:missing-security-headers-bundle`
- **Source:** `headers`
- **Occurrences this run:** 1

**Evidence:**

```
curl -sI on /, /cmms, /pricing, /blog returns only Server, Date, Content-Type, Content-Length, Connection, ACAO: *. No Strict-Transport-Security, no Content-Security-Policy, no X-Frame-Options/frame-ancestors, no X-Content-Type-Options, no Referrer-Policy, no Permissions-Policy. Site auths via Bearer tokens in sessionStorage exchanged with /api/me, /api/cmms/login — ACAO: * is broader than needed for a tenant-auth surface. Procurement scans flag this immediately for enterprise buyers.
```

**Suggested fix:** Add nginx `add_header` directives at server scope: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (always when on HTTPS), `X-Frame-Options: DENY` (or CSP frame-ancestors 'none'), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and a starter CSP with `default-src 'self'; img-src 'self' data: https:; script-src 'self'`. Tighten CORS off `*` for auth-touching paths. Recommend filing as a single security-headers PR.

### 5. [P0] / — HEAD requests return Content-Length: 0 on a 34KB body — breaks LinkedIn/Slack previews and uptime monitors

- **Fingerprint:** `P0:host:head-content-length-mismatch`
- **Source:** `headers`
- **Occurrences this run:** 1

**Evidence:**

```
`curl -sI https://factorylm.com/cmms` (HEAD) → 200 with Content-Length: 0. `curl -s -o /dev/null -w '%{size_download}' https://factorylm.com/cmms` (GET) → 34552 bytes. The HEAD response misrepresents the body size. Likely cause: nginx `gzip on` + `proxy_pass` interaction or a middleware that runs only on GET. Real downstream impact: LinkedIn/Slack preview unfurls use HEAD-then-GET; some uptime monitors trust Content-Length and report the site as 0-byte response.
```

**Suggested fix:** Reproduce locally with `curl -sI` against the prod nginx config. Check for `proxy_pass_request_body off`, `gzip_proxied any`, or any module that strips Content-Length on HEAD. nginx should return the same Content-Length for HEAD as it would compute for GET. If served from a Node/Bun app behind nginx, ensure the upstream sets Content-Length on HEAD too.

### 6. [P1] / — Marketing site has zero analytics, conversion tracking, or pixel installed — flying blind on PLG funnel

- **Fingerprint:** `P1:host:no-analytics-installed`
- **Source:** `strategic`
- **Occurrences this run:** 1

**Evidence:**

```
Grep on full HTML of /, /cmms, /pricing, /blog for /(gtag|analytics|posthog|plausible|hotjar|gtm|fbq|pixel|mixpanel)/i returned zero matches. No GA4, Plausible, PostHog, Segment, Meta pixel, LinkedIn Insight tag, or first-party event tracking. For a $97/mo PLG funnel, this means no measurable bounce rate, scroll depth, CTA CTR, traffic-source attribution, signup funnel drop-off, or A/B-test outcomes.
```

**Suggested fix:** Install Plausible (privacy-respecting, no cookie banner) or PostHog (more powerful, has product analytics + session replay). Track at minimum: page_view, cta_click (data-cta attr per CTA), signup_submit, signup_success, signup_error, route changes. Add UTM-aware landing analytics. Plausible: ~1KB script, no GDPR review needed for EU traffic.

### 7. [P1] / — Product naming inconsistent across surfaces — FactoryLM vs MIRA vs Mira; Troubleshooter vs Copilot vs Assistant

- **Fingerprint:** `P1:host:product-naming-inconsistent`
- **Source:** `strategic`
- **Occurrences this run:** 1

**Evidence:**

```
<title>: 'FactoryLM — AI Maintenance Copilot for Industrial Equipment'. <h1>: 'The AI troubleshooter that knows your equipment.'. meta description: 'AI-powered maintenance assistant'. nav link: 'Troubleshooter' (links to /cmms which is also titled 'Join the Beta'). Body copy mixes 'MIRA', 'Mira', and 'FactoryLM'. The /cmms slug points at the signup page, not the CMMS product page — visitors expect /cmms to be the product.
```

**Suggested fix:** Pick one primary noun (recommend 'AI troubleshooter' since it matches the H1 and search intent) and use it consistently in <title>, meta description, schema.org JSON-LD, and nav. Decide: is the product 'FactoryLM' with Mira as the embedded AI persona — if so, lead with FactoryLM and introduce Mira inside. Move the signup form off /cmms to /signup or /join-beta; keep /cmms for the actual CMMS product page.

### 8. [P1] /cmms — favicon.ico → 404 + no <link rel='icon'> in <head>

- **Fingerprint:** `P1:host:favicon-404-and-no-link-tag`
- **Source:** `network`
- **Occurrences this run:** 1

**Evidence:**

```
Console error on /cmms: GET https://factorylm.com/favicon.ico → 404 (nginx). HTML <head> has `apple-touch-icon` (/public/icons/mira-192.png) but no `<link rel='icon'>` for general browsers. Slack unfurls, RSS readers, Google's favicon API, and older browsers all hit /favicon.ico first.
```

**Suggested fix:** Add `<link rel='icon' type='image/svg+xml' href='/public/icons/favicon.svg'>` (already exists at that path on the home page) and a 32x32 PNG fallback to <head> on /cmms. Optionally publish a real /favicon.ico for legacy clients.

### 9. [P2] /cmms — Render-blocking <script src='unpkg.com/lucide@latest'> in <head> — supply-chain + perf risk

- **Fingerprint:** `P2:/cmms:render-blocking-unpkg-latest`
- **Source:** `dom`
- **Occurrences this run:** 1

**Evidence:**

```
/cmms HTML line ~96: `<script src='https://unpkg.com/lucide@latest/dist/umd/lucide.js'></script>` in <head> with no defer/async. `@latest` 302-redirects (extra roundtrip) and pins user-visible JS to whatever lucide ships next — any new release ships untested to every paying customer immediately. unpkg Cache-Control: public, max-age=60, s-maxage=300 — extremely short for a render-blocking dep.
```

**Suggested fix:** Pin to a specific version (e.g. lucide@1.11.0), add defer or move to end of <body>, and prefer self-hosting under /public/lib/lucide.min.js to remove the third-party render dependency entirely. If self-hosting, treat lucide as a normal dep tracked in package.json.

### 10. [P2] /cmms — 13 tap targets smaller than 44×44 px on /cmms (WCAG 2.5.5 / Apple HIG)

- **Fingerprint:** `P2:/cmms:tap-targets-under-44px`
- **Source:** `dom`
- **Occurrences this run:** 13

**Evidence:**

```
DOM scan on desktop viewport: footer/nav links e.g. 'Privacy' 60×37, 'Blog' 26×20, 'Fault Codes' 39×40, 'PRIVACY POLICY' 60×37, 'Home' 36×17. WCAG 2.1 success criterion 2.5.5 (Target Size) and Apple HIG both say minimum 44×44 px for touch targets.
```

**Suggested fix:** Add CSS to footer/nav links: `padding: 12px 8px; min-height: 44px; min-width: 44px; display: inline-flex; align-items: center;`. Or wrap small text-links in a 44px hit-area div. Re-run web-review after to verify count drops to 0.

### 11. [P2] / — www subdomain serves a duplicate 200 instead of 301 redirecting to apex

- **Fingerprint:** `P2:host:www-no-redirect-to-apex`
- **Source:** `headers`
- **Occurrences this run:** 1

**Evidence:**

```
GET https://www.factorylm.com/ → 200, Content-Length: 48219 (full duplicate of apex). Page does have `<link rel='canonical' href='https://factorylm.com/'>` which mitigates SEO partly, but it's still two crawl targets and bots index both.
```

**Suggested fix:** Add nginx `server { listen 443 ssl; server_name www.factorylm.com; return 301 https://factorylm.com$request_uri; }`. Also add the same for HTTP→HTTPS if not already.

### 12. [P2] /cmms — Deprecated meta tag: apple-mobile-web-app-capable (no modern companion)

- **Fingerprint:** `P2:/cmms:deprecated-apple-mobile-web-app-capable`
- **Source:** `console`
- **Occurrences this run:** 1

**Evidence:**

```
Browser console warning: `<meta name='apple-mobile-web-app-capable' content='yes'> is deprecated. Please include <meta name='mobile-web-app-capable' content='yes'>` — currently the modern companion is missing.
```

**Suggested fix:** Add `<meta name='mobile-web-app-capable' content='yes'>` to <head>. Keep the apple-* meta for older iOS Safari compatibility — both are fine simultaneously.

### 13. [P3] / — nginx version exposed in Server response header (info disclosure)

- **Fingerprint:** `P3:host:nginx-version-banner-exposed`
- **Source:** `headers`
- **Occurrences this run:** 1

**Evidence:**

```
All responses include `Server: nginx/1.24.0 (Ubuntu)` — discloses exact nginx version + OS, which helps automated CVE scanners narrow attacks.
```

**Suggested fix:** Add `server_tokens off;` to nginx.conf in the http block. Server header will become just `nginx`.

---

_Generated by the `web-review` skill._
