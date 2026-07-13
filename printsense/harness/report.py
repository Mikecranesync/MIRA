"""Concise Markdown/HTML acceptance report for the PrintSense harness.

Reads the layer-3 E2E result JSONs (and optional layer-1/2 summaries) and renders a
one-glance report: per-case routing, latency, confident misreads, and unresolved
findings, plus a top-line pass/fail.
"""

from __future__ import annotations

import glob
import html
import json
from pathlib import Path


def _e2e_records(e2e_dir: str | Path) -> list[dict]:
    out = []
    for p in sorted(glob.glob(str(Path(e2e_dir) / "*.e2e.json"))):
        out.append(json.loads(Path(p).read_text(encoding="utf-8")))
    return out


def build_markdown(e2e_dir: str | Path, layer1_summary: str = "", layer2_summary: str = "") -> str:
    lines = ["# PrintSense acceptance report", ""]
    if layer1_summary:
        lines += [f"- **Layer 1 (deterministic, every PR):** {layer1_summary}"]
    if layer2_summary:
        lines += [f"- **Layer 2 (metamorphic, nightly):** {layer2_summary}"]
    lines += [""]

    recs = _e2e_records(e2e_dir)
    if not recs:
        lines += ["## Layer 3 — live staging E2E", "", "_No E2E results (Telethon creds absent, or not yet run)._"]
        return "\n".join(lines)

    ok = sum(1 for r in recs if r.get("routing_ok"))
    misreads = sum(r.get("confident_misreads") or 0 for r in recs)
    lines += [
        "## Layer 3 — live staging E2E",
        "",
        f"**{ok}/{len(recs)} routing-correct · {misreads} confident misreads total**",
        "",
        "| case | expected routing | routed | latency (default / map) | misreads | unresolved | ok |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in recs:
        routed = "print" if r.get("routed_as_print") else "other"
        lat = f"{r.get('default_latency_s', '?')}s / {r.get('map_latency_s', '?')}s"
        mis = "—" if r.get("confident_misreads") is None else str(r["confident_misreads"])
        unres = "yes" if r.get("unresolved_mentioned") else "—"
        lines.append(
            f"| {r['case']} | {r['routing_expected']} | {routed} | {lat} | {mis} | {unres} | "
            f"{'✅' if r.get('routing_ok') else '❌'} |"
        )
    return "\n".join(lines)


def build_html(markdown_text: str, title: str = "PrintSense acceptance report") -> str:
    """A tiny, dependency-free MD→HTML wrap (headings, paragraphs, and one table
    per contiguous run of `|` rows — the first row of each table is the header)."""
    out: list[str] = []
    table: list[str] = []

    def _flush_table() -> None:
        if not table:
            return
        head, *body = table
        rows = [f"<thead>{head}</thead>"] if head else []
        if body:
            rows.append("<tbody>" + "".join(body) + "</tbody>")
        out.append("<table>" + "".join(rows) + "</table>")
        table.clear()

    for line in markdown_text.splitlines():
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if set("".join(cells)) <= set("-: "):
                continue  # separator row
            tag = "th" if not table else "td"
            table.append("<tr>" + "".join(f"<{tag}>{html.escape(c)}</{tag}>" for c in cells) + "</tr>")
            continue
        _flush_table()
        s = html.escape(line)
        if line.startswith("# "):
            out.append(f"<h1>{s[2:]}</h1>")
        elif line.startswith("## "):
            out.append(f"<h2>{s[3:]}</h2>")
        elif line.strip():
            out.append(f"<p>{s}</p>")
    _flush_table()

    return (
        f"<!doctype html><meta charset=utf-8><title>{html.escape(title)}</title>"
        "<style>body{font:14px system-ui;margin:2rem;max-width:60rem}"
        "table{border-collapse:collapse;margin:1rem 0}td,th{border:1px solid #ccc;padding:4px 8px}"
        "th{background:#f4f4f4;text-align:left}</style>"
        f"<body>{''.join(out)}</body>"
    )


def write_report(out_dir: str | Path, e2e_dir: str | Path, layer1_summary: str = "", layer2_summary: str = "") -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    md = build_markdown(e2e_dir, layer1_summary, layer2_summary)
    (out / "acceptance_report.md").write_text(md, encoding="utf-8")
    (out / "acceptance_report.html").write_text(build_html(md), encoding="utf-8")
    return out / "acceptance_report.md"
