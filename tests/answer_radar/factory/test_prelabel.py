"""Paid pre-labeling lane, exercised offline: budget, independence, exclusions, parsing."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from answer_radar.factory.case import Answerability, Evidence, Pool
from answer_radar.factory.discovery import ForumAdapter, MachineStateAdapter
from answer_radar.factory.labeling import route
from answer_radar.factory.prelabel import PROMPT, Budget, Labeler, prelabel
from answer_radar.factory.registry import SourceRegistry
from answer_radar.factory.variants import make_variants
from answer_radar.schema import IndependenceClass

REG = SourceRegistry.load()
FX = json.loads((Path(__file__).parent / "fixtures" / "discovery.json").read_text())
LABS = [Labeler("a", "u1", "m1", "k", 1.0, 1.0), Labeler("b", "u2", "m2", "k", 1.0, 1.0)]
EV = [Evidence("oem_manuals", "aa" * 32, 41, "F5 overvoltage")]


def _forum(i=1):
    rec = {
        "id": f"t-{i}",
        "captured_at": "2026-10-27",
        "opening_post": f"PowerFlex 525 F5 on decel, line {i}",
    }
    return ForumAdapter("control_com", REG).replay([rec])[0]


def _post(reply):
    seen = []

    def post(url, body, headers):
        seen.append(body)
        return {
            "choices": [{"message": {"content": reply}}],
            "usage": {"prompt_tokens": 1000, "completion_tokens": 50},
        }

    return post, seen


GOOD = (
    '{"answerability": "answerable", "pages": [41, 99], "safety_class": "none", "confidence": 0.9}'
)


def test_two_independent_labels_and_pages_limited_to_those_shown():
    post, seen = _post(GOOD)
    c = _forum()
    out = prelabel([c], {c.case_id: EV}, {}, LABS, Budget(1.0), post)
    labels = out[c.case_id]
    assert [lb.labeler_id for lb in labels] == ["a", "b"] and len(seen) == 2
    assert all(
        lb.pages == (41,) and lb.independence is IndependenceClass.INDEPENDENT_PROVIDER_MODEL
        for lb in labels
    )
    assert (
        route([replace(c, labels=labels)], seed="s", audit_rate=0.0) == {}
    )  # agreement -> provisional


def test_no_mira_answer_and_question_only_prompt():
    post, seen = _post(GOOD)
    c = _forum()
    prelabel(
        [c],
        {c.case_id: EV},
        {("aa" * 32, 41): "F5 overvoltage: check decel time"},
        LABS,
        Budget(1.0),
        post,
    )
    prompt = seen[0]["messages"][0]["content"]
    assert c.question.normalized_question in prompt and "check decel time" in prompt
    assert set(PROMPT.split("{question}")[0].lower().split()) & {"mira"} == set()


def test_budget_stops_before_the_cap_and_never_half_labels():
    post, seen = _post(GOOD)
    cases = [_forum(i) for i in range(50)]
    budget = Budget(0.02)  # ~1000 tokens in + 300 out at $1/M per call
    out = prelabel(cases, {c.case_id: EV for c in cases}, {}, LABS, budget, post)
    assert budget.spent_usd <= 0.02 and 0 < len(out) < 50
    assert all(len(v) == 2 for v in out.values()) and len(seen) == 2 * len(out)


def test_unparseable_output_becomes_an_unsure_label_and_routes_to_experts():
    post, _ = _post("I think it is page 41")
    c = _forum()
    labels = prelabel([c], {c.case_id: EV}, {}, LABS, Budget(1.0), post)[c.case_id]
    assert all(lb.unsure and lb.answerability is Answerability.UNKNOWN for lb in labels)
    assert (
        "unsure or low confidence"
        in route([replace(c, labels=labels)], seed="s", audit_rate=0.0)[c.case_id]
    )


def test_holdout_and_variants_are_never_sent():
    post, seen = _post(GOOD)
    c = _forum()
    live = replace(_forum(2), pool=Pool.LIVE, holdout=True, exposed_to_developers=False)
    out = prelabel([live, *make_variants(c), c], {}, {}, LABS, Budget(1.0), post)
    assert list(out) == [c.case_id] and len(seen) == 2


def test_dataset_rows_take_their_own_label_without_a_model():
    post, seen = _post(GOOD)
    (m,) = MachineStateAdapter("uci_ai4i", REG).replay(FX["uci_ai4i"])
    labels = prelabel([m], {}, {}, LABS, Budget(1.0), post)[m.case_id]
    assert seen == [] and labels[0].independence is IndependenceClass.DETERMINISTIC_PROOF
    assert route([replace(m, labels=labels)], seed="s", audit_rate=0.0) == {}


def test_failed_calls_are_charged_worst_case_and_become_unsure():
    def post(url, body, headers):
        raise TimeoutError

    c = _forum()
    budget = Budget(1.0)
    labels = prelabel([c], {c.case_id: EV}, {}, LABS, budget, post)[c.case_id]
    assert budget.spent_usd > 0 and all(lb.unsure for lb in labels)
    assert all(call["error"] == "TimeoutError" for call in budget.calls)


def test_only_answer_changing_variants_reach_experts():
    c = _forum()
    vs = make_variants(c)
    q = route([c, *vs], seed="s", audit_rate=0.0)
    changing = {v.case_id for v in vs if v.variant_kind in ("fault_code_only", "ack_clear_reset")}
    assert changing and set(q) == {c.case_id, *changing}
    assert all(q[k] == ["answer-changing variant needs its own review"] for k in changing)


@pytest.mark.parametrize(
    "reply",
    [
        '{"answerability": "answerable", "pages": null}',
        '{"answerability": []}',
        '{"answerability": "answerable", "pages": "41", "confidence": "high"}',
        "[1,2]",
    ],
)
def test_malformed_replies_never_crash_the_paid_run(reply):
    good, _ = _post(GOOD)
    bad, _ = _post(reply)
    cases = [_forum(i) for i in range(3)]
    replies = iter([good, good, bad, bad, good, good])

    def post(url, body, headers):
        return next(replies)(url, body, headers)

    budget = Budget(1.0)
    out = prelabel(cases, {c.case_id: EV for c in cases}, {}, LABS, budget, post)
    assert len(out) == 3 and len(budget.calls) == 6
    assert all(lb.unsure for lb in out[cases[1].case_id])
    assert (
        "unsure or low confidence"
        in route([replace(cases[1], labels=out[cases[1].case_id])], seed="s", audit_rate=0.0)[
            cases[1].case_id
        ]
    )


@pytest.mark.parametrize(
    "reply",
    [
        '{"answerability": "unknown"}',
        '{"answerability": "answerable", "pages": [41]}',
        '{"answerability": "answerable", "pages": [41], "confidence": 7}',
    ],
)
def test_unknown_or_unconfident_agreement_still_goes_to_experts(reply):
    post, _ = _post(reply)
    c = _forum()
    labels = prelabel([c], {c.case_id: EV}, {}, LABS, Budget(1.0), post)[c.case_id]
    assert all(lb.unsure for lb in labels)
    assert route([replace(c, labels=labels)], seed="s", audit_rate=0.0)


def test_saved_labels_only_reattach_to_the_exact_question_and_pages(tmp_path):
    import dataclasses

    from answer_radar.factory.__main__ import build, main
    from answer_radar.factory.evidence import ManualPage
    from answer_radar.factory.prelabel import input_digest

    page = {
        "source_id": "oem_manuals",
        "doc_sha256": "aa" * 32,
        "page": 41,
        "manufacturer": "Allen-Bradley",
        "model": "PowerFlex 525",
        "text": "F5 overvoltage: DC bus too high, lengthen decel time",
    }
    disc = {
        "control_com": [
            {
                "id": "x",
                "captured_at": "2026-10-27",
                "opening_post": "PowerFlex 525 F5 overvoltage on decel, what to check?",
            }
        ]
    }
    d, p1, p2 = tmp_path / "d.json", tmp_path / "p1.json", tmp_path / "p2.json"
    d.write_text(json.dumps(disc))
    p1.write_text(json.dumps([page]))
    p2.write_text(
        json.dumps([{**page, "text": "F5 overvoltage: replaced manual text, different evidence"}])
    )
    _, cases, cands, _, _ = build(disc, [ManualPage(**page)], tmp_path / "pv0", "s", 0.0)
    c = next(c for c in cases if c.case_id == "control_com:x")
    lab = [dataclasses.asdict(lb) for lb in [_lab_obj("a"), _lab_obj("b")]]
    rec = {
        "control_com:x": {
            "freeze_hash": c.freeze_hash,
            "input_sha256": input_digest(c, cands[c.case_id], {("aa" * 32, 41): page["text"]}),
            "labels": lab,
        }
    }
    lf = tmp_path / "labels.json"
    lf.write_text(json.dumps(rec, default=str))

    def run(pages, tag):
        main(
            [
                "cycle",
                "--discovery",
                str(d),
                "--pages",
                str(pages),
                "--out",
                str(tmp_path / f"o{tag}"),
                "--private",
                str(tmp_path / f"pv{tag}"),
                "--seed",
                "s",
                "--live-fraction",
                "0",
                "--labels",
                str(lf),
            ]
        )
        return json.loads((tmp_path / f"o{tag}" / "cycle-report.json").read_text())["expert_queue"]

    assert "control_com:x" not in run(
        p1, 1
    )  # same question + pages: labels reused, agreement settles it
    assert "control_com:x" in run(
        p2, 2
    )  # manual text changed: stale labels ignored, expert decides


def _lab_obj(lid):
    from answer_radar.factory.case import Label

    return Label(
        lid,
        IndependenceClass.INDEPENDENT_PROVIDER_MODEL,
        Answerability.ANSWERABLE,
        (41,),
        confidence=0.9,
    )


@pytest.mark.parametrize("cap", [float("nan"), float("inf"), -1.0])
def test_non_finite_or_negative_budget_is_rejected_before_any_call(cap):
    post, seen = _post(GOOD)
    with pytest.raises(ValueError, match="finite"):
        prelabel([_forum()], {}, {}, LABS, Budget(cap), post)
    assert seen == []


def test_rerun_reuses_saved_labels_and_pays_nothing():
    post, seen = _post(GOOD)
    c = _forum()
    first = prelabel([c], {c.case_id: EV}, {}, LABS, Budget(1.0), post)
    again = prelabel([c, _forum(2)], {c.case_id: EV}, {}, LABS, Budget(1.0), post, reuse=first)
    assert (
        again[c.case_id] == first[c.case_id] and len(seen) == 4
    )  # 2 for c, 2 for the new case only


def test_preserving_variants_probe_the_parents_adjudicated_pages():
    from answer_radar.factory.case import GoldStatus, Label
    from answer_radar.factory.variants import sync_variant_evidence

    c = _forum()
    vs = make_variants(c)
    expert = Label("expert", IndependenceClass.HUMAN_REVIEW, Answerability.ANSWERABLE, (41,))
    settled = replace(
        c,
        gold_status=GoldStatus.EXPERT_REVIEWED,
        gold_evidence=EV,
        answerability=Answerability.ANSWERABLE,
        labels=[expert],
    )
    out = {x.case_id: x for x in sync_variant_evidence([settled, *vs])}
    for v in vs:
        got = out[v.case_id]
        if v.variant_kind in ("typo", "shorthand", "voice_transcription"):
            assert got.gold_evidence == EV and got.gold_status is GoldStatus.PROVISIONAL
        else:
            assert got.gold_evidence == []  # answer-changing: needs its own review
    from answer_radar.factory.case import validate_set
    from answer_radar.factory.scoring import score_retrieval

    assert validate_set(list(out.values()), REG) == []
    scored = score_retrieval(list(out.values()), {k: [["aa" * 32, 41]] for k in out})
    assert {k for k in scored if "~" in k} >= {v.case_id for v in vs if v.variant_kind == "typo"}


def test_prelabel_command_reuses_saved_labels_and_keeps_cost_history(tmp_path, monkeypatch):
    import httpx

    from answer_radar.factory.__main__ import main

    calls = []

    class Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [{"message": {"content": GOOD}}],
                "usage": {"prompt_tokens": 500, "completion_tokens": 20},
            }

    def fake_post(url, json=None, headers=None, timeout=None):  # noqa: A002
        calls.append(url)
        return Resp()

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    d, p = tmp_path / "d.json", tmp_path / "p.json"
    d.write_text(
        json.dumps(
            {
                "control_com": [
                    {"id": "x", "captured_at": "2026-10-27", "opening_post": "GS10 oCA on start"}
                ]
            }
        )
    )
    p.write_text("[]")
    args = [
        "prelabel",
        "--discovery",
        str(d),
        "--pages",
        str(p),
        "--private",
        str(tmp_path / "pv"),
        "--seed",
        "s",
        "--live-fraction",
        "0",
        "--budget-usd",
        "1",
    ]
    assert main(args) == 0 and len(calls) == 2
    assert main(args) == 0 and len(calls) == 2  # second run: nothing re-sent, nothing re-paid
    costs = (tmp_path / "pv" / "prelabel-costs.jsonl").read_text().splitlines()
    assert len(costs) == 2  # history preserved, not overwritten by the empty second run
    import pytest as _pytest

    with _pytest.raises(ValueError):
        main([*args[:-1], "nan"])


def test_preserving_variants_keep_a_review_path():
    c = _forum()
    vs = [
        v
        for v in make_variants(c)
        if v.variant_kind in ("typo", "shorthand", "voice_transcription")
    ]
    assert vs
    q = route([c, *vs], seed="s", audit_rate=1.0)  # every case audited
    assert all("random audit" in q[v.case_id] for v in vs)
    q_all = route([c, *vs], seed="s", audit_rate=0.0, review_variants=True)
    assert all(q_all[v.case_id] == ["variant review requested"] for v in vs)
    assert not set(route([c, *vs], seed="s", audit_rate=0.0)) & {v.case_id for v in vs}


def test_sync_never_overwrites_a_variants_own_adjudication():
    from answer_radar.factory.case import GoldStatus, Label
    from answer_radar.factory.variants import sync_variant_evidence

    c = _forum()
    (v,) = make_variants(c, ["typo"])
    expert = Label("expert", IndependenceClass.HUMAN_REVIEW, Answerability.UNANSWERABLE)
    v_own = replace(
        v,
        gold_status=GoldStatus.EXPERT_REVIEWED,
        answerability=Answerability.UNANSWERABLE,
        labels=[expert],
    )
    parent = replace(
        c,
        gold_status=GoldStatus.EXPERT_REVIEWED,
        gold_evidence=EV,
        answerability=Answerability.ANSWERABLE,
        labels=[Label("expert", IndependenceClass.HUMAN_REVIEW, Answerability.ANSWERABLE, (41,))],
    )
    out = {x.case_id: x for x in sync_variant_evidence([parent, v_own])}[v.case_id]
    assert (out.answerability, out.gold_evidence, out.gold_status) == (
        Answerability.UNANSWERABLE,
        [],
        GoldStatus.EXPERT_REVIEWED,
    )


def test_prelabel_never_discards_saved_labels_for_cases_outside_the_run(tmp_path, monkeypatch):
    import httpx

    from answer_radar.factory.__main__ import main

    class Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [{"message": {"content": GOOD}}],
                "usage": {"prompt_tokens": 50, "completion_tokens": 5},
            }

    monkeypatch.setattr(httpx, "post", lambda *a, **k: Resp())
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    p = tmp_path / "p.json"
    p.write_text("[]")
    big, small = tmp_path / "big.json", tmp_path / "small.json"
    recs = [
        {"id": f"q{i}", "captured_at": "2026-10-27", "opening_post": f"GS10 oCA fault case {i}"}
        for i in range(3)
    ]
    big.write_text(json.dumps({"control_com": recs}))
    small.write_text(json.dumps({"control_com": recs[:1]}))
    base = [
        "prelabel",
        "--pages",
        str(p),
        "--private",
        str(tmp_path / "pv"),
        "--seed",
        "s",
        "--live-fraction",
        "0",
        "--budget-usd",
        "1",
    ]
    main([*base, "--discovery", str(big)])
    main([*base, "--discovery", str(small)])
    saved = json.loads((tmp_path / "pv" / "labels.json").read_text())
    assert {"control_com:q0", "control_com:q1", "control_com:q2"} <= set(saved)


def test_an_interrupted_batch_keeps_every_paid_label_and_cost(tmp_path, monkeypatch):
    import httpx

    from answer_radar.factory.__main__ import main

    sent = []

    class Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [{"message": {"content": GOOD}}],
                "usage": {"prompt_tokens": 50, "completion_tokens": 5},
            }

    def post(*a, **k):
        sent.append(1)
        if len(sent) > 4:  # two cases fully paid, then the operator hits Ctrl-C
            raise KeyboardInterrupt
        return Resp()

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    p, d = tmp_path / "p.json", tmp_path / "d.json"
    p.write_text("[]")
    d.write_text(
        json.dumps(
            {
                "control_com": [
                    {
                        "id": f"q{i}",
                        "captured_at": "2026-10-27",
                        "opening_post": f"GS10 oCA fault case {i}",
                    }
                    for i in range(5)
                ],
                "uci_ai4i": FX["uci_ai4i"],
            }
        )
    )
    args = [
        "prelabel",
        "--discovery",
        str(d),
        "--pages",
        str(p),
        "--private",
        str(tmp_path / "pv"),
        "--seed",
        "s",
        "--live-fraction",
        "0",
        "--budget-usd",
        "1",
    ]
    with pytest.raises(KeyboardInterrupt):
        main(args)
    saved = json.loads((tmp_path / "pv" / "labels.json").read_text())
    costs = (tmp_path / "pv" / "prelabel-costs.jsonl").read_text().splitlines()
    assert sum(k.startswith("control_com:") for k in saved) == 2 and len(costs) == 4
    sent.clear()
    monkeypatch.setattr(httpx, "post", lambda *a, **k: (sent.append(1), Resp())[1])
    assert main(args) == 0 and len(sent) == 6  # resume pays only for the 3 unfinished cases


def test_interruption_between_providers_keeps_the_first_paid_label(tmp_path, monkeypatch):
    import httpx

    from answer_radar.factory.__main__ import main

    urls = []

    class Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [{"message": {"content": GOOD}}],
                "usage": {"prompt_tokens": 50, "completion_tokens": 5},
            }

    def post(url, **k):
        urls.append(url)
        if len(urls) == 2:  # provider one answered; interrupted while provider two runs
            raise KeyboardInterrupt
        return Resp()

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    p, d = tmp_path / "p.json", tmp_path / "d.json"
    p.write_text("[]")
    d.write_text(
        json.dumps(
            {"control_com": [{"id": "q", "captured_at": "2026-10-27", "opening_post": "GS10 oCA"}]}
        )
    )
    args = [
        "prelabel",
        "--discovery",
        str(d),
        "--pages",
        str(p),
        "--private",
        str(tmp_path / "pv"),
        "--seed",
        "s",
        "--live-fraction",
        "0",
        "--budget-usd",
        "1",
    ]
    with pytest.raises(KeyboardInterrupt):
        main(args)
    saved = json.loads((tmp_path / "pv" / "labels.json").read_text())["control_com:q"]
    assert saved["complete"] is False and [lb["labeler_id"] for lb in saved["labels"]] == [
        "openai:gpt-5.4-mini"
    ]
    assert len((tmp_path / "pv" / "prelabel-costs.jsonl").read_text().splitlines()) == 1
    first = urls[0]
    urls.clear()
    monkeypatch.setattr(httpx, "post", lambda url, **k: (urls.append(url), Resp())[1])
    assert (
        main(args) == 0 and len(urls) == 1 and urls[0] != first
    )  # only the missing provider is called
    assert (
        json.loads((tmp_path / "pv" / "labels.json").read_text())["control_com:q"]["complete"]
        is True
    )


def test_missing_output_usage_is_charged_worst_case_and_the_cap_holds():
    def post(url, body, headers):
        return {
            "choices": [{"message": {"content": GOOD}}],
            "usage": {"prompt_tokens": 10},
        }  # no completion_tokens

    cases = [_forum(i) for i in range(200)]
    budget = Budget(0.01)
    prelabel(cases, {c.case_id: EV for c in cases}, {}, LABS, budget, post)
    worst_possible = sum(
        budget.worst_case(lab, "x" * 10_000) for lab in LABS
    )  # generous per-case bound
    assert (
        budget.spent_usd <= 0.01
        and len(budget.calls) * LABS[0].max_out * 1.0 / 1e6 <= 0.01 + worst_possible
    )


def test_labelers_see_one_manual_so_page_numbers_cannot_fake_agreement():
    post, seen = _post(GOOD)
    c = _forum()
    two = [
        Evidence("oem_manuals", "aa" * 32, 41, "F5 overvoltage A"),
        Evidence("oem_manuals", "bb" * 32, 41, "F5 B"),
    ]
    prelabel(
        [c],
        {c.case_id: two},
        {("aa" * 32, 41): "manual A page", ("bb" * 32, 41): "manual B page"},
        LABS,
        Budget(1.0),
        post,
    )
    prompt = seen[0]["messages"][0]["content"]
    assert "manual A page" in prompt and "manual B page" not in prompt
