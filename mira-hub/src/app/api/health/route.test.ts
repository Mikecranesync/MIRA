import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

const KEYS = [
  "NEON_DATABASE_URL",
  "INGEST_URL",
  "MIRA_CHANNEL_WORKFLOW_ENABLED",
  "HUB_INGEST_TOKEN",
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Hub deployment health", () => {
  it("fails before traffic when channel workflow is enabled without service intake auth", async () => {
    process.env.NEON_DATABASE_URL = "postgresql://configured";
    process.env.INGEST_URL = "http://mira-ingest:8001";
    process.env.MIRA_CHANNEL_WORKFLOW_ENABLED = "1";
    delete process.env.HUB_INGEST_TOKEN;

    const response = GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unhealthy",
      missing: ["HUB_INGEST_TOKEN"],
    });
  });

  it("rejects an invalid channel-workflow toggle before traffic", async () => {
    process.env.NEON_DATABASE_URL = "postgresql://configured";
    process.env.INGEST_URL = "http://mira-ingest:8001";
    process.env.MIRA_CHANNEL_WORKFLOW_ENABLED = "definitely";
    process.env.HUB_INGEST_TOKEN = "service-token";

    const response = GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unhealthy",
      invalid: ["MIRA_CHANNEL_WORKFLOW_ENABLED"],
    });
  });

  it("reports healthy when every enabled workflow dependency is configured", async () => {
    process.env.NEON_DATABASE_URL = "postgresql://configured";
    process.env.INGEST_URL = "http://mira-ingest:8001";
    process.env.MIRA_CHANNEL_WORKFLOW_ENABLED = "true";
    process.env.HUB_INGEST_TOKEN = "service-token";

    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      service: "mira-hub",
    });
  });
});
