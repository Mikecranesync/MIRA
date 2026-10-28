// Codex #4900 F1: a static serveStatic("/posthog-init.js") registered before the
// env-aware GET handler shadowed it, so production served the no-op stub even
// with PLG_POSTHOG_KEY set. Source-level wiring check (server.ts is not imported
// because it runs schema setup at load, same approach as checkout-gate.test.ts).
import { describe, test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(import.meta.dir, "..", "server.ts"), "utf8");

describe("/posthog-init.js wiring", () => {
  test("no static file route shadows the env-aware handler", () => {
    expect(src).not.toMatch(/app\.use\(\s*"\/posthog-init\.js"/);
  });
  test("the env-aware handler is registered", () => {
    expect(src).toMatch(/app\.get\(\s*"\/posthog-init\.js"/);
    expect(src).toContain("PLG_POSTHOG_KEY");
  });
});

describe("service worker never serves /posthog-init.js from cache (Codex #4900 F4)", () => {
  const sw = fs.readFileSync(path.join(import.meta.dir, "..", "..", "public", "sw.js"), "utf8");
  test("posthog-init.js is network-only and the cache name moved past v4", () => {
    expect(sw).toMatch(/NETWORK_ONLY_PATHS\s*=\s*\[[^\]]*'\/posthog-init\.js'/);
    expect(sw).toMatch(/NETWORK_ONLY_PATHS\.includes\(url\.pathname\)\)\s*return;/);
    expect(sw).not.toContain("const CACHE_NAME = 'factorylm-v4'");
  });
});
