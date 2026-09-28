# Slice C — Composer parity: audit + visual evidence packet

**Parity authority:** `docs/architecture/convergence/CHATGPT_PARITY_CONTRACT.md` §5 Gap 3 / §6 Slice C
**Policy:** `docs/ux/VISUAL_EVIDENCE_POLICY.md`
**Lane:** PR #3757, branch `v7/chatgpt-ui-replacement`
**Commit SHA at capture:** `ad27f0d49` (working tree clean)
**Date:** 2026-09-12

## Audit result — one real defect, one-line fix

The canonical composer already met almost the whole release standard
(audited before editing; nothing rewritten to manufacture a diff):

| Release requirement | Pre-existing state | Evidence |
|---|---|---|
| Single clean primary composer (`+ / input / send`) | PASS (Slice 1) | frames 1, 8 |
| Enter sends · Shift+Enter newline · IME-safe | PASS (`composerKeyAction`, unit-tested) | code + suite |
| Send disabled when empty or busy | PASS | frame 4 + DOM check `sendDisabledWhenEmpty: true` |
| Stop replaces Send while streaming | PASS | frame 3 (live stream) |
| Attachment `+` sheet (Photo/File/Camera/Scan) | PASS | frames 5, 10 |
| Adapter failure → plain-language inline error | PASS (`describeFailure`) | code |
| Pending attachments scoped to their thread | PASS | code (`threadId` filter) |
| Sticky composer + `env(safe-area-inset-bottom)` | PASS | `conversation.css:151` |
| Offline/sync status strip | PASS | code |
| No duplicate composer in canonical mode | PASS — legacy `<textarea>` renders only in `chatSurface === "legacy"`; chromeless+unified renders the shell surface exclusively (`NotebookScreen.tsx:237,818,868`) | code |
| Blank New Chat presentation | PASS | frames 1, 7 |
| **Multiline growth (ChatGPT autogrow)** | **FAIL — textarea was fixed-height; long text clipped/scrolled internally** (visible in Slice 1's `…composer-multiline_mobile.png`) | before-frame |

**The fix (commit `ad27f0d49`):** one CSS declaration — `field-sizing: content`
on `.fl-composer__row textarea`, keeping the existing 2.75rem–7.5rem bounds.
Platform primitive, no JS autosize, no new architecture
(commodity-before-custom). Engines without support (older iOS WebKit) keep
the previous fixed-height behavior unchanged; **Android WebView — the Pixel
release target — supports it** (DOM-verified below).

## Capture setup

Same rig as Slice B (recorded per policy): live `mira-mobile` dev build at
`http://localhost:5199/` against **production** `app.factorylm.com`
(magic-link session), Playwright Chromium at **412×915**; lab
(`?surface=web…&embed=1`) at **1440×900** for the desktop surface.
*Limitation: no Android emulator on this host — mobile frames are the actual
Capacitor webview content at mobile viewport, not a device screencap.*

## Frames (`docs/promo-screenshots/2026-09-12_sliceC-*`)

| # | File (suffix) | Surface | Viewport | State | Reproduction |
|---|---|---|---|---|---|
| 1 | `blank-newchat-empty-composer_mobile` | Live app + prod | 412×915 | Blank New Chat, empty 1-line composer, send disabled | Sign in → unified pref → `/` |
| 2 | `multiline-grown-composer_mobile` | Live app + prod | 412×915 | **AFTER: 6-line question fully visible, box grown to the 7.5rem cap** — compare Slice 1's clipped before-frame. DOM at capture: height 44px→120px, `getComputedStyle(...).fieldSizing === "content"` | Type the 2-sentence VFD/F0004 question |
| 3 | `streaming-stop-state_mobile` | Live app + prod | 412×915 | ■ Stop replaces send while a real answer streams; composer cleared | Send follow-up in mounted conversation; frame taken the moment Stop appears |
| 4 | `answer-complete-send-restored_mobile` | Live app + prod | 412×915 | Stream done: full markdown answer + "General guidance — not grounded" label + suggestion chip; Send restored, disabled-empty (DOM: `true`) | Wait for stream end |
| 5 | `attachment-menu-open_mobile` | Live app + prod | 412×915 | `+` sheet: "Add to message · Photo · File · Camera · Scan machine" | Tap `+` |
| 6 | `sidebar-after-answer_mobile` | Live app + prod | 412×915 | Drawer over the answered conversation (journey step) | Tap ☰ |
| 7 | `fresh-new-chat-again_mobile` | Live app + prod | 412×915 | Second fresh New Chat after visiting another thread; composer empty (DOM: `true`) | Drawer → other thread → drawer → New chat |
| 8 | `composer-empty_desktop` | Lab fixtures | 1440×900 | Desktop composer, 48rem-centered, machine placeholder | Load grounded-answer scenario |
| 9 | `composer-multiline-grown_desktop` | Lab fixtures | 1440×900 | 3-line text grows box to 70px (under cap — proportional growth) | Paste 3-line question |
| 10 | `attachment-popover_desktop` | Lab fixtures | 1440×900 | Web-profile anchored `+` popover | Click `+` |

## Basic interaction loop (acceptance §8) — executed live, this commit

New Chat → typed question → send → **real streamed answer received** (VFD +
F0004, markdown, evidence label) → ☰ → selected another thread ("Test";
content verified by contactor text in DOM) → ☰ → **New chat** → fresh empty
composer. All against production backend. Caveat: on prod (no 087) the
fresh chat still *displays* the notebook's old turns on reopen — the known
P0 deployment gap owned by the peer lane; composer behavior itself is
unaffected.

## Verdicts

- Gap 3 items above: **PASS** except device-keyboard behavior (transition
  animations/IME on a physical Pixel): **UNVERIFIED on device** — needs the
  Pixel/emulator pass; browser-viewport evidence is not claimed as device
  proof.
- No new store/parser/root UI; diff = 1 CSS line.
- Suites at `ad27f0d49`: shared UI 210/210 (bun 1.4.0), `mira-mobile`
  `tsc --noEmit` 0 errors.
