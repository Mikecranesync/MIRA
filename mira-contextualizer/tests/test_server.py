"""Local HTTP API — full offline flow: create project → upload PLC export → review → export."""
import json
import pathlib
import threading
import urllib.request

import mira_plc_parser
import pytest

from mira_contextualizer.server import serve
from mira_contextualizer.store import Store

FIXTURE = pathlib.Path(mira_plc_parser.__file__).parent.parent / "tests" / "fixtures" / "conveyor.L5X"
GUI_DIR = str(pathlib.Path(__file__).parent.parent / "mira_contextualizer" / "gui")


@pytest.fixture()
def base(tmp_path):
    store = Store(str(tmp_path / "t.db"))
    httpd, port = serve(store, GUI_DIR)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{port}"
    httpd.shutdown()
    store.close()


def _req(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read().decode())


def test_full_flow(base):
    # create
    st, j = _req(f"{base}/api/projects", "POST", {"name": "Line A"})
    assert st == 201
    pid = j["project"]["id"]

    # upload a real PLC export → extractions appear
    st, j = _req(f"{base}/api/projects/{pid}/sources", "POST",
                 {"fileName": FIXTURE.name, "text": FIXTURE.read_text(encoding="utf-8")})
    assert st == 201 and j["extractions"] >= 1

    # list extractions
    st, j = _req(f"{base}/api/projects/{pid}/extractions")
    assert st == 200 and len(j["extractions"]) >= 1
    target = next(e for e in j["extractions"] if e["unsPathProposed"])

    # accept one
    st, j = _req(f"{base}/api/extractions/{target['id']}", "PATCH", {"status": "accepted"})
    assert st == 200 and j["extraction"]["status"] == "accepted"

    # project counts reflect it
    st, j = _req(f"{base}/api/projects/{pid}")
    assert j["project"]["acceptedCount"] == 1

    # export accepted as UNS
    st, j = _req(f"{base}/api/projects/{pid}/export?format=uns")
    assert st == 200 and j["schema"] == "mira-contextualizer/uns@1"
    assert any(s["tag"] == target["tagName"] for s in j["signals"])


def test_static_index_served(base):
    with urllib.request.urlopen(f"{base}/index.html") as r:
        assert r.status == 200 and b"FactoryLM Contextualizer" in r.read()


def _upload_bytes(base, pid, file_name, raw):
    req = urllib.request.Request(
        f"{base}/api/projects/{pid}/sources", data=raw, method="POST",
        headers={"Content-Type": "application/octet-stream", "X-File-Name": file_name})
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read().decode())


def test_document_upload_extracts_text(base):
    _, j = _req(f"{base}/api/projects", "POST", {"name": "Docs"})
    pid = j["project"]["id"]
    st, j = _upload_bytes(base, pid, "notes.txt", b"VFD overload fault F0004 on CV-101")
    assert st == 201 and j["extractor"] == "text" and j["chars"] > 0 and j["blocks"] >= 1


def test_image_upload_degrades_gracefully(base):
    # PNG with no Tesseract engine → extracted, zero text, a warning, but never a crash.
    from PIL import Image
    import io
    buf = io.BytesIO(); Image.new("RGB", (40, 20), "white").save(buf, format="PNG")
    _, j = _req(f"{base}/api/projects", "POST", {"name": "Scans"})
    pid = j["project"]["id"]
    st, j = _upload_bytes(base, pid, "scan.png", buf.getvalue())
    assert st == 201 and j["extractor"] == "image-ocr"
