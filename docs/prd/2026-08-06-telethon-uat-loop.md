# PRD — Telethon UAT Loop: the agent drives, observes, and fixes MIRA over real Telegram

**Date:** 2026-08-06 · **Author:** Claude (session be9b0a0a) · **Owner:** Mike
**Status:** DRAFT — drives the next session
**Contract board:** `docs/contracts/contract-index.yaml` · **Handbook:** `docs/agents/subagent-development-handbook.md`

## 1. Problem

The 2026-08 defect arc proved two things at once:

1. **Offline fixtures are necessary but not sufficient.** Mike's phone transcript
   (`telegramtest1.txt`) caught four real defects (N1–N4, PR #3142) that the 68-fixture
   offline battery never saw — because the offline harness stubs the transport, the router
   ran live, and real conversational rhythm ("thanks", typos, meta-questions) isn't in the
   fixture corpus.
2. **The phone loop doesn't scale.** Every live round costs Mike a bench session, and the
   agent grades from a pasted transcript hours later instead of observing the reply the
   moment it lands.

The missing piece: the agent sends **real Telegram messages** to a **real deployed bot**,
reads the **real replies** (including chips/footers/citations exactly as a technician sees
them), grades them against the contract board, fixes what fails, redeploys, and re-observes
— a closed loop with no human in the transport.

## 2. What already exists (build on, don't fork)

| Asset | Where | Reuse |
|---|---|---|
| Telethon client + auth plumbing | `tests/regime1_telethon/batch_survey_driver.py` (`TELEGRAM_TEST_API_ID` / `TELEGRAM_TEST_API_HASH` / `TELEGRAM_TEST_SESSION_PATH` / `TELEGRAM_BOT_USERNAME`, Doppler-managed) | The client bootstrap, /reset turn-0 protocol, reply-wait logic |
| Deterministic grader | `tests/eval/offline_run.py` + `tests/eval/grader.py` (expected/forbidden keywords, any-match, hard-fail) | The grading contract — same semantics, new transport |
| Scenario corpus | `tests/eval/fixtures/60–67_*.yaml` (phone battery) + `docs/testing/2026-08-06-garage-conveyor-uat.md` (T1–T14) + `telegramtest1.txt` | Scripts come from these, not invented |
| Staging bot | `@Mira_stagong_bot`, token `TELEGRAM_BOT_TOKEN_STG`, deployed via `deploy-staging.yml` (`services=mira-bot-telegram`) | The ONLY default target |
| Defect loop | `.claude/skills/defect-workflow/` (investigator → red tests → fix → battery → held PR) | Every live FAIL enters this loop unchanged |

## 3. Deliverables

### D1 — Conversation driver: `tests/regime1_telethon/uat_driver.py`
- Reads **conversation scripts** (YAML, superset of the phone-battery fixture format:
  same `expected_keywords` / `forbidden_keywords` / `tags` keys, plus per-turn
  `expect` / `forbid` lists and `transport: telethon`).
- Per scenario: `/new` (turn 0) → send each user turn → await the bot reply (timeout
  90 s, collect multi-message replies until quiet for 3 s) → grade per-turn and
  final-reply checks. FSM state is not observable over the wire — the grader runs on
  reply text only, and that limitation is stated in the scorecard header.
- Captures the FULL rendered reply: text, inline keyboard/chips, `[Source:]` tags,
  KB-gap footers — the things offline stubs hide.
- Rate-railed: ≥2 s between sends, one scenario at a time, hard cap `--max-turns` per
  run. `--dry-run` prints the script without connecting.
- Output: markdown scorecard per run in `tests/eval/runs/` (same naming scheme) +
  optional `gh issue comment` to the tracking issue.

### D2 — Scenario pack: `tests/regime1_telethon/uat_scripts/`
1. `t01–t12_*.yaml` — the chat-surface half of the garage-conveyor UAT, one script per
   test, contract-ID tagged (T13/T14 stay human — Hub surface and physical bench).
2. `regression_telegramtest1.yaml` — Mike's exact 8/6 transcript turns, expected
   behaviors set to the FIXED contracts (N1–N4 + CTX-001c). This is the canonical
   "did the merge chain actually land" probe.
3. `conversational_texture.yaml` — the shapes only live testing found: typos
   ("randomy"), "thanks" mid-gate, meta-questions ("do you have the manual?"),
   short answers, follow-up after a long silence.

### D3 — The closed loop (session protocol)
```
run scenario pack vs staging → grade
  └─ PASS → scorecard + comment on tracking issue
  └─ FAIL → defect-workflow intake (exact turn text + full reply as evidence)
            → investigator → red tests (offline, deterministic) → smallest fix
            → deploy branch to STAGING (deploy-staging.yml, services=mira-bot-telegram)
            → re-run the failing scenario ×3 live → held PR with both proofs
```
The agent runs every step except merges (Mike's word, per PR) and prod deploys
(normal main pipeline after merge).

### D4 — Optional (phase 2, separate approval): nightly staging sweep
Cron/Routine that runs the pack against staging after each staging deploy and posts a
delta scorecard. Out of scope for the first session; listed so the driver is built
re-entrant.

## 4. Hard rails (non-negotiable)

1. **Staging bot only, by default.** `TELEGRAM_BOT_USERNAME` comes from `factorylm/stg`.
   Pointing the driver at `@FactoryLM_Diagnose` (prod) requires Mike's explicit per-run
   authorization in the conversation — the env-boundary rule (`docs/environments.md`)
   already forbids feature-branch traffic to prod, and this PRD does not soften it.
2. **One driver session at a time.** Telethon is a *user* client (no bot-token poller
   conflict), but concurrent scripted sessions to one bot chat interleave FSM state.
3. **Text lanes only in v1.** No photo turns (the batch_survey_driver already covers
   photos), no control writes, nothing that touches the PLC — chat in, chat out.
4. **Same evidence discipline.** Live scenarios are ×3 minimum before any red/green
   claim (LLM variance); deterministic offline red tests remain the enforcement layer —
   the live loop finds and verifies, contracts and pytest enforce.
5. **Spend:** staging uses the free cascade (Groq→Cerebras→Together). No paid inference.
   If a scenario needs a paid path it's out of scope per the spend law.

## 5. Human prerequisites (Mike, ~10 min, once)

- [ ] Verify the Telethon creds exist in Doppler `factorylm/stg`:
      `TELEGRAM_TEST_API_ID`, `TELEGRAM_TEST_API_HASH`, and a **valid session file**
      (`TELEGRAM_TEST_SESSION_PATH`). If the session is expired, an interactive login
      (`! python -m tests.regime1_telethon...` with the phone code) is the one step the
      agent cannot do alone.
- [ ] Confirm the staging bot container is running (`deploy-staging.yml` green) and
      that the test account has an open chat with `@Mira_stagong_bot`.
- [ ] Say the word on the pending merge chain first (**3140 → 3141 → 3142**) so staging
      and the scenario expectations describe the same code.

## 6. Acceptance criteria (next session is DONE when)

1. `uat_driver.py --dry-run` renders all D2 scripts; a live run against staging
   completes T1–T12 + `regression_telegramtest1` with a scorecard.
2. At least one full closed-loop demonstration: a seeded or discovered FAIL goes
   intake → fix → staging deploy → live re-pass ×3 → held PR, all in-session.
3. The scorecard lands as a comment on the tracking issue (#3138 or a successor).
4. Zero prod-bot traffic; zero paid inference; rails in §4 verifiably held
   (the driver refuses `@FactoryLM_Diagnose` without an `--allow-prod` flag that
   itself requires a per-run authorization string from Mike).
5. New defects found live get contract rows (the board stays the single queue).

## 7. Risks / open questions

- **Telethon session validity** is the likeliest blocker — resolved only interactively
  (§5). Detect early: the driver's first act is `get_me()` with a clear failure message.
- **Staging drift vs main**: staging must be deployed from the branch under test or main;
  the driver records the staging SHA (from the deploy run) in every scorecard header —
  the qa-skill "verify the deploy landed first" rule, mechanized.
- **Multi-message replies & chips**: Telegram delivers footers/chips as entities/markup;
  the driver must flatten them into gradeable text (spike task, first hour).
- **Chat-state bleed between scenarios**: `/new` is the reset seam; verify it truly
  clears server-side state (fixture 08-class check) before trusting scenario isolation.

## 8. Pointers for the next session

- Merge-chain status + full defect history: memory `project_chatbot_defect_arc`.
- Live-round evidence format: `telegramtest1.txt` analysis in PR #3142's body.
- Known-not-fixed (don't re-file): KB-gap footer noise on clarify replies (CIT-002-adjacent),
  gate-demand copy polish, #3137 fixture-65 citation-strip, #3115/#3085/#3116 harness trust.
