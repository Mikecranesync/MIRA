"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- must be CommonJS: loaded via NODE_OPTIONS --require / Playwright's CJS config loader */
/**
 * TEST-ONLY preload for the local browser fixtures. It is loaded through NODE_OPTIONS by
 * launch-fixture-server.mjs and nowhere else: never referenced by production code, next.config, a
 * Dockerfile or any environment hook.
 *
 * Purpose (#5731 F1): browser `page.route` mocks do not protect the server. A request made outside
 * the page reaches the real Hub routes, which would open a real database or provider connection if
 * the environment held credentials. The launcher already strips credentials; this is the second
 * wall: the process cannot open a socket to anything but its own fixture port.
 *
 * Refused: every outbound TCP connection except loopback -> FIXTURE_EGRESS_ALLOW_PORT (build phase: plus
 * the ephemeral range in FIXTURE_EGRESS_LOOPBACK_RANGE), every unix
 * socket (the default Postgres path), every UDP send/connect, and DNS for any name other than
 * `localhost`. A refusal surfaces as an ordinary connection error carrying code
 * FIXTURE_EGRESS_BLOCKED.
 *
 * Limit, stated honestly: this guards Node's own sockets. A child process that is not Node is not
 * intercepted; that case is covered by the credential-free environment, not by this file.
 *
 * Audit: one JSON line per event appended to FIXTURE_AUDIT_FILE. It records variable NAMES that look
 * like credentials and host:port of refused connections, never values or URLs.
 */
const net = require("node:net");
const dns = require("node:dns");
const dgram = require("node:dgram");
const fs = require("node:fs");
const path = require("node:path");

const allowPort = Number(process.env.FIXTURE_EGRESS_ALLOW_PORT || 0);
// `next build` workers (Turbopack) report back to their parent over loopback TCP on ephemeral ports;
// only the build phase is given that range, never the serving phase.
const [rangeLow, rangeHigh] = String(process.env.FIXTURE_EGRESS_LOOPBACK_RANGE || "0-0").split("-").map(Number);
const portAllowed = (port) => (allowPort > 0 && port === allowPort) || (rangeLow > 0 && port >= rangeLow && port <= rangeHigh);
const auditPath = process.env.FIXTURE_AUDIT_FILE || "";
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);
const CREDENTIAL_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|DATABASE|DSN|CREDENTIAL|_URL$|^PG[A-Z]+$)/i;
// Names the fixture itself sets on purpose; not "inherited credentials".
const FIXTURE_OWN = new Set(["AUTH_SECRET", "FIXTURE_AUTH_SECRET", "FIXTURE_EGRESS_ALLOW_PORT", "FIXTURE_EGRESS_LOOPBACK_RANGE", "FIXTURE_AUDIT_FILE", "NEXT_PUBLIC_API_BASE", "NEXT_PUBLIC_BASE_PATH"]);

function audit(event) {
  if (!auditPath) return;
  try {
    fs.appendFileSync(auditPath, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ...event })}\n`);
  } catch {
    /* auditing must never break the process */
  }
}

function refusal(kind, target) {
  const err = new Error(`FIXTURE_EGRESS_BLOCKED ${kind} ${target}`);
  err.code = "FIXTURE_EGRESS_BLOCKED";
  audit({ event: "blocked", kind, target });
  return err;
}

const credentialLikeKeys = Object.keys(process.env).filter((k) => CREDENTIAL_NAME.test(k) && !FIXTURE_OWN.has(k) && k !== "NODE_OPTIONS");
audit({ event: "loaded", script: path.basename(process.argv[1] || "node"), allowPort, loopbackRange: [rangeLow, rangeHigh], credentialLikeKeys });

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const [options] = Array.isArray(args[0]) ? args[0] : net._normalizeArgs(args);
  if (options && options.path) {
    const err = refusal("unix-socket", String(options.path));
    process.nextTick(() => this.destroy(err));
    return this;
  }
  const host = String((options && options.host) || "localhost");
  const port = Number(options && options.port);
  if (!(LOOPBACK.has(host) && portAllowed(port))) {
    const err = refusal("tcp", `${host}:${port}`);
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return originalConnect.apply(this, args);
};

const originalLookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, ...rest) {
  const cb = rest.find((r) => typeof r === "function");
  if (!LOOPBACK.has(String(hostname))) {
    const err = refusal("dns", String(hostname));
    if (cb) return process.nextTick(cb, err);
    throw err;
  }
  return originalLookup.call(dns, hostname, ...rest);
};
for (const fn of ["resolve", "resolve4", "resolve6"]) {
  dns[fn] = function guardedResolve(hostname, ...rest) {
    const err = refusal("dns", String(hostname));
    const cb = rest.find((r) => typeof r === "function");
    if (cb) return process.nextTick(cb, err);
    throw err;
  };
}
const originalPromisesLookup = dns.promises.lookup;
dns.promises.lookup = function guardedPromisesLookup(hostname, ...rest) {
  if (!LOOPBACK.has(String(hostname))) return Promise.reject(refusal("dns", String(hostname)));
  return originalPromisesLookup.call(dns.promises, hostname, ...rest);
};

for (const method of ["send", "connect"]) {
  dgram.Socket.prototype[method] = function guardedDgram() {
    throw refusal("udp", method);
  };
}
