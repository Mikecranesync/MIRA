"""Spec-driven electrical wiring-diagram generator (IEC 60617).

Turns a validated ``DiagramSpec`` (components + terminals + nets + buses) into a
professional wiring print: SVG (dependency-free), and PNG/PDF via PyMuPDF.

Provenance: lifted from ``openclaw/openclaw/diagram/`` (MIT, Copyright (c) 2026
FactoryLM) per ``docs/discovery/electrical_print_reuse_audit.md``. Local changes:
imports made package-relative; the PNG path was switched from cairosvg (LGPL) to
PyMuPDF/fitz and a vector ``render_pdf`` added, to honor MIRA's MIT/Apache-2.0-only
licensing rule (PRD §4). No LLM call lives inside the renderer — it is provider-
agnostic and takes a spec built from cited evidence (see the reuse audit's plan).
"""

from .renderer import WiringRenderer, render_from_json, render_markdown_summary
from .schema import (
    Bus,
    Component,
    Connection,
    DiagramSpec,
    Ratings,
    Terminal,
)

__all__ = [
    "WiringRenderer",
    "DiagramSpec",
    "Component",
    "Terminal",
    "Ratings",
    "Connection",
    "Bus",
    "render_from_json",
    "render_markdown_summary",
]
