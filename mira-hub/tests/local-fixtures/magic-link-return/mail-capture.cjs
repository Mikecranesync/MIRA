/**
 * TEST-ONLY Node preload for the local Hub server in the magic-link return
 * browser test (#5753). Loaded with `NODE_OPTIONS=--require <this file>` by
 * `run.sh` next to it, and nowhere else; production code is untouched.
 *
 * Two walls, both fail closed, and a run marker:
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
 * 3. Run marker (#5799). GET /__mlr_ready__ is answered by this preload, before
 *    Next sees it, with MLR_READY_TOKEN, a random value fresh for each run.
 *    run.sh waits for that exact answer, so a different server that happens
 *    to hold the port can never pass readiness.
 *
 * 4. Private listener (#5817). The Hub's HTTP server is moved off TCP onto
 *    MLR_LISTEN_SOCKET, a Unix socket inside the run's private work directory.
 *    The browser reaches it only through run.sh's relay (`relay.cjs`), which
 *    holds the Hub port for the whole run, so if the server dies another
 *    process can take neither the port nor the requests. Any other TCP listen
 *    by an HTTP server is refused.
 *
 * The shared fixture guard (`../harness/egress-guard.cjs`) is not reused
 * because it refuses every Unix socket, and this test needs one database.
 */
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const dns = require("node:dns");
const dgram = require("node:dgram");

const capturePath = process.env.MLR_MAIL_CAPTURE;
const hubPort = Number(process.env.MLR_ALLOW_HUB_PORT || 0);
const dbSocket = process.env.MLR_ALLOW_DB_SOCKET || "";
const readyToken = process.env.MLR_READY_TOKEN || "";
const listenSocket = process.env.MLR_LISTEN_SOCKET || "";
if (!capturePath || !hubPort || !dbSocket || !readyToken || !listenSocket) {
  throw new Error(
    "magic-link mail-capture: MLR_MAIL_CAPTURE, MLR_ALLOW_HUB_PORT, MLR_ALLOW_DB_SOCKET, MLR_READY_TOKEN and MLR_LISTEN_SOCKET are required",
  );
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

// ---- 3. Run marker ---------------------------------------------------------
const READY_PATH = "/__mlr_ready__";
const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function markerEmit(event, req, res) {
  if (event === "request" && req && req.method === "GET" && req.url === READY_PATH) {
    res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end(readyToken);
    return true;
  }
  return originalEmit.apply(this, arguments);
};

// ---- 4. Private listener ---------------------------------------------------
// `next start -p <port>` calls server.listen(port, hostname). That call is
// moved to the private socket; Next reads back a path from server.address()
// and keeps the port it was given, so its own URLs still name the relay.
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function privateListen(...args) {
  if (!(this instanceof http.Server)) return originalListen.apply(this, args);
  const first = args[0];
  const tcpPort = typeof first === "object" && first !== null ? first.port : first;
  if (typeof first === "object" && first !== null && first.path) return originalListen.apply(this, args);
  if (Number(tcpPort) === hubPort) {
    const callback = args.find((a) => typeof a === "function");
    return callback ? originalListen.call(this, listenSocket, callback) : originalListen.call(this, listenSocket);
  }
  throw refusal("listen", `tcp ${String(tcpPort)}`);
};
