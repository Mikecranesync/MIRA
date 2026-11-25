#!/usr/bin/env node
/**
 * TEST-ONLY launcher (see fixture-harness.cjs). Playwright runs this as the fixture `webServer`; it
 * builds the Hub and serves it on 127.0.0.1 only, with an allowlisted environment, a per-run secret
 * and the egress guard preloaded. It owns exactly one child and stops it on SIGTERM/SIGINT.
 *
 *   node launch-fixture-server.mjs --port <port> [--project-dir <dir>]
 *
 * The caller's environment (DATABASE/provider/cloud credentials, Doppler, shell exports) is NOT
 * forwarded; see buildChildEnv. Refuses to start at all when the project has dotenv files.
 */
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import harness from "./fixture-harness.cjs";

const { auditFile, buildChildEnv, FIXTURE_HOST, findDotenv, HARNESS_DIR, SECRET_ENV } = harness;

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const port = Number(flag("--port"));
const projectDir = path.resolve(flag("--project-dir") ?? path.join(HARNESS_DIR, "..", "..", ".."));

function fail(code, message) {
  console.error(`[fixture-launcher] ${message}`);
  process.exit(code);
}

if (!Number.isInteger(port) || port < 1024 || port > 65535) fail(2, "--port <1024-65535> is required");
const secret = process.env[SECRET_ENV];
if (!secret || secret.length < 64) fail(2, `${SECRET_ENV} (per-run secret from the Playwright config) is required`);

// Fail closed BEFORE anything is spawned: Next loads these in both `build` and `start`.
const dotenv = findDotenv(projectDir);
if (dotenv.length > 0) {
  fail(3, `refusing to run: ${projectDir} contains dotenv file(s) ${dotenv.join(", ")} that Next would load. Move them aside; the fixture never reads real settings.`);
}

const auditPath = auditFile(port);
writeFileSync(auditPath, "");
const audit = (event) => appendFileSync(auditPath, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ...event })}\n`);
const buildEnv = buildChildEnv(process.env, { port, secret, auditPath, phase: "build" });
const serveEnv = buildChildEnv(process.env, { port, secret, auditPath, phase: "serve" });
const next = path.join(projectDir, "node_modules", ".bin", "next");

/** `next build` with the known one-time upstream security advisory retried (signature-matched, max 3). */
async function build() {
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const logPath = path.join(tmpdir(), `fixture-build-${port}-try${attempt}.log`);
    const code = await new Promise((resolve) => {
      const child = spawn(next, ["build"], { cwd: projectDir, env: buildEnv, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (c) => {
        writeFileSync(logPath, out);
        resolve({ c, advisory: out.includes("SecurityFatalError") });
      });
    });
    audit({ event: "build", attempt, exit: code.c, advisory: code.advisory, log: logPath });
    const idPath = path.join(projectDir, ".next", "BUILD_ID");
    if (code.c === 0 && statSync(idPath).mtimeMs >= startedAt) return readFileSync(idPath, "utf8").trim();
    if (!code.advisory) fail(4, `next build failed (see ${logPath})`);
  }
  return fail(4, "next build kept halting on the upstream advisory after 3 attempts");
}

const buildId = await build();
const server = spawn(next, ["start", "-p", String(port), "-H", FIXTURE_HOST, projectDir], { cwd: projectDir, env: serveEnv, stdio: ["ignore", "ignore", "ignore"] });
audit({ event: "serving", serverPid: server.pid, host: FIXTURE_HOST, port, cwd: projectDir, buildId });
console.log(`[fixture-launcher] serving build ${buildId} on ${FIXTURE_HOST}:${port} (server pid ${server.pid})`);

const stop = () => {
  server.kill("SIGTERM");
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
server.on("exit", (code, signal) => {
  audit({ event: "server-exit", code, signal });
  process.exit(code ?? 0);
});
