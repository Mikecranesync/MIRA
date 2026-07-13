"""Reusable, model-free assertions over PrintSynth graphs + rendered briefs.

Shared by layer 1 (deterministic render replay) and layer 2 (metamorphic
no-invention). All pure functions — no model calls, no I/O.
"""

from __future__ import annotations

import json
import re

from printsense.models import PrintSynthGraph

_VOLT = re.compile(r"\b(\d{2,4})\s?V(?:DC|AC)?\b", re.I)
_NUM = re.compile(r"\d{2,4}")


def _norm(s: object) -> str:
    return re.sub(r"\s+", "", str(s).strip().upper())


def brief_text(g: PrintSynthGraph) -> str:
    """All plain-English text the brief presents to a technician."""
    b = g.brief
    if not b:
        return ""
    parts = [b.sheet_title or "", b.purpose or "", b.troubleshooting_example or "", b.safety_context or ""]
    parts += [s.signal for s in b.key_signals if s.signal]
    parts += [d.device for d in b.key_devices if d.device]
    parts += [u for u in (b.unresolved_items or []) if u]
    return " ".join(parts)


def evidence_text(g: PrintSynthGraph) -> str:
    """Everything the interpreter actually read — the ground for "is this supported"."""
    parts = [json.dumps(g.package, ensure_ascii=False)]
    for e in g.all_entities():
        parts += [e.tag or "", e.type or "", e.detail or "", e.evidence or "", *(e.connects or [])]
    parts += [u.item or "" for u in (g.unresolved or [])]
    if g.cross_sheet_notes:
        parts.append(g.cross_sheet_notes)
    if g.brief:  # the brief's own EXACT fields carry read tags/terminals/destinations
        for s in g.brief.key_signals:
            parts += [s.tag or "", s.terminal or "", s.destination or ""]
    return " ".join(p for p in parts if p)


def voltage_tokens(text: str) -> set[str]:
    """Numeric voltage values mentioned (e.g. '24VDC' -> '24', '230 V' -> '230')."""
    return {m.group(1) for m in _VOLT.finditer(text or "")}


def unsupported_voltages(g: PrintSynthGraph) -> set[str]:
    """Voltages stated in the BRIEF whose number never appears in the graph evidence
    — i.e. invented from general knowledge rather than read from the sheet."""
    ev = evidence_text(g)
    ev_nums = set(_NUM.findall(ev))
    return {v for v in voltage_tokens(brief_text(g)) if v not in ev_nums}


def structured_tag_pool(g: PrintSynthGraph) -> set[str]:
    """Exact designations the graph ASSERTS (entity tags/types/connects + brief signal
    tags/terminals/destinations) — the fact set for metamorphic comparison."""
    pool: set[str] = set()
    for e in g.all_entities():
        if e.tag and e.tag.upper() != "UNREADABLE":
            pool.add(_norm(e.tag))
        if e.type:
            pool.add(_norm(e.type))
        pool |= {_norm(c) for c in (e.connects or [])}
    if g.brief:
        for s in g.brief.key_signals:
            pool |= {_norm(x) for x in (s.tag, s.terminal, s.destination) if x}
    pool.discard("")
    pool.discard("UNREADABLE")
    return pool


def forbidden_hits(g: PrintSynthGraph, forbid) -> list[str]:
    """Which forbidden tokens leaked into the brief or the structured facts."""
    blob = _norm(brief_text(g) + " " + evidence_text(g))
    return [t for t in (forbid or []) if _norm(t) and _norm(t) in blob]


def says_external(g: PrintSynthGraph) -> bool:
    """The vague 'external' destination anti-pattern in the technician-facing brief."""
    return "external" in brief_text(g).lower()
