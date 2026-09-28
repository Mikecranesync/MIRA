# Task 8 report — browser matrix, accessibility, performance, and salvage record

## Scope delivered

- `playwright.config.ts` — Chromium against the **static** preview of `dist/` on `127.0.0.1:4174` (no dev server, no HMR), one worker, junit + list reporters.
- `e2e/fixture-matrix.spec.ts` — for every surface × theme (8): the *Ask MIRA* textbox is visible, **no request leaves the loopback**, and **no console error or warning** is emitted. For each of the 13 scenarios: `main` and the Conversation region render clean. A mock send performs no network request. Screenshot matrix: the grounded answer at 4 surfaces × 2 themes × 5 viewports (390×844, 412×915, 768×1024, 1440×900, 1720×1000) = 40 PNGs, plus every scenario at 1440×900 (web) and 412×915 (mobile) = 26 PNGs; all 66 in `docs/promo-screenshots/2026-09-06_flm-ui-v2-*.png` (4.5 MB).
- `e2e/keyboard-mobile.spec.ts` — at 412×915: Escape and the `factorylm:back` document event close the mount-open drawer before the host adapter is consulted, and the adapter log records `onBack` only once nothing is open; the drawer traps Tab across 40 presses and returns focus to its opener; a citation opens the modal source viewer as a bottom sheet (bounding box reaches the viewport's bottom edge) and Escape returns focus to the citation; Enter sends while Shift+Enter inserts a newline; every visible control on three scenarios is at least 44×44 CSS px; Ask, Work, a citation, the composer, and Add attachment are all reached by Tab alone.
- `scripts/check-build-budget.ts` — gzips each emitted JS asset with `node:zlib`, prints the exact total, exits non-zero above 300 KB. Result: **130,313 B gzip of 307,200 B**.
- `docs/salvage-record.md` and `docs/component-adapter-map.md` — cherry-picked from the peer session's #3631 (`b77e4d4ab`, heads verified against the plan's pins). The map's `onBack` paragraph and mobile cell were amended for Task 6 (the shell closes layers itself; the adapter sees only the pass-through case).
- `package.json` — `budget` script; `verify` now runs test → build → budget → licences; `test:e2e` bootstraps first. README gained the browser-proof section and the `identity_dispute` gap.

## Verification

```text
bun run verify          # 90 pass / 0 fail; tsc exit 0; dist/ emitted; budget 130313 B ≤ 307200 B; licence audit: 23 external manifests, all MIT/Apache-2.0
bun run test:e2e        # 94 passed (12.3 s), 0 failed — after `bunx playwright install chromium` (build 1217 for Playwright 1.59.1)
grep transport sweep    # no fetch(/XMLHttpRequest/EventSource/WebSocket/http(s):// in any package or lab source (tests excluded)
git diff --check        # exit 0
```

The licence audit count moved from 26 to 23 because `bootstrap:ui` now dedupes React: the UI package's `react`, `react-dom`, and `scheduler` are symlinks to the lab's copies and are counted once. Every manifest is still MIT or Apache-2.0.

## Phase 1 acceptance gate (docs/initiatives/FLM-UI-4000.md), item by item

1. Same implementation renders public, signed-in, mobile, Hub — one `FactoryLMShell`; matrix tests on all four. ✅
2. Desktop, tablet, 412×915 mobile screenshots in light and dark — 66 PNGs. ✅
3. Keyboard-only navigation and screen-reader labels — Tab-only spec; every control carries an accessible name (harness and specs select by role/name). ✅
4. Mobile drawer/sheet/Back/keyboard tested — `keyboard-mobile.spec.ts` in Chromium plus 10 happy-dom tests. ✅
5. Every required fixture renders without console errors — 13 scenarios, zero console errors/warnings, zero page errors. ✅
6. Nested folders and canonical machine links — Task 4, re-proven by the matrix. ✅
7. Ask and Work share the same shell — Task 5 tests + `work-run` matrix. ✅
8. No production network request possible — CSP `connect-src 'none'` in the built document, loopback-only assertion per surface. ✅
9. PR lists exactly what was salvaged and what was not — `docs/salvage-record.md`. ✅
10. Mike can review the complete experience with no backend — `bun run build && bun run preview`, or any `?surface=&scenario=&theme=&viewport=` URL. ✅

## Unresolved product decisions (carried into the PR body)

- **`identity_dispute`** — the merged mobile adapter emits it; the shared `InteractionPart` vocabulary has no member for it, so it would render as an `unknown` disclosure. Needs a Task 1/2 contract change (new member + fixture) before connection capability #3.
- **Pending attachments are composer-local** — `mock-send` is text-only by the Task 2 contract; production send needs an attachment-bearing turn contract.
- **Modal-ness is decided by profile, not viewport** — a `web` session at phone width gets the drawer CSS but not focus trapping. If the Hub private preview on a narrow window needs it, add a `matchMedia` input to `topLayer`.
- **Codex adversarial review** could not run today (quota exhausted until 2026-09-07 06:02); Tasks 6–8 ship reviewed only by the gates above until the lane reopens.

## Not done, and why

- `wiki/hot.md` was not edited: the repository's shared-file guard forbids feature-branch edits to it; this report and the PR body are the continuity record.
- Accessibility was proven with role/name queries, focus assertions, and target-size measurement, not axe-core, which the plan excludes for licence reasons.
