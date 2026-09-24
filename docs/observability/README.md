# Observability

MIRA's observability work is two separate systems answering two separate
questions — don't conflate them.

| Question | System | Where |
|---|---|---|
| "Is MIRA good, in aggregate, across many scenarios?" | The 5-regime eval framework + staging gate + DeepEval/RAGAS | `docs/observability/mira-agent-eval-audit.md` |
| "Why was THIS ONE answer wrong?" | Turn Flight Recorder (OpenTelemetry per-turn tracing) | `docs/architecture/observability/2026-09-22-turn-flight-recorder.md` |

## Turn Flight Recorder

Per-turn OpenTelemetry tracing for notebook chat (`mira-hub`), so a bad
answer on the phone can be diagnosed from one trace or one Turn Evidence
Packet without SSHing into staging.

- **Design:** `docs/architecture/observability/2026-09-22-turn-flight-recorder.md`
- **Decision record:** `docs/adr/0037-otel-turn-flight-recorder.md`
- **Runbook (start here for "a bad answer just happened"):**
  `docs/runbooks/turn-flight-recorder.md`
- **Code:** `mira-hub/src/capabilities/observability/`
  (`tracing.ts`, `config.ts`, `turn-recorder.ts`, `turn-evidence-packet.ts`,
  `anomalies.ts`), `mira-hub/src/instrumentation.node.ts`
- **Env vars:** `docs/env-vars.md` § Turn Flight Recorder

## Eval / agent-tracing audit

`docs/observability/mira-agent-eval-audit.md` — the 2026-06-11 audit that
decided to EXTEND the existing eval stack (5-regime framework, staging gate,
DeepEval, RAGAS) rather than adopt Arize Phoenix. Phoenix stays optional and
off by default; the Turn Flight Recorder does not reopen this decision — it
fills the different, per-turn-diagnosis gap that aggregate eval was never
meant to cover.
