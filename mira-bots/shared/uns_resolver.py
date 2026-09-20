"""UNS message resolver — single extraction point for vendor / model / fault
code / category per turn.

Reads a free-form user message and returns a `UNSContext` whose fields map
directly onto UNS path segments built by `mira-crawler/ingest/uns.py`. Engine,
workers, and DST all read from `state["context"]["uns_context"]` instead of
re-running their own extraction.

Storage location matters: `session_manager.save_state` only persists declared
columns plus `state["context"]` (as a JSON blob). Top-level keys outside that
schema are dropped on save — so the resolver result MUST live under
`state["context"]["uns_context"]` to round-trip across turns.

See `docs/specs/uns-message-resolver-spec.md` for the contract. See
`.claude/rules/uns-compliance.md` for the rules this module enforces.
"""

from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from typing import Any
from urllib.parse import unquote

# Path builders live in shared/uns_paths.py — a verbatim, dep-free copy of the
# subset of mira-crawler/ingest/uns.py the resolver needs. mira-bots cannot
# import from mira-crawler (architecture contract, enforced in CI).
from . import uns_paths as _uns
from .neon_recall import kb_has_pair_coverage

logger = logging.getLogger(__name__)


def _normalize_identity_words(value: str) -> str:
    """Normalize punctuation variants without weakening token boundaries."""
    value = re.sub(r"\(\s*(?:r|tm|sm)\s*\)", " ", value.casefold())
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


@lru_cache(maxsize=128)
def _drive_pack_identity_terms(
    model_identity: str,
) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...], tuple[str, ...], str]:
    """Return pack aliases, keywords, models, and documented parameter/fault IDs.

    Pack lookup reads JSON from disk, so cache by the canonical query identity.
    The pack remains the single source of truth; this helper does not introduce a
    second identity mapping.
    """
    try:
        from .drive_packs.loader import resolve_pack  # noqa: PLC0415

        pack = resolve_pack(model_identity)
    except Exception:  # noqa: BLE001 - drive packs are an optional refinement
        return (), (), (), (), ""
    if not pack:
        return (), (), (), (), ""
    aliases = tuple(
        dict.fromkeys(_normalize_identity_words(alias) for alias in pack.family.aliases if alias)
    )
    keywords = tuple(
        dict.fromkeys(
            _normalize_identity_words(keyword)
            for keyword in pack.nameplate.match_keywords
            if keyword
        )
    )
    # A declared umbrella series does not authorize every number sharing its
    # prefix. Build the allow-list only from identities the repository already
    # knows: the shipped pack itself, its cited provenance, and canonical
    # resolver aliases that fall under the declared series. This admits the
    # documented 523/525/527 family without guessing that a 529 exists.
    series_identity = _normalize_identity_words(pack.family.series)
    series_match = re.fullmatch(r"(?P<family>.+?)\s+(?P<model>\d{2,4})", series_identity)
    family_name = series_match.group("family") if series_match else ""
    documented_models: set[str] = set()
    series_numbers = {
        number
        for alias in aliases
        if " series " in f" {alias} "
        for number in re.findall(r"\b\d{2,4}\b", alias)
    }
    series_prefixes = {number[:-1] for number in series_numbers if len(number) >= 2}

    identity_texts = [pack.family.series, *pack.family.aliases, *pack.nameplate.match_keywords]
    for source in pack.provenance.sources:
        if isinstance(source, dict):
            identity_texts.extend(str(source.get(key) or "") for key in ("doc", "excerpt"))
    if family_name:
        family_pattern = rf"(?:^|\s){re.escape(family_name)}\s+(?P<model>\d{{2,4}})(?:\s|$)"
        for value in identity_texts:
            normalized = _normalize_identity_words(value)
            documented_models.update(
                match.group("model") for match in re.finditer(family_pattern, normalized)
            )

        for expanded in FAMILY_FROM_ALIAS.values():
            normalized = _normalize_identity_words(expanded)
            expanded_match = re.fullmatch(r"(?P<family>.+?)\s+(?P<model>\d{2,4})", normalized)
            if not expanded_match or expanded_match.group("family") != family_name:
                continue
            candidate = expanded_match.group("model")
            if not series_prefixes or any(
                candidate.startswith(prefix) for prefix in series_prefixes
            ):
                documented_models.add(candidate)

    documented_models.update(series_numbers)
    code_texts: list[str] = []
    for parameter in pack.parameters:
        code_texts.append(parameter.parameter_id)
        code_texts.extend(parameter.related_parameters)
        code_texts.append(parameter.source_citation.excerpt)
    for provenance in pack.provenance.sources:
        if isinstance(provenance, dict):
            code_texts.append(str(provenance.get("excerpt") or ""))
    documented_codes = {
        token.casefold()
        for value in code_texts
        for token in re.findall(
            r"(?<![a-z0-9])[a-z]{1,3}\d{1,4}[a-z]{0,3}(?![a-z0-9])", value, re.I
        )
    }
    return (
        aliases,
        keywords,
        tuple(sorted(documented_models)),
        tuple(sorted(documented_codes)),
        pack.pack_id,
    )


# ---------------------------------------------------------------------------
# Alias tables
# ---------------------------------------------------------------------------

# alias → canonical manufacturer display name. Lowercase keys, matched as
# whole-word substrings against the message. Order matters only for tie-break
# (first hit wins); the dict preserves insertion order.
VENDOR_ALIASES: dict[str, str] = {
    # Rockwell family
    "powerflex": "Rockwell Automation",
    "allen-bradley": "Rockwell Automation",
    "allen bradley": "Rockwell Automation",
    "rockwell automation": "Rockwell Automation",
    "rockwell": "Rockwell Automation",
    "ab": "Rockwell Automation",
    # AutomationDirect family
    "gs10": "AutomationDirect",
    "gs20": "AutomationDirect",
    # GS1/GS2/GS3/GS4 are out-of-KB but still AutomationDirect; no FAMILY_FROM_ALIAS
    # entry so confidence stays at 0.5 (manufacturer only) and the UNS gate fires,
    # giving the bot a chance to confirm context before the out-of-KB path handles it.
    "gs1": "AutomationDirect",
    "gs2": "AutomationDirect",
    "gs3": "AutomationDirect",
    "gs4": "AutomationDirect",
    "gs4p": "AutomationDirect",
    "gs11": "AutomationDirect",
    "gs21": "AutomationDirect",
    "automationdirect": "AutomationDirect",
    "automation direct": "AutomationDirect",
    # Siemens family
    "micromaster": "Siemens",
    "sinamics": "Siemens",
    "siemens": "Siemens",
    # Mitsubishi family
    "mitsubishi electric": "Mitsubishi Electric",
    "mitsubishi": "Mitsubishi Electric",
    "fr-e": "Mitsubishi Electric",
    "fr-a": "Mitsubishi Electric",
    "fr-d": "Mitsubishi Electric",
    "fr-f": "Mitsubishi Electric",
    # Danfoss
    "aqua drive": "Danfoss",
    "danfoss": "Danfoss",
    # Schneider
    "schneider electric": "Schneider Electric",
    "schneider": "Schneider Electric",
    # Bosch Rexroth
    "bosch rexroth": "Bosch Rexroth",
    "rexroth": "Bosch Rexroth",
    # Rockwell specific models (alias resolves both brand AND model)
    "pf525": "Rockwell Automation",
    "pf527": "Rockwell Automation",
    "pf520": "Rockwell Automation",
    "pf40": "Rockwell Automation",
    "pf70": "Rockwell Automation",
    "pf753": "Rockwell Automation",
    "pf755": "Rockwell Automation",
    # SEW-Eurodrive
    "sew-eurodrive": "SEW-Eurodrive",
    "sew": "SEW-Eurodrive",
    "movitrac": "SEW-Eurodrive",
    "movidrive": "SEW-Eurodrive",
    # Yaskawa specific model families
    "a1000": "Yaskawa",
    "v1000": "Yaskawa",
    "j1000": "Yaskawa",
    "ga500": "Yaskawa",
    "ga700": "Yaskawa",
    "p1000": "Yaskawa",
    "e1000": "Yaskawa",
    # Singletons
    "yaskawa": "Yaskawa",
    "abb": "ABB",
    "omron": "Omron",
    "eaton": "Eaton",
    "delta": "Delta Electronics",
    "lenze": "Lenze",
    "pilz": "Pilz",
    # Materials-handling OEMs present in the corpus. Added 2026-08-03 because
    # both were cited live for machines the technician never identified, and
    # neither resolved — so the citation-attribution gate could not see them.
    # An unrecognized vendor bypasses that gate entirely (see
    # `tests/test_citation_attribution.py`), which makes this table a
    # correctness surface, not just a convenience.
    "demag": "Demag",
    "interroll": "Interroll",
}

# Alias → product-family token when the alias names a family rather than a
# brand. Used to populate UNSContext.product_family and the family segment in
# the UNS path. Aliases NOT in this dict produce product_family=None and a
# path with no family segment.
FAMILY_FROM_ALIAS: dict[str, str] = {
    "powerflex": "PowerFlex",
    "micromaster": "Micromaster",
    "sinamics": "Sinamics",
    "fr-e": "FR-E",
    "fr-a": "FR-A",
    "fr-d": "FR-D",
    "fr-f": "FR-F",
    "aqua drive": "AquaDrive",
    "gs10": "GS10",
    "gs20": "GS20",
    # Rockwell PowerFlex model-specific aliases
    "pf525": "PowerFlex 525",
    "pf527": "PowerFlex 527",
    "pf520": "PowerFlex 520",
    "pf40": "PowerFlex 40",
    "pf70": "PowerFlex 70",
    "pf753": "PowerFlex 753",
    "pf755": "PowerFlex 755",
    # SEW-Eurodrive
    "movitrac": "MOVITRAC",
    "movidrive": "MOVIDRIVE",
    # Yaskawa model families
    "a1000": "A1000",
    "v1000": "V1000",
    "j1000": "J1000",
    "ga500": "GA500",
    "ga700": "GA700",
    "p1000": "P1000",
    "e1000": "E1000",
}


# ---------------------------------------------------------------------------
# Fault code patterns
# ---------------------------------------------------------------------------

# Compiled regexes for fault-code extraction. `\b` boundaries keep "F0004"
# matching but skip "FAULTY". Patterns are checked in order; first hit wins.
FAULT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b[fF]\d{2,6}\b"),  # F04, F004, F0004, F30004
    re.compile(r"\b[eE]\d{1,4}\b"),  # E01, E001 (drives use E-codes)
    re.compile(r"\b[oO][cC][a-zA-Z]?\b"),  # oC, OC, ocA (overcurrent)
    re.compile(r"\b[oO][lL]\b"),  # OL (overload)
    re.compile(r"\b[uU][lL]\b"),  # UL (underload)
    re.compile(r"\b[cC][eE]\d{1,2}\b"),  # CE1, CE10 (GS-family Modbus comm faults — CTX-001)
    re.compile(r"\b[aA][lL]\d{1,4}\b"),  # AL001 (alarm with AL prefix)
    re.compile(r"\b[aA]\d{1,4}\b"),  # A02, A002 (alarms — weakest)
]

# Words that may match the alarm pattern A\d{1,4} but are not fault codes
# (single-letter article "a" before digits, etc.). Conservative — only filter
# obvious false positives.
_FAULT_FALSE_POSITIVES: frozenset[str] = frozenset(
    {
        "a0",
        "a1",
        "a4",
        "a5",  # A4 paper, etc.
    }
)


# ---------------------------------------------------------------------------
# Category detection
# ---------------------------------------------------------------------------

_CATEGORY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(fault|error|trip|alarm)\s*code\b", re.IGNORECASE), "fault_codes"),
    (re.compile(r"\bfault\b", re.IGNORECASE), "fault_codes"),
    (re.compile(r"\bmanual\b|\bdatasheet\b|\bdocumentation\b", re.IGNORECASE), "manuals"),
    (
        re.compile(r"\bpm\b|\bpreventiv\w*\smaintenance\b|\bschedule\b", re.IGNORECASE),
        "pm_schedules",
    ),
    (re.compile(r"\bparts?\s*(list|number|kit)\b|\bspare\b", re.IGNORECASE), "parts_lists"),
]


# ---------------------------------------------------------------------------
# UNSContext dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class UNSContext:
    """Single canonical extraction result for a turn.

    See `docs/specs/uns-message-resolver-spec.md` for field semantics.
    Confidence bands:
      1.0 — manufacturer + model + fault, DB-confirmed
      0.9 — manufacturer + model + fault, alias-table only
      0.7 — manufacturer + model, alias-table
      0.5 — manufacturer only
      0.3 — fault code only (no vendor)
      0.0 — nothing matched
    """

    uns_path: str | None = None
    manufacturer: str | None = None
    manufacturer_alias: str | None = None
    product_family: str | None = None
    model: str | None = None
    fault_code: str | None = None
    fault_code_raw: str | None = None
    category: str | None = None
    site_path: str | None = None
    matched_entities: list[dict[str, Any]] = field(default_factory=list)
    matched_kb_count: int = 0
    confidence: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> UNSContext | None:
        if not data:
            return None
        # Tolerate extra keys (forward compat) and missing keys (backward compat).
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        clean = {k: v for k, v in data.items() if k in known}
        return cls(**clean)


@dataclass(frozen=True)
class UNSResolution:
    """Multi-candidate resolution result for messages that may name more than
    one vendor (cross-vendor integration questions).

    ``primary`` matches the legacy ``resolve_uns_path()`` semantics — the
    first vendor encountered in message order — so callers that only care
    about a single answer can read ``resolution.primary`` and ignore the
    rest.

    ``candidates`` is the validated list. Each entry is a ``UNSContext``
    for one vendor named in the message, with its nearest model token,
    after pair-coverage validation against the KB. Chimeric pairings (e.g.
    "AutomationDirect" + "820" — no row in ``knowledge_entries`` has them
    together) are dropped before the result is returned.

    For single-vendor messages, ``candidates`` has one entry equal to
    ``primary``. For messages with no recognized vendor, ``candidates`` is
    empty and ``primary`` is the legacy fault-only or no-op result.
    """

    primary: UNSContext
    candidates: tuple[UNSContext, ...] = ()

    @property
    def has_multi_vendor(self) -> bool:
        seen = {c.manufacturer for c in self.candidates if c.manufacturer}
        return len(seen) >= 2

    def vendors(self) -> list[str]:
        return [c.manufacturer for c in self.candidates if c.manufacturer]

    def as_dict(self) -> dict[str, Any]:
        return {
            "primary": self.primary.as_dict(),
            "candidates": [c.as_dict() for c in self.candidates],
        }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
_STOPWORDS: frozenset[str] = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "but",
        "by",
        "for",
        "from",
        "have",
        "has",
        "had",
        "i",
        "in",
        "is",
        "it",
        "of",
        "on",
        "or",
        "the",
        "this",
        "that",
        "to",
        "was",
        "with",
        "you",
        "we",
        "what",
        "when",
        "where",
        "how",
        "called",
        "got",
        "and",
        "do",
        "does",
        "did",
        "my",
        "me",
        "your",
        "their",
        "his",
        "her",
        "its",
        "fault",
        "error",
        "code",
        "manual",
        "issue",
        "problem",
        "showing",
    }
)


def _normalize_fault_code(raw: str) -> str:
    """Uppercase the letter, zero-pad the digits to 4 places for the F/E/A
    patterns. Leave oC family alone (case preserved)."""
    if not raw:
        return raw
    # oC family: keep as-is
    if raw.lower().startswith("oc"):
        return raw
    m = re.match(r"^([fFeEaA])(\d+)$", raw)
    if m:
        letter = m.group(1).upper()
        digits = m.group(2).zfill(4)
        return f"{letter}{digits}"
    return raw


def _extract_fault_codes(message: str) -> list[tuple[str, str, int]]:
    """Return list of (normalized, raw, pattern_index) fault matches.

    The pattern index reflects priority: 0=F-codes (strong), 1=E-codes
    (strong), 2=oC family (strong), 3=A-alarms (weak — also matches model
    names like Yaskawa A1000).
    """
    out: list[tuple[str, str, int]] = []
    for idx, pat in enumerate(FAULT_PATTERNS):
        for m in pat.finditer(message):
            tok = m.group(0)
            if tok.lower() in _FAULT_FALSE_POSITIVES:
                continue
            out.append((_normalize_fault_code(tok), tok, idx))
    return out


def _pick_fault_code(
    pairs: list[tuple[str, str, int]],
    model_position_token: str | None,
) -> tuple[str | None, str | None, frozenset[str]]:
    """Choose the fault code from candidates, avoiding the model-position
    token when a better candidate exists.

    Returns (normalized, raw, all_raw_tokens_for_stripping).

    Strong patterns (F/E/oC) are preferred. The A-pattern is used only when
    nothing stronger fired AND the match is not the model-position token.
    """
    if not pairs:
        return None, None, frozenset()

    all_raw = frozenset(p[1].lower() for p in pairs)

    # Sort by priority: strong patterns (0-2) before weak (3)
    strong = [p for p in pairs if p[2] <= 2]
    weak = [p for p in pairs if p[2] >= 3]

    mpos = (model_position_token or "").lower()

    for pair in strong + weak:
        if pair[1].lower() == mpos and len(pairs) > 1:
            # Skip the model-position token if there's another fault candidate
            continue
        return pair[0], pair[1], all_raw

    # All candidates collided with the model-position token; if all were weak,
    # treat as no fault (it's the model).
    if all(p[2] >= 3 for p in pairs):
        return None, None, all_raw

    # Strong pattern matched only the model-position token — still treat as fault.
    return pairs[0][0], pairs[0][1], all_raw


def _alias_pattern(alias: str) -> str:
    r"""Boundary rule for one vendor alias. The single definition of "named".

    `\b` is wrong at both ends here, in opposite directions:

    * **Too loose is not the problem — too strict is.** `\b` counts `_` and
      digits as word characters, so `\bgs10\b` misses `GS10_user_manual.pdf`
      and `\bpowerflex\b` misses `PowerFlex525`. Source labels are usually
      filenames, so that silently stops recognising the vendor of a real
      citation.
    * **A bare substring is worse.** `"ab"` (Allen-Bradley) fires inside
      "cable" and `"abb"` inside "grabbed", which invents a vendor from
      ordinary English.

    So: the character before must not be alphanumeric, and the character after
    must not be a letter. A following DIGIT is allowed only when the alias
    itself ends in a letter — `powerflex525` is a PowerFlex, but `gs100` is not
    a `gs10` and `gs10` is not a `gs1`.
    """
    esc = re.escape(alias)
    # A technician types the same model with or without a separator: "PF525",
    # "PF-525". Allow ONE hyphen/underscore at the letter->digit boundary inside
    # the alias. This widens nothing else — both boundary rules above still
    # apply, so "gs-100" is still not a "gs10" (the trailing-digit veto fires)
    # and "pf" alone still matches nothing.
    #
    # A SPACE is deliberately not accepted here. "pf 70" / "pf 40" is plausibly
    # a power-factor reading, and resolving that to a PowerFlex would pull an
    # unrelated vendor's manual into the conversation — the exact citation
    # failure class #3133 closed. "PF-70" has no such reading.
    esc = re.sub(r"(?<=[a-z])(?=\d)", "[_-]?", esc, count=1)
    tail = r"(?![a-z0-9])" if alias[-1].isdigit() else r"(?![a-z])"
    return rf"(?<![a-z0-9]){esc}{tail}"


def _match_vendor(message_lower: str) -> tuple[str | None, str | None, str | None]:
    """Return (canonical_mfr, alias_key_lower, family_token).

    Matches whole-word substrings. First hit wins.
    """
    # Order matters: longer/more-specific aliases first by sorting on length desc
    # within the iteration. Since dict order is preserved but we want longest
    # match wins for "rockwell automation" vs "rockwell", we sort once here.
    for alias in sorted(VENDOR_ALIASES.keys(), key=len, reverse=True):
        # Build a boundary-aware pattern. Aliases with hyphens or spaces are
        # matched literally (no \b around hyphens because \b breaks there).
        if any(c in alias for c in " -"):
            if alias in message_lower:
                mfr = VENDOR_ALIASES[alias]
                family = FAMILY_FROM_ALIAS.get(alias)
                return mfr, alias, family
        else:
            if re.search(_alias_pattern(alias), message_lower):
                mfr = VENDOR_ALIASES[alias]
                family = FAMILY_FROM_ALIAS.get(alias)
                return mfr, alias, family
    return None, None, None


def _match_all_vendors(
    message_lower: str,
) -> list[tuple[str, str, str | None, int]]:
    """Find every distinct canonical vendor named in the message.

    Returns a list of (canonical_mfr, alias_key_lower, family_token,
    char_position) sorted by char_position (first-named vendor first).
    Deduplicated by canonical manufacturer: if both "allen-bradley" and
    "rockwell" appear, only the earliest position for "Rockwell Automation"
    is returned. Longer-specific aliases win over shorter ones when both
    match the same canonical vendor (e.g. "rockwell automation" preferred
    over the bare "rockwell" at the same position).
    """
    # canonical -> (alias_lower, family_token, char_position, alias_length)
    best: dict[str, tuple[str, str | None, int, int]] = {}
    for alias in sorted(VENDOR_ALIASES.keys(), key=len, reverse=True):
        canonical = VENDOR_ALIASES[alias]
        family = FAMILY_FROM_ALIAS.get(alias)
        if any(c in alias for c in " -"):
            m = re.search(re.escape(alias), message_lower)
        else:
            m = re.search(_alias_pattern(alias), message_lower)
        if m is None:
            continue
        pos = m.start()
        existing = best.get(canonical)
        # Prefer the earliest position. On a position tie, prefer the longer
        # (more specific) alias — this keeps "rockwell automation" winning
        # over "rockwell" when both anchor at the same offset.
        if existing is None:
            best[canonical] = (alias, family, pos, len(alias))
            continue
        existing_pos = existing[2]
        existing_len = existing[3]
        if pos < existing_pos or (pos == existing_pos and len(alias) > existing_len):
            best[canonical] = (alias, family, pos, len(alias))

    results = [(canon, alias, family, pos) for canon, (alias, family, pos, _len) in best.items()]
    results.sort(key=lambda x: x[3])
    return results


def canonical_vendor(name: str | None) -> str | None:
    """Canonical manufacturer for a vendor / alias / brand-label string.

    Maps every label that names the *same* OEM to one canonical display name,
    so brand variants compare equal: ``"Allen-Bradley"`` / ``"Rockwell"`` /
    ``"PowerFlex"`` → ``"Rockwell Automation"``; ``"Automation Direct"`` /
    ``"AutomationDirect"`` → ``"AutomationDirect"``; ``"Yaskawa Electric
    Corporation"`` → ``"Yaskawa"``. Returns ``None`` when no known vendor is
    named (fail-open: callers must not treat ``None`` as a mismatch).

    Single source of truth for "are these two manufacturer strings the same
    vendor?" — shared by the citation-relevance gate
    (``citation_compliance``) and the retrieval cross-vendor filter
    (``rag_worker``) so they never disagree.

    Matching is **boundary-aware**, via the same ``_match_vendor`` this module
    already uses for message resolution. It previously did a bare ``alias in
    low`` substring test, which is wrong in a way that reaches the technician:
    the ``"ab"`` alias fires inside the word "cable", so *"Cable installation
    procedure"* resolved to Rockwell Automation. Once a citation gate started
    stripping on that answer, a legitimate generic cable source was removed
    from a reply as an "unsupported Rockwell citation".

    Longest alias still wins, so ``"rockwell automation"`` beats ``"rockwell"``.
    """
    if not name:
        return None
    low = name.strip().lower()
    if low in VENDOR_ALIASES:
        return VENDOR_ALIASES[low]
    mfr, _alias, _family = _match_vendor(low)
    return mfr


def vendors_in_text(text: str | None) -> set[str]:
    """Every canonical manufacturer named anywhere in a block of free text.

    ``canonical_vendor`` answers "which vendor is this label?" and returns the
    single best match. This answers "which vendors has the technician actually
    named?" across a whole turn or conversation — a different question, and the
    one that decides whether a citation may be attributed at all.

    Lives here rather than in the caller so "same vendor" stays defined in one
    place (`.claude/rules/uns-compliance.md` §1–2). Fail-open: an empty set
    means "nothing established", never "mismatch".

    Delegates to ``_match_all_vendors`` — the module's existing boundary-aware
    matcher — rather than testing ``alias in text``. A bare substring test
    matches "ab" inside "cable" and "abb" inside "grabbed", so
    *"the cable came loose"* would establish Rockwell and *"I grabbed the
    cable"* would establish ABB. Establishing a vendor nobody named is the
    exact failure this function exists to prevent.
    """
    if not text:
        return set()

    # Some legitimate vendor names are also ordinary maintenance words. Treat
    # their bare lowercase forms as ambiguous in free prose: ``delta-connected``
    # describes a motor winding and ``sew the sleeve`` is an instruction, not an
    # attribution to Delta Electronics or SEW-Eurodrive. Branded forms remain
    # detectable, as do the unambiguous model-family aliases in the same table.
    lowered = text.lower()
    delta_is_branded = bool(
        re.search(
            r"(?<![a-z0-9])delta[\W_]+(?:electronics?|drives?|vfds?|inverters?|servos?)"
            r"(?![a-z])",
            lowered,
        )
        or re.search(
            r"(?<![a-z0-9])(?:drives?|vfds?|inverters?|servos?)[\W_]+"
            r"(?:from[\W_]+|by[\W_]+)?delta(?![a-z0-9])",
            lowered,
        )
    )
    sew_is_branded = bool(
        re.search(r"(?<![A-Z0-9])SEW(?![A-Z0-9])", text)
        or re.search(r"(?<![a-z0-9])sew[\W_]+eurodrive(?![a-z0-9])", lowered)
    )

    vendors: set[str] = set()
    for alias in sorted(VENDOR_ALIASES, key=len, reverse=True):
        if not re.search(_alias_pattern(alias), lowered):
            continue
        if alias == "delta" and not delta_is_branded:
            continue
        if alias == "sew" and not sew_is_branded:
            continue
        vendors.add(VENDOR_ALIASES[alias])
    return vendors


def _is_model_candidate(token: str, fault_raw_tokens: frozenset[str]) -> bool:
    """A token is a model candidate iff:
    - Not a fault code we already captured
    - Not in RESERVED_LABELS (uns structural markers)
    - Length 2-12
    - Alphanumeric (with hyphens/dots allowed)
    """
    if not token or len(token) < 2 or len(token) > 12:
        return False
    if token.lower() in fault_raw_tokens or token.lower() in _STOPWORDS:
        return False
    if _uns is not None and token.lower() in _uns.RESERVED_LABELS:
        return False
    # Allow letters, digits, hyphens, dots
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9.-]*$", token):
        return False
    return True


def _find_model_near_vendor(
    message: str,
    alias_lower: str | None,
    fault_raw_tokens: frozenset[str],
) -> str | None:
    """Find a model candidate. Prefer tokens that immediately follow the
    vendor alias in the message; if none qualify, scan all tokens.
    """
    tokens = _TOKEN_RE.findall(message)
    if not tokens:
        return None

    # Find the index of the alias in the token stream if present
    alias_idx: int | None = None
    if alias_lower:
        message_lower = message.lower()
        # The alias may be multi-word (e.g. "allen bradley"). Find its span
        # in the raw message and pick the token immediately after.
        m = re.search(re.escape(alias_lower), message_lower)
        if m:
            # Walk tokens until we pass the alias end
            offset = 0
            for i, tok in enumerate(tokens):
                idx = message_lower.find(tok.lower(), offset)
                if idx == -1:
                    continue
                offset = idx + len(tok)
                if offset > m.end():
                    alias_idx = i - 1
                    break
            if alias_idx is None:
                alias_idx = len(tokens) - 1

    # Search right of the alias first
    search_order: list[int]
    if alias_idx is not None:
        search_order = list(range(alias_idx + 1, len(tokens))) + list(range(0, alias_idx + 1))
    else:
        search_order = list(range(len(tokens)))

    for i in search_order:
        tok = tokens[i]
        if not _is_model_candidate(tok, fault_raw_tokens):
            continue
        # Don't pick the alias itself as the model
        if alias_lower and tok.lower() == alias_lower:
            continue
        # If alias is multi-token, skip tokens that are part of the alias
        if alias_lower and tok.lower() in alias_lower.split():
            continue
        # Require at least one digit. Pure-digit is allowed when near vendor
        # (e.g. "525" after "powerflex" — Mike's 2026-05-13 regression case);
        # pure-alpha is rejected everywhere (e.g. "find" in "find a manual for
        # pilz safety relay" is a verb, not a model). Original
        # `_looks_like_model_number` required letter AND digit; the resolver
        # loosens that to "≥1 digit" so pure-digit models near a known vendor
        # are still captured, but English action verbs are not.
        has_digit = bool(re.search(r"\d", tok))
        if not has_digit:
            continue
        if alias_idx is not None:
            return tok
        if re.search(r"[A-Za-z]", tok):
            return tok
    return None


def _detect_category(message: str, has_fault: bool) -> str | None:
    if has_fault:
        return "fault_codes"
    for pat, cat in _CATEGORY_PATTERNS:
        if pat.search(message):
            return cat
    return None


def _build_uns_path(
    manufacturer: str | None,
    product_family: str | None,
    model: str | None,
    fault_code: str | None,
    category: str | None,
) -> str | None:
    """Build the deepest UNS path possible from the resolved fields.

    Uses path builders in `mira-crawler/ingest/uns.py`. Returns None when no
    manufacturer is known.
    """
    if _uns is None or not manufacturer:
        return None

    family = product_family
    if fault_code:
        # fault_code_path handles the "no model" fallback internally
        return _uns.fault_code_path(manufacturer, fault_code, model=model, family=family)
    if category == "manuals":
        return _uns.manual_path(manufacturer, model, family=family)
    if model:
        return _uns.model_path(manufacturer, model, family=family)
    return _uns.manufacturer_path(manufacturer)


def _confidence(
    manufacturer: str | None,
    model: str | None,
    fault_code: str | None,
    db_confirmed: bool,
) -> float:
    if manufacturer and model and fault_code:
        return 1.0 if db_confirmed else 0.9
    if manufacturer and model:
        return 0.7
    if manufacturer:
        return 0.5
    if fault_code:
        return 0.3
    return 0.0


def _merge_with_prior(fresh: UNSContext, prior: UNSContext | None) -> UNSContext:
    """Carry forward prior fields unless this turn names a different vendor.

    Confidence decays slightly each turn. An explicit vendor switch starts a new
    identity: family, model, fault, and site data from the old machine must not be
    merged into the new one.
    """
    if prior is None:
        return fresh

    fresh_vendor = (
        canonical_vendor(fresh.manufacturer) or (fresh.manufacturer or "").strip().casefold()
    )
    prior_vendor = (
        canonical_vendor(prior.manufacturer) or (prior.manufacturer or "").strip().casefold()
    )
    if fresh_vendor and prior_vendor and fresh_vendor != prior_vendor:
        return fresh

    decayed = prior.confidence * 0.9

    def pick(a: Any, b: Any) -> Any:
        if a is None or a == "" or a == 0 or a == []:
            return b
        return a

    merged_mfr = pick(fresh.manufacturer, prior.manufacturer)
    merged_alias = pick(fresh.manufacturer_alias, prior.manufacturer_alias)
    merged_family = pick(fresh.product_family, prior.product_family)
    merged_model = pick(fresh.model, prior.model)
    merged_fault = pick(fresh.fault_code, prior.fault_code)
    merged_fault_raw = pick(fresh.fault_code_raw, prior.fault_code_raw)
    merged_cat = pick(fresh.category, prior.category)
    merged_site = pick(fresh.site_path, prior.site_path)
    merged_entities = fresh.matched_entities or prior.matched_entities
    merged_kb_count = max(fresh.matched_kb_count, prior.matched_kb_count)

    # Rebuild path from merged fields so it stays correct
    merged_path = _build_uns_path(merged_mfr, merged_family, merged_model, merged_fault, merged_cat)

    final_conf = max(fresh.confidence, decayed)

    return UNSContext(
        uns_path=merged_path,
        manufacturer=merged_mfr,
        manufacturer_alias=merged_alias,
        product_family=merged_family,
        model=merged_model,
        fault_code=merged_fault,
        fault_code_raw=merged_fault_raw,
        category=merged_cat,
        site_path=merged_site,
        matched_entities=merged_entities,
        matched_kb_count=merged_kb_count,
        confidence=final_conf,
    )


# ---------------------------------------------------------------------------
# Stage 3 — DB enrichment (optional)
# ---------------------------------------------------------------------------


def _enrich_from_db(
    ctx: UNSContext,
    tenant_id: str | None,
) -> UNSContext:
    """Add kg_entities matches, knowledge_entries count, and site_path when
    available. Falls back to ctx on any error or unavailable DB.
    """
    if ctx.uns_path is None:
        return ctx
    try:
        # Import lazily — most tests / offline runs skip this path entirely.
        from .neon_recall import get_pool  # type: ignore[attr-defined]
    except Exception:
        return ctx

    try:
        pool = get_pool()
    except Exception as exc:
        logger.debug("UNS_RESOLVER db unavailable: %s", exc)
        return ctx

    if pool is None:
        return ctx

    try:
        import asyncio

        async def _query() -> tuple[list[dict[str, Any]], int, str | None]:
            async with pool.acquire() as conn:
                ents = await conn.fetch(
                    "SELECT id, uns_path::text AS uns_path, label "
                    "FROM kg_entities WHERE uns_path::text = $1 "
                    "OR uns_path::text LIKE $1 || '.%' LIMIT 20",
                    ctx.uns_path,
                )
                ent_ids = [str(r["id"]) for r in ents]
                kb_count = 0
                if ent_ids:
                    row = await conn.fetchrow(
                        "SELECT count(*) AS c FROM knowledge_entries "
                        "WHERE equipment_entity_id = ANY($1::uuid[])",
                        ent_ids,
                    )
                    kb_count = int(row["c"]) if row else 0
                site_path: str | None = None
                if tenant_id and ctx.manufacturer and ctx.model:
                    site_row = await conn.fetchrow(
                        "SELECT uns_path::text AS uns_path "
                        "FROM cmms_equipment WHERE tenant_id = $1 "
                        "AND manufacturer ILIKE $2 AND model ILIKE $3 LIMIT 1",
                        tenant_id,
                        ctx.manufacturer,
                        ctx.model,
                    )
                    if site_row:
                        site_path = site_row["uns_path"]
                return (
                    [dict(r) for r in ents],
                    kb_count,
                    site_path,
                )

        # If a running loop exists, schedule as a task and skip enrichment for
        # this turn — engine wiring already runs the resolver synchronously
        # and we don't want to block on a re-entrant loop.
        try:
            asyncio.get_running_loop()
            return ctx
        except RuntimeError:
            ents, kb_count, site_path = asyncio.run(_query())
    except Exception as exc:
        logger.info("UNS_RESOLVER enrichment failed: %s", exc)
        return ctx

    db_confirmed = bool(ents)
    conf = _confidence(ctx.manufacturer, ctx.model, ctx.fault_code, db_confirmed)
    return UNSContext(
        uns_path=ctx.uns_path,
        manufacturer=ctx.manufacturer,
        manufacturer_alias=ctx.manufacturer_alias,
        product_family=ctx.product_family,
        model=ctx.model,
        fault_code=ctx.fault_code,
        fault_code_raw=ctx.fault_code_raw,
        category=ctx.category,
        site_path=site_path or ctx.site_path,
        matched_entities=ents,
        matched_kb_count=kb_count,
        confidence=conf,
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def resolve_uns_path(
    message: str,
    tenant_id: str | None = None,
    prior_ctx: UNSContext | dict[str, Any] | None = None,
) -> UNSContext:
    """Resolve vendor / model / fault code / category from a user message and
    build the deepest UNS path the alias table supports.

    Args:
        message: free-form user text.
        tenant_id: when set, enables site-path lookup against cmms_equipment.
        prior_ctx: previous turn's UNSContext (or its dict form). Missing
            fields on the fresh extraction fall back to prior values.

    Returns:
        UNSContext. All fields may be None — the empty result has
        confidence 0.0.
    """
    if not message:
        message = ""

    # Stage 1a: extract ALL fault-pattern matches (we'll pick which one is the
    # actual fault below, after we know the model position)
    fault_pairs = _extract_fault_codes(message)

    # Stage 1b: vendor match first — needed to find model position
    message_lower = message.lower()
    mfr, alias_lower, family_token = _match_vendor(message_lower)

    # Stage 1c: find model-position token (the first reasonable candidate
    # adjacent to the vendor). For this pass we treat NO tokens as fault yet —
    # the model-position lookup tells the fault picker which token to avoid.
    model_position = _find_model_near_vendor(message, alias_lower, frozenset())

    # Stage 1d: pick the fault, preferring strong patterns and avoiding the
    # model-position token when a better candidate exists.
    fault_code, fault_raw, fault_raw_tokens = _pick_fault_code(fault_pairs, model_position)

    # Stage 2: now strip the chosen fault token(s) from the model candidate
    # pool and re-resolve the model. If the model-position token IS the chosen
    # fault, look further down the token stream.
    model = _find_model_near_vendor(message, alias_lower, fault_raw_tokens)

    # Strip the alias key itself out of the model if model accidentally
    # matched a sub-word inside the alias (defensive — _find_model_near_vendor
    # already skips this, but doubles as a guard).
    if model and alias_lower and model.lower() == alias_lower:
        model = None

    # Strip alias underscores/hyphens from model when it equals the alias slug
    if model and alias_lower:
        m_compact = re.sub(r"[^A-Za-z0-9]", "", model).lower()
        a_compact = re.sub(r"[^A-Za-z0-9]", "", alias_lower).lower()
        if m_compact == a_compact:
            model = None

    # Alias-as-model promotion: when the alias IS a specific product (e.g.
    # "gs10", "pf525", "a1000"), the alias slug is both brand and model. If no
    # separate model token was found, promote the family_token to model so the
    # confidence reaches 0.7 (manufacturer+model) and the UNS gate doesn't fire.
    if model is None and family_token:
        model = family_token

    category = _detect_category(message, has_fault=fault_code is not None)
    product_family = family_token
    if product_family is None and alias_lower and mfr:
        # If the alias IS the manufacturer (e.g. "siemens"), no family. If
        # alias is a model token from FAMILY_FROM_ALIAS we already populated.
        product_family = None

    uns_path = _build_uns_path(mfr, product_family, model, fault_code, category)

    fresh = UNSContext(
        uns_path=uns_path,
        manufacturer=mfr,
        manufacturer_alias=alias_lower,
        product_family=product_family,
        model=model,
        fault_code=fault_code,
        fault_code_raw=fault_raw,
        category=category,
        site_path=None,
        matched_entities=[],
        matched_kb_count=0,
        confidence=_confidence(mfr, model, fault_code, db_confirmed=False),
    )

    # Stage 3: optional DB enrichment
    fresh = _enrich_from_db(fresh, tenant_id)

    # Prior-context merge
    if isinstance(prior_ctx, dict):
        prior_obj = UNSContext.from_dict(prior_ctx)
    else:
        prior_obj = prior_ctx
    return _merge_with_prior(fresh, prior_obj)


def resolve_uns_path_multi(
    message: str,
    tenant_id: str | None = None,
    prior_ctx: UNSContext | dict[str, Any] | None = None,
) -> UNSResolution:
    """Multi-vendor resolution. Returns one ``UNSContext`` candidate per
    distinct vendor named in the message, after pair-coverage validation
    against the KB.

    Use this when a message may name two pieces of equipment from different
    OEMs — e.g. "connect my Micro 820 to an AutomationDirect GS11 over
    Modbus". The legacy ``resolve_uns_path()`` only returns the first
    vendor + one model and is responsible for the historical chimera bug
    where a vendor from one product gets paired with a model number from
    another.

    Behaviour:
      - For messages naming 0 or 1 vendors, this is a thin wrapper around
        ``resolve_uns_path``: ``primary`` is the legacy result, and
        ``candidates`` either has one entry (single vendor) or is empty
        (no vendor recognized).
      - For messages naming ≥2 distinct vendors, each vendor gets its own
        ``UNSContext`` with the nearest model token after the vendor's
        position. Each (vendor, model) pair is then validated by
        ``kb_has_pair_coverage`` — pairs the KB has no rows for get their
        model field cleared, so the caller never speaks "AutomationDirect
        820" as if it were a real product.
      - ``primary`` is the first candidate in message order, matching the
        legacy single-vendor result for backward-compat semantics.

    Pair validation requires ``tenant_id``. When tenant_id is None the
    validator is skipped (the candidates list still reflects multi-vendor
    detection, but chimeric models are not pruned). Callers in
    diagnostic contexts should always pass tenant_id.
    """
    legacy_primary = resolve_uns_path(message, tenant_id=tenant_id, prior_ctx=prior_ctx)

    if not message:
        return UNSResolution(primary=legacy_primary, candidates=())

    message_lower = message.lower()
    vendor_matches = _match_all_vendors(message_lower)

    if len(vendor_matches) <= 1:
        # Single-vendor (or zero-vendor) message — legacy resolver result is
        # canonical. The pair-coverage check is intentionally NOT applied here
        # to keep this path zero-DB-latency for the common case; the engine's
        # speak-time formatter (`_do_documentation_lookup` and friends) is
        # where the strict pair check guards single-vendor chimeras.
        candidates = (legacy_primary,) if legacy_primary.manufacturer else ()
        return UNSResolution(primary=legacy_primary, candidates=candidates)

    # Multi-vendor — derive a candidate per vendor, validate each pair.
    fault_pairs = _extract_fault_codes(message)
    fault_code, fault_raw, fault_raw_tokens = _pick_fault_code(fault_pairs, None)
    category = _detect_category(message, has_fault=fault_code is not None)

    candidates_list: list[UNSContext] = []
    for canonical, alias_lower, family_token, _pos in vendor_matches:
        model = _find_model_near_vendor(message, alias_lower, fault_raw_tokens)

        # Strip alias-as-model false positives (mirrors the legacy resolver's
        # defenses at the end of `resolve_uns_path`).
        if model and alias_lower and model.lower() == alias_lower:
            model = None
        if model and alias_lower:
            m_compact = re.sub(r"[^A-Za-z0-9]", "", model).lower()
            a_compact = re.sub(r"[^A-Za-z0-9]", "", alias_lower).lower()
            if m_compact == a_compact:
                model = None

        # Chimera filter — drop the model when (vendor, model) has no KB
        # coverage. Keep the vendor so the caller can still offer vendor-
        # level documentation.
        if model and tenant_id is not None:
            covered, count = kb_has_pair_coverage(canonical, model, tenant_id)
            if not covered:
                logger.info(
                    "UNS_PAIR_DROPPED canonical=%r model=%r kb_count=%d",
                    canonical,
                    model,
                    count,
                )
                model = None

        uns_path = _build_uns_path(canonical, family_token, model, fault_code, category)
        cand = UNSContext(
            uns_path=uns_path,
            manufacturer=canonical,
            manufacturer_alias=alias_lower,
            product_family=family_token,
            model=model,
            fault_code=fault_code,
            fault_code_raw=fault_raw,
            category=category,
            site_path=None,
            matched_entities=[],
            matched_kb_count=0,
            confidence=_confidence(canonical, model, fault_code, db_confirmed=False),
        )
        candidates_list.append(cand)

    if not candidates_list:
        return UNSResolution(primary=legacy_primary, candidates=())

    logger.info(
        "UNS_RESOLUTION_MULTI n=%d vendors=%s",
        len(candidates_list),
        [c.manufacturer for c in candidates_list],
    )
    return UNSResolution(primary=candidates_list[0], candidates=tuple(candidates_list))


def chunk_matches_model(
    chunk_model: str | None,
    chunk_text: str | None,
    query_model: str | None,
    *,
    query_family: str | None = None,
    chunk_source: str | None = None,
) -> bool:
    """Does a retrieved chunk plausibly concern the SAME model/series as the query?

    The vendor half of relevance already exists as
    `rag_worker.chunk_matches_vendor`. This is the missing model half, and it exists
    because vendor-level matching alone is not evidence.

    WHY (#3605). Grounding was gated on `kb_has_coverage`, which is a per-vendor COUNT.
    "Allen-Bradley has 38k chunks" therefore read as *covered*, embedding-less recall
    returned lexically-similar but topically-unrelated passages, and the model anchored
    on those instead of its own correct knowledge. A live corpus probe reproduced this
    as a PowerFlex 525 question answered from a PowerFlex 753 manual.

    Grounding on the wrong document is worse than not grounding at all — accuracy drops
    AND a citation is attached, which makes the weaker answer look more trustworthy.

    Rules, in order:
      * No model asked for -> cannot judge; keep (vendor filter still applies).
      * Exact model metadata, aliases, and nameplate/manual identifiers come from the
        existing resolver and shipped drive pack; declared umbrella series are allowed.
      * For a shipped drive pack, metadata must be one declared identity and the body
        or source filename must independently carry an exact-model, pack-identifier,
        or declared-series tie. A bare family name is not model evidence.
      * Explicit body identity is checked even when metadata matches, so a stale 525
        tag cannot hide a body that says 753. Engineering ratings and parameter numbers
        are not treated as model identity.

    Untagged, bodyless chunks are rejected when a model was asked for: with no metadata
    and no text there is nothing to justify grounding, and the caller's contract is that
    surviving nothing cannot authorize a model-specific answer or citation.
    """
    if not query_model:
        return True

    def _norm(token: str) -> tuple[str, str]:
        """(family, number) for a model string, expanded through the alias table.

        Family alone is NOT enough: "PowerFlex 525" and "PowerFlex 753" share a family
        but are different drives, and treating them as equal is exactly the
        same-vendor/wrong-model acceptance this function must reject. So the number is
        carried separately and compared.
        """
        t = token.strip().lower()
        if t in FAMILY_FROM_ALIAS:
            t = FAMILY_FROM_ALIAS[t].lower()
        else:
            for alias, fam in FAMILY_FROM_ALIAS.items():
                if re.search(_alias_pattern(alias), t):
                    t = re.sub(_alias_pattern(alias), fam.lower(), t, count=1)
                    break
        num_m = re.search(r"(\d{2,4})\s*$", t)
        num = num_m.group(1) if num_m else ""
        fam = re.sub(r"[\s\-_]*\d{2,4}\s*$", "", t).strip()
        return fam, num

    q = query_model.strip().lower()
    if not q:
        return True
    query_model_tokens = {
        re.sub(r"[^a-z0-9]", "", query_model.casefold()),
    }

    # The resolver deliberately keeps a family-adjacent pure-digit model in two
    # fields (product_family="PowerFlex", model="525"). Compare in that same
    # identity space instead of requiring callers or tests to invent the friendlier
    # but non-production string "PowerFlex 525".
    family_hint = (query_family or "").strip()
    q_family, _q_number = _norm(q)
    hinted_family, _hinted_number = _norm(family_hint) if family_hint else ("", "")
    if hinted_family and not q_family.startswith(hinted_family):
        q = f"{family_hint} {q}"
    query_model_tokens.add(re.sub(r"[^a-z0-9]", "", q.casefold()))

    (
        pack_aliases,
        pack_keywords,
        documented_pack_models,
        documented_pack_codes,
        query_pack_id,
    ) = _drive_pack_identity_terms(q)
    has_drive_pack = bool(pack_aliases or pack_keywords)
    declared_series_aliases = tuple(alias for alias in pack_aliases if " series " in f" {alias} ")

    def _is_declared_series_identity(candidate: str) -> bool:
        """Whether candidate names this model's umbrella series without conflict."""
        normalized = _normalize_identity_words(candidate)
        if not normalized:
            return False
        padded = f" {normalized} "
        candidate_numbers = set(re.findall(r"\b\d{2,4}[a-z]{0,3}\b", normalized))
        for alias in declared_series_aliases:
            if f" {alias} " not in padded:
                continue
            alias_numbers = set(re.findall(r"\b\d{2,4}[a-z]{0,3}\b", alias))
            allowed_numbers = alias_numbers | ({_q_number} if _q_number else set())
            if candidate_numbers <= allowed_numbers:
                return True
        return False

    def _compatible(a: str, b: str) -> bool:
        """Same family, and same number unless one side is series-level (no number).

        A series-level document ("PowerFlex 520-series wiring") legitimately grounds a
        question about a 525; a 753 manual does not.
        """
        if _is_declared_series_identity(a):
            return True
        fa, na = _norm(a)
        fb, nb = _norm(b)
        if fa != fb:
            return False
        return not na or not nb or na == nb

    q_family, _q_num = _norm(q)
    known_family_models = {_q_num} if _q_num else set()
    known_resolver_model_tokens: set[str] = set()
    for expanded in FAMILY_FROM_ALIAS.values():
        expanded_family, expanded_number = _norm(expanded)
        if expanded_number:
            known_resolver_model_tokens.add(re.sub(r"[^a-z0-9]", "", expanded.casefold()))
        if expanded_family == q_family and expanded_number:
            known_family_models.add(expanded_number)

    def _identity_term_patterns(term: str) -> tuple[str, ...]:
        parts = term.split()
        if not parts:
            return ()
        joined = r"[\W_]*".join(re.escape(part) for part in parts)
        # Publication identifiers commonly append one revision letter directly
        # to a stable mixed alpha-numeric stem (``520-UM001O-EN-E``). Permit that
        # one-letter revision only for such stems; numeric model aliases retain
        # their strict terminal boundary.
        last_part = parts[-1]
        revision_suffix = (
            r"(?:[a-z](?=[\W_]|$))?"
            if re.search(r"[a-z]", last_part) and last_part[-1:].isdigit()
            else ""
        )
        identity = f"{joined}{revision_suffix}"
        patterns = [rf"(?<![a-z0-9]){identity}(?![a-z0-9])"]
        family_term = _normalize_identity_words(q_family)
        if family_term and not term.startswith(family_term):
            family_joined = r"[\W_]*".join(re.escape(part) for part in family_term.split())
            patterns.append(rf"(?<![a-z0-9]){family_joined}[\W_]*{identity}(?![a-z0-9])")
        return tuple(patterns)

    def _contains_identity_term(text: str, terms: tuple[str, ...] | set[str]) -> bool:
        """Boundary-safe identity lookup with punctuation/separator normalization."""
        normalized = _normalize_identity_words(text)
        padded = f" {normalized} "
        lowered = text.casefold()
        for term in terms:
            if not term:
                continue
            if f" {term} " in padded:
                return True
            for pattern in _identity_term_patterns(term):
                if re.search(pattern, lowered):
                    return True
        return False

    family_names = {q_family} if q_family else set()
    for alias, expanded in FAMILY_FROM_ALIAS.items():
        expanded_family, expanded_number = _norm(expanded)
        if expanded_family == q_family and not expanded_number:
            family_names.update({alias, expanded.lower()})

    def _body_names_family(text: str) -> bool:
        lowered = text.casefold()
        return any(
            re.search(_alias_pattern(family_name), lowered)
            for family_name in family_names
            if family_name
        )

    def _body_matches_query_identity(text: str) -> bool:
        """Require positive query-model evidence; a bare family is insufficient."""
        terms = tuple(dict.fromkeys((*pack_aliases, *pack_keywords, _normalize_identity_words(q))))
        if _contains_identity_term(text, terms):
            return True
        if not (_q_num and _body_names_family(text)):
            return False
        # Documents also use separated relational wording: ``model 525`` or
        # ``on the 525`` after naming the family earlier in the passage.
        relation = (
            r"(?<![a-z0-9])(?:model|type|unit|specifically|on|for)(?![a-z])"
            r"(?:[\W_]+(?:model|number|no|the)(?![a-z]))?"
            rf"[\W_]*{re.escape(_q_num)}(?![a-z0-9])"
        )
        return bool(re.search(relation, text.casefold()))

    def _body_has_conflicting_identity(text: str, *, source_mode: bool = False) -> bool:
        """Reject explicit body identity that contradicts the requested model.

        This runs even when metadata names the expected model. Ingest metadata is
        useful positive evidence, but it cannot erase an explicit contradiction in
        the document body.
        """
        if not (text and _q_num):
            return False

        lowered = text.casefold()
        expected = _normalize_identity_words(_q_num)
        model_token = r"(?:\d{2,4}[a-z]{0,3}|\d[a-z]{1,3}|[a-z]{1,3}\d{1,4}[a-z]{0,3})"
        pack_terms = tuple(dict.fromkeys((*pack_aliases, *pack_keywords)))

        # Other Rockwell product families are explicit equipment identity, even
        # when their model grammar differs from a drive (SLC 5/03, PLC-5,
        # PanelView Plus 7, POINT/FLEX I/O catalog numbers, and the *Logix,
        # Kinetix, or Stratix families).  Match the family form rather than an
        # ever-growing list of individual models.  A chunk that mixes one of
        # these with PowerFlex evidence is conservatively rejected.
        other_equipment_family = re.compile(
            r"(?<![a-z0-9])(?P<family>"
            r"[a-z]+logix|panel[\W_]*view(?:[\W_]+plus)?|kinetix|stratix|"
            r"(?:slc|plc)(?=[\W_]*\d)|(?:point|flex)[\W_]+i[\W_/]*o|"
            r"micro[\W_]*\d{3,4}"
            r")(?![a-z])"
        )
        compact_query = re.sub(r"[^a-z0-9]", "", _normalize_identity_words(q))
        for family_match in other_equipment_family.finditer(lowered):
            compact_family = re.sub(r"[^a-z0-9]", "", family_match.group("family"))
            if compact_family and compact_family not in compact_query:
                return True

        # Record exact spans for shipped aliases/nameplate identifiers. An
        # overlapping model-like token is therefore known-good (for example the
        # 25B in ``25B-D024N104`` or 520 in ``520-UM001``), rather than guessed.
        allowed_spans: list[tuple[int, int]] = []
        for term in pack_terms:
            for pattern in _identity_term_patterns(term):
                allowed_spans.extend(match.span() for match in re.finditer(pattern, lowered))
                if re.fullmatch(r"\d+[a-z]", term):
                    # A PowerFlex catalog number has one defined nameplate
                    # payload (for example 25B-D024N104 or 25B-D2P3N104).
                    # Extending this through arbitrary separator-delimited
                    # suffixes made ``25B-753`` and
                    # ``25B-D024N104-753`` one giant trusted span, hiding the
                    # wrong model.  Trust only the catalog grammar itself.
                    catalog_pattern = (
                        rf"(?:{pattern})[-_][a-z]\d+(?:p\d+)?[a-z]\d{{3}}"
                        r"(?![a-z0-9])"
                    )
                    allowed_spans.extend(
                        match.span() for match in re.finditer(catalog_pattern, lowered)
                    )

        def _overlaps_allowed(start: int, end: int) -> bool:
            return any(
                start < allowed_end and end > allowed_start
                for allowed_start, allowed_end in allowed_spans
            )

        exact_query_aliases = tuple(
            alias
            for alias in pack_aliases
            if "series" not in alias and expected in re.findall(r"\b\d{2,4}\b", alias)
        )

        def _declared_sibling_is_shared(candidate: str, start: int, end: int) -> bool:
            """Allow declared 520 siblings only in clearly shared/cautionary prose.

            A 520-Series manual contains both common sections and model-specific
            pages. Merely belonging to the same manual cannot make a 523-only
            terminal block valid evidence for a 525. The narrow exceptions here
            require the same sentence to name the requested 525 and to identify
            shared applicability, a supported-model list, or a safety warning.
            """
            if candidate not in documented_pack_models:
                return False
            sentence_start = max(
                lowered.rfind(delimiter, 0, start) for delimiter in (".", "!", "?", "\n")
            )
            sentence_ends = [
                position
                for delimiter in (".", "!", "?", "\n")
                if (position := lowered.find(delimiter, end)) >= 0
            ]
            sentence_end = min(sentence_ends) if sentence_ends else len(lowered)
            sentence = lowered[sentence_start + 1 : sentence_end]
            exact_expected_named = _contains_identity_term(sentence, exact_query_aliases)
            expected_in_model_list = bool(
                re.search(
                    rf"(?<![a-z])models?(?![a-z]).{{0,100}}"
                    rf"(?<![a-z0-9]){re.escape(expected)}(?![a-z0-9])",
                    sentence,
                )
            )
            declared_range = re.search(
                r"(?<![a-z])models?(?![a-z]).{0,60}?"
                r"(?P<start>\d{2,4})[\W_]*(?:-|–|—|to|through)[\W_]*"
                r"(?P<end>\d{2,4})(?![a-z0-9])",
                sentence,
            )
            expected_in_declared_range = bool(
                declared_range
                and declared_range.group("start") in documented_pack_models
                and declared_range.group("end") in documented_pack_models
                and expected.isdigit()
                and int(declared_range.group("start"))
                <= int(expected)
                <= int(declared_range.group("end"))
            )
            if not (exact_expected_named or expected_in_model_list or expected_in_declared_range):
                return False
            return bool(
                re.search(
                    r"(?<![a-z])(?:supported|supports?|includes?|models?|"
                    r"capable|warning|incorrect|damage|damages|such[\W_]+as)(?![a-z])",
                    sentence,
                )
                or re.search(
                    rf"powerflex[\W_]+{re.escape(candidate)}[\W_]+(?:and|or)[\W_]+"
                    rf"powerflex[\W_]+{re.escape(expected)}[\W_]+drives?(?![a-z])",
                    sentence,
                )
            )

        measurement_units = re.compile(
            r"[\W_]*(?:a|v|mhz|khz|hz|hertz|ms|milliseconds?|seconds?|secs?|"
            r"ma|milliamps?|amps?|amperes?|volts?|vac|vdc|kw|kilowatts?|hp|rpm|percent|pct|"
            r"ohms?|poles?|°?[cf]|degrees?|%)(?:\b|(?=\W|$))"
        )
        measurement_context = re.compile(
            r"[\W_]*(?:(?:ac|dc)[\W_]+)?(?:bus|input|output|reading|voltage|"
            r"rating|rated|measurement|level|class|carrier|frequency|fla|"
            r"continuous[\W_]+output|(?:max[\W_]+)?ambient[\W_]+limit)(?![a-z])"
        )
        measurement_prefix = re.compile(
            r"(?<![a-z])(?:rated(?:[\W_]+(?:nameplate|current|voltage|power))?"
            r"(?:[\W_]+is)?|"
            r"rating(?:[\W_]+is)?|"
            r"ambient(?:[\W_]+temperature)?(?:[\W_]+limit)?(?:[\W_]+is)?|"
            r"continuous(?:[\W_]+output)?(?:[\W_]+is)?|"
            r"(?:ac|dc)[\W_]+bus(?:[\W_]+(?:reading|voltage))?"
            r"(?:[\W_]+(?:is|at))?|"
            r"(?:input|output)(?:[\W_]+(?:current|voltage|power))?"
            r"(?:[\W_]+(?:is|at))?|"
            r"(?:nameplate|measured)[\W_]+(?:voltage|current)[\W_]+is|"
            r"(?:bus|voltage|current)[\W_]+reading[\W_]+is|"
            r"measurement[\W_]+is|(?:nominal|operating)[\W_]+voltage[\W_]+is|"
            r"(?:voltage|current)[\W_]+equals|reading)[\W_]*$"
        )
        measurement_range = re.compile(
            r"[\W_]*(?:(?:-|–|—|/)|(?:to|through))[\W_]*\d{1,4}[\W_]*"
            r"(?:vac|vdc|hz|hertz|ma|kw|hp|rpm|a|v|c|f|amps?|amperes?|volts?)\b"
        )
        non_identity_prefix = re.compile(
            r"(?<![a-z])(?:page|table|figure|section|value|setting|parameter|"
            r"revision|rev|code|fault)[\W_]*$|"
            r"(?<![a-z])serial(?:[\W_]+number)?"
            r"(?:[\W_]+ending(?:[\W_]+in)?)?[\W_]*$"
        )
        family_qualifier = (
            r"|" + r"[\W_]+".join(re.escape(part) for part in q_family.split()) if q_family else ""
        )
        explicit_identity_qualifier = re.compile(
            r"(?<![a-z])(?:model|product|series|type|catalog|sku|part|equipment|order"
            + family_qualifier
            + r")[\W_]+(?:code|value)[\W_]*$"
        )
        documented_code_identity_before = re.compile(
            r"(?<![a-z])(?:guide[\W_]+for|applicable(?:[\W_]+to)?|designed[\W_]+for|"
            r"drive[\W_]+(?:model|number|designation)|configuration[\W_]+of|"
            r"reference[\W_]+manual|use[\W_]+the|startup[\W_]+guide|"
            r"supported[\W_]+by|applies[\W_]+exclusively[\W_]+to|"
            r"(?:model|product|type|unit|series)"
            r"(?:[\W_]+(?:code|value|number|designation))?)[\W_]*$"
        )
        documented_code_identity_after = re.compile(
            r"[\W_]*(?:quick[\W_]+start[\W_]+guide|user[\W_]+manual|"
            r"drive[\W_]+(?:configuration|manual|guide|model|unit|startup)|"
            r"drive(?=[\W_]*(?:$|[.;,:)]))|specific|startup|manual|guide|"
            r"procedure|model|product|type|unit|series|only)(?![a-z])"
        )

        def _documented_code_used_as_identity(candidate: str, start: int, end: int) -> bool:
            if candidate not in documented_pack_codes:
                return False
            before = lowered[max(0, start - 64) : start]
            after = lowered[end : end + 80]
            if non_identity_prefix.search(before) and not explicit_identity_qualifier.search(
                before
            ):
                return False
            return bool(
                documented_code_identity_before.search(before)
                or documented_code_identity_after.match(after)
            )

        def _conflicts(
            identity: re.Match[str], *, offset: int = 0, force_identity: bool = False
        ) -> bool:
            candidate = _normalize_identity_words(identity.group("model"))
            start, end = identity.span("model")
            start += offset
            end += offset
            if (
                candidate == expected
                or re.sub(r"[^a-z0-9]", "", candidate) in query_model_tokens
                or _overlaps_allowed(start, end)
            ):
                return False
            preceding = lowered[max(0, start - 48) : start]
            if non_identity_prefix.search(preceding) and not explicit_identity_qualifier.search(
                preceding
            ):
                return False
            marker = _normalize_identity_words(identity.groupdict().get("marker") or "")
            if _declared_sibling_is_shared(candidate, start, end):
                return False
            # PowerFlex parameter/fault groups are written immediately after the
            # family name in real manuals (P041, F081, C125, A442, b001, t001).
            # Keep this aligned with the canonical Notebook query vocabulary; they
            # are not equipment models unless an explicit identity marker says so.
            if candidate in documented_pack_codes and not _documented_code_used_as_identity(
                candidate, start, end
            ):
                return False
            compact_measurement = re.fullmatch(
                r"(?P<value>\d{1,4})(?:vac|vdc|mhz|khz|hz|ms|ma|kw|hp|rpm|pct|a|v|c|f)",
                candidate,
            )
            family_prefixes = {
                model[:-1] for model in known_family_models if model.isdigit() and len(model) >= 3
            }
            explicit_marker = marker not in {"", "drive"}

            # Decimal bounds such as ``0.00/Drive Rated Power`` contain a
            # two-digit tail immediately before the word Drive. That is a
            # parameter scale, not a model written before an identity noun.
            if marker == "drive" and start > 0 and lowered[start - 1] == ".":
                return False

            def _looks_like_other_family_model(value: str) -> bool:
                return (
                    value != expected
                    and len(value) >= 3
                    and (
                        value in known_family_models
                        or any(value.startswith(prefix) for prefix in family_prefixes)
                    )
                )

            if compact_measurement and not explicit_marker:
                value = compact_measurement.group("value")
                if measurement_context.match(lowered[end:]):
                    return False
                followed_by_identity_noun = bool(
                    re.match(r"[\W_]*(?:drive|vfd|unit|model)(?![a-z])", lowered[end:])
                )
                looks_like_other_family_model = _looks_like_other_family_model(value)
                if not (
                    looks_like_other_family_model and (force_identity or followed_by_identity_noun)
                ):
                    return False
            if (
                force_identity
                and not marker
                and candidate.isdigit()
                and start > 0
                and lowered[start - 1] in "/-–—"
                and not _looks_like_other_family_model(candidate)
            ):
                return False
            # A range beginning with a known model (``753-480V``) is a model plus
            # rating, not a 753-to-480V measurement range. Unknown numeric starts
            # such as ``208-240VAC`` remain ordinary engineering ratings.
            range_match = measurement_range.match(lowered[end:])
            if not marker and range_match and candidate not in known_family_models:
                # ``208-240 VAC`` is a rating; ``529-480V unit`` is an unknown
                # same-series model plus its rating. Derive the family-like prefix
                # from known identities instead of guessing a model-number range.
                after_range = lowered[end + range_match.end() :]
                followed_by_identity_noun = bool(
                    re.match(r"[\W_]*(?:drive|vfd|unit|model)(?![a-z])", after_range)
                )
                if not (
                    _looks_like_other_family_model(candidate)
                    and (force_identity or followed_by_identity_noun)
                ):
                    return False
            unit_match = measurement_units.match(lowered[end:])
            if unit_match and not explicit_marker:
                if not (force_identity and _looks_like_other_family_model(candidate)):
                    return False
            if marker in {
                "for",
                "applies to",
                "apply to",
                "covers",
                "cover",
                "compatible with",
                "supports",
                "support",
                "intended for use with",
            } and re.fullmatch(r"(?:19|20)\d{2}", candidate):
                return False
            return True

        # Compact family prefixes are derived from the requested pack's aliases,
        # not hard-coded. This catches PF755TL/PF-755TR while preserving the repo's
        # deliberate decision that spaced ``PF 70`` can be a power-factor reading.
        compact_prefixes: set[str] = set()
        compact_family = re.sub(r"[^a-z0-9]", "", q_family)
        for alias in pack_aliases:
            compact = alias.replace(" ", "")
            compact_match = re.fullmatch(rf"([a-z]{{2,}}){re.escape(expected)}", compact)
            if compact_match and compact_match.group(1) != compact_family:
                compact_prefixes.add(compact_match.group(1))
        if compact_prefixes:
            prefixes = "|".join(sorted(map(re.escape, compact_prefixes), key=len, reverse=True))
            compact_identity = re.compile(
                rf"(?<![a-z0-9])(?:{prefixes})[_-]?(?P<model>{model_token})(?![a-z0-9])"
            )
            if any(
                _conflicts(identity, force_identity=True)
                for identity in compact_identity.finditer(lowered)
            ):
                return True
            # Keep the repo's deliberate ``PF 70`` power-factor exception, while
            # still recognizing unambiguous alpha-suffixed identities such as
            # ``PF 755TL``.
            spaced_compact_identity = re.compile(
                rf"(?<![a-z0-9])(?:{prefixes})[\W_]+"
                rf"(?P<model>\d{{3,4}}[a-z]{{0,3}})(?![a-z0-9])"
            )
            if any(
                _conflicts(identity, force_identity=True)
                for identity in spaced_compact_identity.finditer(lowered)
            ):
                return True

        # A family-adjacent token is an identity even if this repo has no alias for
        # that model (PowerFlex 750-Series, 755TL, etc.). Shipped query-pack terms
        # and immediately-following engineering units are explicit exceptions.
        adjacent_identity = re.compile(
            r"[\W_]*(?:(?:r|tm|sm)[\W_]*)?"
            rf"(?P<model>{model_token})(?![a-z0-9])"
            r"(?P<series>[\W_]*series)?"
        )
        reversed_series = re.compile(rf"[\W_]*series[\W_]+(?P<model>{model_token})(?![a-z0-9])")
        coordinator = (
            r"(?:and(?:\s*/\s*or|\s+also)?|or(?:\s+also)?|nor|also|plus|versus|"
            r"vs\.?|compared\s+(?:to|with|against)|in\s+comparison\s+with|"
            r"in\s+contrast\s+to|as\s+opposed\s+to|as\s+well\s+as|alongside|"
            r"together\s+with|rather\s+than|instead\s+of|but\s+not|not|to|through|"
            r"thru|&|\+)"
        )
        coordinated_separator = (
            rf"(?:\s*(?:,|;)?\s*\(?\s*{coordinator}\s+"
            r"(?:(?:the|a|model)[\W_]+)?|"
            r"\s*(?:,|;|&|\+|\||/|-|–|—|:|\()\s*)"
        )
        coordinated_model = r"\d{2,4}[a-z]{0,3}"
        family_list_qualifier = (
            r"(?:family|series)"
            r"(?:[\W_]+(?:includes?|supports?|contains?|comprises?|models?|units?|drives?)){0,3}"
        )
        coordinated_identity = re.compile(
            r"[\W_]*(?:(?:r|tm|sm)[\W_]*)?"
            rf"(?:{family_list_qualifier}[\W_]*)?"
            r"(?:(?:both|either|neither)[\W_]+)?"
            rf"(?P<first>{coordinated_model})"
            rf"(?P<tail>(?:{coordinated_separator}{coordinated_model})+)"
        )
        for family_name in family_names:
            for family_match in re.finditer(_alias_pattern(family_name), lowered):
                suffix_start = family_match.end()
                suffix = lowered[suffix_start:]
                for pattern in (adjacent_identity, reversed_series):
                    identity = pattern.match(suffix)
                    if not identity:
                        continue
                    if measurement_units.match(suffix[identity.end() :]):
                        continue
                    if _conflicts(identity, offset=suffix_start, force_identity=True):
                        return True

                # Direct family lists often omit the word "models":
                # ``PowerFlex 525, 753`` / ``PowerFlex 525-753``. Parse only a
                # coordinated chain immediately after the family. If the chain
                # terminates in an engineering unit it is a rating range instead
                # (``PowerFlex 208-240 VAC``), not a list of equipment.
                coordinated = coordinated_identity.match(suffix)
                if coordinated:
                    coordinated_text = coordinated.group(0)
                    identities = list(
                        re.finditer(rf"(?P<model>{coordinated_model})", coordinated_text)
                    )
                    last_model = (
                        _normalize_identity_words(identities[-1].group("model"))
                        if identities
                        else ""
                    )
                    ends_in_compact_unit = bool(
                        re.fullmatch(r"\d{1,4}(?:vac|vdc|hz|kw|hp|rpm|a|v|c|f)", last_model)
                    ) and bool(measurement_context.match(suffix[coordinated.end() :]))
                    ends_before_unit = bool(measurement_units.match(suffix[coordinated.end() :]))
                    if not (ends_in_compact_unit or ends_before_unit) and any(
                        _conflicts(identity, offset=suffix_start, force_identity=True)
                        for identity in identities
                    ):
                        return True

            # Model-first prose is common in titles and comparisons: ``753
            # PowerFlex drive`` and ``753 in the PowerFlex family``. Keep the
            # bridge vocabulary narrow so unrelated numbers earlier in a sentence
            # cannot drift into an identity match.
            reversed_identity = re.compile(
                rf"(?<![a-z0-9])(?P<model>{model_token})(?![a-z0-9])"
                r"(?:[\W_]+(?:in|of|for|the)(?![a-z])){0,4}[\W_]+" + _alias_pattern(family_name)
            )
            if any(
                _conflicts(identity, force_identity=True)
                for identity in reversed_identity.finditer(lowered)
            ):
                return True

        # Singular identity markers are authoritative. Plural ``models`` is
        # handled separately below so legitimate supported-model lists can pass.
        marked = re.compile(
            r"(?<![a-z0-9])"
            r"(?P<marker>model|series|type|unit|part|product|publication|"
            r"bulletin|specifically|vfd|family|family[\W_]+member|"
            r"(?:ac[\W_]+)?drive)"
            r"(?![a-z])"
            r"(?:[\W_]+(?:model|numbers?|no|designation)(?![a-z]))?"
            r"(?:[\W_]+is(?![a-z]))?"
            rf"[\W_]*(?P<model>{model_token})(?![a-z0-9])"
        )
        if any(_conflicts(identity) for identity in marked.finditer(lowered)):
            return True

        # Document prose often puts the number before its identity word, or links
        # it through a short relation rather than writing ``model 753``.
        number_before_marker = re.compile(
            rf"(?<![a-z0-9])(?P<model>{model_token})(?![a-z0-9])"
            r"[\W_]+(?P<marker>drive|model|unit|series)(?![a-z])"
        )
        if any(_conflicts(identity) for identity in number_before_marker.finditer(lowered)):
            return True

        relational_identity = re.compile(
            r"(?<![a-z0-9])"
            r"(?P<marker>for|(?:applies|apply|applicable)[\W_]+to|covers?|"
            r"compatible[\W_]+with|"
            r"supports?|"
            r"intended[\W_]+for(?:[\W_]+use[\W_]+with)?|"
            r"(?:intended[\W_]+)?for[\W_]+use[\W_]+with)(?![a-z])"
            r"(?:[\W_]+the(?![a-z]))?"
            rf"[\W_]*(?P<model>{model_token})(?![a-z0-9])"
            r"(?=[\W_]+(?:drives?|models?|units?|series|only)(?![a-z]))"
        )
        if any(_conflicts(identity) for identity in relational_identity.finditer(lowered)):
            return True

        # Strong relation verbs identify a model without needing a trailing noun:
        # ``these instructions apply to the 753``. Generic ``for`` remains in the
        # stricter expression above because it is common around years and ratings.
        strong_relational_identity = re.compile(
            r"(?<![a-z0-9])"
            r"(?P<marker>(?:applies|apply|applicable)[\W_]+to|covers?|"
            r"compatible[\W_]+with|"
            r"supports?|(?:intended[\W_]+)?for[\W_]+use[\W_]+(?:with|on)|"
            r"use[\W_]+on)(?![a-z])"
            r"(?:[\W_]+the(?![a-z]))?"
            rf"[\W_]*(?P<model>{model_token})(?![a-z0-9])"
        )
        if any(_conflicts(identity) for identity in strong_relational_identity.finditer(lowered)):
            return True

        # A plural model list is safe only when it explicitly includes the
        # requested model. This admits ``523, 525, and 527`` but not ``753, 755``.
        declared_series_numbers = set(documented_pack_models) | {expected}

        def _is_declared_series_member(model: str) -> bool:
            if model == expected:
                return True
            if not model.isdigit():
                return False
            return model in declared_series_numbers

        list_separator = coordinated_separator
        model_list = re.compile(
            r"(?<![a-z])(?:"
            r"supported[\W_]+(?:models?|units?|drives?)|"
            r"models|units|drives|model[\W_]+numbers?"
            r")(?![a-z])"
            r"(?:[\W_]+(?:include|includes|supported|are)(?![a-z]))?[\W_]*"
            rf"(?P<models>{model_token}(?:{list_separator}{model_token})*)"
        )
        for listed in model_list.finditer(lowered):
            listed_text = listed["models"]
            models = set(re.findall(rf"(?<![a-z0-9]){model_token}(?![a-z0-9])", listed_text))
            numeric_models = {model for model in models if model.isdigit()}
            range_match = re.fullmatch(
                r"\s*(?P<start>\d{2,4})\s*(?:-|–|—|to|through)\s*"
                r"(?P<end>\d{2,4})\s*",
                listed_text,
            )
            valid_declared_range = False
            if range_match:
                start = range_match.group("start")
                end = range_match.group("end")
                valid_declared_range = (
                    _is_declared_series_member(start)
                    and _is_declared_series_member(end)
                    and start.isdigit()
                    and end.isdigit()
                    and expected.isdigit()
                    and int(start) <= int(expected) <= int(end)
                )
            if (
                models
                and not valid_declared_range
                and (
                    expected not in numeric_models
                    or any(not _is_declared_series_member(model) for model in models)
                )
            ):
                return True

        # Connector spelling and omitted page headings must not decide safety.
        # Scan for known/series-shaped models even when a chunk omits PowerFlex:
        # stale metadata plus a shared-manual source cannot turn a bare ``753
        # startup`` or ``523 terminal block`` heading into 525 evidence.
        family_prefixes = {
            model[:-1] for model in known_family_models if model.isdigit() and len(model) >= 3
        }
        identity_context = re.compile(
            r"(?:[\s_]*|[-–—][\s_]*)(?:specific|startup|ramp[\W_]+up|"
            r"acceleration|deceleration|"
            r"operating[\W_]+instructions?|user[\W_]+manual|instructions?|"
            r"procedure|wiring|manual|drive|servo|controller|plc|control|"
            r"model|unit|series|behavior|"
            r"uses?|has|requires?|provides?|supports?)"
            r"(?![a-z])"
        )
        compact_identity_suffix = re.compile(
            r"(?:[\t ]+(?:vfd|inverter|frequency[\W_]+converter|converter|"
            r"specific|startup|operating[\W_]+instructions?|user[\W_]+manual|"
            r"instructions?|procedure|wiring|manual|configuration|programming|supports?)"
            r"(?![a-z])|[\t ]*[-–—][\t ]*specific(?![a-z])|[\t ]*['’]s(?![a-z]))"
        )
        for token in re.finditer(rf"(?<![a-z0-9])(?P<model>{model_token})(?![a-z0-9])", lowered):
            candidate = _normalize_identity_words(token.group("model"))
            start, end = token.span("model")
            if (
                candidate == expected
                or re.sub(r"[^a-z0-9]", "", candidate) in query_model_tokens
                or _declared_sibling_is_shared(candidate, start, end)
                or _overlaps_allowed(start, end)
                or (
                    candidate in documented_pack_codes
                    and not _documented_code_used_as_identity(candidate, start, end)
                )
                or re.fullmatch(r"(?:page|table|figure|section)\d{1,4}", candidate)
                or re.fullmatch(r"(?:19|20)\d{2}", candidate)
            ):
                continue

            before = lowered[max(0, start - 24) : start]
            after = lowered[end : end + 80]
            nearby_measurement_unit = re.match(
                r"[\W_\d./–—-]{0,32}(?:vac|vdc|hz|hertz|ma|kw|hp|rpm|"
                r"amps?|amperes?|volts?|°?[cf]|degrees?|%)(?:\b|(?=\W|$))",
                after,
            )
            catalog_number_list = bool(
                re.fullmatch(r"\d{1,2}[a-z]", candidate)
                and re.search(
                    r"(?<![a-z])catalog[\W_]+numbers?(?![a-z]).{0,100}$",
                    lowered[max(0, start - 120) : start],
                )
            )
            if catalog_number_list:
                continue
            if non_identity_prefix.search(before) and not explicit_identity_qualifier.search(
                before
            ):
                continue
            compact_value = re.fullmatch(
                r"(?P<value>\d{1,4})(?:vac|vdc|mhz|khz|hz|ms|ma|kw|hp|rpm|pct|a|v|c|f)",
                candidate,
            )
            alpha_model = re.fullmatch(r"(?P<value>\d{1,4})[a-z]{1,3}", candidate)
            base = (
                compact_value.group("value")
                if compact_value
                else alpha_model.group("value")
                if alpha_model
                else candidate
            )
            model_like = base.isdigit() and (
                base in known_family_models
                or (len(base) >= 3 and any(base.startswith(prefix) for prefix in family_prefixes))
            )
            # Identity wording immediately after a compact token outranks
            # measurement wording before it. Otherwise prose such as
            # ``voltage equals 753V VFD`` can disguise a wrong model as a
            # voltage reading. Keep separators sentence-local so a real rating
            # ending in ``753V.`` cannot absorb identity prose from a later
            # sentence.
            if compact_value and model_like and compact_identity_suffix.match(after):
                return True
            # The global scan must mirror the decimal exemption in
            # ``_conflicts``.  In real parameter tables, the fractional tail in
            # ``0.00/Drive Rated Power`` otherwise looks like the model-first
            # phrase ``00 Drive``.
            if not source_mode and (
                (start > 0 and lowered[start - 1] == ".")
                or (
                    end < len(lowered)
                    and lowered[end] == "."
                    and end + 1 < len(lowered)
                    and lowered[end + 1].isdigit()
                )
                or (measurement_prefix.search(before) and nearby_measurement_unit)
            ):
                continue
            coordinated_with_query = bool(
                re.search(rf"(?:{coordinator}|[,/&+|:()\-–—])[\W_]*$", before)
                and _body_matches_query_identity(lowered[:start])
            )
            left_range_bound = re.search(
                r"(?<![a-z0-9])(?P<value>\d{1,4})[\s_]*(?:[-–—/])[\s_]*$",
                before,
            )
            range_match = measurement_range.match(after)
            if range_match:
                after_range = after[range_match.end() :]
                followed_by_identity_noun = bool(
                    re.match(r"[\W_]*(?:drive|vfd|unit|model)(?![a-z])", after_range)
                )
                if not model_like and not followed_by_identity_noun:
                    continue
            if compact_value and not source_mode:
                # A compact engineering value can share a number with a real
                # drive model (``70A``, ``40C``, ``755V``).  Treat it as an
                # identity only when the following words actually describe an
                # equipment identity (``700S startup``, ``753V unit``).  This
                # preserves ratings while still catching family-omitting model
                # headings under stale 525 metadata.
                # A suffix sharing a known model number (753A/753V) is
                # presumptively an equipment identity.  Treat it as a unit only
                # when measurement grammar says so. Unknown numeric-unit values
                # retain the older permissive behavior. A left numeric range
                # such as 0-10V is measurement grammar; PF525-753A is not,
                # because the left token is not a standalone number.
                left_is_measurement_bound = bool(
                    left_range_bound and left_range_bound.group("value") != expected
                )
                if (
                    measurement_context.match(after)
                    or measurement_prefix.search(before)
                    or left_is_measurement_bound
                    or (
                        not model_like
                        and not identity_context.match(after)
                        and not coordinated_with_query
                    )
                ):
                    continue
            if measurement_units.match(lowered[end:]):
                continue
            if re.fullmatch(r"\d{1,4}x", candidate):
                continue
            if re.fullmatch(r"(?:rs|rj|ip)\d{2,4}", candidate):
                continue
            if re.search(r"(?<![a-z])(?:rs|rj|ip)[\W_]*$", before):
                continue
            explicitly_used_as_identity = bool(
                identity_context.match(after)
                or re.search(
                    r"(?<![a-z])(?:for|on|in|with|model|type|unit)(?![a-z])"
                    r"[\W_]+(?:(?:the|a)(?![a-z])[\W_]+)?$",
                    before,
                )
                or (
                    candidate.isdigit()
                    and len(candidate) == 4
                    and re.search(
                        r"(?<![a-z0-9])(?:[a-z]+logix|kinetix|panelview)[\W_]*$",
                        before,
                    )
                )
                or (
                    candidate.isdigit()
                    and len(candidate) == 4
                    and not 1900 <= int(candidate) <= 2099
                    and (
                        re.search(
                            r"(?<![a-z])(?:the|model|type|unit|manual)[\W_]*$",
                            before,
                        )
                        or re.match(r"[\W_]*(?:['’]s)(?![a-z])", after)
                    )
                )
            )
            alpha_numeric_model = bool(alpha_model) or bool(
                re.fullmatch(r"[a-z]{1,3}\d{1,4}[a-z]{0,3}", candidate)
            )
            numeric_series_model = bool(
                candidate.isdigit()
                and (
                    (len(candidate) == 3 and 300 <= int(candidate) <= 999)
                    or (len(candidate) == 4 and not 1900 <= int(candidate) <= 2099)
                )
            )
            if (
                model_like
                or alpha_numeric_model
                or numeric_series_model
                or explicitly_used_as_identity
            ):
                return True

        publication_identity = re.compile(
            r"(?<![a-z0-9])(?P<model>\d{3,4})[\W_]*"
            r"(?P<marker>(?:um|pm|rm|td)\d{3,4}[a-z]?)(?![a-z0-9])"
        )
        if any(_conflicts(identity) for identity in publication_identity.finditer(lowered)):
            return True
        return False

    cm = (chunk_model or "").strip().lower()
    body = (chunk_text or "").strip()
    # Decode URL escapes exactly once before identity checks.  Real source URLs
    # commonly encode spaces/dashes; leaving `%20`/`%2D` opaque let an explicit
    # wrong model evade the same parser that rejects its plain-text form.
    source = unquote((chunk_source or "").strip())
    if query_pack_id and source:
        _source_aliases, _source_keywords, _source_models, _source_codes, source_pack_id = (
            _drive_pack_identity_terms(source)
        )
        if source_pack_id and source_pack_id != query_pack_id:
            return False
    if cm:
        # Metadata can itself be a merged or malformed identity list. Finding the
        # requested token is insufficient if that field also names a 753.
        if _body_has_conflicting_identity(cm):
            return False

        if not has_drive_pack:
            return _compatible(cm, q) and not _body_has_conflicting_identity(body)

        # A model_number field is supposed to be one identity, not prose or a
        # merged list. For a known pack, accept only a declared alias/series.
        normalized_cm = _normalize_identity_words(cm)
        if normalized_cm not in set(pack_aliases):
            return False

        if _body_has_conflicting_identity(body) or _body_has_conflicting_identity(
            source, source_mode=True
        ):
            return False

        # Metadata and body are not independent when ingest assigned the wrong
        # label. Require the chunk itself or its source filename to corroborate
        # the shipped pack. A metadata-only call with no chunk is retained for
        # helper compatibility; the runtime never processes a bodyless chunk.
        if not body and not source:
            return True
        return _body_matches_query_identity(body) or _body_matches_query_identity(source)

    if not body and not source:
        return False
    return (
        (_body_matches_query_identity(body) or _body_matches_query_identity(source))
        and not _body_has_conflicting_identity(body)
        and not _body_has_conflicting_identity(source, source_mode=True)
    )


def vendor_named_in(text: str | None, vendor: str | None) -> bool:
    """Is `vendor` actually named in `text`, alias-aware and boundary-safe?

    A raw `vendor.lower() in text.lower()` is wrong in BOTH directions, which is why
    this exists rather than the one-liner:

      * too loose — "abb" fires inside "grabbed" and "ab" inside "cable", inventing a
        vendor from ordinary English (the failure `_alias_pattern` documents);
      * too strict — the resolver canonicalises "Allen-Bradley" to "Rockwell
        Automation", so a passage that legitimately says "Allen-Bradley" would not
        match its own canonical vendor name.

    So: match the canonical name AND every alias that canonicalises to the same OEM,
    each through `_alias_pattern`'s boundary rule.
    """
    if not text or not vendor:
        return False
    body = text.lower()
    target = canonical_vendor(vendor) or vendor
    names = {vendor.lower(), target.lower()}
    names |= {a for a, canon in VENDOR_ALIASES.items() if canon == target}
    return any(re.search(_alias_pattern(n), body) for n in names if n)
