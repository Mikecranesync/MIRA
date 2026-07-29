"""Gate-bypass runner — REAL production prompt path, REAL cascade, REAL image.

Companion to `run.py`. `run.py` exercises the FULL production handler
(`bot._try_print_translator_reply`), which — for most real prints — returns
`handled=False` because the classifier gate
(`vision_worker.py::_classify_photo`) mis-routes them to EQUIPMENT_PHOTO /
NAMEPLATE before the translator ever runs. That real gate result is recorded
verbatim by `run.py` and MUST stay recorded.

This script gives a human reviewer actual translator OUTPUT to judge, WITHOUT
fabricating anything and WITHOUT changing the prompt: it calls the exact same
production prompt-builder and cascade the handler would, skipping ONLY the
buggy gate:

    print_translator.build_theory_messages(photo_b64, vision_data)   # prod prompt-builder
      -> engine.router.complete(messages, ...)                       # real cascade
      -> print_translator.format_theory_reply(content, drawing_type) # prod formatter

`vision_data` is the REAL vision output already captured for that image by
`run.py` (reconstructed from `results/<id>.json`'s `vision` block — `ocr_items`
genuinely empty on this box), NOT a fresh or fabricated dict. The prompt text
is unchanged production code; only the gate branch is skipped.

Output is written to `results/<id>.gate_bypassed.json` with
`"mode": "gate_bypassed_real_prompt_real_model_real_image_ocr_empty"` so it is
never confused with the full-handler record in `results/<id>.json`.

Caption note: the caption governs ONLY `print_translator.is_theory_request()`
(the trigger gate) — it is NOT passed to `build_theory_messages`, so the
explanation is caption-independent. Both supported phrasings ("Explain this
print." / "Describe the theory of operation.") are exercised across the set and
each is validated with a real `is_theory_request()` call, recorded per id.

Usage (from repo root):

    doppler run --project factorylm --config dev -- python \\
        tools/print_translator_eval/gate_bypass.py --id 18 \\
        --caption "Describe the theory of operation."
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import run  # tools/print_translator_eval/run.py — reused fetch/render/load helpers

logger = logging.getLogger("print_translator_gate_bypass")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

RESULTS_DIR = run.DEFAULT_RESULTS_DIR


def _reconstruct_vision_data(vision_summary: dict) -> dict:
    """Rebuild the REAL vision_data dict from the stored `vision` summary.

    `run.py` persisted `_vision_summary(...)` — every field `build_theory_messages`
    reads (`drawing_type`, `ocr_items`) is present, so this is the same real
    vision output the handler saw, not a fabrication. `ocr_items` is genuinely
    empty on this box (glm-OCR unreachable, no local Tesseract).
    """
    return {
        "classification": vision_summary.get("classification"),
        "classification_confidence": vision_summary.get("classification_confidence"),
        "vision_result": vision_summary.get("vision_result"),
        "ocr_items": vision_summary.get("ocr_items") or [],
        "tesseract_text": "",
        "drawing_type": vision_summary.get("drawing_type"),
        "drawing_type_confidence": vision_summary.get("drawing_type_confidence") or 0.0,
    }


async def _amain(args: argparse.Namespace) -> int:
    handler_record_path = RESULTS_DIR / f"{args.id:02d}.json"
    if not handler_record_path.exists():
        print(f"No handler record at {handler_record_path}; run run.py --id {args.id} first.")
        return 2
    handler_record = json.loads(handler_record_path.read_text(encoding="utf-8"))
    vision_summary = handler_record.get("vision")
    if not vision_summary:
        print(f"Handler record {handler_record_path} has no vision block; cannot proceed.")
        return 2

    # Re-render the SAME page from the SAME PDF the handler used, so the image
    # fed to the model matches results/<id>.json (and images/<id>.png).
    cache_dir = (
        Path(args.temp_dir or __import__("tempfile").gettempdir())
        / "print_translator_eval"
        / "pdfs"
    )
    pdf_path = run.fetch_pdf(handler_record["url"], cache_dir)
    image_bytes = run.render_page(pdf_path, handler_record["rendered_page_number"], dpi=args.dpi)
    photo_b64 = base64.b64encode(image_bytes).decode()

    bot_module, import_error = run._load_bot_module()
    if bot_module is None:
        print(f"bot.py not importable: {import_error}")
        return 3

    from shared import print_translator  # real production module

    vision_data = _reconstruct_vision_data(vision_summary)
    # Caption governs only the trigger gate; validate it really would trigger.
    is_trigger = print_translator.is_theory_request(args.caption)

    messages = print_translator.build_theory_messages(photo_b64, vision_data)
    content, usage = await bot_module.engine.router.complete(
        messages, max_tokens=1200, session_id=f"print_translator_gate_bypass_{args.id}"
    )
    reply = print_translator.format_theory_reply(content, vision_data.get("drawing_type"))
    real_generation = bool(content)  # falsy -> FALLBACK_REPLY, not a model generation

    record = {
        "id": handler_record["id"],
        "oem": handler_record["oem"],
        "document": handler_record["document"],
        "url": handler_record["url"],
        "rendered_page_number": handler_record["rendered_page_number"],
        "category": handler_record["category"],
        "mode": "gate_bypassed_real_prompt_real_model_real_image_ocr_empty",
        "explanation_of_mode": (
            "REAL print_translator.build_theory_messages + REAL engine.router.complete + "
            "REAL format_theory_reply on the REAL rendered image. Skips ONLY the buggy "
            "classifier gate (vision_worker._classify_photo). Prompt is unchanged production "
            "code. NOT a mock. vision_data is the real captured vision output from "
            f"results/{handler_record['id']:02d}.json (ocr_items empty on this box)."
        ),
        "caption_submitted": args.caption,
        "caption_is_theory_request": is_trigger,
        "caption_note": (
            "Caption governs ONLY print_translator.is_theory_request() (the trigger gate); it "
            "is NOT passed to build_theory_messages, so this explanation is caption-independent."
        ),
        "ocr_grounding": "unavailable_on_this_box",
        "vision": vision_summary,
        "messages_sent_to_router": run._messages_summary(messages),
        "router_usage": usage,
        "run_timestamp_utc": datetime.now(timezone.utc).isoformat(),
    }
    if real_generation:
        record["inference"] = "ran"
        record["translator_reply"] = reply
    else:
        record["inference"] = "unavailable"
        record["reason"] = "all cascade providers failed/returned empty — FALLBACK_REPLY sent"
        record["reply_sent"] = reply

    out_path = RESULTS_DIR / f"{args.id:02d}.gate_bypassed.json"
    out_path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("Wrote %s", out_path)
    run._safe_print(json.dumps(record, indent=2, ensure_ascii=False))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", type=int, required=True, help="Corpus manifest entry id")
    parser.add_argument("--caption", default="Explain this print.")
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--temp-dir", default=None)
    args = parser.parse_args()
    sys.exit(asyncio.run(_amain(args)))


if __name__ == "__main__":
    main()
