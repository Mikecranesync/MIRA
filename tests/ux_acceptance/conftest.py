"""Session-level guard: this suite may not go quiet and green.

`pytest` exits 0 when every test SKIPS. Collection of zero exits 5, but
all-skipped is a clean pass — verified: a file whose only test sits behind an
`importorskip` for a missing module reports "1 skipped" and exit 0.

That is exactly the #3660 shape. The beta gate could PASS BY SKIPPING because it
read an exit code a skip sets to 0, and the fix there had to grep the output
rather than trust the status. Nothing in this suite skips today, so this is a
future hazard rather than a live one — but the day someone adds an
`importorskip` for a dependency CI lacks, all 45 detector tests go quiet and the
CI step stays green while judging nothing.

The guard lives in `conftest.py` deliberately: a test asserting "nothing was
skipped" could itself be skipped. A session hook cannot.

If a skip is ever legitimate here, add its nodeid to `ALLOWED_SKIPS` with a
reason. Making the exception explicit is the point; a blanket opt-out would
restore the hazard.
"""

from __future__ import annotations

import pytest

#: nodeid -> why this skip is acceptable. Empty on purpose.
ALLOWED_SKIPS: dict[str, str] = {}


def pytest_sessionfinish(session, exitstatus):  # noqa: ARG001
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    if reporter is None:
        return

    skipped = reporter.stats.get("skipped", [])
    offenders = [
        rep.nodeid for rep in skipped if getattr(rep, "nodeid", "") not in ALLOWED_SKIPS
    ]
    if not offenders:
        return

    session.exitstatus = pytest.ExitCode.TESTS_FAILED
    reporter.write_line("")
    reporter.write_line(
        f"UX ACCEPTANCE: {len(offenders)} test(s) SKIPPED. A skipped detector test is "
        "not a passing one — pytest exits 0 on an all-skipped run, which is how a "
        "gate goes quiet and green (#3660).",
        red=True,
    )
    for nodeid in offenders:
        reporter.write_line(f"  skipped: {nodeid}", red=True)
