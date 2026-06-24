"""ProveIt manual / spec document -> citable knowledge chunks (offline transform).

Phase 2's second grounding path (companion to `pilot_db_chunks.py`): turn an equipment manual or
engineering spec into human-readable, citable chunks that MIRA can quote. The Cappy Hour corpus ships
its equipment knowledge as markdown specs (e.g. the Vessel Engineering Specification), and a real
beverage-line vendor manual would arrive as a PDF; this module handles both:

    markdown / plain text  ->  section-aware chunks         (stdlib only, no deps)
    PDF                    ->  Docling-converted markdown    (lazy import; infra-gated)

It ALSO carries the asset-roster bridge the Pilot DB transform needs: `parse_asset_uns_table` reads
the "Asset ID | ... | UNS Path" table out of the Vessel spec and yields `asset_uns_by_id`, so a work
order's numeric `assetid` grounds to a real vat UNS path instead of staying an opaque id.

Like `pilot_db_chunks`, this is a PURE offline transform: read -> chunk -> emit `Chunk`s -> shape rows
for `insert_knowledge_entries_batch`. It does NOT embed or write to NeonDB (that needs infra + the
nomic embedder), and it sets `is_private=True` for this per-tenant corpus
(`.claude/rules/knowledge-entries-tenant-scoping.md`). The licensed corpus is never committed; tests
run on synthetic fixtures.

Read-only. stdlib-only for the markdown path (`re`); Docling is imported lazily for PDFs.
"""
from __future__ import annotations

import re
from pathlib import Path

# Reuse the Chunk dataclass and the knowledge_entries row shaper from the Pilot DB transform so both
# grounding paths emit identical row dicts (same is_private=True, same deterministic content-hash id).
from pilot_db_chunks import Chunk, to_knowledge_entry_rows  # noqa: F401  (re-exported for callers)

_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_TABLE_ROW = re.compile(r"^\s*\|(.+)\|\s*$")


def slug(text: str) -> str:
    """Lowercase; collapse runs of non-alphanumeric to a single '_'. Mirrors the parser's
    `mira_plc_parser.uns.slug` so manual-derived UNS paths match the import engine's convention."""
    return re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")


def uns_path_from_doc(raw: str) -> str:
    """Turn a doc UNS path (`Enterprise B/Site3/liquidprocessing/mixroom01/vat01`, slash-separated,
    mixed case) into the dot-ltree slug form the IR uses (`enterprise_b.site3.liquidprocessing...`)."""
    raw = raw.strip().strip("`").strip()
    parts = [slug(seg) for seg in re.split(r"[\\/]+", raw) if seg.strip()]
    return ".".join(p for p in parts if p)


def chunk_markdown(
    text: str,
    source_file: str,
    uns_prefix: str = "",
    max_chars: int = 1500,
) -> list[Chunk]:
    """Split a markdown/plain-text document into section-aware citable chunks.

    Each top section (delimited by `#`..`######` headings) becomes one chunk, carrying its heading
    trail as provenance (`source_row`) and the heading path in metadata. A section longer than
    `max_chars` is further split on paragraph boundaries so no chunk is unwieldy for retrieval.
    """
    sections = _split_sections(text)
    out: list[Chunk] = []
    for idx, (heading, body) in enumerate(sections):
        body = body.strip()
        if not body and not heading:
            continue
        content_full = (("%s\n%s" % (heading, body)).strip()) if heading else body
        for part_i, piece in enumerate(_split_long(content_full, max_chars)):
            row = heading or "section %d" % idx
            if len(_split_long(content_full, max_chars)) > 1:
                row = "%s (part %d)" % (row, part_i + 1)
            out.append(Chunk(
                content=piece,
                chunk_type="manual",
                uns_path=uns_prefix,
                source_file=source_file,
                source_row=row,
                metadata={"heading": heading, "section_index": idx},
            ))
    return out


def chunk_pdf(path: str | Path, uns_prefix: str = "", max_chars: int = 1500) -> list[Chunk]:
    """Convert a PDF to markdown via Docling, then chunk it. Docling is imported lazily so the
    markdown path (and the test suite) never need it. Raises a clear error if Docling is absent —
    this is the infra-gated path for a real vendor manual PDF."""
    path = Path(path)
    try:
        from docling.document_converter import DocumentConverter  # type: ignore
    except ImportError as exc:  # pragma: no cover - infra-gated
        raise RuntimeError(
            "Docling is not installed — the PDF manual path needs it. "
            "Install docling, or pre-convert the PDF to markdown and use chunk_markdown()."
        ) from exc
    md = DocumentConverter().convert(str(path)).document.export_to_markdown()  # pragma: no cover
    return chunk_markdown(md, source_file=path.name, uns_prefix=uns_prefix, max_chars=max_chars)


def parse_asset_uns_table(text: str, uns_prefix: str = "") -> dict[int, str]:
    """Extract `asset_uns_by_id` from a markdown table that has an 'Asset ID' column and a
    'UNS Path' column (the Vessel spec's asset-to-path mapping). Returns {assetid: dotted_uns_path}.

    `uns_prefix` is prepended (dotted) when the doc path is relative; a doc path that already starts
    with the prefix's first segment is taken as-is. Rows without a numeric Asset ID are skipped.
    """
    out: dict[int, str] = {}
    rows = _markdown_table_rows(text)
    for header, cells in rows:
        id_i = _col_index(header, ("asset id", "assetid"))
        path_i = _col_index(header, ("uns path", "uns", "path"))
        if id_i is None or path_i is None:
            continue
        for cell_row in cells:
            if max(id_i, path_i) >= len(cell_row):
                continue
            raw_id = cell_row[id_i].strip()
            if not raw_id.isdigit():
                continue
            path = uns_path_from_doc(cell_row[path_i])
            if not path:
                continue
            prefix = slug(uns_prefix) if uns_prefix else ""
            if prefix and not path.startswith(prefix.split(".")[0]):
                path = "%s.%s" % (prefix, path)
            out[int(raw_id)] = path
    return out


# --------------------------------------------------------------------------- helpers


def _split_sections(text: str) -> list[tuple[str, str]]:
    """Return [(heading_line_or_'', body_text)] segments split at markdown headings."""
    lines = text.splitlines()
    sections: list[tuple[str, list[str]]] = []
    cur_head = ""
    cur_body: list[str] = []
    for ln in lines:
        m = _HEADING.match(ln)
        if m:
            if cur_head or cur_body:
                sections.append((cur_head, cur_body))
            cur_head = ln.strip()
            cur_body = []
        else:
            cur_body.append(ln)
    if cur_head or cur_body:
        sections.append((cur_head, cur_body))
    return [(h, "\n".join(b)) for h, b in sections]


def _split_long(text: str, max_chars: int) -> list[str]:
    """Split an over-long section on blank-line (paragraph) boundaries, greedily packing paragraphs
    up to max_chars. A single paragraph longer than max_chars is kept whole (don't sever a sentence)."""
    if len(text) <= max_chars:
        return [text]
    paras = re.split(r"\n\s*\n", text)
    out: list[str] = []
    buf = ""
    for p in paras:
        if not buf:
            buf = p
        elif len(buf) + len(p) + 2 <= max_chars:
            buf = "%s\n\n%s" % (buf, p)
        else:
            out.append(buf)
            buf = p
    if buf:
        out.append(buf)
    return out or [text]


def _markdown_table_rows(text: str) -> list[tuple[list[str], list[list[str]]]]:
    """Find every markdown pipe-table; return [(header_cells, [data_row_cells, ...])]. The
    separator row (`|---|---|`) is skipped."""
    tables: list[tuple[list[str], list[list[str]]]] = []
    header: list[str] | None = None
    body: list[list[str]] = []
    for ln in text.splitlines():
        m = _TABLE_ROW.match(ln)
        if not m:
            if header is not None:
                tables.append((header, body))
            header, body = None, []
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if header is None:
            header = [c.lower() for c in cells]
        elif set(cells[0]) <= {"-", ":", " "} and all(set(c) <= {"-", ":", " "} for c in cells):
            continue  # separator row
        else:
            body.append(cells)
    if header is not None:
        tables.append((header, body))
    return tables


def _col_index(header: list[str], names: tuple[str, ...]) -> int | None:
    for i, h in enumerate(header):
        if h in names:
            return i
    return None
