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

from . import bundle, ccw, contextualize, engine, extract, profile, scorecard
from .store import Store

_RE_PROJECT = re.compile(r"^/api/projects/([0-9a-f]+)$")
_RE_SOURCES = re.compile(r"^/api/projects/([0-9a-f]+)/sources$")
_RE_EXTRACTIONS = re.compile(r"^/api/projects/([0-9a-f]+)/extractions$")
_RE_EXPORT = re.compile(r"^/api/projects/([0-9a-f]+)/export$")
_RE_EXPORTS = re.compile(r"^/api/projects/([0-9a-f]+)/exports$")
_RE_SCORECARD = re.compile(r"^/api/projects/([0-9a-f]+)/scorecard$")
_RE_CCW_IMPORT = re.compile(r"^/api/projects/([0-9a-f]+)/ccw-import$")
_RE_DECISION = re.compile(r"^/api/extractions/([0-9a-f]+)$")


def _decode(data: bytes) -> str:
    """Decode a CCW file: most are UTF-8; .ccwsln is UTF-16 LE (BOM)."""
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16", errors="replace")
    return data.decode("utf-8", errors="replace")

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
}


def make_handler(store: Store, gui_dir: str, recents_path: str | None = None):
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
            if path == "/api/recents":
                self._json({"recents": profile.recents_load(recents_path) if recents_path else []})
                return
            m = _RE_EXPORTS.match(path)
            if m:
                if not store.get_project(m.group(1)):
                    self._err("project not found", 404)
                    return
                self._json({"exports": store.list_exports(m.group(1))})
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
            m = _RE_SCORECARD.match(path)
            if m:
                if not store.get_project(m.group(1)):
                    self._err("project not found", 404)
                    return
                self._json(scorecard.compute_scorecard(
                    store.list_extractions(m.group(1)), store.list_sources(m.group(1))))
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
            m = _RE_CCW_IMPORT.match(path)
            if m:
                self._ccw_import(m.group(1))
                return
            if path == "/api/profiles/open":
                self._open_profile()
                return
            self._err("not found", 404)

        def do_PATCH(self) -> None:  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            m = _RE_PROJECT.match(path)
            if m:
                if not store.get_project(m.group(1)):
                    self._err("project not found", 404)
                    return
                proj = store.set_profile(m.group(1), (self._read_json().get("identity") or {}))
                self._json({"project": proj})
                return
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
                self._add_text_source(pid)

        def _add_text_source(self, pid: str) -> None:
            body = self._read_json()
            file_name = (body.get("fileName") or "").strip()
            text = body.get("text")
            if not file_name:
                self._err("fileName is required", 400)
                return
            if not isinstance(text, str):
                self._err("text is required for a PLC/CCW source", 400)
                return
            src = store.create_source(pid, engine.source_type_for(file_name), file_name)
            # Unified deterministic analysis — handles L5X, CCW Modbus/LogicalValues, and returns a
            # human note for IDE-settings / unrecognized files (never a silent no-op).
            result = engine.analyze_text(file_name, text)
            # Fallback: a text file that isn't a PLC/CCW export is still run through document
            # contextualization (fault codes, params, catalog #s, tag refs) so "accept anything" works.
            if not result["rows"] and result["kind"] in ("unknown", "plc_unhandled"):
                rows = contextualize.contextualize_blocks(
                    [{"text": text, "kind": "text", "page": None}], file_name, store.plc_tag_names(pid))
                if rows or result["kind"] == "unknown":
                    result = {"kind": "document_text", "rows": rows,
                              "note": None if rows else "no recognized PLC tags or entities found"}
            n = store.add_extractions(pid, src["id"], result["rows"])
            store.set_source_status(
                src["id"], "error" if result["kind"] == "error" else "done", result.get("note"))
            self._json({"source": src, "extractions": n, "kind": result["kind"],
                        "note": result.get("note")}, 201)

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
            ir = result.to_dict()
            store.set_source_extraction(src["id"], ir)
            # Deterministic contextualization → candidates (fault codes, params, catalog #s,
            # manufacturers, and cross-references to the project's PLC tags).
            cands = contextualize.contextualize_blocks(
                ir["blocks"], file_name, store.plc_tag_names(pid))
            n = store.add_extractions(pid, src["id"], cands)
            store.set_source_status(src["id"], "done" if result.full_text else "error",
                                    "; ".join(result.warnings) or None)
            self._json({
                "source": src, "extractor": result.extractor,
                "chars": len(result.full_text), "blocks": len(result.blocks),
                "extractions": n, "warnings": result.warnings,
            }, 201)

        def _send_bytes(self, data: bytes, content_type: str, filename: str) -> None:
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % filename)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _ccw_import(self, pid: str) -> None:
            """Import a whole CCW project: JSON {files:[{name,text}], projectName} from a folder pick,
            or a zip (.ccwx / Controller_Backup.zip / zipped folder) as octet-stream. Parses every
            recognized file, merges into one deduped tag set + controller metadata."""
            if not store.get_project(pid):
                self._err("project not found", 404)
                return
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
            files: dict[str, str] = {}
            project_name = "CCW project"
            if ctype == "application/octet-stream":
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                import io  # noqa: PLC0415
                import zipfile  # noqa: PLC0415
                try:
                    zf = zipfile.ZipFile(io.BytesIO(raw))
                except Exception:  # noqa: BLE001
                    self._err("not a readable zip/.ccwx archive", 400)
                    return
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    base = os.path.basename(info.filename)
                    if ccw.is_ccw_project_file(base):
                        files[base] = _decode(zf.read(info))
                project_name = self.headers.get("X-Project-Name") or "CCW archive"
            else:
                body = self._read_json()
                for f in body.get("files") or []:
                    nm, tx = f.get("name"), f.get("text")
                    if nm and isinstance(tx, str) and ccw.is_ccw_project_file(nm):
                        files[os.path.basename(nm)] = tx
                project_name = (body.get("projectName") or "CCW project").strip() or "CCW project"

            if not files:
                self._err("no recognized CCW files found (need MbSrvConf.xml / LogicalValues.csv / "
                          ".st / .stf / .iecst / .ccwmod / RmcVariables)", 400)
                return
            result = ccw.parse_project(files)
            src = store.create_source(pid, "ccw", "%s (%d files)" % (project_name, len(files)))
            n = store.add_extractions(pid, src["id"], result["rows"])
            store.set_source_extraction(src["id"], {"meta": result["meta"], "files": result["files"]})
            store.set_source_status(src["id"], "done", "; ".join(result["notes"]) or None)
            self._json({"source": src, "extractions": n, "fileCount": len(files),
                        "controller": result["meta"].get("controller_model"),
                        "ip": result["meta"].get("ip"), "files": result["files"],
                        "notes": result["notes"]}, 201)

        def _open_profile(self) -> None:
            """Open a .miraprofile (raw JSON body) → restore into the store as a project."""
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                data = json.loads(_decode(raw))
                proj = profile.open_profile(store, data)
            except (ValueError, KeyError) as e:
                self._err("not a valid .miraprofile: %s" % e, 400)
                return
            if recents_path:
                profile.recents_add(recents_path, proj["name"] + profile.EXT, proj["name"])
            self._json({"project": proj}, 201)

        def _export(self, pid: str, fmt: str) -> None:
            proj = store.get_project(pid)
            if not proj:
                self._err("project not found", 404)
                return
            accepted = [e for e in store.list_extractions(pid) if e["status"] == "accepted"]
            if fmt == "uns":
                self._json({"schema": "mira-contextualizer/uns@1", "signals": [
                    {"tag": e["tagName"], "unsPath": e["unsPathProposed"], "roles": e["roles"],
                     "confidence": e["confidence"]} for e in accepted if e["unsPathProposed"]]})
            elif fmt == "i3x":
                self._json(bundle._i3x(accepted, project_id=pid))
            elif fmt in ("bundle", "bundle-sanitized"):
                sanitized = fmt == "bundle-sanitized"
                name = ("machine_context_sanitized.zip" if sanitized
                        else "machine_context_bundle.zip")
                data = bundle.zip_bytes(bundle.build_bundle(store, pid, sanitized=sanitized))
                store.add_export(pid, fmt, name,
                                 {"bytes": len(data), "accepted": sum(
                                     1 for e in store.list_extractions(pid) if e["status"] == "accepted")})
                self._send_bytes(data, "application/zip", name)
            elif fmt == "profile":
                data = json.dumps(profile.save_profile(store, pid), indent=2).encode("utf-8")
                store.add_export(pid, "profile", "%s%s" % (proj["name"], profile.EXT))
                if recents_path:
                    profile.recents_add(recents_path, proj["name"] + profile.EXT, proj["name"])
                self._send_bytes(data, "application/json",
                                 "%s%s" % (bundle._safe(proj["name"]), profile.EXT))
            else:
                self._err("unsupported format (uns | i3x | bundle | bundle-sanitized | profile)", 400)

    return Handler


def serve(store: Store, gui_dir: str, host: str = "127.0.0.1", port: int = 0,
          recents_path: str | None = None):
    """Start a threaded server. Returns (httpd, port); caller runs serve_forever or shutdown."""
    httpd = ThreadingHTTPServer((host, port), make_handler(store, gui_dir, recents_path))
    return httpd, httpd.server_address[1]
