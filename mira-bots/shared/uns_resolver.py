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
from typing import Any

# Path builders live in shared/uns_paths.py — a verbatim, dep-free copy of the
# subset of mira-crawler/ingest/uns.py the resolver needs. mira-bots cannot
# import from mira-crawler (architecture contract, enforced in CI).
from . import uns_paths as _uns
from .neon_recall import kb_has_pair_coverage

logger = logging.getLogger(__name__)


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
            if re.search(rf"\b{re.escape(alias)}\b", message_lower):
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
            m = re.search(rf"\b{re.escape(alias)}\b", message_lower)
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
    (``rag_worker``) so they never disagree. Substring match, longest alias
    first, so ``"rockwell automation"`` wins over ``"rockwell"``.
    """
    if not name:
        return None
    low = name.strip().lower()
    if low in VENDOR_ALIASES:
        return VENDOR_ALIASES[low]
    for alias in sorted(VENDOR_ALIASES, key=len, reverse=True):
        if alias in low:
            return VENDOR_ALIASES[alias]
    return None


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
    # The family-marker model fallback (see resolve_uns_path) can set model
    # equal to the family token for openers like "GS20 OC". Both occupy
    # distinct path slots, so without this guard the path doubles the segment
    # (.../automationdirect/gs20/gs20/...). Drop the duplicate.
    if model and family and model.lower() == family.lower():
        model = None
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
    """Carry forward prior fields where the fresh ctx has nothing. Confidence
    decays slightly each turn."""
    if prior is None:
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

    # When the alias matched a family-marker (gs10, gs20, powerflex, micromaster,
    # sinamics, fr-e/a/d/f, aqua drive) AND no separate model token was extracted,
    # fall back to the family token as the model. The family token IS the model
    # class for these aliases — without this, confidence stays at 0.5 (mfr only)
    # and engine.py never sets state["asset_identified"], which loops the UNS
    # Confirmation Gate on every turn. See #1572 cluster 1.
    if model is None and family_token:
        model = family_token

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
