import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const compose = readFileSync(resolve(here, "../../../../../docker-compose.saas.yml"), "utf8");

function serviceBlock(serviceName: string) {
  const match = compose.match(new RegExp(`\\n  ${serviceName}:\\n[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:|\\nnetworks:)`));
  if (!match) {
    throw new Error(`Service ${serviceName} not found in docker-compose.saas.yml`);
  }
  return match[0];
}

describe("SaaS deploy CMMS SSO environment", () => {
  it("passes the Atlas sign-in configuration into mira-hub", () => {
    const hub = serviceBlock("mira-hub");

    expect(hub).toContain("- HUB_CMMS_API_URL=${HUB_CMMS_API_URL:-http://cmms-backend:8080}");
    expect(hub).toContain("- CMMS_PUBLIC_URL=${CMMS_PUBLIC_URL:-https://cmms.factorylm.com}");
    expect(hub).toContain("- ATLAS_API_USER=${ATLAS_API_USER:-}");
    expect(hub).toContain("- ATLAS_API_PASSWORD=${ATLAS_API_PASSWORD:-}");
    expect(hub).not.toContain("HUB_SSO_SECRET");
    expect(hub).not.toContain("HUB_SSO_ISSUER");
    expect(hub).not.toContain("HUB_SSO_AUDIENCE");
  });
});
