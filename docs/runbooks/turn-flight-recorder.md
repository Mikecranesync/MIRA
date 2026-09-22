# Turn Flight Recorder — find a bad phone answer in 60 seconds

For Mike. A technician got a bad answer on the Pixel. This is how you find out
why without SSHing into staging. Full design:
`docs/architecture/observability/2026-09-22-turn-flight-recorder.md`.

## 1. Get the trace id (three ways, pick whichever you have)

- **From the phone / browser network tab:** every `/chat` and `/look`
  response carries header `x-mira-trace-id: <32-hex>`. The chat stream's
  FIRST SSE frame is also `{"kind":"trace","traceId":"…","turnId":"…"}`,
  before any answer text.
- **From the notebook, no phone needed — the diagnostics endpoint:**
  ```
  GET /api/equipment-notebooks/{notebookId}/turns/{turnId}/diagnostics
  GET /api/equipment-notebooks/{notebookId}/turns/diagnostics?limit=20
  ```
  (session cookie auth, same tenant as the notebook.) The second form lists
  the notebook's last 20 turns — decision + anomaly codes only, cheap to scan
  for "which turn was the bad one."
- **From the turn row directly**, if you already have `turnId`: the same
  `/turns/{turnId}/diagnostics` endpoint.

Either endpoint returns `{ traceId, turnId, packet, anomalies, viewerUrl? }`.
`viewerUrl` is only present when `MIRA_TRACE_VIEWER_URL_TEMPLATE` is set — it's
the direct Langfuse link, so you can skip step 2 entirely when it's there.

## 2. Open the trace in Langfuse

`https://us.cloud.langfuse.com` → the FactoryLM project (the one the keys in
Doppler `factorylm/stg` under `OTEL_EXPORTER_OTLP_HEADERS` belong to) →
**Traces** → filter `deployment.environment.name = staging` → search by the
trace id from step 1.

⚠️ **Staging and production currently share ONE Langfuse project** (design
§1's recorded caveat) — the environment filter is what keeps you looking at
the right traffic. A dedicated staging project is a follow-up (see the ADR).

## 3. Read the span tree top-down

Root span `mira.turn` has 9 children in order: `request.receive` →
`attachment.persist` (look only) → `vision.analyze` (look only) →
`evidence.materialize` → `identity.resolve` → `retrieval.execute` →
`context.assemble` → `chat <model>` (one per cascade attempt) →
`answer_gate.evaluate` → `turn.persist`. Full attribute list: design §3.

**Symptom → which span to open:**

| The technician says… | Look at | What you're checking |
|---|---|---|
| "It describes a photo but got the details wrong" | `evidence.materialize`, `chat <model>` | `mira.chat.has_image_input=false` + `mira.visual.observation_in_context=false` — the model answered from text, not the photo |
| "It says there's no manual for this" | `retrieval.execute` | `mira.retrieval.strategy` / `.executed` — was retrieval even attempted, and why not (`zero_result_reason`) |
| "The answer sounds confident but generic" | `answer_gate.evaluate` | `mira.answer_gate.reason` — look for `GENERIC_ANSWER_UNGROUNDED_CLAIM` in `mira.anomalies` on the root span |
| "It never figured out which drive I'm looking at" | `identity.resolve` | `mira.identity.unresolved_reason` — look for anomaly `IDENTITY_PIPELINE_DROPPED` (identity had signal — an observation or candidates — and dropped it silently) |
| "Nothing shows up in the notebook history" | `turn.persist` | `mira.persist.outcome` / `.error_code` — the answer streamed fine but the DB write failed |

## 4. The anomaly codes (also on `mira.anomalies` on the root span, and in
`anomalies` in the diagnostics response)

| Code | Means |
|---|---|
| `PHOTO_WITH_NO_OBSERVATIONS` | A photo reached the turn but vision produced no observation text |
| `VISUAL_EVIDENCE_DROPPED` | An observation existed (this turn or a prior one) but never reached context assembly |
| `EQUIPMENT_ANSWER_WITH_NO_EVIDENCE` | The turn looked equipment-specific and MIRA answered, but zero doc chunks or visual evidence backed it |
| `IDENTITY_PIPELINE_DROPPED` | Identity had signal to work with and never resolved AND never recorded why |
| `STAGING_TO_PROD_ROUTE` | Staging is configured but one of its outbound routes actually points at production — see `docs/architecture/observability/2026-09-22-turn-flight-recorder.md` §11 for how this is proven absent before every deploy |
| `GENERIC_ANSWER_UNGROUNDED_CLAIM` | MIRA answered with a specific-sounding number/unit while retrieval never ran and no image reached generation — nothing grounds the number |

A packet can carry more than one code. None of them block the technician's
answer — they're diagnostic only (design §5).

## 5. Turning content capture on (for one controlled staging session)

By default, spans carry ids/counts/flags/durations only — never message text,
answer text, chunk text, or prompts (design §8). To see the actual prompt/
answer text for one debugging session:

1. In Doppler `factorylm/stg`, set `MIRA_OTEL_CAPTURE_CONTENT=1`.
2. Redeploy staging (`deploy-staging.yml`) so the container picks it up.
3. Reproduce the turn. `gen_ai.input.messages` / `gen_ai.output.messages` now
   appear on the `chat <model>` span — sanitized (IP/MAC/serial patterns
   stripped) and truncated to 4 KB.
4. **Turn it back off** (`MIRA_OTEL_CAPTURE_CONTENT=0` or delete the var) and
   redeploy. This is a debugging mode, not a standing configuration.

Never enabled in production by this work, regardless of the staging value.

## 6. What is NEVER captured, on or off content-capture

Cookies, `Authorization` / provider API keys, next-auth tokens, signed
evidence tokens, Doppler values, image bytes — in spans, span events, or the
Turn Evidence Packet, ever. Enforced by an allowlist + redaction processor in
`tracing.ts` that runs on every span before export, not just the ones the app
code touches (it also scrubs auto-instrumentation's own attributes). See
`.claude/rules/security-boundaries.md`.

## 7. Failure behaviour (so you know what "no trace" means)

- No `OTEL_EXPORTER_OTLP_ENDPOINT` configured → tracing is fully off, zero
  overhead, packets still get written (with `otel_trace_id: null`) — the
  diagnostics endpoint still works from the packet alone.
- Backend unreachable (Langfuse down) → spans are dropped, never block a
  response, never leak memory (bounded queue). `/api/health`'s
  `telemetry.tracing` still reports `"enabled"` — it reflects configuration,
  not backend reachability.
- A packet write failure → logged as `turn.usage.persist_failed` (now with
  `traceId` attached) — the technician's answer is never held back for this.

## 8. Inserting a Collector later

Today: SDK → Langfuse, direct OTLP/HTTP, no Collector (design §1, Option A).
To insert one later: point `OTEL_EXPORTER_OTLP_ENDPOINT` at the Collector
instead of Langfuse, and have the Collector forward to Langfuse (or wherever).
**One env var. No code change.**
