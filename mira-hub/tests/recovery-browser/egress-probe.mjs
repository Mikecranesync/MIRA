#!/usr/bin/env node
/**
 * Standalone isolation probe for egress-block.mjs. Owns three listeners (allowed HTTP, a DIFFERENT loopback HTTP
 * listener, a Unix socket), runs egress-probe-child.mjs under the preload, then asserts the verdicts AND the listeners'
 * own connection counts: the allowed one saw traffic; the other loopback and Unix listeners saw ZERO connections;
 * every forbidden attempt was refused by the guard itself (not a timeout). Usage: node egress-probe.mjs [out-dir]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "r4-egress-probe-"));
fs.mkdirSync(out, { recursive: true });
const sockDir = fs.mkdtempSync(path.join(out, "sock-"));
const unixPath = path.join(sockDir, "u.sock");
const counts = { allowed: 0, other: 0, unix: 0 };
const listen = (server, ...args) => new Promise((resolve) => server.listen(...args, resolve));
const allowed = http.createServer((q, r) => { r.end("ok"); }); allowed.on("connection", () => { counts.allowed++; });
const other = http.createServer((q, r) => { r.end("ok"); }); other.on("connection", () => { counts.other++; });
const unix = net.createServer((s) => { counts.unix++; s.destroy(); });
await listen(allowed, 0, "127.0.0.1"); await listen(other, 0, "127.0.0.1"); await listen(unix, unixPath);
const portA = allowed.address().port, portB = other.address().port;
const log = path.join(out, "egress-probe.log"); fs.writeFileSync(log, "");

const child = spawn(process.execPath, ["--import", pathToFileURL(path.join(here, "egress-block.mjs")).href, path.join(here, "egress-probe-child.mjs")], {
  env: { PATH: process.env.PATH, R4_ALLOWED_PORT: String(portA), R4_EGRESS_LOG: log, PROBE_ALLOWED: String(portA), PROBE_OTHER: String(portB), PROBE_UNIX: unixPath },
  stdio: ["ignore", "pipe", "inherit"],
});
let stdout = ""; child.stdout.on("data", (d) => { stdout += d; });
await new Promise((resolve) => child.on("exit", resolve));
for (const server of [allowed, other, unix]) await new Promise((resolve) => server.close(resolve));
try { fs.rmdirSync(sockDir); } catch { /* an empty task-owned dir; left in place if the platform keeps the socket file */ }

const verdicts = JSON.parse(stdout.trim().split("\n").pop());
const failures = [];
for (const [name, verdict] of Object.entries(verdicts)) {
  if (name.startsWith("allowed")) { if (verdict !== "CONNECTED") failures.push(`${name}: ${verdict}`); }
  else if (!verdict.startsWith("refused:") || (!verdict.includes("egress blocked") && !verdict.includes("fetch failed"))) failures.push(`${name}: ${verdict}`);
}
if (counts.other !== 0) failures.push(`the OTHER loopback listener received ${counts.other} connection(s)`);
if (counts.unix !== 0) failures.push(`the Unix listener received ${counts.unix} connection(s)`);
if (counts.allowed < 1) failures.push("the allowed listener received no connection");
const blocked = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
for (const needle of [`127.0.0.1:${portB}`, `unix:${unixPath}`, "192.0.2.1:80"]) if (!blocked.some((l) => l.includes(needle))) failures.push(`guard log lacks ${needle}`);
console.log(JSON.stringify({ verdicts, listenerConnections: counts, guardLogLines: blocked.length, failures }, null, 1));
process.exit(failures.length ? 1 : 0);
