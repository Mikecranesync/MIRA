"""The asset-identity packet — RAW evidence vs. INTERPRETED fields (Phase 2, #2561).

Drive Commander's nameplate flow produces two different kinds of information
from one photo: the raw OCR text a vision model actually saw, and a set of
*interpreted* fields (manufacturer, model number, voltage, ...) an operator or
downstream matcher derives from that text. Conflating them is how a bad OCR
read or an over-eager guess quietly becomes "fact." This module keeps the two
apart in one frozen, serializable packet and never promotes a guess to a
verified field on its own.

Hard boundaries (ADR-0025 + ``.claude/rules/fieldbus-readonly.md`` +
``.claude/CLAUDE.md`` "Knowledge graph proposals" — never silently assert):
- Pure function of its inputs. No fieldbus I/O, no network, no DB, no LLM.
- Never fabricates a value. Missing/empty/unparseable input maps to ``None``,
  never a best guess.
- ``sku_prefix`` is derived from ``model_number`` ONLY via a conservative
  regex match on the leading catalog-prefix token (e.g. ``GS11N`` out of
  ``GS11N-20P2``). If the leading token doesn't look like a catalog prefix,
  ``sku_prefix`` stays ``None`` — it is never invented.
- ``approval_status`` always starts ``"unreviewed"``. A packet is a proposal,
  never an auto-approved fact (mirrors the KG "proposed vs verified" rule).
- Never raises. Every input shape (missing/empty/malformed/``parse_error``)
  degrades to an all-``None`` packet, never an exception.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

# NameplateWorker.extract() dict key -> AssetIdentityPacket field name.
# See mira-bots/shared/workers/nameplate_worker.py::NAMEPLATE_FIELDS.
# ("rpm" has no corresponding packet field yet — intentionally dropped, not
# fabricated into an unrelated slot.)
_NAMEPLATE_FIELD_MAP: dict[str, str] = {
    "manufacturer": "manufacturer",
    "model": "model_number",
    "serial": "serial_number",
    "voltage": "input_voltage",
    "fla": "current_or_fla",
    "hp": "hp",
    "frequency": "frequency",
}

# Conservative catalog-prefix shape: 2+ uppercase letters, then digits,
# optionally trailing uppercase letters (e.g. "GS11N", "GS13N", "PF525").
# Matched against ONLY the token before the first hyphen/space in
# model_number — never against the whole string, never with fuzzy matching.
_SKU_PREFIX_RE = re.compile(r"^[A-Z]{2,}\d+[A-Z]*$")


@dataclass(frozen=True)
class AssetIdentityPacket:
    """Evidence-separated identity for one nameplate read.

    ``raw_text`` is the untouched OCR/vision transcript — never edited to
    "clean it up." Every other field below it is an INTERPRETED value derived
    from that evidence (or from a resolver's proposal); none of them may be
    used as a substitute for the raw evidence when auditing a claim.
    """

    raw_text: str | None = None

    manufacturer: str | None = None
    brand: str | None = None
    product_family: str | None = None
    series: str | None = None
    model_number: str | None = None
    catalog_number: str | None = None
    sku_prefix: str | None = None
    serial_number: str | None = None
    firmware_or_revision: str | None = None
    date_code: str | None = None

    input_voltage: str | None = None
    output_voltage: str | None = None
    phase: str | None = None
    hp: str | None = None
    kw: str | None = None
    current_or_fla: str | None = None
    frequency: str | None = None
    frame_size: str | None = None
    enclosure_rating: str | None = None
    sccr: str | None = None
    certifications: list[str] = field(default_factory=list)

    barcode_or_qr_payload: str | None = None
    evidence_image_id: str | None = None
    confidence_by_field: dict[str, str] = field(default_factory=dict)

    candidate_pack_id: str | None = None
    candidate_asset_id: str | None = None
    approval_status: str = "unreviewed"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _clean(value: Any) -> Any | None:
    """Falsy (``None``, ``""``, etc.) -> ``None``; otherwise pass through unchanged.

    Never fabricates — this only filters out "nothing there," it doesn't
    transform or infer a value.
    """
    return value if value else None


def _derive_sku_prefix(model_number: str | None) -> str | None:
    """Conservative catalog-prefix extraction from a model number.

    Splits ``model_number`` on the first hyphen or space and checks whether
    that leading token matches the catalog-prefix shape (``_SKU_PREFIX_RE``).
    Matches e.g. "GS11N" out of "GS11N-20P2". Returns ``None`` — never a
    guess — when the leading token doesn't match.
    """
    if not model_number:
        return None
    candidate = re.split(r"[-\s]", model_number, maxsplit=1)[0]
    if _SKU_PREFIX_RE.fullmatch(candidate):
        return candidate
    return None


def _apply_resolution(kwargs: dict[str, Any], resolution: Any) -> None:
    """Record a resolver's candidate pack (never auto-approved) onto ``kwargs``.

    Guarded with ``getattr`` so a non-``PackResolution`` object (or a
    duck-typed stand-in) degrades to a no-op instead of raising.
    """
    if not resolution:
        return
    pack_id = getattr(resolution, "pack_id", None)
    confidence = getattr(resolution, "confidence", None)
    kwargs["candidate_pack_id"] = pack_id
    if confidence is not None:
        confidence_by_field = dict(kwargs.get("confidence_by_field") or {})
        confidence_by_field["candidate_pack_id"] = confidence
        kwargs["confidence_by_field"] = confidence_by_field


def build_asset_identity(
    *,
    nameplate: dict[str, Any] | None,
    raw_text: str | None = None,
    resolution: Any = None,
    evidence_image_id: str | None = None,
) -> AssetIdentityPacket:
    """Build an :class:`AssetIdentityPacket` from a nameplate read.

    ``nameplate`` is expected to be the dict shape returned by
    ``NameplateWorker.extract()`` — a field dict, or ``{"parse_error": ...}``
    on total OCR failure. Both a non-dict/``None`` nameplate and a
    ``parse_error`` dict degrade to an all-``None`` interpreted-field packet
    (``raw_text`` still comes through if given) — never an exception.

    ``raw_text`` (the arg) wins over any ``raw_text`` key already present in
    ``nameplate`` — the explicit arg is assumed to be the more direct source.

    Never raises.
    """
    nameplate_src: dict[str, Any] = nameplate if isinstance(nameplate, dict) else {}
    has_parse_error = "parse_error" in nameplate_src

    effective_raw_text = raw_text if raw_text is not None else nameplate_src.get("raw_text")

    kwargs: dict[str, Any] = {
        "raw_text": _clean(effective_raw_text),
        "evidence_image_id": evidence_image_id,
    }

    if not has_parse_error:
        for source_key, packet_field in _NAMEPLATE_FIELD_MAP.items():
            kwargs[packet_field] = _clean(nameplate_src.get(source_key))
        kwargs["sku_prefix"] = _derive_sku_prefix(kwargs.get("model_number"))

    _apply_resolution(kwargs, resolution)

    return AssetIdentityPacket(**kwargs)
