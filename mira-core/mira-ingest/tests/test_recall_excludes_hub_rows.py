"""Ingest-service recall never serves a row of a Hub-approved table page, in either switch state.

The Hub alone decides whether an approval in mira-hub/src/capabilities/table-rule-pins.json is
enabled, so this service never serves any row of an approved page (#5646): a row the Hub marked
(metadata.table_reviewed or metadata.table_held), a row identified by its file hash
(metadata.file_sha256), or a node row stored before either, recognised by its page. The clauses are
a copy of mira-bots/shared/hub_release.py; mira-bots/tests/test_recall_excludes_hub_released_rows.py
pins the copy equal and proves the clauses against a real Postgres. Captured SQL, no database.
"""

from __future__ import annotations

import os
import re
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from db import neon  # noqa: E402

EXCLUSIONS = neon._HUB_MARK_EXCLUSIONS


def test_the_copy_carries_every_kind_of_exclusion():
    joined = " ".join(EXCLUSIONS)
    assert len(EXCLUSIONS) == 4
    assert EXCLUSIONS[:2] == (
        "(metadata->>'table_reviewed') IS NULL",
        "(metadata->>'table_held') IS NULL",
    )
    assert "090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4" in joined
    assert "strpos(s.content, 'GS11N-20P2') > 0" in joined


def test_visual_and_image_recall_exclude_every_approved_page_row():
    conn = MagicMock()
    conn.execute.return_value.mappings.return_value.fetchall.return_value = []
    engine = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)
    with patch.object(neon, "_engine", return_value=engine):
        neon.recall_knowledge([0.5] * 4, "tenant")
        neon.recall_by_image([0.5] * 4, "tenant")
    sqls = [str(call.args[0]) for call in conn.execute.call_args_list]
    assert len(sqls) == 2  # precondition: both queries ran
    assert all(all(e in sql for e in EXCLUSIONS) for sql in sqls)
    # The same-page lookup names the outer table, so the outer read must not alias it.
    for sql in sqls:
        body = sql
        for clause in EXCLUSIONS:
            body = body.replace(clause, "")
        names = re.findall(r"FROM\s+knowledge_entries\b(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?", body)
        assert names and all(n == "" or n.upper() in {"WHERE", "ORDER", "LIMIT"} for n in names)
