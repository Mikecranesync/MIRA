"""Trace viewer — read an AnswerTrace JSONL at the terminal (pillar 2).

The developer-facing "trace viewer" the goal asks for, kept deliberately simple:
a CLI pretty-printer. No web server, no framework — ``cat``-friendly JSONL in,
readable record out. Renders the seven steps, the evidence used, citations,
confidence, and every governance/incident warning.

Usage::

    python -m simlab.observe.viewer <trace.jsonl>        # render all traces
    python -m simlab.observe.viewer <trace.jsonl> --last # only the last one
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from shared.observe.trace import read_jsonl

_SEV_ICON = {"info": "·", "warn": "▲", "critical": "✖"}


def render(trace: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("═" * 72)
    lines.append(
        f"TRACE {trace.get('trace_id', '?')}   [{trace.get('mode', '?')}]   {trace.get('timestamp', '')}"
    )
    lines.append("─" * 72)
    lines.append(f"Q: {trace.get('question', '')}")
    lines.append(
        f"Asset:   {trace.get('asset_uns_path') or trace.get('asset')}  "
        f"(source={trace.get('uns_source')})"
    )
    lines.append(
        f"Model:   {trace.get('model_used')}   "
        f"confidence={trace.get('confidence')}   "
        f"approved_context_only={trace.get('used_approved_context_only')}"
    )
    lat = trace.get("total_latency_ms")
    lines.append(f"Latency: {lat} ms (engine total)" if lat is not None else "Latency: n/a")

    answer = trace.get("answer") or ""
    lines.append("")
    lines.append("ANSWER:")
    for ln in answer.splitlines() or [""]:
        lines.append(f"  {ln}")

    cites = trace.get("citations") or []
    lines.append("")
    lines.append(f"CITATIONS ({len(cites)}): " + (", ".join(cites) if cites else "— none —"))

    docs = trace.get("documents_retrieved") or []
    lines.append(f"DOCUMENTS RETRIEVED ({len(docs)}, source={trace.get('retrieval_source')}):")
    for d in docs:
        name = d.get("doc") or d.get("name") or d.get("source") or f"rank {d.get('rank')}"
        score = d.get("score")
        lines.append(f"  - {name}" + (f"  (score={score})" if score is not None else ""))
    tags = trace.get("tags_used") or []
    if tags:
        lines.append(f"TAGS USED ({len(tags)}): {', '.join(tags)}")

    lines.append("")
    lines.append("ORCHESTRATION STEPS:")
    for s in trace.get("steps", []):
        dur = s.get("duration_ms")
        total = " (engine total)" if s.get("duration_is_total") else ""
        status = s.get("status", "ok").upper()
        lines.append(f"  [{status:5}] {s.get('name'):17} {dur}ms{total}")
        if s.get("error"):
            lines.append(f"           error: {s['error']}")
        out = s.get("output") or {}
        if out:
            lines.append(f"           {out}")

    warnings = trace.get("warnings") or []
    lines.append("")
    if warnings:
        lines.append(f"WARNINGS ({len(warnings)}):")
        for w in warnings:
            icon = _SEV_ICON.get(w.get("severity"), "?")
            lines.append(
                f"  {icon} [{w.get('severity')}/{w.get('pillar')}] "
                f"{w.get('code')}: {w.get('message')}"
            )
    else:
        lines.append("WARNINGS: none — clean answer.")
    if trace.get("error"):
        lines.append(f"\nTRACE ERROR: {trace['error']}")
    lines.append("═" * 72)
    return "\n".join(lines)


def _utf8_stdout() -> None:
    try:
        import sys

        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001 — older Python / non-reconfigurable stream
        pass


def main() -> None:
    _utf8_stdout()
    p = argparse.ArgumentParser(description="Render an AnswerTrace JSONL file.")
    p.add_argument("path", type=Path, help="Path to a .jsonl trace file")
    p.add_argument("--last", action="store_true", help="Render only the last trace")
    args = p.parse_args()

    traces = read_jsonl(args.path)
    if not traces:
        print(f"No traces in {args.path}")
        return
    if args.last:
        traces = traces[-1:]
    for t in traces:
        print(render(t))


if __name__ == "__main__":
    main()
