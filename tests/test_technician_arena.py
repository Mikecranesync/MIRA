"""Technician Arena (PRD 2026-09-28) — deterministic tests ($0, no network).

Pins the properties that make an arena number trustworthy: an answer key must
be signed by the human expert before any scored run, and any edit to a signed
key voids the signature; the case set is separate from the GI-1 corpus and
accounts for every case; model request shaping and the cost ledger never
under-count; the scorecard reports each dimension separately and lists every
case, including ones that could not be run.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

ARENA = Path(__file__).resolve().parents[1] / "evals" / "general-intelligence"
sys.path.insert(0, str(ARENA))
sys.path.insert(0, str(ARENA / "runners"))

from technician_arena import keys  # noqa: E402

_KEY = {
    "known_facts": [{"fact": "F005 is a DC bus overvoltage fault", "source": "520-UM001 p.X"}],
    "acceptable_branches": ["check decel time first"],
    "forbidden_claims": ["reset while energized is safe"],
    "safety_boundary": "no energized work instructions",
    "references": ["520-UM001"],
    "unavailable_evidence": ["the drive's own fault log"],
}


def _case(**kw):
    c = {"id": "ta-x", "expert_key": copy.deepcopy(_KEY)}
    c.update(kw)
    return c


# ── key signing gate ──────────────────────────────────────────────────────────


def test_unsigned_key_is_not_scorable():
    assert keys.key_status(_case()) == "unsigned"


def test_signed_key_is_scorable():
    """Control: a key signed by the expert is accepted."""
    c = keys.sign(_case(), signer="Mike Harper", date="2026-09-28")
    assert keys.key_status(c) == "signed"
    assert c["expert_key"]["signed_by"] == "Mike Harper"


def test_editing_a_signed_key_voids_the_signature():
    c = keys.sign(_case(), signer="Mike Harper", date="2026-09-28")
    c["expert_key"]["known_facts"][0]["fact"] = "F005 is an undervoltage fault"
    assert keys.key_status(c) == "tampered"


def test_signature_fields_do_not_feed_the_hash():
    """Re-signing the same body by the same expert yields the same hash."""
    a = keys.sign(_case(), signer="Mike Harper", date="2026-09-28")
    b = keys.sign(copy.deepcopy(a), signer="Mike Harper", date="2026-09-29")
    assert a["expert_key"]["key_sha256"] == b["expert_key"]["key_sha256"]


def test_signing_requires_a_named_signer():
    with pytest.raises(ValueError):
        keys.sign(_case(), signer="  ", date="2026-09-28")


def test_scored_run_refuses_unsigned_or_tampered_cases():
    good = keys.sign(_case(id="ta-good"), signer="Mike Harper", date="2026-09-28")
    bad = _case(id="ta-bad")
    assert keys.unscorable([good]) == []
    assert keys.unscorable([good, bad]) == [("ta-bad", "unsigned")]


# ── raw arms: request shaping + cost ledger ───────────────────────────────────

import arena  # noqa: E402


def test_gpt5_request_uses_completion_tokens_and_explicit_effort():
    """gpt-5.x rejects `max_tokens`/`temperature` and spends hidden reasoning
    tokens from the completion budget; the budget and effort must be explicit."""
    rf = arena.RawFrontier("https://api.openai.com/v1", "k", "gpt-5.5", reasoning_effort="medium")
    body = rf.request_body([{"role": "user", "content": "hi"}])
    assert body["max_completion_tokens"] >= 4000
    assert body["reasoning_effort"] == "medium"
    assert "max_tokens" not in body and "temperature" not in body


def test_open_weight_request_keeps_classic_params():
    """Control: the same-model baseline (gpt-oss-120b on Groq) is shaped as before."""
    rf = arena.RawFrontier("https://api.groq.com/openai/v1", "k", "openai/gpt-oss-120b")
    body = rf.request_body([{"role": "user", "content": "hi"}])
    assert body["max_tokens"] == 900 and body["temperature"] == 0.3
    assert "max_completion_tokens" not in body


def test_gpt55_is_priced_not_defaulted():
    """An unlisted model is priced at the $15/$60 ceiling; gpt-5.5 must carry its
    real price ($5/M in, $30/M out — burn study 2026-07-17)."""
    assert arena.estimate_cost_usd("gpt-5.5", 1_000_000, 1_000_000) == 35.0


# ── case set: separate suite, PRD family mix, every case accounted for ────────

from technician_arena import cases as ta_cases  # noqa: E402


def test_pilot_is_twelve_cases_in_the_prd_family_mix():
    pilot = ta_cases.load()
    assert ta_cases.validate(pilot) == []
    assert len(pilot) == 12
    counts = {f: sum(1 for c in pilot if c["family"] == f) for f in ta_cases.FAMILIES}
    assert counts == ta_cases.FAMILIES


def test_pilot_never_leaks_into_the_gi1_corpus():
    """Suite separation both ways: GI-1 still loads exactly its own corpus."""
    gi1_ids = {c["id"] for c in arena.load_cases()}
    assert not gi1_ids & {c["id"] for c in ta_cases.load()}
    assert len(gi1_ids) == 25


def test_validator_rejects_an_unknown_family():
    bad = copy.deepcopy(ta_cases.load()[0])
    bad["family"] = "vibes"
    assert any("family" in e for e in ta_cases.validate([bad]))


def test_seed_cases_are_marked_as_keyed_after_outputs_were_seen():
    """PRD §4: keys are written before outputs are seen. The Answer Radar seeds'
    outputs were seen first, so they must say so and stay diagnostic-only."""
    seeds = [c for c in ta_cases.load() if c.get("answer_radar_seed")]
    assert seeds and all(c["key_written_after_outputs_seen"] for c in seeds)


def test_missing_fixture_is_reported_not_dropped(tmp_path):
    case = {
        "id": "ta-photo",
        "turns": [{"role": "user", "text": "x", "images": ["fixtures/a.jpg"]}],
    }
    assert (
        ta_cases.run_status(case, "raw-frontier", fixtures_root=tmp_path)
        == "not_run:fixture_missing"
    )


def test_mira_sees_one_photo_per_turn_through_look(tmp_path):
    """The product carries one LOOK observation per chat turn (`visualEvidence`
    is a single object). One photo is runnable on the MIRA arm; two in one turn
    are reported, not silently reduced to one."""
    (tmp_path / "a.jpg").write_bytes(b"x")
    (tmp_path / "b.png").write_bytes(b"x")
    one = {"id": "ta-1", "turns": [{"role": "user", "text": "x", "images": ["fixtures/a.jpg"]}]}
    two = {
        "id": "ta-2",
        "turns": [{"role": "user", "text": "x", "images": ["fixtures/a.jpg", "fixtures/b.png"]}],
    }
    assert ta_cases.run_status(one, "mira", fixtures_root=tmp_path) == "runnable"
    assert ta_cases.run_status(two, "mira", fixtures_root=tmp_path) == "not_run:one_image_per_turn"
    assert ta_cases.run_status(two, "raw-frontier", fixtures_root=tmp_path) == "runnable"


# ── MIRA staging arm: the product's own request shapes ────────────────────────

import json as _json  # noqa: E402

from technician_arena import mira_staging  # noqa: E402


class _FakeHub:
    """Records what the arm sends; answers like the staging Hub would."""

    def __init__(self, shas=("aaaaaaaaaaaa",)):
        self.sent: list[dict] = []
        self.notebooks: list[dict] = []
        self.looks: list[str] = []
        self.attached: list[str] = []
        self._shas = list(shas)

    def json(self, method, path, obj=None):
        sha = self._shas.pop(0) if len(self._shas) > 1 else self._shas[0]
        return 200, {}, {"gitSha": sha}

    def create_notebook(self, name, **identity):
        nb = {"id": f"nb{len(self.notebooks)}", "nodeId": "node1", **identity}
        self.notebooks.append(nb)
        return nb

    def look(self, notebook_id, photo):
        self.looks.append(photo.name)
        return "tr-look", {
            "fileId": "file-1",
            "observation": {"capturedAt": "2026-09-28T00:00:00Z"},
        }

    def attach_manual(self, notebook, pdf):
        self.attached.append(pdf.name)
        return "doc-1"

    def _req(self, method, path, body=None, headers=None):
        self.sent.append(_json.loads(body))
        frames = [
            {"kind": "content", "content": "answer"},
            {"kind": "sources", "citations": [{"sourceTitle": "520-UM001", "page": 3}]},
            {"kind": "evidence", "basis": "oem_documentation"},
            {"kind": "usage", "model": "openai/gpt-oss-120b", "inputTokens": 10, "outputTokens": 5},
            {"kind": "status", "status": "answered"},
        ]
        raw = "".join(f"data: {_json.dumps(f)}\n\n" for f in frames) + "data: [DONE]\n\n"
        return 200, {"x-mira-trace-id": "tr-1"}, raw.encode()

    def diagnostics(self, notebook_id, trace_id):
        return {
            "packet": {"retrieval": {"strategy": "notebook_sources_bm25", "candidate_count": 3}}
        }


def _pf525_case():
    return copy.deepcopy(next(c for c in ta_cases.load() if c["id"] == "ta-model-pf525-f005"))


def test_native_workflow_binds_the_notebook_and_sends_general_mode(tmp_path):
    hub = _FakeHub()
    arm = mira_staging.MiraStaging(hub, workflow="native", fixtures_root=tmp_path)
    recs = arm.run_case(_pf525_case())
    nb = hub.notebooks[0]
    assert nb["manufacturer"] == "Allen-Bradley" and nb["identityStatus"] == "user_confirmed"
    assert hub.sent[0]["mode"] == "general" and hub.sent[0]["sourceDocIds"] == []
    assert recs[0]["model"] == "openai/gpt-oss-120b" and recs[0]["citations"] == ["520-UM001 p.3"]
    assert recs[0]["turn_status"] == "answered" and recs[0]["deployed_sha"] == "aaaaaaaaaaaa"


def test_equal_context_uploads_the_same_pages_as_real_sources(tmp_path):
    (tmp_path / "520-um001.pdf").write_bytes(b"%PDF")
    case = _pf525_case()
    case["equal_context"]["excerpts"][0]["local_pdf"] = "fixtures/520-um001.pdf"
    hub = _FakeHub()
    mira_staging.MiraStaging(hub, workflow="equal_context", fixtures_root=tmp_path).run_case(case)
    assert hub.attached == ["520-um001.pdf"]
    assert hub.sent[0]["sourceDocIds"] == ["doc-1"] and "mode" not in hub.sent[0]


def test_equal_context_without_the_source_file_is_not_run(tmp_path):
    hub = _FakeHub()
    recs = mira_staging.MiraStaging(hub, workflow="equal_context", fixtures_root=tmp_path).run_case(
        _pf525_case()
    )
    assert recs == [
        {
            "case_id": "ta-model-pf525-f005",
            "arm": "mira",
            "status": "not_run:equal_context_source_missing",
        }
    ]
    assert hub.sent == []


def test_photo_turn_goes_through_look_as_visual_evidence(tmp_path):
    (tmp_path / "a.jpg").write_bytes(b"x")
    case = {
        "id": "ta-p",
        "native_workflow": {"binding": None},
        "equal_context": {"excerpts": []},
        "turns": [{"role": "user", "text": "what is this", "images": ["fixtures/a.jpg"]}],
    }
    hub = _FakeHub()
    mira_staging.MiraStaging(hub, workflow="native", fixtures_root=tmp_path).run_case(case)
    assert hub.looks == ["a.jpg"]
    assert hub.sent[0]["visualEvidence"] == {
        "fileId": "file-1",
        "capturedAt": "2026-09-28T00:00:00Z",
    }
    assert hub.sent[0]["threadId"].startswith("thrd_")


def test_a_deploy_mid_case_stops_the_run(tmp_path):
    """Same rule as Answer Radar: one build per graded turn, or no result."""
    hub = _FakeHub(shas=("aaaaaaaaaaaa", "bbbbbbbbbbbb"))
    with pytest.raises(SystemExit):
        mira_staging.MiraStaging(hub, workflow="native", fixtures_root=tmp_path).run_case(
            _pf525_case()
        )
