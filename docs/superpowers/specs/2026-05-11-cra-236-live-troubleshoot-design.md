# CRA-236 — Live Troubleshoot Endpoint (Ignition tags + MIRA reasoning)

**Status:** in-flight
**Owner:** Mike / Claude
**Service:** `mira-machine-logic-graph`
**Branch:** `claude/happy-saha-632958`

## Goal

Add `POST /projects/:id/live-troubleshoot` to mira-machine-logic-graph. The
endpoint pulls live tag values from an Ignition gateway, merges them with the
project's static graph context (parsed ST + manifest), and asks a Groq-cascade
LLM to produce a grounded troubleshooting answer that cites the live tag
values it used.

## Non-goals

- Writing tags back to Ignition (read-only).
- Multi-turn conversation state — single-shot Q&A.
- Replacing the diagnostic Supervisor in mira-bots/shared. This endpoint is
  the PLC-grounded read path; the Supervisor remains the conversation path.
- Anthropic. PRD §4 — Groq → Cerebras → Gemini cascade only.

## API

```
POST /projects/:id/live-troubleshoot
Body: {
  "question": "Why won't Conveyor_B16_Run turn on?",
  "ignitionUrl": "http://localhost:8088",
  "tagPrefix": "[default]MIRA_PLC"
}

200 OK
{
  "answer": "...grounded answer citing live values...",
  "tags_read": [
    { "path": "[default]MIRA_PLC/motor_running", "value": false, "quality": "Good", "timestamp": "2026-05-11T..." }
  ],
  "context_used": [
    "variable:motor_running (BOOL, %M1.0)",
    "variable:e_stop_active (BOOL, %I0.0)"
  ],
  "provider": "groq"
}

404  project_not_found
502  ignition_unreachable | llm_unavailable
500  build_failed
```

## Data flow

1. `findProject(:id)` — resolve project, 404 if missing.
2. `buildTagsForProject(project)` — get parsed ST + manifest + tag export.
   The variable list is the graph context.
3. **Ignition read:** `POST {ignitionUrl}/data/tag/read` with Basic auth from
   `IGNITION_USER` / `IGNITION_PASSWORD` envs. Body = `{ paths: [...] }` built
   from each manifest variable: `{tagPrefix}/{variable.name}`.
4. **Prompt construction** — system + user. System constrains the LLM to:
   - Only cite tag values present in `tags_read`.
   - Mark each tag value `[live]` in the answer.
   - Refuse to invent tags or values.
5. **LLM call** — Groq cascade via fetch. Order: Groq → Cerebras → Gemini.
   First success wins. All three providers speak the OpenAI chat-completions
   shape. 502 if all three fail.
6. Return structured response.

## Environment

| Var | Required | Default | Purpose |
|---|---|---|---|
| `GROQ_API_KEY` | one of | — | Primary LLM |
| `CEREBRAS_API_KEY` | one of | — | Fallback |
| `GEMINI_API_KEY` | one of | — | Fallback |
| `GROQ_MODEL` | no | `llama-3.3-70b-versatile` | |
| `CEREBRAS_MODEL` | no | `llama3.1-8b` | |
| `GEMINI_MODEL` | no | `gemini-2.0-flash` | |
| `IGNITION_USER` | no | `admin` | Basic auth |
| `IGNITION_PASSWORD` | no | `password` | Basic auth |
| `IGNITION_TIMEOUT_MS` | no | `5000` | |

At least one LLM key required; otherwise 502.

## Files

- `src/api/live-troubleshoot.ts` — handler + helpers (Ignition read, LLM cascade).
- `src/server.ts` — mount the route.
- `tests/live-troubleshoot.test.ts` — endpoint tests using injected `fetch`
  doubles (the global `fetch` is monkey-patched per test, no real network).

## Test plan

- **404** for unknown project id.
- **400** for missing `question`, `ignitionUrl`, or `tagPrefix`.
- **502** when Ignition returns non-2xx.
- **502** when no LLM provider key is set.
- **200** happy path: Ignition fetch and LLM fetch both return canned 200,
  response includes `answer`, `tags_read`, `context_used`, `provider`.
- **Fallback**: Groq returns 500, Cerebras returns 200 → response
  `provider: "cerebras"`.

## Risks

- Real Ignition latency. Bound by `IGNITION_TIMEOUT_MS` via `AbortSignal.timeout`.
- LLM hallucinating tag values. Mitigation: system prompt + only pass values
  from `tags_read`; answer cites live values verbatim.
- Manifest may be larger than the LLM context window. Mitigation: cap context
  at first 64 variables (covers Micro820 line 1; revisit when projects grow).

## Out of scope (next ticket)

- Caching tag reads.
- Streaming responses.
- Multi-turn carryover.
