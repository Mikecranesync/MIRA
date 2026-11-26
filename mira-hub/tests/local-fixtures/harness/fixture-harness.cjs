/**
 * TEST-ONLY shared harness for the local browser fixtures (prepare-job #5551, v3-project-resume #4681).
 * Nothing here is imported by production code, next.config, a Dockerfile or any env hook.
 *
 * Why it exists (#5731 native review F1/F4): a fixture that runs the real Next server must not
 *   - listen beyond loopback        -> the server is started with an explicit `-H 127.0.0.1`
 *   - sign sessions with a known key -> a random per-run secret, never written to the repo
 *   - inherit developer credentials  -> the child gets an allowlisted env, not `process.env`
 *   - read dotenv files              -> refused outright (Next would load them in build and start)
 *   - reach real backends            -> egress-guard.cjs refuses every non-fixture socket
 *   - be reached on another origin   -> one exact origin for readiness, auth cookie and navigation
 * Browser `page.route` mocks only cover the page; they do not protect the server, so none of the
 * above relies on them.
 */
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- must be CommonJS: loaded via NODE_OPTIONS --require / Playwright's CJS config loader */
const { randomBytes } = require("node:crypto");
const { existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const FIXTURE_HOST = "127.0.0.1";
const SECRET_ENV = "FIXTURE_AUTH_SECRET";
const HARNESS_DIR = __dirname;
const EGRESS_GUARD = path.join(HARNESS_DIR, "egress-guard.cjs");
const LAUNCHER = path.join(HARNESS_DIR, "launch-fixture-server.mjs");

/** The one origin a fixture run owns. */
const fixtureOrigin = (port) => `http://${FIXTURE_HOST}:${port}`;

/** Where the launcher and the egress guard record what they did (JSON lines, names/hosts only). */
const auditFile = (port) => path.join(tmpdir(), `fixture-audit-${port}.jsonl`);

/**
 * Throws unless `baseURL` is exactly the origin this run owns. Loopback is not enough: another
 * listener on a different loopback port could be an older build (F4).
 * @param {string | undefined} baseURL
 * @param {number} port
 */
function assertFixtureOrigin(baseURL, port) {
  const expected = fixtureOrigin(port);
  let origin = "";
  try {
    origin = new URL(baseURL ?? "").origin;
  } catch {
    /* falls through to the refusal */
  }
  if (origin !== expected) {
    throw new Error(`fixture refuses origin ${baseURL ?? "(none)"}: this run owns exactly ${expected}`);
  }
  return expected;
}

/**
 * The per-run signing secret. Generated once in the Playwright runner (config load) and inherited by
 * the webServer launcher and the test workers through the environment, so all three agree without a
 * committed key. A value too short to be a generated key is replaced, never used.
 * @param {Record<string, string | undefined>} [env]
 */
function fixtureSecret(env = process.env) {
  const current = env[SECRET_ENV];
  if (current && current.length >= 64) return current;
  env[SECRET_ENV] = randomBytes(32).toString("hex");
  return env[SECRET_ENV];
}

/** The dotenv files Next loads from a project dir (docs: Environment Variable Load Order). */
const DOTENV_NAMES = [
  ".env", ".env.local",
  ".env.development", ".env.development.local",
  ".env.production", ".env.production.local",
  ".env.test", ".env.test.local",
];

/** Names of dotenv files present in `dir`. A non-empty result means the fixture must refuse to run. */
function findDotenv(dir) {
  return DOTENV_NAMES.filter((name) => existsSync(path.join(dir, name)));
}

/** The only variables copied from the caller; everything else (DB, provider, cloud keys) is dropped. */
const ENV_ALLOWLIST = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"];

/** What a variable NAME looks like when it may carry a credential (names only are ever reported). */
const CREDENTIAL_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|DATABASE|DSN|CREDENTIAL|_URL$|^PG[A-Z]+$)/i;

/**
 * The environment for the fixture's build and server processes. HOME is passed through unchanged
 * (never redirected); nothing is copied from the caller beyond the allowlist.
 * @param {Record<string, string | undefined>} parent
 * @param {{ port: number, secret: string, auditPath?: string, phase?: "build" | "serve" }} opts
 * @returns {Record<string, string>}
 */
function buildChildEnv(parent, { port, secret, auditPath = auditFile(port), phase = "serve" }) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const key of ENV_ALLOWLIST) if (parent[key] !== undefined) env[key] = String(parent[key]);
  return {
    ...env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_BASE_PATH: "",
    NEXT_PUBLIC_API_BASE: "",
    AUTH_SECRET: secret,
    HOSTNAME: FIXTURE_HOST,
    PORT: String(port),
    NODE_OPTIONS: `--require ${EGRESS_GUARD}`,
    FIXTURE_EGRESS_ALLOW_PORT: String(port),
    FIXTURE_AUDIT_FILE: auditPath,
    // Build workers talk to their parent over loopback ephemeral ports; the server never needs that.
    ...(phase === "build" ? { FIXTURE_EGRESS_LOOPBACK_RANGE: "49152-65535" } : {}),
  };
}

/**
 * The Playwright `webServer` for a fixture: the harness launcher (build + loopback-only serve), one
 * exact origin for readiness, never an existing server.
 * @param {number} port
 * @returns {import("@playwright/test").TestConfig["webServer"]}
 */
function fixtureWebServer(port) {
  return {
    command: `node ${JSON.stringify(LAUNCHER)} --port ${port}`,
    url: `${fixtureOrigin(port)}/login`,
    timeout: 600_000,
    reuseExistingServer: false,
    env: { [SECRET_ENV]: fixtureSecret() },
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
  };
}

/**
 * Installs the fixture's authenticated session cookie. The origin is validated FIRST: a wrong origin
 * throws before the secret is read, a token is encoded or the context is touched.
 * @param {{ addCookies: (c: { name: string; value: string; url: string }[]) => Promise<void> }} context
 * @param {string | undefined} baseURL
 * @param {number} port
 * @param {Record<string, unknown>} claims
 */
async function installSessionCookie(context, baseURL, port, claims) {
  const origin = assertFixtureOrigin(baseURL, port);
  const secret = process.env[SECRET_ENV];
  // A worker must inherit the runner's key; generating a fresh one here would mint a cookie the
  // server (started with the runner's key) rejects, and hide why.
  if (!secret || secret.length < 64) throw new Error(`${SECRET_ENV} was not inherited from the Playwright runner`);
  const { encode } = await import("next-auth/jwt");
  const token = await encode({ token: claims, secret });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: origin }]);
}

module.exports = {
  FIXTURE_HOST, SECRET_ENV, HARNESS_DIR, EGRESS_GUARD, LAUNCHER, CREDENTIAL_NAME,
  fixtureOrigin, auditFile, assertFixtureOrigin, fixtureSecret, findDotenv, buildChildEnv, fixtureWebServer, installSessionCookie,
};
