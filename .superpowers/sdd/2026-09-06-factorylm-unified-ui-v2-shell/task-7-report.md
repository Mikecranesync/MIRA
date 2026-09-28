# Task 7 report — runnable disconnected lab and scenario controls

## Scope delivered

- `apps/factorylm-ui-lab/index.html` — the built document, with the plan's exact CSP (`default-src 'self'; … connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`) and a single module entry.
- `src/main.tsx`, `src/App.tsx`, `src/lab.css` — the lab: labelled Surface / Scenario / Viewport selects, a Theme toggle, Reset, and an Adapter log disclosure. Every control is mirrored into the query string (`?surface=&scenario=&theme=&viewport=`), so any state is linkable and Playwright-addressable. A fixed viewport (`390x844`, `412x915`, `768x1024`, `1440x900`, `1720x1000`) renders the shell inside a same-origin `<iframe>` of that size with `embed=1`, so the shell's real media queries apply instead of being faked.
- `src/fake-adapter.ts` — the only `PlatformAdapter` here: deterministic fixture attachments, next-in-scope machine on scan, share succeeds, host handles Back; every call logged. No transport, storage, or endpoint symbol (asserted by test).
- `scripts/build.ts` — removes only the explicit local `dist/`, then `Bun.build` with `index.html` as the entrypoint. `scripts/preview.ts` — serves `dist/` as plain files.
- `README.md` — run, controls, URL state, what is mocked, the CSP, and what Task 8 / Phase 3 still owe.
- `packages/factorylm-ui/src/Composer.tsx` — the message field's accessible name is now **Ask MIRA** (the plan's Task 7 and Task 8 both address it as `inputNamed("Ask MIRA")` / `getByRole("textbox", { name: /ask mira/i })`); the two test files that selected `aria-label="Message"` were updated.

## TDD evidence

RED: `bun test src/__tests__/app.test.tsx` → `Cannot find module '../App'`, 0 pass / 1 fail.

GREEN: `bun test ../../packages src` → **90 pass, 0 fail** (10 lab tests: URL parsing and rejection of unknown values, the plan's viewport set, labelled controls and the full scenario list, reducer-driven surface/scenario/theme switching mirrored to the URL, the fixed-viewport iframe and embed mode, in-memory send with `fetch` forbidden, reset, the adapter's determinism and transport-free source, and the CSP in the built document). `bun run build` → tsc exit 0 and a static `dist/` (index.html 655 B, JS chunk 442 KB uncompressed, CSS 27 KB). The compressed 300 KB budget check is Task 8's.

## Browser proof

The built `dist/` was served statically and loaded in Chromium: `?surface=hub&scenario=work-run` at 1440×900 and `?surface=mobile&scenario=machine-ask&theme=dark` at 412×915 both render every landmark (lab controls, navigation, Conversation with the Diagnostic Run, Composer with the *Ask MIRA* textbox) with **zero console errors or warnings**. Screenshots: `docs/promo-screenshots/2026-09-06_flm-ui-v2-lab-hub-work-run_desktop.png` and `…-mobile-machine-ask-dark_mobile.png`.

## Findings fixed on the way (not in the plan, worth knowing)

1. **Stale package mirrors.** Bun materialises a `file:` dependency by copying the package into `node_modules`, and a frozen re-install does not refresh the copy. The lab's mirror of `@factorylm/ui` still held the Task 4 shell while Task 5/6 sources had moved on, so a local run silently tested a stale snapshot (CI's fresh install never showed it). `scripts/bootstrap-ui.ts` now replaces each mirror with a symlink to the package directory, in the lab and inside `packages/factorylm-ui`.
2. **Two Reacts.** `@factorylm/ui` carries a package-local React for its own toolchain; Bun resolves `react` from a package file's physical path, so the lab loaded a second instance and every hook threw "Invalid hook call". The bootstrap now points the package-local `react`, `react-dom`, and `scheduler` at the lab's copies (symlinks resolve to one real path, hence one instance) and fails loudly if the pinned versions ever differ. A Bun runtime resolver plugin was tried first and did not intercept these imports under `bun test`; it was removed rather than left half-working.
3. **`bun ./dist/index.html` is a dev server, not a preview.** It injects an inline HMR script and a websocket, both of which the lab's CSP correctly blocks (two console errors). `preview` is now a static `Bun.serve` over `dist/`, which is what a static host ships. The plan's `preview` wording was followed in intent, not letter.
4. **happy-dom does not reflect `history.replaceState` into `window.location`.** `App` takes optional `search` / `onSearch` props (defaults: the document location and `replaceState`) so the mirror logic is unit-tested; real URL behavior is covered by the browser proof above and by Task 8's Playwright matrix.

## Verification

```text
bun install --frozen-lockfile      # lab lockfile unchanged
bun run test                        # 90 pass, 0 fail
bun run build                       # tsc exit 0, dist/ emitted
bun run preview + Chromium          # 0 console errors at 1440x900 and 412x915
git diff --check                    # exit 0
```

`packages/factorylm-theme` and `packages/factorylm-interaction` were not modified.
