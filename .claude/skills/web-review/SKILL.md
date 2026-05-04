---
name: web-review
description: Use this skill whenever the user asks to review, audit, test, check, or critique a webpage, website, URL, landing page, marketing site, or front-end — especially for bugs, console errors, accessibility, performance, broken links, security headers, or general quality. Drives Playwright (via the MCP server) + Lighthouse + curl as a synthetic adversarial reviewer, ranks findings P0–P3 most-obvious-first, and proposes (never auto-files) GitHub issues with deduplication against existing issues. Trigger on phrases like "review this site", "audit my page", "what's broken on", "check this URL", "test the front-end", "run a web review", "find issues on", or any URL-driven quality concern. Even when the user just pastes a URL and asks "any problems?", this skill applies.
---

# web-review

Adversarial synthetic-user review of a webpage. Loads it in a real browser, perturbs it (resize, scroll, tab), runs Lighthouse, checks security headers, probes edge routes, ranks findings by obviousness, and proposes GitHub issues for the worst.

## When this skill is in play

You drive a real headless browser via the **Playwright MCP server** (tools named `mcp__plugin_playwright_playwright__browser_*`). You also shell out to `npx lighthouse`, `curl`, and `openssl` via the `Bash` tool. You collect Findings, rank them, display them, and only then ask the user whether to file any.

**Never auto-file issues.** Always print the table first and ask.

## Workflow (5 passes per page)

For each URL the user gives you:

### Pass 1 — Passive load
1. `browser_navigate <url>`
2. `browser_console_messages level=warning all=true` — capture errors + warnings
3. `browser_network_requests static=false requestBody=false requestHeaders=false` — flag any non-2xx
4. `browser_evaluate` with the **DOM-eval payload below** — collects meta tags, headings, images, links, forms, tap targets, JSON-LD in one round-trip

### Pass 2 — Adversarial perturbation
5. `browser_resize 375 812` — iPhone viewport
6. `browser_evaluate` to re-collect console (use `performance.getEntries()` or simply re-call `browser_console_messages` — *new* errors here are resize-handler bugs)
7. `browser_press_key Tab` ×3, then evaluate `document.activeElement` — focus visible? in viewport?
8. Scroll to bottom: `browser_evaluate (() => window.scrollTo(0, document.body.scrollHeight))`, then re-collect console

### Pass 3 — Performance & a11y (Lighthouse)
9. `Bash: npx --yes lighthouse <url> --quiet --output=json --only-categories=performance,accessibility,seo,best-practices --chrome-flags="--headless --no-sandbox" > /tmp/lh-<hash>.json`
10. Parse with `python3 .claude/skills/web-review/scripts/audit.py --lighthouse /tmp/lh-<hash>.json` — outputs JSON Findings

### Pass 4 — Security headers (once per host)
11. `Bash: python3 .claude/skills/web-review/scripts/audit.py --headers <origin>` — runs `curl -sI -L` + `openssl s_client` and emits Findings for missing CSP/HSTS/etc., expired certs, insecure cookies

### Pass 5 — Edge probes (once per host)
12. `Bash: python3 .claude/skills/web-review/scripts/audit.py --edges <origin>` — checks `/<random>` (404 quality), `/robots.txt`, `/sitemap.xml`

## DOM-eval payload

Run this verbatim via `browser_evaluate`. It returns one JSON object covering all per-page DOM checks — keeps the Playwright round-trips down.

```javascript
() => {
  const r = {url: location.href};
  const imgs = [...document.querySelectorAll('img')];
  r.images_total = imgs.length;
  r.images_no_alt = imgs.filter(i => !i.hasAttribute('alt')).map(i => i.src);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  r.h1_count = headings.filter(h => h.tagName === 'H1').length;
  const order = headings.map(h => +h.tagName.slice(1));
  r.heading_skips = order.map((n,i) => i>0 && n-order[i-1]>1 ? `h${order[i-1]}→h${n}` : null).filter(Boolean);
  r.meta = {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content,
    canonical: document.querySelector('link[rel="canonical"]')?.href,
    og_title: document.querySelector('meta[property="og:title"]')?.content,
    og_image: document.querySelector('meta[property="og:image"]')?.content,
    og_url: document.querySelector('meta[property="og:url"]')?.content,
    twitter_card: document.querySelector('meta[name="twitter:card"]')?.content,
    viewport: document.querySelector('meta[name="viewport"]')?.content,
    lang: document.documentElement.lang,
    favicon: document.querySelector('link[rel="icon"]')?.href,
  };
  r.deprecated_meta = ['apple-mobile-web-app-capable']
    .filter(name => document.querySelector(`meta[name="${name}"]`) && !document.querySelector('meta[name="mobile-web-app-capable"]'));
  r.external_no_noopener = [...document.querySelectorAll('a[target="_blank"]')]
    .filter(a => !(a.rel||'').includes('noopener')).map(a => a.href);
  r.mixed_content = [...document.querySelectorAll('img,script,link,iframe')]
    .map(e => e.src||e.href).filter(u => u && u.startsWith('http://')).slice(0,10);
  r.tap_targets_too_small = [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')]
    .filter(el => { const b = el.getBoundingClientRect(); return b.width>0 && b.height>0 && (b.width<44 || b.height<44); })
    .map(el => ({tag: el.tagName, text: (el.innerText||el.value||'').slice(0,40),
                 w: Math.round(el.getBoundingClientRect().width),
                 h: Math.round(el.getBoundingClientRect().height)})).slice(0,15);
  r.buttons_no_name = [...document.querySelectorAll('button')]
    .filter(b => !b.innerText.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
  r.forms = [...document.querySelectorAll('form')].map(f => ({
    action: f.action, method: f.method,
    inputs_unlabelled: [...f.querySelectorAll('input,textarea,select')].filter(i =>
      !i.labels?.length && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby')).length,
  }));
  r.jsonld_types = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => {
    try { const o = JSON.parse(s.textContent); return o['@type'] || (o['@graph']||[]).map(x=>x['@type']) || 'unknown'; }
    catch { return 'INVALID_JSON'; }
  });
  return r;
}
```

Map the result into Findings using `python3 .claude/skills/web-review/scripts/audit.py --dom <path-to-json>` (write the JSON to a tempfile first; pipes into the same Finding shape).

## Severity rubric (most obvious first)

| Tier | Rule | Examples |
|---|---|---|
| 🔴 P0 | Site broken / security-critical | JS exception in console, 5xx, broken core CTA, expired TLS, missing HSTS over HTTPS |
| 🟠 P1 | Visible defect / material risk | Asset 404 (favicon, og:image), missing `<title>` or viewport, mixed content, broken nav, Lighthouse perf <50 |
| 🟡 P2 | A11y / SEO / standards | Missing img alt, heading skip, tap target <44px, missing OG/Twitter/JSON-LD, no canonical, deprecated meta, perf 50–80 |
| 🟢 P3 | Hygiene | `rel="noopener"` on same-origin, minor, perf >80 |

**Sort:** tier first, then route depth (`/` before `/blog/x`), then occurrence count (errors seen ≥2× outrank singletons).

Full check list and edge cases live in `references/severity.md` — read that for the long tail.

## Output protocol

After collecting Findings from all passes, **always do this in order**:

### A. Print a markdown table to chat
```
| #  | Sev | Route   | Title                           | Evidence (one line)                        |
|----|-----|---------|---------------------------------|--------------------------------------------|
| 1  | 🔴  | /cmms   | JS TypeError: cssText undefined | console: cmms:508:14, fired 10× on resize  |
| 2  | 🟠  | /cmms   | favicon.ico → 404               | network: GET /favicon.ico → 404            |
| 3  | 🟡  | /cmms   | 12 tap targets <44px            | DOM: footer/nav links, e.g. Privacy 60×37  |
...
```

### B. Propose filing (gated)
Ask the user: *"File these as GitHub issues? Options: `all` / `top N` / `[1,3,5]` / `no`."*

**Default to nothing if the user doesn't reply** — do not file on assumption.

### C. On confirmation, file via the helper
For each chosen finding:
```bash
python3 .claude/skills/web-review/scripts/file_issues.py \
  --repo Mikecranesync/MIRA \
  --finding '<json-blob>'
```
The script:
1. Computes a fingerprint = `{severity}:{normalized_path}:{check_id}`
2. Greps `gh issue list --search "[web-review] <fingerprint>" --state all`
3. If hit → comments `seen again on YYYY-MM-DD` on existing issue
4. Else → creates new issue with title `[web-review/<P>] <route> — <title>` and labels `bug,web-review,severity:<P>`

### D. Always write a vault report
Independent of whether issues were filed:
```bash
python3 .claude/skills/web-review/scripts/write_report.py \
  --host <host> --findings '<json-array>' \
  --out /Users/factorylm/mira/wiki/reviews/$(date +%F)-<host>.md
```
The vault Stop-hook auto-commits this — gives you a diffable history of site quality over time.

## Determining the issue repo

Default: `Mikecranesync/MIRA` (this repo's `git remote -v`). If the user is reviewing a different project, ask which repo, or read `git remote -v` from their cwd.

## Sitemap-driven crawl mode

If the user passes a sitemap or asks to "audit the whole site":
1. Fetch `<origin>/sitemap.xml` and parse `<loc>` entries
2. Take top N (default 5) by `<priority>`
3. Run all 5 passes per URL, sharing Pass 4 + Pass 5 across the host (run those once)
4. Merge findings; dedup by fingerprint within the run

## What this skill does NOT do (yet)

- **Auth'd routes** — no cookie injection in v1
- **Form submission / fuzzing** — destructive; would need explicit `--aggressive` and target allowlist
- **DAST / OWASP ZAP** — heavy, gated for v2 (`--security` flag)
- **Persona journeys via browser-use** — gated for v2 (`--persona`)
- **UXAgent task simulation** — gated for v2 (`--ux`)

If the user asks for any of these, surface the limitation honestly and offer the v1 fast-core sweep as a starting point.

## Why this design

- **Most-obvious-first** is a sort, not a different check — same DOM-eval scan covers high and low severity; the rubric just orders them. This means one pass produces a complete picture; we never miss a P0 because we ran out of time.
- **Propose-only filing** matches the project's CLAUDE.md rule ("Only create commits when requested"). One false-positive auto-filed wastes more human time than a hundred propose-only round-trips.
- **Fingerprint dedup** turns the skill into a safe daily/weekly cron — same problem reported once, with an updated occurrence count.
- **Vault report always** writes the run output even when no issues are filed, so quality regressions show up in the vault diff.
