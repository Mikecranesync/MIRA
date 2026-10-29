"""Model-id canonicalizer shared by the e2e safety harness (#4372).

Same rules as mira-hub/tests/safety-e2e/model-id.ts; both are pinned by
tools/safety_e2e/model_id_cases.json.
"""

from __future__ import annotations

import re

_DATED = re.compile(r"-\d{4}-\d{2}-\d{2}$")


def canonical_model_id(model: str) -> str:
    """Lowercase, trim, strip a provider prefix (up to the last '/'), strip ':latest'."""
    m = (model or "").strip().lower()
    m = m.rsplit("/", 1)[-1]
    if m.endswith(":latest"):
        m = m[: -len(":latest")]
    return m


def model_family(model: str) -> str:
    """The canonical id minus any ':tag' and any trailing dated-snapshot suffix."""
    return _DATED.sub("", canonical_model_id(model).split(":", 1)[0])
