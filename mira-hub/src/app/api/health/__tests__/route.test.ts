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
      ["approvedRetrievalEnforced", "builtAt", "gitSha", "service", "status", "ts", "version"],
    );
  });
});
