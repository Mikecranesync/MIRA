# eval-fixer run — 2026-09-12 (charlienodes-mac-mini)

- Scorecard: 52/65 passing (80%) — mid-band (48–54 over the last 16 runs)
- Action: issue-filed — tracker #1876 comment + two new named issues **#3752**, **#3753**
  (no patch: 3 overlapping `file_clusters` hard stop)
- Headline is operational, not eval quality: **2026-09-10 and 2026-09-11 produced no analysis at
  all** — both runs died in ~5 s on the Claude weekly usage limit (exit=1), so 11 scorecards went
  unread and the silence was indistinguishable from "nothing to report". → **#3752**
- Also standing since 2026-09-07: the wrapper logs `ERROR: eval-fixer branch(es) … never reached
  origin` every run for two stale local branches (`docs/eval-fixer-2026-07-31`,
  `docs/eval-fixer-2026-08-03`) that modify the forbidden `wiki/hot.md` and can never publish.
  Not deleted — they hold the only copy of those commits; needs a human decision. → **#3753**
- Chronic set confirmed over 16 runs on a **verifiably static** code path (no commits to
  `mira-bots/shared/` or `prompts/diagnose/` since 2026-09-09; engine/prompt/eval bytes identical to
  `origin/main`), so the ±6 spread is cascade nondeterminism, not code churn.
- Corrected the 2026-09-09 report: `yaskawa_a1000_ov_23` + `pf40_undervoltage_21` are chronic
  (14/16, 13/16), not the flippers they were filed as — they belong to #3675.
- Three unowned chronic failures remain: `self_critique_low_groundedness_34` (16/16),
  `topic_switch_gs10_to_pf525_22` (16/16), `gs20_cross_vendor_03` (14/16 — and it *passed* tonight,
  so it is invisible in tonight's report: concrete evidence for #2759's under-reporting half).
- Retracted one claim mid-run: the 09-07/08/09 fragment PRs (#3658/#3677/#3714) were closed by
  Mikecranesync deliberately — the publish leg works; not the #3134/#3255/#3473/#3574 class.
  Correction posted on #1876.
