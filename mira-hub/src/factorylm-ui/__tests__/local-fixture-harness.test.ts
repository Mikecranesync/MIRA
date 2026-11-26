/**
 * The shared local-fixture harness (tests/local-fixtures/harness, #5731 F1/F4): credentials never reach
 * the fixture server, dotenv is refused, the egress guard refuses everything but the fixture port, and
 * a wrong origin is rejected before a cookie or navigation. It sits in the default vitest suite on
 * purpose so these properties cannot be skipped by CI.
 * Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/local-fixture-harness
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import harness from "../../../tests/local-fixtures/harness/fixture-harness.cjs";

const { assertFixtureOrigin, auditFile, buildChildEnv, EGRESS_GUARD, findDotenv, fixtureOrigin, fixtureSecret, fixtureWebServer, installSessionCookie, LAUNCHER, SECRET_ENV } = harness;
const HUB = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(HUB, rel), "utf8");

const SENTINELS = {
  NEON_DATABASE_URL: "postgres://SENTINEL_DB_USER:SENTINEL_DB_PASS@sentinel-db.invalid/x",
  OPENAI_API_KEY: "sk-SENTINEL-OPENAI",
  DOPPLER_TOKEN: "dp.st.SENTINEL",
  AWS_SECRET_ACCESS_KEY: "SENTINEL-AWS",
  PGPASSWORD: "SENTINEL-PG",
};
const SECRET = "ab".repeat(32);
/** Next's types make ProcessEnv demand NODE_ENV; a spawned child's env is just a string map. */
const asEnv = (e: Record<string, string | undefined>) => e as NodeJS.ProcessEnv;

describe("F4 — one exact origin", () => {
  it("accepts only the origin the run owns", () => {
    expect(assertFixtureOrigin("http://127.0.0.1:3951", 3951)).toBe("http://127.0.0.1:3951");
    expect(assertFixtureOrigin("http://127.0.0.1:3951/v3/?x=1", 3951)).toBe("http://127.0.0.1:3951");
  });
  it.each([
    ["a different loopback port", "http://127.0.0.1:3952"],
    ["the other fixture's port", "http://127.0.0.1:3941"],
    ["localhost instead of the bound host", "http://localhost:3951"],
    ["IPv6 loopback", "http://[::1]:3951"],
    ["a public host", "https://app.factorylm.com"],
    ["userinfo that hides another host", "http://127.0.0.1:3951@evil.test/"],
    ["https on the same port", "https://127.0.0.1:3951"],
    ["not a URL", "not a url"],
    ["nothing", undefined],
  ])("rejects %s", (_label, url) => {
    expect(() => assertFixtureOrigin(url as string | undefined, 3951)).toThrow(/fixture refuses origin/);
  });

  it("rejects before the context is touched, the secret is read or a token is encoded", async () => {
    const calls: string[] = [];
    const context = { addCookies: async () => { calls.push("addCookies"); } };
    const saved = process.env[SECRET_ENV];
    delete process.env[SECRET_ENV]; // if the secret were read first the error would be about the secret
    try {
      await expect(installSessionCookie(context, "http://127.0.0.1:3952", 3951, { uid: "x" })).rejects.toThrow(/fixture refuses origin/);
    } finally {
      if (saved !== undefined) process.env[SECRET_ENV] = saved;
    }
    expect(calls).toEqual([]);
  });

  it("a live listener on another loopback port is rejected without a single connection to it", async () => {
    let connections = 0;
    const decoy = net.createServer((s) => { connections++; s.destroy(); });
    await new Promise<void>((resolve) => decoy.listen(0, "127.0.0.1", resolve));
    const decoyPort = (decoy.address() as net.AddressInfo).port;
    try {
      const context = { addCookies: async () => { connections++; } };
      await expect(installSessionCookie(context, `http://127.0.0.1:${decoyPort}`, 3951, { uid: "x" })).rejects.toThrow(/fixture refuses origin/);
      await new Promise((r) => setTimeout(r, 50));
      expect(connections).toBe(0);
    } finally {
      decoy.close();
    }
  });

  it("control: the owned origin mints exactly one cookie scoped to it", async () => {
    const added: { name: string; url: string }[][] = [];
    const saved = process.env[SECRET_ENV];
    process.env[SECRET_ENV] = SECRET;
    try {
      await installSessionCookie({ addCookies: async (c: { name: string; url: string }[]) => { added.push(c); } }, "http://127.0.0.1:3951", 3951, { uid: "x" });
    } finally {
      if (saved === undefined) delete process.env[SECRET_ENV]; else process.env[SECRET_ENV] = saved;
    }
    expect(added).toHaveLength(1);
    expect(added[0][0]).toMatchObject({ name: "next-auth.session-token", url: "http://127.0.0.1:3951" });
  });

  it("the cookie path refuses a key the runner did not hand down, instead of inventing one", async () => {
    const saved = process.env[SECRET_ENV];
    delete process.env[SECRET_ENV];
    try {
      await expect(installSessionCookie({ addCookies: async () => {} }, "http://127.0.0.1:3951", 3951, {})).rejects.toThrow(/not inherited/);
    } finally {
      if (saved !== undefined) process.env[SECRET_ENV] = saved;
    }
  });
});

describe("F1 — ephemeral secret", () => {
  it("is generated per run, long, and different each time", () => {
    const a: Record<string, string | undefined> = {};
    const b: Record<string, string | undefined> = {};
    const first = fixtureSecret(a);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(fixtureSecret(a)).toBe(first); // runner and workers agree through the environment
    expect(fixtureSecret(b)).not.toBe(first);
  });
  it("a short or preset-weak value is replaced, never used", () => {
    const env: Record<string, string | undefined> = { [SECRET_ENV]: "cc-e2e-fixed-secret-do-not-use-in-prod" };
    expect(fixtureSecret(env)).not.toBe("cc-e2e-fixed-secret-do-not-use-in-prod");
  });
  it("the webServer carries it in the environment, never in the command line, and never reuses a server", () => {
    const ws = fixtureWebServer(3951) as { command: string; url: string; reuseExistingServer: boolean; env: Record<string, string> };
    expect(ws.env[SECRET_ENV]).toMatch(/^[0-9a-f]{64}$/);
    expect(ws.command).not.toContain(ws.env[SECRET_ENV]);
    expect(ws.reuseExistingServer).toBe(false);
    expect(ws.url).toBe(`${fixtureOrigin(3951)}/login`);
  });
  it("no config or spec commits a known signing key or an alternate-origin override", () => {
    for (const f of ["playwright.prepare-job-5551.config.ts", "playwright.v3-project-resume.config.ts", "tests/local-fixtures/prepare-job-5551.spec.ts", "tests/local-fixtures/v3-project-resume.spec.ts", "tests/local-fixtures/v3-manual-lookup-handoff.spec.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/fixed-secret/);
      expect(src, f).not.toMatch(/AUTH_SECRET\s*=\s*["']/);
      expect(src, f).not.toContain("PJ5551_BASE_URL");
      expect(src, f).not.toMatch(/reuseExistingServer:\s*true/);
    }
  });
  it("each config and its spec agree on the one port", () => {
    for (const [config, spec] of [["playwright.prepare-job-5551.config.ts", "tests/local-fixtures/prepare-job-5551.spec.ts"], ["playwright.v3-project-resume.config.ts", "tests/local-fixtures/v3-project-resume.spec.ts"], ["playwright.v3-project-resume.config.ts", "tests/local-fixtures/v3-manual-lookup-handoff.spec.ts"]]) {
      const portOf = (f: string) => /const PORT = (\d+);/.exec(read(f))?.[1];
      expect(portOf(config), config).toBeDefined();
      expect(portOf(config)).toBe(portOf(spec));
    }
  });
});

describe("F1 — credential-clean child environment", () => {
  const parent = { PATH: process.env.PATH, HOME: "/home/real-user", USER: "real", ...SENTINELS, CODEX_HOME: "/home/real-user/.codex", NODE_OPTIONS: "--require /evil.js" };
  const dir = mkdtempSync(path.join(tmpdir(), "fixture-env-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("a real child process receives none of the sentinel credentials, by name or by value", () => {
    const env = buildChildEnv(parent, { port: 39901, secret: SECRET, auditPath: path.join(dir, "a.jsonl") });
    const run = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], { env: asEnv(env), encoding: "utf8" });
    const seen = JSON.parse(run.stdout) as Record<string, string>;
    for (const [key, value] of Object.entries(SENTINELS)) {
      expect(seen, key).not.toHaveProperty(key);
      expect(run.stdout).not.toContain(value);
    }
    expect(seen).not.toHaveProperty("CODEX_HOME");
    expect(seen.NODE_OPTIONS).toBe(`--require ${EGRESS_GUARD}`); // the caller's own NODE_OPTIONS is dropped
    expect(seen.AUTH_SECRET).toBe(SECRET);
  });
  it("HOME is preserved, never repurposed", () => {
    expect(buildChildEnv(parent, { port: 39901, secret: SECRET }).HOME).toBe("/home/real-user");
  });
  it("only the build phase gets the loopback ephemeral range", () => {
    expect(buildChildEnv(parent, { port: 39901, secret: SECRET, phase: "build" }).FIXTURE_EGRESS_LOOPBACK_RANGE).toBe("49152-65535");
    expect(buildChildEnv(parent, { port: 39901, secret: SECRET, phase: "serve" })).not.toHaveProperty("FIXTURE_EGRESS_LOOPBACK_RANGE");
  });
});

describe("F1 — dotenv is refused, fail closed", () => {
  const roots: string[] = [];
  const project = (files: Record<string, string>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "fixture-dotenv-"));
    roots.push(dir);
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    return dir;
  };
  afterAll(() => roots.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it.each([".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.test"])("finds %s", (name) => {
    expect(findDotenv(project({ [name]: "X=1" }))).toEqual([name]);
  });
  it("control: a project with none (and an inert .env.example) is accepted", () => {
    expect(findDotenv(project({ ".env.example": "X=1" }))).toEqual([]);
  });
  it("the real hub directory has no dotenv file this run could load", () => {
    expect(findDotenv(HUB)).toEqual([]);
  });
  it("the launcher refuses before spawning anything and never prints the file's contents", () => {
    const dir = project({ ".env": `NEON_DATABASE_URL=${SENTINELS.NEON_DATABASE_URL}\n` });
    const port = 39902;
    rmSync(auditFile(port), { force: true });
    const run = spawnSync(process.execPath, [LAUNCHER, "--port", String(port), "--project-dir", dir], {
      env: asEnv({ PATH: process.env.PATH, [SECRET_ENV]: SECRET, ...SENTINELS }), encoding: "utf8",
    });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain(".env");
    expect(run.stdout + run.stderr).not.toContain("SENTINEL");
    expect(existsSync(auditFile(port)), "nothing was spawned or audited").toBe(false);
  });
  it("the launcher refuses to run without the per-run secret", () => {
    const run = spawnSync(process.execPath, [LAUNCHER, "--port", "39903", "--project-dir", project({})], { env: asEnv({ PATH: process.env.PATH }), encoding: "utf8" });
    expect(run.status).toBe(2);
  });
});

describe("F1 — egress guard: only the fixture port answers", () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((d) => rmSync(d, { recursive: true, force: true })));

  const probe = `
    const net = require("node:net"), dns = require("node:dns"), dgram = require("node:dgram");
    const tcp = (host, port) => new Promise((r) => { const s = net.connect({ host, port, timeout: 1500 }); s.on("connect", () => { s.destroy(); r("connected"); }); s.on("error", (e) => r(e.code || e.message)); s.on("timeout", () => { s.destroy(); r("timeout"); }); });
    (async () => {
      const [host, allowed, other] = JSON.parse(process.argv[1]);
      const out = {};
      out.allowedPort = await tcp(host, allowed);
      out.otherLoopbackPort = await tcp(host, other);
      out.publicHost = await tcp("example.com", 443);
      out.publicIp = await tcp("93.184.216.34", 443);
      out.unixSocket = await new Promise((r) => { const s = net.connect({ path: "/tmp/.s.PGSQL.5432" }); s.on("error", (e) => r(e.code || e.message)); s.on("connect", () => r("connected")); });
      out.dns = await new Promise((r) => dns.lookup("example.com", (e) => r(e ? e.code : "resolved")));
      out.dnsPromise = await dns.promises.lookup("example.com").then(() => "resolved", (e) => e.code);
      out.fetch = await fetch("https://example.com/").then(() => "reached", (e) => (e.cause && e.cause.code) || e.message);
      out.udp = (() => { try { dgram.createSocket("udp4").send("x", 53, "8.8.8.8"); return "sent"; } catch (e) { return e.code; } })();
      process.stdout.write(JSON.stringify(out));
      process.exit(0);
    })();`;

  it("refuses every non-fixture destination with the guard's own code, and still serves the fixture port", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fixture-guard-"));
    roots.push(dir);
    const server = net.createServer((s) => s.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const allowed = (server.address() as net.AddressInfo).port;
    const other = allowed === 65535 ? allowed - 1 : allowed + 1;
    const audit = path.join(dir, "g.jsonl");
    try {
      const run = spawnSync(process.execPath, ["-e", probe, JSON.stringify(["127.0.0.1", allowed, other])], {
        env: asEnv({ PATH: process.env.PATH, NODE_OPTIONS: `--require ${EGRESS_GUARD}`, FIXTURE_EGRESS_ALLOW_PORT: String(allowed), FIXTURE_AUDIT_FILE: audit }),
        encoding: "utf8", timeout: 30_000,
      });
      const out = JSON.parse(run.stdout) as Record<string, string>;
      expect(out.allowedPort).toBe("connected");
      for (const key of ["otherLoopbackPort", "publicHost", "publicIp", "unixSocket", "dns", "dnsPromise", "udp"]) {
        expect(out[key], key).toBe("FIXTURE_EGRESS_BLOCKED");
      }
      expect(out.fetch).toBe("FIXTURE_EGRESS_BLOCKED");
      const events = readFileSync(audit, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { event: string; kind?: string });
      expect(events.filter((e) => e.event === "blocked").map((e) => e.kind)).toEqual(expect.arrayContaining(["tcp", "unix-socket", "dns", "udp"]));
    } finally {
      server.close();
    }
  });

  it("the audit names credential-like variables and never their values", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fixture-guard-"));
    roots.push(dir);
    const audit = path.join(dir, "n.jsonl");
    spawnSync(process.execPath, ["-e", "0"], {
      env: asEnv({ PATH: process.env.PATH, NODE_OPTIONS: `--require ${EGRESS_GUARD}`, FIXTURE_AUDIT_FILE: audit, ...SENTINELS }), encoding: "utf8",
    });
    const text = readFileSync(audit, "utf8");
    expect(JSON.parse(text.split("\n")[0]).credentialLikeKeys).toEqual(expect.arrayContaining(Object.keys(SENTINELS)));
    for (const value of Object.values(SENTINELS)) expect(text).not.toContain(value);
  });

  it("is test-only: nothing in production config, Docker or package scripts refers to the harness", () => {
    for (const f of ["next.config.ts", "Dockerfile", "Dockerfile.sync-worker", "package.json"]) {
      expect(read(f), f).not.toMatch(/egress-guard|local-fixtures|fixture-harness/);
    }
  });
});

describe("fixtures live outside the production-targeting default tests/e2e", () => {
  it("neither moved spec remains there, and both configs collect from tests/local-fixtures", () => {
    for (const spec of ["prepare-job-5551.spec.ts", "v3-project-resume.spec.ts", "v3-manual-lookup-handoff.spec.ts", "fixture-attestation.spec.ts"]) {
      expect(existsSync(path.join(HUB, "tests", "e2e", spec)), spec).toBe(false);
    }
    for (const config of ["playwright.prepare-job-5551.config.ts", "playwright.v3-project-resume.config.ts"]) {
      expect(read(config)).toContain('testDir: "./tests/local-fixtures"');
    }
  });
});
