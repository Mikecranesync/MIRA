# Code parking — working-tree untangle 2026-06-16

The CHARLIE checkout (`~/MIRA`) had **153 uncommitted files** on the stale docs
branch `docs/competitive-intel-siemens-teamviewer` (170 commits behind `origin/main`,
HEAD of open PR #2026). Multiple sessions' code edits were mixed with docs and
generated noise. This branch parks the **code** changes that have no clean home,
so nothing is lost while they get routed properly. **This branch is NOT meant to
merge to `main` as-is** — it is a recovery/handoff artifact.

## Recovery anchors (nothing here is the only copy)
- **Tag `wip-snapshot-2026-06-16`** — full snapshot of every *tracked* edit at untangle time (`git stash create` sha `45fd40e8`). Pushed to origin.
- **This branch** `parking/untangle-code-2026-06-16` — the 8 edit patches + the 3 net-new code files (the snapshot tag does NOT include untracked new files; this branch does).
- Patches are `git diff HEAD -- <file>` against the stale branch base, i.e. **the real edit a session made**, not the file wholesale (avoids reverting newer `main` work).

## Why these were parked, not PR'd

Every code change here is one of: **tangled** (multiple features in overlapping
hunks on a 170-commit-stale base — wholesale copy would revert newer `main`),
a **duplicate** of an existing open PR, or **semantically uncertain**. None was a
safe automatic land. Map below.

| Parked artifact | Real edit | Home workstream / disposition |
|---|---|---|
| `engine.py.patch` | +130/−9 | **Tangled — 3 features in one file.** (1) agent-trace observability (`_emit_agent_trace` → needs `newfiles/.../agent_trace.py`); (2) fault-code fast-path "Phase 6" (`recall_fault_code` — already on `main`); (3) direct-connection `confidence="certified"` stamp + UNS-gate `keyword_intent` param. Base is +173/−36 behind `main` on this file. Belongs to the **DT-2026 / Phase-6 workstream** (cf. PR #1866 `feat/dt2026-phase6-direct-connection`, itself 112 behind main). Hand to that workstream; do **not** force-apply to current `main`. Must pass the staging gate (engine change). |
| `newfiles/mira-bots/shared/agent_trace.py` | new | Observability-audit feature (`docs/observability/mira-agent-eval-audit.md`, committed on the docs branch). Net-new, on no branch. Dead without the `engine.py` integration hunk above — ship together. |
| `newfiles/mira-bots/tests/test_agent_trace.py` | new | Test for the above. |
| `newfiles/tests/unit/test_uns_gate_fix.py` | new | Pairs with the `engine.py` UNS-gate `keyword_intent` change. |
| `ignition_chat.py.patch` | +20/−10 | Stale-base (base +267/−13 behind `main`). Direct-connection surface work; same DT-2026 family as `engine.py`. Re-derive onto current `main`. |
| `hub-readiness-route.ts.patch` | +2/−2 | **Net-new security**, clean-applies on `main`: scopes `relationship_proposals` counts to the authed tenant (drops `OR tenant_id IS NULL`). Same theme as PR #2022 (#1894) but PR #2022 did **not** touch the readiness routes. ⚠️ Confirm `tenant_id IS NULL` proposals aren't intentionally *global* before landing. Good follow-up to #1894. |
| `hub-readiness-recalculate.ts.patch` | +2/−2 | Same as above (the recalculate route). |
| `hub-proposals-route.ts.patch` | +1/−1 | Belongs to **#1894 / PR #2022** (`fix/1894-cross-tenant-proposal-visibility`). Working base is +204/−13 behind `main`; PR #2022 already rewrites this file correctly. Discard in favor of PR #2022. |
| `hub-decide-route.ts.patch` | +1/−1 | Same #1894 / PR #2022 family. |
| `hub-decide-test.ts.patch` | +22 | **Byte-identical to `origin/fix/1894-cross-tenant-proposal-visibility`** — already in PR #2022. Pure stranded duplicate. Discard. |
| `active.yaml.patch` | +11/−6 | Clean-base, independent: diagnose prompt v1.2→v1.3, adds few-shot Example 9 (ground-fault/megger vocab) to fix `cp_keyword_match` on `gs3_ground_fault_14`. Ready to PR as a standalone eval/prompt fix (staging gate applies). Parked (not auto-landed) because it's an engine-path prompt change that should be gated deliberately. |

## How to apply a patch
```bash
cd ~/MIRA               # on a fresh branch off origin/main
git apply --3way _untangle-parking-2026-06-16/<name>.patch
# or, if context drifted, re-derive the change by hand from the patch as a guide
```

## Incidental finding (out of scope, not introduced here)
`origin/main` already carries literal `<<<<<<<` git-conflict markers committed in
`deployment/{onboarding_guide,troubleshooting,customer_agreement,admin_guide}.md`.
Pre-existing on `main`, unrelated to this untangle — worth a separate cleanup.
