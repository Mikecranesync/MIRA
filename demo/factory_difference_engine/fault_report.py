"""
fault_report.py — fault-centered static readout (Fault Intelligence, Phase 2c).
=================================================================================
Renders a Fault Intelligence Bundle (from fault_bundle.build_fault_bundle) into a
self-contained HTML report centered on ONE fault:

  Fault observed -> what it means -> what changed -> evidence -> check first -> what's missing

Mirrors the Flight Recorder Report styling but is standalone (own inline CSS) so it
carries no dependency on the Phase-1 flight_report. Pure/deterministic/offline:
no network, DB, cloud, live LLM, or clock. See
docs/discovery/fault_intelligence_from_flight_recorder_plan.md.
"""
from __future__ import annotations

import html
from typing import Any

_CSS = """
:root{--bg:#f8fafc;--surface:#fff;--border:#e2e8f0;--text:#0f172a;--muted:#64748b;
--brand:#2563eb;--ok:#16a34a;--warn:#d97706;--crit:#dc2626;--ok-bg:#dcfce7;
--warn-bg:#fef3c7;--crit-bg:#fee2e2;--radius:12px;--shadow:0 1px 4px rgba(0,0,0,.08);}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);line-height:1.55}
.page{max-width:900px;margin:0 auto;padding:16px}
.header{background:var(--brand);color:#fff;border-radius:var(--radius);padding:22px 26px;margin-bottom:14px}
.header h1{font-size:clamp(1.1rem,3.6vw,1.55rem);font-weight:700}
.header .meta{opacity:.85;font-size:.85rem;margin-top:6px}
.badge{display:inline-block;font-weight:700;font-size:.72rem;padding:3px 10px;border-radius:99px;text-transform:uppercase;letter-spacing:.04em}
.b-ok{background:var(--ok-bg);color:var(--ok)}.b-warn{background:var(--warn-bg);color:var(--warn)}.b-crit{background:var(--crit-bg);color:var(--crit)}.b-muted{background:#f1f5f9;color:var(--muted)}
.section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px;box-shadow:var(--shadow);margin-bottom:12px}
.section h2{font-size:1rem;font-weight:600;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.card{border:1px solid var(--border);border-left:4px solid var(--warn);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:var(--surface)}
.card .sig{font-weight:600}.card .det{font-size:.82rem;color:var(--muted);margin-top:5px}
.bvc{font-size:.85rem;margin-top:8px}.bvc b{color:var(--text)}
ul{margin:6px 0 0 20px}li{font-size:.88rem;margin:3px 0}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.chip{background:#eef2ff;color:#3730a3;font-size:.75rem;padding:3px 9px;border-radius:99px}
.miss{background:var(--warn-bg);border:1px solid #fde68a;border-radius:8px;padding:8px 12px;font-size:.85rem;margin-top:6px}
.foot,.caveat{color:var(--muted);font-size:.8rem;margin-top:6px}
p{font-size:.9rem}
"""

_CORR_BADGE = {
    "corroborated": ("b-crit", "CORROBORATED BY LIVE DIFFERENCES"),
    "uncorroborated": ("b-warn", "NAMED BUT NOT CORROBORATED"),
    "no_referenced_tags": ("b-muted", "NO REFERENCED TAGS"),
    "fault_not_found": ("b-muted", "FAULT CODE NOT FOUND"),
}


def _e(v: Any) -> str:
    return html.escape(str(v), quote=True)


def _sev_cls(sev: str) -> str:
    s = (sev or "").upper()
    return "b-crit" if s in ("FAULT", "CRITICAL") else ("b-warn" if s == "WARN" else "b-muted")


def _checks(text: str) -> str:
    parts = [p.strip(" .") for chunk in (text or "").split(";") for p in chunk.split(". ")]
    parts = [p for p in parts if p]
    if not parts:
        return "<p class='caveat'>No recommended action recorded.</p>"
    return "<ul>%s</ul>" % "".join("<li>%s</li>" % _e(p) for p in parts)


def render_fault_report(fault_bundle: dict) -> str:
    """Render a Fault Intelligence Bundle into a self-contained HTML string. Deterministic."""
    b = fault_bundle
    f = b.get("fault", {})
    asset = b.get("asset", {})
    corr = b.get("corroboration", "fault_not_found")
    corr_cls, corr_txt = _CORR_BADGE.get(corr, ("b-muted", corr.upper()))
    found = f.get("found")

    parts = ["<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>"
             "<meta name='viewport' content='width=device-width,initial-scale=1'>"
             "<title>Fault Intelligence — %s</title><style>%s</style></head><body><div class='page'>"
             % (_e(f.get("code", "")), _CSS)]

    # header
    parts.append(
        "<div class='header' data-section='fault-header'><h1>Fault Intelligence — %s %s</h1>"
        "<div class='meta'>%s / asset <b>%s</b> (%s) / scenario <b>%s</b> &nbsp; "
        "<span class='badge %s'>%s</span> <span class='badge %s'>%s</span></div></div>"
        % (_e(f.get("code", "")), _e(f.get("label", "") if found else "(unknown code)"),
           _e(asset.get("line", "")), _e(asset.get("asset_tag", "")), _e(asset.get("backing_asset", "")),
           _e(b.get("scenario", "")), _sev_cls(f.get("severity", "")), _e(f.get("severity", "-")),
           corr_cls, corr_txt))

    # 1. what it means
    if found:
        means = "<p><b>Meaning:</b> %s</p><p style='margin-top:6px'><b>Likely cause:</b> %s</p>" \
            % (_e(f.get("meaning", "")), _e(f.get("likely_cause", "")))
    else:
        means = "<p class='caveat'>Fault code <b>%s</b> was not found in the manuals for this asset.</p>" % _e(f.get("code", ""))
    parts.append("<div class='section' data-section='what-it-means'><h2>Fault observed — what it means</h2>%s</div>" % means)

    # 2. what changed (corroboration + difference cards)
    matched = b.get("matched_tags", [])
    if matched:
        cards = []
        for m in matched:
            bvc = m.get("baseline_vs_current")
            bvc_html = ""
            if bvc:
                bvc_html = ("<div class='bvc'>normal <b>%s&ndash;%s</b>, now <b>%s</b> "
                            "<span class='badge b-crit'>%s</span></div>"
                            % (_e(bvc["normal_lo"]), _e(bvc["normal_hi"]), _e(bvc["current"]), _e(bvc["status"])))
            det = "; ".join(o.get("detail", "") for o in m.get("observations", []))
            cards.append("<div class='card'><div class='sig'>%s</div><div class='det'>%s</div>%s</div>"
                         % (_e(m["tag"]), _e(det), bvc_html))
        changed = "<p><span class='badge %s'>%s</span> — the fault's referenced signals ARE abnormal in this event:</p>%s" \
            % (corr_cls, corr_txt, "".join(cards))
    elif found:
        changed = ("<p><span class='badge %s'>%s</span> — the fault is named in the manual, but its "
                   "referenced signals are not abnormal in this event, so the live data does not confirm it.</p>"
                   % (corr_cls, corr_txt))
    else:
        changed = "<p class='caveat'>No fault to correlate.</p>"
    parts.append("<div class='section' data-section='what-changed'><h2>What changed (corroboration)</h2>%s</div>" % changed)

    # 3. evidence & citations
    corro = b.get("corroborating_tags", [])
    cites = b.get("cited_sources", [])
    parts.append(
        "<div class='section' data-section='evidence-citations'><h2>Evidence &amp; citations</h2>"
        "<p><b>Corroborating PLC signals:</b></p><div class='chips'>%s</div>"
        "<p style='margin-top:10px'><b>Cited sources:</b></p><div class='chips'>%s</div></div>"
        % ("".join("<span class='chip'>%s</span>" % _e(t) for t in corro) or "<span class='caveat'>none</span>",
           "".join("<span class='chip'>%s</span>" % _e(c) for c in cites) or "<span class='caveat'>none</span>"))

    # 4. what to check first
    parts.append("<div class='section' data-section='check-first'><h2>What to check first</h2>%s</div>"
                 % _checks(b.get("suggested_checks", "")))

    # 5. what data is missing
    miss = b.get("missing_evidence", [])
    normal = b.get("referenced_present_but_normal", [])
    absent = b.get("referenced_absent_from_asset", [])
    miss_html = ""
    for m in miss:
        miss_html += "<div class='miss'>Fault references <b>%s</b> — no such signal exists to corroborate it (suggested: <code>%s</code>).</div>" \
            % (_e(m.get("category", "")), _e(m.get("suggested_signal", "")))
    extras = []
    if normal:
        extras.append("<p class='foot'>Referenced but normal in this event: %s</p>" % _e(", ".join(normal)))
    if absent:
        extras.append("<p class='foot'>Referenced but not a signal on this asset: %s</p>" % _e(", ".join(absent)))
    if not (miss_html or extras):
        miss_html = "<p class='caveat'>All referenced signals were available; nothing missing for this fault.</p>"
    parts.append("<div class='section' data-section='data-missing'><h2>What data is missing</h2>%s%s</div>"
                 % (miss_html, "".join(extras)))

    # 6. review preview
    parts.append(
        "<div class='section' data-section='review-preview'><h2>Review (accept / reject / escalate)</h2>"
        "<p>Review state: <span class='badge b-warn'>%s</span></p>"
        "<p class='foot'>A technician accepts, rejects, or escalates this explanation in the Hub review queue; "
        "an accepted fix becomes future context. This static report is a preview.</p></div>"
        % _e(b.get("review_state", "pending")))

    parts.append(
        "<div class='section' data-section='caveats'><h2>Caveats</h2>"
        "<div class='caveat'>&bull; CV-200 / Northwind is a display alias over the SimLab asset (real deterministic data).</div>"
        "<div class='caveat'>&bull; Corroboration is scenario-scoped: a fault is confirmed only when its signals are abnormal in this event.</div>"
        "<div class='caveat'>&bull; Deep VFD/drive faults need richer signals (see the data-richness audit); this sim is process/state-rich.</div></div>")

    parts.append("</div></body></html>")
    return "".join(parts)


def write_fault_report(fault_bundle: dict, path: str) -> str:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(render_fault_report(fault_bundle))
    return path


def _main(argv=None) -> int:
    import argparse
    from .fault_bundle import build_fault_bundle_for_scenario
    ap = argparse.ArgumentParser(description="Fault-centered static report (deterministic, offline)")
    ap.add_argument("--code", default="F007")
    ap.add_argument("--scenario", default="A")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--html", metavar="PATH", help="write the report to PATH instead of stdout")
    args = ap.parse_args(argv)
    bundle = build_fault_bundle_for_scenario(args.code, args.scenario, args.seed)
    if args.html:
        print("Fault Intelligence Report written to:", write_fault_report(bundle, args.html))
    else:
        print(render_fault_report(bundle))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
