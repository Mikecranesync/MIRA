"""Make the sibling ``registry/*.py`` modules importable as top-level modules.

Same pattern as ``tools/drive-pack-extract/tests/conftest.py`` — the tool lives
under a hyphenated directory, so its modules are imported by putting the
package dir on ``sys.path`` before collection.
"""

from __future__ import annotations

import sys
from pathlib import Path

_REG_DIR = Path(__file__).resolve().parent.parent  # registry/
if str(_REG_DIR) not in sys.path:
    sys.path.insert(0, str(_REG_DIR))
