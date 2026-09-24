/**
 * Staging isolation — staging must never silently route to a production
 * host, and `/api/health` must never leak the OTLP endpoint host or its
 * auth headers.
 *
 * Design: docs/architecture/observability/2026-09-22-turn-flight-recorder.md
 * §5 (STAGING_TO_PROD_ROUTE), §6 (config table), §9 (rollout — Doppler
 * `factorylm/stg` sets these on staging only).
 *
 * Run: npx vitest run src/capabilities/observability/__tests__/staging-isolation.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { detectAnomalies } from "../anomalies";
import { productionRouteDetected } from "../config";
import { emptyPacket } from "../turn-evidence-packet";
import { GET as healthGET } from "@/app/api/health/route";

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

// Resolve from THIS file's own location, not process.cwd() — CI may invoke
// vitest from the repo root, the mira-hub package root, or a worktree, and
// only a path derived from import.meta.url is stable across all of those.
// __tests__ -> observability -> capabilities -> src -> mira-hub -> repo root
// (5 levels; verified: `path.resolve(<this dir>, "../../../../..")` lands on
// the repo root that contains docker-compose.saas.yml).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../../..");

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

describe("productionRouteDetected — names var NAMES, never their values", () => {
  it("names exactly the offending vars when staging's routes resolve to known production hosts", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "deployment.environment.name=staging";
    process.env.INGEST_URL = "https://app.factorylm.com/ingest";
    process.env.NEXT_PUBLIC_PIPELINE_API_URL = "https://factorylm.com/api/pipeline";
    process.env.MIRA_HUB_URL = "https://app.factorylm.com";
    process.env.NEXTAUTH_URL_INTERNAL = "https://app.factorylm.com/api/auth";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://40.160.141.61:9099/v1/traces";

    const offending = productionRouteDetected();
    expect([...offending].sort()).toEqual(
      [
        "INGEST_URL",
        "NEXT_PUBLIC_PIPELINE_API_URL",
        "MIRA_HUB_URL",
        "NEXTAUTH_URL_INTERNAL",
        "OTEL_EXPORTER_OTLP_ENDPOINT",
      ].sort(),
    );
    const serialized = offending.join(",");
    expect(serialized).not.toContain("app.factorylm.com");
    expect(serialized).not.toContain("factorylm.com");
    expect(serialized).not.toContain("40.160.141.61");
  });

  it("returns [] when the environment is production, even with the exact same routes configured", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "deployment.environment.name=production";
    process.env.INGEST_URL = "https://app.factorylm.com/ingest";
    process.env.MIRA_HUB_URL = "https://app.factorylm.com";
    process.env.NEXTAUTH_URL_INTERNAL = "https://app.factorylm.com/api/auth";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://40.160.141.61:9099/v1/traces";
    expect(productionRouteDetected()).toEqual([]);
  });
});

describe("detectAnomalies — STAGING_TO_PROD_ROUTE fires with var names in detail", () => {
  const BASE = {
    kind: "chat" as const,
    environment: "staging",
    git_sha: "abc123",
    service_version: "v1",
    tenant_id: "t-1",
  };

  it("fires when environment is staging and productionRouteVars is non-empty", () => {
    const packet = emptyPacket(BASE);
    const anomalies = detectAnomalies(packet, {
      productionRouteVars: ["INGEST_URL", "MIRA_HUB_URL"],
    });
    const found = anomalies.find((a) => a.code === "STAGING_TO_PROD_ROUTE");
    expect(found).toBeDefined();
    expect(found?.detail.production_route_vars).toBe("INGEST_URL,MIRA_HUB_URL");
    expect(found?.detail.count).toBe(2);
    expect(found?.detail.environment).toBe("staging");
  });

  it("does not fire when environment is staging but productionRouteVars is empty", () => {
    const packet = emptyPacket(BASE);
    expect(detectAnomalies(packet).find((a) => a.code === "STAGING_TO_PROD_ROUTE")).toBeUndefined();
  });

  it("does not fire when environment is production, even with productionRouteVars set — the predicate is environment-gated, not just var-gated", () => {
    const packet = emptyPacket({ ...BASE, environment: "production" });
    const anomalies = detectAnomalies(packet, { productionRouteVars: ["INGEST_URL"] });
    expect(anomalies.find((a) => a.code === "STAGING_TO_PROD_ROUTE")).toBeUndefined();
  });
});

describe("docker-compose OTEL_* passthrough — staging only, never production", () => {
  const stagingCompose = readRepoFile("docker-compose.staging-vps.yml");
  const saasCompose = readRepoFile("docker-compose.saas.yml");

  const OTEL_VARS = [
    "OTEL_SERVICE_NAME",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
    "OTEL_EXPORTER_OTLP_HEADERS",
    "OTEL_RESOURCE_ATTRIBUTES",
    "OTEL_TRACES_SAMPLER",
  ];

  it("both compose files were actually resolved and read (positive control — a wrong path reads as '' and would pass vacuously)", () => {
    expect(stagingCompose.length).toBeGreaterThan(1000);
    expect(saasCompose.length).toBeGreaterThan(1000);
    expect(stagingCompose).toContain("stg-mira-hub");
    expect(saasCompose).toContain("mira-pipeline-saas");
  });

  it("the stg-mira-hub service block passes through every OTEL_* var", () => {
    const start = stagingCompose.indexOf("container_name: stg-mira-hub");
    expect(start).toBeGreaterThan(-1);
    const nextContainer = stagingCompose.indexOf("container_name:", start + 1);
    const block = stagingCompose.slice(start, nextContainer === -1 ? undefined : nextContainer);
    for (const v of OTEL_VARS) {
      expect(block).toContain(`${v}=`);
    }
  });

  it("docker-compose.saas.yml (production) contains NONE of the OTEL_* vars", () => {
    for (const v of OTEL_VARS) {
      expect(saasCompose).not.toContain(v);
    }
  });
});

describe("/api/health never leaks OTEL_EXPORTER_OTLP_HEADERS or the endpoint host", () => {
  it("response JSON contains neither the header value nor the endpoint host, while still surfacing the non-secret telemetry status", async () => {
    process.env.NEON_DATABASE_URL = "postgres://x";
    process.env.INGEST_URL = "http://ingest";
    process.env.OTEL_RESOURCE_ATTRIBUTES = "deployment.environment.name=staging";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://us.cloud.langfuse.com/api/public/otel";
    const headerValue = "Authorization=Basic cGstbGYtc2VjcmV0LXZhbHVlOnNrLWxmLXNlY3JldC12YWx1ZQ==";
    process.env.OTEL_EXPORTER_OTLP_HEADERS = headerValue;

    const res = healthGET();
    const body = await res.json();
    const text = JSON.stringify(body);

    expect(text).not.toContain(headerValue);
    expect(text).not.toContain("cGstbGYtc2VjcmV0LXZhbHVlOnNrLWxmLXNlY3JldC12YWx1ZQ==");
    expect(text).not.toContain("us.cloud.langfuse.com");
    expect(text).not.toContain("OTEL_EXPORTER_OTLP_HEADERS");
    expect(text).not.toContain("OTEL_EXPORTER_OTLP_ENDPOINT");

    expect(body.telemetry.tracing).toBe("enabled");
    expect(body.telemetry.exporter).toBe("otlp-http");
    expect(body.telemetry.environment).toBe("staging");
  });

  it("reports tracing disabled, with no exporter/endpoint leak either way, when the endpoint is unset", async () => {
    process.env.NEON_DATABASE_URL = "postgres://x";
    process.env.INGEST_URL = "http://ingest";
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;

    const res = healthGET();
    const body = await res.json();
    expect(body.telemetry.tracing).toBe("disabled");
    expect(body.telemetry.exporter).toBeNull();
  });
});
