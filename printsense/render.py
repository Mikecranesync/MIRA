"""Render a validated ``PrintSynthGraph`` into a technician-readable Telegram reply.

Two deterministic renderers (no LLM). The interpreter (``interpret.py``) is
unchanged — it now also emits a grounded ``brief`` (a typed ``TechnicianBrief``),
the plain-English presentation a technician actually wants. The render layer LEADS
with that brief instead of a wall of designations:

- ``format_graph_for_telegram`` — the DEFAULT reply, understandable read aloud
  WITHOUT decoding IEC tags, in the order: plain title → what it does → complete
  signals & devices → one grounded troubleshooting example → measurement-specific
  safety → "reply 'map'". Cryptic tags are translated to meaning here.
- ``format_map_for_telegram`` — the on-request EXACT list: device tags, terminals,
  wire/cable ids, source→destination, sheet/grid refs, confidence, and unresolved
  readings. Uncertainty is never hidden and unresolved values are never replaced
  with likely ones.

If a graph has no ``brief`` (an older or degraded read), the default gracefully
falls back to the map, so a print question is never left unanswered.
"""

from __future__ import annotations

from .models import Entity, PrintSynthGraph

_TG_LIMIT = 3500  # keep under Telegram's 4096-char cap with room for the caveat
_CLOSING = (
    "Read from the drawing. Verify field conditions and use the correct procedure for the measurement."
)
_MAP_HINT = 'Reply "map" for the full terminal and wire list.'


# ── shared helpers ────────────────────────────────────────────────────────────


def _pkg_header(pkg: dict) -> str:
    bits: list[str] = []
    for key in ("cabinet", "drawing_no", "sheet"):
        val = (pkg or {}).get(key)
        if val:
            bits.append(f"sheet {val}" if key == "sheet" else str(val))
    return "📐 " + " · ".join(bits) if bits else "📐 Electrical print"


def _truncate(text: str) -> str:
    if len(text) > _TG_LIMIT:
        text = text[:_TG_LIMIT].rsplit("\n", 1)[0] + '\n… (truncated — reply "map" for detail)'
    return text


def _has_brief(graph: PrintSynthGraph) -> bool:
    b = graph.brief
    return bool(b and (b.sheet_title or b.purpose or b.key_signals))


# ── DEFAULT reply: plain-English brief first ──────────────────────────────────


def format_graph_for_telegram(graph: PrintSynthGraph) -> str:
    """The default, plain-English-first reply — readable without decoding tags.
    Falls back to the exact-tag map when the interpreter produced no ``brief``."""
    if not _has_brief(graph):
        return format_map_for_telegram(graph)

    b = graph.brief
    # BODY (truncatable if the sheet is huge): title → purpose → signals → devices
    #  → troubleshooting → uncertainty.
    body: list[str] = [f"📋 {b.sheet_title.strip()}" if b.sheet_title else _pkg_header(graph.package or {})]

    if b.purpose:  # 2. what the circuit/sheet does
        body += ["", b.purpose.strip()]

    if b.key_signals:  # 3. complete signals (plain), then devices
        body += ["", "🔑 Signals"]
        body += [f"• {s.signal.strip()}" for s in b.key_signals if s.signal]
    if b.key_devices:
        body += ["", "🔧 Devices"]
        body += [f"• {d.device.strip()}" + (f" ({d.tag})" if d.tag else "") for d in b.key_devices if d.device]

    if b.troubleshooting_example:  # 4. one grounded troubleshooting example
        body += ["", "🩺 If you're chasing a fault", b.troubleshooting_example.strip()]

    # FOOTER (never dropped): uncertainty → measurement-specific safety → closing → reply 'map'.
    footer: list[str] = []
    if b.unresolved_items:  # uncertainty is surfaced in the DEFAULT — never hidden, never truncated
        footer += ["❓ Couldn't confirm (verify on the sheet):"]
        footer += [f"• {u.strip()}" for u in b.unresolved_items[:4] if u]
        if len(b.unresolved_items) > 4:
            footer.append(f"…and {len(b.unresolved_items) - 4} more (see 'map')")
        footer.append("")
    if b.safety_context:  # 5. safety
        footer += [f"⚠️ {b.safety_context.strip()}"]
    footer += [f"🔎 {_CLOSING}", "", _MAP_HINT]  # closing + 6. reply 'map'
    footer_str = "\n".join(footer)

    body_str = "\n".join(body)
    budget = _TG_LIMIT - len(footer_str) - 6
    if len(body_str) > budget:  # trim the middle, keep the safety/closing/map footer intact
        body_str = body_str[:budget].rsplit("\n", 1)[0] + '\n… (more — reply "map")'
    return body_str + "\n\n" + footer_str


# ── on-request "map": the exact designations ─────────────────────────────────


def _conf(c) -> str:
    return f" · conf {c:.2f}" if isinstance(c, (int, float)) else ""


def _signal_map_line(s) -> str:
    """One exact signal row: plain — tag @ terminal → destination (conf)."""
    ref: list[str] = []
    if s.tag:
        ref.append(str(s.tag))
    if s.terminal:
        ref.append(f"@ {s.terminal}")
    if s.destination:
        ref.append(f"→ {s.destination}")
    detail = "  ".join(ref)
    return f"• {s.signal}" + (f" — {detail}" if detail else "") + _conf(s.confidence)


def _device_map_line(e: Entity) -> str:
    line = e.tag
    if e.type:
        line += f" — {e.type}"
    tail = e.detail or e.evidence
    if tail:
        line += f" ({tail})"
    return "• " + line + _conf(e.confidence)


def format_map_for_telegram(graph: PrintSynthGraph) -> str:
    """The exact list — device tags, terminals, wire/cable ids, source→destination,
    sheet/grid refs, confidence, and unresolved readings. The precise designations
    live in the graph; this surfaces them when the technician replies "map". Also the
    graceful fallback for a graph with no brief. Uncertainty is never hidden."""
    lines: list[str] = [_pkg_header(graph.package or {})]
    b = graph.brief

    # Signals with exact tag / terminal / destination / confidence (from the brief).
    signals = list(b.key_signals) if b and b.key_signals else []
    if signals:
        lines += ["", "🔌 Signals (exact — source → destination)"]
        lines += [_signal_map_line(s) for s in signals]

    # Devices — exact tag + type/detail + confidence.
    if graph.devices:
        lines += ["", f"🔧 Devices ({len(graph.devices)})"]
        lines += [_device_map_line(e) for e in graph.devices[:14]]
        if len(graph.devices) > 14:
            lines.append(f"…and {len(graph.devices) - 14} more")

    # Wire / cable identifiers.
    wires = [e for e in (graph.cables + graph.conductors) if e.tag and e.tag != "UNREADABLE"]
    if wires:
        lines += ["", "🔗 Wires / cables"]
        lines += [f"• {e.tag}" + (f" — {e.type}" if e.type else "") + _conf(e.confidence) for e in wires[:12]]

    # Terminals / off-page continuations (when not already covered by the signal map).
    infra: list[str] = []
    if graph.terminals and not signals:
        infra.append(f"{len(graph.terminals)} terminal(s): " + ", ".join(e.tag for e in graph.terminals[:8]))
    if graph.off_page_references:
        infra.append(f"{len(graph.off_page_references)} off-page ref(s): " + ", ".join(e.tag for e in graph.off_page_references[:8]))
    if graph.plc_io_channels:
        infra.append(f"{len(graph.plc_io_channels)} PLC I/O")
    if graph.network_links:
        infra.append(f"{len(graph.network_links)} network link(s): " + ", ".join(e.tag for e in graph.network_links[:6]))
    if graph.pe_bonds:
        infra.append(f"{len(graph.pe_bonds)} PE bond(s)")
    if infra:
        lines += ["", "🧩 " + " · ".join(infra)]

    # Unresolved — surfaced, never replaced with a likely value.
    unresolved = list(b.unresolved_items) if (b and b.unresolved_items) else [u.item for u in graph.unresolved]
    if unresolved:
        lines += ["", "⚠️ Couldn't read (retake or crop closer):"]
        lines += [f"• {u}" for u in unresolved[:8]]

    lines += [
        "",
        "🔎 Proposed interpretation from the drawing — not yet field-verified. "
        "Reply to confirm or correct any item.",
    ]
    return _truncate("\n".join(lines))
