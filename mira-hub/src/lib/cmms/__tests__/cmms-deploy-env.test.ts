import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
// Normalise CRLF before matching. serviceBlock() anchors on a newline before
// the service name, which cannot match a Windows checkout where git has
// materialised this file with CRLF -- the service IS present, the regex simply
// never sees it. That made this suite pass in CI (Linux, LF) and fail on a
// Windows dev machine with the misleading message "Service mira-hub not found
// in docker-compose.saas.yml", which reads as a deployment defect rather than
// a line-ending one.
const compose = readFileSync(resolve(here, "../../../../../docker-compose.saas.yml"), "utf8")
  .replace(/\r\n/g, "\n");

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
