"""Print Translator Baseline B — OCR-grounded rerun (image + OCR text) vs the
frozen image-only Baseline A.

**Honesty contract (do not violate):**
  - Real inference only, via the REAL production prompt path
    (`shared.print_translator.build_theory_messages` /
    `shared.print_translator.format_theory_reply`) and the REAL
    `shared.inference.router.InferenceRouter().complete` cascade
    (`INFERENCE_BACKEND=cloud`, Groq -> Cerebras -> Together). No mocks, no
    canned responses.
  - Production `mira-core:8080` glm-OCR is unreachable from this box (proven
    during the print-translator campaign). Baseline B therefore uses a
    REACHABLE PROXY for OCR: one extra cascade vision call
    (`build_ocr_proxy_messages` / `OCR_PROXY_SYSTEM_PROMPT`) that asks the
    model to transcribe the text tokens actually legible in the image, as
    strict JSON. This is NOT production glm-OCR — every output record labels
    it `"ocr_source": "cascade_vision_transcription_proxy_not_production_glm_ocr"`.
    The extracted tokens fill the same `vision_data["ocr_items"]` slot the
    production OCR call would fill, which is the only variable Baseline B
    changes versus Baseline A (image-only, `ocr_items: []`).
  - If a cascade call errors or returns empty for a case, that is recorded
    honestly (`"error"` / `"ocr_error"` / `"ocr_parse_error"` fields) and the
    run continues to the next case. Never a fabricated `ocr_items` list,
    never a fabricated `translator_reply`.
  - No production code is imported for mutation and none is modified — only
    called, exactly as `tools/print_translator_eval/run.py` already does for
    the campaign runs this rerun compares against.
  - Writes ONLY under `docs/eval/print-translator-benchmark/baseline_b/` —
    never touches `grades/`, `evidence/`, `reports/`,
    `before_after_classifier.json`, or `BASELINE_A.sha256` (Baseline A).

Usage (from repo root):

    doppler run --project factorylm --config dev -- python \\
        tools/print_translator_eval/benchmark/run_baseline_b.py

    # single case:
    doppler run --project factorylm --config dev -- python \\
        tools/print_translator_eval/benchmark/run_baseline_b.py --id 05
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
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("print_translator_baseline_b")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

REPO_ROOT = Path(__file__).resolve().parents[3]
MIRA_BOTS_DIR = REPO_ROOT / "mira-bots"
DEFAULT_RESULTS_DIR = REPO_ROOT / "docs" / "eval" / "print-translator-campaign" / "results"
DEFAULT_IMAGES_DIR = (
    REPO_ROOT / "docs" / "eval" / "print-translator-benchmark" / "baseline_b" / "source_images"
)
FALLBACK_IMAGES_DIR = Path("C:/Users/hharp/Downloads/print-translator-eval-images")
DEFAULT_OUT_DIR = (
    REPO_ROOT / "docs" / "eval" / "print-translator-benchmark" / "baseline_b" / "responses"
)

CASE_IDS = ["03", "05", "07", "09", "13", "14", "17", "18", "20", "25"]

OCR_SOURCE_LABEL = "cascade_vision_transcription_proxy_not_production_glm_ocr"

# The 4 known Baseline-A invented labels (not present in any real OCR for
# these two cases): case 05 asserted "K1"/"K2" as coils and "control
# transformer"; case 20 asserted "XC00"/"XC90". Checked verbatim
# (case-insensitive substring) against the Baseline B reply.
_INVENTED_LABEL_TOKENS: dict[str, list[str]] = {
    "05": ["K1", "K2", "control transformer"],
    "20": ["XC00", "XC90"],
}

OCR_PROXY_SYSTEM_PROMPT = """\
You are an OCR transcription utility for electrical prints (wiring diagrams, \
schematics, ladder logic, terminal charts). Your ONLY job is to list the \
text tokens that are ACTUALLY visible and legible in the image: device tags \
(e.g. K1, CR1, FU2, M1), terminal or wire numbers, section/figure titles, \
table headers, and short visible labels.

Rules:
- List ONLY tokens you can actually read in the image. Never guess, infer, \
or invent a label that is not visibly printed.
- Do not describe the drawing and do not explain circuit behavior — \
transcription only, no commentary.
- Do not include schematic-software UI chrome (menus, toolbars, file names).
- Return STRICT JSON ONLY: a single JSON array of strings, nothing else. No \
markdown fences, no prose before or after.
- If nothing is legible, return an empty array: []
"""

OCR_PROXY_USER_TEXT = (
    "Transcribe the visible text tokens (device tags, terminal labels, wire "
    "numbers, titles, section headers) that are actually legible in this "
    "electrical print image. Return a JSON array of strings only."
)


@dataclass
class CaseMeta:
    case_id: str
    oem: str
    document: str
    url: str
    category: str
    caption_submitted: str
    vision_result: str | None
    drawing_type: str | None


def load_case_meta(case_id: str, results_dir: Path) -> CaseMeta:
    """Read the preserved Baseline-A metadata (caption, vision_result,
    drawing_type) from `results/<id>.gate_bypassed.json`. Never invents a
    field that isn't in that file."""
    path = results_dir / f"{case_id}.gate_bypassed.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    vision = data.get("vision") or {}
    return CaseMeta(
        case_id=case_id,
        oem=data.get("oem", ""),
        document=data.get("document", ""),
        url=data.get("url", ""),
        category=data.get("category", ""),
        caption_submitted=data.get("caption_submitted", ""),
        vision_result=vision.get("vision_result"),
        drawing_type=vision.get("drawing_type"),
    )


def resolve_image_path(case_id: str, images_dir: Path) -> Path:  # pragma: no cover
    """Prefer `images_dir`; fall back to the Downloads staging dir the task
    inputs live in. Raises if neither has the file — never synthesizes one."""
    candidate = images_dir / f"{case_id}.png"
    if candidate.exists():
        return candidate
    fallback = FALLBACK_IMAGES_DIR / f"{case_id}.png"
    if fallback.exists():
        return fallback
    raise FileNotFoundError(
        f"no source image for case {case_id!r} in {images_dir} or {FALLBACK_IMAGES_DIR}"
    )


def build_ocr_proxy_messages(photo_b64: str, mime: str = "image/png") -> list[dict]:
    """Messages for the OCR-proxy call (this tool's own prompt — NOT the
    production Print Translator prompt, which is untouched and used
    separately in `run_case`)."""
    return [
        {"role": "system", "content": OCR_PROXY_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{photo_b64}"}},
                {"type": "text", "text": OCR_PROXY_USER_TEXT},
            ],
        },
    ]


def parse_ocr_items(raw: str) -> tuple[list[str], str | None]:
    """Parse the OCR-proxy model's response into a list of strings.

    Returns (items, parse_error). Never invents items when parsing fails —
    returns ([], error_message) instead, so a malformed model response shows
    up as an honest error, not a silently empty (indistinguishable from
    "nothing legible") OCR block.
    """
    if not raw:
        return [], "empty response from OCR-proxy call"
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if not match:
            return [], f"could not parse a JSON array from response: {text[:200]!r}"
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as e:
            return [], f"JSON parse failed even after array extraction: {e}"
    if not isinstance(parsed, list):
        return [], f"parsed JSON is not a list (got {type(parsed).__name__})"
    return [str(item).strip() for item in parsed if str(item).strip()], None


def extract_ocr_block_text(messages: list[dict]) -> str | None:
    """Read back the literal user-text block (drawing type + OCR block) from
    the messages `build_theory_messages` actually produced — not
    reconstructed, so it is guaranteed to match what was sent to the router."""
    user = next((m for m in messages if m.get("role") == "user"), None)
    if user is None:
        return None
    content = user.get("content")
    if isinstance(content, list):
        for block in content:
            if block.get("type") == "text":
                return block.get("text")
        return None
    if isinstance(content, str):
        return content
    return None


def invented_label_check(case_id: str, translator_reply: str | None) -> dict | None:
    """Deterministic substring check for the 4 known Baseline-A invented
    labels, scoped to cases 05 and 20 only (returns None for every other
    case — no claim is made about cases without a known Baseline-A
    hallucination to check against)."""
    tokens = _INVENTED_LABEL_TOKENS.get(case_id)
    if tokens is None:
        return None
    if not translator_reply:
        return {"still_present": False, "tokens_found": [], "note": "no reply generated"}
    lowered = translator_reply.lower()
    found = [t for t in tokens if t.lower() in lowered]
    return {"still_present": bool(found), "tokens_found": found}


def _import_production_modules():  # pragma: no cover
    """Import the REAL production modules. Path insertion happens here (not
    at module top) so this file has no E402 import-after-code violations.

    `factorylm/dev` (Doppler) carries the provider API keys but does not
    define INFERENCE_BACKEND itself — matches `tools/print_translator_eval/
    run.py`'s own `_load_bot_module`/`run_via_fallback`, which set this the
    same way (`setdefault`, so a real value already set is never overridden).
    """
    os.environ.setdefault("INFERENCE_BACKEND", "cloud")
    for p in (str(MIRA_BOTS_DIR),):
        if p not in sys.path:
            sys.path.insert(0, p)
    from shared import print_translator
    from shared.inference.router import InferenceRouter

    return print_translator, InferenceRouter


async def run_case(
    entry: CaseMeta, images_dir: Path, print_translator, InferenceRouter
) -> dict:  # pragma: no cover
    image_path = resolve_image_path(entry.case_id, images_dir)
    image_bytes = image_path.read_bytes()
    photo_b64 = base64.b64encode(image_bytes).decode()

    record: dict = {
        "case_id": entry.case_id,
        "ocr_source": OCR_SOURCE_LABEL,
        "oem": entry.oem,
        "document": entry.document,
        "url": entry.url,
        "category": entry.category,
        "question": entry.caption_submitted,
        "source_image_path": str(image_path),
        "source_image_sha256": None,
        "run_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "mode": "baseline_b_ocr_grounded",
    }
    record["source_image_sha256"] = hashlib.sha256(image_bytes).hexdigest()

    router = InferenceRouter()
    if not router.enabled:
        record["error"] = (
            f"InferenceRouter disabled (backend={router.backend!r}, "
            f"providers={[p.name for p in router.providers]})"
        )
        record["ocr_items"] = []
        record["translator_reply"] = None
        return record

    # --- Step 1: OCR-proxy call (real cascade inference, this tool's own prompt) ---
    ocr_messages = build_ocr_proxy_messages(photo_b64)
    ocr_raw = ""
    ocr_usage: dict = {}
    try:
        ocr_raw, ocr_usage = await router.complete(
            ocr_messages, max_tokens=600, session_id=f"pt_baseline_b_ocr_{entry.case_id}"
        )
    except Exception as e:  # noqa: BLE001 — report exactly what failed, never fabricate
        record["ocr_error"] = f"{type(e).__name__}: {e}"
    else:
        if not ocr_raw:
            record["ocr_error"] = "OCR-proxy cascade call returned empty (all providers failed)"

    ocr_items, parse_error = parse_ocr_items(ocr_raw)
    if parse_error:
        record["ocr_parse_error"] = parse_error
    record["ocr_items"] = ocr_items
    record["ocr_proxy_usage"] = ocr_usage
    record["ocr_proxy_raw_response"] = ocr_raw or None

    # --- Step 2: REAL production prompt path, now with ocr_items populated ---
    vision_data = {
        "classification": "ELECTRICAL_PRINT",
        "vision_result": entry.vision_result,
        "drawing_type": entry.drawing_type,
        "ocr_items": ocr_items,
    }
    messages = print_translator.build_theory_messages(photo_b64, vision_data)
    record["messages_ocr_block"] = extract_ocr_block_text(messages)

    try:
        content, usage = await router.complete(
            messages, max_tokens=1200, session_id=f"pt_baseline_b_{entry.case_id}"
        )
    except Exception as e:  # noqa: BLE001
        record["error"] = f"{type(e).__name__}: {e}"
        record["translator_reply"] = None
        record["router_usage"] = None
        return record

    record["router_usage"] = usage
    if not content:
        record["error"] = "all cascade providers failed/returned empty (no fabricated reply)"
        record["translator_reply"] = None
        return record

    record["translator_reply"] = print_translator.format_theory_reply(
        content, vision_data.get("drawing_type")
    )
    record["invented_label_check"] = invented_label_check(entry.case_id, record["translator_reply"])
    return record


async def _amain(args: argparse.Namespace) -> int:  # pragma: no cover
    print_translator, InferenceRouter = _import_production_modules()

    results_dir = Path(args.results_dir)
    images_dir = Path(args.images_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    case_ids = [args.id] if args.id else CASE_IDS

    summary: list[tuple[str, int, bool | None]] = []
    for case_id in case_ids:
        logger.info("=== case %s ===", case_id)
        entry = load_case_meta(case_id, results_dir)
        record = await run_case(entry, images_dir, print_translator, InferenceRouter)

        out_path = out_dir / f"{case_id}.json"
        out_path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
        logger.info("Wrote %s", out_path)

        ocr_count = len(record.get("ocr_items") or [])
        invented = record.get("invented_label_check")
        still_present = invented.get("still_present") if invented else None
        summary.append((case_id, ocr_count, still_present))

        if record.get("error"):
            logger.warning("case %s: error recorded: %s", case_id, record["error"])

    logger.info("--- Baseline B summary ---")
    for case_id, ocr_count, still_present in summary:
        note = f" invented_label_still_present={still_present}" if still_present is not None else ""
        logger.info("case %s: ocr_items=%d%s", case_id, ocr_count, note)

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--id", default=None, help="Run a single case id (e.g. 05). Default: all 10."
    )
    parser.add_argument("--results-dir", default=str(DEFAULT_RESULTS_DIR))
    parser.add_argument("--images-dir", default=str(DEFAULT_IMAGES_DIR))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    args = parser.parse_args()
    sys.exit(asyncio.run(_amain(args)))


if __name__ == "__main__":
    main()
