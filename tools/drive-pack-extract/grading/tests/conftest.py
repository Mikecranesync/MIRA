"""Make the grading modules and their sibling tool modules importable.

Mirrors ``tools/drive-pack-extract/tests/conftest.py``: the grading package
lives under the same hyphenated ``tools/drive-pack-extract/`` directory, and
its modules (``report``, ``schema_check``, ``cite_check``, ``gold_score``,
``domain_rules``) import each other and ``cite_integrity`` as plain top-level
modules (matching how ``grade.py`` is run directly: ``python grade.py``).
Both directories are added to ``sys.path`` here, before collection, so tests
can do the same.
"""

from __future__ import annotations

import sys
from pathlib import Path

_GRADING_DIR = Path(__file__).resolve().parent.parent
_TOOL_DIR = _GRADING_DIR.parent

for _dir in (_TOOL_DIR, _GRADING_DIR):
    if str(_dir) not in sys.path:
        sys.path.insert(0, str(_dir))
