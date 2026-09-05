"""Beta Readiness Gate — production-equivalent notebook lane (Workstream B).

The legacy gate (`beta_ready_upload_retrieval_citation.py`) proves the
NodeChat `/files/` door with the shared GS10 fixture. THIS gate proves the
behaviour production actually depends on, under the production flag
(`MIRA_ENFORCE_APPROVED_RETRIEVAL=true`):

  a run-unique document with a run-unique sentinel refuses before upload,
  becomes answerable ONLY after real readiness + confirmation through the
  notebook product contract, cites the exact document/page, records provider
  usage, cites no other tenant, and an unsupported question refuses without
  a provider call.

Skips when `BETA_PROBE_*` is unset (plain local pytest). CI provisions it:
`.github/workflows/beta-gate.yml` → job `notebook-gate`.
"""

from __future__ import annotations

import json

import pytest

from ._notebook_probe import ProbeUnavailable, load_probe_config, run_notebook_probe


@pytest.mark.beta_gate
def test_beta_ready_notebook_confirmed_source():
    try:
        cfg = load_probe_config()
    except ProbeUnavailable as exc:
        pytest.skip(str(exc))
    report = run_notebook_probe(cfg)
    print(json.dumps(report.to_dict(), indent=2))
    assert report.ok, "BETA GATE (notebook lane) NOT MET:\n  - " + "\n  - ".join(report.failures)
