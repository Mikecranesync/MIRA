"""Negative controls for the acceptance harness's packet read.

A single "no packet" for every failure is what let a broken harness read as a
broken product. These five outcomes must land in five DIFFERENT buckets, or
the acceptance suite cannot tell a product defect from its own blindness — an
unauthorized or misrouted run would be reported as MIRA failing to record.

Run: pytest tools/qa/test_packet_classification.py -q
"""

import importlib.util
import json
import pathlib
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

_HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "raf", _HERE / "release_acceptance_recall_family.py"
)
raf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(raf)

NB = "00000000-0000-4000-8000-000000000000"
CRID = "11111111-1111-4111-8111-111111111111"


def _server(mode_box):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            mode = mode_box["v"]
            is_list = "limit=" in self.path

            def send(code, body, ctype="application/json"):
                b = body.encode()
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            if mode == "unauth":
                return send(401, json.dumps({"error": "unauthorized"}))
            if mode == "endpoint_missing":
                # No such route: a proxy/HTML 404, not this JSON API.
                return send(404, "<html>404 Not Found</html>", "text/html")
            if mode == "wrong_notebook":
                return send(404, json.dumps({"error": "not_found"}))
            if mode == "missing_turn":
                if is_list:
                    return send(200, json.dumps({"turns": []}))
                return send(
                    404,
                    json.dumps(
                        {
                            "error": "packet_not_found",
                            "client_request_id": CRID,
                            "notebook_id": NB,
                        }
                    ),
                )
            if is_list:
                return send(200, json.dumps({"turns": []}))
            return send(
                200,
                json.dumps(
                    {
                        "traceId": "t",
                        # Deliberately NOT the crid: decision_traces.turn_id is
                        # equipment_notebook_turns.id, which is why the lookup
                        # keys on client_request_id instead.
                        "turnId": "row-id-not-the-crid",
                        "notebookId": NB,
                        "packet": {"retrieval": {"candidate_count": 3}},
                        "anomalies": [],
                        "ts": "now",
                    }
                ),
            )

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def test_packet_read_distinguishes_five_failure_modes():
    mode_box = {"v": "ok"}
    srv = _server(mode_box)
    try:
        c = raf.Client(f"http://127.0.0.1:{srv.server_address[1]}", "cookie=x", NB)
        expect = [
            ("ok", c.PACKET_OK),
            ("unauth", c.PACKET_UNAUTHORIZED),
            ("endpoint_missing", c.PACKET_ENDPOINT_MISSING),
            ("wrong_notebook", c.PACKET_WRONG_NOTEBOOK),
            ("missing_turn", c.PACKET_MISSING_TURN),
        ]
        for mode, want in expect:
            mode_box["v"] = mode
            got, packet, detail = c.packet_read(CRID, tries=1)
            assert got == want, f"{mode}: classified {got}, expected {want} ({detail})"
            if want == c.PACKET_OK:
                assert packet is not None, "the success case must return a packet"
            else:
                assert packet is None, f"{mode} must not yield a packet"
        assert len({w for _, w in expect}) == 5, "outcomes are not five distinct buckets"
    finally:
        srv.shutdown()


def test_main_preserves_observation_failure_as_inconclusive(tmp_path, monkeypatch):
    monkeypatch.setenv("ACCEPT_BASE", "https://app-staging.factorylm.com")
    monkeypatch.setenv("ACCEPT_COOKIE", "test-only")
    monkeypatch.setattr(raf.sys, "argv", ["acceptance", "--notebook", NB,
        "--fresh-notebook", NB, "--hmi-photo", "unused.jpg", "--out", str(tmp_path / "out.json")])
    monkeypatch.setattr(raf.Client, "look", lambda *a, **k: (200, "file", CRID))
    monkeypatch.setattr(raf.Client, "ask", lambda *a, **k: (200, "", CRID))
    for status in (raf.Client.PACKET_UNAUTHORIZED, raf.Client.PACKET_ENDPOINT_MISSING,
                   raf.Client.PACKET_WRONG_NOTEBOOK, raf.Client.PACKET_MISSING_TURN):
        monkeypatch.setattr(raf.Client, "packet_read", lambda *a, **k: (status, None, "controlled response"))
        assert raf.main() == (1 if status == raf.Client.PACKET_MISSING_TURN else 2)
        results = json.loads((tmp_path / "out.json").read_text())["results"]
        if status != raf.Client.PACKET_MISSING_TURN:
            assert not any(r["ok"] is False for r in results)


def test_empty_sources_frame_does_not_prove_a_citation():
    assert not raf.cited_anything('data: {"kind":"sources","citations":[]}\n\n')
    assert not raf.cited_anything('data: {"kind":"content","content":"Use item [1]"}\n\n')
    assert raf.cited_anything('data: {"kind":"sources","citations":[{"docId":"manual-id"}]}\n\n')
