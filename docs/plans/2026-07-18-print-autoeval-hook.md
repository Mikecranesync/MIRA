# Per-turn $0 auto-eval hook for print-translator replies (designed 2026-07-18, awaiting build go)

**Goal:** after every print-path reply the Telegram bot sends, automatically run a **deterministic,
$0, truth-free evaluation** of the answer, record the grade in `conversation_eval` meta, and push a
flood-guarded ntfy alert when a P0 check trips. Never blocks or alters the technician's reply;
fail-open everywhere. One PR, target **v3.163.0** (feat → minor).

**Operator decisions (Mike, 2026-07-18):** P0 alerts via **ntfy push** (`send_push`, existing
`NTFY_TOPIC`); **fold in open PR #2714** (`feat/print-turn-persistence` — rebase on main and land
alongside, closing the SQLite `interactions` capture gap in the same program).

**Spend-law constraints** (`.claude/rules/zero-token-architecture.md`): no LLM judge, no paid
inference — grading is regex/set ops on the already-produced answer. Live turns have no ground
truth → only the truth-free grader subset applies.

## Why

Print-translator turns are captured by NEITHER eval pipeline today: they bypass `engine.process()`,
so no `log_interaction` (SQLite/screener) and no `log_turn` (NeonDB `conversation_eval`), and the
engine's per-turn citation-compliance + groundedness gates never run on them. The only live grading
is manual (`/printsense_grade`) or scheduled frozen lanes. Both of today's live defects (silent
4096-char delivery death; 0-OCR-items quality signal) surfaced only because the operator happened to
be tailing logs.

## Verified building blocks (explored 2026-07-18; all $0/truth-free)

- `printsense/benchmarks/single_photo_grader.py`: `_state_claim_asserted` (:88 — negation-aware;
  do NOT use raw `_STATE_CLAIM_RE`), `extract_prose_tags` (:125), `_SAFETY_MARKERS` (:111),
  `_REFUSAL_MARKERS` (:101), `estimate_cost_usd` (:257).
- `mira-bots/telegram/printsense_testkit.py`: `_detect_identifier_drift`/`_lev1`/`_unseen_tagish`
  (:879–906) — truth-free when fed the live turn's `vision_data["ocr_items"]` as truth tokens.
- `mira-bots/shared/conversation_logger.py::log_turn` (:46) — fail-open, 2s cap, PII-sanitizes
  user_message/bot_response but NOT meta (evaluator caps its own detail snippets at 160 chars).
  `source` is pinned to "telegram"/"slack" by its docstring — surface goes in `intent` + `meta.surface`
  (drive-pack precedent `_capture_drive_pack_turn`, bot.py:294).
- Usage attribution: `printsense.interpret.pop_last_usage()` (paid path, module-global slot) else
  `engine.router.last_model_for(str(chat_id))` (free cascade; `_grounded_print_reply` passes
  `session_id=str(chat_id)`).
- Alerting: `mira-bots/shared/notifications/push.py::send_push` — already imported in bot.py:40;
  `NTFY_URL`/`NTFY_TOPIC` already in BOTH compose blocks. Use `priority="high"`, NOT
  `push_safety_alert` (that says "MIRA SAFETY STOP" — reserved for live safety stops; alarm fatigue).
  `mira-crawler/reporting/telegram_notify.py` is NOT in the bot image — not an option.
- Hook seam: `bot.py::_try_print_translator_reply` — the only site with question + `vision_data` +
  reply + chat id in scope, across both reply branches (deterministic fast-path; theory). Post-#2792
  both sends go through `_reply_chunked`, but the hook belongs at the two call sites (vision_data is
  out of scope inside the generic delivery helper).
- PTB app is built WITHOUT `concurrent_updates` → updates are sequential, but a `create_task`'d hook
  interleaves with the next turn → **pop usage + capture latency synchronously at the call site,
  then `create_task` the rest**.

## Implementation

### 1. New module `mira-bots/shared/print_autoeval.py` (ships via the wholesale `COPY mira-bots/shared/`)

- `AUTOEVAL_VERSION = 1`; meta contract docstring (consumed later by `eval_scorer` — see risks).
- `enabled() -> bool`: `(os.getenv("PRINT_AUTOEVAL_ENABLED") or "1") == "1"` — default-ON kill
  switch, compose `${VAR:-}` empty-string-safe. Test both `""` (ON) and `"0"` (OFF).
- `evaluate_print_turn(question, answer, vision_data, usage, latency_s, *, branch, interpreter_configured) -> dict`
  — pure/synchronous (µs). Lazy in-function `from printsense.benchmarks import single_photo_grader`
  in try/except → degraded result with `grader_available: False` on failure (caveat check needs only
  `shared.print_translator`). Flags (each `{"class","severity","detail"}`, details capped 160 chars):
  - **P0 `unsupported_state_claim`** — `_state_claim_asserted(answer)`.
  - **P0 `paid_spend_on_free_path`** — `estimate_cost_usd(usage) > 0` AND
    (`branch == "deterministic_fastpath"` OR not `interpreter_configured`). Sanctioned paid spend →
    info only.
  - **P1 `ocr_identifier_drift`** — `detect_identifier_drift(answer, tuple(ocr_items))`;
    **skip + record in `skipped` when `ocr_items` empty** (live turns showed 0 OCR items).
  - **P1 `invented_tags`** — `extract_prose_tags(answer)` minus tags whose `lstrip("-")` occurs in
    `" ".join(ocr_items)`; skip when OCR empty.
  - **P1 `missing_caveat`** — `_CONTACT_VERDICT_RE` match without any `_CAVEAT_MARKERS` (tripwire
    for a `format_theory_reply` regression — should never fire post-UNSEEN-4).
  - info: refusal/safety-marker presence, provider/model, `estimated_cost_usd`, `latency_s`,
    `prose_tag_count`, `ocr_item_count`. Result must `json.dumps` cleanly (pinned by test). Never
    embed `ocr_items` or the full answer in meta.
- `should_alert(result)` (severity == "P0"), `format_alert(result)` (flag classes + capped details +
  branch/provider/cost; no question text, no chat_id — ntfy topics can be public; note "best-effort
  attribution" re the usage slot; total < ~500 chars).
- `AlertRateLimiter(max_per_hour=5, per_flag_cooldown_s=900)` — stdlib deque of monotonic timestamps
  (router.py:269 windowing style) + per-class last-sent dict; `allow(classes, now=None)`;
  module singleton `ALERT_LIMITER`. This is the kb_cron-flood guard (v3.159.1 lesson): worst case a
  broken grader emits 5 pushes/hour, repeats of one class collapse to 1/15min. Suppressions still
  log (`AUTOEVAL_ALERT_SUPPRESSED`).

### 2. Hook in `mira-bots/telegram/bot.py`

- `_schedule_print_autoeval(*, question, answer, vision_data, branch, t0, update)` — sync:
  `enabled()` gate → latency from `t0` → usage = `interpret.pop_last_usage()` else
  `router.last_model_for(chat_id)` parsed to `{"provider","model"}` → `asyncio.create_task(_autoeval_print_turn(...))`.
  Whole body try/except → `PRINT_AUTOEVAL_SCHEDULE_ERROR` warn. (create_task, not await: log_turn 2s
  + send_push 10s worst-case must not hold the sequential update loop; precedent bot.py:1138.)
- `async _autoeval_print_turn(...)` — one try/except body: evaluate → loud
  `PRINT_AUTOEVAL severity=… flags=… branch=… provider=… cost=… latency=…` info log →
  `log_turn(chat_id=…, user_message=question, bot_response=answer, source="telegram",
  intent="print_translator", has_citations=(branch=="deterministic_fastpath"),
  response_time_ms=…, meta={"surface":"print_translator","autoeval":result, tenant if available})`
  → on `should_alert` + `ALERT_LIMITER.allow`: `send_push(…, title="MIRA PrintSense autoeval P0",
  priority="high")`.
- Call sites in `_try_print_translator_reply`: `t0 = time.monotonic()` after the cheap-reject; after
  the deterministic-branch send → schedule with `branch="deterministic_fastpath"`; theory branch:
  bind `final_text = reply or format_theory_reply(...)` BEFORE sending (grade exactly what shipped),
  send, schedule with `branch="theory"`.

### 3. Drift-helper single-sourcing (same PR)

Promote `_UNSEEN_TAGISH_RE`, `_unseen_tagish`, `_lev1`, `detect_identifier_drift` (public name) from
`printsense_testkit.py:871–906` into `single_photo_grader.py` verbatim; testkit keeps working via
aliases (`_lev1 = _grader._lev1`, `_detect_identifier_drift = _grader.detect_identifier_drift`) so
`test_printsense_unseen_lane.py` and testkit:986 are untouched. Rationale: shared/ must never import
a telegram-dir module.

### 4. Tests (hermetic, keyless)

- `mira-bots/tests/test_print_autoeval.py` — evaluator units: state-claim P0 + negation guard +
  contrast re-arm; paid-spend P0 vs sanctioned-info; invented-tags P1 + grounded-tag pass +
  **empty-OCR skip**; drift P1 on the canonical V7301←-W7301 lev-1 pair + empty-OCR skip;
  missing-caveat P1/clean; info lanes; `json.dumps` round-trip; grader-unavailable degrade;
  `AlertRateLimiter` (first-allow, class cooldown, cross-class allow, 5/hour cap, window expiry —
  injected `now`); env knob `""`→ON / `"0"`→OFF / unset→ON.
- `mira-bots/tests/test_print_autoeval_hook.py` — clone the
  `test_printsense_deterministic_fastpath.py` harness (AsyncMock reply_text, monkeypatched engine
  seams, paid seam raises if touched) + mock `bot.log_turn` (per `test_telegram_drive_capture.py:79`)
  and `bot.send_push`: deterministic-branch capture asserts source/intent/meta shape; theory branch
  grades the exact sent string; P0 alert fires once then rate-limits (fresh `ALERT_LIMITER` per
  test); fail-open trio (evaluator/log_turn/send_push each raising → reply unaffected, True
  returned); kill switch; **router still `assert_not_awaited()` on the deterministic branch** (the
  hook adds zero model calls — spend law).
- Keep green: `test_printsense_deterministic_fastpath.py`, `test_printsense_unseen_lane.py`,
  `tests/printsense/` (grader gains additive names only).

### 5. Env / compose / docs / version

- Both compose files, `mira-bot-telegram` env block: `- PRINT_AUTOEVAL_ENABLED=${PRINT_AUTOEVAL_ENABLED:-}`
  (docker-compose.staging-vps.yml ~L448; docker-compose.saas.yml ~L361). `NTFY_*` already mapped.
- `docs/env-vars.md` row: default ON (`or`-form parse — empty string means ON); `0` disables the
  per-turn print autoeval (grade + conversation_eval row + P0 ntfy alert); zero inference cost.
- VERSION → 3.163.0 (claim next-free at commit time); CHANGELOG entry in the v3.156.0 style.
- Optional: a read-only `db-inspect.yml` probe counting last-24h rows
  `WHERE meta->>'surface'='print_translator'` for push-button staging read-back.

### 6. Companion: rebase + land PR #2714

`feat/print-turn-persistence` (commit 636386729): guarded `ALTER TABLE interactions ADD COLUMN
route/model/devices/input_sha256/fallback_reason` + `log_interaction` kwargs + tests. Rebase on
current main (expect VERSION/CHANGELOG restack), green, merge — order vs the hook PR doesn't matter
(independent stores), but land both in the same sequence.

## Verification (post-merge, $0)

1. `deploy-staging services="mira-bot-telegram"`.
2. In-container: `docker exec stg-mira-bot-telegram python -c "from shared import print_autoeval as a; print(a.enabled(), a.AUTOEVAL_VERSION)"` + boot log shows no import errors.
3. Mike sends one print photo + a closed-form question → normal reply unchanged, then
   `docker logs stg-mira-bot-telegram | grep PRINT_AUTOEVAL` shows
   `severity=ok flags=[] branch=deterministic_fastpath`.
4. Row read-back via the db-inspect probe (staging Neon, read-only). Never psql prod.
5. Do NOT force paid spend to test the P0 alert — the hook-suite alert test covers it hermetically.

## Sharpest risks

1. **Meta shape vs the future batch scorer**: `eval_scorer.score_row` LLM-judges every
   non-drive-pack row once its beat lands. Pin `meta.surface="print_translator"` + `meta.autoeval`
   NOW so a one-function scorer follow-up can self-label print rows deterministically instead
   (wrong shape now = backfill later).
2. **Usage-slot misattribution**: `interpret.pop_last_usage()` is a module-global also popped by
   `/printsense_test` bench lanes — a live turn racing an admin bench can mis-pop. Accepted as
   best-effort telemetry (the P0 paid-spend flag can false-positive during a concurrent bench run);
   flood guard caps blast radius; alert text says "best-effort attribution".
3. **Flood-guard correctness**: the limiter is the single guard between a regressed regex and a
   kb_cron-style alert flood — its unit tests (injected `now`) and the suppression log line are
   load-bearing.
