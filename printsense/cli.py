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


def _enhance(image_bytes: bytes, graph):
    """Phase-2 targeted tiling over the graph's unresolved items (lazy import)."""
    from .tiling import enhance  # noqa: PLC0415 -- optional second-pass module

    return enhance(image_bytes, graph)


def _verify(image_bytes: bytes, graph):
    """Phase-3 independent blind reread -> machine_verified promotions (lazy import)."""
    from .verify import verify  # noqa: PLC0415 -- optional second-pass module

    return verify(image_bytes, graph)


#: PDF render DPI — high enough that terminal-level text survives the token budget.
PDF_RENDER_DPI = int(__import__("os").getenv("PRINT_VISION_PDF_DPI", "220"))


def _render_pdf_pages(data: bytes, name: str) -> list[tuple[bytes, str]]:
    """Rasterize each PDF page to a JPEG image page (R1 iteration finding F5).

    A raw ``application/pdf`` block bypasses :mod:`printsense.preprocess` — the
    provider renders pages internally at its own (lower) budget, and the dense
    ATV340 2-pager came back read at connector level (56.5/F vs the page-image
    path's terminal-level reads). Client-side rendering keeps every page on the
    same 2576px / 4784-token budget as photos.
    """
    try:
        import fitz  # noqa: PLC0415 -- PyMuPDF, already a repo dep
    except ImportError as exc:
        raise ValueError(f"PDF input needs PyMuPDF installed ({name})") from exc
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        pages: list[tuple[bytes, str]] = []
        for page in doc:
            pix = page.get_pixmap(dpi=PDF_RENDER_DPI)
            pages.append((pix.tobytes("jpeg"), "image/jpeg"))
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001 -- corrupt pdf -> usage error, not a crash
        raise ValueError(f"could not render pdf {name}: {exc}") from exc
    if not pages:
        raise ValueError(f"pdf has no pages: {name}")
    return pages


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
        if media == "application/pdf":
            pages.extend(_render_pdf_pages(p.read_bytes(), p.name))
        else:
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
    parser.add_argument(
        "--enhance",
        action="store_true",
        help="Phase-2 targeted tiling: crop + re-read the unresolved items (extra paid calls)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        dest="want_verify",
        help="Phase-3 blind reread: promote independently-agreed reads to machine_verified (one extra full-page call)",
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
        graph = interpret_print(pages, question=args.question, preprocess=not args.no_preprocess)
    except PrintVisionUnavailable as exc:
        print(
            f"error: print-vision provider not configured — {exc}\n"
            "hint: run under staging Doppler:  doppler run -p factorylm -c stg -- py -3 -m printsense ...",
            file=sys.stderr,
        )
        return EXIT_UNAVAILABLE

    # Second-pass options operate on a single raster image (crops need pixels).
    single_raster = len(pages) == 1 and pages[0][1].startswith("image/")
    if args.enhance:
        if not single_raster:
            print("note: --enhance skipped (needs exactly one image input)", file=sys.stderr)
        elif not graph.unresolved:
            print("note: --enhance skipped (nothing unresolved)", file=sys.stderr)
        else:
            enh = _enhance(pages[0][0], graph)
            graph = enh.get("graph", graph)
            print(
                f"[printsense] enhance: {len(enh.get('changes') or [])} unresolved item(s) recovered",
                file=sys.stderr,
            )
    if args.want_verify:
        if not single_raster:
            print("note: --verify skipped (needs exactly one image input)", file=sys.stderr)
        else:
            ver = _verify(pages[0][0], graph)
            graph = ver.get("graph", graph)
            agreed = sum(
                1 for d in ver.get("decisions") or [] if d.get("action") == "machine_verified"
            )
            print(
                f"[printsense] verify: {agreed}/{len(ver.get('decisions') or [])} field-critical reads machine_verified",
                file=sys.stderr,
            )

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
