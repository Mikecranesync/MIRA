# /mira-trace-technician-flow

Trace the full technician request flow from Slack event → MIRA's final response. Identify every code hop, confirm the UNS confirmation gate sits before troubleshooting, and flag any path where troubleshooting can start without confirmed context.

## What this command does

1. **Start in `mira-bots/slack/bot.py`** — find the Slack Bolt event handler that receives a message.
2. **Trace through `chat_adapter.py`** → the platform-neutral message envelope.
3. **Enter the engine layer** — `mira-bots/shared/engine.py` (Supervisor / GSD engine). Note FSM state transitions.
4. **Locate asset-context parsing** — where the message is parsed for asset/line/area/machine/component/symptom/fault hints. Likely calls `uns_resolver` per `docs/specs/uns-message-resolver-spec.md`.
5. **Locate the UNS lookup** — calls into `mira-crawler/ingest/uns.py`, `kg_entities`, or the future `mira-uns-mcp`.
6. **Find the confirmation-gate** — the code path that:
   - Builds the confirmation message (site/area/line/machine/asset/component/fault + evidence + confidence + confirmation question)
   - Sends it to Slack
   - Waits for technician confirm/correct
   - Only then transitions FSM to a troubleshooting state
7. **Find the troubleshooting entry** — the code that actually produces troubleshooting advice (grounded answer generation).
8. **Walk the response path back to Slack** — final formatting, citation rendering, send.

## What to flag

- **Any path that reaches troubleshooting without passing through the confirmation gate.** This is a bug, regardless of guardrails downstream.
- **Any path that emits an answer without `evidence_packet` or `evidence_utilization` populated** — see `mira-bots/shared/benchmark_db.py` + `citation_compliance.py`.
- **Any place where asset context is inferred from message text alone, without calling the UNS resolver.**
- **Any code that hardcodes a fake site/line/asset** (Stardust Racers strings outside of demo fixtures).
- **Any place where the FSM can short-circuit the gate** (default routes, error-path bypasses, prompt-injection shortcuts).
- **Any place where a CMMS write (work-order create) happens without a draft step.**

## Output

Write or update `docs/technician-flow-trace.md` with:

1. **Top-level diagram** (mermaid sequence diagram) — Slack → adapter → engine → uns_resolver → confirmation → technician → troubleshoot → response.
2. **Step-by-step table** — each hop with file path + function name + 1-line description.
3. **Confirmation gate verification** — yes/no + the exact file:line that enforces it.
4. **Bypass risks** — every flagged path, with file:line, the type of bypass, and a suggested fix.
5. **Suggested fixes** — concrete diff outline per risk (don't apply diffs, just propose).
6. Date stamp at top.

## Constraints

- **Read-only.** This command does not modify code.
- **Cite real file:line.** Use `grep -n`. Never invent line numbers.
- **Don't simulate the LLM** to "test" the flow — just trace the code.

## Verification

- `grep -n "engine.py" docs/technician-flow-trace.md` — confirm the engine is in the trace.
- `grep -n "uns_resolver\|resolve_uns_path" docs/technician-flow-trace.md` — confirm UNS hop is identified.
- `grep -n "confirmation" docs/technician-flow-trace.md` — confirm gate is in the trace.

## Cross-references

- `.claude/CLAUDE.md` — UNS gate definition
- `.claude/skills/uns-location-gate-designer/SKILL.md` — required flow
- `docs/specs/uns-message-resolver-spec.md` — resolver authority
