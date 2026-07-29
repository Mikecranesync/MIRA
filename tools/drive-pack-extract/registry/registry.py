"""Manual source registry — load, validate, identity + hash-change classification.

Pure, read-only logic (stdlib only). The registry (``sources.json``) records
every drive manual's identity, its approved ``pdf_sha256``, the reproducible
generator + gold set that turns it into a pack, and the pack's last-known
trust status. This module NEVER downloads, extracts, grades, or promotes — it
only answers "given a local PDF, is this new / unchanged / changed vs. what we
have registered?". The trust-preserving rule lives one layer up
(``update_candidate.py``): a hash mismatch produces a CANDIDATE, never an
automatic trusted replacement.

Design notes:
- No wall-clock, no network, no DB — deterministic and CI-safe.
- ``classify()`` is the heart: it maps (registry entry?, new sha256) onto the
  brief's manual-state vocabulary, which ``check.py`` prints and
  ``update_candidate.py`` gates on.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# --- manual-state vocabulary (the brief's Phase-2 distinctions) -------------
# What a local PDF is *relative to the registry*. Pack-lifecycle states
# (regenerated/internal_only/promoted) are trust_status transitions recorded on
# the entry after grading + human approval, not derivable from a PDF hash, so
# they are NOT emitted here.
NEW_MANUAL = "new_manual"  # 1. no registry entry matches
UNCHANGED = "unchanged"  # 2. hash == registered approved hash
CHANGED_BY_HASH = "changed_by_hash"  # 3. entry exists, hash differs -> candidate
NEEDS_INITIAL_CANDIDATE = "needs_initial_candidate"  # registered but never hashed/generated

ALL_STATES = (NEW_MANUAL, UNCHANGED, CHANGED_BY_HASH, NEEDS_INITIAL_CANDIDATE)

# Trust statuses a pack may carry (Phase 6 vocabulary). The automated grader
# never emits ``trusted``/``superseded`` — those are human-recorded here.
TRUST_STATUSES = ("candidate", "internal_only", "beta", "trusted", "rejected", "superseded")

# Every source-classification tag the registry may use (Phase 3 vocabulary).
SOURCE_CLASSIFICATIONS = (
    "official",
    "unofficial",
    "downloadable_pdf",
    "metadata_only",
    "update_advisory_only",
    "requires_login",
    "manual_review_only",
)

_REQUIRED_FIELDS = (
    "manual_id",
    "vendor",
    "product_family",
    "manual_title",
    "pack_id",
    "automatable",
    "source_classification",
    "pack_trust_status",
)

_TOOL_DIR = Path(__file__).resolve().parent.parent  # tools/drive-pack-extract/
_DEFAULT_REGISTRY = Path(__file__).resolve().parent / "sources.json"


@dataclass(frozen=True)
class Classification:
    """Result of classifying a local PDF against the registry."""

    state: str
    manual_id: str | None
    reasons: list[str]

    @property
    def needs_candidate(self) -> bool:
        """True when a candidate pack should be (re)generated for review."""
        return self.state in (NEW_MANUAL, CHANGED_BY_HASH, NEEDS_INITIAL_CANDIDATE)


def sha256_file(path: str | Path) -> str:
    """Streaming SHA-256 of a file's raw bytes. Matches the hashing the
    extractor's ``generate_*_pack.py`` and the grader already use, so a hash
    computed here is directly comparable to a pack's recorded provenance hash."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_registry(path: str | Path | None = None) -> dict[str, Any]:
    """Load + structurally validate ``sources.json``. Raises ``ValueError`` on
    any malformed entry (fail-closed — a broken registry must not silently
    behave as "no manuals known")."""
    reg_path = Path(path) if path else _DEFAULT_REGISTRY
    raw = json.loads(reg_path.read_text(encoding="utf-8"))

    if not isinstance(raw, dict) or "manuals" not in raw:
        raise ValueError(f"registry {reg_path}: missing top-level 'manuals' list")
    manuals = raw["manuals"]
    if not isinstance(manuals, list):
        raise ValueError(f"registry {reg_path}: 'manuals' must be a list")

    for i, entry in enumerate(manuals):
        _validate_entry(entry, where=f"{reg_path} manuals[{i}]")

    dupes = detect_duplicate_identities(manuals)
    if dupes:
        raise ValueError(f"registry {reg_path}: duplicate manual_id(s) {sorted(dupes)}")

    return raw


def _validate_entry(entry: Any, *, where: str) -> None:
    if not isinstance(entry, dict):
        raise ValueError(f"{where}: entry must be an object")
    missing = [f for f in _REQUIRED_FIELDS if f not in entry]
    if missing:
        raise ValueError(f"{where}: missing required field(s) {missing}")

    ts = entry["pack_trust_status"]
    if ts not in TRUST_STATUSES:
        raise ValueError(f"{where}: pack_trust_status {ts!r} not in {TRUST_STATUSES}")

    sc = entry["source_classification"]
    if not isinstance(sc, list) or not sc:
        raise ValueError(f"{where}: source_classification must be a non-empty list")
    bad = [c for c in sc if c not in SOURCE_CLASSIFICATIONS]
    if bad:
        raise ValueError(f"{where}: unknown source_classification {bad}")

    if not isinstance(entry["automatable"], bool):
        raise ValueError(f"{where}: automatable must be a boolean")

    # An automatable source MUST declare a reproducible generator + gold set,
    # else "automatable" is a lie and update_candidate would fail opaquely.
    if entry["automatable"] and (not entry.get("generator") or not entry.get("gold_path")):
        raise ValueError(
            f"{where}: automatable=true requires both 'generator' and 'gold_path' "
            "(a reproducible extraction path + a gold set to grade against)"
        )


def detect_duplicate_identities(manuals: list[dict[str, Any]]) -> set[str]:
    """Return the set of ``manual_id`` values that appear more than once.

    ``manual_id`` is the manual's stable identity (vendor+model+publication).
    Two rows with the same id are a curation bug — one would silently shadow
    the other on lookup."""
    seen: dict[str, int] = {}
    for entry in manuals:
        mid = entry.get("manual_id")
        if mid is None:
            continue
        seen[mid] = seen.get(mid, 0) + 1
    return {mid for mid, n in seen.items() if n > 1}


def find_entry(registry: dict[str, Any], manual_id: str) -> dict[str, Any] | None:
    """Look up a manual by its stable ``manual_id``."""
    for entry in registry["manuals"]:
        if entry.get("manual_id") == manual_id:
            return entry
    return None


def find_by_hash(registry: dict[str, Any], sha256: str) -> dict[str, Any] | None:
    """Find a registered manual whose approved ``pdf_sha256`` matches (i.e. this
    exact PDF is already registered and unchanged)."""
    for entry in registry["manuals"]:
        if entry.get("pdf_sha256") and entry["pdf_sha256"] == sha256:
            return entry
    return None


def classify(entry: dict[str, Any] | None, new_sha256: str) -> Classification:
    """Map (registry entry?, freshly-computed sha256) onto a manual-state.

    - entry is None                 -> NEW_MANUAL (unknown to the registry)
    - entry has no pdf_sha256 yet    -> NEEDS_INITIAL_CANDIDATE
    - new hash == registered hash    -> UNCHANGED (no-op)
    - otherwise                      -> CHANGED_BY_HASH (a candidate is due)

    Never promotes, never writes — pure decision.
    """
    if entry is None:
        return Classification(
            NEW_MANUAL,
            None,
            ["no registry entry matches this manual — register it before generating a pack"],
        )

    mid = entry.get("manual_id")
    registered = entry.get("pdf_sha256")

    if not registered:
        return Classification(
            NEEDS_INITIAL_CANDIDATE,
            mid,
            [f"'{mid}' is registered but has no approved pdf_sha256 yet — first candidate is due"],
        )

    if new_sha256 == registered:
        return Classification(
            UNCHANGED,
            mid,
            [f"sha256 matches the approved hash for '{mid}' — up to date, no action"],
        )

    return Classification(
        CHANGED_BY_HASH,
        mid,
        [
            f"sha256 {new_sha256[:12]}… differs from the approved hash "
            f"{registered[:12]}… for '{mid}' — a CANDIDATE update is due (not an auto-replace)"
        ],
    )


def resolve_tool_path(rel: str) -> Path:
    """Resolve a registry-relative path (e.g. 'gold/powerflex_525/gold.json')
    against the tool root ``tools/drive-pack-extract/``."""
    return (_TOOL_DIR / rel).resolve()
