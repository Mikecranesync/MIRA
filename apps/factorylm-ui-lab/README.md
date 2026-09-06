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
cd apps/factorylm-ui-lab
bun install --frozen-lockfile
bun run dev        # Bun's HTML dev server on index.html
bun run build      # tsc --noEmit, then a static bundle in dist/
bun run preview    # serve the built dist/index.html
bun run test       # package + lab unit tests (happy-dom)
bun run verify     # test + build + dependency-licence audit
```

`bootstrap:ui` runs before every script. Besides installing the UI package's own
toolchain it does two things a plain install does not: it replaces Bun's
install-time **copies** of the `file:` packages with symlinks to the real package
directories (so a local run never tests a stale snapshot), and it points the UI
package's package-local React at the lab's single copy (so there is exactly one
React instance and hooks work). Both are explained in `scripts/bootstrap-ui.ts`.

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

## What is not here yet

- Playwright screenshot matrix, accessibility checks, and the compressed-bundle
  budget (`300 KB`): Task 8.
- Any connection to the Equipment Notebook, cascade, or persistence: Phase 3.
