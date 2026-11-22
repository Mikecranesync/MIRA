/**
 * Node preload for the local Hub server in the magic-link return browser test
 * (#5753). Loaded with `NODE_OPTIONS=--require <this file>` by
 * `tests/e2e/magic-link-return.run.sh`; production code is untouched.
 *
 * It replaces the server's global fetch so that:
 *   - every POST to api.resend.com is written to MLR_MAIL_CAPTURE (one JSON
 *     line per email) and answered locally. It NEVER reaches Resend, so no
 *     real mail can be sent, whatever key the server holds.
 *   - every other request to a non-loopback host is refused, so the test
 *     server cannot reach any staging or production service.
 *
 * It fails closed: without MLR_MAIL_CAPTURE the server refuses to start.
 */
"use strict";

const fs = require("node:fs");

const capturePath = process.env.MLR_MAIL_CAPTURE;
if (!capturePath) {
  throw new Error("magic-link-mail-capture: MLR_MAIL_CAPTURE must name the capture file");
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
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
  if (!LOOPBACK.has(url.hostname)) {
    process.stderr.write(`[magic-link-mail-capture] blocked outbound fetch to ${url.hostname}\n`);
    throw new TypeError(`blocked by the e2e preload: ${url.hostname}`);
  }
  return realFetch.call(this, input, init);
};
