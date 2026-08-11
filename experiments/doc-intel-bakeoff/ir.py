"""Experiment IR — the minimal common shape parser adapters normalize into.

DELIBERATELY SMALL (Phase 1.5 rule: "Do NOT turn it into a production ARPK spec
yet"). Just enough structure to compare parser outputs fairly and to serialize
what each parser knows about tables and anchors. JSON on disk; no schema
registry, no ontology, no relationships.

Shape (all optional fields may be None):

  ExpDoc      doc_id, source_path, sha256, parser, parser_version, pages: [ExpPage]
  ExpPage     number (1-based), blocks: [ExpBlock]
  ExpBlock    kind: text|heading|table|figure|caption
              text            — flattened text (for tables: the table-aware
                                serialization, one "Header: value" line per cell)
              section_path    — heading trail if the parser provides one
              table           — {n_rows, n_cols, cells: [[str]]} when kind=table
              anchor          — {page, bbox: [x0,y0,x1,y1]} when available
              method          — extraction method label (parser-specific)
              confidence      — float when the parser reports one
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class ExpBlock:
    kind: str
    text: str
    section_path: str | None = None
    table: dict | None = None
    anchor: dict | None = None
    method: str | None = None
    confidence: float | None = None


@dataclass
class ExpPage:
    number: int
    blocks: list[ExpBlock] = field(default_factory=list)


@dataclass
class ExpDoc:
    doc_id: str
    source_path: str
    sha256: str
    parser: str
    parser_version: str
    pages: list[ExpPage] = field(default_factory=list)

    def dump(self, path: Path) -> None:
        path.write_text(
            json.dumps(asdict(self), ensure_ascii=False, indent=1), encoding="utf-8"
        )

    @staticmethod
    def load(path: Path) -> "ExpDoc":
        raw = json.loads(path.read_text(encoding="utf-8"))
        pages = [
            ExpPage(
                number=p["number"],
                blocks=[ExpBlock(**b) for b in p["blocks"]],
            )
            for p in raw["pages"]
        ]
        raw["pages"] = pages
        return ExpDoc(**raw)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def table_aware_text(cells: list[list[str]]) -> str:
    """Serialize a table so each data cell keeps its row+column context —
    the Phase-2 hypothesis under test: 'Rated Output Current [GS11N-10P5]: 2.5 A'
    style lines give BM25 the lexical bridge a natural question needs."""
    if not cells:
        return ""
    header = [c.strip() for c in cells[0]]
    lines: list[str] = [" | ".join(header)]
    for row in cells[1:]:
        row = [c.strip() for c in row]
        label = row[0] if row else ""
        for ci, val in enumerate(row[1:], start=1):
            if not val:
                continue
            col = header[ci] if ci < len(header) and header[ci] else f"col{ci}"
            lines.append(f"{label} [{col}]: {val}")
    return "\n".join(lines)
