#!/usr/bin/env node
/**
 * Test-only runner for the round4 browser fixture. Owns exactly one production `next start` on one exact loopback
 * origin: refuses an existing listener, builds a credential-clean environment from an allowlist (no dotenv, a per-run
 * signing secret), blocks backend egress, proves PID/cwd/buildID and source hashes, runs Playwright, then stops ONLY
 * the process it started. Usage: node tests/recovery-browser/run.mjs --label <name> [--expect-marker <text>|--expect-no-marker <text>] [-- <playwright args>]
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { childEnv, envViolations, refuseDotenv } from "./guards.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const hubFlagIndex = process.argv.indexOf("--hub-dir");
const hub = hubFlagIndex >= 0 ? path.resolve(process.argv[hubFlagIndex + 1]) : path.resolve(here, "../..");
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const label = flag("--label") ?? "run";
const port = Number(flag("--port") ?? 3951);
const out = flag("--out") ?? "/tmp/mira-tech-flow-20261121/r4-browser";
const rest = args.includes("--") ? args.slice(args.indexOf("--") + 1) : [];
// Fail closed on dotenv BEFORE anything else exists: no output dir, no log, no child.
try { refuseDotenv(hub); } catch (error) { console.error(`REFUSED: ${error.message}`); process.exit(4); }
fs.mkdirSync(out, { recursive: true });
const origin = `http://127.0.0.1:${port}`;
const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const listening = (p) => new Promise((resolve) => {
  const s = net.connect({ host: "127.0.0.1", port: p });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
});
if (await listening(port)) { console.error(`REFUSED: something already listens on ${origin}; this runner never reuses a server.`); process.exit(2); }

const buildId = fs.readFileSync(path.join(hub, ".next/BUILD_ID"), "utf8").trim();
const sources = ["src/factorylm-ui/hub-host.tsx", "src/factorylm-ui/hub-host-logic.ts", "src/app/api/equipment-notebooks/[id]/chat/route.ts"]
  .map((f) => ({ file: f, sha256: sha(path.join(hub, f)) }));
const grepStatic = (text) => spawnSync("grep", ["-rlF", text, path.join(hub, ".next/static")], { encoding: "utf8" }).stdout.trim().length > 0;
const marker = flag("--expect-marker"), noMarker = flag("--expect-no-marker");
if (marker && !grepStatic(marker)) { console.error(`REFUSED: build does not contain the expected marker: ${marker}`); process.exit(3); }
if (noMarker && grepStatic(noMarker)) { console.error(`REFUSED: build unexpectedly contains: ${noMarker}`); process.exit(3); }

const secret = randomBytes(32).toString("hex");           // per-run signing secret; never written to disk
const sentinel = `r4-sentinel-${randomBytes(6).toString("hex")}`; // confined to THIS process; must not reach the server
process.env.R4_SENTINEL_CREDENTIAL = sentinel;
const egressLog = path.join(out, `${label}-egress.log`);
fs.writeFileSync(egressLog, "");
const serverEnv = childEnv(process.env, {
  NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_BASE_PATH: "", NEXT_PUBLIC_API_BASE: "", AUTH_SECRET: secret, HOSTNAME: "127.0.0.1",
  NODE_OPTIONS: `--import ${pathToFileURL(path.join(here, "egress-block.mjs")).href}`, R4_EGRESS_LOG: egressLog, R4_ALLOWED_PORT: String(port),
  R4_ENV_REPORT: path.join(out, `${label}-server-env.json`),
});
// Every inherited credential-looking value (and the sentinel) must never reach a child; checked from INSIDE the child.
const forbiddenValues = Object.entries(process.env).filter(([k, v]) => v && /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|CREDENTIAL/i.test(k)).map(([, v]) => v);
const log = fs.openSync(path.join(out, `${label}-server.log`), "w");
const server = spawn(path.join(hub, "node_modules/.bin/next"), ["start", "-H", "127.0.0.1", "-p", String(port)], { cwd: hub, env: serverEnv, stdio: ["ignore", log, log] });
const stop = async () => {
  if (server.exitCode === null) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 1500)); if (server.exitCode === null) server.kill("SIGKILL"); }
};
process.on("SIGINT", async () => { await stop(); process.exit(130); });
let code = 1;
try {
  for (let i = 0; i < 60 && !(await listening(port)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await listening(port))) throw new Error("server did not start");
  const holder = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], { encoding: "utf8" }).stdout.split("\n").filter((l) => l.startsWith("p")).map((l) => Number(l.slice(1)));
  const cwd = spawnSync("lsof", ["-p", String(server.pid), "-a", "-d", "cwd", "-Fn"], { encoding: "utf8" }).stdout.split("\n").find((l) => l.startsWith("n"))?.slice(1);
  // `ps eww` shows no environment on this host, so the server preload reported its own (names, HOME, value hashes).
  const reportFile = serverEnv.R4_ENV_REPORT;
  for (let i = 0; i < 40 && !fs.existsSync(reportFile); i++) await new Promise((r) => setTimeout(r, 250));
  const serverReport = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const serverViolations = envViolations(serverReport, { allowedKeys: Object.keys(serverEnv), callerHome: process.env.HOME, forbiddenValues });
  const identity = {
    label, origin, pid: server.pid, listenerPids: holder, ownedListener: holder.length === 1 && holder[0] === server.pid,
    cwd, cwdIsHub: fs.realpathSync(cwd ?? "/nonexistent") === fs.realpathSync(hub), buildId, sources,
    markerChecked: marker ?? (noMarker ? `absent:${noMarker}` : null),
    serverEnvKeys: serverReport.keys, serverEnvViolations: serverViolations, homePreserved: serverReport.home === (process.env.HOME ?? null),
    forbiddenValuesChecked: forbiddenValues.length, signingSecretOnDisk: false,
  };
  if (serverViolations.length || !identity.ownedListener || !identity.cwdIsHub) {
    fs.writeFileSync(path.join(out, `${label}-identity.json`), JSON.stringify(identity, null, 2));
    throw new Error("server identity/credential check failed: " + JSON.stringify(identity));
  }
  const results = path.join(out, `${label}-results.json`);
  const child = spawn(path.join(hub, "node_modules/.bin/playwright"), ["test", "--config", path.join(here, "playwright.config.ts"), ...rest], {
    cwd: hub, stdio: "inherit",
    env: childEnv(process.env, {
      ...(process.env.HOME !== undefined ? { PLAYWRIGHT_BROWSERS_PATH: path.join(process.env.HOME, "Library/Caches/ms-playwright") } : {}),
      R4_ORIGIN: origin, R4_AUTH_SECRET: secret, R4_RESULTS: results, R4_SHOTS: path.join(out, `${label}-shots`), R4_ENV_REPORT: path.join(out, `${label}-playwright-env.json`) }),
  });
  code = await new Promise((r) => child.on("exit", (c) => r(c ?? 1)));
  const after = { buildId: fs.readFileSync(path.join(hub, ".next/BUILD_ID"), "utf8").trim(), sources: sources.map((s) => ({ file: s.file, sha256: sha(path.join(hub, s.file)) })) };
  identity.unchangedDuringRun = JSON.stringify(after.sources) === JSON.stringify(sources) && after.buildId === buildId;
  identity.playwrightExit = code;
  const pwReport = JSON.parse(fs.readFileSync(path.join(out, `${label}-playwright-env.json`), "utf8"));
  const pwAllowed = ["PATH", "HOME", "PLAYWRIGHT_BROWSERS_PATH", "R4_ORIGIN", "R4_AUTH_SECRET", "R4_RESULTS", "R4_SHOTS", "R4_ENV_REPORT"];
  // Playwright's own runtime adds a few variables to itself; only credential values and HOME are judged for it.
  identity.playwrightEnvViolations = envViolations({ ...pwReport, keys: pwReport.keys.filter((k) => pwAllowed.includes(k) || /^(PW|PLAYWRIGHT|FORCE_COLOR|NODE_OPTIONS|__)/.test(k)) }, { allowedKeys: pwAllowed.concat(pwReport.keys.filter((k) => /^(PW|PLAYWRIGHT|FORCE_COLOR|NODE_OPTIONS|__)/.test(k))), callerHome: process.env.HOME, forbiddenValues });
  identity.playwrightHomePreserved = pwReport.home === (process.env.HOME ?? null);
  identity.egressAttempts = fs.readFileSync(egressLog, "utf8").split("\n").filter(Boolean).length;
  fs.writeFileSync(path.join(out, `${label}-identity.json`), JSON.stringify(identity, null, 2));
  console.log(JSON.stringify({ ...identity, sources: undefined }, null, 1));
} finally {
  await stop();
  console.log("server stopped; port still listening:", await listening(port));
}
process.exit(code);
