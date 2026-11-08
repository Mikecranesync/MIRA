// Codex #4900 F1: a static serveStatic("/posthog-init.js") registered before the
// env-aware GET handler shadowed it, so production served the no-op stub even
// with PLG_POSTHOG_KEY set. The real handler is exercised in a separate process:
// no inherited credentials or env files, and an ephemeral loopback-only port.
import { describe, test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

const src = fs.readFileSync(path.join(import.meta.dir, "..", "server.ts"), "utf8");

async function withWebServer(key: string | undefined, check: (url: string) => Promise<void>) {
  const entry = path.join(import.meta.dir, "..", "server.ts");
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
    import config from ${JSON.stringify(entry)};
    const server = Bun.serve({ ...config, port: 0, hostname: "127.0.0.1" });
    console.log(JSON.stringify({ posthogTestUrl: server.url.href }));
  `], {
    cwd: path.join(import.meta.dir, "..", ".."),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      PORT: "0",
      PLG_POSTHOG_HOST: "https://analytics.invalid",
      ...(key === undefined ? {} : { PLG_POSTHOG_KEY: key }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const errors = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const ready = (async () => {
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Web test server closed before readiness: ${await errors}`);
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("{")) continue;
        const message = JSON.parse(line) as { posthogTestUrl?: string };
        if (message.posthogTestUrl) return message.posthogTestUrl;
      }
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = await Promise.race([
      ready,
      child.exited.then(async (code) => {
        throw new Error(`Web test server exited ${code}: ${await errors}`);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Web test server readiness timeout")), 8000);
      }),
    ]);
    expect(new URL(url).hostname).toBe("127.0.0.1");
    await check(url);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    await child.exited;
    await reader.cancel();
    await errors;
  }
}

function executeSnippet(script: string) {
  const assets: string[] = [];
  const listeners: string[] = [];
  const browser: Record<string, unknown> = {
    document: {
      createElement: () => ({}),
      getElementsByTagName: () => [{
        parentNode: { insertBefore: (element: { src: string }) => assets.push(element.src) },
      }],
      addEventListener: (event: string) => listeners.push(event),
    },
  };
  browser.window = browser;
  runInNewContext(script, browser, { timeout: 1000 });
  const analytics = browser.posthog as Record<string, unknown> & {
    _i?: Array<[string, Record<string, unknown>]>;
  };
  return { analytics, assets, listeners };
}

describe("/posthog-init.js wiring", () => {
  test("no static file route shadows the env-aware handler", () => {
    expect(src).not.toMatch(/app\.use\(\s*"\/posthog-init\.js"/);
  });
  test("the env-aware handler is registered", () => {
    expect(src).toMatch(/app\.get\(\s*"\/posthog-init\.js"/);
    expect(src).toContain("PLG_POSTHOG_KEY");
  });
});

describe("/posthog-init.js executable HTTP contract", () => {
  test("the real configured response initializes analytics with replay disabled", async () => {
    const key = 'phc_local_test_"quoted\\key';
    await withWebServer(key, async (url) => {
      const response = await fetch(new URL("/posthog-init.js", url));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
      const { analytics, assets, listeners } = executeSnippet(await response.text());
      expect(analytics._i).toHaveLength(1);
      const [actualKey, options] = analytics._i![0];
      expect(actualKey).toBe(key);
      expect(options.api_host).toBe("https://analytics.invalid");
      expect(options.capture_pageview).toBe(true);
      expect(options.disable_session_recording).toBe(true);
      expect(options.person_profiles).toBe("identified_only");
      expect(assets).toEqual(["https://analytics.invalid/static/array.js"]);
      expect(listeners).toEqual(["click"]);
    });
  }, 15000);

  for (const [label, key] of [["unset", undefined], ["empty", ""], ["whitespace", " \t "]] as const) {
    test(`the real ${label}-key response stays a no-op`, async () => {
      await withWebServer(key, async (url) => {
        const response = await fetch(new URL("/posthog-init.js", url));
        expect(response.status).toBe(200);
        const { analytics, assets, listeners } = executeSnippet(await response.text());
        expect(analytics._i).toBeUndefined();
        expect(assets).toEqual([]);
        expect(listeners).toEqual([]);
        for (const name of ["capture", "identify", "init", "reset"]) {
          const method = analytics[name];
          expect(typeof method).toBe("function");
          if (typeof method === "function") expect(() => method("local-test")).not.toThrow();
        }
      });
    }, 15000);
  }
});

describe("service worker never serves /posthog-init.js from cache (Codex #4900 F4)", () => {
  const sw = fs.readFileSync(path.join(import.meta.dir, "..", "..", "public", "sw.js"), "utf8");
  test("posthog-init.js is network-only and the cache name moved past v4", () => {
    expect(sw).toMatch(/NETWORK_ONLY_PATHS\s*=\s*\[[^\]]*'\/posthog-init\.js'/);
    expect(sw).toMatch(/NETWORK_ONLY_PATHS\.includes\(url\.pathname\)\)\s*return;/);
    expect(sw).not.toContain("const CACHE_NAME = 'factorylm-v4'");
  });
});
