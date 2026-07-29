"""celery_app must boot even when an optional task module can't import.

Regression (historian deploy, 2026-06-28): ``celery_app`` eagerly hard-imported
``tasks.component_template``, whose unguarded ``from build_component_template
import ...`` fails on the slim ``Dockerfile.celery`` image (it never copies
``tools/``). That one unimportable optional task crash-looped the *entire*
historian worker/beat — even though the historian queue only runs
``tag_diff_historizer`` + ``historize_runs``. Boot must now log-and-skip a bad
optional task instead of aborting.

Imports use the local layout (``celery_app`` / ``tasks.*``) — the same one
conftest.py wires up and the rest of the crawler tests use.
"""

from __future__ import annotations

import importlib
import sys


def _drop_celery_modules() -> None:
    for name in [m for m in sys.modules if m == "celery_app" or m.startswith("tasks.")]:
        del sys.modules[name]


def test_boot_skips_unimportable_task_and_keeps_the_rest(monkeypatch, caplog):
    real_import_module = importlib.import_module

    def fake_import_module(name, package=None):
        # Simulate the slim historian image: component_template's bare
        # `from build_component_template import ...` has nothing to resolve.
        if name == "tasks.component_template":
            raise ModuleNotFoundError("No module named 'build_component_template'")
        return real_import_module(name, package)

    monkeypatch.setattr(importlib, "import_module", fake_import_module)

    _drop_celery_modules()
    with caplog.at_level("WARNING"):
        # Load celery_app itself with the real loader; the patch only intercepts
        # the per-task imports celery_app performs internally.
        celery_app = real_import_module("celery_app")

    # Boot did not raise, the broken module was logged as a warning…
    assert any("component_template" in r.getMessage() for r in caplog.records)
    # …and a task LATER in the list still imported (the loop kept going).
    assert "tasks.tag_diff_historizer" in sys.modules
    assert celery_app.app is not None


def test_boot_clean_when_all_tasks_import():
    _drop_celery_modules()
    celery_app = importlib.import_module("celery_app")
    assert celery_app.app is not None
    # tools/ exists at repo root locally, so component_template + the historian
    # tasks all register on a normal boot.
    assert "tasks.tag_diff_historizer" in sys.modules
    assert "tasks.historize_runs" in sys.modules
