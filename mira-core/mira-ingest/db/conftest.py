"""Hyphenated parent dirs (mira-core, mira-ingest) can't be imported as
Python packages. This conftest puts `mira-ingest/` on sys.path so test
files can `from db import neon, data_types`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
