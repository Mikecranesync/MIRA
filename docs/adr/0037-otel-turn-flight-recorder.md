# ADR-0037 — OpenTelemetry Turn Flight Recorder for notebook chat

**Status:** Proposed
**Date:** 2026-09-22
**Claim:** #3939 · branch `feat/otel-turn-flight-recorder` · base `c1398461a`
**Design:** `docs/architecture/observability/2026-09-22-turn-flight-recorder.md`
**Runbook:** `docs/runbooks/turn-flight-recorder.md`

## Context

Mike diagnoses a bad notebook-chat answer today by SSHing into staging and
reading rotating container logs, or by re-asking the same question and
guessing. There is no way to see, for one turn, which stage produced a bad
result — vision, identity resolution, retrieval, context assembly, the
provider cascade, or the answer gate — without instrumenting each one by
hand, every time.

**Acceptance case:** a stranger asks a real question on the Pixel MIRA
Staging app (a photo + a follow-up question), gets a bad or surprising
answer, and Mike opens exactly ONE trace (or one Turn Evidence Packet) and
can point at the stage that produced it — end to end, no SSH.

This is a per-turn *diagnostic* need (why was THIS answer wrong), distinct
from the existing 5-regime eval framework (`tests/eval/`, aggregate quality
over many scenarios) and from the existing spend ledger (`decision_traces`,
what did this turn cost) — both of which stay exactly as they are.

## Decision

1. **OpenTelemetry JS Node SDK, direct OTLP/HTTP (protobuf) export to
   Langfuse cloud. No Collector in v1.** One service (`mira-hub`), one
   backend. The SDK's own `BatchSpanProcessor` already bounds memory and
   never blocks a request; inserting a Collector later is a single env var
   change (`OTEL_EXPORTER_OTLP_ENDPOINT`), not a code change.
2. **Traces only — no OTel logs or metrics program.** Existing `console.*`
   logging stays; the one addition is `traceId` on the existing structured
   error events (`turn.usage.persist_failed` etc).
3. **The durable per-turn record extends `decision_traces`** (migration
   `090_decision_traces_turn_packet.sql`) rather than creating a new ledger
   table. `decision_traces` is already the canonical per-turn audit/spend
   ledger with a single TypeScript writer (`persistTurnUsage`); the eight new
   columns (`otel_trace_id`, `turn_id`, `client_request_id`, `notebook_id`,
   `environment`, `git_sha`, `evidence_packet`, `anomalies`) are additive and
   NOT-NULL-default-safe for every existing caller. See materialized-evidence
   rule 15 ("do not build a second registry").
4. **The Turn Evidence Packet carries ids, counts, booleans, and timings
   only — never message/answer/chunk text, prompts, or image bytes.**
   Content capture (`gen_ai.input.messages`/`gen_ai.output.messages` on
   generation spans) exists as an explicit opt-in
   (`MIRA_OTEL_CAPTURE_CONTENT=1`), sanitized and truncated, off by default
   in staging and never enabled in production by this work.
5. **An attribute allowlist + redaction processor (`MiraAttributeProcessor`)
   runs on every span before export**, not just spans the app code touches —
   it also scrubs whatever auto-instrumentation (`http`/`pg`/`undici`)
   attaches. Auto-instrumentation header capture is never enabled as a second
   line of defense, not a substitute for the processor.
6. **Six deterministic anomaly checks run over the packet** (pure functions,
   no I/O) so a bad answer's likely cause is flagged without Mike having to
   re-derive it from the raw packet by eye every time.
7. **Mobile v1 is unchanged.** The server ingress span is the trace root. A
   `/look` trace and the following `/chat` trace are correlated server-side
   (an OTel span link plus `vision_trace_id` on the packet), not via a client
   `traceparent` header — that's a documented follow-up.
8. **Staging-first.** Doppler `factorylm/stg` gets the six `OTEL_*` values;
   production compose (`docker-compose.saas.yml`) is not touched by this
   work. `productionRouteDetected()` + the `STAGING_TO_PROD_ROUTE` anomaly
   exist specifically to catch staging accidentally routing to a production
   host, since Doppler `dev`/`stg`/`prd` currently share Langfuse project
   keys (recorded caveat, design §1).

## Alternatives rejected

- **An OpenTelemetry Collector in front of the exporter.** Adds a service to
  operate, deploy, and monitor for a single-backend, single-service setup
  that doesn't need routing, sampling policy, or fan-out yet. Deferred, not
  ruled out — the SDK talks OTLP either way, so adding one later is a
  destination-only change.
- **Arize Phoenix.** Already evaluated and rejected for MIRA's eval/
  observability needs generally (`docs/observability/mira-agent-eval-audit.md`,
  2026-06-11) — extend the existing system, Phoenix stays optional and off by
  default. The Turn Flight Recorder doesn't reopen that decision; it fills a
  different gap (per-turn diagnosis, not aggregate eval).
- **LangSmith.** Would mean adopting LangChain's tracing conventions and
  vendor lock-in around a framework MIRA explicitly does not use (PRD §4: no
  LangChain). Also a paid third-party SaaS with no clearer per-turn diagnosis
  story than OTel-native Langfuse for this use case.
- **A custom framework/logging convention** (structured `console.log` calls
  with a hand-rolled correlation id scheme instead of real distributed
  tracing). Rejected because propagation across the actual async hop shapes
  this codebase uses (awaited calls, `setTimeout`, `Promise.all` fan-out, SSE
  `ReadableStream` callbacks, provider cascade attempts) is exactly the
  problem OpenTelemetry's context propagation already solves correctly;
  reinventing it means re-discovering the same bugs (see
  `propagation.test.ts` for the hop shapes this now has regression coverage
  for).
- **Browser-side OTel inside the mobile app's WebView.** Would give a true
  end-to-end client trace, but needs an APK change, a guarded transport file,
  and a client `traceparent` — real work, correctly deferred to the
  documented mobile follow-up rather than blocking the server-side story that
  already closes the acceptance case (a trace/packet Mike can open today).

## Consequences

- **Positive:** a bad answer is diagnosable from one trace/packet without
  SSH, in the order the design's symptom table gives (runbook §3). Zero
  overhead when unconfigured (no-op tracer). No new registry — reuses
  `decision_traces`. Redaction is enforced structurally (an allowlist a span
  can't bypass), not by convention at each call site.
- **Negative / accepted for now:** staging and production Langfuse traffic
  share one project until a dedicated staging project is created (a
  Mike-side account action, not blocked on code). No client-side trace
  correlation yet — a `/chat` trace and the `/look` trace that supplied its
  photo are linked server-side, not by a shared client trace id. No metrics
  or logs pipeline — traces only.
- **A real, currently-open gap, not introduced by this ADR but surfaced by
  its test suite:** `tracing.ts`'s `SECRET_VALUE_MARKERS` has no
  Doppler-service-token shape (`dp.st.`, `dp.ct.`, `dp.sa.`). A Doppler token
  value stored under a neutral (non-`token`/`secret`/`api_key`-named)
  attribute key would currently survive redaction. See
  `redaction.test.ts`'s `it.fails` case, which documents this and turns red
  the moment it's fixed. Filed as a follow-up, not blocking this ADR.

## Follow-ups

- Client `traceparent` propagation from the mobile app (needs an APK change
  and a guarded transport file) — `propagation.test.ts` already proves
  server-side extraction of a real inbound header is ready to receive it.
- Server-side `/look` → `/chat` span link resolved via an actual DB lookup on
  `fileId` (today: `vision_trace_id` on the packet is the correlation key;
  the span-link wiring is design §1's "documented follow-up").
- A dedicated staging Langfuse project (Mike-side account action) so staging
  and production traces stop sharing one project.
- A production sampling decision — v1 ships `parentbased_always_on` (100%)
  for staging only; production isn't touched by this work at all yet.
- Close the Doppler value-marker gap above in `tracing.ts` (lane I1's file).

## Cross-references

- `docs/architecture/observability/2026-09-22-turn-flight-recorder.md` — the
  full design (span model, packet schema, anomaly predicates, config,
  rollout, §11 staging acceptance plan).
- `docs/runbooks/turn-flight-recorder.md` — the phone-test-oriented "find a
  bad answer in 60 seconds" runbook.
- `docs/observability/mira-agent-eval-audit.md` — the eval/observability
  decision this ADR does not reopen.
- `.claude/rules/materialized-evidence.md` rule 15 — why this reuses
  `decision_traces` instead of a new registry.
- `.claude/rules/security-boundaries.md` — the redaction/PII discipline this
  ADR's attribute allowlist implements.
