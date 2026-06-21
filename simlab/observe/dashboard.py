"""Local observability + eval dashboard (pillars 1 + 2, viewing & control).

A single-file, dependency-light control panel over the observe layer. Loopback
only, no auth — a local dev/demo tool, not a deployed surface.

Two tabs:
  - Evals    — run an eval pack (button) and read the scorecard; list past reports.
  - History  — browse the real production answers exported from Langfuse
               (tools/langfuse_export.py output CSV), filter grounded vs ungrounded.

Run:
    python -m simlab.observe.dashboard                 # → http://127.0.0.1:8770
    MIRA_EXPORT_DIR=C:/Users/me/langfuse-export python -m simlab.observe.dashboard

Reads:  simlab/observe/reports/*.json  (eval reports)
        the newest traces-*.csv under MIRA_EXPORT_DIR (or ~/langfuse-export,
        or simlab/observe/../../tools/langfuse-export)
Writes: nothing except what run_eval already writes (reports + traces JSONL).
Never reaches a PLC; never writes back to Langfuse.
"""

from __future__ import annotations

import json
import logging
import os
import socketserver
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_REPORTS = _HERE / "reports"
_EVALPACKS = _HERE / "evalpacks"
_REPO_ROOT = _HERE.parents[1]

logger = logging.getLogger("mira.observe.dashboard")


def _export_dir() -> Path | None:
    """Resolve the Langfuse export dir (CSV history)."""
    candidates = [
        os.environ.get("MIRA_EXPORT_DIR"),
        str(Path.home() / "langfuse-export"),
        str(_REPO_ROOT / "tools" / "langfuse-export"),
    ]
    for c in candidates:
        if c and Path(c).is_dir():
            return Path(c)
    return None


def _newest_csv() -> Path | None:
    d = _export_dir()
    if not d:
        return None
    files = sorted(d.glob("traces-*.csv"))
    return files[-1] if files else None


def _list_packs() -> list[str]:
    return sorted(p.stem for p in _EVALPACKS.glob("*.yaml")) + sorted(
        p.stem for p in _EVALPACKS.glob("*.yml")
    )


def _list_reports() -> list[dict]:
    out = []
    for p in sorted(_REPORTS.glob("*.json"), reverse=True):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            out.append({
                "file": p.name,
                "pack": Path(d.get("pack", "")).stem,
                "mode": d.get("mode"),
                "generated_at": d.get("generated_at"),
                "summary": d.get("summary", {}),
            })
        except Exception as exc:  # noqa: BLE001
            logger.warning("bad report %s: %s", p.name, exc)
    return out


def _read_report(name: str) -> dict:
    p = _REPORTS / Path(name).name  # basename only — no traversal
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def _read_history(limit: int = 4000) -> dict:
    import csv  # noqa: PLC0415

    csv_path = _newest_csv()
    if not csv_path:
        return {"rows": [], "total": 0, "file": None}
    rows = []
    with csv_path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append(r)
    grounded = sum(1 for r in rows if (r.get("n_chunks") or "0") not in ("", "0", "0.0"))
    return {
        "rows": rows[:limit],
        "total": len(rows),
        "grounded": grounded,
        "file": csv_path.name,
        "truncated": len(rows) > limit,
    }


def _run_pack(pack: str, mode: str = "mock") -> dict:
    from simlab.observe import run_eval  # noqa: PLC0415

    if pack not in _list_packs():
        return {"error": f"unknown pack: {pack}"}
    try:
        return run_eval.run(pack, mode=mode)
    except Exception as exc:  # noqa: BLE001
        logger.exception("run failed")
        return {"error": str(exc)}


# --- HTTP ------------------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code: int = 200) -> None:
        body = json.dumps(obj, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, text: str) -> None:
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):  # quiet
        return

    def do_GET(self):  # noqa: N802
        from urllib.parse import parse_qs, urlparse

        u = urlparse(self.path)
        if u.path == "/":
            return self._html(_PAGE)
        if u.path == "/api/packs":
            return self._json({"packs": _list_packs()})
        if u.path == "/api/reports":
            return self._json({"reports": _list_reports()})
        if u.path == "/api/report":
            f = parse_qs(u.query).get("f", [""])[0]
            return self._json(_read_report(f))
        if u.path == "/api/history":
            return self._json(_read_history())
        return self._json({"error": "not found"}, 404)

    def do_POST(self):  # noqa: N802
        if self.path != "/api/run":
            return self._json({"error": "not found"}, 404)
        n = int(self.headers.get("Content-Length", 0) or 0)
        try:
            payload = json.loads(self.rfile.read(n) or b"{}")
        except Exception:  # noqa: BLE001
            payload = {}
        pack = payload.get("pack", "")
        mode = payload.get("mode", "mock")
        return self._json(_run_pack(pack, mode))


_PAGE = """<!doctype html><html><head><meta charset=utf-8>
<title>MIRA observe</title><style>
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#0f1117;color:#d6dae2}
header{padding:14px 20px;background:#161a23;border-bottom:1px solid #232838;font-weight:600}
header .tab{display:inline-block;margin-right:14px;padding:4px 10px;border-radius:6px;cursor:pointer;color:#9aa3b2}
header .tab.on{background:#232838;color:#fff}
main{padding:20px;max-width:1200px}
button{background:#2d6cdf;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit}
button.sec{background:#232838;color:#cfd6e4}
table{border-collapse:collapse;width:100%;margin-top:12px;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #1f2430;vertical-align:top}
th{color:#8a93a6;font-weight:600;position:sticky;top:0;background:#0f1117}
.pass{color:#3fb950}.fail{color:#f85149}.part{color:#d29922}
.pill{display:inline-block;padding:1px 7px;border-radius:10px;font-size:12px;background:#232838}
.muted{color:#737d8f}.row:hover{background:#161a23}
input,select{background:#161a23;color:#d6dae2;border:1px solid #232838;border-radius:6px;padding:5px 8px;font:inherit}
.summary{margin:10px 0;padding:10px 12px;background:#161a23;border-radius:8px;border:1px solid #232838}
.bar{height:8px;border-radius:4px;background:#232838;overflow:hidden;display:inline-block;width:120px;vertical-align:middle}
.bar>i{display:block;height:100%;background:#3fb950}
</style></head><body>
<header>MIRA · observe
 <span class=tab id=t-evals onclick=show('evals')>Evals</span>
 <span class=tab id=t-history onclick=show('history')>History</span>
</header><main>
<section id=evals>
 <div><b>Run a pack:</b> <span id=packs></span> <span id=running class=muted></span></div>
 <div id=scorecard></div>
 <h3>Past reports</h3><div id=reports></div>
</section>
<section id=history style=display:none>
 <div id=hsum class=summary>loading…</div>
 <label>filter <select id=hfilter onchange=renderHistory()>
  <option value=all>all</option><option value=grounded>grounded only</option>
  <option value=ungrounded>ungrounded only</option></select></label>
 <input id=hq placeholder="search question…" oninput=renderHistory() style=width:260px>
 <div id=htable></div>
</section>
</main><script>
let HIST=null;
function show(t){for(const x of ['evals','history']){document.getElementById(x).style.display=x==t?'':'none';
 document.getElementById('t-'+x).className='tab'+(x==t?' on':'')}if(t=='history'&&!HIST)loadHistory()}
show('evals');
async function j(u,o){const r=await fetch(u,o);return r.json()}
async function loadPacks(){const d=await j('/api/packs');document.getElementById('packs').innerHTML=
 d.packs.map(p=>`<button onclick="runPack('${p}')">${p}</button>`).join(' ')}
async function runPack(p){document.getElementById('running').textContent='running '+p+'…';
 const rep=await j('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pack:p})});
 document.getElementById('running').textContent='';renderReport(rep);loadReports()}
function pct(x){return Math.round((x||0)*100)+'%'}
function renderReport(rep){if(rep.error){document.getElementById('scorecard').innerHTML='<div class=fail>'+rep.error+'</div>';return}
 const s=rep.summary||{};let h=`<div class=summary><b>${Path(rep.pack)}</b> · ${rep.mode}
  · <span class=pass>PASS ${s.passed}</span> <span class=part>PART ${s.partial}</span> <span class=fail>FAIL ${s.failed}</span>
  · asset ${pct(s.asset_selection_accuracy)} · points ${pct(s.answer_points_coverage)} · gov-fails ${s.governance_failures}</div>`;
 h+='<table><tr><th>status<th>id<th>asset<th>retr<th>cite<th>pts<th>warnings</tr>';
 for(const it of rep.items||[]){const c=it.status=='pass'?'pass':it.status=='fail'?'fail':'part';
  h+=`<tr class=row><td class=${c}>${it.status.toUpperCase()}<td>${it.id}<td>${it.asset_hit?'Y':'n'}
   <td>${pct(it.retrieval_accuracy)}<td>${pct(it.citation_coverage)}<td>${pct(it.points_coverage)}
   <td class=muted>${(it.warnings||[]).join(', ')||'-'}</tr>`}
 document.getElementById('scorecard').innerHTML=h+'</table>'}
function Path(p){return (p||'').split(/[\\\\/]/).pop().replace(/\\.(ya?ml|json)$/,'')}
async function loadReports(){const d=await j('/api/reports');
 document.getElementById('reports').innerHTML='<table><tr><th>pack<th>mode<th>when<th>pass/part/fail</tr>'+
  d.reports.map(r=>{const s=r.summary||{};return `<tr class=row onclick='openReport("${r.file}")' style=cursor:pointer>
   <td>${r.pack}<td>${r.mode}<td class=muted>${(r.generated_at||'').slice(0,19).replace('T',' ')}
   <td><span class=pass>${s.passed||0}</span>/<span class=part>${s.partial||0}</span>/<span class=fail>${s.failed||0}</span></tr>`}).join('')+'</table>'}
async function openReport(f){renderReport(await j('/api/report?f='+encodeURIComponent(f)))}
async function loadHistory(){HIST=await j('/api/history');renderHistory()}
function renderHistory(){if(!HIST)return;const f=document.getElementById('hfilter').value,
 q=document.getElementById('hq').value.toLowerCase();
 let rows=HIST.rows.filter(r=>{const g=!['','0','0.0'].includes(r.n_chunks);
  if(f=='grounded'&&!g)return false;if(f=='ungrounded'&&g)return false;
  if(q&&!(r.question||'').toLowerCase().includes(q))return false;return true});
 const gp=HIST.total?Math.round(100*HIST.grounded/HIST.total):0;
 document.getElementById('hsum').innerHTML=`<b>${HIST.total}</b> real answers (${HIST.file}) ·
  grounded <b>${gp}%</b> <span class=bar><i style=width:${gp}%></i></span> ·
  showing ${rows.length}${HIST.truncated?' (capped)':''}`;
 let h='<table><tr><th>when<th>machine<th>question<th>answer<th>ms<th>chunks</tr>';
 for(const r of rows.slice(0,1000)){const g=!['','0','0.0'].includes(r.n_chunks);
  h+=`<tr class=row><td class=muted>${(r.timestamp||'').slice(0,16).replace('T',' ')}<td>${r.machine||''}
   <td>${esc(r.question)}<td class=muted>${esc((r.answer_preview||'').slice(0,120))}
   <td>${Math.round(r.latency_ms||0)}<td class="${g?'pass':'fail'}">${r.n_chunks}</tr>`}
 document.getElementById('htable').innerHTML=h+'</table>'}
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
loadPacks();loadReports();
</script></body></html>"""


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if str(_REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(_REPO_ROOT))
    port = int(os.environ.get("MIRA_DASHBOARD_PORT", "8770"))
    _REPORTS.mkdir(parents=True, exist_ok=True)

    class _Server(socketserver.ThreadingMixIn, __import__("http.server", fromlist=["HTTPServer"]).HTTPServer):
        daemon_threads = True

    srv = _Server(("127.0.0.1", port), _Handler)  # loopback only — never 0.0.0.0
    ex = _export_dir()
    logger.info("observe dashboard → http://127.0.0.1:%d  (export dir: %s)", port, ex or "none found")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
