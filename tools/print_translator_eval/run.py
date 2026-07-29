"""Print Translator campaign runner — REAL merged code, REAL inference, no mocks.

Exercises the actual production Print Translator handler
(`mira-bots/telegram/bot.py::_try_print_translator_reply`) against a rendered
page from a cited OEM PDF in the corpus manifest
(`docs/eval/print-translator-campaign/corpus_manifest.md`). No Telegram
network calls are made — the `Update`/`context` objects the handler expects
are replaced with a minimal in-process stand-in that only captures the text
the handler would have sent to `update.message.reply_text(...)`. Nothing
about the print-explanation logic itself (vision call, prompt construction,
LLM cascade call) is replaced or faked — those run through the real
`engine.vision` / `engine.router` instances the bot module constructs at
import time, via a **spy** (records inputs/outputs, never replaces them)
wrapped around `engine.vision.process` and `engine.router.complete` so this
script can persist what was actually sent/returned.

Honesty contract (do not violate):
  - If `bot.py` fails to import here (telegram deps / engine construction),
    fall back to calling the real `shared.print_translator.build_theory_messages`
    + a real `shared.inference.router.InferenceRouter().complete` directly,
    and record that the fallback path was used and why.
  - If inference genuinely does not run (router disabled, all providers
    fail, vision call fails), the JSON record says so explicitly
    (`"inference": "unavailable"`, with a `"reason"`) — never a fabricated
    `ocr_items` list or fabricated model prose.
  - No PDF or rendered image is ever committed — both live under a TEMP
    directory for the run and are referenced in the record only by URL,
    page number, and sha256.
  - No DB writes, no `wiring_connections` involvement, no deploy, no
    correctness/usefulness scoring (that needs a human technician).

Usage (from repo root, or anywhere — paths are resolved from this file):

    doppler run --project factorylm --config dev -- python \\
        tools/print_translator_eval/run.py --id 17 --page 30 \\
        --caption "Explain this print."

`--manifest` defaults to `docs/eval/print-translator-campaign/corpus_manifest.md`.
`--page` is the 0-indexed PDF page to render (use `--list-pages` to dump the
PDF's page text first and pick one — wiring/schematic pages are not always
page 0 of a chapter PDF).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

logger = logging.getLogger("print_translator_eval")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

REPO_ROOT = Path(__file__).resolve().parents[2]
MIRA_BOTS_DIR = REPO_ROOT / "mira-bots"
DEFAULT_MANIFEST = REPO_ROOT / "docs" / "eval" / "print-translator-campaign" / "corpus_manifest.md"
DEFAULT_RESULTS_DIR = REPO_ROOT / "docs" / "eval" / "print-translator-campaign" / "results"
DEFAULT_IMAGES_DIR = REPO_ROOT / "docs" / "eval" / "print-translator-campaign" / "images"

_MANIFEST_ROW_RE = re.compile(r"^\|(.+)\|\s*$")


@dataclass
class ManifestEntry:
    id: int
    oem: str
    document: str
    url: str
    page_ref: str
    print_type: str
    standard: str
    category: str
    description: str
    status: str
    retrieval_note: str


def parse_manifest(path: Path) -> list[ManifestEntry]:
    """Parse the pipe-table corpus manifest (docs/eval/print-translator-campaign/corpus_manifest.md).

    Only reads the `## Corpus Table` section (the first pipe-table with a
    numeric first column). Does not invent or reorder fields — a straight
    column-by-column parse of the existing Markdown table.
    """
    entries: list[ManifestEntry] = []
    lines = path.read_text(encoding="utf-8").splitlines()
    in_table = False
    for line in lines:
        m = _MANIFEST_ROW_RE.match(line.strip())
        if not m:
            in_table = False
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if not cells:
            continue
        first = cells[0]
        if first == "#":
            in_table = True
            continue
        if not in_table:
            continue
        if set(first) <= {"-", ":"}:  # header separator row
            continue
        if not first.isdigit():
            in_table = False
            continue
        if len(cells) < 11:
            continue
        entries.append(
            ManifestEntry(
                id=int(first),
                oem=cells[1],
                document=cells[2],
                url=cells[3],
                page_ref=cells[4],
                print_type=cells[5],
                standard=cells[6],
                category=cells[7],
                description=cells[8],
                status=cells[9],
                retrieval_note=cells[10],
            )
        )
    return entries


def fetch_pdf(url: str, cache_dir: Path) -> Path:
    """Download the manifest's cited PDF to a TEMP dir. Never committed.

    Manifest URLs are stored scheme-less (e.g. ``cdn.automationdirect.com/...``)
    — prepend ``https://`` when missing, but don't otherwise touch the URL.
    """
    fetch_url = url if url.startswith(("http://", "https://")) else f"https://{url}"
    cache_dir.mkdir(parents=True, exist_ok=True)
    name = hashlib.sha256(url.encode()).hexdigest()[:16] + ".pdf"
    dest = cache_dir / name
    if dest.exists():
        logger.info("PDF already cached at %s", dest)
        return dest
    logger.info("Downloading %s", fetch_url)
    # Some OEM CDNs (e.g. AutomationDirect) return 406 to the default httpx
    # user-agent; a plain browser-like UA is sufficient, no other tricks.
    headers = {"User-Agent": "Mozilla/5.0 (compatible; MIRA-print-translator-eval/1.0)"}
    with httpx.Client(timeout=30, follow_redirects=True, headers=headers) as client:
        resp = client.get(fetch_url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
    logger.info("Saved %d bytes to %s", len(resp.content), dest)
    return dest


def dump_page_text(pdf_path: Path, max_pages: int = 40) -> None:
    """Print each page's leading text so a human can pick a schematic page."""
    import fitz

    doc = fitz.open(pdf_path)
    _safe_print(f"{pdf_path} -- {doc.page_count} pages")
    for i in range(min(doc.page_count, max_pages)):
        text = doc[i].get_text()[:160].replace("\n", " | ")
        _safe_print(f"{i:3d} :: {text}")


def _safe_print(text: str) -> None:
    """Print, degrading non-ASCII to '?' if the console encoding can't handle it.

    Debug/inspection output only (``--list-pages``) — never touches the JSON
    record or any file write, which always use UTF-8.
    """
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"))


def render_page(pdf_path: Path, page_number: int, dpi: int = 200, fmt: str = "jpeg") -> bytes:
    """Render one PDF page to image bytes via PyMuPDF (fitz). ``fmt`` is
    ``"jpeg"`` (default, matches the real Telegram photo path) or ``"png"``
    (used by ``--gate-bypass`` to persist a clean, lossless review image)."""
    import fitz

    doc = fitz.open(pdf_path)
    if not (0 <= page_number < doc.page_count):
        raise ValueError(f"page {page_number} out of range (0..{doc.page_count - 1})")
    page = doc[page_number]
    pix = page.get_pixmap(dpi=dpi)
    return pix.tobytes(fmt)


def _load_bot_module():
    """Import the real telegram/bot.py module (production handler + engine).

    Sets minimal, non-secret env vars ONLY if unset (never overrides a real
    value): TELEGRAM_BOT_TOKEN (dummy — Application.builder() is never
    called since we only import the module, we don't run main()),
    MIRA_DB_PATH (temp sqlite file, not the repo), INFERENCE_BACKEND=cloud
    (matches production; factorylm/dev doesn't define this var so the
    router defaults to "local"/disabled unless we set it).

    Returns (bot_module, error) — error is None on success.
    """
    os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy:print-translator-eval")
    os.environ.setdefault("INFERENCE_BACKEND", "cloud")
    tmp_db = Path(tempfile.gettempdir()) / "print_translator_eval" / "mira_eval.db"
    tmp_db.parent.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MIRA_DB_PATH", str(tmp_db))

    for p in (str(MIRA_BOTS_DIR), str(MIRA_BOTS_DIR / "telegram")):
        if p not in sys.path:
            sys.path.insert(0, p)

    try:
        import bot as bot_module  # type: ignore  # mira-bots/telegram/bot.py

        return bot_module, None
    except Exception as e:  # noqa: BLE001 — report exactly what failed, don't swallow
        return None, e


class _FakeMessage:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def reply_text(self, text: str, **_kwargs) -> None:
        self.sent.append(text)


class _FakeChat:
    def __init__(self, chat_id: str) -> None:
        self.id = chat_id


class _FakeUpdate:
    """Stands in for telegram.Update. No network. Only what the handler reads:
    `update.message.reply_text(...)` and `update.effective_chat.id`."""

    def __init__(self, chat_id: str) -> None:
        self.message = _FakeMessage()
        self.effective_chat = _FakeChat(chat_id)


@dataclass
class Captured:
    vision_data: dict | None = None
    messages: list | None = None
    router_reply: str | None = None
    router_usage: dict | None = None
    router_called: bool = False
    vision_called: bool = False
    vision_error: str | None = None
    router_error: str | None = None


def _spy_engine(engine, captured: Captured):
    """Wrap `engine.vision.process` and `engine.router.complete` with spies.

    A spy calls straight through to the real method and records what was
    passed in / returned — it never changes behavior or substitutes a
    canned response. Returns a restore() callable.
    """
    orig_vision_process = engine.vision.process
    orig_router_complete = engine.router.complete

    async def spied_vision_process(photo_b64, message):
        captured.vision_called = True
        try:
            result = await orig_vision_process(photo_b64, message)
        except Exception as e:  # noqa: BLE001 — record, then re-raise (matches handler's own try/except)
            captured.vision_error = f"{type(e).__name__}: {e}"
            raise
        captured.vision_data = result
        return result

    async def spied_router_complete(messages, **kwargs):
        captured.router_called = True
        captured.messages = messages
        try:
            content, usage = await orig_router_complete(messages, **kwargs)
        except Exception as e:  # noqa: BLE001
            captured.router_error = f"{type(e).__name__}: {e}"
            raise
        captured.router_reply = content
        captured.router_usage = usage
        return content, usage

    engine.vision.process = spied_vision_process
    engine.router.complete = spied_router_complete

    def restore():
        engine.vision.process = orig_vision_process
        engine.router.complete = orig_router_complete

    return restore


async def run_via_bot_handler(bot_module, image_bytes: bytes, caption: str) -> dict:
    """Real path: `bot._try_print_translator_reply` with a spied engine, no Telegram."""
    captured = Captured()
    restore = _spy_engine(bot_module.engine, captured)
    fake_update = _FakeUpdate(chat_id="print_translator_eval_runner")
    try:
        handled = await bot_module._try_print_translator_reply(
            image_bytes, caption, fake_update, None
        )
    finally:
        restore()

    record: dict = {
        "code_path": "bot._try_print_translator_reply (real handler, spied engine, no Telegram)",
        "handled": handled,
        "vision_called": captured.vision_called,
        "router_called": captured.router_called,
    }

    if not handled:
        if not captured.vision_called:
            record["inference"] = "not_triggered"
            record["reason"] = "print_translator.is_theory_request(caption) returned False"
        elif captured.vision_error:
            record["inference"] = "unavailable"
            record["reason"] = f"vision call raised: {captured.vision_error}"
        elif captured.vision_data is not None:
            record["inference"] = "not_triggered"
            record["reason"] = (
                "vision classified as "
                f"{captured.vision_data.get('classification')!r}, not ELECTRICAL_PRINT"
            )
            record["vision"] = _vision_summary(captured.vision_data)
        else:
            record["inference"] = "unavailable"
            record["reason"] = "handler returned False for an unexplained reason"
        return record

    # handled == True: vision classified ELECTRICAL_PRINT and the handler ran
    # build_theory_messages + router.complete + format_theory_reply, then
    # replied. Report what actually happened, honestly.
    record["vision"] = _vision_summary(captured.vision_data) if captured.vision_data else None
    record["messages_sent_to_router"] = _messages_summary(captured.messages)
    record["router_usage"] = captured.router_usage

    final_reply = fake_update.message.sent[-1] if fake_update.message.sent else None
    real_generation = bool(captured.router_reply)  # falsy -> FALLBACK_REPLY was sent instead
    if captured.router_error:
        record["inference"] = "unavailable"
        record["reason"] = f"router.complete raised: {captured.router_error}"
    elif not real_generation:
        record["inference"] = "unavailable"
        record["reason"] = (
            "all cascade providers failed/returned empty — "
            "reply sent was print_translator.FALLBACK_REPLY, not a model generation"
        )
        record["reply_sent"] = final_reply
    else:
        record["inference"] = "ran"
        record["translator_reply"] = final_reply

    return record


async def run_via_fallback(image_bytes: bytes, caption: str) -> dict:
    """Fallback path when bot.py isn't importable here: build_theory_messages
    + a real InferenceRouter().complete directly. Still no fabrication —
    vision_data is unavailable in this path (VisionWorker lives behind the
    Supervisor engine bot.py constructs), so the OCR block is the module's
    own honest "no OCR" fallback line, and drawing_type is left unset. This
    path exists ONLY for the case where bot.py cannot be imported.
    """
    for p in (str(MIRA_BOTS_DIR),):
        if p not in sys.path:
            sys.path.insert(0, p)
    os.environ.setdefault("INFERENCE_BACKEND", "cloud")

    from shared import print_translator
    from shared.inference.router import InferenceRouter

    photo_b64 = base64.b64encode(image_bytes).decode()
    vision_data: dict = {}  # no VisionWorker in this path — honest empty, not fabricated
    messages = print_translator.build_theory_messages(photo_b64, vision_data)

    router = InferenceRouter()
    record: dict = {
        "code_path": "fallback: shared.print_translator.build_theory_messages + shared.inference.router.InferenceRouter().complete (bot.py NOT importable here)",
        "messages_sent_to_router": _messages_summary(messages),
        "router_enabled": router.enabled,
    }
    if not router.enabled:
        record["inference"] = "unavailable"
        record["reason"] = (
            f"InferenceRouter disabled (backend={router.backend!r}, providers={[p.name for p in router.providers]})"
        )
        return record

    content, usage = await router.complete(
        messages, max_tokens=1200, session_id="print_translator_eval_fallback"
    )
    record["router_usage"] = usage
    if not content:
        record["inference"] = "unavailable"
        record["reason"] = "all cascade providers failed/returned empty"
        return record

    record["inference"] = "ran"
    record["translator_reply"] = print_translator.format_theory_reply(content, None)
    return record


async def run_gate_bypass(
    entry: ManifestEntry, image_bytes: bytes, image_sha256: str, vision_data: dict, caption: str
) -> dict:
    """Eval-tool-only (NOT production): skip the defective classifier gate and
    run the exact REAL production prompt + REAL cascade directly.

    ``vision_data`` MUST come from a real prior handler run's captured vision
    output (``results/<id>.json``'s ``"vision"`` field) — this function never
    synthesizes it. On this dev box that real vision_data has ``ocr_items: []``
    (OCR is unreachable here — see GAPS.md #1), so the resulting prompt is
    exactly what the real handler would have sent had the gate let it through:
    same system prompt (`print_translator.THEORY_SYSTEM_PROMPT`), same message
    shape (`build_theory_messages`), same cascade (`InferenceRouter.complete`),
    same post-processing (`format_theory_reply`). No mock, no changed prompt,
    no changed model. If the cascade errors or returns empty, that is recorded
    honestly — never a fabricated reply.
    """
    for p in (str(MIRA_BOTS_DIR),):
        if p not in sys.path:
            sys.path.insert(0, p)
    os.environ.setdefault("INFERENCE_BACKEND", "cloud")

    from shared import print_translator
    from shared.inference.router import InferenceRouter

    photo_b64 = base64.b64encode(image_bytes).decode()
    messages = print_translator.build_theory_messages(photo_b64, vision_data)

    record: dict = {
        "mode": "gate_bypassed_real_prompt_real_model_real_image_ocr_empty",
        "caption": caption,
        "image_sha256": image_sha256,
        "drawing_type": vision_data.get("drawing_type"),
        "ocr_item_count": len(vision_data.get("ocr_items") or []),
        "messages_sent_to_router": _messages_summary(messages),
    }

    router = InferenceRouter()
    if not router.enabled:
        record["response"] = None
        record["error"] = (
            f"InferenceRouter disabled (backend={router.backend!r}, "
            f"providers={[prov.name for prov in router.providers]})"
        )
        return record

    try:
        content, usage = await router.complete(
            messages,
            max_tokens=1200,
            session_id=f"print_translator_eval_gate_bypass_{entry.id}",
        )
    except Exception as e:  # noqa: BLE001 — report exactly what failed, never fabricate a reply
        record["response"] = None
        record["error"] = f"{type(e).__name__}: {e}"
        return record

    if not content:
        record["response"] = None
        record["error"] = "all cascade providers failed/returned empty (no fabricated reply)"
        return record

    record["router_usage"] = usage
    record["response"] = print_translator.format_theory_reply(
        content, vision_data.get("drawing_type")
    )
    return record


def _vision_summary(vision_data: dict) -> dict:
    ocr_items = vision_data.get("ocr_items") or []
    return {
        "classification": vision_data.get("classification"),
        "classification_confidence": vision_data.get("classification_confidence"),
        "drawing_type": vision_data.get("drawing_type"),
        "drawing_type_confidence": vision_data.get("drawing_type_confidence"),
        "vision_result": vision_data.get("vision_result"),
        "ocr_item_count": len(ocr_items),
        "ocr_items": ocr_items,
        "tesseract_text_len": len(vision_data.get("tesseract_text") or ""),
    }


def _messages_summary(messages: list | None) -> dict | None:
    if not messages:
        return None
    system = next((m for m in messages if m.get("role") == "system"), None)
    user = next((m for m in messages if m.get("role") == "user"), None)
    user_text = None
    has_image = False
    if user is not None:
        content = user.get("content")
        if isinstance(content, list):
            for block in content:
                if block.get("type") == "text":
                    user_text = block.get("text")
                if block.get("type") == "image_url":
                    has_image = True
        elif isinstance(content, str):
            user_text = content
    system_text = system.get("content") if system else None
    return {
        "system_prompt_sha256": hashlib.sha256(system_text.encode()).hexdigest()
        if system_text
        else None,
        "system_prompt_is_theory_system_prompt": system_text is not None
        and "senior maintenance electrician" in system_text,
        "user_text": user_text,
        "has_image_block": has_image,
    }


async def _amain(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest)
    entries = parse_manifest(manifest_path)
    entry = next((e for e in entries if e.id == args.id), None)
    if entry is None:
        print(f"No manifest entry with id={args.id} in {manifest_path}", file=sys.stderr)
        return 2

    cache_dir = Path(args.temp_dir or tempfile.gettempdir()) / "print_translator_eval" / "pdfs"
    pdf_path = fetch_pdf(entry.url, cache_dir)

    if args.list_pages:
        dump_page_text(pdf_path)
        return 0

    out_dir = Path(args.out_dir)
    existing_path = out_dir / f"{entry.id:02d}.json"
    existing_record: dict | None = None
    if existing_path.exists():
        existing_record = json.loads(existing_path.read_text(encoding="utf-8"))

    if args.gate_bypass:
        # Eval-tool-only mode (`run_gate_bypass`, above): skip the defective
        # classifier gate, persist the rendered page as a review PNG, and run
        # the real theory-of-operation prompt directly. Never reruns/refetches
        # vision — reuses the real `"vision"` block a prior normal run already
        # captured for this id (refuses to fabricate one if missing).
        page = args.page
        if page is None:
            page = (existing_record or {}).get("rendered_page_number")
        if page is None:
            print(
                f"--gate-bypass needs a page number: pass --page, or run the normal mode "
                f"first so {existing_path} has a 'rendered_page_number'.",
                file=sys.stderr,
            )
            return 2

        vision_data = (existing_record or {}).get("vision")
        if not vision_data:
            print(
                f"--gate-bypass needs real prior vision_data in {existing_path} "
                "('vision' key) — refusing to fabricate one. Run the normal mode "
                "for this id first.",
                file=sys.stderr,
            )
            return 2

        image_bytes = render_page(pdf_path, page, dpi=args.dpi, fmt="png")
        image_sha256 = hashlib.sha256(image_bytes).hexdigest()

        images_dir = Path(args.images_dir or DEFAULT_IMAGES_DIR)
        images_dir.mkdir(parents=True, exist_ok=True)
        image_path = images_dir / f"{entry.id:02d}.png"
        image_path.write_bytes(image_bytes)
        logger.info("Wrote %s (sha256=%s)", image_path, image_sha256)

        caption = args.caption or "Describe the theory of operation."
        result = await run_gate_bypass(entry, image_bytes, image_sha256, vision_data, caption)

        record: dict = {
            "id": entry.id,
            "oem": entry.oem,
            "document": entry.document,
            "url": entry.url,
            "manifest_page_ref": entry.page_ref,
            "print_type": entry.print_type,
            "standard": entry.standard,
            "category": entry.category,
            "rendered_page_number": page,
            "image_path": str(image_path.relative_to(REPO_ROOT)).replace("\\", "/"),
            "run_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        }
        record.update(result)

        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{entry.id:02d}.gate_bypassed.json"
        out_path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
        logger.info("Wrote %s", out_path)

        _safe_print(json.dumps(record, indent=2, ensure_ascii=False))
        return 0

    # Normal mode (unchanged): drive the real handler through the classifier gate.
    page = args.page if args.page is not None else 0
    caption = args.caption or "Explain this print."
    image_bytes = render_page(pdf_path, page, dpi=args.dpi)
    image_sha256 = hashlib.sha256(image_bytes).hexdigest()

    bot_module, import_error = _load_bot_module()

    record = {
        "id": entry.id,
        "oem": entry.oem,
        "document": entry.document,
        "url": entry.url,
        "manifest_page_ref": entry.page_ref,
        "print_type": entry.print_type,
        "standard": entry.standard,
        "category": entry.category,
        "manifest_status": entry.status,
        "rendered_page_number": page,
        "image_sha256": image_sha256,
        "caption": caption,
        "run_timestamp_utc": datetime.now(timezone.utc).isoformat(),
    }

    if bot_module is not None:
        record["bot_importable"] = True
        result = await run_via_bot_handler(bot_module, image_bytes, caption)
    else:
        record["bot_importable"] = False
        record["bot_import_error"] = f"{type(import_error).__name__}: {import_error}"
        logger.warning("bot.py not importable here (%s) — using fallback path", import_error)
        result = await run_via_fallback(image_bytes, caption)

    record.update(result)

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{entry.id:02d}.json"
    out_path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("Wrote %s", out_path)

    _safe_print(json.dumps(record, indent=2, ensure_ascii=False))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--id", type=int, required=True, help="Corpus manifest entry id (# column)")
    parser.add_argument(
        "--page",
        type=int,
        default=None,
        help="0-indexed PDF page to render. Normal mode defaults to 0 if omitted; "
        "--gate-bypass defaults to the 'rendered_page_number' already recorded in "
        "results/<id>.json from a prior normal run.",
    )
    parser.add_argument("--caption", default=None, help="Defaults to 'Explain this print.' "
        "(normal mode) or 'Describe the theory of operation.' (--gate-bypass).")
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--out-dir", default=str(DEFAULT_RESULTS_DIR))
    parser.add_argument("--images-dir", default=None, help="Where --gate-bypass persists the "
        f"rendered review PNG (default: {DEFAULT_IMAGES_DIR})")
    parser.add_argument("--temp-dir", default=None, help="Override temp dir for downloaded PDFs")
    parser.add_argument(
        "--list-pages",
        action="store_true",
        help="Print each PDF page's leading text and exit (use to pick --page)",
    )
    parser.add_argument(
        "--gate-bypass",
        action="store_true",
        help="Eval-tool-only: skip the (defective) classifier gate and run the real "
        "theory-of-operation prompt (print_translator.build_theory_messages) + real "
        "InferenceRouter cascade directly, using the real vision_data already captured "
        "for this id by a prior normal run. Persists the rendered page as a PNG under "
        "--images-dir and writes results/<id>.gate_bypassed.json. Never modifies "
        "production code; never fabricates a response.",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(_amain(args)))


if __name__ == "__main__":
    main()
