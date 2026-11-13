"""Write dashboard.html from results.json, matrix.csv and charts/. Static, no scripts. Every score links to raw evidence.

python3 make_dashboard.py
"""

from __future__ import annotations

import csv
import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REV = {"pre": "b980d42db", "parent": "e28bb182d", "post": "cc0d26c1d"}
RAWSET = {"t4-77": "t4-77", "forum-new": "forum-new", "batch2": "batch2"}

CSS = """
:root{--bg:#fafafa;--fg:#1d2430;--muted:#5d6878;--line:#d9dee5;--card:#fff;--ok:#2e7d32;--warn:#b26a00;--bad:#c0392b;--accent:#3f51b5}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14171c;--fg:#e6e9ee;--muted:#9aa4b2;--line:#2c323b;--card:#1b1f26;--ok:#66bb6a;--warn:#f0a43a;--bad:#ef6b5b;--accent:#8c9eff}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}
h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid var(--line);padding-bottom:4px}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px;margin:10px 0;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
.v{font-weight:700}.GO{color:var(--ok)}.INCONCLUSIVE{color:var(--warn)}.NO-GO{color:var(--bad)}
.muted{color:var(--muted)}img{max-width:100%;height:auto;background:#fff;border-radius:4px}
a{color:var(--accent)}code{font-size:12px}
"""


def pct(x: dict) -> str:
    return f"{x['num']}/{x['den']} = {100 * x['num'] / max(1, x['den']):.0f}% <span class=muted>[{100 * x['ci95'][0]:.0f}–{100 * x['ci95'][1]:.0f}]</span>"


def main() -> None:
    r = json.load(open(f"{HERE}/results.json"))
    v = r["verdicts"]
    out = [
        f"<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>IMIB benchmark 4791</title><style>{CSS}</style></head><body><main>"
    ]
    out.append("<h1>IMIB v0.1 — independent benchmark of cc0d26c1d (#4791)</h1>")
    out.append(
        "<p class=muted>All values measured, retrieval-only, zero tokens. Labels are AI-made (not expert ground truth). Report: <a href=REPORT.md>REPORT.md</a> · method: <a href=../imib/SPEC.md>SPEC.md</a> · pre-registration: <a href=PREREGISTRATION.md>PREREGISTRATION.md</a> · manifest: <a href=run-manifest.json>run-manifest.json</a></p>"
    )
    out.append(
        "<h2>Verdicts (pre-registered rules, computed by analyze.py)</h2><div class=card><table><tr><th>Area</th><th>Verdict</th><th>Basis</th></tr>"
    )
    for k, lab in (
        ("retrieval_improvement", "Retrieval: did #4791 improve it"),
        ("answer_quality", "Answer quality"),
        ("safety", "Safety"),
    ):
        out.append(
            f"<tr><td>{lab}</td><td class='v {v[k]['verdict']}'>{v[k]['verdict']}</td><td>{html.escape('; '.join(v[k]['notes']))}</td></tr>"
        )
    fit = v["retrieval_fit_for_production"]
    out.append(
        f"<tr><td>Retrieval fit for production (bar: forum-new top-5 Wilson low ≥ 0.70)</td><td class='v {'GO' if fit and fit['met'] else 'NO-GO'}'>{'met' if fit and fit['met'] else 'not met'}</td><td>Wilson low {fit['forum_new_top5_wilson_low']:.2f}</td></tr></table></div>"
    )
    out.append(
        "<h2>Retrieval (top-N = an accepted page is in the first N chunks; Wilson 95% in brackets)</h2>"
    )
    for name, m in r["retrieval"].items():
        if "k10" in name:
            continue
        raw = RAWSET[name.split(" ")[0]]
        out.append(
            f"<div class=card><b>{html.escape(name)}</b> <span class=muted>n = {m['n_answerable']} answerable of {m['n_total']}, {m['n_clusters']} manuals · raw: <a href=raw/{raw}/>raw/{raw}/</a></span><table><tr><th>Arm</th><th>Top-1</th><th>Top-5</th><th>MRR@10</th><th>Wrong page</th><th>p95 ms</th></tr>"
        )
        for a in m["arms"]:
            x = m[REV.get(a, a)]
            out.append(
                f"<tr><td>{a} <span class=muted>{REV.get(a, '')}</span></td><td>{pct(x['top1'])}</td><td>{pct(x['top5'])}</td><td>{x['mrr10']:.3f}</td><td>{x['wrong_page6']['num']}/{x['wrong_page6']['den']}</td><td>{'' if x['latency_p95_ms'] is None else round(x['latency_p95_ms'])}</td></tr>"
            )
        p = m["paired_pre_post"]["top5"]
        out.append(
            f"</table><p>Paired pre → post, top-5: lost {p['b_lost']}, gained {p['c_gained']}, McNemar p = {p['mcnemar_p']:.3f}.</p>"
        )
        slug = name.split(" ")[0] + ("-agreed" if "agreed" in name else "")
        if os.path.exists(f"{HERE}/charts/{slug}-topn.png"):
            out.append(
                f"<img src=charts/{slug}-topn.png alt='top-N chart for {html.escape(name)}'>"
            )
        out.append("</div>")
    out.append(
        "<h2>Paired change and latency</h2><div class=card><img src=charts/paired-delta.png alt='paired change'><img src=charts/latency.png alt='latency'></div>"
    )
    sg = r["safety_gate"]["by_rev"]["cc0d26c1d"]
    out.append(
        f"<h2>Safety gate (deterministic, pre-LLM)</h2><div class=card><p>{sg['protected']}/{sg['protect_expected']} hazard asks protected ({sg['stopped']} stopped), {len(sg['over_triggered'])}/{sg['none_expected']} ordinary asks over-triggered. Missed: <b>{', '.join(sg['missed'])}</b>. Identical on all three revisions. Raw: <a href=raw/safety-gate/>raw/safety-gate/</a>.</p><img src=charts/safety-gate.png alt='safety gate'><table><tr><th>id</th><th>expected</th><th>gate</th><th>trigger</th></tr>"
    )
    for i, row in r["safety_gate"]["rows"].items():
        out.append(
            f"<tr><td>{i}</td><td>{row['expected']}</td><td>{row['post']['gate']}</td><td>{html.escape(str(row['post']['trigger']))}</td></tr>"
        )
    out.append(
        "</table></div><h2>Per-question (k = 6, production call)</h2><div class=card><table><tr><th>set</th><th>id</th><th>accepted</th><th>pre</th><th>post</th><th>lexv2</th><th>bm25</th><th>change</th><th>post top-6</th></tr>"
    )
    for row in csv.DictReader(open(f"{HERE}/matrix.csv")):
        out.append(
            f"<tr><td>{html.escape(row['set'].split(' ')[0])}</td><td>{row['id']}</td><td>{row['accepted']}</td><td>{row['pre_rank']}</td><td>{row['post_rank']}</td><td>{row['post-lexv2_rank']}</td><td>{row['bm25_rank']}</td><td>{row['pre_to_post']}</td><td><code>{row['post_top6']}</code></td></tr>"
        )
    out.append(
        "</table></div><p class=muted>Rank blank = no accepted page in the top 10. Generated by make_dashboard.py.</p></main></body></html>"
    )
    open(f"{HERE}/dashboard.html", "w").write("\n".join(out))
    print("dashboard.html written")


if __name__ == "__main__":
    main()
