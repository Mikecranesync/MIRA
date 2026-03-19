"""
Tiny HTTP results server — serves artifacts/latest_run/results.json at GET /results.
Runs in a daemon thread from runner_async.py.

Usage:
    curl http://localhost:8020/results
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

RESULTS_PATH = os.path.join(
    os.path.dirname(__file__), "../artifacts/latest_run/results.json"
)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/results":
            self.send_error(404)
            return
        try:
            with open(RESULTS_PATH) as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data.encode())
        except FileNotFoundError:
            self.send_error(503, "No results yet")

    def log_message(self, *_):
        pass  # silence access log


def start(port: int = 8020):
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
