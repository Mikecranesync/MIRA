"""The service-pack resolver contract (ADR-0025 §1a follow-on).

A single, pure, no-LLM, no-DB entry point that turns whatever signal a surface
has on hand — a technician-typed drive name, a free-text question, an
asset's make/model, a nameplate-vision dict, or an already-known pack id —
into a :class:`PackResolution` naming exactly one LIVE (approved) service
pack, or an honest refusal.

Hard boundaries (ADR-0025 + ``.claude/rules/fieldbus-readonly.md``):
- Pure function of its inputs. No fieldbus I/O, no network, no DB, no LLM.
- Never returns a candidate/unpromoted pack id — only ids in
  :func:`shared.drive_packs.loader.list_packs`.
- Never raises. Every input shape (missing/empty/malformed) degrades to a
  refusal, never an exception.

Resolution order (first non-empty signal wins the *attempt*; a 0-match signal
falls through to the next one; an *ambiguous* signal — more than one live pack
matched — refuses immediately and does NOT fall through to a weaker signal):

    explicit_pack_id  (highest — accept only if live, else refuse)
    -> drive_name
    -> question
    -> asset_make_model
    -> nameplate

If nothing resolves, the refusal names a recognized manufacturer when one is
present in the input text (asking for the model/series), or a fully generic
"name the drive or scan the nameplate" refusal otherwise.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from .loader import DrivePack, list_packs, load_pack
from .nameplate import resolve_pack_from_vision

# Fields (in addition to manufacturer/model) that may carry identifying text
# in a nameplate-vision dict — mirrors nameplate.py's own field preference,
# without symptom/condition (those describe the fault, not the drive).
_NAMEPLATE_EXTRA_FIELDS = ("series", "description", "component")


@dataclass(frozen=True)
class PackResolution:
    """The result of resolving a service pack from whatever signal a surface has.

    ``confidence`` is a band ("high" | "medium" | "none"), not a numeric
    score — matches the UNS resolver's confidence-band convention
    (``.claude/rules/uns-compliance.md`` §9).
    """

    pack_id: str | None
    confidence: str
    source: str
    evidence: list[str] = field(default_factory=list)
    reason: str = ""
    ambiguous: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _all_live_packs() -> list[DrivePack]:
    return [load_pack(pack_id) for pack_id in list_packs()]


def _matching_live_packs(text: str, packs: list[DrivePack] | None = None) -> list[DrivePack]:
    """Every LIVE pack whose family alias OR nameplate keyword appears in ``text``.

    Two-pass family-first, like ``loader.resolve_pack`` — but returns ALL
    matches in the winning pass instead of just the first, so ambiguity (more
    than one drive named in the same text) is visible to the caller instead of
    silently picked by pack iteration order.
    """
    if not text:
        return []
    haystack = text.lower()
    packs = packs if packs is not None else _all_live_packs()

    family_matches = [p for p in packs if any(a.lower() in haystack for a in p.family.aliases)]
    if family_matches:
        return family_matches

    return [p for p in packs if any(k.lower() in haystack for k in p.nameplate.match_keywords)]


def _matched_term(pack: DrivePack, text: str) -> str:
    haystack = text.lower()
    for alias in pack.family.aliases:
        if alias.lower() in haystack:
            return alias
    for kw in pack.nameplate.match_keywords:
        if kw.lower() in haystack:
            return kw
    return pack.pack_id


def _ambiguous_refusal(source: str, text: str, matches: list[DrivePack]) -> PackResolution:
    names = ", ".join(p.family.series for p in matches)
    return PackResolution(
        pack_id=None,
        confidence="none",
        source=source,
        evidence=[f"{source} text '{text}' matched multiple live packs ({names})"],
        reason=f"'{text}' matches multiple drives ({names}) — name the model",
        ambiguous=True,
    )


def _resolved(source: str, confidence: str, text: str, pack: DrivePack) -> PackResolution:
    term = _matched_term(pack, text)
    return PackResolution(
        pack_id=pack.pack_id,
        confidence=confidence,
        source=source,
        evidence=[f"{source} named '{term}'"],
        reason=f"{source} matched '{term}' to the {pack.family.series} pack",
    )


def _nameplate_text(nameplate: dict[str, Any]) -> str:
    manufacturer = str(nameplate.get("manufacturer") or "")
    model = str(nameplate.get("model") or "")
    extra = " ".join(str(nameplate.get(k) or "") for k in _NAMEPLATE_EXTRA_FIELDS)
    return " ".join(part for part in (manufacturer, model, extra) if part)


def _recognized_manufacturer(texts: list[str], packs: list[DrivePack]) -> str | None:
    """The canonical (correctly-cased) manufacturer name if any provided text
    mentions a live pack's manufacturer, else ``None``."""
    manufacturers = {p.family.manufacturer for p in packs}
    for text in texts:
        if not text:
            continue
        haystack = text.lower()
        for mfr in manufacturers:
            if mfr.lower() in haystack:
                return mfr
    return None


def resolve_service_pack(
    *,
    question: str | None = None,
    drive_name: str | None = None,
    asset_make_model: str | None = None,
    nameplate: dict[str, Any] | None = None,
    explicit_pack_id: str | None = None,
    allow_candidates: bool = False,
) -> PackResolution:
    """Resolve exactly one LIVE service pack from whatever signal is available.

    See module docstring for the resolution order + refusal rules. Never
    raises; never returns a non-live pack id.
    """
    # 1) explicit_pack_id — highest precedence, live-only.
    if explicit_pack_id:
        live_ids = list_packs()
        if explicit_pack_id in live_ids:
            return PackResolution(
                pack_id=explicit_pack_id,
                confidence="high",
                source="pack_id",
                evidence=[f"explicit pack_id '{explicit_pack_id}'"],
                reason="explicit approved pack",
            )
        candidate_note = (
            " (candidate packs are not runtime-loadable — only approved/live packs answer "
            "questions)"
            if allow_candidates
            else ""
        )
        return PackResolution(
            pack_id=None,
            confidence="none",
            source="pack_id",
            evidence=[],
            reason=f"'{explicit_pack_id}' is not an approved (live) service pack{candidate_note}",
        )

    packs = _all_live_packs()

    # 2) Ordered text signals — first non-empty signal wins the *attempt*; a
    # 0-match signal falls through, an ambiguous one refuses immediately.
    text_signals: list[tuple[str, str, str]] = []
    if drive_name:
        text_signals.append(("drive_name", drive_name, "high"))
    if question:
        text_signals.append(("question", question, "high"))
    if asset_make_model:
        text_signals.append(("asset", asset_make_model, "medium"))

    for source, text, confidence in text_signals:
        matches = _matching_live_packs(text, packs)
        if len(matches) == 1:
            return _resolved(source, confidence, text, matches[0])
        if len(matches) > 1:
            return _ambiguous_refusal(source, text, matches)
        # 0 matches -> fall through to the next signal.

    # 3) Nameplate signal (medium confidence, same ambiguity handling).
    nameplate_text = ""
    if nameplate:
        nameplate_text = _nameplate_text(nameplate)
        matches = _matching_live_packs(nameplate_text, packs) if nameplate_text else []
        if not matches:
            # Cross-check against the existing vision-dict resolver — pure
            # glue, no new matching logic (resolve_pack_from_vision already
            # applies the same two-pass family-first match).
            cross_check = resolve_pack_from_vision(nameplate)
            if cross_check is not None:
                matches = [cross_check]
        if len(matches) == 1:
            return _resolved("nameplate", "medium", nameplate_text or str(nameplate), matches[0])
        if len(matches) > 1:
            return _ambiguous_refusal("nameplate", nameplate_text, matches)

    # 4) Nothing resolved — a manufacturer-only refusal is more helpful than
    # the fully generic one.
    all_texts = [t for _, t, _ in text_signals] + ([nameplate_text] if nameplate_text else [])
    mfr = _recognized_manufacturer(all_texts, packs)
    if mfr:
        return PackResolution(
            pack_id=None,
            confidence="none",
            source="none",
            evidence=[f"recognized manufacturer '{mfr}'"],
            reason=(
                f"recognized manufacturer '{mfr}' but need the model/series "
                "(e.g. GS10) to pick the service pack"
            ),
        )

    return PackResolution(
        pack_id=None,
        confidence="none",
        source="none",
        evidence=[],
        reason="no approved service pack matches — name the drive (e.g. GS10) or scan the nameplate",
    )
