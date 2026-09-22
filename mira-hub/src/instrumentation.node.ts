/**
 * Node-runtime OTel bootstrap for the Turn Flight Recorder. Imported only
 * from `instrumentation.ts` under `NEXT_RUNTIME === "nodejs"`.
 * See docs/architecture/observability/2026-09-22-turn-flight-recorder.md §6-7.
 *
 * No OTLP endpoint configured => the SDK never starts. `@opentelemetry/api`
 * then hands every caller a no-op tracer, so `tracing.ts` works unchanged —
 * spans are just non-recording.
 */
import { DiagLogLevel, diag } from "@opentelemetry/api";
import type { DiagLogFunction, DiagLogger } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

import { MiraAttributeProcessor } from "./capabilities/observability/tracing";

const IGNORED_INCOMING_PATH_PREFIXES = ["/api/health", "/_next/"];

/** Rate-limits the OTel diag logger (exporter/export errors) to once per `intervalMs`. */
function createRateLimitedDiagLogger(intervalMs: number): DiagLogger {
  let lastLoggedAt = 0;
  const limited =
    (level: string): DiagLogFunction =>
    (message, ...args) => {
      const now = Date.now();
      if (now - lastLoggedAt < intervalMs) return;
      lastLoggedAt = now;
      console.error(
        JSON.stringify({
          event: "telemetry.exporter_error",
          level,
          message: [message, ...args].map(String).join(" "),
        }),
      );
    };
  return {
    error: limited("error"),
    warn: limited("warn"),
    info: () => {},
    debug: () => {},
    verbose: () => {},
  };
}

let sdk: NodeSDK | null = null;

function startTelemetry(): void {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (!endpoint) {
    console.log(JSON.stringify({ event: "telemetry.disabled", reason: "no_otlp_endpoint" }));
    return;
  }

  try {
    diag.setLogger(createRateLimitedDiagLogger(60_000), DiagLogLevel.ERROR);

    // `defaultResource()` seeds the SDK's own attrs (telemetry.sdk.*); NodeSDK
    // separately auto-merges an env-detected resource (envDetector reads
    // OTEL_RESOURCE_ATTRIBUTES / OTEL_SERVICE_NAME) on top of whatever
    // `resource` we pass here — verified against
    // @opentelemetry/sdk-node/build/src/sdk.js (autoDetectResources default
    // true, resourceDetectors default [envDetector, processDetector,
    // hostDetector]). So deployment.environment.name is NOT set here; it
    // comes from Doppler's OTEL_RESOURCE_ATTRIBUTES and reaches the resource
    // without any code on our side duplicating that parse.
    const resource = defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "mira-hub",
        [ATTR_SERVICE_VERSION]: process.env.MIRA_APP_VERSION || "unknown",
        "mira.git_sha": process.env.MIRA_GIT_SHA || "unknown",
      }),
    );

    sdk = new NodeSDK({
      resource,
      // Order matters: allowlist/redaction runs BEFORE the batch exporter so
      // nothing off-contract is ever queued for export.
      spanProcessors: [
        new MiraAttributeProcessor(),
        new BatchSpanProcessor(new OTLPTraceExporter(), {
          maxQueueSize: 2048,
          exportTimeoutMillis: 10000,
          scheduledDelayMillis: 5000,
        }),
      ],
      instrumentations: [
        new HttpInstrumentation({
          // Server + client are both on by default; header capture is never
          // enabled (no `headersToSpanAttributes`/`requestHook`), and the
          // diagnostics/health-check chatter is dropped at the source.
          ignoreIncomingRequestHook: (req) => {
            const url = req.url || "";
            return IGNORED_INCOMING_PATH_PREFIXES.some((prefix) => url.startsWith(prefix));
          },
        }),
        new UndiciInstrumentation(),
        new PgInstrumentation(),
      ],
    });

    sdk.start();
    console.log(JSON.stringify({ event: "telemetry.started", exporter: "otlp-http" }));
  } catch (err) {
    sdk = null;
    console.error(
      JSON.stringify({
        event: "telemetry.start_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Called from `instrumentation.ts`'s SIGTERM handler to flush pending spans. */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // Best-effort flush on shutdown — never block process exit on it.
  }
}

startTelemetry();
