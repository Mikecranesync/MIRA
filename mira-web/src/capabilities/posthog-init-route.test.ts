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

// The new marketing site (src/factorylm-ui/marketing-next) must load this same
// script and tag its conversion links, so "Start free" / "Request a demo" clicks
// arrive as cta_click {cta, href, page}. Kept in this CI-selected suite because
// the adapter's own test files are not in ci.yml's web list.
describe("new marketing site conversion tracking", () => {
  const ROUTES = ["/", "/mira", "/about", "/start", "/demo", "/limitations", "/free-technicians"];
  const CONVERSION_HREF = /href="(?:https:\/\/[^"]+\/signup\/|\/demo|mailto:[^"]*demo[^"]*)"/;

  async function servePage(route: string, hubUrl?: string) {
    const env = { next: process.env.FACTORYLM_MARKETING_NEXT, free: process.env.MIRA_FREE_TECHNICIANS, hub: process.env.PLG_HUB_URL };
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    process.env.MIRA_FREE_TECHNICIANS = "true";
    if (hubUrl) process.env.PLG_HUB_URL = hubUrl; else delete process.env.PLG_HUB_URL;
    try {
      const { app } = await import("../server.js");
      const res = await app.request(`https://factorylm.com${route}`, { headers: { host: "factorylm.com" } });
      expect(res.status).toBe(route === "/404" ? 404 : 200);
      expect(res.headers.get("x-factorylm-site") ?? "").toStartWith("next-");
      return await res.text();
    } finally {
      for (const [k, v] of [["FACTORYLM_MARKETING_NEXT", env.next], ["MIRA_FREE_TECHNICIANS", env.free], ["PLG_HUB_URL", env.hub]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  }

  test("instrumentMarketingHtml tags known links, adds the script once, and is idempotent", async () => {
    const { instrumentMarketingHtml } = await import("../factorylm-ui/marketing-next.js");
    const page = '<html><head><title>x</title></head><body><a class="b" href="https://app.factorylm.com/signup/">Start free</a><a href="/demo">Demo</a><a href="/about">About</a></body></html>';
    const once = instrumentMarketingHtml(page);
    expect(once).toContain('<a class="b" data-cta="start_free" href="https://app.factorylm.com/signup/">');
    expect(once).toContain('<a data-cta="request_demo" href="/demo">');
    expect(once).toContain('<a href="/about">');
    expect(once.split('src="/posthog-init.js"').length - 1).toBe(1);
    expect(once.indexOf('src="/posthog-init.js"')).toBeLessThan(once.indexOf("</head>"));
    expect(instrumentMarketingHtml(once).split('src="/posthog-init.js"').length - 1).toBe(1);
  });

  for (const route of [...ROUTES, "/404"]) {
    test(`${route} loads posthog-init.js once and every conversion link carries data-cta`, async () => {
      const html = await servePage(route);
      expect(html.split('<script src="/posthog-init.js" defer></script>').length - 1).toBe(1);
      const links = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
      const conversions = links.filter((a) => CONVERSION_HREF.test(a));
      expect(conversions.length).toBeGreaterThan(0);
      for (const a of conversions) expect(a).toMatch(/data-cta="(start_free|request_demo|demo_email)"/);
    });
  }

  test("on staging the rewritten signup link keeps its start_free tag", async () => {
    const html = await servePage("/", "https://staging-app.factorylm.test");
    expect(html).toContain('data-cta="start_free" href="https://staging-app.factorylm.test/signup/"');
    expect(html).not.toContain("https://app.factorylm.com/signup/");
  });
});
