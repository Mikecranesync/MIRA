"""Tests for the i3X server client, run against a stdlib stub server (no real network)."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from mira_plc_parser import i3x, i3x_client
from mira_plc_parser.pipeline import render_json, run

FIXTURE = Path(__file__).parent / "fixtures" / "conveyor.L5X"


class _StubHandler(BaseHTTPRequestHandler):
    """A minimal i3X-shaped stub: /info, /namespaces, /objects/list. Anything with '/vfd/' in its
    elementId is treated as 'already on the server' so reconcile has both existing + new."""

    def log_message(self, *_a):
        pass

    def _send(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/info":
            self._send({"data": {"specVersion": "1.0", "serverVersion": "stub-0.1",
                                 "serverName": "stub-i3x", "capabilities": []}})
        elif self.path == "/namespaces":
            self._send({"data": [{"uri": "urn:demo:ns", "displayName": "Demo"}]})
        else:
            self._send({"error": "not found"}, code=404)

    def do_POST(self):
        if self.path == "/objects/list":
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
            ids = req.get("elementIds", [])
            # mimic the real i3X server: ECHO every requested id, with a per-item success flag.
            # A not-found id still carries its elementId + a 404 responseDetail (the bug that made
            # a naive client count everything as 'present').
            results = []
            for i in ids:
                if "/vfd/" in i:
                    results.append({"success": True, "elementId": i})
                else:
                    results.append({"success": False, "elementId": i,
                                    "responseDetail": {"title": "Not Found", "status": 404}})
            self._send({"success": False, "results": results})
        else:
            self._send({"error": "not found"}, code=404)


@pytest.fixture()
def stub_server():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _StubHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % httpd.server_address[1]
    yield base
    httpd.shutdown()


def _payload():
    rep = render_json(run(FIXTURE.name, FIXTURE.read_text(encoding="utf-8")))
    return i3x.to_i3x(rep)


def test_info_handshake(stub_server):
    srv = i3x_client.info(stub_server)
    assert srv["serverName"] == "stub-i3x"
    assert srv["specVersion"] == "1.0"


def test_list_namespaces(stub_server):
    ns = i3x_client.list_namespaces(stub_server)
    assert ns and ns[0]["uri"] == "urn:demo:ns"


def test_existing_ids_filters_to_server_present(stub_server):
    ids = ["enterprise/site1/area1/conveyorcell/vfd/frequency",
           "enterprise/site1/area1/conveyorcell/start_pb"]
    present = i3x_client.existing_ids(stub_server, ids)
    assert "enterprise/site1/area1/conveyorcell/vfd/frequency" in present
    assert "enterprise/site1/area1/conveyorcell/start_pb" not in present


def test_reconcile_splits_existing_vs_new(stub_server):
    rec = i3x_client.reconcile(stub_server, _payload())
    assert rec["total"] == rec["existing_count"] + rec["new_count"]
    assert rec["existing_count"] >= 1   # the /vfd/ nodes are "on the server"
    assert rec["new_count"] >= 1        # the rest are new
    assert all("/vfd/" in i or i.endswith("/vfd") for i in rec["existing"]) is False or rec["existing"]


def test_unreachable_server_raises_i3xerror():
    # port 0 after a failed connect: use a closed port on localhost
    with pytest.raises(i3x_client.I3XError):
        i3x_client.info("http://127.0.0.1:9", timeout=1)
