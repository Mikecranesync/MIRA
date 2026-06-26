import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const compose = readFileSync(resolve(here, "../../../../../docker-compose.saas.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);

function serviceBlock(serviceName: string) {
  const match = compose.match(new RegExp(`\\n  ${serviceName}:\\n[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:|\\nnetworks:)`));
  if (!match) {
    throw new Error(`Service ${serviceName} not found in docker-compose.saas.yml`);
  }
  return match[0];
}

describe("SaaS deploy CMMS SSO environment", () => {
  it("passes the Hub SSO signing configuration into mira-hub", () => {
    const hub = serviceBlock("mira-hub");

    expect(hub).toContain("- HUB_SSO_SECRET=${HUB_SSO_SECRET:-}");
    expect(hub).toContain("- HUB_SSO_ISSUER=${HUB_SSO_ISSUER:-factorylm-hub}");
    expect(hub).toContain("- HUB_SSO_AUDIENCE=${HUB_SSO_AUDIENCE:-atlas-cmms}");
  });
});
