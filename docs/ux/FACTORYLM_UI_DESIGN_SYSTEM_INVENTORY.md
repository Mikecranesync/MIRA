# FactoryLM UI design-system inventory

**Status:** Phase 1 archaeology (policy §7–§8, §14 Phase 1). Not a restyle.
**Policy:** `docs/ux/FACTORYLM_UI_DESIGN_POLICY.md` on PR #3748 @ `58b36e2edc8270d9b0d610cab00c5567c1ad6b2a` (working authority while draft).
**Inspected head:** `origin/main` `52b6f13d5928caaeea5dcb00984c710e8fa89c1d` (this inventory branch base).
**In-flight shared-core (read, not edited):** #3731 `feat/assistant-ui-shell-surface` @ `9469d9ba469bb683af1f2763ab85ed6f1dca0ee9`; #3737 `feat/v4-chatgpt-grammar` @ `90dc21ea09e5de6b5b232d4b32bbe9a2d1e47b75` (ACTIVE claim on #3626); #3746 camera remount @ `f8913760b814d8edadf7375662605759215c7af6`.
**Writer:** Cursor Grok cloud `bc-17cf4256-ed62-4ffd-a19f-13b0a5f2cda5`. Docs/wiki only.

Do not create another UI package, theme, shell, or component library from this document.

Classification keys: **CANONICAL** · **DUPLICATE** · **LEGACY/FROZEN** · **ONE-OFF** · **UNKNOWN**

---

## 1. Category map (policy §7)

| Category | Classification | Canonical path | Owner | Duplicates / notes | Safe to consolidate now? |
|---|---|---|---|---|---|
| Typography | CANONICAL | `docs/design/factorylm-tokens.css` `--fl-font`, `--fl-mono`, `--fl-fs*` | theme + `ui-style.md` | Package copy `packages/factorylm-theme/src/tokens.css` is byte-identical (lock-tested). Workspace aliases `--fl-workspace-font` / `--fl-workspace-fs*` in `workspace.css`. Dark marketing `--fl-dark-font` / Inter is a **separate public-site stack**, not the technician shell. | Yes for *ownership docs*. No token-value edit while #3731/#3737 hold theme. |
| Spacing | CANONICAL | tokens `--fl-space-1..8` (4/8/12/16/24/32) + `--fl-gap` / `--fl-pad` | same | Shell uses `--fl-workspace-space-*`. **ONE-OFF:** `2px` on `.fl-conversation__modes` padding and `.fl-source` `row-gap` (`conversation.css`). | Defer value cleanup until shared-core is free. |
| Colors | CANONICAL | tokens `--fl-*` surfaces/ink/line/accent + STATE ok/warn/fault/off | same | Workspace maps to `--fl-workspace-*`. Color-discipline tests already lock ok ≠ accent and dark workspace accent ≠ datasheet orange `#E67139`. | Keep tests. Do not invent new hues. |
| Borders | CANONICAL | `--fl-line` / `--fl-line-strong` + 1px solid in shell/conversation CSS | factorylm-ui stylesheets | State borders (`ok-line`, `fault-line`) are semantic, not decoration. | Keep. |
| Radii | CANONICAL tokens / ONE-OFF overuse | `--fl-radius` 8px, `--fl-radius-sm` 6px, `--fl-radius-card` 16px, `--fl-radius-pill` 999px | tokens | `--fl-radius-card` is applied to composer row, user bubbles, `.fl-card`, `.fl-run`, `.fl-error`, `.fl-safety`, `.fl-attachment-menu`. Policy denylist: giant rounded cards. | Defer. Changing `--fl-radius-card` is high leverage and needs shared-core. |
| Shadows / elevation | CANONICAL tokens / ONE-OFF always-on | `--fl-shadow`, `--fl-shadow-pop` | tokens + `conversation.css` / `shell.css` | `shadow-pop` on mobile drawer/inspector is overlay elevation (justified). **Always-on** `shadow-pop` on `.fl-composer__row` is an arbitrary persistent elevation. Mode-toggle uses `--fl-workspace-shadow`. | Defer composer elevation until shared-core is free. |
| Icons | CANONICAL | `packages/factorylm-ui/src/icons.tsx` (inline SVGs) | factorylm-ui | Composer still uses text glyphs `＋` / `⌁` (`Composer.tsx`). No second icon package. | KEEP icons.tsx. Do not add lucide/sparkle sets. |
| Button | UNKNOWN as a primitive / ONE-OFF in use | None. Controls inherit `.fl-shell button` in `shell.css` | factorylm-ui | Every action (new-chat, inspector toggle, followups, composer send, errors) restyles the same raw `<button>`. No `Button` export in `index.ts`. | CONSOLIDATE after #3737 lands. Do not add shadcn Button. |
| Inputs | CANONICAL-ish | `.fl-shell__search input`, composer `<textarea>` | Sidebar + Composer | Two treatments, both token-backed. No shared `Input` component. | DEFER a shared Input until Button exists. |
| Composer | CANONICAL | `packages/factorylm-ui/src/Composer.tsx` + `.fl-composer*` | factorylm-ui | #3746 rewires `onCamera` → `attachCamera`. #3737 does not replace the textarea (device-proven IME). | KEEP Composer. Do not swap in assistant-ui input. |
| Sidebar / navigation | CANONICAL | `Sidebar.tsx`, `ProjectTree.tsx`, `.fl-shell__sidebar`, `.fl-tree__*` | factorylm-ui | One row pattern is already documented in `shell.css`. | KEEP. Do not prettier frozen Hub nav. |
| Sheets / dialogs | CANONICAL | `Overlay.tsx` layers: source, attachment-menu, inspector, navigation | factorylm-ui | Attachment menu is popover on web / bottom sheet on mobile (`conversation.css`). Source viewer is a side panel / sheet. | KEEP Overlay. No second dialog kit. |
| Messages / content | CANONICAL on main / DUPLICATE in flight | `Conversation.tsx` + `parts.tsx` + `.fl-turn*` | factorylm-ui | #3731/#3737 add `packages/factorylm-ui/src/assistant/AssistantThread.tsx` beside `Conversation.tsx`. **Competing conversation renderers.** | STOP: do not invent a third. Adopt or retire after those PRs. |
| Citations | CANONICAL | `.fl-source*` in `conversation.css`; `PartRenderer` in `parts.tsx` | factorylm-ui | #3731 host `renderText` adds inline `[n]` marks. Compact citation card is token-backed. `row-gap: 2px` is off-scale. | KEEP pattern. Defer 2px. |
| Machine / asset context | CANONICAL-ish / ONE-OFF chrome | `machineName()` / `describeContext()` in `parts.tsx`; `.fl-chip` + composer machine button | factorylm-ui | No `MachineContext` component. Same facts appear as breadcrumb chip **and** composer `⌁` control. | CONSOLIDATE into one context chip later. Do not dashboard-ify no-machine. |
| Status presentation | CANONICAL | STATE tokens + `.fl-pill`, `.fl-status`, run/step borders | factorylm-ui | `.fl-pill--primary` is **ok-state** (tested), not accent decoration. Tree status dots use ok/warn/off. | KEEP semantic status. Do not add extra badges. |
| Empty states | ONE-OFF | `.fl-conversation__empty` (“No turns yet.”), `.fl-conversation__notice`, `.fl-shell__empty`, `.fl-shell__placeholder` | Conversation / Shell | #3737 replaces empty Ask with greeting + suggestion chips. | CONSOLIDATE one EmptyState after #3737. |
| Loading states | ONE-OFF / UNKNOWN | `aria-busy` on composer controls; run `data-run-status="running"` | Composer / RunCard | No shared LoadingState. | DEFER. Do not add skeletons. |
| Error states | ONE-OFF / DUPLICATE in flight | `.fl-error`, `.fl-composer__failure`, `.fl-composer__sync` | conversation.css | #3737 adds humane `SendError`. | CONSOLIDATE after #3737. |
| Ask / Work transitions | CANONICAL grammar / DUPLICATE risk | `Conversation.tsx` mode toggle `.fl-conversation__modes`; `data-mode` | Conversation | Same stylesheet on main. Work empty is a notice; Ask empty is a paragraph. Policy: one product. | Do not fork Work styling. Fold Work into the same empty/content grammar as Ask. |

---

## 2. Shared-core locations (cutover charter)

| Path | Role |
|---|---|
| `packages/factorylm-theme/**` | Tokens + `workspace.css` semantic aliases |
| `packages/factorylm-interaction/**` | Types, fixtures, reducer, `PlatformAdapter` |
| `packages/factorylm-ui/**` | Shell, conversation, composer, nav, overlays |
| `apps/factorylm-ui-lab/**` | Disconnected fixture lab |

These four roots are **one writer lane**. Active shared-core writer as of 2026-09-11: **#3737** (`charlie-disk-memory-reclamation`). #3731 released the lane to #3737. #3746 also edits `Composer.tsx` + `adapters.ts`.

### Token source of truth (documentary conflict, files identical)

| Claim | File |
|---|---|
| `.claude/rules/ui-style.md` | `docs/design/factorylm-tokens.css` is canonical |
| File header in both copies | “CANONICAL FILE” |
| Package lock | `packages/factorylm-theme/src/__tests__/theme-contract.test.ts` requires the package copy to be **byte-identical** to `docs/design/factorylm-tokens.css` |

**Disposition:** KEEP both files + the lock test. Edit `docs/design/factorylm-tokens.css` first, then sync the package copy. Do not fork a third token file.

### Canonical components on `main` (exported from `packages/factorylm-ui/src/index.ts`)

`FactoryLMShell`, `Sidebar`, `ProjectTree`, `Conversation`, `Composer`, `Overlay`, `Inspector`, `SourceViewer`, `ThreadHeader`, `PartRenderer`, focus helpers.

No `Button`, `Input`, `EmptyState`, `ErrorState`, or `MachineContext` export.

### Adapters (canonical hosts, not a second shell)

- `mira-mobile/src/unified/**`
- Exact hosts: `mira-mobile/src/screens/UnifiedChat.tsx`, `UnifiedRoot.tsx`
- Future adapters: `mira-*/src/factorylm-ui/**`

### LEGACY/FROZEN (do not prettier)

Guarded trees in `docs/architecture/convergence/REGISTRY.yaml` / `.claude/rules/factorylm-unified-ui-cutover.md`: Hub `mira-hub/src/components/**` + `app/**`, public `mira-web` presentation, classic mobile screens. Classic Workorders is **continuity evidence**, not a rewrite target.

---

## 3. KEEP / CONSOLIDATE / RETIRE / DEFER

### KEEP

- Dual token files with the existing byte-identity lock test.
- `workspace.css` alias layer (no hex in workspace aliases; already tested).
- `FactoryLMShell` + `Sidebar` + `ProjectTree` row grammar.
- MIRA-owned `Composer` textarea (IME/Enter contract).
- `Overlay` layer stack and scrim precedence.
- `icons.tsx` as the only icon family.
- Color-discipline tests (ok vs accent; dark workspace accent ≠ marketing orange).
- Frozen legacy presentation as rollback. Do not restyle it for catalog screenshots.
- assistant-ui as **behavior** infrastructure where #3731/#3737 already adopted it. Visual identity stays FactoryLM tokens.

### CONSOLIDATE (after shared-core claim is RELEASED)

1. **Control primitive** — extract variants from `.fl-shell button` (quiet / bordered / accent-send / destructive). One primitive fixes new-chat, inspector, followups, composer, errors.
2. **Empty / loading / error** — one pattern each, replacing the current paragraph/notice/placeholder/failure set. Align Ask and Work.
3. **Machine context** — one chip/control, not bar-chip plus composer `⌁` plus header title.
4. **Conversation renderer** — `Conversation.tsx` **or** `assistant/AssistantThread.tsx`, not both forever. Wait for #3731/#3737. Do not add a third.

### RETIRE

- Nothing this pass.
- Do **not** retire `Conversation.tsx` until AssistantThread is default and device-proven.
- Do **not** retire `--fl-dark-bg-glass` (marketing sticky-nav). Keep it **off** the workspace shell.
- Do **not** retire classic Workorders.

### DEFER

- Any edit to `packages/factorylm-*` or `apps/factorylm-ui-lab/**` while #3731/#3737/#3746 are open writers.
- Token value changes (`--fl-radius-card`, composer `shadow-pop`, off-scale `2px`).
- Screen-by-screen cleanup of the 12-state catalog.
- Figma mapping (policy §15). Repo remains authority.
- Installing shadcn / TweakCN / avoid-ai-design / a new icon pack.
- Camera human-tap proof and `What is a VFD?` no-machine Ask (acceptance, not design-system).
- Lifecycle exceptions to prettier frozen Hub/web/mobile trees.

---

## 4. AI-slop audit (traced render, not keyword count)

Inspected stylesheets that actually paint the unified shell on `main`: `packages/factorylm-ui/src/shell.css`, `conversation.css`; tokens via `workspace.css`. No `linear-gradient`, `backdrop-filter`, `blur(`, glow, sparkle, or orb in those stylesheets.

| # | Finding | Category (policy §5) | Leverage |
|---|---|---|---|
| 1 | No Button primitive; every control restyles `.fl-shell button` | one-off buttons | Fixes every chrome control once #3737 lands |
| 2 | `--fl-radius-card` (16px) on composer, bubbles, cards, run, error, safety, attachment menu | excessive rounded cards | One token / one mapping decision |
| 3 | `.fl-composer__row` always uses `--fl-workspace-shadow-pop` | arbitrary shadows | Composer is on every Ask/Work state |
| 4 | `.fl-chip`, `.fl-pill`, follow-up `radius-pill` | unnecessary pills / badges | Machine chip is meaningful; follow-up pills are decorative shape |
| 5 | `2px` mode-toggle padding and citation `row-gap` | arbitrary spacing | Small, mechanical, many states |
| 6 | `--fl-dark-bg-glass` lives in the shared token file | glassmorphism (latent) | Keep off workspace; do not import into shell |
| 7 | `Conversation` vs `AssistantThread` | duplicate navigation / message treatments | Competing systems — stop, do not invent a third |
| 8 | Empty Ask / Work notice / shell empty / placeholder are four copy+class pairs | unrelated Ask vs Work / missing canonical empty | One EmptyState pattern |
| 9 | Machine facts in breadcrumb chip **and** composer machine button | duplicate chrome | One MachineContext |

**Count:** 9 systemic findings. **0** decorative gradient / glow / blur / sparkle occurrences in current `factorylm-ui` CSS.

Guard: `tests/factorylm_ui/test_unified_shell_denylist.py` fails if `shell.css` / `conversation.css` gain gradient, backdrop-filter, blur, drop-shadow, glow, or sparkle, or if `workspace.css` binds `--fl-dark-bg-glass` or a hex literal.

Indigo `--fl-accent: #4f46e5` is the **workspace action/selection** token, not a gradient. Changing it is a brand decision, not this inventory.

---

## 5. Top 5 systemic cleanup opportunities

1. **Keep a single token owner** (`docs/design/factorylm-tokens.css` → package copy + lock test). Prevents a second vocabulary.
2. **Button / control primitive** derived from `.fl-shell button` after #3737. Highest consumer count.
3. **Composer elevation + radius** (`shadow-pop` + `radius-card` on the always-visible row). Visible on every catalog Ask/Work frame.
4. **One empty / loading / error pattern** shared by Ask and Work (and shell placeholders).
5. **One conversation renderer** — finish or retire assistant-ui vs classic `Conversation`. Do not add a third surface.

---

## 6. First implementation slice (this PR)

**Scope:** this inventory + catalog wiki stub + completeness and denylist tests under `tests/factorylm_ui/`.

**Why:** Phase 1 must exist before token/primitive edits. Shared-core is already claimed. A docs lock prevents the next agent from inventing a second library.

**Not in this slice:** any `packages/factorylm-*` edit, screen restyle, merge, deploy, OTA, Pixel-ready claim.

---

## 7. Stop conditions hit

| Condition | Result |
|---|---|
| Two conversation systems compete (`Conversation` vs `AssistantThread`) | **STOP restyle.** Report only. |
| Shared-core writer ACTIVE (#3737, also #3746 on Composer) | **STOP package edits.** |
| Token “CANONICAL” claimed in two paths | **Not a value conflict** — files are identical and lock-tested. Documented, not forked. |
| Frozen legacy prettier | **Not attempted.** Classic Workorders stays evidence-only. |
| Camera / VFD | Remain **OPEN**. Not claimed from screenshots. |
