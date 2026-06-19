"""Local HTTP server — static GUI + JSON API, all on 127.0.0.1.

Stdlib ``http.server`` only. The route table deliberately mirrors the Hub's
``/api/contextualization/*`` shape so the offline and online twins stay interchangeable. No auth,
no tenant — a desktop install is single-user and local.
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import engine, extract
from .store import Store

_RE_PROJECT = re.compile(r"^/api/projects/([0-9a-f]+)$")
_RE_SOURCES = re.compile(r"^/api/projects/([0-9a-f]+)/sources$")
_RE_EXTRACTIONS = re.compile(r"^/api/projects/([0-9a-f]+)/extractions$")
_RE_EXPORT = re.compile(r"^/api/projects/([0-9a-f]+)/export$")
_RE_DECISION = re.compile(r"^/api/extractions/([0-9a-f]+)$")

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
}


def make_handler(store: Store, gui_dir: str):
    class Handler(BaseHTTPRequestHandler):
        server_version = "MiraContextualizer/0.1"

        def log_message(self, *_a):  # quiet
            pass

        # ── helpers ──────────────────────────────────────────────────────────
        def _json(self, obj, status: int = 200) -> None:
            body = json.dumps(obj).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _err(self, msg: str, status: int) -> None:
            self._json({"error": msg}, status)

        def _read_json(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if not length:
                return {}
            try:
                return json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return {}

        def _static(self, path: str) -> None:
            rel = path.lstrip("/") or "index.html"
            full = os.path.normpath(os.path.join(gui_dir, rel))
            if not full.startswith(os.path.normpath(gui_dir)) or not os.path.isfile(full):
                self._err("not found", 404)
                return
            with open(full, "rb") as fh:
                data = fh.read()
            self.send_response(200)
            self.send_header("Content-Type", _CONTENT_TYPES.get(os.path.splitext(full)[1], "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        # ── verbs ────────────────────────────────────────────────────────────
        def do_GET(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            path, qs = parsed.path, urllib.parse.parse_qs(parsed.query)
            if not path.startswith("/api/"):
                self._static(path)
                return
            if path == "/api/projects":
                self._json({"projects": store.list_projects()})
                return
            m = _RE_PROJECT.match(path)
            if m:
                proj = store.get_project(m.group(1))
                if not proj:
                    self._err("project not found", 404)
                    return
                proj["sources"] = store.list_sources(m.group(1))
                self._json({"project": proj})
                return
            m = _RE_EXTRACTIONS.match(path)
            if m:
                self._json({"extractions": store.list_extractions(m.group(1))})
                return
            m = _RE_EXPORT.match(path)
            if m:
                self._export(m.group(1), (qs.get("format") or ["uns"])[0])
                return
            self._err("not found", 404)

        def do_POST(self) -> None:  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            if path == "/api/projects":
                body = self._read_json()
                try:
                    self._json({"project": store.create_project(body.get("name", ""), body.get("description"))}, 201)
                except ValueError as e:
                    self._err(str(e), 400)
                return
            m = _RE_SOURCES.match(path)
            if m:
                self._add_source(m.group(1))
                return
            self._err("not found", 404)

        def do_PATCH(self) -> None:  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            m = _RE_DECISION.match(path)
            if m:
                body = self._read_json()
                try:
                    row = store.set_extraction_status(m.group(1), body.get("status", ""))
                except ValueError as e:
                    self._err(str(e), 400)
                    return
                if not row:
                    self._err("extraction not found", 404)
                    return
                self._json({"extraction": row})
                return
            self._err("not found", 404)

        # ── handlers ───────────────────────────────────────────────────────────
        def _add_source(self, pid: str) -> None:
            if not store.get_project(pid):
                self._err("project not found", 404)
                return
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
            if ctype == "application/octet-stream":
                self._add_document(pid)
            else:
                self._add_plc_text(pid)

        def _add_plc_text(self, pid: str) -> None:
            body = self._read_json()
            file_name = (body.get("fileName") or "").strip()
            text = body.get("text")
            if not file_name:
                self._err("fileName is required", 400)
                return
            src = store.create_source(pid, engine.source_type_for(file_name), file_name)
            if engine.is_plc_text(file_name) and isinstance(text, str):
                try:
                    rows, _report = engine.extract_plc(file_name, text)
                    n = store.add_extractions(pid, src["id"], rows)
                    store.set_source_status(src["id"], "done")
                    self._json({"source": src, "extractions": n}, 201)
                except Exception as exc:  # noqa: BLE001 — record, don't crash the server
                    store.set_source_status(src["id"], "error", str(exc))
                    self._err("parse failed: %s" % exc, 500)
                return
            # A document posted as JSON without bytes — nothing to extract.
            store.set_source_status(src["id"], "pending", "post documents as application/octet-stream")
            self._json({"source": src, "extractions": 0, "note": "send document bytes as octet-stream"}, 201)

        def _add_document(self, pid: str) -> None:
            file_name = (self.headers.get("X-File-Name") or "").strip()
            if not file_name:
                self._err("X-File-Name header is required", 400)
                return
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            if not raw:
                self._err("empty upload", 400)
                return
            src = store.create_source(pid, engine.source_type_for(file_name), file_name)
            import os as _os  # noqa: PLC0415
            import tempfile  # noqa: PLC0415
            tmp = None
            try:
                with tempfile.NamedTemporaryFile(suffix=_os.path.splitext(file_name)[1],
                                                 delete=False) as tf:
                    tf.write(raw)
                    tmp = tf.name
                result = extract.extract(tmp, file_name)
            finally:
                if tmp and _os.path.exists(tmp):
                    _os.unlink(tmp)
            store.set_source_extraction(src["id"], result.to_dict())
            store.set_source_status(src["id"], "done" if result.full_text else "error",
                                    "; ".join(result.warnings) or None)
            self._json({
                "source": src, "extractor": result.extractor,
                "chars": len(result.full_text), "blocks": len(result.blocks),
                "warnings": result.warnings,
                # P2 turns this extracted text into UNS/role candidates.
                "extractions": 0, "note": "document extracted; contextualization lands in P2",
            }, 201)

        def _export(self, pid: str, fmt: str) -> None:
            if not store.get_project(pid):
                self._err("project not found", 404)
                return
            accepted = [e for e in store.list_extractions(pid) if e["status"] == "accepted"]
            if fmt == "uns":
                payload = [
                    {"tag": e["tagName"], "unsPath": e["unsPathProposed"], "roles": e["roles"],
                     "confidence": e["confidence"]}
                    for e in accepted if e["unsPathProposed"]
                ]
                self._json({"schema": "mira-contextualizer/uns@1", "signals": payload})
            else:
                self._err("unsupported format (P0 supports uns; i3x + bundle land in P4)", 400)

    return Handler


def serve(store: Store, gui_dir: str, host: str = "127.0.0.1", port: int = 0):
    """Start a threaded server. Returns (httpd, port); caller runs serve_forever or shutdown."""
    httpd = ThreadingHTTPServer((host, port), make_handler(store, gui_dir))
    return httpd, httpd.server_address[1]
