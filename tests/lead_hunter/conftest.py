"""Make tools/lead-hunter importable as a module for tests — hermetically.

tools/lead-hunter uses bare top-level module names (``celery_tasks``, ``discover``,
``hunt``, ``hardening``, ``run_hourly``, ...) that COLLIDE with same-named modules
elsewhere in the monorepo — notably ``mira-crawler/tasks/discover.py`` and
``tests/eval/celery_tasks.py``.

Under the full ``pytest tests/ -n auto`` suite, another collected test mutates
``sys.path`` (or populates ``sys.modules``) at runtime, so a bare ``import discover``
inside a lead-hunter test resolves to mira-crawler's copy — which imports
``celery`` / ``mira_crawler`` and explodes in the offline env. That is the 2026-07
"Eval Offline" red: ``tests/lead_hunter/test_celery_tasks.py`` failing with
``ModuleNotFoundError: No module named 'celery' / 'mira_crawler'``. A one-time
``sys.path.insert`` at import time is not robust to that later mutation.

The autouse fixture below makes each lead-hunter test hermetic: it pins
tools/lead-hunter at ``sys.path[0]`` and evicts any shadowing same-name modules for
the duration of the test, then restores the prior import state so the wider suite
is unaffected.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

LEAD_HUNTER = Path(__file__).resolve().parents[2] / "tools" / "lead-hunter"

# Bare module names that live in tools/lead-hunter and collide elsewhere.
_LOCAL_MODULE_NAMES = tuple(sorted(p.stem for p in LEAD_HUNTER.glob("*.py")))

# Keep the import-time insertion so plain collection (and non-fixtured code) works.
sys.path.insert(0, str(LEAD_HUNTER))


def _is_lead_hunter_module(mod: object) -> bool:
    """True if an already-imported module was loaded from tools/lead-hunter."""
    file = getattr(mod, "__file__", None)
    if not file:
        return False
    try:
        return Path(file).resolve().is_relative_to(LEAD_HUNTER)
    except (ValueError, OSError):
        return False


@pytest.fixture(autouse=True)
def _hermetic_lead_hunter_imports():
    """Pin tools/lead-hunter at sys.path[0] and shadow-evict colliding modules so
    bare ``import discover`` / ``import celery_tasks`` always resolve to the
    lead-hunter copies regardless of full-suite import order. Restores after."""
    lead = str(LEAD_HUNTER)
    saved_path = list(sys.path)
    saved_modules = {name: sys.modules.get(name) for name in _LOCAL_MODULE_NAMES}

    # 1. tools/lead-hunter must win path resolution, even if another test
    #    inserted its own dir at sys.path[0] after collection.
    while lead in sys.path:
        sys.path.remove(lead)
    sys.path.insert(0, lead)

    # 2. Evict any shadowing copy (e.g. mira-crawler's discover) so the test's
    #    `import X` re-imports from tools/lead-hunter.
    for name in _LOCAL_MODULE_NAMES:
        mod = sys.modules.get(name)
        if mod is not None and not _is_lead_hunter_module(mod):
            del sys.modules[name]

    try:
        yield
    finally:
        # Restore the wider suite's import state exactly as we found it.
        sys.path[:] = saved_path
        for name, mod in saved_modules.items():
            if mod is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = mod
