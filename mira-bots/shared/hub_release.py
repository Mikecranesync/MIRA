"""Hub reviewed-table approvals, as every Python reader of ``knowledge_entries`` honours them (#5646).

The Hub releases the reviewed table rows of an approved file's page only while that approval is
enabled in ``mira-hub/src/capabilities/table-rule-pins.json``. Python services cannot read that file
or know its switch, so they never serve any row of an approved page, in either switch state:

1. a row the Hub marked: released (``metadata.table_reviewed``) or bound to a recorded approval
   (``metadata.table_held``) — the Hub writer marks every row of an approved page;
2. a row of an approved file and page by its stored file hash (``metadata.file_sha256``);
3. a node row stored before rows carried either: an unmarked ``node_attachment`` row of an approved
   page number with no file hash, when a passage of its own document page names one of that page's
   catalog numbers.

Rows of every other document and page are untouched. The approved pages and catalog numbers below
must equal the recorded approvals in the pin file; ``mira-bots/tests/test_recall_excludes_hub_released_rows.py``
fails when they drift. The same clauses are copied into the ingest service
(``mira-core/mira-ingest/db/neon.py``) and the Open WebUI part lookup
(``tools/owui_tools/lookup_part.py``), which cannot import this package; the same test pins both.
"""

from __future__ import annotations

# (file SHA-256, page) of every recorded approval, enabled or not.
HUB_APPROVED_PAGES: tuple[tuple[str, int], ...] = (
    ("090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4", 26),
    ("90fa490a572558d799c8e8a53ba5f074f36182330c636015a473fd0e43bd1fab", 26),
)
# Page number -> the catalog numbers its approved files print on that page.
HUB_APPROVED_PAGE_MODELS: dict[int, tuple[str, ...]] = {
    26: ("GS11N-20P2", "GS11N-20P5", "GS11N-21P0", "GS11N-22P0", "GS11N-23P0"),
}


def hub_release_exclusions(
    pages: tuple[tuple[str, int], ...] = HUB_APPROVED_PAGES,
    models: dict[int, tuple[str, ...]] | None = None,
) -> tuple[str, ...]:
    """The conditions (each true for a row that may be served) on an unaliased ``knowledge_entries``."""
    models = HUB_APPROVED_PAGE_MODELS if models is None else models
    clauses = ["(metadata->>'table_reviewed') IS NULL", "(metadata->>'table_held') IS NULL"]
    if not pages:
        return tuple(clauses)
    pairs = ", ".join(f"('{sha}', '{page}')" for sha, page in sorted(set(pages)))
    clauses.append(
        "(metadata->>'file_sha256' IS NULL OR (metadata->>'file_sha256', "
        f"COALESCE(page_start, source_page, 0)::text) NOT IN ({pairs}))"
    )
    for page in sorted({p for _, p in pages}):
        names = sorted(models.get(page, ()))
        named = " OR ".join(f"strpos(s.content, '{m}') > 0" for m in names) if names else "TRUE"
        clauses.append(
            "(source_type IS DISTINCT FROM 'node_attachment' OR metadata->>'file_sha256' IS NOT NULL"
            f" OR COALESCE(page_start, source_page, 0) <> {page}"
            " OR NOT EXISTS (SELECT 1 FROM knowledge_entries s"
            " WHERE s.tenant_id = knowledge_entries.tenant_id AND s.doc_id = knowledge_entries.doc_id"
            f" AND s.source_type = 'node_attachment' AND COALESCE(s.page_start, s.source_page) = {page}"
            f" AND ({named})))"
        )
    return tuple(clauses)


HUB_RELEASE_EXCLUSIONS: tuple[str, ...] = hub_release_exclusions()
# Appended to a WHERE clause on an unaliased knowledge_entries.
HUB_RELEASE_EXCLUDED_SQL: str = "".join(f" AND {c}" for c in HUB_RELEASE_EXCLUSIONS)
