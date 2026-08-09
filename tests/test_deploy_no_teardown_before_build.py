"""The VPS deploy must not destroy live containers before it has built their replacements.

Why this exists
---------------
Until 2026-08-09, ``deploy-vps.yml`` ran an unconditional::

    for svc in $TARGETS; do docker rm -f "$svc"; done

*before* ``docker compose build``. So every deploy hard-removed the running
containers and only then started building — leaving both public surfaces dark for
**build time + boot time**, not just boot time.

With a warm layer cache that window is ~15s and easy to miss. Measured on
2026-08-09: four merges to ``main`` inside 40 minutes produced four separate
outage windows, on ``app.factorylm.com`` (mira-hub, upstream ``:3101``) *and*
``factorylm.com`` (mira-web, ``:3200``), each logged by nginx as
``connect() failed (111: Connection refused)``. On a cold build it would be
minutes of hard downtime.

The teardown is still needed as a *recovery* path — compose can lose track of a
same-named container and fail with "container name already in use" (run
25264673954, 2026-05-02) — so it moved into a ``stale_cleanup`` function that runs
only when the swap actually fails.

This test pins the ordering, because it is invisible when it regresses: the deploy
still succeeds, still reports green, and only end users see the gap.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
WORKFLOW = REPO / ".github" / "workflows" / "deploy-vps.yml"


def _deploy_body() -> list[str]:
    """Non-comment lines of the remote deploy script inside deploy-vps.yml."""
    doc = yaml.safe_load(WORKFLOW.read_text())
    for job in doc.get("jobs", {}).values():
        for step in job.get("steps", []):
            run = step.get("run", "") or ""
            if "--force-recreate" in run and "saas.yml build" in run:
                m = re.search(r"<<'?ENDSSH'?\n(.*?)\n\s*ENDSSH", run, re.S)
                body = m.group(1) if m else run
                return [ln for ln in body.splitlines() if not ln.lstrip().startswith("#")]
    pytest.fail("Could not locate the deploy step in deploy-vps.yml")


def _lines_matching(needle: str) -> list[int]:
    return [i for i, ln in enumerate(_deploy_body()) if needle in ln]


def test_teardown_is_never_invoked_before_the_build():
    """THE invariant that actually catches the 2026-08-09 outage.

    Note what does *not* work here. Asserting "build precedes swap" passes on the
    broken workflow too — there, build was line 52 and the swap line 53; the damage
    was done by the `rm -f` loop at line 40. And asserting "no teardown text appears
    before the build" would false-fail on the fixed file, because ``stale_cleanup``
    is *defined* above the build even though it is only *called* below it.

    The honest invariant is about the call site: nothing may tear down a live
    container until its replacement image has been built.
    """
    body = _deploy_body()
    build = [i for i, ln in enumerate(body) if "saas.yml build" in ln]
    assert build, "no `docker compose build` found in the deploy step"

    # Bare `stale_cleanup` invocations (not the `stale_cleanup()` definition line).
    calls = [
        i
        for i, ln in enumerate(body)
        if ln.strip() == "stale_cleanup" or ln.strip().startswith("stale_cleanup ")
    ]
    assert calls, "stale_cleanup is defined but never invoked — the recovery path is dead"
    assert all(c > build[0] for c in calls), (
        "stale_cleanup() is invoked before the build. Tearing down live containers "
        "before their replacement images exist is exactly the 2026-08-09 regression: "
        "the site stays dark for build time, not just boot time."
    )

    # And no inline teardown of targets outside that helper at all.
    inline = [
        i for i, ln in enumerate(body) if "docker rm -f" in ln and "${svc}" in ln and i < build[0]
    ]
    inline_outside_fn = [
        i for i in inline if not any(ln.strip().startswith("stale_cleanup()") for ln in body[:i])
    ]
    assert not inline_outside_fn, (
        f"Inline `docker rm -f` of deploy targets at line(s) {inline_outside_fn}, before the "
        f"build and outside stale_cleanup(). This is the original bug verbatim."
    )


def test_build_happens_before_container_swap():
    build = _lines_matching("saas.yml build")
    swap = _lines_matching("up -d --no-deps --force-recreate")
    assert build, "no `docker compose build` found in the deploy step"
    assert swap, "no `up -d --no-deps --force-recreate` found in the deploy step"
    assert all(build[0] < s for s in swap), (
        "The container swap runs before the build. Old containers must keep serving "
        "for the whole build; otherwise the site is down for build+boot, not boot."
    )


def test_target_teardown_is_a_failure_path_not_a_precondition():
    """`docker rm -f` of deploy targets must live inside stale_cleanup, not run inline."""
    body = _deploy_body()
    fn_def = [i for i, ln in enumerate(body) if ln.strip().startswith("stale_cleanup()")]
    rm_target = [i for i, ln in enumerate(body) if 'docker rm -f "${svc}"' in ln]
    assert fn_def, "stale_cleanup() helper is gone — target teardown may be inline again"
    assert rm_target, "expected the stale-container teardown to still exist as a recovery path"
    assert all(r > fn_def[0] for r in rm_target), (
        "A `docker rm -f` of deploy targets runs outside stale_cleanup(). That is the "
        "pre-emptive teardown that caused the 2026-08-09 outage windows."
    )


def test_swap_is_health_gated():
    """The swap must wait for health, and must not hard-code a possibly-unsupported flag."""
    body = "\n".join(_deploy_body())
    assert "--wait" in body, (
        "The swap is no longer health-gated. Without --wait a container that boots "
        "broken is reported as deployed and discovered later by a user."
    )
    assert "up --help" in body and "grep -q -- '--wait" in body, (
        "--wait is hard-coded without capability detection. It landed in compose "
        "v2.1.1 (--wait-timeout later); assuming it would make every deploy on an "
        "older host fail instantly. Probe `docker compose up --help` and degrade."
    )
