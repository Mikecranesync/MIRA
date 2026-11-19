"""Ingest-service recall never serves a Hub row released or held under a reviewed table approval.

The Hub alone decides whether an approval in mira-hub/src/capabilities/table-rule-pins.json is
enabled, so this service never serves a row the Hub marked (metadata.table_reviewed or
metadata.table_held) at all (#5646). Captured SQL, no database.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from db import neon  # noqa: E402

EXCLUSIONS = ("(metadata->>'table_reviewed') IS NULL", "(metadata->>'table_held') IS NULL")


def test_visual_and_image_recall_exclude_hub_marked_rows():
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
