"""
flight_report.py — Layer-2 readout: render the Factory Difference Engine's
deterministic JSON into a self-contained HTML "Flight Recorder Report".
=================================================================
This is ONLY the human-readable readout (see
docs/prd/factorylm_flight_recorder_black_box_prd.md). It builds NOTHING else:
no capture engine, historian, trace store, Hub page, DB, PDF, or live adapter —
those already exist or are in PR #2335 and are reused/referenced, not rebuilt.

Pure function of `run_pipeline()` output: no network, no DB, no cloud, no LLM,
no wall-clock. Deterministic — two renders of the same pipeline result are
byte-identical (there is intentionally no generated-at timestamp; provenance is
the scenario + seed). CSS palette mirrors docs/sample-reports/weekly-digest/.
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
.header{background:var(--brand);color:#fff;border-radius:var(--radius);padding:24px 28px;margin-bottom:16px}
.header h1{font-size:clamp(1.2rem,4vw,1.7rem);font-weight:700}
.header .meta{opacity:.85;font-size:.85rem;margin-top:6px}
.badge{display:inline-block;font-weight:700;font-size:.72rem;padding:3px 10px;border-radius:99px;text-transform:uppercase;letter-spacing:.04em}
.b-ok{background:var(--ok-bg);color:var(--ok)}.b-warn{background:var(--warn-bg);color:var(--warn)}.b-crit{background:var(--crit-bg);color:var(--crit)}.b-muted{background:#f1f5f9;color:var(--muted)}
.status-bar{display:inline-block;font-weight:700;font-size:.9rem;padding:6px 14px;border-radius:99px;margin-bottom:10px}
.status-ok{background:var(--ok-bg);color:var(--ok)}.status-warn{background:var(--warn-bg);color:var(--warn)}.status-crit{background:var(--crit-bg);color:var(--crit)}
.section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);margin-bottom:14px}
.section h2{font-size:1rem;font-weight:600;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.metrics{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.metric{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px}
.metric .n{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.metric .v{font-size:1.4rem;font-weight:700;margin-top:4px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.card{border:1px solid var(--border);border-left:4px solid var(--warn);border-radius:10px;padding:14px;background:var(--surface)}
.card .sig{font-weight:600;font-size:.9rem}.card .det{font-size:.82rem;color:var(--muted);margin-top:6px}
.card .kv{font-size:.8rem;margin-top:8px}.card .kv b{color:var(--text)}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{background:var(--bg);color:var(--muted);font-weight:600;text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)}
td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
.bar{position:relative;height:14px;background:#f1f5f9;border-radius:7px;overflow:hidden;min-width:120px}
.bar .band{position:absolute;top:0;height:100%;background:var(--ok-bg)}
.bar .cur{position:absolute;top:-2px;width:3px;height:18px;background:var(--crit)}
.tl{list-style:none}.tl li{padding:8px 0 8px 16px;border-left:2px solid var(--border);position:relative}
.tl li:before{content:"";position:absolute;left:-6px;top:12px;width:10px;height:10px;border-radius:50%;background:var(--warn)}
.tl .t{font-weight:700;font-size:.8rem;color:var(--brand)}.tl .d{font-size:.82rem;color:var(--muted)}
.answer{white-space:pre-wrap;font-size:.88rem;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.chip{background:#eef2ff;color:#3730a3;font-size:.75rem;padding:3px 9px;border-radius:99px}
.foot{color:var(--muted);font-size:.78rem;margin-top:8px}
.caveat{font-size:.82rem;color:var(--muted);padding:6px 0}
"""


def _e(v: Any) -> str:
    return html.escape(str(v), quote=True)


def _bare(uns: str) -> str:
    return str(uns).split(".")[-1]


def _line_after(answer: str, prefix: str) -> str:
    for line in (answer or "").splitlines():
        s = line.strip()
        if s.startswith(prefix):
            return s[len(prefix):].strip()
    return ""


def _diff_cards(observations: list) -> str:
    if not observations:
        return "<p class='caveat'>No differences detected.</p>"
    out = ["<div class='cards'>"]
    for o in observations:
        exp = o.get("expected")
        mag = o.get("magnitude")
        out.append(
            "<div class='card'><div class='sig'>%s "
            "<span class='badge b-warn'>%s</span></div>"
            "<div class='det'>%s</div>"
            "<div class='kv'>now <b>%s</b>%s%s</div></div>"
            % (
                _e(_bare(o.get("signal", ""))),
                _e(o.get("kind", "")),
                _e(o.get("detail", "")),
                _e(o.get("value")),
                (" &middot; normal <b>%s</b>" % _e(exp)) if exp is not None else "",
                (" &middot; off by <b>%s</b>" % _e(round(mag, 3))) if isinstance(mag, (int, float)) else "",
            )
        )
    out.append("</div>")
    return "".join(out)


def _timeline(observations: list) -> str:
    dated = [o for o in observations if o.get("ts") is not None]
    if not dated:
        return "<p class='caveat'>No timed observations in this event.</p>"
    t0 = min(o["ts"] for o in dated)
    rows = sorted(dated, key=lambda o: (o["ts"], _bare(o.get("signal", ""))))
    out = ["<ul class='tl'>"]
    for o in rows:
        out.append(
            "<li><span class='t'>T+%ss</span> <span class='d'>%s &mdash; %s</span></li>"
            % (_e(int(o["ts"] - t0)), _e(_bare(o.get("signal", ""))), _e(o.get("detail", "")))
        )
    out.append("</ul>")
    return "".join(out)


def _baseline_table(observations: list) -> str:
    rows = [o for o in observations if o.get("kind") == "OUT_OF_BASELINE"
            and isinstance(o.get("expected"), (list, tuple)) and len(o["expected"]) == 2]
    if not rows:
        return "<p class='caveat'>No range-based baselines in this event.</p>"
    body = []
    for o in rows:
        lo, hi = float(o["expected"][0]), float(o["expected"][1])
        try:
            cur = float(o.get("value"))
        except (TypeError, ValueError):
            continue
        span_lo, span_hi = min(lo, cur), max(hi, cur)
        rng = (span_hi - span_lo) or 1.0
        band_l = round((lo - span_lo) / rng * 100, 1)
        band_w = round((hi - lo) / rng * 100, 1)
        cur_l = round((cur - span_lo) / rng * 100, 1)
        status = "below" if cur < lo else ("above" if cur > hi else "in range")
        body.append(
            "<tr><td><b>%s</b></td><td>%s &ndash; %s</td><td>%s</td>"
            "<td><div class='bar'><div class='band' style='left:%s%%;width:%s%%'></div>"
            "<div class='cur' style='left:%s%%'></div></div></td>"
            "<td><span class='badge b-%s'>%s</span></td></tr>"
            % (_e(_bare(o.get("signal", ""))), _e(round(lo, 3)), _e(round(hi, 3)), _e(round(cur, 3)),
               band_l, band_w, cur_l, "warn" if status != "in range" else "ok", _e(status))
        )
    return ("<table><thead><tr><th>Signal</th><th>Normal range</th><th>Current</th>"
            "<th>Baseline vs current</th><th>Status</th></tr></thead><tbody>%s</tbody></table>"
            % "".join(body))


def _learn_preview(proposals: list) -> str:
    if not proposals:
        return "<p class='caveat'>No context proposals for this event.</p>"
    trig_badge = {"accept": ("b-ok", "ACCEPT"), "reject": ("b-crit", "REJECT"),
                  "escalate": ("b-warn", "ESCALATE"), "flag_review": ("b-warn", "ESCALATE")}
    out = ["<table><thead><tr><th>Proposed context update</th><th>Confidence</th>"
           "<th>Decision</th><th>Approval state</th></tr></thead><tbody>"]
    for p in proposals:
        cls, label = trig_badge.get(p.get("trigger", ""), ("b-muted", str(p.get("trigger", "")).upper()))
        out.append(
            "<tr><td>%s</td><td>%s</td><td><span class='badge %s'>%s</span></td><td>%s</td></tr>"
            % (_e(p.get("title", "")), _e(p.get("confidence", "")), cls, label,
               _e(p.get("kg_approval_state", "")))
        )
    out.append("</tbody></table>")
    return "".join(out)


def render_report(run_pipeline_result: dict) -> str:
    """Render a run_pipeline() result dict into a self-contained HTML report string.
    Deterministic; no I/O. See module docstring."""
    r = run_pipeline_result
    s = r.get("stages", {})
    connect, pick = s.get("connect", {}), s.get("pick", {})
    prove, explain, learn = s.get("prove", {}), s.get("explain", {}), s.get("learn", {})
    obs = prove.get("observations", [])
    answer = explain.get("answer", "")
    rubric = explain.get("rubric", {})

    event_n = prove.get("event_count", 0)
    status_cls, status_txt = (("status-warn", "Machine event detected — review recommended")
                              if event_n else ("status-ok", "Within normal — no event"))
    cause = _line_after(answer, "Likely cause:") or "see explanation"
    check = _line_after(answer, "Check first:") or (
        "; ".join(rubric.get("actions_hit", [])) or "see explanation")

    exec_summary = (
        "Analyzed <b>%s</b> (%s, %s). Discovered <b>%s</b> read-only signals "
        "(<b>%s</b> writes). The difference engine learned normal from the healthy window, "
        "detected <b>%s</b> differences, and grouped them into <b>%s</b> machine event(s). "
        "Likely cause: <b>%s</b> Check first: <b>%s</b>"
        % (_e(r.get("asset_tag", "")), _e(r.get("backing_asset", "")), _e(r.get("line", "")),
           _e(connect.get("discovered_signals", 0)), _e(connect.get("writes_attempted", 0)),
           _e(prove.get("observation_count", 0)), _e(event_n), _e(cause), _e(check))
    )

    signals = [_bare(x) for x in prove.get("event_signals", [])]
    citations = rubric.get("citations_hit", [])
    docs = [d.get("title", "") for d in pick.get("uploaded_docs", [])]

    parts = []
    parts.append("<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>"
                 "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                 "<title>Flight Recorder Report — %s</title><style>%s</style></head><body><div class='page'>"
                 % (_e(r.get("asset_tag", "")), _CSS))

    # 1. header
    parts.append(
        "<div class='header' id='section-header' data-section='header'>"
        "<h1>Factory Flight Recorder Report</h1>"
        "<div class='meta'>%s &nbsp;/&nbsp; asset <b>%s</b> (%s) &nbsp;/&nbsp; scenario <b>%s</b> "
        "&nbsp;/&nbsp; seed %s &nbsp;/&nbsp; %s replay</div></div>"
        % (_e(r.get("line", "")), _e(r.get("asset_tag", "")), _e(r.get("backing_asset", "")),
           _e(r.get("scenario", "")), _e(r.get("seed", "")),
           "deterministic" if r.get("deterministic") else "live"))

    # 2. executive summary (+ scope/safety metrics)
    parts.append(
        "<div class='section' id='section-executive-summary' data-section='executive-summary'>"
        "<h2>Executive Summary</h2>"
        "<div class='status-bar %s'>%s</div><p>%s</p>"
        "<div class='metrics' style='margin-top:14px'>"
        "<div class='metric'><div class='n'>Signals discovered</div><div class='v'>%s</div></div>"
        "<div class='metric'><div class='n'>Tags approved</div><div class='v'>%s</div></div>"
        "<div class='metric'><div class='n'>Manuals</div><div class='v'>%s</div></div>"
        "<div class='metric'><div class='n'>PLC writes</div><div class='v'>%s</div></div>"
        "</div></div>"
        % (status_cls, status_txt, exec_summary,
           _e(connect.get("discovered_signals", 0)), _e(pick.get("approved_count", 0)),
           _e(pick.get("doc_count", 0)), _e(connect.get("writes_attempted", 0))))

    # 3. difference cards
    parts.append("<div class='section' id='section-difference-cards' data-section='difference-cards'>"
                 "<h2>Difference Cards — what changed vs normal</h2>%s</div>" % _diff_cards(obs))

    # 4. event timeline
    parts.append("<div class='section' id='section-event-timeline' data-section='event-timeline'>"
                 "<h2>Event Timeline</h2>%s</div>" % _timeline(obs))

    # 5. baseline vs current
    parts.append("<div class='section' id='section-baseline-vs-current' data-section='baseline-vs-current'>"
                 "<h2>Baseline vs Current</h2>%s</div>" % _baseline_table(obs))

    # 6. explain panel
    parts.append(
        "<div class='section' id='section-explain-panel' data-section='explain-panel'>"
        "<h2>Explanation — MIRA (%s)</h2><div class='answer'>%s</div>"
        "<div class='chips'><span class='chip'>rubric passed: %s</span>"
        "<span class='chip'>evidence recall: %s</span>"
        "<span class='chip'>citations: %s</span></div></div>"
        % (_e(explain.get("mode", "")), _e(answer), _e(rubric.get("passed")),
           _e(rubric.get("evidence_recall")), _e(len(citations))))

    # 7. evidence / citations
    parts.append(
        "<div class='section' id='section-evidence-citations' data-section='evidence-citations'>"
        "<h2>Evidence &amp; Citations</h2>"
        "<p><b>PLC signals now abnormal:</b></p><div class='chips'>%s</div>"
        "<p style='margin-top:12px'><b>Cited manuals:</b></p><div class='chips'>%s</div>"
        "<p class='foot'>Baseline learned from the healthy window before fault onset.</p></div>"
        % ("".join("<span class='chip'>%s</span>" % _e(x) for x in signals) or "<span class='caveat'>none</span>",
           "".join("<span class='chip'>%s</span>" % _e(x) for x in (citations or docs)) or "<span class='caveat'>none</span>"))

    # 8. learn / review preview
    parts.append(
        "<div class='section' id='section-learn-review-preview' data-section='learn-review-preview'>"
        "<h2>Learn / Review Preview</h2>%s"
        "<p class='foot'>Accepted context becomes verified; rejected ideas stay out of the approved model. "
        "This is a static preview — the live accept/reject/escalate happens in the Hub review queue.</p></div>"
        % _learn_preview(learn.get("proposals", [])))

    # caveats
    parts.append(
        "<div class='section' data-section='caveats'><h2>Caveats — what is still unproven</h2>"
        "<div class='caveat'>&bull; CV-200 / Northwind Bottling is a display alias over the SimLab asset "
        "(real deterministic data; branded names only).</div>"
        "<div class='caveat'>&bull; This explanation is the deterministic (templated, grounded) readout; "
        "the live LLM answer is an opt-in path, not used here.</div>"
        "<div class='caveat'>&bull; Offline replay: scenario <b>%s</b>, seed <b>%s</b> — reproducible.</div></div>"
        % (_e(r.get("scenario", "")), _e(r.get("seed", ""))))

    parts.append("</div></body></html>")
    return "".join(parts)


def write_report(run_pipeline_result: dict, path: str) -> str:
    """Render and write the report to `path`. Returns the path."""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(render_report(run_pipeline_result))
    return path
