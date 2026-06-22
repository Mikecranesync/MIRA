"""ProveIt buildout CLI — run the offline import + grounding transforms end-to-end, DRY RUN.

This ties the three offline bricks together into one command and writes a report of exactly what
WOULD be ingested, WITHOUT touching NeonDB:

    1. Ignition tag-JSON  -> ISA-95 namespace        (mira_plc_parser import engine)
    2. Pilot DB export     -> citable work-order/item/state chunks   (pilot_db_chunks)
    3. Manual / spec docs  -> citable manual chunks + asset roster   (manual_chunks)

The asset roster parsed from a Vessel-spec table (Asset ID -> UNS Path) is fed back into the Pilot DB
transform so work-order chunks ground to real vat UNS paths. Every emitted knowledge_entries row is
`is_private=True` (per-tenant corpus). NOTHING is embedded or written here — embed (nomic) + insert
into `knowledge_entries` is the infra-gated next step (needs the DB + the provisioned tenant).

Usage:
    python tools/proveit/cli.py report <CORPUS_DIR> --tenant proveit [--out DIR]
    python tools/proveit/cli.py report <CORPUS_DIR> --tags <tags.json> --pilot-db <dir> --manual <spec.md> ...

Read-only. The licensed corpus is never written back; only the report (counts + samples) is emitted.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import manual_chunks as mc
import pilot_db_chunks as pdc

_REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_import_engine():
    """Lazy-add the parser package to sys.path and import it (kept out of import-time so the
    transforms stay importable on their own)."""
    pkg = _REPO_ROOT / "mira-plc-parser"
    if pkg.exists() and str(pkg) not in sys.path:
        sys.path.insert(0, str(pkg))
    import mira_plc_parser as engine  # noqa: PLC0415
    return engine


# --------------------------------------------------------------------------- discovery


def discover(corpus_dir: Path) -> dict[str, object]:
    """Auto-locate the three inputs under a corpus dir: the Ignition tags.json, the Pilot DB export
    directory, and candidate manual/spec markdown files."""
    tags = next((p for p in corpus_dir.rglob("tags.json")), None)
    pilot_db = None
    for p in corpus_dir.rglob("*workordermanagement*.json"):
        pilot_db = p.parent
        break
    # Match the keywords against the path RELATIVE to the corpus (not just the filename) so a spec
    # that lives as `Vessel Specs/readme.md` — the asset-id→UNS table that grounds the work orders —
    # is found even though its filename is a bare `readme.md`.
    keys = ("vessel", "spec", "manual", "technical", "datasheet")
    manuals = [p for p in corpus_dir.rglob("*.md")
               if any(k in str(p.relative_to(corpus_dir)).lower() for k in keys)]
    return {"tags": tags, "pilot_db": pilot_db, "manuals": sorted(manuals)}


# --------------------------------------------------------------------------- report


def build_report(
    tenant_id: str,
    tags_path: Path | None = None,
    pilot_db_dir: Path | None = None,
    manual_paths: list[Path] | None = None,
    uns_prefix: str = "",
) -> dict:
    """Run all three transforms and return a JSON-safe dry-run report dict. No DB I/O."""
    manual_paths = manual_paths or []
    report: dict = {
        "schema": "proveit/dry-run-report@1",
        "tenant_id": tenant_id,
        "dry_run": True,
        "note": "No NeonDB writes. embed(nomic)+insert_knowledge_entries_batch is the infra step.",
        "inputs": {
            "tags": str(tags_path) if tags_path else None,
            "pilot_db": str(pilot_db_dir) if pilot_db_dir else None,
            "manuals": [str(p) for p in manual_paths],
        },
    }

    # 1. Ignition import -> namespace
    if tags_path and tags_path.exists():
        engine = _load_import_engine()
        result = engine.run(str(tags_path), tags_path.read_text(encoding="utf-8-sig"))
        rj = engine.render_json(result)
        report["namespace"] = {
            "handled": rj.get("handled", False),
            "counts": rj.get("counts", {}),
            "uns_prefix": rj.get("uns_prefix", {}),
        }
        if not uns_prefix:
            pref = rj.get("uns_prefix", {})
            uns_prefix = ".".join(str(v) for v in pref.values() if v) if isinstance(pref, dict) else ""

    # 2b. Asset roster from the manuals (parsed first so Pilot DB WOs can ground to real vat paths)
    roster: dict[int, str] = {}
    for mp in manual_paths:
        if mp.exists():
            roster.update(mc.parse_asset_uns_table(mp.read_text(encoding="utf-8-sig"), uns_prefix))
    report["asset_roster_size"] = len(roster)

    all_rows: list[dict] = []

    # 2a. Pilot DB -> chunks
    if pilot_db_dir and pilot_db_dir.exists():
        db = pdc.load_pilot_db(pilot_db_dir)
        chunks = pdc.build_chunks(db, uns_prefix=uns_prefix, asset_uns_by_id=roster)
        rows = pdc.to_knowledge_entry_rows(chunks, tenant_id=tenant_id)
        all_rows.extend(rows)
        grounded = sum(1 for c in chunks
                       if c.chunk_type == "work_order" and c.uns_path and c.uns_path != uns_prefix)
        wo_total = sum(1 for c in chunks if c.chunk_type == "work_order")
        report["pilot_db"] = {
            "rows": {
                "items": len(db.get("items", [])), "lots": len(db.get("lots", [])),
                "work_orders": len(db.get("work_orders", [])), "states": len(db.get("states", [])),
            },
            "chunks": _count_by_type(chunks),
            "work_orders_grounded_to_asset": grounded,
            "work_orders_total": wo_total,
        }

    # 3. Manuals -> chunks
    if manual_paths:
        manual_summary = []
        for mp in manual_paths:
            if not mp.exists():
                continue
            chunks = mc.chunk_markdown(mp.read_text(encoding="utf-8-sig"),
                                       source_file=mp.name, uns_prefix=uns_prefix)
            rows = mc.to_knowledge_entry_rows(chunks, tenant_id=tenant_id,
                                              source_type="proveit_manual")
            all_rows.extend(rows)
            manual_summary.append({"file": mp.name, "chunks": len(chunks)})
        report["manuals"] = manual_summary

    # Aggregate what WOULD be inserted
    report["knowledge_entries"] = {
        "total_rows": len(all_rows),
        "all_is_private": all(r["is_private"] is True for r in all_rows),
        "all_unembedded": all(r["embedding"] is None for r in all_rows),
        "by_chunk_type": _count_rows_by(all_rows, "chunk_type"),
        "by_source_type": _count_rows_by(all_rows, "source_type"),
        "sample": [_sample_row(r) for r in all_rows[:3]],
    }
    return report


def _count_by_type(chunks) -> dict:
    out: dict[str, int] = {}
    for c in chunks:
        out[c.chunk_type] = out.get(c.chunk_type, 0) + 1
    return out


def _count_rows_by(rows: list[dict], key: str) -> dict:
    out: dict[str, int] = {}
    for r in rows:
        out[str(r.get(key))] = out.get(str(r.get(key)), 0) + 1
    return out


def _sample_row(r: dict) -> dict:
    return {
        "id": r["id"], "chunk_type": r["chunk_type"], "is_private": r["is_private"],
        "isa95_path": r["isa95_path"], "source_url": r["source_url"], "source_page": r["source_page"],
        "content": (r["content"][:160] + "...") if len(r["content"]) > 160 else r["content"],
    }


def render_report_md(report: dict) -> str:
    lines = ["# ProveIt dry-run ingestion report", ""]
    lines.append("> **DRY RUN — no NeonDB writes.** %s" % report.get("note", ""))
    lines.append("")
    lines.append("- Tenant: `%s`" % report["tenant_id"])
    inp = report["inputs"]
    lines.append("- Tags: `%s`" % inp["tags"])
    lines.append("- Pilot DB: `%s`" % inp["pilot_db"])
    lines.append("- Manuals: %s" % (", ".join("`%s`" % m for m in inp["manuals"]) or "(none)"))
    lines.append("- Asset roster (id→UNS): **%d**" % report.get("asset_roster_size", 0))
    lines.append("")
    if "namespace" in report:
        c = report["namespace"]["counts"]
        lines.append("## ISA-95 namespace (Ignition import)")
        lines.append("- enterprises %s · sites %s · areas %s · lines %s · assets %s · signals %s" % (
            c.get("enterprises"), c.get("sites"), c.get("areas"), c.get("lines"),
            c.get("assets"), c.get("signals")))
        lines.append("")
    if "pilot_db" in report:
        p = report["pilot_db"]
        lines.append("## Pilot DB grounding")
        lines.append("- source rows: %s items · %s lots · %s work orders · %s states" % (
            p["rows"]["items"], p["rows"]["lots"], p["rows"]["work_orders"], p["rows"]["states"]))
        lines.append("- chunks: %s" % ", ".join("%s=%d" % (k, v) for k, v in p["chunks"].items()))
        lines.append("- work orders grounded to a vat UNS path: **%d / %d**" % (
            p["work_orders_grounded_to_asset"], p["work_orders_total"]))
        lines.append("")
    if "manuals" in report:
        lines.append("## Manual grounding")
        for m in report["manuals"]:
            lines.append("- `%s`: %d chunks" % (m["file"], m["chunks"]))
        lines.append("")
    k = report["knowledge_entries"]
    lines.append("## knowledge_entries that WOULD be inserted")
    lines.append("- **total rows: %d** · all is_private=%s · all unembedded=%s" % (
        k["total_rows"], k["all_is_private"], k["all_unembedded"]))
    lines.append("- by chunk_type: %s" % ", ".join("%s=%d" % (kk, vv)
                                                    for kk, vv in k["by_chunk_type"].items()))
    lines.append("")
    lines.append("Next (infra): embed each row (nomic-embed) → `insert_knowledge_entries_batch` "
                 "(honors `is_private=True`) into NeonDB `knowledge_entries` for the provisioned tenant.")
    return "\n".join(lines)


# --------------------------------------------------------------------------- argparse


def _cmd_report(ns: argparse.Namespace) -> int:
    corpus = Path(ns.corpus).expanduser()
    found = discover(corpus) if corpus.exists() else {"tags": None, "pilot_db": None, "manuals": []}
    tags = Path(ns.tags) if ns.tags else found["tags"]
    pilot_db = Path(ns.pilot_db) if ns.pilot_db else found["pilot_db"]
    manuals = [Path(m) for m in ns.manual] if ns.manual else list(found["manuals"])

    report = build_report(ns.tenant, tags_path=tags, pilot_db_dir=pilot_db,
                          manual_paths=manuals, uns_prefix=ns.uns_prefix or "")

    out_dir = Path(ns.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "proveit-dry-run.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    md = render_report_md(report)
    (out_dir / "proveit-dry-run.md").write_text(md, encoding="utf-8")
    if not ns.quiet:
        print(md)
        print("\nWrote %s/proveit-dry-run.{json,md}" % out_dir)
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="proveit", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("report", help="Run all transforms end-to-end and write a dry-run report.")
    p.add_argument("corpus", help="Corpus directory to auto-discover inputs under (e.g. the "
                                  "'Enterprise B' folder). Explicit --tags/--pilot-db/--manual override.")
    p.add_argument("--tenant", default="proveit", help="Tenant id for the emitted rows.")
    p.add_argument("--tags", default="", help="Path to the Ignition tags.json (override discovery).")
    p.add_argument("--pilot-db", default="", help="Path to the Pilot DB export dir (override).")
    p.add_argument("--manual", action="append", default=[], help="Manual/spec doc (repeatable).")
    p.add_argument("--uns-prefix", default="", help="Override the UNS prefix for grounding.")
    p.add_argument("--out", default=".", help="Directory to write the report into.")
    p.add_argument("--quiet", action="store_true", help="Suppress stdout.")
    p.set_defaults(func=_cmd_report)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    ns = parser.parse_args(argv)
    return ns.func(ns)


if __name__ == "__main__":
    raise SystemExit(main())
