"""Render a validated ``PrintSynthGraph`` into a technician-readable Telegram reply.

Deterministic — NO LLM. Claude produced the graph; MIRA renders it, so this stage
can never introduce a claim the graph doesn't already hold. Every line traces to an
entity + its evidence; unreadable items are surfaced (not hidden); and the trust
caveat is always shown — a fresh interpretation is ``proposed``, never field-verified.
"""

from __future__ import annotations

from .models import Entity, PrintSynthGraph

_TG_LIMIT = 3500  # keep under Telegram's 4096-char cap with room for the caveat


def _pkg_header(pkg: dict) -> str:
    bits: list[str] = []
    for key in ("cabinet", "drawing_no", "sheet"):
        val = (pkg or {}).get(key)
        if val:
            bits.append(f"sheet {val}" if key == "sheet" else str(val))
    return "📐 " + " · ".join(bits) if bits else "📐 Electrical print"


def _device_line(e: Entity) -> str:
    line = e.tag
    if e.type:
        line += f" — {e.type}"
    tail = e.detail or e.evidence
    if tail:
        line += f" ({tail})"
    return "• " + line


def format_graph_for_telegram(graph: PrintSynthGraph) -> str:
    """A grounded, plain-text summary of the interpreted print for a phone screen."""
    lines: list[str] = [_pkg_header(graph.package or {})]

    # What the circuit does — functional paths, else the cross-sheet note.
    if graph.functional_paths:
        lines += ["", "⚡ How it works"]
        for fp in graph.functional_paths[:4]:
            seq = " → ".join(fp.sequence) if fp.sequence else ""
            lines.append(f"• {fp.name}" + (f": {seq}" if seq else ""))
    elif graph.cross_sheet_notes:
        lines += ["", f"⚡ {graph.cross_sheet_notes}"]

    # Devices.
    if graph.devices:
        lines += ["", f"🔧 Devices ({len(graph.devices)})"]
        lines += [_device_line(e) for e in graph.devices[:12]]
        if len(graph.devices) > 12:
            lines.append(f"…and {len(graph.devices) - 12} more")

    # Connections / infrastructure — counts + a few notable tags.
    infra: list[str] = []
    if graph.cables:
        infra.append(f"{len(graph.cables)} cable(s): " + ", ".join(e.tag for e in graph.cables[:6]))
    if graph.terminals:
        infra.append(f"{len(graph.terminals)} terminal(s)")
    if graph.pe_bonds:
        infra.append(f"{len(graph.pe_bonds)} PE bond(s)")
    if graph.plc_io_channels:
        infra.append(f"{len(graph.plc_io_channels)} PLC I/O")
    if graph.network_links:
        tags = ", ".join(e.tag for e in graph.network_links[:6])
        infra.append(f"{len(graph.network_links)} network link(s): {tags}")
    if graph.off_page_references:
        infra.append(f"{len(graph.off_page_references)} off-page ref(s)")
    if infra:
        lines += ["", "🔌 " + " · ".join(infra)]

    # The honesty — unreadable / contradictory items, never invented past.
    if graph.unresolved:
        lines += ["", "⚠️ Couldn't read (retake or crop closer):"]
        lines += [f"• {u.item}" for u in graph.unresolved[:6]]

    # Trust caveat — always. Read-only doctrine: meter before you act.
    lines += [
        "",
        "🔎 Proposed interpretation from the drawing — not yet field-verified. "
        "Meter before you act. Reply to confirm or correct any item.",
    ]

    text = "\n".join(lines)
    if len(text) > _TG_LIMIT:
        text = text[:_TG_LIMIT].rsplit("\n", 1)[0] + "\n… (truncated)"
    return text
