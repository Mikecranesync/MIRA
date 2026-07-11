"""Tests for the drive-pack build-request drain worker (#2544).

These assert the policy layer WITHOUT a database or a real subprocess: the drain reuses the
existing ``update_candidate`` coordinator (already covered by its own tests + the
``assert_not_live_packs`` guard), so here we mock the runner and prove:
  - a request invokes ``update_candidate`` with the manual PDF + id and NO ``--out`` override
    (→ the coordinator writes to the entry's ``candidates/`` dir, never the live ``packs/`` tree);
  - return codes map to built/failed correctly;
  - missing provenance fails cleanly instead of running;
  - ``drain`` writes a result back for every request and never promotes.
"""

from __future__ import annotations

import drain_build_requests as drain_mod


def test_process_runs_update_candidate_with_manual_and_id():
    captured: list[list[str]] = []

    def fake_runner(argv: list[str]) -> int:
        captured.append(argv)
        return 0

    req = {
        "id": "row-1",
        "registry_manual_id": "rockwell_powerflex_525_520-um001",
        "local_pdf_path": "/opt/mira/manuals/Rockwell/PowerFlex 525/pf525.pdf",
    }
    result = drain_mod.process_build_request(req, runner=fake_runner)

    assert result["build_status"] == "built"
    assert len(captured) == 1
    argv = captured[0]
    assert "--manual" in argv and "/opt/mira/manuals/Rockwell/PowerFlex 525/pf525.pdf" in argv
    assert "--id" in argv and "rockwell_powerflex_525_520-um001" in argv
    # No --out override → update_candidate stages into the entry's candidates/ dir, guarded by
    # assert_not_live_packs. The worker can NEVER target the live served packs/ tree.
    assert "--out" not in argv


def test_process_maps_rejected_trust_status_to_built_for_review():
    # rc==1 = candidate generated but grader flagged rejected trust_status; the candidate WAS
    # still written, so it's a review item, not a build failure.
    result = drain_mod.process_build_request(
        {"id": "r", "registry_manual_id": "m", "local_pdf_path": "/p.pdf"},
        runner=lambda _argv: 1,
    )
    assert result["build_status"] == "built"
    assert "review" in result["build_reason"].lower()


def test_process_maps_refuse_or_error_to_failed():
    result = drain_mod.process_build_request(
        {"id": "r", "registry_manual_id": "m", "local_pdf_path": "/p.pdf"},
        runner=lambda _argv: 2,
    )
    assert result["build_status"] == "failed"
    assert "2" in result["build_reason"]


def test_process_fails_cleanly_without_running_when_pdf_missing():
    ran = []
    result = drain_mod.process_build_request(
        {"id": "r", "registry_manual_id": "m", "local_pdf_path": ""},
        runner=lambda argv: ran.append(argv) or 0,
    )
    assert result["build_status"] == "failed"
    assert "local_pdf_path" in result["build_reason"]
    assert ran == [], "must not invoke the extractor without a manual PDF"


def test_process_fails_cleanly_when_manual_id_missing():
    result = drain_mod.process_build_request(
        {"id": "r", "registry_manual_id": "", "local_pdf_path": "/p.pdf"},
        runner=lambda _argv: 0,
    )
    assert result["build_status"] == "failed"
    assert "registry_manual_id" in result["build_reason"]


def test_process_catches_runner_exception():
    def boom(_argv: list[str]) -> int:
        raise RuntimeError("generator blew up")

    result = drain_mod.process_build_request(
        {"id": "r", "registry_manual_id": "m", "local_pdf_path": "/p.pdf"},
        runner=boom,
    )
    assert result["build_status"] == "failed"
    assert "generator blew up" in result["build_reason"]


def test_drain_processes_all_and_writes_results_back():
    requests = [
        {"id": "row-1", "registry_manual_id": "m1", "local_pdf_path": "/a.pdf"},
        {"id": "row-2", "registry_manual_id": "m2", "local_pdf_path": ""},  # → failed
    ]
    saved: dict[str, dict] = {}

    outcomes = drain_mod.drain(
        load_requests=lambda: requests,
        save_result=lambda row_id, result: saved.__setitem__(row_id, result),
        runner=lambda _argv: 0,
    )

    assert {row_id for row_id, _ in outcomes} == {"row-1", "row-2"}
    assert saved["row-1"]["build_status"] == "built"
    assert saved["row-2"]["build_status"] == "failed"
    # Every saved result flips build_status OFF 'requested' so a row is drained at most once,
    # and carries a completion timestamp.
    for result in saved.values():
        assert result["build_status"] != "requested"
        assert result["build_completed_at"]
