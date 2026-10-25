"""Make tools/retrieval_eval importable as ``retrieval_eval``.

The root tests/conftest.py puts mira-bots/ first on sys.path, and mira-bots/tools
shadows the repo's tools/ package. Appending (not prepending) tools/ adds only
new top-level names, so no other test's imports can change.
"""

import sys
from pathlib import Path

_TOOLS = str(Path(__file__).resolve().parents[2] / "tools")
if _TOOLS not in sys.path:
    sys.path.append(_TOOLS)
