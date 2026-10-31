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
        "deploymentGeneration",
        "gitSha",
        "inferenceFingerprint",
        "service",
        "status",
        "telemetry",
        "ts",
        "version",
      ],
    );
  });

  // #4507 — runtime identity for the Stranger Walk (F1/F2 of #4461).
  describe("runtime identity", () => {
    it("reports one deploymentGeneration for the life of the process", async () => {
      process.env.NEON_DATABASE_URL = "postgres://x";
      process.env.INGEST_URL = "http://ingest";
      const a = await GET().json();
      const b = await GET().json();
      expect(typeof a.deploymentGeneration).toBe("string");
      expect(a.deploymentGeneration.length).toBeGreaterThanOrEqual(20);
      expect(b.deploymentGeneration).toBe(a.deploymentGeneration);
    });

    it("reports the effective cascade as a hash plus summary, and no provider secret", async () => {
      process.env.NEON_DATABASE_URL = "postgres://x";
      process.env.INGEST_URL = "http://ingest";
      process.env.MIRA_CANONICAL_SEAM = "1";
      process.env.OPENAI_API_KEY = "sk-test-hunter5";
      process.env.OPENAI_MODEL = "gpt-5.4-mini";
      const body = await GET().json();
      expect(body.inferenceFingerprint.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(body.inferenceFingerprint.summary.providers[0]).toEqual({
        name: "OpenAI",
        model: "gpt-5.4-mini",
        pricePerMtok: { input: 0.75, cached_input: 0.075, output: 4.5 },
      });
      expect(JSON.stringify(body)).not.toContain("hunter5");
    });

    it("changes the fingerprint when the serving model changes, without a redeploy", async () => {
      process.env.NEON_DATABASE_URL = "postgres://x";
      process.env.INGEST_URL = "http://ingest";
      process.env.MIRA_CANONICAL_SEAM = "1";
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      process.env.OPENAI_MODEL = "gpt-5.4-mini";
      const before = await GET().json();
      process.env.OPENAI_MODEL = "gpt-5.4";
      const after = await GET().json();
      expect(after.inferenceFingerprint.hash).not.toBe(before.inferenceFingerprint.hash);
      expect(after.deploymentGeneration).toBe(before.deploymentGeneration);
    });
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
