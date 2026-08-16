# eval-fixer run — 2026-08-15 (charlienodes-mac-mini)

- Scorecard: **45/65 raw (69%)** / **45/51 gradeable (88.2%)**, 20 failures, **14 timeouts**
- Graded SHA: `b6e7a1811` (tree pinned since 08-14 01:14 EDT) — parity **CLEAN** on eval surfaces
- Action: **issue-filed** (autopatch hard-stopped on both counts: 20 patchable > 15 **and** 3 clusters) — night ~24, still zero patches ever
- Ran the **#3085 discriminator** (full suite at `MIRA_PROCESS_TIMEOUT=90`), pre-registered before the result

## Cause 1 — POST is NOT one code state; the pooled n=15 statistics conflate three trees

The last two nights pooled every post-#3190 run into one "POST" bucket. Reflog + diff show the shared
tree ff'd nightly across the window: `42359648` → `63595ee2a` → `b6e7a1811`, and **#3214**
(+71 `citation_compliance.py`, +13 `engine.py`) and **#3192** landed *between* the 08-13 and 08-14/15
trees. So "POST n=15" is three code states, not a control.

**The only clean identical-code control is n=5 at `b6e7a1811`** (08-14 06:35/11:18/16:03/20:49 UTC +
08-15 01:37): raw **40–45**, timeouts **8–14**, gradeable **76.9–88.2**.

Consequences:
- **Recomputed pair rate: 87% → 82% pooled / 79% on the control** (means 83.5 → 80.2). Still majority
  POST-below-PRE, but weaker than published.
- **POST max gradeable (88.2) now EXCEEDS PRE max (86.2)** — the 08-14 "6/10 POST below the entire PRE
  range" framing no longer holds at the extreme.

## Cause 2 — timeouts still separate perfectly at n=37, and are drifting worse

PRE n=22: raw 50–56, timeouts **0–3**. POST n=15: raw 40–51, timeouts **4–14**. Zero overlap across 37
runs — the strongest structural signal in the series. Within POST the timeout count is *drifting up*
(4–7 early → 8–14 in the last five runs); tonight's **14 is a new maximum**.

## Cause 3 — tonight is an outlier the arithmetic does not fully explain

Most timeouts ever (14) **and** the highest gradeable in all 37 runs (88.2%). Directionally that is what
"leaky denominator draining" predicts — as latency worsens, near-timeout fixtures get fully absorbed into
the excluded set. **But pure absorption predicts passes stay flat, and they didn't:** TO 11→14 (+3),
non-timeout failures 11→6 (−5), passes 43→45 (**+2**). One point on identical code with no candidate
cause cannot separate "leak draining" from "the flaky ~9 landed well." Not headlined; the discriminator
adjudicates.

## Residual 6 non-timeout failures — all attributed, none unfiled

| Fixture | Cause | Tracked |
|---|---|---|
| `control_refusal_clean_26` | forbidden `KB-gap` in a fresh session | **#3145** |
| `pf525_f004_02` | FSM `Q2` vs `DIAGNOSIS` | #3086 |
| `topic_switch_gs10_to_pf525_22` | FSM `IDLE` vs `Q1` | #3086 |
| `self_critique_low_groundedness_34` | stuck `AWAITING_UNS_CONFIRMATION` | #3086 (UNS-gate sub-class) |
| `yaskawa_ga500_gf_25` | cited a **V1000** manual for a **GA500** question (cross-*model*) | adjacent #3049 |
| `pf523_heatsink_18` | SAFETY over-escalation (`STOP — describe the hazard`) from a heatsink prompt | cf. #1834 |

**#3145 is now confirmed more strongly than last night:** `b6e7a1811` *contains* #3214 — the
citation-admission fix on exactly that lane — and the forbidden `KB-gap` still fires. That removes the
"maybe #3214 fixed it" hedge.

**0 of 16 `cp_keyword_match` failures were genuine missing phrases** — #2759's misfiling argument, 5th
consecutive night. Watchdog precision bug 5th night (`skip_failures: 0` while ≥2 are structurally
unpatchable).

## The #3085 discriminator — pre-registered, result appended below

Full suite at `MIRA_PROCESS_TIMEOUT=90` against the same pinned tree. Readout written **before** the
number, against the n=5 identical-code control (raw 40–45, TO 8–14, gradeable 76.9–88.2):

- **A.** TO → 0–3 **and** gradeable 83–86 ⇒ #3085 is the **whole** post-#3190 delta; the "regression" dissolves.
- **B.** TO → 0–3 **and** gradeable stays ~77–80 ⇒ a real generator-quality component exists **alongside** the latency cause.
- **C.** TO stays 8–14 ⇒ propagation is already verified, so 90 s genuinely does not help; the bottleneck
  is not the per-message budget (candidate: #3190's *three* added gpt-oss reasoning round-trips).

> **RESULT: pending at the time this fragment was committed.** Committed early rather than held, so the
> night's findings are durable if the session ends first. Appended in a follow-up commit on this branch.

## Process

- **Failure 3 variant again** — `origin/main`'s `wiki/hot.d/` ended at **08-12**; #3186 (08-11),
  #3216 (08-13) and #3231 (08-14) were all open PRs. Two-read rule: `UNKNOWN` resolved to **`BEHIND`**
  on all of them. **Rebased all three onto `origin/main` and pushed.** Enabling auto-merge was denied by
  the permission classifier — flagged, not routed around. **This is the third night of rebasing the same
  PRs; a fourth is the treadmill, not the fix.**
- **#3154 night ~12** — `safe-cron-pull: SKIP — working tree is dirty` fired again at 05:00 UTC, same lone
  foreign untracked file `docs/prd/2026-08-03-cited-technician-turn.md`. `BEHIND`, foreign PR, left alone.
- ⚠️ **New trap recorded: never check out branches while an in-process eval is running.** I rebased the
  three fragment PRs ~2 min after launching the discriminator, which mutated the working tree under a
  running `offline_run.py`. It was harmless *only* because parity between `b6e7a1811` and `3ba7f4e54` on
  eval surfaces is empty — but the ordering was luck, not design. Do the PR work before or after, never
  during.
- **Discriminator hygiene:** `MIRA_PROCESS_TIMEOUT=90` propagation verified *before* trusting a null
  result (`doppler run` overwrites ambient env when the config defines the key — it does not define this
  one). Readout pre-registered before the number landed. Scorecard renamed out of the
  `*offline-text.md` glob so it can poison neither the watchdog nor tomorrow's series parser.
