"""Source registry with fail-closed policy enforcement (Benchmark Factory spec §5).

Every case names a `source_id`. A source that is not registered cannot contribute a case,
and nothing may be *collected* from a source until a human has reviewed its terms
(`reviewed_at`) and allowed automated collection. Replaying an already-captured fixture is
not collection, which is why `require_collection` and `require_case` are separate gates.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

DEFAULT_REGISTRY = Path(__file__).with_name("sources.yaml")

SOURCE_TYPES = frozenset({"forum", "q_and_a", "oem", "government", "dataset", "field"})
#: discovery = how technicians ask (never gold); supporting = context and scenarios;
#: authoritative = may back a gold answer.
GROUND_TRUTH_ROLES = frozenset({"discovery", "supporting", "authoritative"})
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class SourcePolicyError(PermissionError):
    """Raised when an action is not permitted by the registry. Never caught to continue."""


@dataclass(frozen=True)
class SourceEntry:
    source_id: str
    name: str
    source_type: str
    family: str
    base_url: str | None
    license_or_terms: str
    attribution_required: bool
    automated_collection_allowed: bool
    store_full_text: bool
    store_derived_case: bool
    redistribution_allowed: bool
    ground_truth_role: str
    reviewed_at: str | None
    notes: str | None = None

    @property
    def reviewed(self) -> bool:
        return bool(self.reviewed_at) and bool(_DATE.match(str(self.reviewed_at)))


class SourceRegistry:
    def __init__(self, entries: list[SourceEntry]):
        self._by_id: dict[str, SourceEntry] = {}
        for entry in entries:
            if entry.source_id in self._by_id:
                raise ValueError(f"duplicate source_id {entry.source_id!r}")
            if entry.source_type not in SOURCE_TYPES:
                raise ValueError(f"{entry.source_id}: unknown source_type {entry.source_type!r}")
            if entry.ground_truth_role not in GROUND_TRUTH_ROLES:
                raise ValueError(
                    f"{entry.source_id}: unknown ground_truth_role {entry.ground_truth_role!r}"
                )
            self._by_id[entry.source_id] = entry

    @classmethod
    def load(cls, path: Path = DEFAULT_REGISTRY) -> SourceRegistry:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return cls(
            [SourceEntry(**{k: v for k, v in raw.items()}) for raw in data.get("sources", [])]
        )

    def __contains__(self, source_id: str) -> bool:
        return source_id in self._by_id

    def get(self, source_id: str) -> SourceEntry:
        try:
            return self._by_id[source_id]
        except KeyError:
            raise SourcePolicyError(f"source {source_id!r} is not in the registry") from None

    def families(self) -> set[str]:
        return {e.family for e in self._by_id.values()}

    def require_case(self, source_id: str) -> SourceEntry:
        """A case may be derived from this source (fixture replay or manual import)."""
        entry = self.get(source_id)
        if not entry.store_derived_case:
            raise SourcePolicyError(f"{source_id}: store_derived_case is false")
        return entry

    def require_collection(self, source_id: str) -> SourceEntry:
        """Automated collection (a live crawler run) is permitted. Fails closed."""
        entry = self.get(source_id)
        if not entry.reviewed:
            raise SourcePolicyError(f"{source_id}: terms not reviewed (reviewed_at unset)")
        if not entry.automated_collection_allowed:
            raise SourcePolicyError(f"{source_id}: automated collection not allowed")
        return entry

    def may_commit_text(self, source_id: str) -> bool:
        """Verbatim source text may be committed to the (public) repository."""
        entry = self.get(source_id)
        return entry.reviewed and entry.store_full_text and entry.redistribution_allowed

    def may_back_gold(self, source_id: str) -> bool:
        return self.get(source_id).ground_truth_role == "authoritative"
