# HANDOFF — Overnight photo-memory run (2026-07-29, ~4h autonomous)

**Operator ask:** "ultracode the solution to the telegram bot being able to remember the photo
and answer about it; use telethon and agents to test this fully; ready when I wake up."

**Delivered:** PR **#3008** — `feat/photo-memory-equipment-followup`, **STACKED on #2798**
(base = `feat/printsense-persistent-qa`). v3.231.0. The bot now remembers equipment/nameplate
photos (not just prints) and answers text follow-ups deterministically from persisted evidence.

## PLAN row-by-row

| # | Scope item | Status |
|---|---|---|
| 1 | Equipment-photo workspace persistence (spine equipment route, model-free) | ✅ DONE — `PrecomputedNameplate` replay adapter; per-field VISIBLE observations; identity-preserving unreadable path. Caveat below on strict idempotency. |
| 2 | Follow-up rung (deterministic, citation-labeled, safety fall-through) | ✅ DONE — `_try_equipment_photo_followup`, zero LLM, EvidenceAnswer trust labels incl. new "Shown on the nameplate" |
| 3 | Offline tests + regression | ✅ DONE — 17 new tests green; full suite 2143 passed; FAILED-set diff vs #2798 baseline EMPTY (same 19 pre-existing, mostly Slack env) |
| 4a | Telethon manifest cases + dry-run | ✅ DONE — multi-turn `followups` runner support; `photo_memory_micro820` + `photo_memory_gs10` cases; dry-run proven |
| 4b | Committed staging E2E harness | ✅ DONE — `tools/qa/staging_photo_memory_e2e.py` (generalizes the uncommitted `e2e_proof.py`) |
| 4c | Staging re-verify (no redeploy) | ✅ DONE — ran inside `stg-mira-bot-telegram`: **#2798 print section PASS**; equipment section auto-skipped (rung not deployed there yet). **Your #2798 phone-test environment is intact and still green.** |
| 5 | Multi-agent adversarial review | ✅ DONE — 12 agents (4 lenses + per-finding refuters): 8 raw findings → 3 confirmed, 5 refuted. All 3 confirmed FIXED on the branch: (1) P1 tenant re-validation guard added to the rung + mismatch test; (2) P1 caption-on-photo path documented (answered by fast-path/engine from the live photo, by design); (3) P2 mixed print+equipment workspace precedence test added. Final: 2145 passed, regression diff still empty. |
| 6 | PR + HANDOFF + morning brief | ✅ DONE — PR #3008 open with evidence body; this file; brief in chat |

## What YOU need to do (in order)

1. **#2798 first (unchanged from yesterday's handoff):** re-test on `@Mira_stagong_bot` with a
   NEW photo. If good → merge #2798 (rebase/pick next-free VERSION; migration 069 to PROD via
   `apply-migrations.yml` dry-run→apply BEFORE/with the prod deploy).
2. **Then #3008 (this work):** after #2798 merges, retarget/rebase #3008 onto main (GitHub
   auto-retargets the base when #2798 merges; VERSION may need the next free minor by then),
   review, merge, deploy `mira-bot-telegram`.
3. **Post-deploy proof (one command):**
   `ssh prod "docker cp /opt/…/tools/qa/staging_photo_memory_e2e.py stg-mira-bot-telegram:/tmp/ && docker exec stg-mira-bot-telegram python /tmp/staging_photo_memory_e2e.py"`
   — after this branch reaches staging, the equipment section runs for real (expects RESULT: PASS).
4. **Telethon wire login (the ONE human-gated item, 5 min):** the `telegram_test_session`
   volume exists on no reachable host. One-time interactive login per
   `mira-bots/telegram_test_runner/RUNBOOK.md` §3, then:
   `docker compose --profile test run --rm telegram-test-runner --cases photo_memory_micro820 photo_memory_gs10`
   runs the full wire-level photo→follow-ups conversation against the staging bot.

## Known limits / follow-ups (filed honestly, not hidden)

- **Exact-duplicate photo re-ingest converges but isn't sha-deduped** — latest-wins readers keep
  answers correct; storage grows. The spine has no evidence-read API; adding
  `load_evidence_items` + sha recall is the clean follow-up (materialized-evidence rule 7).
- **Multi-photo bursts** (`_enqueue_multi_photo_burst`) don't persist this slice — single-photo
  path only.
- **Pre-existing double nameplate extraction** (bot fast-path + engine NAMEPLATE branch both
  extract) — unchanged, noted in PR.
- **Safety-note wording** on generic recall answers reuses print-flavored copy ("the print
  cannot show live state") — conservative-safe, cosmetic fix possible later.
- PLAN item 1's original "re-ingest is a no-op" criterion was adjusted to "converges (latest
  wins)" for the reason above — recorded here per premise-honesty.

## Environment / hygiene notes

- Worktree `.claude/worktrees/photo-memory` — branch pushed to origin; worktree removed at
  session end (teardown rule). Re-create with
  `git worktree add .claude/worktrees/photo-memory feat/photo-memory-equipment-followup`.
- Regression baselines: `/tmp/photo-mem-baseline-failures.txt` (19 pre-existing FAILED lines).
- 3 test files don't collect in this env (gchat/slack_relay/teams adapters) — pre-existing on
  the base branch, excluded from both baseline and after runs identically.
- `mira-bots/artifacts/latest_run/` regenerated by the dry-run — untracked, not committed.
