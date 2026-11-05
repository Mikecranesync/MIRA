"""The atlas-api-errors probe publishes to PUBLIC Actions logs (#5205, #5211).

These tests run the exact filter text from .github/workflows/prod-log-probe.yml
(between the BEGIN/END atlas-exception-filter markers), followed by the
workflow's own downstream redaction chain, against sample Atlas log lines.
Only exception class names from anchored header lines and com.grash frame
locations may survive; nothing from message text may.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORKFLOW = REPO / ".github" / "workflows" / "prod-log-probe.yml"


def _filter_command() -> str:
    text = WORKFLOW.read_text()
    block = re.search(
        r"# BEGIN atlas-exception-filter\n(.*?)\n\s*# END atlas-exception-filter",
        text,
        re.S,
    )
    assert block, "filter markers missing from the workflow"
    m = re.search(r'printf \'%s\\n\' "\$all" \| (.*) \|\| true\)"', block.group(1))
    assert m, "filter pipeline not found between the markers"
    return m.group(1)


def _redaction_chain() -> str:
    text = WORKFLOW.read_text()
    start = text.index("sed -E 's/(password|")
    end = text.index("{32,}/[redacted]/g'", start) + len("{32,}/[redacted]/g'")
    chain = text[start:end]
    # The workflow reads the probe's raw file; here the chain reads stdin.
    return chain.replace(' "$RUNNER_TEMP/probe.raw"', "")


def _run(log: str) -> str:
    cmd = f"{_filter_command()} | {_redaction_chain()}"
    out = subprocess.run(
        ["bash", "-c", cmd],
        input=log,
        capture_output=True,
        text=True,
        cwd=REPO,
        check=True,
    )
    return out.stdout


LOG = """\
2026-11-05 ERROR [dispatcherServlet] Servlet.service() threw exception [Request processing failed: org.springframework.dao.InvalidDataAccessApiUsageException: Work order "Replace belt for jane.doe@example.com" not found] with root cause
org.hibernate.QueryException: Invalid value john.smithException@example.com password=private.FactoryError
\tat org.hibernate.query.sqm.SqmPathSource.getSubPathSource(SqmPathSource.java:95)
\tat com.grash.service.WorkOrderService.findBySearchCriteria(WorkOrderService.java:412)
\tat com.grash.controller.WorkOrderController.search(WorkOrderController.java:88)
Caused by: java.lang.NullPointerException: user 'Bob Smith' com.acme.LeakyException is null
\tat com.grash.service.WorkOrderService.findBySearchCriteria(WorkOrderService.java:412)
"""


def test_keeps_header_classes_and_atlas_frames():
    out = _run(LOG)
    assert "org.hibernate.QueryException" in out
    assert "java.lang.NullPointerException" in out
    assert (
        "at com.grash.service.WorkOrderService.findBySearchCriteria(WorkOrderService.java:412)"
        in out
    )
    assert (
        "at com.grash.controller.WorkOrderController.search(WorkOrderController.java:88)"
        in out
    )


def test_no_message_text_survives():
    out = _run(LOG)
    for leaked in (
        "smithException",
        "john",
        "FactoryError",
        "private",
        "jane",
        "example",
        "Bob",
        "LeakyException",
        "Replace belt",
        "InvalidDataAccessApiUsageException",
        "SqmPathSource",
    ):
        assert leaked not in out, f"{leaked!r} leaked into public output:\n{out}"


def test_line_starting_with_class_shaped_message_text_outside_known_roots_is_dropped():
    assert _run("john.smithException: hello\nacme.SecretError\n").strip() == ""


def test_frame_line_with_trailing_text_is_dropped():
    assert _run("\tat com.grash.X.y(X.java:1) jane.doe@example.com\n").strip() == ""
