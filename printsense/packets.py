"""Frontier job packets — compact, deterministic, provider-neutral (PR-G).

A packet carries ONLY the evidence relevant to one subsystem, is
schema-validated (pydantic), content-addressed (sha256 of the canonical
JSON), bounded in size, and traceable back to every source page and crop.
Never ship a whole raw package to a model.
"""

from __future__ import annotations

import hashlib
import json

from pydantic import BaseModel, Field

PACKET_VERSION = "frontier_packet_v1"
MAX_PACKET_CHARS = 60_000

REQUESTABLE_OUTPUTS = (
    "theory_of_operation", "signal_flow", "power_flow", "control_sequence",
    "safety_dependencies", "unresolved_questions",
)


class FrontierPacket(BaseModel):
    packet_version: str = PACKET_VERSION
    subsystem: str
    relevant_pages: list[str] = Field(min_length=1)
    device_count: int = 0
    resolved_xrefs: int = 0
    unresolved_xrefs: int = 0
    contradictions: int = 0
    ocr_excerpts: list[dict] = Field(default_factory=list)
    evidence_crops: list[dict] = Field(default_factory=list)
    requested_outputs: list[str] = Field(min_length=1)

    model_config = {"extra": "forbid"}


def build_packet(subsystem: str, relevant_pages: list[str],
                 xref_records: list[dict], device_count: int,
                 ocr_excerpts: list[dict] | None = None,
                 evidence_crops: list[dict] | None = None,
                 requested_outputs: list[str] | None = None) -> dict:
    outs = requested_outputs or list(REQUESTABLE_OUTPUTS)
    bad = [o for o in outs if o not in REQUESTABLE_OUTPUTS]
    if bad:
        raise ValueError(f"unknown requested outputs: {bad}")
    pages = set(relevant_pages)
    in_scope = [r for r in xref_records
                if str(r.get("source_page")) in pages
                or r.get("target_page") in pages]
    packet = FrontierPacket(
        subsystem=subsystem,
        relevant_pages=sorted(pages),
        device_count=device_count,
        resolved_xrefs=sum(r.get("resolution") == "resolved" for r in in_scope),
        unresolved_xrefs=sum(r.get("resolution") in ("ambiguous",
                                                     "missing_target")
                             for r in in_scope),
        contradictions=sum(r.get("resolution") == "contradictory"
                           for r in in_scope),
        ocr_excerpts=[e for e in (ocr_excerpts or [])
                      if e.get("page_sha") in pages],
        evidence_crops=[c for c in (evidence_crops or [])
                        if c.get("page_sha") in pages],
        requested_outputs=outs,
    ).model_dump()
    canon = json.dumps(packet, sort_keys=True, separators=(",", ":"),
                       ensure_ascii=False)
    if len(canon) > MAX_PACKET_CHARS:
        raise ValueError(
            f"packet exceeds bounded size ({len(canon)} > {MAX_PACKET_CHARS}); "
            f"split the subsystem")
    packet["packet_id"] = hashlib.sha256(canon.encode("utf-8")).hexdigest()[:24]
    return packet
