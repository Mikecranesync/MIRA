# Visual Proof Runbook

Use this runbook when a change has visible UI, presentation, or marketing
impact. It replaces the root `CLAUDE.md` screenshot procedure.

## When Required

Capture visual proof for:

- Visible `mira-web`, `mira-hub`, kiosk, Ignition Perspective, or marketing
  surface changes.
- Before/after comparisons where layout, copy, state, or data display is the
  thing being reviewed.
- PRs whose acceptance criteria mention screenshots, Playwright proof, mobile
  proof, or promotional material.

Documentation-only PRs do not need screenshots unless they change rendered
site content or visual assets.

## Capture Standard

- Desktop viewport: `1440x900`.
- Mobile viewport: `412x915`.
- Save durable proof screenshots under `docs/promo-screenshots/`.
- Filename format: `YYYY-MM-DD_feature-name_viewport.png`.
- Prefer real data and authenticated flows when that is what the user or PR
  needs to inspect.

## Archive Rule

`docs/promo-screenshots/` is append-only. Do not delete or overwrite existing
proof assets as part of a routine UI change. Use a new dated filename.

## Reporting

Include the screenshot paths or Playwright artifact paths in the PR body when
visual proof is part of acceptance. If authentication, a staging dependency, or
hardware blocks capture, say exactly what was blocked and what proof was still
collected.
