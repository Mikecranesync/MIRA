/**
 * Preloaded into the test server (NODE_OPTIONS=--import). Backend isolation for a MOCKED-API browser runner: the only
 * socket this process may open is to ITS OWN fixture HTTP port on loopback (R4_ALLOWED_PORT). Every other loopback port
 * (ambient PostgreSQL, Ollama, ...), every Unix socket and every non-loopback host is refused with this guard's own
 * error and recorded. Plain ESM: no CommonJS require, so no lint exception is needed.
 */
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import { writeEnvReport } from "./guards.mjs";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);
const allowedPort = Number(process.env.R4_ALLOWED_PORT);
if (!Number.isInteger(allowedPort) || allowedPort <= 0) throw new Error("egress-block: R4_ALLOWED_PORT must be the exact fixture port");

const record = (target) => { try { if (process.env.R4_EGRESS_LOG) fs.appendFileSync(process.env.R4_EGRESS_LOG, `${new Date().toISOString()} blocked ${target}\n`); } catch { /* logging never changes the verdict */ } };

/** Normalise every net.connect() call shape: [options, cb] array, options object, (port, host), (path). */
function targetOf(args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first && typeof first === "object") {
    if (first.path) return { kind: "unix", label: `unix:${first.path}` };
    return { kind: "tcp", host: first.host ?? "localhost", port: Number(first.port) };
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) return { kind: "unix", label: `unix:${first}` };
  return { kind: "tcp", host: typeof args[1] === "string" ? args[1] : "localhost", port: Number(first) };
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const target = targetOf(args);
  const allowed = target.kind === "tcp" && LOOPBACK.has(String(target.host)) && target.port === allowedPort;
  if (allowed) return connect.apply(this, args);
  const label = target.kind === "unix" ? target.label : `${target.host}:${target.port}`;
  record(label);
  process.nextTick(() => this.destroy(new Error(`egress blocked: ${label}`)));
  return this;
};

const lookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  if (!LOOPBACK.has(String(hostname))) {
    record(hostname);
    const callback = rest.pop();
    return process.nextTick(() => callback(Object.assign(new Error(`egress blocked: ${hostname}`), { code: "ECONNREFUSED" })));
  }
  return lookup.call(dns, hostname, ...rest);
};

if (process.env.R4_ENV_REPORT) writeEnvReport(process.env.R4_ENV_REPORT); // the server reports its own inherited environment, once, at preload
