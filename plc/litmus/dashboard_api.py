"""
CV-101 dashboard adapter -- bench-local, read-only, zero-dependency HTTP service.
=================================================================================
Serves the SAME context/capability contract the CLI already produces
(demo_context_model.build_contract) so the Ignition Perspective dashboard can show:
  * Trends tab   -> which signals actually exist, and which are UNAVAILABLE (honest).
  * Ask MIRA     -> grounded answer + evidence + what tests are valid + claim boundary.

It reuses demo_context_model; it does NOT re-implement the context model. Mirrors the
proven bench pattern of plc/conv_simple_anomaly/trend_historian.py (a local HTTP service a
Perspective `webBrowser` component iframes). Guardrails:
  * read-only: only calls run_demo(write=False); never writes a PLC register.
  * no Litmus internal :8094; no cloud; no third-party deps (stdlib http.server + json).
  * replay is the default source (demo reliability); --source plc reuses the existing read.

    python plc/litmus/dashboard_api.py            # serves on 127.0.0.1:8770 (replay default)
    curl http://127.0.0.1:8770/api/demo/cv101/context
    curl http://127.0.0.1:8770/api/demo/cv101/capabilities
    curl -X POST http://127.0.0.1:8770/api/demo/cv101/ask

Perspective wiring (see docs/demo/cv101_perspective_dashboard_demo.md):
  * Ask MIRA panel  webBrowser.source -> http://127.0.0.1:8770/ask
  * Trends honesty  webBrowser.source -> http://127.0.0.1:8770/trends  (keep the historian chart too)
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import demo_context_model as demo  # noqa: E402  -- the single source of truth

HOST = os.getenv("DASHBOARD_API_HOST", "127.0.0.1")
PORT = int(os.getenv("DASHBOARD_API_PORT", "8770"))
_ALLOWED_SOURCES = ("replay", "plc")
# the existing bench trend historian (plc/conv_simple_anomaly/trend_historian.py). The /trends
# page REUSES this live chart via an iframe -- honesty tables below it do NOT depend on it.
TREND_VIEWER_URL = os.getenv("TREND_VIEWER_URL", "http://127.0.0.1:8766/viewer/index.html?source=historian")


# --------------------------------------------------------------------------- #
# contract assembly (reuses the CLI; never re-implements the context model)
# --------------------------------------------------------------------------- #
def build_payload(source="replay", fixture="cv101_idle_healthy", timestamp=None):
    if source not in _ALLOWED_SOURCES:
        source = "replay"
    r = demo.run_demo(source, fixture, write=False)
    return demo.build_contract(r, timestamp=timestamp)


def _json(status, obj):
    return status, "application/json; charset=utf-8", json.dumps(obj, indent=2)


def _html(status, body):
    return status, "text/html; charset=utf-8", body


# --------------------------------------------------------------------------- #
# routing (pure function -> unit-testable without binding a socket)
# --------------------------------------------------------------------------- #
def route(method, path, query, timestamp=None):
    """Return (status_code, content_type, body_str). Read-only; never touches a PLC write."""
    source = (query.get("source", ["replay"])[0] if isinstance(query.get("source"), list)
              else query.get("source", "replay"))
    fixture = (query.get("fixture", ["cv101_idle_healthy"])[0] if isinstance(query.get("fixture"), list)
               else query.get("fixture", "cv101_idle_healthy"))

    if path == "/health":
        return _json(200, {"ok": True, "service": "cv101-dashboard-adapter",
                           "sources": list(_ALLOWED_SOURCES), "default_source": "replay"})

    # data routes need the contract; a live-PLC read may be unreachable -> 503, not a crash.
    if path in ("/api/demo/cv101/context", "/api/demo/cv101/capabilities",
                "/api/demo/cv101/ask", "/", "/trends", "/index.html"):
        try:
            c = build_payload(source, fixture, timestamp=timestamp)
        except (OSError, IOError) as e:
            return _json(503, {"error": "source_unreachable", "source": source,
                               "hint": "PLC not reachable; use ?source=replay for the offline demo",
                               "detail": str(e)[:160]})

    if path == "/api/demo/cv101/context":
        return _json(200, c)
    if path == "/api/demo/cv101/capabilities":
        return _json(200, {"asset_id": c["asset_id"], "source": c["source"],
                           "timestamp": c["timestamp"], "capability_matrix": c["capability_matrix"],
                           "trend_signals": c["trend_signals"]})
    if path == "/api/demo/cv101/ask":
        return _json(200, {"asset_id": c["asset_id"], "source": c["source"],
                           "timestamp": c["timestamp"], "answer": c["answer"],
                           "mapped_signals": c["mapped_signals"], "declined_signals": c["declined_signals"],
                           "generated_tests": c["generated_tests"], "skipped_tests": c["skipped_tests"],
                           "claim_boundary": c["claim_boundary"]})
    if path in ("/", "/trends", "/index.html"):
        return _html(200, _trends_html(c))
    if path == "/ask":
        return _html(200, _ask_html(source, fixture))
    return _json(404, {"error": "not_found", "path": path})


# --------------------------------------------------------------------------- #
# minimal, honest HTML panels (muted normal; state = color; no CDN)
# --------------------------------------------------------------------------- #
_CSS = ("body{font:14px system-ui,Segoe UI,Arial;margin:14px;color:#1b1f24;background:#f6f7f9}"
        "h2{margin:0 0 2px}h3{margin:16px 0 6px}.sub{color:#5b6570;font-size:12px;margin-bottom:8px}"
        "table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e2e5e9}"
        "th,td{border:1px solid #e2e5e9;padding:5px 8px;text-align:left;font-size:13px}"
        "th{background:#eef1f4}.ok{color:#1f7a37}.na{color:#8a939c}.warn{color:#b5480a}"
        ".pill{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px}"
        ".pna{background:#eceff1;color:#5b6570}.pok{background:#e6f2ea;color:#1f7a37}"
        "button{font:14px system-ui;padding:6px 12px;border:1px solid #c7ccd2;border-radius:6px;"
        "background:#fff;cursor:pointer}pre{white-space:pre-wrap}")


def _trends_html(c):
    rows_a = "".join(
        "<tr><td>%s</td><td class=ok>%s</td><td>%s</td><td>%s</td><td><span class='pill pok'>%s</span></td></tr>"
        % (t["signal"], t["display"], t.get("unit") or "-", t["component"],
           "approved" if t.get("approved") else "mapped")
        for t in c["trend_signals"]["available"])
    rows_u = "".join(
        "<tr><td>%s</td><td class=na>unavailable / not mapped</td><td>%s</td></tr>"
        % (t["signal"], t["reason"]) for t in c["trend_signals"]["unavailable"])
    return ("<!doctype html><meta charset=utf-8><title>CV-101 Trends (honest)</title><style>%s</style>"
            "<h2>CV-101 &mdash; trend signals</h2>"
            "<div class=sub>source: %s &middot; the dashboard shows what actually exists, and says "
            "plainly what does not.</div>"
            "<h3>Available (live / replay)</h3>"
            "<table><tr><th>signal</th><th>latest</th><th>unit</th><th>component</th><th>mapping</th></tr>%s</table>"
            "<h3>Unavailable / not mapped &mdash; NOT hidden</h3>"
            "<table><tr><th>signal</th><th>status</th><th>why</th></tr>%s</table>"
            "<div class=sub style='margin-top:10px'>Time-series drift/spike detection: %s.</div>"
            "<h3>Live trend chart</h3>"
            "<div class=sub>Reuses the existing bench historian (read-only) at %s. If blank, start "
            "the historian; the honesty tables above do not depend on it.</div>"
            "<iframe src='%s' style='width:100%%;height:340px;border:1px solid #e2e5e9;background:#fff'></iframe>"
            % (_CSS, c["source"], rows_a, rows_u,
               "available" if c["is_timeseries"] else "unavailable (single snapshot)",
               TREND_VIEWER_URL, TREND_VIEWER_URL))


def _ask_html(source, fixture):
    # static page; fetches the same adapter's /ask JSON (same origin -> no CORS) and renders it.
    api = "/api/demo/cv101/ask?source=%s&fixture=%s" % (source, fixture)
    return ("<!doctype html><meta charset=utf-8><title>Ask MIRA (bench)</title><style>%s</style>"
            "<h2>Ask MIRA &mdash; CV-101 <span class='pill pna'>bench / local</span></h2>"
            "<div class=sub>Grounded in the approved context model. Same source of truth as the "
            "capability matrix. No cloud, no Litmus :8094.</div>"
            "<button onclick='ask()'>Why is CV-101 stopped?</button>"
            "<div id=out style='margin-top:12px'></div>"
            "<script>"
            "async function ask(){"
            " const o=document.getElementById('out'); o.textContent='...';"
            " try{const r=await fetch('%s'); const d=await r.json();"
            "  let h='<h3>Answer</h3><pre>'+esc(d.answer.summary)+'</pre>';"
            "  h+='<h3>Evidence used (mapped signals)</h3><ul>';"
            "  d.mapped_signals.forEach(s=>h+='<li>'+esc(s.signal)+' = '+esc(s.display)+' <span class=na>['+esc(s.source)+']</span></li>');"
            "  h+='</ul><h3>Declined signals</h3><ul>';"
            "  d.declined_signals.forEach(s=>h+='<li class=na>'+esc(s.signal||'')+' &mdash; '+esc(s.reason||'')+'</li>');"
            "  h+='</ul><h3>Valid tests</h3><ul>';"
            "  d.generated_tests.forEach(t=>h+='<li class=ok>'+esc(t.name)+'</li>');"
            "  h+='</ul><h3>Skipped tests</h3><ul>';"
            "  d.skipped_tests.forEach(t=>h+='<li class=na>'+esc(t.name)+' &mdash; '+esc(t.reason)+'</li>');"
            "  h+='</ul><h3>MIRA will NOT claim</h3><ul>';"
            "  d.claim_boundary.forEach(b=>h+='<li class=warn>'+esc(b)+'</li>');"
            "  h+='</ul>'; o.innerHTML=h;"
            " }catch(e){o.textContent='adapter error: '+e}"
            "}"
            "function esc(s){return (s==null?'':String(s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}"
            "</script>" % (_CSS, api))


# --------------------------------------------------------------------------- #
# http server (thin wrapper over route())
# --------------------------------------------------------------------------- #
class _Handler(BaseHTTPRequestHandler):
    server_version = "cv101-dashboard/1.0"

    def _dispatch(self, method):
        u = urlparse(self.path)
        status, ctype, body = route(method, u.path, parse_qs(u.query))
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        # /ask accepts POST too (dashboards may POST); body is ignored -- read-only.
        self._dispatch("POST")

    def log_message(self, *a):  # quiet
        pass


def main():
    httpd = ThreadingHTTPServer((HOST, PORT), _Handler)
    print("CV-101 dashboard adapter (read-only) on http://%s:%d  [replay default, no cloud]" % (HOST, PORT))
    print("  /health  /api/demo/cv101/{context,capabilities,ask}  /trends  /ask")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
