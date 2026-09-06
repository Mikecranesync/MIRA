# Task 5 report — conversation parts, Ask/Work, and universal composer

## Scope delivered

- Added `Conversation`: the ordered turn log for the shared shell, with the project/folder breadcrumb, the Ask/Work mode switch, and the active-machine chip the PRD places above the thread (§6.2). Work mode renders the `InteractionRun` as one structured **Diagnostic Run** card inside the same conversation; there is no second chat tree. Every turn renders its own captured `context` (machine, identity) so a historical turn keeps its Drive A context after the active context moves to Drive B.
- Added `PartRenderer` (`parts.tsx`): an exhaustive `switch (part.type)` with an `assertNever` guard over all 21 PRD part types. The `unknown` part renders as an inspectable `<details>` disclosure and never crashes the thread. `machine_evidence` is labelled **LIVE** or **RECORDED** from `evidence.source`; `safety_notice` is a `role="alert"` block with no success chrome; `error` offers Retry only when the turn is `failed` and the error is retryable, dispatching the reducer's `retry`; `followups` fill the shared draft; `artifact` shares through `PlatformAdapter.shareArtifact`.
- Added `Composer`: one `<form aria-label="Composer">` for every profile with labelled message, add-attachment, machine, voice, and send controls. Photo/File route to the adapter; Camera and Scan machine are honestly disabled off-device with a title explaining why; Voice is disabled everywhere because the Phase 1 adapter has no voice capability; Send dispatches `mock-send`. The offline/sync state is rendered as a status line. Placeholder text is the approved prototype's `Ask MIRA about this machine…`.
- Added `SourceViewer`: a reducer-backed `role="dialog"` citation panel with Close, honest that document content is not connected in the disconnected lab.
- Added `conversation.css`: `--fl-workspace-*` tokens only, a `prefers-reduced-motion` block, a mobile bottom-sheet variant of the source viewer, and 2.75 rem (44 px) minimum control sizes inherited from `shell.css`.
- `FactoryLMShell` now mounts Conversation, Composer, and SourceViewer in place of the Task 4 placeholder and exposes `data-mode`. `New chat` remains disabled (no reducer action).

## TDD evidence

RED (before any component existed):

```text
bun test ../../packages/factorylm-ui/src/__tests__/conversation.test.tsx ../../packages/factorylm-ui/src/__tests__/composer.test.tsx
0 pass, 24 fail, 8 expect() calls
```

GREEN:

```text
bun test ../../packages
65 pass, 0 fail
```

The 24 new tests cover: every fixture on every surface renders each turn and each part in the fixture's order; safety stop without success chrome; LIVE vs RECORDED evidence labels; the preserved unknown part; historical-turn context retention; evidence basis and follow-ups; citation → source viewer → close; attachment kinds and sync status; retry only for retryable failures; offline state; the Diagnostic Run card with plan steps, completion criteria, candidate finding, tool card, and artifact; Ask/Work switching without a second tree; artifact share through the adapter; the tokens-only stylesheet; the same labelled composer controls on all four profiles; draft → reducer → mock send; the prototype placeholder and machine naming; attachment menu → adapter; honest native-only gating; scan → adapter → `select-machine`; and the off-device machine control opening navigation.

## Deviations from the task file list

- `packages/factorylm-ui/package.json` gained a `./conversation.css` export so the lab (Task 7) can link the stylesheet the same way it links `shell.css`.
- `__tests__/harness.tsx` (a test file) was extended: the fake adapter records calls and accepts canned results; the harness output exposes draft, mode, retry target, and turn count; helpers for typing, submitting, and flushing async adapter calls were added.
- `__tests__/shell.test.tsx` no longer asserts the Task 4 placeholder; it asserts the Conversation landmark and the Composer form instead. The `New chat` disabled assertion is unchanged.

## Design decisions worth reviewing

- **Pending attachments are composer-local state.** The Task 2 reducer has no attachment action and `mock-send` is text-only, so an adapter-returned attachment is shown as `pending · not sent in this lab` rather than silently dropped or simulated as sent. Adding a reducer action is a Task 2 contract change and was not made here.
- **Mode switch renders on mobile.** The prototype hides the Ask/Work switch in the mobile threadbar; the plan's global constraint that Ask and Work share one shell and composer on every profile wins, so the switch is rendered on all four surfaces and compacts via CSS.
- **Machine control off-device opens navigation** (where machines are selected through the reducer's scope rules) instead of a second machine picker; on a native device it scans through the adapter and dispatches `select-machine`, which the reducer still validates against the active scope.
- **Left for Task 6 by design:** Enter/Shift+Enter/IME (`composerKeyAction`), Escape/hardware Back, focus trap and focus return for the source viewer and attachment menu, scrim.

## Verification

Run from `apps/factorylm-ui-lab` with Bun 1.4.0 (`/opt/homebrew/bin/bun`; the `~/.bun` 1.3.10 binary cannot parse the pinned lockfile):

```text
bun install --frozen-lockfile                                     # exit 0
bun test ../../packages                                            # 65 pass, 0 fail
bun run build                                                      # tsc --noEmit, exit 0
bun run licenses                                                   # 26 external manifests, all MIT/Apache-2.0
git diff --check                                                   # exit 0
```

The full test log contains no React `act`, key, or console warnings.

## Contract verification

CodeGraph is not initialized in this worktree. Direct source checks confirmed every consumed interaction symbol and its shape: `InteractionPart` (21 variants + `unknown`), `InteractionTurn`, `InteractionRun`, `ContextSnapshot`, `Attachment`, `PlatformAdapter` (`attachPhoto`, `attachFile`, `scanMachine`, `shareArtifact`, `onBack`), `ShellState` (`draft`, `mode`, `run`, `selectedSource`, `retryTargetTurnId`, `attachmentMenuVisible`, `offline`), and the reducer actions `set-mode`, `set-draft`, `mock-send`, `retry`, `select-source`, `select-machine`, `set-attachment-menu-visible`, `set-navigation-visible`.

No `packages/factorylm-theme` or `packages/factorylm-interaction` file was modified.
