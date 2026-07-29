"""Make both the contextualizer package and the sibling mira-plc-parser importable without install
(same sys.path-injection the Hub worker uses)."""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG_ROOT = os.path.normpath(os.path.join(_HERE, ".."))  # mira-contextualizer/
_PARSER = os.path.normpath(os.path.join(_HERE, "..", "..", "mira-plc-parser"))  # sibling engine

for _p in (_PKG_ROOT, _PARSER):
    if _p not in sys.path:
        sys.path.insert(0, _p)
