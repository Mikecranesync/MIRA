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
        graph = interpret_print(pages, question=args.question, preprocess=not args.no_preprocess)
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
