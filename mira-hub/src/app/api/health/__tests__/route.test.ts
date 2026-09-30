// Workstream B (PRD §8.2): /api/health must report the EFFECTIVE, non-secret
// retrieval-approval gate so the beta gate and the production probe can assert
// they run against the production gate rather than a compose default.
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../route";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("GET /api/health approvedRetrievalEnforced", () => {
  it("is true only when MIRA_ENFORCE_APPROVED_RETRIEVAL is exactly 'true'", async () => {
    process.env.NEON_DATABASE_URL = "postgres://x";
    process.env.INGEST_URL = "http://ingest";
    for (const [value, expected] of [
      ["true", true],
      ["false", false],
      ["1", false],
      [undefined, false],
    ] as const) {
      if (value === undefined) delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
      else process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = value;
      const body = await GET().json();
      expect(body.status).toBe("ok");
      expect(body.approvedRetrievalEnforced).toBe(expected);
    }
  });

  it("exposes no secret values", async () => {
    process.env.NEON_DATABASE_URL = "postgres://user:hunter2@host/db";
    process.env.INGEST_URL = "http://ingest";
    process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
    const text = JSON.stringify(await GET().json());
    expect(text).not.toContain("hunter2");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(
      [
        "approvedRetrievalEnforced",
        "builtAt",
        "gitSha",
        "service",
        "status",
        "telemetry",
        "ts",
        "version",
      ],
    );
  });

  describe("telemetry", () => {
    it("reports disabled with no exporter/endpoint when OTEL_EXPORTER_OTLP_ENDPOINT is unset", async () => {
      process.env.NEON_DATABASE_URL = "postgres://x";
      process.env.INGEST_URL = "http://ingest";
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
      const body = await GET().json();
      expect(body.telemetry).toEqual({
        tracing: "disabled",
        exporter: null,
        environment: "unknown",
        contentCapture: false,
      });
    });

    it("reports enabled + otlp-http, environment, and content-capture flag when configured", async () => {
      process.env.NEON_DATABASE_URL = "postgres://x";
      process.env.INGEST_URL = "http://ingest";
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://collector.example.com/v1/traces";
      process.env.OTEL_RESOURCE_ATTRIBUTES = "deployment.environment.name=staging";
      process.env.MIRA_OTEL_CAPTURE_CONTENT = "1";
      const body = await GET().json();
      expect(body.telemetry).toEqual({
        tracing: "enabled",
        exporter: "otlp-http",
        environment: "staging",
        contentCapture: true,
      });
      const text = JSON.stringify(body);
      expect(text).not.toContain("collector.example.com");
    });
  });
});
