# FactoryLM UI Lab (disconnected)

The runnable, fixture-driven lab for the shared FactoryLM interaction shell
(`packages/factorylm-{theme,interaction,ui}`). It renders every required Phase 1
state for the public, web, mobile, and Hub profiles with **no backend**: no
auth, API, database, provider, upload, storage, or deployment code, and the
built document forbids every connection at the browser level.

Design authority: `docs/initiatives/FLM-UI-4000.md` (#3622). Plan:
`docs/superpowers/plans/2026-09-06-factorylm-unified-ui-v2-shell.md`.

## Run it

Requires **Bun 1.4.0** (`packageManager` pin). On CHARLIE use `/opt/homebrew/bin/bun`;
the `~/.bun` binary is 1.3.10 and cannot read the lockfile.

```bash
bun install --frozen-lockfile   # from anywhere in the workspace — one root bun.lock
cd apps/factorylm-ui-lab
bun run dev        # Bun's HTML dev server on index.html
bun run build      # tsc --noEmit, then a static bundle in dist/
bun run preview    # serve the built dist/index.html
bun run test       # package + lab unit tests (happy-dom)
bun run verify     # test + build + bundle budget + dependency-licence audit
bun run test:e2e   # Playwright: network/console matrix, screenshots, keyboard/mobile
bun run budget     # gzip every emitted JS asset in dist/ and enforce the 300 KB budget
```

## One workspace, one React

`packages/factorylm-*` and this lab are members of a Bun **workspace** rooted at the
repository root (`/package.json`, `/bun.lock`, `/bunfig.toml`). Two things follow,
and both used to need a bootstrap script (`bootstrap:ui`, removed in #3692's fix):

- **Members are symlinks, not copies.** `@factorylm/ui` in `node_modules` *is*
  `packages/factorylm-ui`, so a local run can never test a stale snapshot.
- **There is exactly one React.** The linker is pinned to `isolated`, so every
  installed package lives once under `node_modules/.bun/` and both the lab's
  `react` and the peer `react` linked into `packages/factorylm-ui` are the same
  directory. `@factorylm/ui` declares React only as a peer — it cannot carry its
  own copy — and `bun test ../../packages src` passes with no preparation step.

If a hook ever throws `Invalid hook call` in these suites, two Reacts are loading:
check `readlink node_modules/react` in the lab and in `packages/factorylm-ui` — they
must agree — and reinstall from the root.

## Controls and URL state

Every control is mirrored into the query string, so any state is linkable and
Playwright-addressable:

| Param | Values | Default |
|---|---|---|
| `surface` | `public` `web` `mobile` `hub` | `web` |
| `scenario` | any id in `FIXTURE_IDS` (13 fixtures) | `grounded-answer` |
| `theme` | `light` `dark` | `light` |
| `viewport` | `fluid` `390x844` `412x915` `768x1024` `1440x900` `1720x1000` | `fluid` |
| `embed` | `1` renders the shell only (used by the viewport frame) | off |

A fixed viewport renders the shell inside a same-origin `<iframe>` of that exact
size, so the shell's own media queries (the mobile drawer, the bottom sheets)
apply for real instead of being faked with container styles. **Reset scenario**
reloads the fixture through the reducer; nothing is persisted.

## What is mocked, and how honestly

`src/fake-adapter.ts` is the only `PlatformAdapter` implementation here. It is
deterministic and in-memory: photo/file pickers return the fixture attachments
(`drive-a-nameplate.jpg`, `g120-manual.pdf`), machine scan returns the next
in-scope machine, share always succeeds, and the host reports Back as handled.
Every call is listed in the **Adapter log** disclosure. Pending attachments are
labelled *not sent in this lab* because the Task 2 `mock-send` contract is
text-only by design.

## Network prohibition

`index.html` ships
`Content-Security-Policy: default-src 'self'; … connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
so `fetch`, XHR, EventSource, and WebSocket are blocked by the browser, not by
convention. `src/__tests__/app.test.tsx` additionally proves a send performs no
`fetch` call and that the adapter source contains no transport or storage symbol.

## Browser proof (Task 8)

`playwright.config.ts` starts the **static** preview of `dist/` on `127.0.0.1:4174`
(run `bun run build` first) and runs two specs in Chromium:

- `e2e/fixture-matrix.spec.ts` — for every surface × theme: the *Ask MIRA* textbox is
  visible and **no request leaves the loopback and no console error or warning is
  emitted**; for every one of the 13 scenarios: the main region and Conversation render
  clean; a mock send performs no network request. Then the screenshot matrix: the
  grounded answer at 4 surfaces × 2 themes × 5 viewports (390×844, 412×915, 768×1024,
  1440×900, 1720×1000), plus every scenario at 1440×900 (web) and 412×915 (mobile). PNGs
  land in `docs/promo-screenshots/2026-09-06_flm-ui-v2-*.png`.
- `e2e/keyboard-mobile.spec.ts` — at 412×915: Escape and the `factorylm:back` event close
  the drawer before reaching the host adapter; the drawer traps Tab and returns focus to its
  opener; a citation opens the modal source viewer as a bottom sheet and Escape returns focus
  to the citation; Enter sends while Shift+Enter keeps typing; every visible control is at
  least 44×44 CSS px; the core flow is reachable by Tab alone.

`scripts/check-build-budget.ts` gzips each emitted JS asset with `node:zlib` and fails
above 300 KB total.

Salvage and component maps: `docs/salvage-record.md` (exact heads and reuse/non-reuse
decisions for #3514, #3515, #3516, #3587, #3595, #3596) and `docs/component-adapter-map.md`
(every exported symbol, its consumers, and what each host must inject through
`PlatformAdapter`).

## What is not here yet

- Any connection to the Equipment Notebook, cascade, or persistence: Phase 3.
- `identity_dispute` as a first-class part (the merged mobile adapter emits it; the shared
  vocabulary has no member for it, so it would degrade to `unknown`). A Task 1/2 contract
  change, listed as a prerequisite for connection capability #3.
