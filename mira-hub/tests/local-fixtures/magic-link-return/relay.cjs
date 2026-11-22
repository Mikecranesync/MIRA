/**
 * TEST ONLY. The browser-facing listener for the magic-link return fixture
 * (#5753, #5817). Started by `run.sh` next to it before anything else and
 * stopped after Playwright, so the Hub port stays owned by this run for the
 * whole run, even if the Hub server dies.
 *
 *   node relay.cjs <port> <hub socket> <failure log> <ready file>
 *
 * It listens on 127.0.0.1:<port> and relays each connection, byte for byte,
 * to the Hub server's Unix socket inside the run's private (0700) work
 * directory. The Hub has no TCP listener of its own (the preload moves it to
 * that socket), so when the Hub is gone a relayed connection fails here: the
 * failure is appended to the failure log, the browser's connection is
 * dropped, and run.sh fails the run. Nothing else can receive the request.
 *
 * Arguments are a port and three paths; it never sees a secret.
 */
"use strict";

const fs = require("node:fs");
const net = require("node:net");

const [portArg, hubSocket, failureLog, readyFile] = process.argv.slice(2);
const port = Number(portArg);
if (!port || !hubSocket || !failureLog || !readyFile) {
  console.error("usage: node relay.cjs <port> <hub socket> <failure log> <ready file>");
  process.exit(2);
}

const relay = net.createServer((client) => {
  const upstream = net.connect({ path: hubSocket });
  let failed = false;
  upstream.on("error", (err) => {
    if (!failed) {
      failed = true;
      fs.appendFileSync(failureLog, `${new Date().toISOString()} hub socket ${err.code || err.message}\n`);
    }
    client.destroy();
  });
  client.on("error", () => upstream.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
});

relay.on("error", (err) => {
  console.error(`relay: cannot listen on 127.0.0.1:${port}: ${err.code || err.message}`);
  process.exit(1);
});

relay.listen(port, "127.0.0.1", () => {
  fs.writeFileSync(readyFile, `${process.pid}\n`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => process.exit(0));
}
