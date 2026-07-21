"""Concrete backends for the Materialized Evidence layer (PR G onward).

The pure package (PRs C–F) ships only the ``MaterializationRegistry`` protocol +
the hermetic ``InMemoryRegistry``. ``registry.py`` explicitly anticipates a
"persistent Neon/object-store backend [as] a later concrete PR that implements
the same protocol" — this subpackage is where those live. First one: the durable
JSON-snapshot ``FileRegistry`` (PR G).
"""

from __future__ import annotations

from .file_registry import FileRegistry

__all__ = ["FileRegistry"]
