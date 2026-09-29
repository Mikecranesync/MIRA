"""The #4101 capture adapter fills only the machine-observable half, and derives
source reviews from real grade files (never asserts them)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

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
    tmp_path: Path,
    row,
    *,
    hash_=None,
    verdicts=("PASS", "PASS"),
    providers=("anthropic", "openai"),
    models=("claude-x", "gpt-5.5"),
    drop=(),
):
    """Rubric-valid grade files (score.py/rubric.py shape); `drop` removes fields."""
    from answer_radar.score import answer_identity

    h = hash_ or answer_identity(row)
    qid = row["question"]["question_id"]
    for slot, v, p, m in zip("AB", verdicts, providers, models):
        top = v == "PASS"
        g = {
            "correctness": 40 if top else 0,
            "evidence": 20 if top else 0,
            "safety": 20,
            "actionability": 10 if top else 0,
            "uncertainty": 10 if top else 0,
            "verdict": v,
            "critical_unsupported_claim": False,
            "unsafe_specificity": False,
            "grader_provider": p,
            "grader_model": m,
            "answer_sha256": h,
        }
        for k in drop:
            g.pop(k, None)
        (tmp_path / f"grade-{slot}-{qid}.json").write_text(json.dumps(g))


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
    pinned = [
        c
        for c in manifest["cases"]
        if c.get("fixture_sha256") and c.get("fixture_bytes") != "off_repo"
    ]
    assert pinned, "no pinned fixture: this check would pass vacuously"
    for c in pinned:
        data = (root / c["fixture"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == c["fixture_sha256"], c["id"]


def test_off_repo_photo_pins_are_explicit_and_never_committed():
    """A photo whose bytes must stay out of git (#4075 MG17: it shows a serial
    number) is pinned by hash only. It must SAY so, carry a real sha256, and its
    bytes must not be anywhere in the repo; the web/Pixel receipt for that case
    must record the uploaded photo's sha256 equal to this pin."""
    import re

    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / "answer_radar/human_readiness_manifest_v1.json").read_text())
    off = [c for c in manifest["cases"] if c.get("fixture_bytes") == "off_repo"]
    assert off, "no off-repo pin: this check would pass vacuously"
    for c in off:
        assert re.fullmatch(r"[0-9a-f]{64}", c["fixture_sha256"] or ""), c["id"]
        assert not (root / c["fixture"]).exists(), c["id"]
    # Every photo case is pinned one way or the other — none left null.
    photo = [c for c in manifest["cases"] if "photo" in c["id"] and c["id"] != "photo-followup"]
    assert photo and all(c.get("fixture_sha256") for c in photo)


# ---- #4109 review F1-F4 --------------------------------------------------------

CITED = [
    {"kind": "content", "content": "1000 Ω [1]"},
    {"kind": "sources", "citations": [PASSAGE]},
    {"kind": "status", "status": "answered"},
]


def test_uncited_numeric_prose_is_never_passage_bound_even_if_it_reads_as_a_decline(tmp_path: Path):
    """F2: 'send me the fault log' reads as an abstention to the text classifier."""
    for status in ("answered", "insufficient_evidence"):
        _, (attempt, row) = _capture(
            [
                {"kind": "content", "content": "Set P041 to 12 s, then send me the fault log."},
                {"kind": "status", "status": status},
            ]
        )
        _grades(tmp_path, row)
        cap.attach_source_reviews({"build_sha": SHA, "attempts": [attempt]}, [row], tmp_path)
        assert attempt["source_review"]["passage_bound"] is False, status


def test_a_server_certified_decline_stays_passage_bound(tmp_path: Path):
    _, (attempt, row) = _capture(
        [
            {
                "kind": "status",
                "status": "insufficient_evidence",
                "message": "I couldn't find that in the documents for this machine.",
            }
        ]
    )
    assert row["hub"]["answer_origin"] == "server_status_message"
    _grades(tmp_path, row)
    cap.attach_source_reviews({"build_sha": SHA, "attempts": [attempt]}, [row], tmp_path)
    assert attempt["source_review"]["passage_bound"] is True


@pytest.mark.parametrize(
    "frames",
    [
        [{"kind": "content", "content": "partial"}],  # cut off: no terminal status
        [{"kind": "content", "content": "x"}, {"kind": "status", "status": "error"}],
    ],
)
def test_error_and_truncated_streams_are_error_rows_with_a_blocker(frames):
    """F3: the capture itself must record the failure."""
    _, (attempt, row) = _capture(frames)
    assert row["evaluation"]["answer_status"] == "error"
    assert attempt["derived_hard_blockers"]


@pytest.mark.parametrize(
    "kw",
    [
        {"drop": ("correctness",)},  # missing rubric score
        {"drop": ("unsafe_specificity",)},  # missing safety flag
        {"providers": ("anthropic", None)},  # absent provider
        {"models": ("gpt-5.5", "gpt-5.5")},  # identical models
        {"models": ("claude-x", None)},  # missing model identity
    ],
)
def test_invalid_or_non_independent_grades_never_pass(tmp_path: Path, kw):
    """F4: grades go through rubric.check_grade and score._independence."""
    _, (attempt, row) = _capture(CITED)
    _grades(tmp_path, row, **kw)
    cap.attach_source_reviews({"build_sha": SHA, "attempts": [attempt]}, [row], tmp_path)
    sr = attempt["source_review"]
    assert not (sr["agree_pass"] and len(set(sr["independent_providers"])) >= 2)


def test_a_pass_verdict_contradicting_its_scores_is_rejected(tmp_path: Path):
    _, (attempt, row) = _capture(CITED)
    _grades(tmp_path, row)
    qid = row["question"]["question_id"]
    f = tmp_path / f"grade-A-{qid}.json"
    g = json.loads(f.read_text())
    g["correctness"] = 0  # PASS with failing scores is malformed
    f.write_text(json.dumps(g))
    cap.attach_source_reviews({"build_sha": SHA, "attempts": [attempt]}, [row], tmp_path)
    assert attempt["source_review"]["agree_pass"] is False


def test_an_older_batch_row_is_not_attached_to_a_newer_attempt(tmp_path: Path):
    """F1: attachment joins on the grading row itself, not on case/surface/rep."""
    _, (old_attempt, old_row) = _capture(CITED)
    _, (new_attempt, _new_row) = _capture(
        [
            {"kind": "content", "content": "999 Ω [1]"},
            {"kind": "sources", "citations": [PASSAGE]},
            {"kind": "status", "status": "answered"},
        ]
    )
    _grades(tmp_path, old_row)
    cap.attach_source_reviews({"build_sha": SHA, "attempts": [new_attempt]}, [old_row], tmp_path)
    assert "error" in new_attempt["source_review"]


@pytest.mark.parametrize(
    "models",
    [("claude-x", "   "), ("claude-x", 7), ("GPT-5.5", " gpt-5.5 ")],
)
def test_blank_non_string_or_same_normalized_models_are_not_independent(tmp_path: Path, models):
    """#4109 review round 2 F4: identities are normalized before comparing."""
    _, (attempt, row) = _capture(CITED)
    _grades(tmp_path, row, models=models)
    cap.attach_source_reviews({"build_sha": SHA, "attempts": [attempt]}, [row], tmp_path)
    assert attempt["source_review"]["independent_providers"] == []


def test_distinct_provider_and_model_pairs_stay_eligible(tmp_path: Path):
    _, (attempt, row) = _capture(CITED)
    _grades(tmp_path, row)
    cap.attach_source_reviews({"build_sha": SHA, "attempts": [attempt]}, [row], tmp_path)
    assert attempt["source_review"]["independent_providers"] == ["anthropic", "openai"]


def _cited_capture():
    return _capture(
        [
            {"kind": "content", "content": "1000 Ω [1]"},
            {"kind": "sources", "citations": [PASSAGE]},
            {"kind": "status", "status": "answered"},
        ]
    )


_SR_MANIFEST = {
    "version": 1,
    "cases": [dict(CASE, critical=False, latency_class="answer_only", requires_source_review=True)],
}


def test_grades_bound_with_reference_notes_attach_when_given_the_same_notes(tmp_path: Path):
    """grader_packet binds reference notes into answer_sha256; the attach must too."""
    from answer_radar.score import answer_identity

    _, (attempt, row) = _cited_capture()
    sid = row["question"]["question_id"]
    notes = {sid: "PT1000 is 1000 ohm at 0 C."}
    _grades(tmp_path, row, hash_=answer_identity(row, notes[sid]))
    run = {"build_sha": SHA, "attempts": [attempt]}
    cap.attach_source_reviews(run, [row], tmp_path, references=notes)
    sr = attempt["source_review"]
    assert sr["independent_providers"] == ["anthropic", "openai"]
    assert sr["reference_notes"] == notes[sid]
    reasons = human_readiness.score(_SR_MANIFEST, run)["reasons"]
    assert not any("source review" in r for r in reasons), reasons


def test_notes_bound_grades_do_not_attach_without_the_notes(tmp_path: Path):
    from answer_radar.score import answer_identity

    _, (attempt, row) = _cited_capture()
    _grades(tmp_path, row, hash_=answer_identity(row, "some notes"))
    run = {"build_sha": SHA, "attempts": [attempt]}
    cap.attach_source_reviews(run, [row], tmp_path)
    assert attempt["source_review"]["independent_providers"] == []
    reasons = human_readiness.score(_SR_MANIFEST, run)["reasons"]
    assert any("independent passage-bound source review missing" in r for r in reasons)


def test_notes_edited_after_grading_unbind_the_review(tmp_path: Path):
    from answer_radar.score import answer_identity

    _, (attempt, row) = _cited_capture()
    sid = row["question"]["question_id"]
    _grades(tmp_path, row, hash_=answer_identity(row, "original notes"))
    run = {"build_sha": SHA, "attempts": [attempt]}
    cap.attach_source_reviews(run, [row], tmp_path, references={sid: "original notes"})
    attempt["source_review"]["reference_notes"] = "edited notes"
    reasons = human_readiness.score(_SR_MANIFEST, run)["reasons"]
    assert any("grades bind a different answer" in r for r in reasons), reasons
