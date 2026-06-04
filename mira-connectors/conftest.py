"""pytest configuration for the connector framework.

Mirrors the per-module convention used across the repo (e.g.
``mira-crawler/conftest.py``, ``mira-relay/tests/conftest.py``): tests are run
from inside this module (``pytest mira-connectors/tests`` or ``cd
mira-connectors && pytest``), and this conftest puts the two roots the imports
need onto ``sys.path``:

* ``mira-connectors/`` itself  → ``from base import ...``, ``from cmms.maximo_mock import ...``
* ``mira-crawler/``            → ``from ingest.uns import ...`` (the UNS builders)

NOTE: this module defines a ``cmms`` subpackage whose name collides with
``mira-mcp/cmms``. Under the repo's per-module test invocation they are never on
``sys.path`` together, so the collision is benign. Do not add ``mira-mcp`` to
``sys.path`` in the same session.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent  # mira-connectors/
_CRAWLER = _HERE.parent / "mira-crawler"

for p in (_HERE, _CRAWLER):
    if p.is_dir() and str(p) not in sys.path:
        sys.path.insert(0, str(p))
