---
name: Design-change screenshot routine
description: Before/after screenshot pair required for any visible mira-web UI change; commit pair into docs/design-history/ for visual diff audit
type: feedback
originSessionId: abc33d2a-08e9-476c-84a5-cc7b3164863d
---
For any visible UI change in `mira-web` (new view, restyled component, copy/layout edit on `/`, `/cmms`, `/pricing`, `/limitations`, etc.), capture a before/after screenshot pair and commit them into `docs/design-history/<date>-<issue-or-label>/` as part of the same PR.

**Why:** Mike asked for "proof of work" so we can clearly see the visual diff between versions of any surface. Reviewers + future audits should be able to scrub the design history without redeploying old code.

**How to apply:**
- Tool: `mira-web/scripts/design-snapshot.ts` (Playwright, bundled Chromium, captures desktop 1440×900 + mobile 390×844 full-page).
- Wrappers: `bun run snapshot:before <url> <label>` and `bun run snapshot:after <url> <label>` (run from the `mira-web/` dir).
- Workflow:
  1. Boot dev server (`bun run src/server.ts` with the env vars in mira-web/CLAUDE.md).
  2. **Before any edits:** `bun run snapshot:before http://localhost:3000/<route> <issue-label>`.
  3. Make the changes.
  4. Restart server.
  5. `bun run snapshot:after http://localhost:3000/<route> <issue-label>`.
  6. Commit `docs/design-history/<date>-<label>/{before,after}-{desktop,mobile}.png` along with the code changes.
- Naming: `<label>` should be the issue/spec ID lowercased (e.g. `so070-cmms`, `so100-home`, `so104-pricing`). The script auto-prefixes today's date.
- Skip only when the change is invisible (server logic, routing, copy in alt text, etc.) — for any code touching markup, CSS, tokens, components, or copy that ships to a user, snapshot it.
