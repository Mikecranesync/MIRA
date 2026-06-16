# web-review — severity rubric & full check list

This is the deep reference for the rubric. The SKILL.md has a summary table; this file is for the long tail and edge cases.

## Why "most obvious first"

Site reviewers historically dump 100+ issues, ordered alphabetically or by file. Result: a maintainer sees 12 noopener warnings before the JS exception that's actually breaking the page. The signal-to-noise inverts the priority.

`web-review` ranks by **observability under normal use**. A user encounters issues in this order:
1. Page won't render or throws JS (P0)
2. Visible defect during routine click-through (P1)
3. A11y/SEO failure that's invisible to a sighted desktop user but real for many (P2)
4. Specification compliance / hygiene (P3)

The skill's job is to surface (1) before (4). Always.

## Tier definitions

### 🔴 P0 — Site is broken or security-critical

**Inclusion criteria:**
- Any JavaScript exception in the console (including those that fire only on resize/scroll/click)
- Any HTTP 5xx or network error during a normal navigation
- A core CTA or nav link that does not work
- A required asset (the favicon, og:image, main stylesheet, main JS bundle) returning non-2xx
- An expired or near-expired (<7 days) TLS certificate
- Missing `Strict-Transport-Security` header on an HTTPS site
- Mixed content (HTTP resources on an HTTPS page)
- Lighthouse `uses-https` audit failing
- Form submitting to an unencrypted endpoint
- Exposed secrets in HTML/JS (API keys, tokens)

**File as P0 always.** Ship it under "the site is broken right now."

### 🟠 P1 — Visible defect or material risk

**Inclusion criteria:**
- Asset 404s for non-critical paths (e.g., `/favicon.ico` when only `.svg` is declared)
- Missing `<title>` on any page
- Missing `<meta name="viewport">` (breaks mobile rendering)
- Missing `<html lang="…">` (a11y screen-reader pronunciation)
- Broken internal nav link (clicked → 404 or different host than expected)
- Lighthouse performance score <50
- Cookie set without `Secure` flag on HTTPS
- Button or input with no accessible name (`<button>` with no text/aria-label)
- Form input lacking any label association
- Unlabelled `<form>` with `method=POST` going somewhere

**Sort priority:** P1 issues on `/` outrank P1 issues on `/blog/x`.

### 🟡 P2 — A11y, SEO, standards

**Inclusion criteria:**
- `<img>` without `alt` (or with `alt=""` on a content image)
- Heading hierarchy skip (e.g., `<h2>` immediately followed by `<h4>`)
- Multiple `<h1>` on one page
- Tap targets smaller than 44 × 44 px (WCAG 2.5.5, Apple HIG)
- Missing or incomplete Open Graph (`og:title`, `og:image`, `og:url`)
- Missing `<meta name="twitter:card">`
- Missing `<link rel="canonical">`
- Missing `Content-Security-Policy` (P2 if HTTPS, P1 if site has user-supplied content)
- Missing `X-Content-Type-Options: nosniff`
- Missing `X-Frame-Options` (or equivalent CSP `frame-ancestors`)
- Deprecated meta tag (e.g., `apple-mobile-web-app-capable` without `mobile-web-app-capable`)
- Cookie set without `HttpOnly` when name suggests session
- TLS cert expiring in 7–30 days
- Lighthouse a11y/SEO/best-practices score <90
- 404 page lacks status text or a way back home
- Empty or missing `/robots.txt` or `/sitemap.xml`

### 🟢 P3 — Hygiene

**Inclusion criteria:**
- `target="_blank"` without `rel="noopener"` on **same-origin** links (different-origin = P2)
- Missing `Referrer-Policy` header
- Missing `Permissions-Policy` header
- `/robots.txt` exists but doesn't reference a sitemap
- Lighthouse score 80–90 (room to improve, not failing)
- Minor structured-data omissions (e.g., blog post without `article:published_time` while having JSON-LD `Article`)

## Sort order within a tier

When multiple findings share a tier:
1. **Route depth** — `/` before `/cmms` before `/blog/x`. Surface issues on the entry route first; visitors see them more.
2. **Occurrence count** — an error fired 10× outranks a singleton. The DOM-eval payload returns counts where applicable; console errors are bucketed by stack signature.
3. **Cross-page repetition** — a check that fails on every page (e.g., missing `<html lang>` site-wide) gets surfaced once at the top with `affects: site-wide`.

## Out-of-scope (intentional)

- **Color contrast beyond Lighthouse.** Lighthouse covers this; deep contrast analysis (gradient backgrounds, dynamic states) needs human judgment.
- **Deep keyboard navigation.** v1 only checks Tab x3 focus visibility. Skipping landmarks, focus traps, modal focus return, etc. is post-v1.
- **Visual regression.** That's a separate skill (`web-snapshot`); this one only catches *new* defects, not visual drift.
- **Internationalization.** Multilingual sites (different `lang` per page, RTL handling) — out of v1 scope.
- **Auth'd flows.** Anything past a login wall — gated for v2 with persona / cookie injection.

## Edge cases

### "Same-origin `target=_blank`"
Tab-nabbing requires `window.opener`. Modern browsers (Chromium 88+, Firefox 79+, Safari 12.1+) set `noopener` by default for `target=_blank`. So this is genuinely P3 hygiene now, not the P1 it once was.

### "Missing CSP on a static marketing site"
A pure-static site with no user input has limited XSS surface. Still P2 — bots scan for it, and it's a prerequisite for many compliance frameworks.

### "Lighthouse perf 50–80 on mobile"
Don't blanket-flag this as a defect. Run Lighthouse on the route the user cares about, and if perf is in the gray zone, surface it as P2 with the failing audits enumerated. Never autoflag low perf without saying *what*.

### "JSON-LD parse error"
Treat as P2: structured data is invisible to humans, so it doesn't cause a user-facing defect, but it breaks Google's rich results — material to most marketing sites.

### "Forms with `method=GET` posting sensitive data"
P0 if a password/token field is named in a GET-method form. P1 if it's a search but smells like login.

## Adding a new check

1. Decide tier per the rules above.
2. Add a `finding(...)` call in the right place in `scripts/audit.py` (or in the DOM-eval JS payload in SKILL.md, with the mapping in `map_dom`).
3. Use a **stable** check_id — that becomes the fingerprint, and changing it duplicates issues.
4. Add a row to the test fixtures if you want it to be exercised by `evals/evals.json`.
