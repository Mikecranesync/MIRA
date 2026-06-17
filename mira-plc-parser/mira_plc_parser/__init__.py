"""MIRA PLC Parser -- read-only, vendor-agnostic PLC program export analysis.

Mission: take PLC program exports from different vendors, parse them into ONE common MIRA format
(the IR), and extract maintenance intelligence from them -- tags, routines, outputs, faults,
interlocks, sequences, and asset mappings -- without ever writing to a PLC or translating between
vendor languages.

Phase 1: Rockwell L5X + generic CSV tag exports. Architecture is built so PLCopen XML, Structured
Text, Siemens TIA XML exports, OpenPLC projects, and PDF/OCR fallbacks slot in later as new parsers
that target the same IR.

Quickstart:
    from mira_plc_parser import run, render_markdown
    result = run("conveyor.L5X", open("conveyor.L5X").read())
    print(render_markdown(result))
"""
from __future__ import annotations

from .correlate import correlate
from .detect import detect
from .i3x import render_i3x
from .ir import PLCProject
from .pipeline import ParseResult, render_json, render_markdown, run

__all__ = ["run", "render_markdown", "render_json", "render_i3x", "correlate", "detect",
           "ParseResult", "PLCProject"]
__version__ = "0.1.0"
