import { expect, test } from "bun:test";
import { getHealthIdentity } from "../lib/health-identity.js";

// Test the /api/health endpoint identity contract: gitSha, version, and builtAt
// from environment variables (or "unknown" without them).

test("getHealthIdentity returns identity fields from environment", () => {
  const testSha = "a".repeat(40); // 40-char hex SHA
  const testVersion = "1.2.3";
  const testBuildTime = "2026-09-20T18:00:00Z";

  process.env.MIRA_GIT_SHA = testSha;
  process.env.MIRA_APP_VERSION = testVersion;
  process.env.MIRA_BUILD_TIME = testBuildTime;

  const identity = getHealthIdentity();

  expect(identity.status).toBe("ok");
  expect(identity.service).toBe("mira-web");
  expect(identity.gitSha).toBe(testSha);
  expect(identity.version).toBe(testVersion);
  expect(identity.builtAt).toBe(testBuildTime);
});

test("getHealthIdentity returns 'unknown' when environment variables are not set", () => {
  // Clear environment variables
  delete process.env.MIRA_GIT_SHA;
  delete process.env.MIRA_APP_VERSION;
  delete process.env.MIRA_BUILD_TIME;

  const identity = getHealthIdentity();

  expect(identity.status).toBe("ok");
  expect(identity.service).toBe("mira-web");
  expect(identity.gitSha).toBe("unknown");
  expect(identity.version).toBe("unknown");
  expect(identity.builtAt).toBe("unknown");
});
