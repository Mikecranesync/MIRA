// Mock Ignition gateway for the deterministic origin-root proxy test (QA-A).
// No deps (Node stdlib only). Reproduces the two traits that break naive proxying
// of Ignition Perspective:
//   1. Sends `X-Frame-Options: SAMEORIGIN` (+ a CSP) on the client document — the
//      proxy must STRIP these or the Hub iframe is blank.
//   2. Serves an absolute-path asset (`/res/perspective/app.js`) — the proxy must
//      forward it 1:1 (the per-id sub-path proxy would 404 it).
// Plus a WebSocket upgrade endpoint that returns 101 — the proxy must forward the
// upgrade (Perspective's runtime is WS).
import http from "node:http";
import crypto from "node:crypto";

const PORT = 8088;
const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/data/perspective/client/")) {
    // The Perspective client document — frame-blocking headers + absolute asset.
    res.writeHead(200, {
      "Content-Type": "text/html",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
    res.end(
      `<!doctype html><html><head>` +
        `<script src="/res/perspective/app.js"></script>` +
        `</head><body>MOCK PERSPECTIVE CLIENT</body></html>`,
    );
    return;
  }
  if (req.url.startsWith("/res/perspective/") || req.url.startsWith("/data/perspective/")) {
    // An absolute-rooted asset — must come through the proxy 1:1.
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end("// mock perspective asset\n");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found\n");
});

// WebSocket upgrade — complete the handshake so the proxy's forwarded upgrade
// yields a real 101.
server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"] || "";
  const accept = crypto
    .createHash("sha1")
    .update(key + WS_MAGIC)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  // Keep the socket briefly so the client sees 101, then close.
  setTimeout(() => socket.destroy(), 500);
});

server.listen(PORT, () => console.log(`mock-gateway listening :${PORT}`));
