/**
 * Pure env readers for the Turn Flight Recorder. No OTel imports here on
 * purpose — this module must be safe to import from any runtime (including
 * the edge middleware bundle) without pulling in Node-only SDK code.
 * See docs/architecture/observability/2026-09-22-turn-flight-recorder.md §6.
 */

export function telemetryEnabled(): boolean {
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  );
}

export function captureContentEnabled(): boolean {
  return process.env.MIRA_OTEL_CAPTURE_CONTENT === "1";
}

export function anomalyChecksEnabled(): boolean {
  return process.env.MIRA_TURN_ANOMALY_CHECKS !== "0";
}

/** Shadow-mode Jev evidence-sufficiency judgment (jev-shadow.ts). Off by default. */
export function jevShadowEnabled(): boolean {
  return process.env.MIRA_JEV_SHADOW === "1";
}

/** Parses the W3C-Baggage-shaped `OTEL_RESOURCE_ATTRIBUTES` (`k1=v1,k2=v2`). */
function parseResourceAttributes(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function environmentName(): string {
  const attrs = parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES);
  return attrs["deployment.environment.name"] || "unknown";
}

export function gitSha(): string {
  return process.env.MIRA_GIT_SHA || "unknown";
}

export function serviceVersion(): string {
  return process.env.MIRA_APP_VERSION || "unknown";
}

/** null when `MIRA_TRACE_VIEWER_URL_TEMPLATE` is unset (no viewer configured). */
export function viewerUrlFor(traceId: string): string | null {
  const template = process.env.MIRA_TRACE_VIEWER_URL_TEMPLATE;
  if (!template) return null;
  return template.replace("{traceId}", traceId);
}

export function knownProductionHosts(): string[] {
  return ["app.factorylm.com", "factorylm.com", "40.160.141.61"];
}

/**
 * Staging is CO-HOSTED on the production VPS (#3930): the bare IP alone does
 * not identify production. Staging owns the 4xxx loopback ports on that host
 * (docker-compose.staging-vps.yml); production owns these
 * (docker-compose.saas.yml), plus 80/443 which nginx routes to production.
 * Caught live on the first traced staging turn (2026-09-22): the staging
 * pipeline URL http://40.160.141.61:4099 was flagged as a production route.
 */
const COHOSTED_VPS_IP = "40.160.141.61";
const PRODUCTION_PORTS_ON_COHOSTED_VPS = new Set([
  "3003", "3009", "3101", "3200", "8001", "8002", "8009", "8011", "9099", "9998",
]);

/** True when `value` (a URL or host string) resolves to production. */
export function isProductionRoute(value: string): boolean {
  let host = "";
  let port = "";
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    host = url.hostname;
    port = url.port;
  } catch {
    host = value;
  }
  if (host === "app.factorylm.com" || host === "factorylm.com") return true;
  if (host === COHOSTED_VPS_IP) {
    // No explicit port = 80/443 = nginx = production.
    return port === "" || PRODUCTION_PORTS_ON_COHOSTED_VPS.has(port);
  }
  return false;
}

const PRODUCTION_ROUTE_CHECK_VARS = [
  "INGEST_URL",
  "NEXT_PUBLIC_PIPELINE_API_URL",
  "MIRA_HUB_URL",
  "NEXTAUTH_URL_INTERNAL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
] as const;

/**
 * Staging-only anomaly check (STAGING_TO_PROD_ROUTE): when this environment
 * claims to be staging but one of its outbound routes actually points at a
 * known production host, returns the offending var NAMES — never the
 * values, which may carry credentials/paths.
 */
export function productionRouteDetected(): string[] {
  if (environmentName() !== "staging") return [];
  const offending: string[] = [];
  for (const varName of PRODUCTION_ROUTE_CHECK_VARS) {
    const value = process.env[varName];
    if (!value) continue;
    if (isProductionRoute(value)) {
      offending.push(varName);
    }
  }
  return offending;
}
