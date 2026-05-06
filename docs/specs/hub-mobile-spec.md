# Hub Mobile Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Field-tech-friendly responsive layout for `mira-hub`. Most plants run MIRA on a phone in the technician's pocket, with managers on tablet or laptop. This spec freezes the navigation contract: **bottom tabs on phones, side drawer on tablets/desktop**, with the same 17 sections rendered through the same Refine.dev resources. Anything that breaks this layout breaks the field experience.

## Scope
**IN scope**
- `src/app/(hub)/layout.tsx` shell behavior on mobile vs. desktop
- Bottom-tab nav on viewports < 768 px
- Side drawer on viewports ≥ 768 px (collapsible on tablet)
- Section-level mobile behaviors that differ from desktop (chat input pinned, lists virtualized, sticky filter bar)
- Touch target ≥ 44 px, swipeable tabs, safe-area insets

**OUT of scope**
- Native iOS/Android apps (not built; PWA is the strategy)
- Specific section internals (each section owns its mobile-vs-desktop rules)

## Architecture
- **Layer:** Presentation (within `mira-hub`)
- **Stack:** Next.js + Refine.dev + Tailwind + shadcn/ui
- **Render:** Server components first; bottom-tab and drawer components hydrate.
- **Detection:** CSS-only breakpoints (no UA sniffing). The layout key is `min-width: 768px`.

```
< 768 px:
  ┌─────────────────────────┐
  │ [Top: status pill]      │
  │ [Section: full-width]   │
  │ ...                     │
  ├─────────────────────────┤
  │ [Bottom Tabs (max 5)]   │  ← Workorders | Schedule | Chat | Assets | More
  └─────────────────────────┘

≥ 768 px:
  ┌──────────────┬──────────────────────────────┐
  │ Drawer       │ Section                      │
  │ (17 items)   │ (master/detail when wide)    │
  └──────────────┴──────────────────────────────┘
```

## API Contract

### Bottom-tab contract
- Maximum 5 tabs visible at all times: **Workorders, Schedule, Chat, Assets, More**.
- "More" opens a sheet with the remaining 12 sections.
- Active tab persists across reloads via cookie (`hub_active_tab`).

### Drawer contract
- 17 items, grouped: Operations (Workorders, Schedule, Requests, Alerts, Pending Approval), Assets (Assets, Parts, Documents, Knowledge), People (Team, Channels, Conversations), Admin (Integrations, Reports, Usage, Event Log, Admin), plus Magic + Upgrade callouts.
- Drawer collapses to icon-only on tablet portrait; expanded on desktop.

### Touch targets
- Minimum 44 × 44 px on every interactive element on mobile.
- Filter chips, primary CTA, and FAB use `min-h-12 min-w-12`.

### Safe-area
- Bottom nav respects iOS safe area (`env(safe-area-inset-bottom)`); content uses `pb-[calc(64px+env(safe-area-inset-bottom))]`.

### Performance budgets
- Initial JS per route ≤ 350 KB.
- Largest Contentful Paint p75 (4G mobile) ≤ 2.5 s.
- No layout shift on tab switch (CLS < 0.1).

## Configuration
No env vars exclusive to this spec. Inherits from `mira-hub-spec.md`.

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Lighthouse mobile perf | unmeasured | ≥ 80 |
| Lighthouse mobile a11y | unmeasured | ≥ 95 |
| Tab switch CLS | unmeasured | < 0.1 |
| Touch-target audit | unmeasured | 100 % ≥ 44 px |
| Playwright mobile suite | partial | full coverage of bottom-tab + drawer |

## Acceptance Criteria
1. **Bottom tabs visible:** On viewport 412 × 915 (Pixel 5), the 5 bottom tabs render and are tappable.
2. **Drawer visible:** On viewport ≥ 768 px, the side drawer is the primary nav; bottom tabs are hidden.
3. **Tab persistence:** Switching tab + reload returns to the same tab.
4. **More sheet:** "More" opens a bottom sheet listing the other 12 sections.
5. **Safe area:** On iOS, bottom tab bar does not overlap content (`env(safe-area-inset-bottom)` honored).
6. **Touch target audit:** No interactive element on a key flow (login → asset → chat) is < 44 px.
7. **No console errors:** Switching across all 17 sections produces zero browser console errors.
8. **Promo-screenshot rule:** New mobile UI changes ship a `412×915` screenshot to `docs/promo-screenshots/` per CLAUDE.md.

## Known Issues
- Drawer sometimes flashes wider on first paint when rehydrating; mitigation is a server-rendered shell.
- Some Refine.dev list views default to 50 rows — virtualize on mobile to keep scroll smooth.

## Change Log
- 2026-04-24 — Hub `v1.1.0` shipped with the bottom-tab + drawer pattern as the default.
