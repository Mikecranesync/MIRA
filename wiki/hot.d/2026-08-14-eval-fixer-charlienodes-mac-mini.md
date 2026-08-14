# eval-fixer run — 2026-08-14 (charlienodes-mac-mini)

- Scorecard: **45/65 raw (69%) / 45/55 gradeable (82%)** — 20 failures, **10 timeouts**
- Graded: `63595ee2a` (tree HEAD `5f48a9f1d`, +2 docs commits). Start **2026-08-14T01:54Z** ⇒ POST-#3190.
- Parity: **DIRTY** — `engine.py` +13 (#3214) and `synthetic_user.py` ±1 (#3192) landed after the graded commit.
- Action: **issue-filed / no patch** — autopatch hard-stopped on *both* counts (20 patchable > 15, and 3 clusters). Still zero patches ever, night ~23.

## The finding: ONE cause with a leaky denominator, not two effects

The 08-13 entry split the series on the #3190 pickup (05:05 UTC 08-12) and concluded the raw
drop was a timeout artifact while gradeable stayed "~flat". At **n=15 PRE / n=10 POST** that
second half no longer holds, and the correct reading is *one* cause:

| | n | raw | timeouts | gradeable | mean |
|---|---|---|---|---|---|
| PRE (`42359648`) | 15 | 50–56 | **0–3** | 80.6–86.2% | 83.9% |
| POST (`63595ee2a`) | 10 | 43–51 | **4–12** | 77.0–85.0% | 80.2% |

- **Timeouts separate perfectly** across 25 runs — every PRE ≤3, every POST ≥4. Zero overlap.
- **Gradeable does NOT stay flat:** 130/150 cross-era pairs have POST < PRE (**87%**), 6 of 10
  POST runs fall below the *entire* PRE range, means −3.7pt.
- ⚠️ **But gradeable is a leaky denominator, and that is the whole point.** It excludes only
  fixtures that crossed 30s hard enough to emit the TIMEOUT prose. A fixture that *nearly*
  times out returns a degraded/truncated answer, grades as a plain `cp_keyword_match`, and stays
  in the denominator. That single latency mechanism produces exactly the observed pattern —
  perfect timeout separation **plus** a gradeable decline. **Do not read the −3.7pt as
  "gpt-oss-120b is a worse diagnostician."** Read it as "gpt-oss is slower against a 30s harness
  budget" ⇒ points at **#3085**, not at revisiting #3190.
- **The discriminator (proposed on #3085, not run tonight): one full suite run at
  `MIRA_PROCESS_TIMEOUT=90`.** If gradeable recovers into the PRE band, it is one cause and the
  gradeable "decline" was never real. That ask subsumes the 08-13 "capture router logs" request.

**Attribution is clean — and broader than "a provider default".** `git log --full-history
42359648..63595ee2a -- mira-bots/shared/ prompts/diagnose/ tests/eval/` returns **exactly one
commit**, `d3c36196d` (#3190) — but that commit is a **12-file, +49/−21 sweep**, not a one-line
default. It migrates **three separate call sites in the turn path** onto gpt-oss:
`router.py:211` (diagnosis, 120b), `conversation_router.py` (routing, 20b),
`dialogue_acts.py` (dialogue-act classifier, 20b) — each with a `max_tokens` bump and
`reasoning_effort: low` to absorb reasoning tokens. Every hunk is a model id / token budget /
effort flag; **no behavioral logic changed.** So the natural experiment is valid, and the
mechanism is *three* added reasoning round-trips per turn inside one unchanged 30s budget.
It also means the FSM/routing layer changed generator too — relevant to the #3086 cluster.

**Correction to my own draft:** the POST timeout max is **12** (`08-13T07:13`), not tonight's 10.

## Failure taxonomy — all 20 attributed, nothing unfiled

- **Timeout / ungradeable — 10** (#3085): `gs10_01`, `asset_change_08`, `reset_09`, `abbrev_10`,
  `gs1_12`, `ga500_25`, `sew_29`, `abb_01`, `abb_03`, `siemens_04`. Cross-validated: the
  scorecard prose count (`grep -c "taking longer than usual"` = 10) matches the watchdog's
  per-fixture snippets exactly. **Never grep `TIMEOUT_WARNING`.**
- **FSM pacing — 6** (#3086): `pf525_02`, `happy_path_07` (Q2→DIAGNOSIS); `a1000_23`,
  `j1000_24` (Q1→Q2); `self_critique_34` (AWAITING_UNS_CONFIRMATION→Q1, the separable UNS-gate
  sub-class); `topic_switch_22` (IDLE→Q1, answered fully without entering the FSM).
- **#3145 — 1**, and this one is now **hard**: see below.
- **Non-defect — 1**: `gs3_ground_fault_14` is the known improvement-scored-as-a-loss (#3133
  correctly suppresses Rockwell docs for an AutomationDirect asset, nothing indexed sits behind
  it, MIRA refuses honestly). **Do not "fix" it.**
- **Clarification-ending keyword misses — 2**: `pf520_17`, `v1000_22` — both answered with a
  question instead of an answer (mechanism named 08-03). `v1000_22` additionally cited
  "Yaskawa GA500" for a V1000 question — cross-**model**, adjacent to but not the same as
  #3049's cross-vendor class.

### #3145 CONFIRMED on current `main` — #3214 did not fix it

Parity was dirty on exactly this lane, so the recurrence claim was checked instead of asserted.
#3214's +13 lines add `_H4_GAP_PHRASES` entries and `stripped_labels` threading on the
no-docs-admission / citation-strip path — which is `control_refusal_clean_26`'s lane. Bounded
re-verify on fresh `origin/main` (`b6e7a1811`), `MIRA_PROCESS_TIMEOUT=90`:

```
python3 tests/eval/offline_run.py --suite text --only control_refusal
→ FAIL 6/7 — Forbidden keywords present: ['KB-gap']
```

Byte-identical response to the graded run, **0.5s** (deterministic — this lane needs no
inference, so it is free to re-verify). The `KB-gap` footer still attaches to the
control-refusal lane. **#3145 is a live defect on current `main`, not a stale grade.**

### Not a defect: the "I removed a citation" note

`a1000_23` / `j1000_24` surface `_(Note: I removed a citation because I haven't established
which machine you're working on…)_`. That is intentional — `citation_compliance.py:525`. Their
failures are FSM (#3086), not citation. Recording it so it isn't re-raised.

### Dead end recorded — the retired-model degeneration does NOT reach the eval

08-12 left "re-check after the 2026-08-16 retirement if the pull is still pinned" open. Checked,
and it is **refuted on both legs**: (a) `synthetic_user._pick_provider()` returns `groq` whenever
`GROQ_API_KEY` is set (it is, in `factorylm/prd`) — the Cerebras leg #3192 fixed is never
reached; (b) `router.py:230`'s Cerebras default is *already* `gpt-oss-120b` on both the graded
tree and `main`, so the diagnostic cascade has no dead id either. No 08-16 cliff. Don't re-derive.

## Process failures still live

- 🔴 **FAILURE 3, NEW VARIANT: opening a PR isn't delivering either.** `git log origin/main
  --oneline -5 -- wiki/hot.d/` ends at **08-12**. The **08-11 (#3186)** and **08-13 (#3216)**
  fragments are both still **OPEN, unmerged PRs** — two nights of findings are on `origin` but
  not on `main`. The 08-06 entry fixed "committed but unpushed" and installed the branch→PR
  pattern; that pattern has now developed its own leak one step further downstream.
  **Detection is one command, same as 08-06's — just point it at `wiki/hot.d/`.**
- 🔴 **#3154 is night ~11.** `bash tools/pr-merge-blocker.sh` / API: `mergeable MERGEABLE`,
  `mergeStateStatus **BEHIND**` — unchanged since 08-11. Still blocked on a rebase, not review or
  CI. Same lone foreign untracked file (`docs/prd/2026-08-03-cited-technician-turn.md`) pinned
  the pull again tonight (`safe-cron-pull: SKIP — working tree is dirty`). Left alone: foreign PR.
- **Watchdog precision bug, 4th consecutive night:** reports `skip_failures: 0` while
  `gs3_ground_fault_14` is structurally unpatchable. And **0 of tonight's 16 `cp_keyword_match`
  failures are genuine missing phrases** (10 timeout / 2 clarification-ending / 1 forbidden-token
  / 1 improvement / 2 FSM-coupled) — the #2759 misfiling argument holds for a 4th night.
- ⚠️ **`engine.py:384` `_PROCESS_TIMEOUT` remains a whitelist trap.** It is a one-line change
  inside the autopatch whitelist and it is the **wrong fix** — it moves the production default
  for every adapter that doesn't override (Slack 60, kiosk 90). **#3085's fix is harness-side.**

## Delivered

- Report + the n=15/10 two-denominator table → rolling tracker **#1876** (commented, never a new issue)
- Mechanism refinement + the `MIRA_PROCESS_TIMEOUT=90` discriminator → **#3085** (13 days `needs-triage`)
- Hard recurrence evidence on parity-verified `main` → **#3145**
- Fragment → branch → PR (not Step 10 — that bypassed branch protection on 08-10 and 08-12)
