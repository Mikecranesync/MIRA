"""PrintSense CLI — interpret a print photo/PDF from this machine, right now.

The on-the-job entry point: point it at one or more photos (or a PDF) of an
electrical print and get back the technician brief, the typed PrintSynth graph,
and the deterministic gate verdict — no Telegram, no VPS, no Hub required.

    doppler run -p factorylm -c stg -- py -3 -m printsense C:/path/photo.jpg \
        --question "why would the heater circuit be dead?"

Reuses the shipped pipeline end-to-end (no forked logic): ``interpret_print``
(preprocess + Anthropic vision) -> ``render`` (brief / map) -> ``grade_case``
(rubric-less: structural gates + import verdict). Multiple input files are ONE
package (a multi-sheet print set), matching ``interpret_print(pages=[...])``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .grade_case import grade_case
from .interpret import PrintVisionUnavailable, interpret_print
from .render import format_graph_for_telegram, format_map_for_telegram

#: extension -> Anthropic media type (images Claude vision accepts, plus PDF).
MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
}

# Exit codes: 0 ok · 2 usage/input error · 3 provider not configured · 1 unexpected.
EXIT_OK = 0
EXIT_USAGE = 2
EXIT_UNAVAILABLE = 3


def _load_pages(paths: list[Path]) -> list[tuple[bytes, str]]:
    """Read each input into ``(bytes, media_type)`` or raise ``ValueError``."""
    pages: list[tuple[bytes, str]] = []
    for p in paths:
        if not p.is_file():
            raise ValueError(f"input not found: {p}")
        media = MEDIA_TYPES.get(p.suffix.lower())
        if media is None:
            supported = ", ".join(sorted(MEDIA_TYPES))
            raise ValueError(
                f"unsupported file type {p.suffix!r} ({p.name}) — use one of: {supported}"
            )
        pages.append((p.read_bytes(), media))
    return pages


def _interpret_with_recall(pages: list[tuple[bytes, str]], args):
    """``--recall`` path: reuse a prior interpretation of the same print when possible.

    Lazily imports the Materialized Evidence layer + CAS so the default (non-recall)
    CLI path pulls in nothing new. Reports a recall hit/miss on stderr; the graph is
    materialized on a miss so the next identical run recalls it (no model call).
    """
    from materialized_evidence import Environment  # noqa: PLC0415 -- lazy: only on --recall
    from materialized_evidence.backends import FileRegistry  # noqa: PLC0415

    from .cas import CAS  # noqa: PLC0415
    from .recall import interpret_print_with_recall  # noqa: PLC0415

    store = args.recall_store
    graph, info = interpret_print_with_recall(
        pages,
        registry=FileRegistry(store / "registry.json"),
        cas=CAS(store / "cas"),
        environment=Environment.DEV,
        question=args.question,
        preprocess=not args.no_preprocess,
    )
    if info.recalled:
        print(
            f"[printsense] recall HIT — reused {info.dataset_version_id} "
            f"(no model call; avoided ~{info.avoided_compute_ms} ms of vision compute)",
            file=sys.stderr,
        )
    else:
        print(
            "[printsense] recall MISS — interpreted + materialized for next time",
            file=sys.stderr,
        )
    return graph


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="printsense",
        description="Interpret an electrical print photo/PDF into a technician brief + typed graph.",
    )
    parser.add_argument(
        "inputs", nargs="+", type=Path, help="image/PDF file(s) — one print package"
    )
    parser.add_argument("--question", default=None, help="what you need answered from this print")
    parser.add_argument("--out", type=Path, default=Path("printsense_out"), help="output directory")
    parser.add_argument(
        "--map", action="store_true", dest="want_map", help="also emit the exact tag/terminal map"
    )
    parser.add_argument("--no-preprocess", action="store_true", help="skip auto-upright/resize")
    parser.add_argument(
        "--recall",
        action="store_true",
        help="reuse a prior interpretation of the same print instead of re-paying the vision model",
    )
    parser.add_argument(
        "--recall-store",
        type=Path,
        default=Path("printsense_recall"),
        help="durable recall store directory (used with --recall)",
    )
    args = parser.parse_args(argv)

    # Windows consoles default to cp1252; the brief contains unicode. Never crash on print.
    if hasattr(sys.stdout, "reconfigure"):  # pragma: no branch
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    try:
        pages = _load_pages(args.inputs)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_USAGE

    try:
        if args.recall:
            graph = _interpret_with_recall(pages, args)
        else:
            graph = interpret_print(
                pages, question=args.question, preprocess=not args.no_preprocess
            )
    except PrintVisionUnavailable as exc:
        print(
            f"error: print-vision provider not configured — {exc}\n"
            "hint: run under staging Doppler:  doppler run -p factorylm -c stg -- py -3 -m printsense ...",
            file=sys.stderr,
        )
        return EXIT_UNAVAILABLE

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    graph_path = out / "graph.json"
    graph_path.write_text(graph.model_dump_json(indent=2), encoding="utf-8")

    brief = format_graph_for_telegram(graph)
    (out / "brief.txt").write_text(brief, encoding="utf-8")

    # Deterministic verdict on the graph we just wrote (rubric-less: gates only).
    grade = grade_case(graph_path)
    (out / "grade.json").write_text(json.dumps(grade, indent=2), encoding="utf-8")

    print(brief)
    if args.want_map:
        map_text = format_map_for_telegram(graph)
        (out / "map.txt").write_text(map_text, encoding="utf-8")
        print()
        print(map_text)

    blockers = grade.get("import_blocking_failures") or []
    print()
    print(
        f"[printsense] import_verdict={grade.get('import_verdict')}"
        + (f" blockers={','.join(blockers)}" if blockers else "")
        + f" · entities={len(graph.all_entities())} unresolved={len(graph.unresolved)}"
        + f" · outputs -> {out}"
    )
    return EXIT_OK
