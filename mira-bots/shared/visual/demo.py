"""MIRA Visual Technician — Phase 1 demo CLI (ADR-0027).

Run from ``mira-bots/``::

    py -3 -m shared.visual.demo --image <path> --ask "<question>" [--fake] [--tenant-id <uuid>]

Ingests one image into a fresh in-process ``VisualSession``, asks one
question, and pretty-prints the resulting ``AnswerEnvelope`` (answer,
per-claim state + supporting evidence ids, next_best_evidence, safety_notes)
plus its raw JSON. Used as PR evidence for Phase 1.

``--fake`` injects deterministic, offline stand-ins for ``VisionWorker``,
``PrintWorker``, and the schematic extractor — no network, no LLM, no live
Open WebUI required. Without ``--fake`` the demo calls the REAL workers
(``OPENWEBUI_BASE_URL`` / ``OPENWEBUI_API_KEY`` / ``VISION_MODEL``), which
requires a reachable Open WebUI instance.

The store is whatever ``VisualSessionService``'s default resolves to
(``store.default_store()``): Neon-backed if ``NEON_DATABASE_URL`` is set,
otherwise an in-process ``InMemoryVisualStore`` — the same graceful-degrade
path production code uses, so the demo exercises the real default wiring
rather than a demo-only shortcut.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

from .models import AnswerEnvelope
from .session_service import VisualSessionService

logger = logging.getLogger("mira-gsd.visual_demo")


class _FakeVisionWorker:
    """Deterministic offline stand-in for VisionWorker.process() — --fake only."""

    async def process(self, photo_b64: str, message: str) -> dict:
        return {
            "classification": "ELECTRICAL_PRINT",
            "classification_confidence": 0.82,
            "vision_result": "A control-circuit ladder diagram showing a motor starter rung.",
            "ocr_items": [
                "K1 contactor coil",
                "contact CR3 normally open",
                "wire number 100",
                "OL1 overload contact",
            ],
            "ocr_tokens": [],
            "ocr_source": "none",
            "tesseract_text": "",
            "drawing_type": "ladder logic diagram",
            "drawing_type_confidence": 0.7,
        }


class _FakePrintWorker:
    """Deterministic offline stand-in for PrintWorker.process() — --fake only."""

    async def process(self, message: str, state: dict) -> str:
        return (
            "This appears to show a motor-starter control rung: CR3 and the start "
            "circuitry appear to energize the K1 contactor coil, gated by OL1."
        )


def _fake_schematic_extractor(image_bytes: bytes) -> SimpleNamespace:
    """Deterministic offline stand-in for run_schematic_pipeline() — --fake only.

    A plain SimpleNamespace duck-typing SchematicResult (.symbols /
    .connections with .ref/.type/.from_ref/.to_ref/.wire_number) — proves the
    session_service adapter boundary really is decoupled from the real
    mira-mcp dataclasses, not just from the network call.
    """
    symbol = SimpleNamespace(ref="K1", type="contactor")
    connection = SimpleNamespace(from_ref="K1:A1", to_ref="CR3:13", wire_number="100")
    return SimpleNamespace(
        symbols=[symbol], connections=[connection], schematic_type="iec_ladder", notes=[]
    )


async def _run(args: argparse.Namespace) -> AnswerEnvelope:
    image_bytes = Path(args.image).read_bytes()
    tenant_id = args.tenant_id or str(uuid.uuid4())

    service = VisualSessionService()
    session_id = await service.create_session(tenant_id, title="Visual Technician demo session")
    if session_id is None:
        raise RuntimeError("failed to create a demo session")

    if args.fake:
        vision, print_worker, schematic = (
            _FakeVisionWorker(),
            _FakePrintWorker(),
            _fake_schematic_extractor,
        )
    else:
        logger.warning(
            "Running WITHOUT --fake: this calls the REAL workers and requires a reachable "
            "Open WebUI instance (OPENWEBUI_BASE_URL=%s).",
            os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080"),
        )
        vision, print_worker, schematic = None, None, None

    ingest_result = await service.ingest_image(
        session_id,
        tenant_id,
        image_bytes,
        vision=vision,
        print_worker=print_worker,
        schematic=schematic,
    )
    logger.info(
        "ingest status=%s evidence_id=%s quality=%.2f observations=%d",
        ingest_result.status,
        ingest_result.evidence_id,
        ingest_result.quality.score,
        len(ingest_result.observations),
    )
    if ingest_result.status != "ok":
        logger.warning("ingest hint: %s", ingest_result.hint)

    return await service.ask(session_id, tenant_id, args.ask)


def _print_envelope(envelope: AnswerEnvelope) -> None:
    print("=" * 72)
    print("ANSWER")
    print("=" * 72)
    print(envelope.answer)
    print()
    print("-" * 72)
    print(f"CLAIMS ({len(envelope.claims)})")
    print("-" * 72)
    for i, claim in enumerate(envelope.claims, 1):
        print(f"{i}. [{claim.evidence_state.value}] {claim.text}")
        print(f"   supporting_observation_ids: {claim.supporting_observation_ids}")
        if claim.doc_citations:
            print(f"   doc_citations: {claim.doc_citations}")
        if claim.uncertainty:
            print(f"   uncertainty: {claim.uncertainty}")
        print(f"   safety_flag: {claim.safety_flag}")
    print()
    print("-" * 72)
    print(f"next_best_evidence: {envelope.next_best_evidence}")
    print(f"safety_notes: {envelope.safety_notes}")
    print("=" * 72)
    print()
    print("JSON:")
    print(json.dumps(envelope.to_dict(), indent=2, default=str))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MIRA Visual Technician -- Phase 1 demo")
    parser.add_argument("--image", required=True, help="path to an image file")
    parser.add_argument("--ask", required=True, help="question to ask about the ingested image")
    parser.add_argument(
        "--fake", action="store_true", help="use deterministic fake workers (offline, no network)"
    )
    parser.add_argument(
        "--tenant-id", default=None, help="tenant UUID (default: a fresh random UUID)"
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    envelope = asyncio.run(_run(args))
    _print_envelope(envelope)
    return 0


if __name__ == "__main__":
    sys.exit(main())
