# Task 6 report — mobile drawer, inspector sheet, keyboard, and Back behavior

## Scope delivered

- `Overlay.tsx` + `focus.ts`: one wrapper for every closable layer (navigation drawer, inspector, source viewer). A modal layer traps Tab/Shift+Tab inside itself and, when it closes, returns focus to the control that opened it. A layer that is already open when the shell mounts (the mobile drawer's Task 2 default) never steals focus, because there is no opening control to return to.
- `FactoryLMShell.tsx`: a single Back/Escape decision with the plan's closing precedence — source viewer, attachment menu, inspector sheet, navigation drawer, then `adapter.onBack()`. Escape on `document` and a `factorylm:back` document event (the hook a Capacitor host dispatches for hardware Back) share that one path, so shared code has no host dependency. One scrim, rendered only while a modal layer is open, closes the top layer on tap. The desktop sidebar is not a layer: on non-mobile profiles Escape with nothing open goes straight to the host.
- `Composer.tsx`: `composerKeyAction` — Enter sends, Shift+Enter inserts a newline, Enter during IME composition (`isComposing` or `keyCode 229`) is left to the editor. Enter on an empty draft does nothing.
- `shell.css`: every control has a 2.75 rem (44 px) minimum in both axes, the scrim uses the `--fl-scrim` token, and a `prefers-reduced-motion` block removes the drawer transition.
- `SourceViewer` now declares `aria-modal="true"`.

## TDD evidence

RED: `mobile-behavior.test.tsx` failed to import `composerKeyAction` (0 pass, 1 fail) before any implementation.

GREEN: `bun test ../../packages` → 80 pass, 0 fail (10 new). `bun run build` (tsc) exit 0. No React warnings in the log.

The 10 tests cover: source viewer → inspector → host precedence on Hub; attachment menu → drawer → host precedence on mobile via the Back event; desktop sidebar not closable; scrim closes the top modal layer; focus moves into the source viewer, wraps on Tab in both directions, and returns to the citation; the drawer traps and returns focus when opened from a control; no focus theft for the mount-open drawer; the pure key contract; Enter/Shift+Enter/IME/empty-draft behavior on the real textarea; and the CSS contract (44 px, scrim, reduced motion, no hex).

## Decisions worth reviewing

- **Modal-ness is decided by profile, not viewport.** The test DOM has no layout, so the drawer is modal (trapped, scrimmed, closable) on the `mobile` profile only; on `web`/`hub` it is the static sidebar. A `web` session on a phone-width viewport gets the drawer CSS from Task 4's media query but not focus trapping. Task 8's real-browser matrix is where viewport-driven behavior is proven; if that shows a gap, the fix is a `matchMedia` input to `topLayer`, not a second layer stack.
- **The inspector is never modal.** On Hub it is a side panel; there is no mobile inspector profile. Escape still closes it in precedence order.
- **Hardware Back is a DOM event, not an adapter method.** `PlatformAdapter.onBack()` is the host's handler for a Back the shell did not consume; the inbound signal is `document.dispatchEvent(new Event("factorylm:back"))`, exported as `BACK_EVENT`, so the Capacitor wrapper stays outside shared code.

## Verification

```text
bun test ../../packages      # 80 pass, 0 fail
bun run build                # tsc --noEmit, exit 0
git diff --check             # exit 0
```

No `packages/factorylm-theme` or `packages/factorylm-interaction` file was modified.
