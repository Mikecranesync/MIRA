"""
Beta Readiness Gate Test
========================

This test MUST pass before any external beta tester is invited.
It proves the core flow: upload manual → ask question → get cited answer.

    "A maintenance person can upload their own equipment manual, ask a real
     troubleshooting question, and MIRA returns a grounded answer with citations
     from that uploaded manual — without Mike manually fixing anything."

Current status: EXPECTED TO FAIL (upload-to-retrieval gap not yet closed).
  * Hub/web uploads write the Open WebUI knowledge base.
  * Chat retrieval (`mira-bots/shared/neon_recall.recall_knowledge`) reads only
    `knowledge_entries`.
  * So an uploaded manual never becomes citable. Fix in flight: PR #1592.
  See docs/research/2026-06-07-upload-retrieval-gap-and-beta-path.md and
  docs/plans/2026-06-07-path-to-beta.md.

How to run it for real (the gate is environment-driven; NEVER point at prod):
    BETA_GATE_UPLOAD_URL=https://<dev-or-staging>/api/uploads/folder \
    BETA_GATE_CHAT_URL=https://<dev-or-staging>/api/.../chat \
    BETA_GATE_TENANT=<demo-tenant-uuid> \
    BETA_GATE_API_KEY=<token> \
    pytest tests/beta/beta_ready_upload_retrieval_citation.py -v

Without those env vars the gate is RED by definition (we cannot demonstrate
readiness) and records as the expected xfail. The day the gap closes AND the
env is provided, this passes — and `xfail(strict=True)` flips the suite RED,
which is the signal to remove the marker and declare the gate met.

This file deliberately shares its single real assertion with the Lane 2 test
(`test_upload_retrieval_citation.py`) via `tests/beta/_gate.py` — one gate,
two named entry points. This module is the canonical RELEASE GATE.
"""

from __future__ import annotations

import pytest

from ._gate import QUESTION, run_beta_gate


@pytest.mark.beta_gate
@pytest.mark.xfail(
    strict=True,
    reason=(
        "RELEASE GATE: upload→retrieval gap (PR #1592). A stranger's uploaded "
        "manual is not yet citable in chat. Flips RED (strict) the moment it "
        "passes — remove this marker and confirm beta readiness when it does."
    ),
)
def test_beta_ready_upload_retrieval_citation():
    """The one gate: upload a manual we've never seen, ask, get a cited answer."""
    result = run_beta_gate()
    assert result.cited, (
        f"BETA GATE NOT MET — asked {QUESTION!r}; the answer did not cite content "
        f"from the uploaded manual. {result.explain}"
    )
