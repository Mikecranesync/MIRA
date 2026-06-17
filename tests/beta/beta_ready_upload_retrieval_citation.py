"""
Beta Readiness Gate Test
========================

This test MUST pass before any external beta tester is invited.
It proves the core flow: upload manual → ask question → get cited answer.

    "A maintenance person can upload their own equipment manual, ask a real
     troubleshooting question, and MIRA returns a grounded answer with citations
     from that uploaded manual — without Mike manually fixing anything."

Current status: MET (2026-06-17). The upload→retrieval gap closed (PR #1592 +
follow-ups), and the gate ran GREEN end-to-end over HTTP — a stranger uploaded a
manual through the real Hub NodeChat `/files/` door and got a cited answer. The
old `xfail(strict)` marker is removed; this is now a real assertion enforced by
`.github/workflows/beta-gate.yml`, which builds a Hub on dev Neon, provisions a
stranger run, and runs this file. See docs/plans/2026-06-07-path-to-beta.md.

How to run it for real (the gate is environment-driven; NEVER point at prod —
use the folder=brain Hub NodeChat doors, not /api/uploads/folder which only
writes the Open WebUI KB and can never cite):
    BETA_GATE_UPLOAD_URL=http://<dev-hub>/api/namespace/node/<id>/files/ \
    BETA_GATE_CHAT_URL=http://<dev-hub>/api/namespace/node/<id>/chat/ \
    BETA_GATE_TENANT=<tenant-uuid> \
    BETA_GATE_COOKIE='next-auth.session-token=<jwe>' \
    pytest tests/beta/beta_ready_upload_retrieval_citation.py -v
Provision all of that against a locally-built Hub with
`mira-hub/scripts/provision-beta-gate.ts` (its header has the full recipe).

Without those env vars the gate SKIPS (a release gate must not go red just
because no one stood up a Hub); with them it asserts for real. This file shares
its single real assertion with the Lane 2 test
(`test_upload_retrieval_citation.py`) via `tests/beta/_gate.py` — one gate, two
named entry points. This module is the canonical RELEASE GATE.
"""

from __future__ import annotations

import pytest

from ._gate import QUESTION, GateUnavailable, run_beta_gate


@pytest.mark.beta_gate
def test_beta_ready_upload_retrieval_citation():
    """The one gate: upload a manual we've never seen, ask, get a cited answer.

    Marker history: this was ``xfail(strict)`` while the upload→retrieval gap was
    open. The gap closed (PR #1592 + follow-ups) and the gate ran **green**
    end-to-end on 2026-06-17 (see ``docs/plans/2026-06-07-path-to-beta.md``), so
    the xfail is removed and this is now a **real assertion** wired into CI
    (``.github/workflows/beta-gate.yml`` provisions a live Hub on dev Neon and
    sets ``BETA_GATE_*``). When the integration env is NOT provisioned (a plain
    local ``pytest``), the gate SKIPS rather than fails — a release gate must not
    go red merely because no one stood up a Hub. With the env present it asserts
    for real: a stranger's uploaded manual must come back as a cited answer.
    """
    try:
        result = run_beta_gate()
    except GateUnavailable as exc:
        pytest.skip(str(exc))
    assert result.cited, (
        f"BETA GATE NOT MET — asked {QUESTION!r}; the answer did not cite content "
        f"from the uploaded manual. {result.explain}"
    )
