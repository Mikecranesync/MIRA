import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cmmsPage = readFileSync(resolve(here, "../../../app/(hub)/cmms/page.tsx"), "utf8");

describe("CMMS setup page quick links", () => {
  it("opens FactoryLM Works through the Hub SSO bridge", () => {
    expect(cmmsPage).toContain("buildCmmsSsoUrl");
    expect(cmmsPage).toContain("/api/cmms/sso");
    expect(cmmsPage).not.toContain('href={config.url}');
    expect(cmmsPage).not.toContain('href={buildCmmsAppUrl(config.url, path)}');
  });

  it("uses FactoryLM Works app routes instead of public marketing/404 routes", () => {
    expect(cmmsPage).toContain('path: "/app/work-orders"');
    expect(cmmsPage).toContain('path: "/app/assets"');
    expect(cmmsPage).toContain('path: "/app/preventive-maintenance"');
    expect(cmmsPage).toContain('path: "/app/reports"');

    expect(cmmsPage).not.toContain('path: "/workorders"');
    expect(cmmsPage).not.toContain('path: "/assets"');
    expect(cmmsPage).not.toContain('path: "/schedule"');
    expect(cmmsPage).not.toContain('path: "/reports"');
  });
});
