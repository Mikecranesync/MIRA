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


def test_bundle_and_i3x_export(base):
    import io
    import zipfile
    _, j = _req(f"{base}/api/projects", "POST", {"name": "Bundle Co"})
    pid = j["project"]["id"]
    _req(f"{base}/api/projects/{pid}/sources", "POST",
         {"fileName": FIXTURE.name, "text": FIXTURE.read_text(encoding="utf-8")})
    _, ext = _req(f"{base}/api/projects/{pid}/extractions")
    target = next(e for e in ext["extractions"] if e["unsPathProposed"])
    _req(f"{base}/api/extractions/{target['id']}", "PATCH", {"status": "accepted"})

    # i3x
    st, j = _req(f"{base}/api/projects/{pid}/export?format=i3x")
    assert st == 200 and j["schema"] == "mira-contextualizer/i3x@1"

    # bundle (zip)
    with urllib.request.urlopen(f"{base}/api/projects/{pid}/export?format=bundle") as r:
        assert r.status == 200 and r.headers["Content-Type"] == "application/zip"
        data = r.read()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        assert "manifest.json" in zf.namelist() and "uns.json" in zf.namelist()


def test_ccw_project_import_json_and_zip(base):
    import io
    import zipfile
    from test_ccw import LOGICAL, MODBUS, ST  # reuse the CCW fixtures (tests dir on sys.path)

    _, j = _req(f"{base}/api/projects", "POST", {"name": "CCW Co"})
    pid = j["project"]["id"]

    # folder pick → JSON file array
    st, j = _req(f"{base}/api/projects/{pid}/ccw-import", "POST",
                 {"projectName": "FactoryLM_PLC",
                  "files": [{"name": "MbSrvConf.xml", "text": MODBUS},
                            {"name": "Conv.st", "text": ST},
                            {"name": "LogicalValues.csv", "text": LOGICAL}]})
    assert st == 201 and j["extractions"] >= 5
    assert j["controller"] == "2080-LC20-20QBB" and j["fileCount"] == 3
    _, ext = _req(f"{base}/api/projects/{pid}/extractions")
    mr = next(e for e in ext["extractions"] if e["tagName"] == "motor_running")
    assert mr["evidenceJson"]["modbus_address"] == "000001"  # merged across files

    # zip / .ccwx archive
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("Controller/Controller/MbSrvConf.xml", MODBUS)
        zf.writestr("Controller/Controller/Micro820/Micro820/Prog.stf", ST)
        zf.writestr("PrjLibrary.accdb", b"\x00\x01binary")  # ignored (not a CCW text file)
    req = urllib.request.Request(f"{base}/api/projects/{pid}/ccw-import", data=buf.getvalue(),
                                 method="POST", headers={"Content-Type": "application/octet-stream",
                                                         "X-Project-Name": "backup.zip"})
    with urllib.request.urlopen(req) as r:
        zj = json.loads(r.read().decode())
    assert zj["fileCount"] == 2 and zj["extractions"] >= 4 and zj["controller"] == "2080-LC20-20QBB"


def test_scorecard_endpoint(base):
    _, j = _req(f"{base}/api/projects", "POST", {"name": "Scored"})
    pid = j["project"]["id"]
    _req(f"{base}/api/projects/{pid}/sources", "POST",
         {"fileName": FIXTURE.name, "text": FIXTURE.read_text(encoding="utf-8")})
    st, sc = _req(f"{base}/api/projects/{pid}/scorecard")
    assert st == 200 and sc["schema"] == "mira-contextualizer/scorecard@1"
    assert 0 <= sc["score"] <= 100 and "grade" in sc and isinstance(sc["topGaps"], list)


def test_static_index_served(base):
    with urllib.request.urlopen(f"{base}/index.html") as r:
        assert r.status == 200 and b"FactoryLM Contextualizer" in r.read()


def _upload_bytes(base, pid, file_name, raw):
    req = urllib.request.Request(
        f"{base}/api/projects/{pid}/sources", data=raw, method="POST",
        headers={"Content-Type": "application/octet-stream", "X-File-Name": file_name})
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read().decode())


def test_document_upload_extracts_text_and_contextualizes(base):
    _, j = _req(f"{base}/api/projects", "POST", {"name": "Docs"})
    pid = j["project"]["id"]
    st, j = _upload_bytes(base, pid, "notes.txt", b"VFD overload fault F0004 on CV-101")
    assert st == 201 and j["extractor"] == "text" and j["chars"] > 0
    assert j["extractions"] >= 1  # deterministic contextualization fired
    _, ext = _req(f"{base}/api/projects/{pid}/extractions")
    assert any(e["tagName"] == "F0004" and "fault_code" in e["roles"]
               for e in ext["extractions"])


def test_image_upload_degrades_gracefully(base):
    # PNG with no Tesseract engine → extracted, zero text, a warning, but never a crash.
    from PIL import Image
    import io
    buf = io.BytesIO(); Image.new("RGB", (40, 20), "white").save(buf, format="PNG")
    _, j = _req(f"{base}/api/projects", "POST", {"name": "Scans"})
    pid = j["project"]["id"]
    st, j = _upload_bytes(base, pid, "scan.png", buf.getvalue())
    assert st == 201 and j["extractor"] == "image-ocr"
