"""The #4101 capture adapter fills only the machine-observable half, and derives
source reviews from real grade files (never asserts them)."""

from __future__ import annotations

import json
from pathlib import Path

from answer_radar import human_readiness, human_readiness_capture as cap
from answer_radar.hub_runner import _readable_frame

SHA = "ae03a3877912"
PASSAGE = {
    "citationId": "1",
    "sourceTitle": "IEC 60751 note",
    "page": 3,
    "quote": "Pt1000: 1000 Ω at 0 °C",
}


def _sse(*frames: dict) -> bytes:
    return b"".join(b"data: " + json.dumps(f).encode() + b"\n\n" for f in frames)


class FakeHub:
    def __init__(self, stream_frames, packet, first_ms=800, total_ms=2400):
        self.frames, self.packet, self.first_ms, self.total_ms = (
            stream_frames,
            packet,
            first_ms,
            total_ms,
        )
        self.calls: list[str] = []

    def json(self, method, path):
        self.calls.append(path)
        return 200, {}, {"gitSha": SHA + "0" * 28}

    def create_notebook(self, name):
        self.calls.append(f"create:{name}")
        return {"id": "nb-1"}

    def stream(self, method, path, body=None, headers=None):
        return 200, {"x-mira-trace-id": "t" * 32}, _sse(*self.frames), self.first_ms, self.total_ms

    def diagnostics(self, nb, trace):
        return {"turnId": "turn-1", "packet": self.packet}


PACKET = {
    "retrieval": {"strategy": "skipped_general_mode", "executed": False, "candidate_count": None},
    "answer_gate": {"decision": "answered", "reason": "served", "gate_match": None},
    "identity": {"state": "unknown"},
    "jev_decision": {
        "signals": {
            "over_specificity": 0.4,
            "wrong_family_grounding": 0.03,
            "contradicts_observations": 0.1,
            "unsupported_numerics": 0.05,
            "follows_evidence": 0.2,
        },
        "failure_class": "none",
        "latency_ms": 124,
        "input_tokens": 934,
        "model": "jev-1.13.0",
        "question_set_version": "decision-fabric-v1",
        "skipped_reason": None,
    },
}
CASE = {
    "id": "rtd-definition",
    "question": "What nominal resistance is a PT1000 at 0 C?",
    "surfaces": ["hub"],
    "repeats": 1,
}


def _capture(frames, packet=PACKET):
    hub = FakeHub(frames, packet)
    return hub, cap.ask_hub_case(hub, CASE, 0, SHA)


def test_machine_half_is_filled_and_human_half_left_empty():
    hub, (attempt, row) = _capture(
        [
            {"kind": "content", "content": "A PT1000 is 1000 Ω at 0 °C [1]."},
            {"kind": "sources", "citations": [PASSAGE]},
            {"kind": "status", "status": "answered"},
        ]
    )
    assert "create:General" in hub.calls  # the product's own blank-chat notebook
    assert (attempt["build_sha"], attempt["trace_id"], attempt["turn_id"]) == (
        SHA,
        "t" * 32,
        "turn-1",
    )
    assert attempt["latency_ms"] == {"first_meaningful": 800, "total": 2400}
    assert attempt["cited_passages"][0]["quote"] == "Pt1000: 1000 Ω at 0 °C"
    assert attempt["jev"]["signals"] == {
        k: PACKET["jev_decision"]["signals"][k] for k in cap.JEV_SIGNALS
    }
    # nothing a person must judge is filled in
    assert (
        attempt["scores"] == {}
        and attempt["human_review"] == {}
        and attempt["hard_blockers"] is None
    )
    assert row["evaluation"]["cited_passages"] == attempt["cited_passages"]


def test_an_unreviewed_capture_holds():
    """The scorer must HOLD a machine-only capture: no human half, no grades."""
    _, (attempt, _) = _capture(
        [{"kind": "content", "content": "x"}, {"kind": "status", "status": "answered"}]
    )
    manifest = {
        "version": 1,
        "cases": [
            dict(CASE, critical=False, latency_class="answer_only", requires_source_review=True)
        ],
    }
    card = human_readiness.score(manifest, {"build_sha": SHA, "attempts": [attempt]})
    assert card["decision"] == "HOLD"
    assert any("human review not signed" in r for r in card["reasons"])


def test_a_jev_skip_is_recorded_as_a_skip():
    _, (attempt, _) = _capture(
        [{"kind": "content", "content": "x"}],
        packet={**PACKET, "jev_decision": {"skipped_reason": "no_evidence"}},
    )
    assert attempt["jev"] == {"skipped_reason": "no_evidence"}


def test_a_failed_turn_is_a_derived_blocker():
    _, (attempt, _) = _capture([{"kind": "status", "status": "error"}])
    assert attempt["derived_hard_blockers"]


def _grades(
    tmp_path: Path, row, *, hash_=None, verdicts=("PASS", "PASS"), providers=("anthropic", "openai")
):
    from answer_radar.score import answer_identity

    h = hash_ or answer_identity(row)
    qid = row["question"]["question_id"]
    for slot, v, p in zip("AB", verdicts, providers):
        (tmp_path / f"grade-{slot}-{qid}.json").write_text(
            json.dumps({"verdict": v, "grader_provider": p, "answer_sha256": h})
        )


def test_source_review_is_derived_from_grade_files(tmp_path: Path):
    _, (attempt, row) = _capture(
        [
            {"kind": "content", "content": "1000 Ω [1]"},
            {"kind": "sources", "citations": [PASSAGE]},
            {"kind": "status", "status": "answered"},
        ]
    )
    _grades(tmp_path, row)
    run = {"build_sha": SHA, "attempts": [attempt]}
    cap.attach_source_reviews(run, [row], tmp_path)
    sr = attempt["source_review"]
    assert sr["passage_bound"] is True and sr["agree_pass"] is True
    assert sr["grade_answer_hashes"] == [sr["answer_sha256"]] * 2
    assert sr["independent_providers"] == ["anthropic", "openai"]


def test_a_grade_for_a_different_answer_is_not_bound(tmp_path: Path):
    _, (attempt, row) = _capture(
        [
            {"kind": "content", "content": "1000 Ω [1]"},
            {"kind": "sources", "citations": [PASSAGE]},
            {"kind": "status", "status": "answered"},
        ]
    )
    _grades(tmp_path, row, hash_="f" * 64)
    run = {"build_sha": SHA, "attempts": [attempt]}
    cap.attach_source_reviews(run, [row], tmp_path)
    manifest = {
        "version": 1,
        "cases": [
            dict(CASE, critical=False, latency_class="answer_only", requires_source_review=True)
        ],
    }
    reasons = human_readiness.score(manifest, run)["reasons"]
    assert any("independent passage-bound source review missing" in r for r in reasons)


def test_an_uncited_answer_is_not_passage_bound(tmp_path: Path):
    _, (attempt, row) = _capture(
        [{"kind": "content", "content": "1000 ohms."}, {"kind": "status", "status": "answered"}]
    )
    _grades(tmp_path, row)
    run = {"build_sha": SHA, "attempts": [attempt]}
    cap.attach_source_reviews(run, [row], tmp_path)
    assert attempt["source_review"]["passage_bound"] is False


def test_readable_frame_detection():
    assert _readable_frame(b'data: {"kind":"content","content":"hi"}\n')
    assert _readable_frame(
        b'data: {"kind":"status","status":"insufficient_evidence","message":"I could not"}\n'
    )
    assert not _readable_frame(b'data: {"kind":"trace","traceId":"x"}\n')
    assert not _readable_frame(b'data: {"kind":"content","content":""}\n')


def test_pinned_photo_fixtures_match_their_committed_bytes():
    """A pinned fixture hash is only proof if the committed bytes still hash to it."""
    import hashlib

    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / "answer_radar/human_readiness_manifest_v1.json").read_text())
    pinned = [c for c in manifest["cases"] if c.get("fixture_sha256")]
    assert pinned, "no pinned fixture: this check would pass vacuously"
    for c in pinned:
        data = (root / c["fixture"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == c["fixture_sha256"], c["id"]
