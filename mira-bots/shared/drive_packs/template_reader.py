"""``FaultCodesTemplateReader`` — the FIRST concrete ``TemplateReader``
(ADR-0025 §1, layer 2; the enrichment seam declared in ``cards.py``).

Backing store rationale (see task brief / ADR-0025 §1): the ``TemplateReader``
Protocol is keyed by numeric ``fault_code``. The ``fault_codes`` table
(``docs/migrations/002_fault_codes.sql``, seeded by
``mira-core/scripts/seed_fault_codes.py``) is the only store whose keys match
a pack's ``live_decode.fault_codes`` 1:1, with a real ``cause``/``action``/
``page_num``/``source_url``/``description`` per code.
``component_templates`` is component-level (a flat ``common_failure_modes``
list, not fault-code-keyed) and is a later layer — out of scope here.

Purity (HARD, ``.claude/rules/fieldbus-readonly.md`` + the
``test_drive_packs_readonly.py`` shipping gate): this module takes its data
INJECTED at construction. It never imports a DB/network/fieldbus driver and
never queries anything live — a future adapter that actually reads NeonDB's
``fault_codes`` table is a separate, out-of-scope concern.
"""

from __future__ import annotations

from dataclasses import dataclass

from .cards import Citation


@dataclass(frozen=True)
class FaultCodeIntel:
    """One fault code's intelligence — mirrors the ``fault_codes`` columns
    this reader uses. ``doc`` is the manufacturer manual name, ``page`` is
    ``page_num``, ``excerpt`` is the ``description``/``cause`` text."""

    cause: str = ""
    action: str = ""
    doc: str = ""
    page: str = ""
    excerpt: str = ""


class FaultCodesTemplateReader:
    """Concrete ``TemplateReader`` backed by injected ``fault_codes``-shaped
    data — a nested mapping of ``pack_id -> fault_code -> FaultCodeIntel``.

    Unknown ``pack_id`` or unknown ``fault_code`` returns ``[]`` from every
    method — never raises, never fabricates.
    """

    def __init__(self, data: dict[str, dict[int, FaultCodeIntel]]) -> None:
        self._data = data

    def _intel(self, pack_id: str, fault_code: int) -> FaultCodeIntel | None:
        return self._data.get(pack_id, {}).get(fault_code)

    def causes_for(self, pack_id: str, fault_code: int) -> list[str]:
        intel = self._intel(pack_id, fault_code)
        if intel is None or not intel.cause:
            return []
        return [intel.cause]

    def checks_for(self, pack_id: str, fault_code: int) -> list[str]:
        intel = self._intel(pack_id, fault_code)
        if intel is None or not intel.action:
            return []
        return [intel.action]

    def citations_for(self, pack_id: str, fault_code: int) -> list[Citation]:
        intel = self._intel(pack_id, fault_code)
        if intel is None or not intel.doc:
            return []
        return [Citation(doc=intel.doc, page=intel.page, excerpt=intel.excerpt)]
