# Rebuttal — PR #3959, prior Gate 7 report

## Finding 1 [high] "Stale allow-list entries break the drift-guard test" — REJECTED

The premise is that after migration the two routes no longer contain "You are MIRA".
They do. The legacy constants (BASE_SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT in the
notebook route; SYSTEM_PROMPT in hub/ask) are deliberately RETAINED as the flag-off
rollback path, which is the whole reason the flag can be turned off safely. The
drift guard passes; the full suite is 3325/3325 green with the flag OFF and ON.

## Finding 2 [high] "Database schema incompatibility for new turn-mode values" — REJECTED

The report's own NOT REVIEWED section states the schema was never examined.
Checked against the real migrations: `evidence_packet` is **JSONB**
(mira-hub/db/migrations/090_decision_traces_turn_packet.sql line 93), the packet is
written with `JSON.stringify(record.packet)`, and there is **no CHECK constraint or
enum on `mode` or `system_prompt_kind` in any migration**. Postgres stores the new
values as ordinary JSON strings. No migration is required.

## Finding 3 [medium] "Observability pipeline may reject new system_prompt_kind" — ACCEPTED AND FIXED

Correct, and the most valuable finding in the review. `tools/qa/retrieval_acceptance.py`
asserted `system_prompt_kind in ("grounded","machine")`. Under the contract a normal
turn carrying chunks reports `augmented`, so the LIVE staging acceptance loop would
have failed on the first turn after the flag went on, while nothing was wrong.
Widened to accept the contract modes, with the reasoning recorded at the call site.
No other consumer matches exhaustively (`jev_shadow_report.py` passes the value
through).

## Finding 4 [medium] "general is silently remapped to augmented" — ACCEPTED AS DOCUMENTED

Correct observation, deliberate behaviour. It is the deployed-APK compatibility
contract: the client sends `mode:"general"` only when no sources are selected, and
treating that as normal chat is what lets this ship server-side with no new APK.
Now stated explicitly in the spec (§3.0-pre), including that only two of the three
modes are reachable today.

## Finding 5 [low, prior round] "harness hard-coded paths and unchecked API key" — ACCEPTED AND FIXED

Both A/B harnesses now resolve the repo via `git rev-parse` (override `MIRA_REPO`)
and refuse to run without `MIRA_AB_CONFIRM=yes`, so a money-spending script cannot
execute by accident.
