"""
Conv_Simple machine-card anomaly rules -- Py3 SHIM.

The rules now live in `rules_core.py`, a single source written to import + run identically
under BOTH CPython 3.12 (the bench) AND Jython 2.7 (the Ignition gateway, vendored as
diagnose_core.py for the /api/diagnose WebDev endpoint). This shim keeps every existing
bench importer unchanged -- engine.py, live_check.py, and the live_* tools all still
`import rules` / `rules.evaluate(...)` / `rules.RULES` / `rules.Anomaly`.

See docs/plans/2026-06-14 (warm-wadler) Phase 1 and
tests/regime7_ignition/test_diagnose_parity.py (parity + drift guard).
"""
from rules_core import *  # noqa: F401,F403  (re-export public names: evaluate, RULES, Anomaly, ...)
# Re-export the underscore-prefixed internals too, in case a bench tool/test references them
# (import * skips leading-underscore names).
from rules_core import _ev, _vfd_trustworthy, _CONF, _GS10_CRITICAL  # noqa: F401
