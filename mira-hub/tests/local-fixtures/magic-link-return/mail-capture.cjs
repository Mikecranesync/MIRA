/**
 * TEST-ONLY Node preload for the local Hub server in the magic-link return
 * browser test (#5753). Loaded with `NODE_OPTIONS=--require <this file>` by
 * `run.sh` next to it, and nowhere else; production code is untouched.
 *
 * Two walls, both fail closed:
 *
 * 1. Mail capture. The server's global fetch is replaced so that every POST to
 *    api.resend.com is written to MLR_MAIL_CAPTURE (one JSON line per email)
 *    and answered locally. It NEVER reaches Resend, so no real mail can be
 *    sent, whatever key the server holds. Any other fetch to a non-loopback
 *    host is refused.
 *
 * 2. Transport allowlist (#5795 review F2). Code that opens sockets directly
 *    (database drivers, SDK clients) never goes through fetch, so the socket
 *    layer is guarded too. The process may open exactly two kinds of
 *    connection: TCP to its own Hub port on loopback (MLR_ALLOW_HUB_PORT), and
 *    the one Unix socket of the disposable database (MLR_ALLOW_DB_SOCKET).
 *    Every other TCP or Unix-socket connection, every UDP send, and DNS for any
 *    name other than a loopback name or address is refused with code MLR_EGRESS_BLOCKED and
 *    logged to stderr (host and port only, never a value).
 *
 * The shared fixture guard (`../harness/egress-guard.cjs`) is not reused
 * because it refuses every Unix socket, and this test needs one database.
 */
"use strict";

const fs = require("node:fs");
const net = require("node:net");
const dns = require("node:dns");
const dgram = require("node:dgram");

const capturePath = process.env.MLR_MAIL_CAPTURE;
const hubPort = Number(process.env.MLR_ALLOW_HUB_PORT || 0);
const dbSocket = process.env.MLR_ALLOW_DB_SOCKET || "";
if (!capturePath || !hubPort || !dbSocket) {
  throw new Error("magic-link mail-capture: MLR_MAIL_CAPTURE, MLR_ALLOW_HUB_PORT and MLR_ALLOW_DB_SOCKET are required");
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "::ffff:127.0.0.1"]);

function refusal(kind, target) {
  process.stderr.write(`[magic-link mail-capture] blocked ${kind} ${target}\n`);
  const err = new Error(`MLR_EGRESS_BLOCKED ${kind} ${target}`);
  err.code = "MLR_EGRESS_BLOCKED";
  return err;
}

// ---- 2. Transport allowlist ------------------------------------------------
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const [options] = Array.isArray(args[0]) ? args[0] : net._normalizeArgs(args);
  if (options && options.path) {
    if (String(options.path) === dbSocket) return originalConnect.apply(this, args);
    const err = refusal("unix-socket", String(options.path));
    process.nextTick(() => this.destroy(err));
    return this;
  }
  const host = String((options && options.host) || "localhost");
  const port = Number(options && options.port);
  if (LOOPBACK.has(host) && port === hubPort) return originalConnect.apply(this, args);
  const err = refusal("tcp", `${host}:${port}`);
  process.nextTick(() => this.destroy(err));
  return this;
};

const originalLookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, ...rest) {
  if (LOOPBACK.has(String(hostname))) return originalLookup.call(dns, hostname, ...rest);
  const err = refusal("dns", String(hostname));
  const cb = rest.find((r) => typeof r === "function");
  if (cb) return process.nextTick(cb, err);
  throw err;
};
const originalPromisesLookup = dns.promises.lookup;
dns.promises.lookup = function guardedPromisesLookup(hostname, ...rest) {
  if (LOOPBACK.has(String(hostname))) return originalPromisesLookup.call(dns.promises, hostname, ...rest);
  return Promise.reject(refusal("dns", String(hostname)));
};
for (const fn of ["resolve", "resolve4", "resolve6"]) {
  dns[fn] = function guardedResolve(hostname, ...rest) {
    const err = refusal("dns", String(hostname));
    const cb = rest.find((r) => typeof r === "function");
    if (cb) return process.nextTick(cb, err);
    throw err;
  };
}
for (const method of ["send", "connect"]) {
  dgram.Socket.prototype[method] = function guardedDgram() {
    throw refusal("udp", method);
  };
}

// ---- 1. Mail capture -------------------------------------------------------
const realFetch = globalThis.fetch;

function urlOf(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === "string") return input.url;
  return String(input);
}

globalThis.fetch = async function captureFetch(input, init) {
  const url = new URL(urlOf(input));
  if (url.hostname === "api.resend.com") {
    const raw = init && typeof init.body === "string" ? init.body : "";
    let email = null;
    try {
      email = JSON.parse(raw);
    } catch {
      email = { unparsed: raw };
    }
    fs.appendFileSync(
      capturePath,
      JSON.stringify({ capturedAt: new Date().toISOString(), url: url.href, email }) + "\n",
    );
    return new Response(JSON.stringify({ id: "captured-locally" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (!LOOPBACK.has(url.hostname)) throw new TypeError(refusal("fetch", url.hostname).message);
  return realFetch.call(this, input, init);
};
