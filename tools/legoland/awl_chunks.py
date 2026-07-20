"""LEGOLAND FL Siemens AWL exports -> citable knowledge chunks (offline transform).

The T7 recovery drive (2026-07-19 inventory) carries 50 plain-text Siemens STEP 7 AWL sources for
LEGOLAND Florida attraction control systems (Chima, Technic Test Track x2, Aquazone). Two shapes
matter for maintenance Q&A:

    1. Alarm/fault data blocks (Technic style) — declarations carry the HMI alarm text in comments:
           Alarm0059 :BOOL:=0; // #59 Fault Block 1 -A1 VFD FAULT
       That text is the fault glossary a technician asks about ("what is fault 59 on block 1?").
    2. Logic blocks (Chima style) — FUNCTION_BLOCK/ORGANIZATION_BLOCK sources whose NETWORK sections
       carry titles, comments, and cabinet-sheet-device symbol references ("I_GEN_08_S51").

This module is a PURE, offline transform on the ProveIt pattern (tools/proveit/pilot_db_chunks.py):
read AWL text -> emit `Chunk`s -> shape rows for
`mira-core/mira-ingest/db/neon.insert_knowledge_entries_batch`. It does NOT embed or write to
NeonDB. Every row is `is_private=True` (per-tenant ride corpus, NOT the shared OEM library — see
`.claude/rules/knowledge-entries-tenant-scoping.md`). The proprietary corpus is never committed;
tests run on synthetic fixtures.

Alarm parsing is NOT reimplemented here — it reuses the merged Siemens AWL parser
(`mira-plc-parser/mira_plc_parser/parsers/siemens_awl.py`, PR #2724) via the same lazy sys.path
shim `tools/proveit/cli.py` uses.

Read-only. stdlib-only at import time.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]

_BLOCK_HEADER_RE = re.compile(
    r'^\s*(?P<kind>ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)\s+"?(?P<name>[\w$.]+)"?',
    re.M,
)
_TITLE_RE = re.compile(r"^TITLE\s*=(?P<title>.*)$", re.M)
_SYMBOL_RE = re.compile(r'"(?P<sym>[A-Za-z_][\w./$]*)"')
# Generic commented scalar member of a DATA_BLOCK STRUCT — covers what the upstream parser's
# Alarm####-only regex misses: Aquazone's German `Flt10 : BOOL ; //fault Bridge Sensor 1` fault
# DBs AND Technic's `T_0_A1_FAULT : S5TIME:=S5T#2000MS; // delay monitoring ...` setpoint DBs
# (the initializer IS the setpoint a technician asks about).
_DB_MEMBER_RE = re.compile(
    r"^\s*(?P<name>[A-Za-z_]\w*)\s*:\s*(?P<type>[A-Za-z]\w*)\s*"
    r"(?::=\s*(?P<init>[^;]+?))?\s*;\s*//\s*(?P<comment>.+?)\s*$",
    re.M,
)


def _load_uns():
    """Lazy-import the canonical UNS path builders (`mira-crawler/ingest/uns.py`) — the ONLY
    allowed source of `enterprise.*` paths (.claude/rules/uns-compliance.md)."""
    pkg = _REPO_ROOT / "mira-crawler"
    if pkg.exists() and str(pkg) not in sys.path:
        sys.path.insert(0, str(pkg))
    from ingest import uns  # noqa: PLC0415

    return uns


# The LEGOLAND FL ride corpus grounds under company=legoland, site=florida; each ride is an
# ISA-95 area and each S7 station (the STEP 7 project name) is the equipment instance.
_COMPANY = "legoland"
_SITE = "florida"


def ride_uns_path(ride: str, station: str) -> str:
    """`enterprise.legoland.site.florida.area.<ride>.equipment.<station>`."""
    uns = _load_uns()
    return uns.assigned_equipment_path(_COMPANY, _SITE, ride, station)


def block_uns_path(ride: str, station: str, block: str) -> str:
    """The equipment path + `.plc_block.<block>` (literal subnode, like `component`)."""
    uns = _load_uns()
    return uns.equipment_subnode_path(ride_uns_path(ride, station), "plc_block", block)


def _load_awl_parser():
    """Lazy-import the merged Siemens AWL parser (PR #2724) from the mira-plc-parser package."""
    pkg = _REPO_ROOT / "mira-plc-parser"
    if pkg.exists() and str(pkg) not in sys.path:
        sys.path.insert(0, str(pkg))
    from mira_plc_parser.parsers import siemens_awl  # noqa: PLC0415

    return siemens_awl


@dataclass
class Chunk:
    """One citable knowledge chunk: human-readable text + where it came from + structured metadata."""

    content: str
    chunk_type: str  # "plc_fault_glossary" | "plc_block_network"
    uns_path: str = ""  # ISA-95 path this chunk grounds to (dot ltree)
    source_file: str = ""  # provenance: which AWL export file
    source_row: str = ""  # provenance: block + entry range / network number
    metadata: dict = field(default_factory=dict)


def build_fault_glossary_chunks(
    text: str,
    source_file: str = "",
    uns_prefix: str = "",
    batch_size: int = 40,
) -> list[Chunk]:
    """Alarm-DB declarations -> fault-glossary chunks (batched so one DB doesn't blow a chunk).

    Two shapes are covered: `Alarm####` declarations (via the upstream parser) and, as a fallback
    for DATA_BLOCK sources only, any commented BOOL STRUCT member (Aquazone's German
    `Flt10 : BOOL ; //fault Bridge Sensor 1` style, which the Alarm####-only upstream regex
    misses). Returns [] when neither yields entries (logic blocks go to `build_network_chunks`).
    """
    parser = _load_awl_parser()
    proj = parser.parse(text, source_file=source_file)
    ctrl = proj.controllers[0]
    block = ctrl.name
    entries = [(t.name, t.description) for t in ctrl.tags]
    if not entries:
        header = _BLOCK_HEADER_RE.search(text)
        if not header or header.group("kind") != "DATA_BLOCK":
            return []
        block = header.group("name")
        entries = [
            (_member_label(m), _clean_comment(m.group("comment")))
            for m in _DB_MEMBER_RE.finditer(text)
        ]
        if not entries:
            return []

    out: list[Chunk] = []
    for start in range(0, len(entries), batch_size):
        batch = entries[start : start + batch_size]
        lines = [
            "Fault/alarm glossary from PLC data block %s (Siemens STEP 7 AWL source), entries %d-%d of %d:"
            % (block, start, start + len(batch) - 1, len(entries))
        ]
        lines.extend("- %s — %s" % (name, desc) for name, desc in batch)
        out.append(
            Chunk(
                content="\n".join(lines),
                chunk_type="plc_fault_glossary",
                uns_path=uns_prefix,
                source_file=source_file,
                source_row="%s[%d:%d]" % (block, start, start + len(batch)),
                # alarm_count = total commented entries in the block (more useful than per-batch)
                metadata={"block": block, "alarm_count": len(entries)},
            )
        )
    return out


def _clean_comment(comment: str) -> str:
    """Same normalization as the upstream parser: `$N` is an HMI line break, not text."""
    return " ".join(comment.replace("$N", " ").split())


def _member_label(m: re.Match) -> str:
    """`T_0_A1_FAULT (S5TIME := S5T#2000MS)` — the initializer is the setpoint, keep it citable."""
    init = (m.group("init") or "").strip()
    if init:
        return "%s (%s := %s)" % (m.group("name"), m.group("type"), init)
    return "%s (%s)" % (m.group("name"), m.group("type"))


def build_network_chunks(text: str, source_file: str = "", uns_prefix: str = "") -> list[Chunk]:
    """Logic-block NETWORK sections -> one citable chunk each (title + comments + symbol refs).

    Returns [] for sources with no NETWORK sections (alarm DBs go to
    `build_fault_glossary_chunks` instead). The raw STL body is NOT emitted — the maintenance
    value is the network title, the engineer's comments, and which cabinet-sheet-device symbols
    the network references (the print<->PLC join key, e.g. `I_GEN_08_S51`).
    """
    header = _BLOCK_HEADER_RE.search(text)
    block_name = header.group("name") if header else Path(source_file).stem or "unknown"
    block_kind = header.group("kind") if header else "BLOCK"

    parts = re.split(r"^\s*NETWORK\s*$", text, flags=re.M)
    if len(parts) < 2:
        return []

    out: list[Chunk] = []
    for idx, body in enumerate(parts[1:], start=1):
        title_m = _TITLE_RE.search(body)
        title = (title_m.group("title").strip() if title_m else "").strip()
        comments = [
            c
            for c in (
                line.strip().lstrip("/").strip()
                for line in body.splitlines()
                if line.strip().startswith("//")
            )
            if c
        ]
        symbols: list[str] = []
        for sym in _SYMBOL_RE.findall(body):
            if sym not in symbols:
                symbols.append(sym)

        lines = [
            "PLC logic — block %s (%s, Siemens STEP 7 AWL source), network %d%s"
            % (block_name, block_kind, idx, (": %s" % title) if title else "")
        ]
        if comments:
            lines.append("Comments: " + " | ".join(comments))
        if symbols:
            lines.append("References: " + ", ".join(symbols))
        out.append(
            Chunk(
                content="\n".join(lines),
                chunk_type="plc_block_network",
                uns_path=uns_prefix,
                source_file=source_file,
                source_row="%s network %d" % (block_name, idx),
                metadata={
                    "block": block_name,
                    "block_kind": block_kind,
                    "network": idx,
                    "symbols": symbols,
                },
            )
        )
    return out


def to_knowledge_entry_rows(
    chunks: list[Chunk],
    tenant_id: str,
    source_type: str = "legoland_awl",
) -> list[dict]:
    """Shape chunks into `insert_knowledge_entries_batch` row dicts (ProveIt pattern).

    `embedding` is left None — filled by the (infra-gated) embed step before insert. Rows are
    `is_private=True` (this is the ride tenant's own PLC corpus, NOT the shared OEM library — see
    `.claude/rules/knowledge-entries-tenant-scoping.md`). `id` is deterministic (content hash) so
    re-runs de-duplicate instead of duplicating.
    """
    rows: list[dict] = []
    seen: set[str] = set()
    for ch in chunks:
        # uns_path is in the hash: the same exported block grounded to two rides is two rows;
        # the same block re-ingested for the same ride collapses to one.
        digest = hashlib.sha256(
            ("%s|%s|%s" % (tenant_id, ch.uns_path, ch.content)).encode("utf-8")
        ).hexdigest()
        row_id = "awl_%s" % digest[:24]
        if row_id in seen:
            continue
        seen.add(row_id)
        rows.append(
            {
                "id": row_id,
                "tenant_id": tenant_id,
                "source_type": source_type,
                "manufacturer": "Siemens",
                "model_number": None,
                "content": ch.content,
                "embedding": None,  # filled by the embed step (infra)
                "source_url": "awl:%s" % ch.source_file,
                "source_page": ch.source_row,
                "metadata": json.dumps(ch.metadata, ensure_ascii=False),
                "chunk_type": ch.chunk_type,
                "isa95_path": ch.uns_path or None,
                "equipment_id": None,
                "data_type": "manual",
                "is_private": True,
            }
        )
    return rows


# --------------------------------------------------------------------------- corpus tree walk

# Top-level T7 folder -> ride name. Fallback: the folder name itself (uns.slug normalizes it).
_RIDE_DIRS = {
    "CHIMA_LEGOLAND_FLORIDA_2013_07_01": "Chima",
    "Aquazone": "Aquazone",
    "Technic Test Track": "Technic Test Track",
    "MERLINS": "Merlins",
}


def _ride_and_station(rel_path: Path) -> tuple[str, str]:
    """Infer (ride, station) from a corpus-relative AWL path.

    Layout on the drive: `<ride dir>/.../<station>/s7asrcom/<nnn>/<file>.AWL` — the station is the
    STEP 7 project directory holding `s7asrcom`.
    """
    parts = rel_path.parts
    ride = _RIDE_DIRS.get(parts[0], parts[0])
    station = ""
    for i, part in enumerate(parts):
        if part.lower() == "s7asrcom" and i > 0:
            station = parts[i - 1]
            break
    return ride, station or "unknown_station"


def build_chunks_for_file(text: str, ride: str, station: str, source_file: str) -> list[Chunk]:
    """One exported block per file (verified corpus-wide), routed by block kind: DATA_BLOCK ->
    fault glossary; logic blocks (FB/OB/FC) -> network chunks. Kind-based routing keeps a
    commented BOOL in a logic block's VAR section from misrouting the file into a glossary.
    Each chunk grounds to the block's UNS subnode."""
    header = _BLOCK_HEADER_RE.search(text)
    if header and header.group("kind") == "DATA_BLOCK":
        chunks = build_fault_glossary_chunks(text, source_file=source_file)
    else:
        chunks = build_network_chunks(text, source_file=source_file)
    for ch in chunks:
        ch.uns_path = block_uns_path(ride, station, ch.metadata["block"])
    return chunks


def _walk_corpus(root: Path) -> list[tuple[str, list[Chunk]]]:
    """Walk a corpus tree for `*.AWL` sources; one (relative path, chunks) pair per file."""
    out: list[tuple[str, list[Chunk]]] = []
    for path in sorted(root.rglob("*")):
        if not (path.is_file() and path.suffix.lower() == ".awl"):
            continue
        rel = path.relative_to(root)
        ride, station = _ride_and_station(rel)
        text = path.read_text(encoding="latin-1", errors="replace")
        out.append((str(rel), build_chunks_for_file(text, ride, station, source_file=str(rel))))
    return out


def build_corpus_chunks(root: str | Path) -> list[Chunk]:
    """Walk a corpus tree for `*.AWL` sources and emit grounded chunks. Read-only."""
    return [ch for _, chunks in _walk_corpus(Path(root)) for ch in chunks]


def build_report(root: str | Path, tenant_id: str) -> dict:
    """Dry-run report: what WOULD be ingested, without touching NeonDB. Files that yield no
    chunks are NAMED (`files_empty`) — silent truncation reads as "covered everything"."""
    per_file = _walk_corpus(Path(root))
    chunks = [ch for _, file_chunks in per_file for ch in file_chunks]
    rows = to_knowledge_entry_rows(chunks, tenant_id=tenant_id)
    by_type: dict[str, int] = {}
    for ch in chunks:
        by_type[ch.chunk_type] = by_type.get(ch.chunk_type, 0) + 1
    rides = sorted(
        {
            r["isa95_path"].split(".area.")[1].split(".")[0]
            for r in rows
            if r["isa95_path"] and ".area." in r["isa95_path"]
        }
    )
    return {
        "files_scanned": len(per_file),
        "chunks": by_type,
        "rows": len(rows),
        "rides": rides,
        "files_empty": [rel for rel, file_chunks in per_file if not file_chunks],
        "sample": chunks[0].content if chunks else "",
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description="LEGOLAND AWL -> knowledge chunks (dry-run report)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    rep = sub.add_parser("report", help="walk a corpus dir and report what WOULD be ingested")
    rep.add_argument("root", help="corpus root (e.g. '/Volumes/T7/Siemens Computer')")
    rep.add_argument("--tenant", required=True, help="owning tenant id (rows are is_private=true)")
    rep.add_argument("--out", help="write full JSON report here (default: stdout summary only)")
    args = ap.parse_args(argv)

    report = build_report(args.root, tenant_id=args.tenant)
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(json.dumps({k: v for k, v in report.items() if k != "sample"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
