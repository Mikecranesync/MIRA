# PLAN — Photo memory: bot remembers ANY photo and answers follow-ups (overnight 2026-07-29)

**Operator ask (verbatim intent):** "the telegram bot being able to remember the photo and answer
about it — use telethon and agents to test this fully — ready when I wake up in 4 hours."

**Branch:** `feat/photo-memory-equipment-followup` — STACKED on `feat/printsense-persistent-qa`
(PR #2798, which already ships photo-memory for electrical prints; DO NOT MERGE #2798 — that gate
is Mike's). This PR generalizes the same workspace spine to equipment/nameplate photos.

**Worktree:** `.claude/worktrees/photo-memory` (isolated; teardown obligation noted in HANDOFF).
*(This PLAN.md replaces the completed June "Path to Beta" plan — that phase shipped; see git
history for the old contract.)*

## Scope (numbered, each with success criteria)

1. **Equipment-photo workspace persistence.** After the engine vision path (and the nameplate
   fast-path) analyzes a photo, persist the analysis — classification, extracted nameplate fields,
   vision summary, photo sha — via the existing VisualSession spine (`mira-bots/shared/visual/`,
   reuse `print_workspace.py` patterns; extend, don't fork). Materialized-evidence rules apply
   (keyed on photo sha, idempotent, chat→session mapping in mira.db).
   - ✅ Success: sending an equipment photo produces a persisted workspace row; re-ingesting the
     same photo bytes CONVERGES (latest-wins field readers; answers unchanged). *(Adjusted from
     "strict no-op" mid-run: the spine has no evidence-read API, so sha-keyed dedupe is a
     documented follow-up — see HANDOFF.md.)*

2. **Follow-up rung.** A text turn that references the earlier photo ("what was the model
   number?", "what did that photo show?", "how many amps?") answers deterministic-first from
   stored fields → bounded evidence-packet model explanation → honest refusal. Falls through
   unchanged for safety/FSM/commercial/wiring turns. Citation-compliant: answers cite the stored
   photo evidence or admit ignorance.
   - ✅ Success: golden multi-turn test (photo → ≥3 distinct follow-ups) passes on the real rungs;
     safety-keyword turns still reach the safety path (test proves fall-through).

3. **Offline test suite.** Unit tests for ingest + rung + fall-through + idempotency; golden
   conversation test mirroring `test_print_workspace_golden.py`. Full `mira-bots/tests` +
   `tests/eval` watch set must not regress vs. the #2798 baseline (capture baseline FIRST).
   - ✅ Success: new tests green; no newly-red pre-existing tests; ruff clean.

4. **Telethon + agent QA.** (a) Add photo-memory conversation cases to the Telethon harness
   manifest (`mira-bots/telegram_test_runner/`) and prove them via `--dry-run` (wire login is
   human-gated: `telegram_test_session` volume is gone; one-time interactive code per RUNBOOK §3 —
   HANDOFF item, do NOT loop on it). (b) Commit a rerunnable staging E2E proof harness
   (generalizing the uncommitted `e2e_proof.py` pattern) under `tools/qa/`. (c) Re-run the #2798
   staging proof against the CURRENTLY deployed staging container (no redeploy) to confirm the
   environment is still green for Mike's morning phone test.
   - ✅ Success: dry-run report generated; harness committed; staging re-verify transcript captured.

5. **Multi-agent (ultracode) adversarial review** of the full diff before PR: correctness /
   security-tenancy / architecture-rules (fast-path rule, one-pipeline, citation compliance,
   materialized evidence) lenses, findings verified then fixed.
   - ✅ Success: review findings addressed or explicitly dispositioned in HANDOFF.

6. **PR + HANDOFF + morning brief.** Open PR (base: `feat/printsense-persistent-qa`, marked
   STACKED), VERSION bump next-free minor + CHANGELOG, `HANDOFF.md` committed, concise morning
   brief for Mike with exact verify commands.
   - ✅ Success: PR open with evidence body; CI triggered; HANDOFF.md complete.

## OUT of scope (hard lines)

- ❌ Merging #2798 or this PR (both are Mike's call; #2798 explicitly says DO NOT MERGE).
- ❌ Redeploying staging or prod (staging currently hosts Mike's pending #2798 phone-verify env).
- ❌ Any prod DB/psql/VPS container mutation; migration application to prod.
- ❌ Slack/email/web adapters (Telegram only tonight; engine seams stay adapter-agnostic).
- ❌ Engine FSM redesign, UNS gate changes, new ingestion pipelines, control writes.
- ❌ Retrying the Telethon interactive login (human-gated — one HANDOFF line, no loop).
- ❌ New migrations beyond what already exists on #2798 (069). Reuse spine tables.

## Budget / stop conditions

Per autonomous-run skill: stop at 70% token budget, 200 turns, 5 consecutive failures on one
test, or any OUT-of-scope touch. On stop: HANDOFF.md, commit, push branch, end.
