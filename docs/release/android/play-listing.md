# FactoryLM — Google Play listing package

Assets live in `mira-mobile/store/play/` (generated) + `store/play/screenshots/`
(captured from the real app). Requirements verified against Play Console specs, 2026-08.

## App identity

- **App name:** FactoryLM
- **Short description (≤80 chars):**
  `Ask your equipment. Cited answers from your manuals, work orders, and PMs.`
- **Full description (draft):**

> FactoryLM turns your equipment documentation into a maintenance copilot you can
> carry on the plant floor.
>
> • **Ask MIRA** — ask real troubleshooting questions and get answers grounded in the
> manuals you loaded, every claim cited to its source page.
> • **Equipment notebooks** — load a manual, scope questions to your sources, and tap
> any citation to see the exact passage.
> • **Work orders** — create and close work orders from your phone. Retries, double
> taps, and bad connections never create duplicates.
> • **PM schedules** — create preventive-maintenance schedules with due dates on the
> asset, from the floor.
> • **QR asset lookup** — scan an asset tag (or type it) to jump straight to that
> machine's records.
> • **Works with weak connectivity** — work-order creates queue offline and sync
> exactly once when you're back.
>
> FactoryLM requires a FactoryLM workspace account.

- **Category:** Business (alt: Productivity)
- **Contact email / website:** required by Play — owner to confirm (suggest
  support@factorylm.com + https://factorylm.com)
- **Privacy policy URL:** REQUIRED before any track goes live — see `play-compliance.md`
  (must be a live public URL, owner action).

## Graphics (Play requirements, verified 2026-08)

| Asset | Requirement | Status |
|---|---|---|
| App icon | 512×512 PNG, ≤1 MB, full square (Play applies masking) | ✅ `store/play/play-icon-512.png` |
| Feature graphic | 1024×500 PNG/JPG | ✅ `store/play/feature-graphic-1024x500.png` |
| Phone screenshots | 2–8, PNG/JPG, each side 320–3840 px, aspect between 16:9 and 9:16 | ✅ 412×915 set in `store/play/screenshots/` |
| 7"/10" tablet screenshots | required only for tablet featuring | deferred (not targeting tablets) |

## Screenshot story (captured from the real app against production — no fabricated UI)

1. `01-login` — clean sign-in
2. `02-workorders` — work-order list
3. `03-notebook-chat` — Ask MIRA grounded answer with citations
4. `04-citation-sheet` — tapped citation showing the cited passage
5. `05-studio-spec-table` — generated spec table, per-row citations
6. `06-schedule-pm` — PM schedules with due dates
7. `07-scan` — QR scan + manual tag entry
