# Runbook — Kiosk / AskMira Deploy + Prod Verification

**Owns:** `mira-ask` container (FastAPI `/ask`), `mira-bots/ask_api/`, `mira-bots/shared/engine.py` kiosk fast-paths, the AskMira Perspective view on the PMC Garage Conveyor Gateway, and the `~/.claude/skills/askmira-tester` skill that scores the 10-question regression bake.

**Status:** Active doctrine, 2026-06-06. Supersedes ad-hoc instructions in the AskMira deploy goal at `docs/wip/2026-06-06-askmira-ignition-deploy/GOAL.md`.

---

## When this runbook applies

- Any change to `mira-bots/ask_api/`, `mira-bots/shared/engine.py` kiosk path (`_LIVE_STATUS_HEADER` / `_TAG_QUERY_RE` / `_MAINT_GAP_RE` / `enforce_citation_or_gap_admission`), or `mira-bots/shared/quality_gate.py`.
- Any change to Q1 status-summary or Q2 tag-read behaviour for the Ignition kiosk.
- Any change to the AskMira Perspective view at `MIRA_PLC/ignition/ConvSimpleLive/views/AskMira/view.json`.
- Pre-demo readiness check.
- Re-validation after an engine prompt / routing / retrieval change that could affect kiosk replies.

Does NOT apply to: Telegram / Slack adapter changes (use their own evals), `mira-pipeline /v1/chat/completions` (out of scope for the kiosk path — see `docs/wip/2026-06-06-askmira-ignition-deploy/GOAL.md`), or Vision-only changes.

---

## Critical deploy fact — read this BEFORE dispatching

`.github/workflows/deploy-vps.yml` line 199 default `TARGETS`:

```
TARGETS="${SERVICES:-mira-pipeline mira-ingest mira-mcp mira-hub mira-cmms-sync mira-bot-telegram mira-bot-slack}"
```

**`mira-ask` is NOT in the default list.** Auto-deploys triggered by `Smoke Test → Deploy to VPS` will NOT rebuild the `mira-ask-saas` container. Engine changes that ship to `mira-bot-telegram` / `mira-bot-slack` will silently SKIP the kiosk path.

Confirmed by example: 2026-06-06 19:03 UTC auto-deploy after PR #1754 merged. All 7 default targets rebuilt; `mira-ask-saas` stayed at its 47-hour-old image. Behavioural probe of `/ask` returned old engine behaviour. A second manual dispatch with `services=mira-ask` was required.

**Always use explicit dispatch for any AskMira / kiosk / `ask_api` change:**

```
gh workflow run deploy-vps.yml --repo Mikecranesync/MIRA -f services=mira-ask
```

Or via UI: Actions → Deploy to VPS → Run workflow → `services: mira-ask` → `skip_staging_gate: false` (always).

If the PR also changed shared engine code that other adapters need (Telegram, Slack), run the auto-deploy AND then the explicit `mira-ask` dispatch.

---

## Standard verification sequence

### 0 — Pre-flight

```bash
# Confirm prod is reachable
curl -s --max-time 5 http://100.68.120.99:8011/health
# Expect: {"status":"ok","platform":"ignition"}
```

If unreachable: container is restarting or VPS is down. Check the deploy run's "Deploy" step log for `Container mira-ask-saas Started`. Wait up to ~60 s.

### 1 — Behavioural probe (confirm new commit is running BEFORE re-baking)

`/health` returns OK even on the old container. Use a Q2 e-stop behavioural probe to confirm the engine fix is actually live:

```bash
curl -s --max-time 30 -X POST \
  -H "Content-Type: application/json" \
  -d '{"question":"is the e-stop OK?","tags":{"vfd_fault_code":0,"vfd_comm_ok":1,"e_stop":1,"mlc":1,"vfd_frequency":0,"vfd_freq_sp":3000,"pe_latched":1,"pe_beam":0,"vfd_current":0,"vfd_dc_bus":3250,"vfd_cmd_word":1,"vfd_status_word":0},"session_id":"verify-prod-commit"}' \
  http://100.68.120.99:8011/ask | jq -r '.answer' | head -10
```

- **Old engine** returns: `No previous interactions found for this AutomationDirect, GS10 in this session. This might be the first time it's been diagnosed here.`
- **New engine** returns: `Based on the live conveyor data: [LIVE CONVEYOR STATUS] ... E-stop ARMED/OK ... [Source: Live PLC/VFD tag snapshot via Ignition OPC-UA]`.

If you see the old text, the deploy did not rebuild `mira-ask-saas`. Re-dispatch `deploy-vps.yml` with `services=mira-ask`.

### 2 — Mode A engine bake (scorer-driven)

```bash
PLANT_STATE=current bash ~/.claude/skills/askmira-tester/scripts/run_engine_bake.sh
bash ~/.claude/skills/askmira-tester/scripts/score.sh <run-dir-from-stdout>
```

Acceptance gate: **9/10 minimum hard pass** with no foreign-vendor citations. Below 9/10 → block deploy or roll back.

Q1 length is the standing caveat (165 words vs 145 cap) — see `docs/wip/2026-06-06-askmira-ignition-deploy/GOAL.md` "Remaining caveats". Don't count Q1 H3 fail against the gate until the kiosk-scoped prompt-engineering / post-process trim follow-up lands.

### 3 — Mode B browser verification (binding race + live-tag freshness)

This step exists because the `--- Sources ---` block normalizer + the gate-bypass don't catch a view-side regression. Drive the actual Perspective view in a real browser session.

Skill: `~/.claude/skills/askmira-tester/scripts/run_view_drive.md`. The agent drives Playwright MCP directly:

1. Navigate to `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive/AskMira`.
2. If trial expired: navigate `/app/home`, log in with Gateway admin creds, click `Reset Trial`, re-navigate.
3. Type Q1 `current status?` → Tab → click Ask → wait `MIRA is thinking` text-gone → screenshot + capture answer.
4. **Without page reload**, type Q2 `is the e-stop OK?` → Tab → click Ask → wait → screenshot + capture answer.
5. Pass criteria:
   - Q1 and Q2 produce distinct on-topic replies (not byte-identical).
   - Both contain at least one `[Source:` marker.
   - Numeric live-tag values (e.g. `DC bus`) differ between Q1 and Q2 — proves fresh `system.tag.readBlocking` on each click. The MIRA_PLC#25 view binding fix is what makes this possible: textarea is read via `getSibling('question_input').props.text`, and `session_id` carries a per-click `system.date.now().getTime()` ms suffix.
6. Save screenshots to `~/.claude/skills/askmira-tester/runs/<stamp>/`. Build final PDF via `python ~/.claude/skills/askmira-tester/scripts/build_pdf.py <run-dir>`.

If Q2 returns Q1's answer verbatim: the view binding race regressed. Re-check `view.json` for the `getSibling` read. If `session_id` is shared across clicks: the millisecond suffix regressed. Both are MIRA_PLC#25 territory.

---

## Guardrails

The hard rules carried into every kiosk fix cycle. Any PR that violates one is a blocker.

| Rule | Why |
|---|---|
| **Do NOT weaken the askmira-tester scorer.** | The scorer at `~/.claude/skills/askmira-tester/scripts/score.sh` is the regression bar. Broadening regex to match more engine output is "fixing the scorer to match what we shipped" — exactly the closing-the-gate behaviour the user banned. PR #1755 demonstrates the correct path: fix engine output to match scorer vocabulary. |
| **Do NOT lower the golden Q1 cap or alter the golden Q1 reference.** | Golden Q1 lives at `~/.claude/skills/askmira-tester/golden/q01-current-status.md`. It is 145 words and stays 145 words. Engine output going over (currently 165) is the engine's problem, not the cap's. |
| **Do NOT touch `mira-pipeline /v1/chat/completions`.** | Wrong stack for the kiosk. See `docs/wip/2026-06-06-askmira-ignition-deploy/GOAL.md` — PR #1620 closed for this reason. The kiosk hits `mira-ask /ask` Tailscale-direct via the Perspective view's Gateway script. |
| **Do NOT reintroduce Anthropic provider.** | Removed in PR #610. Cascade is Groq → Cerebras → Gemini. |
| **Do NOT widen scope to Telegram / Slack adapters.** | Kiosk fast-paths (`_LIVE_STATUS_HEADER` gated) are scoped to the AskMira prompt shape. Telegram / Slack hit `route_intent` as before. Widening the fast-path to those adapters needs its own design + eval, not bundled into a kiosk PR. |
| **Always `--no-bypass` the staging gate** for kiosk changes. | The staging gate runs the Supervisor in-process against the NeonDB staging branch — that's the gate that catches grounded-path regressions before prod. The `skip_staging_gate=true` flag is for hotfixes only. |

---

## Current known issue — Q1 length (open, not bundled)

Q1 status-summary on prod returns a content-correct grounded answer at 165 words. The askmira-tester rubric hard ceiling is 145 words; golden is exactly 145 words. So the final RED on the 9/1 bake is purely a verbosity issue, not a content issue.

**Do NOT fix this by raising the cap.** The 145-word ceiling reflects the demo-readable target.

**Do NOT fix this by editing the golden.** Golden is the bar; engine moves to meet it.

**Recommended next fix (separate focused PR):**

- Prompt-engineering pass on the Q1 status-summary path. The system-prompt branch that fires when `[LIVE CONVEYOR STATUS]` is present should instruct the LLM to keep the reply ≤ 130 words, hard ceiling 145.
- OR: a deterministic kiosk-scoped post-process trim in the gate-bypass at `mira-bots/shared/engine.py:1244-1256`. If the reply is over 145 words, drop trailing sentences from the end until ≤ 130 words AND ≥ 4 sentences remain. Preserve all `[Source: ...]` markers — never trim a citation.

Whichever path is taken: regression test must prove (a) a no-fault Q1 doesn't go below 80 words (still informative), (b) a no-fault Q1 doesn't exceed 145 words, (c) the trim never lands inside a citation. Add 3 tests to `tests/test_askmira_regression.py`.

---

## How a kiosk-fix PR flows

1. Branch from `origin/main`.
2. Implement smallest safe change (engine.py or quality_gate.py or `ask_api/app.py`).
3. Add / extend tests in `tests/test_askmira_regression.py`. Run `pytest tests/test_askmira_regression.py -v` — must pass offline.
4. Ruff format + check: `python -m ruff format mira-bots/shared/engine.py tests/test_askmira_regression.py && python -m ruff check mira-bots/shared/engine.py tests/test_askmira_regression.py`.
5. Open PR. Wait for CI: Smoke Test + Staging Gate must both pass.
6. Merge to main.
7. **Dispatch `deploy-vps.yml -f services=mira-ask`** — the auto-deploy that fires from Smoke Test does NOT cover `mira-ask`.
8. Wait for the Deploy step to log `Container mira-ask-saas Started`.
9. Run verification sequence (this doc § "Standard verification sequence").
10. If Mode A < 9/10 hard pass: stop. Investigate. Roll back via `gh workflow run deploy-vps.yml -f services=mira-ask` after reverting the merge.

---

## Linked references

- Tester skill — `~/.claude/skills/askmira-tester/SKILL.md`
- Regression suite — `tests/test_askmira_regression.py`
- Engine entry — `mira-bots/shared/engine.py` (Supervisor, kiosk fast-paths)
- Ask API HTTP — `mira-bots/ask_api/app.py`
- Quality gate — `mira-bots/shared/quality_gate.py`
- View — `MIRA_PLC/ignition/ConvSimpleLive/views/AskMira/view.json` (separate repo)
- Deploy workflow — `.github/workflows/deploy-vps.yml`
- Staging gate workflow — `.github/workflows/staging-gate.yml`
- Original deploy goal — `docs/wip/2026-06-06-askmira-ignition-deploy/GOAL.md`
- Environment doctrine — `docs/environments.md`

## Change history

- 2026-06-06 — Initial. Cycle: PR #1620 closed (wrong stack) → MIRA_PLC#25 + PR #1754 + PR #1755 merged → 9/10 hard pass on prod.
