---
name: design-ship-routine
description: Use whenever shipping a visible change to mira-web — a new view, restyled component, copy/layout edit on `/`, `/cmms`, `/pricing`, `/limitations`, etc. Captures the snapshot-before → implement → snapshot-after → PR → merge → deploy → verify-live → screenshot-proof loop with Playwright assertions. Skip only for invisible changes (server logic, routing).
---

# design-ship-routine

The routine for shipping any visible mira-web change end-to-end: from "I'm about to edit a UI file" through "the change is live on factorylm.com and verified."

## Why this exists

Three failure modes this prevents:

1. **Shipping unstyled pages** — `head()` references root-relative `/_tokens.css`, etc. If a `serveStatic` mount is missing, the CSS 404s and the page renders with browser defaults. Looks broken on prod.
2. **No visual diff** — without before/after screenshots a reviewer can't see what actually changed; six months later we can't tell what shipped when.
3. **"Looks fine on my machine"** — a deploy that builds + boots is not a deploy that *renders*. The verify step asserts the live DOM has the right markers AND that token colors actually loaded.

## When to invoke

**Always** for: new server-rendered view (`renderHome`, `renderCmms`, ...), restyled component, copy/layout edit on a public surface, header/footer/nav change, new email template, anything in `mira-web/public/*.css` or `mira-web/src/views/`.

**Skip** for: server-only logic (no markup change), routing changes that don't alter rendered HTML, copy in robots/sitemap, or alt text only.

## The loop

```
┌─────────────────────────────────────────────────────────┐
│ 1. snapshot:before  → capture local state pre-change   │
│ 2. implement        → TDD if backend; design tokens    │
│ 3. snapshot:after   → capture local state post-change  │
│ 4. PR with screenshots committed to design-history/    │
│ 5. merge to main                                        │
│ 6. deploy           → ssh + rebuild mira-web container │
│ 7. verify:live      → Playwright assertions + screenshot│
│ 8. if fail → rollback, fix, goto 5                     │
│ 9. if pass → close issue, post live screenshot         │
└─────────────────────────────────────────────────────────┘
```

## Step-by-step

### 1. Snapshot BEFORE (local)

Boot dev server and capture the current state:

```bash
cd mira-web
PLG_JWT_SECRET=test STRIPE_SECRET_KEY=sk_test STRIPE_WEBHOOK_SECRET=whsec \
NEON_DATABASE_URL=postgresql://x:y@localhost/db RESEND_API_KEY=re_x \
bun run src/server.ts &
# wait for /api/health
bun run snapshot:before http://localhost:3000/<route> <issue-label>
```

`<issue-label>` is the spec ID lowercased (e.g. `so070-cmms`, `so100-home`, `so104-pricing`). The script auto-prefixes today's date and creates `docs/design-history/<date>-<label>/before-{desktop,mobile}.png` (1440×900 + 390×844, full-page).

### 2. Implement

- **Backend changes:** TDD. Write the test for the storage/util layer first, run it red, implement until green. Use dependency-injection (storage interface + in-memory adapter for tests) when the code touches NeonDB, so unit tests skip the `@neondatabase/serverless` Client import bug that breaks the existing test suite.
- **View changes:** server-render through TypeScript helpers (`head()` + Wave-B components). Don't write static HTML files for new pages.
- **Tokens, not hex.** Reference `var(--fl-navy-900)`, never `#1B365D` directly.
- **One H1, no skipped headings, semantic `<label>` even when visually-hidden.**

### 3. Snapshot AFTER (local)

Restart the dev server (so new code is loaded), then:

```bash
bun run snapshot:after http://localhost:3000/<route> <issue-label>
```

This appends `after-{desktop,mobile}.png` to the same `docs/design-history/<date>-<label>/` folder.

### 4. Open PR

Commit the code AND the 4 screenshots together. PR body should reference the visual diff path:

```
## Visual diff
docs/design-history/<date>-<label>/{before,after}-{desktop,mobile}.png
```

Stack PRs cleanly — if the change depends on Wave A+B foundation (`/_tokens.css`, head partial), set the base branch to that PR, not `main`. After parent merges, rebase + retarget to main.

### 5. Merge to main

Squash-merge the PR. Keep the title conventional (`feat(web):` / `fix(web):` / `refactor(web):`). After merge, delete the branch.

### 6. Deploy

mira-web has **no CD pipeline** (per `docs/known-issues.md`). Deploy is manual on the VPS host that runs `docker-compose.saas.yml`:

```bash
# On the VPS:
cd /opt/mira  # or wherever the repo lives
git pull origin main
doppler run -p factorylm -c prd -- \
  docker compose -f docker-compose.saas.yml up -d --build mira-web
# Watch logs briefly
docker compose -f docker-compose.saas.yml logs -f mira-web | head -30
```

Pre-flight env vars (Doppler `factorylm/prd`, all should already be set):
`PUBLIC_URL`, `PLG_JWT_SECRET`, `NEON_DATABASE_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`.

The schema migration (`ensureSchema()`) runs at boot; new tables are additive (`plg_magic_link_tokens`, `plg_audit_log`, etc.). Rollback is `git checkout <prev-sha> && docker compose up -d --build` — the new tables stay, harmless.

### 7. Verify live

```bash
cd mira-web
bun run verify:live https://factorylm.com <surface>
```

Where `<surface>` is one of `home`, `cmms`, `sample`, `legacy-home`, `legacy-cmms`. Surfaces are defined in `mira-web/scripts/verify-deployment.ts` and assert:

- HTTP 200 (rejects 4xx/5xx)
- Required selectors present (e.g. `.fl-hero-h1`, `#fl-magic-form`)
- Forbidden selectors absent (regression markers from legacy markup)
- Computed styles match design tokens (e.g. hero H1 must be `rgb(27, 54, 93)` = `--fl-navy-900`, NOT browser default black — catches the `/_tokens.css` 404 failure mode)
- Live screenshot saved to `docs/design-history/<date>-<label>/live-{desktop,mobile}.png`

Exit code 0 = verified. Non-zero = halt and rollback.

### 8. If verify fails

Don't paper over. Read the failure list:

- "required selector missing: ..." → the deploy didn't include the new view → check `git log` on the VPS, repull, rebuild
- "forbidden selector present" → legacy code still serving → verify the route table, check container actually restarted
- "color = rgb(0, 0, 0) matches forbidden default" → tokens.css 404 → check the `serveStatic` mounts, hit `/_tokens.css` directly to confirm
- "HTTP 5xx" → server boot failed → `docker compose logs mira-web` for stack trace

Roll back to the previous sha, fix on a new branch, ship through the loop again.

### 9. If verify passes

Commit the live screenshots if they aren't already:

```bash
git add docs/design-history/<date>-<label>/live-*.png
git commit -m "docs: live verify proof for <issue-label>"
git push
```

Close the issue with a comment linking the design-history folder.

## Surface configs (extend as you ship)

Each surface in `verify-deployment.ts` has a config:

```ts
home: {
  path: "/",
  label: "so100-home",
  required: [".fl-hero-h1", ".fl-trust-band", ...],
  forbidden: [".equipment-fade", "#beta-form"],  // legacy markers
  styleAssertions: [
    { selector: ".fl-hero-h1", property: "color", matches: /^rgb\(27,\s*54,\s*93\)$/ },
    { selector: ".fl-hero", property: "background-image", notEqual: ["none"] },
  ],
}
```

Extend this map when you add a new public surface. The discipline of writing the assertions BEFORE you ship doubles as a design checklist — what does this page need to be considered correct?

## Tools

| Tool | What | Where |
|------|------|-------|
| `bun run snapshot:before/after` | Playwright capture, pre/post local edits | `mira-web/scripts/design-snapshot.ts` |
| `bun run verify:live` | Playwright assertions + live capture | `mira-web/scripts/verify-deployment.ts` |
| Output dir | All screenshots + verify proof | `docs/design-history/<date>-<label>/` |
| Browser | Bundled Chromium via Playwright | `~/Library/Caches/ms-playwright/` |

## Gotchas

- **Run from `mira-web/` directory.** The dev server and bun scripts assume this cwd.
- **Don't reference Chrome.app** in the script — it isn't installed on charlienode. Playwright manages its own Chromium.
- **macOS Doppler bug on Bravo/Charlie** — for prod deploys on the VPS, Doppler should work fine. Known macOS keychain bug only affects local builds on Bravo/Charlie.
- **Pre-existing test failures.** `bun test` on full suite shows ~14 failures from `@neondatabase/serverless` Client import — not caused by design changes. Run `bun test src/views/__tests__/ src/lib/__tests__/{head,components,magic-link}.test.ts` to exercise just the design-system surface.
- **Stacked PRs.** If the change builds on a still-open foundation PR (e.g. Wave A+B), `git rebase` onto its branch. After foundation merges, rebase onto main and retarget the PR.

## What NOT to do

- ❌ Skip `snapshot:before` because "you remember what it looked like." Six months later, you won't.
- ❌ Verify against `localhost` and call it shipped. The verify step exists to catch deployment regressions, not local ones.
- ❌ Edit static HTML in `public/*.html` for new pages. Server-render via `renderXxx()` views so the foundation flows through.
- ❌ Inline brand hex codes. Always use `var(--fl-*)` tokens.
- ❌ Open a PR without the screenshot pair committed. The diff isn't reviewable without it.
