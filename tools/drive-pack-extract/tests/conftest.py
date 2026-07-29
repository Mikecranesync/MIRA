"""Make the sibling ``tools/drive-pack-extract/*.py`` modules importable.

The tool package lives under a hyphenated directory name
(``tools/drive-pack-extract/``), so it can't be imported as a normal Python
package (``drive-pack-extract`` isn't a valid identifier). Tests import its
modules (``extractor``, ``cite_integrity``) as plain top-level modules by
adding the parent directory to ``sys.path`` here, before collection — the
same pattern the repo's other hyphenated ``tools/`` scripts rely on.
"""

from __future__ import annotations

import sys
from pathlib import Path

_TOOL_DIR = Path(__file__).resolve().parent.parent
if str(_TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOL_DIR))
