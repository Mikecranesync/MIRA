"""Hello-world HTTPS server for the transport spike.

Three endpoints:
  GET /        -> 200 "hello"
  GET /health  -> 200 "ok"
  POST /hook   -> 200 echo of the JSON body

For Tailscale Funnel: pass the cert/key paths emitted by `tailscale cert`.
For local pytest: use build_server() to skip TLS.
"""
from __future__ import annotations

import json
import ssl
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer

MAX_BODY_BYTES = 1024 * 1024  # 1 MiB cap for POST /hook bodies


class SpikeHandler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, ctype: str = "text/plain") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Strict-Transport-Security", "max-age=31536000")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/":
            self._send(200, b"hello")
        elif self.path == "/health":
            self._send(200, b"ok")
        else:
            self._send(404, b"not found")

    def do_POST(self) -> None:
        if self.path != "/hook":
            self._send(404, b"not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send(400, b"invalid content-length")
            return
        if length < 0:
            self._send(400, b"invalid content-length")
            return
        if length > MAX_BODY_BYTES:
            self._send(413, b"payload too large")
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._send(400, b"invalid json")
            return
        self._send(200, json.dumps(payload).encode(), ctype="application/json")

    def log_message(self, format: str, *args) -> None:  # quieter test output
        return


def build_server(addr: tuple[str, int]) -> HTTPServer:
    # ThreadingHTTPServer is a subclass of HTTPServer — return type stays compatible.
    # Threaded so UptimeRobot health checks don't serialize behind slow `hey` clients.
    return ThreadingHTTPServer(addr, SpikeHandler)


def serve_tls(host: str, port: int, certfile: str, keyfile: str) -> None:
    httpd = build_server((host, port))
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctx.load_cert_chain(certfile=certfile, keyfile=keyfile)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"https://{host}:{port}/  (cert={certfile})", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.stderr.write("usage: hello_server.py <bind-host> <cert.crt> <cert.key>\n")
        sys.exit(2)
    serve_tls(sys.argv[1], 443, sys.argv[2], sys.argv[3])
