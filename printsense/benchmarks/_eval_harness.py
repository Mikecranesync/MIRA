"""Acceptance-eval harness for the PrintSense Phase-0 interpreter.

Runs the EXACT Phase-0 interpretation path (same ``_SYSTEM`` prompt, preprocess,
``xhigh`` effort, adaptive thinking, and confidence gate as
``printsense.interpret.interpret_print``) on a set of test images, and preserves
every artifact the staging proof requires:

  original dims · preprocessed dims · request metadata · raw response · structured
  extraction · deterministic grade · confident-misread count · latency · token
  cost · UNREADABLE findings

It reuses ``interpret``'s own building blocks (no logic fork) but adds token/latency
capture, which the product return type (``PrintSynthGraph``) does not expose.

This is NOT the end-to-end deployed bot path — that runs on staging (which has
Tesseract for content-based auto-rotate) and is exercised through ``@Mira_stagong_bot``.
This harness pre-orients images (the dev box has no Tesseract) and drives the
identical interpretation code, so it measures interpreter *quality* rigorously.

Run via: ``doppler run -c dev -- py -3 -m ...`` a driver that imports ``run_and_grade``.
"""

from __future__ import annotations

import io
import json
import time

from printsense import grader, interpret, preprocess
from printsense.models import PrintSynthGraph

_CONFIDENT_TRUST = {"proposed", "machine_verified", "human_verified"}


def interpret_capture(image_bytes: bytes, question: str | None = None, do_preprocess: bool = True) -> dict:
    """Run the exact Phase-0 interpretation, capturing tokens + latency + raw text."""
    orig_dims = _dims(image_bytes)
    pages = [(image_bytes, "image/jpeg")]
    if do_preprocess:
        pages = [preprocess.prepare_print_image(d, mt) for d, mt in pages]
    pre_dims = _dims(pages[0][0])

    client = interpret._client()
    content = [interpret._source_block(d, mt) for d, mt in pages]
    content.append({"type": "text", "text": interpret._user_prompt({"drawing_type": None}, question)})

    t0 = time.time()
    with client.messages.stream(
        model=interpret.DEFAULT_MODEL,
        max_tokens=interpret.MAX_TOKENS,
        system=interpret._SYSTEM,
        thinking={"type": "adaptive"},
        output_config={"effort": interpret.EFFORT},
        messages=[{"role": "user", "content": content}],
    ) as stream:
        message = stream.get_final_message()
    latency = round(time.time() - t0, 1)

    raw_text = interpret._first_text(message)
    graph = interpret._apply_confidence_gate(
        PrintSynthGraph.model_validate(json.loads(interpret._strip_fences(raw_text)))
    )
    u = message.usage
    return {
        "orig_dims": list(orig_dims),
        "pre_dims": list(pre_dims),
        "request": {
            "model": interpret.DEFAULT_MODEL,
            "effort": interpret.EFFORT,
            "max_tokens": interpret.MAX_TOKENS,
            "thinking": "adaptive",
            "preprocess": do_preprocess,
        },
        "latency_s": latency,
        "usage": {"input_tokens": u.input_tokens, "output_tokens": u.output_tokens},
        "cost_usd": round(u.input_tokens * 5 / 1e6 + u.output_tokens * 25 / 1e6, 4),
        "graph": graph.model_dump(),
        "raw_text": raw_text,
    }


def run_and_grade(
    name: str,
    image_bytes: bytes,
    rubric: dict | None = None,
    question: str | None = None,
    do_preprocess: bool = True,
    forbid_tokens: list[str] | None = None,
) -> dict:
    """Full acceptance record for one image: capture + grade (if rubric) + honesty
    checks. ``forbid_tokens`` (for the unrelated-print generalization test) are
    designation tokens that MUST NOT appear (no cross-case hallucination)."""
    cap = interpret_capture(image_bytes, question=question, do_preprocess=do_preprocess)
    g = cap["graph"]
    pool = grader._structured_tag_pool(g)

    record = {"name": name, **cap}
    record["unreadable"] = [
        (u or {}).get("item") for u in (g.get("unresolved") or [])
    ]
    record["confident_structured_tags"] = sorted(t for t in pool if t and t != "UNREADABLE")
    if rubric is not None:
        result = grader.grade(g, rubric)
        record["grade"] = {
            "overall": result["overall"],
            "letter": result["letter"],
            "is_A": result["is_A"],
            "confident_misreads": result["confident_misreads"],
            "trust_violations": result["trust_violations"],
            "scores": result["scores"],
            "gates": result["gates"],
            "device_f1": result["device"]["f1"],
            "wire_f1": result["wire"]["f1"],
            "missed": result["device"]["missed"] + result["wire"]["missed"] + result["xref"]["missed"],
            "misreads": result["device"]["misreads"] + result["wire"]["misreads"] + result["xref"]["misreads"],
        }
    if forbid_tokens:
        hits = [t for t in forbid_tokens if grader._norm(t) in pool]
        record["hallucinated_forbidden"] = hits  # empty = passed the no-hallucination check
    return record


def _dims(image_bytes: bytes) -> tuple[int, int]:
    from PIL import Image

    return Image.open(io.BytesIO(image_bytes)).size
