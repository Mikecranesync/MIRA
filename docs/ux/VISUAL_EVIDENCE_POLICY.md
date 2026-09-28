# Visual Evidence Policy for UI work

**Status:** STANDING POLICY (Mike, 2026-09-12). Applies to every user-visible
UI slice in the ChatGPT-parity program and all future FactoryLM UI work.
**Companion to:** `docs/architecture/convergence/CHATGPT_PARITY_CONTRACT.md` §7.

> No user-visible UI slice is considered proven from tests alone. It requires
> screenshots from the actual implementation at the reviewed commit.

## Objective

Make it possible to visually inspect what changed without running the
application. A reviewer opens the PR and understands exactly what the user now
sees and does.

## Requirements

1. Do **not** create mockups or simulated evidence and present them as
   implementation proof.
2. Render the **actual application at the exact reviewed commit** and capture
   screenshots from that implementation.
3. For every UI slice, provide **before/after** screenshots when a meaningful
   prior state exists.
4. Capture **all important interaction states** introduced or modified by the
   slice (e.g., sidebar closed/open, thread selected, context menu open,
   rename/archive/delete, empty New Chat, populated conversation), desktop and
   mobile where applicable.
5. For mobile work, use the **Android emulator/device test environment** and
   capture the actual rendered app (`adb screencap` or the test harness).
   Where no emulator is available on the capture host, Playwright at the
   mobile viewport of the actual app is acceptable **with the limitation
   recorded** in the evidence doc.
6. For web/Hub work, use **Playwright** (or the existing browser harness) at
   deterministic viewport sizes.
7. Store durable evidence in the repo (`docs/promo-screenshots/` append-only,
   plus a per-slice evidence doc in `docs/ux/`) or attach it to the PR.
8. Every image must identify:
   - commit SHA
   - surface/build
   - device or viewport
   - route/screen
   - state being demonstrated
   - reproduction steps
9. Where practical, add visual-regression screenshot tests — but they never
   **substitute** for human-viewable screenshots.
10. Never claim visual parity or completion based only on unit tests, DOM
    assertions, or code inspection.

Stale-evidence rule: screenshots are bound to the commit SHA they record. An
image captured at an older commit is not evidence for newer code unless the
rendering-relevant paths are byte-identical between the two commits and the
evidence doc says so explicitly.
