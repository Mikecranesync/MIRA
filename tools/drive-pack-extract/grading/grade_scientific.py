"""CLI — the scientific (weighted 0-100 / A-F) grade for a drive pack.

Runs the same four measurement layers as ``grade.py`` (schema / cite / gold /
domain) and then scores them into the eight-category scientific rubric
(``scientific.py``), writing ``scientific_report.json`` + ``scientific_report.md``.
Exits non-zero when the pack is NOT promotable (any critical failure, an
incomplete grade, or a band below B), so it can gate a promotion PR.

Usage:
    python grade_scientific.py --pack powerflex_525 --gold ../gold/powerflex_525/gold.json \\
        [--manual path/to/manual.pdf] [--out grading_out] [--packs-dir DIR]

``--gold`` is OPTIONAL here (unlike ``grade.py``): a pack with no gold set
(e.g. the GS10 pack) is graded on its gold-INDEPENDENT categories only —
provenance, citation fidelity, safety — with coverage/accuracy categories marked
N/A and the result flagged INCOMPLETE + not promotable (the honest "cannot be
scientifically graded without a reference" verdict).

``--packs-dir`` defaults to the STAGED CANDIDATE dir; pass the live
``mira-bots/shared/drive_packs/packs`` to grade a promoted pack in place.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

from cite_check import check_citations
from domain_rules import check_domain
from gold_score import score_against_gold
from report import LayerResult
from schema_check import check_schema
from scientific import grade_scientifically, render_scientific_markdown

logger = logging.getLogger("drive-pack-extract.grading.grade_scientific")

_THIS_DIR = Path(__file__).resolve().parent
_TOOL_DIR = _THIS_DIR.parent
_DEFAULT_PACKS_DIR = _TOOL_DIR / "candidates"

_EMPTY_GOLD_RESULT = LayerResult(
    name="gold_score",
    status="skipped",
    summary="no gold set supplied — coverage/accuracy not scored",
    details=[],
    metrics={},
)


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scientifically grade a drive pack (0-100 / A-F).")
    parser.add_argument("--pack", required=True, help="pack_id, e.g. powerflex_525")
    parser.add_argument("--gold", default=None, help="path to gold/<family>/gold.json (optional)")
    parser.add_argument("--manual", default=None, help="path to the source manual PDF")
    parser.add_argument("--out", default=None, help="output dir (default: ./grading_out)")
    parser.add_argument("--packs-dir", default=None, help="override the packs/ directory")
    parser.add_argument("--generated-at", default="unknown", help="timestamp string for the report")
    return parser.parse_args(argv)


def _write(report: dict[str, Any], out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "scientific_report.json"
    md_path = out_dir / "scientific_report.md"
    json_path.write_text(json.dumps(report, indent=2, sort_keys=False), encoding="utf-8")
    md_path.write_text(render_scientific_markdown(report), encoding="utf-8")
    return json_path, md_path


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = _parse_args(argv)

    packs_dir = Path(args.packs_dir) if args.packs_dir else _DEFAULT_PACKS_DIR
    out_dir = Path(args.out) if args.out else Path.cwd() / "grading_out"

    pack_path = packs_dir / args.pack / "pack.json"
    pack_dict = _load_json(pack_path)

    # Resolve the gold set. If --gold wasn't passed, AUTO-DISCOVER the
    # conventional gold/<pack_id>/gold.json so a reviewer can't accidentally
    # grade a pack that HAS a gold set on gold-independent categories only and
    # get a misleadingly low "no gold set" / INCOMPLETE verdict. --gold always
    # overrides; a pack with no gold file is still graded gold-independent.
    gold_path = Path(args.gold) if args.gold else _TOOL_DIR / "gold" / args.pack / "gold.json"
    if gold_path.is_file():
        gold_dict = _load_json(gold_path)
        if not args.gold:
            logger.info("auto-discovered gold set %s (pass --gold to override)", gold_path)
    elif args.gold:
        raise FileNotFoundError(f"--gold {args.gold} not found")
    else:
        gold_dict = None
        logger.info("no gold set for %s — grading gold-independent categories only", args.pack)
    manual_path = Path(args.manual) if args.manual else None

    schema_result = check_schema(args.pack, packs_dir=str(packs_dir))
    cite_result = check_citations(pack_dict, manual_path, gold=gold_dict)
    gold_result = score_against_gold(pack_dict, gold_dict) if gold_dict else _EMPTY_GOLD_RESULT
    domain_result = check_domain(pack_dict)

    report = grade_scientifically(
        pack_id=args.pack,
        pack_dict=pack_dict,
        gold_dict=gold_dict,
        schema_result=schema_result,
        cite_result=cite_result,
        gold_result=gold_result,
        domain_result=domain_result,
        generated_at=args.generated_at,
    )

    json_path, md_path = _write(report, out_dir)

    print(f"grade: {report['grade']} ({report['overall_score']}/100)"
          + (" INCOMPLETE" if report["incomplete"] else ""))
    print(f"promotion: {report['promotion_recommendation']}")
    for cf in report["critical_failures"]:
        print(f"  critical: {cf}")
    print(f"report written: {json_path}")
    print(f"report written: {md_path}")

    return 0 if report["promotable"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
