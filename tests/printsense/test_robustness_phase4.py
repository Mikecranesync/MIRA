"""Phase-4 robustness units: transforms, metamorphic grader, frozen contract."""

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mira-bots"))

from printsense.benchmarks import robustness_grader as rg  # noqa: E402
from printsense.benchmarks import robustness_transforms as rt  # noqa: E402
from printsense.benchmarks import session_cases as sc  # noqa: E402


def test_contract_frozen():
    committed = (REPO / "printsense/benchmarks/robustness_cases.sha256").read_text().strip()
    assert committed == rg.robustness_digest(), (
        "phase-4 robustness contract edited without refreezing — two-file diff only"
    )


def test_transform_families_disjoint_and_complete():
    rot, qual = set(rt.ROTATION_TRANSFORMS), set(rt.QUALITY_TRANSFORMS)
    assert not (rot & qual)
    assert set(rg.CONDITIONS) == rot | qual
    assert len(rg.CONDITIONS) == 16


def test_all_transforms_deterministic_on_corpus_page():
    base = sc.render_page_png("crop91")
    for name, fn in rt.ALL_TRANSFORMS.items():
        assert fn(base) == fn(base), f"{name} not deterministic"
        assert len(fn(base)) > 500, f"{name} produced a degenerate image"


def test_verdict_full_when_parent_expectations_hold():
    reply = rg.parent_case()["scripted"]["reply"]
    r = rg.grade_answer_lane("blur", True, reply)
    assert r["verdict"] == "full"


def test_verdict_degraded_honest_on_fallthrough_and_better_image():
    assert rg.grade_answer_lane("blur", False, "")["verdict"] == "degraded_honest"
    r = rg.grade_answer_lane("blur", True, "This is too blurry to read — retake the photo closer.")
    assert r["verdict"] == "degraded_honest"


def test_verdict_degraded_honest_on_recall_loss_only():
    r = rg.grade_answer_lane("glare", True, "A contactor control circuit; part is washed out.")
    assert r["verdict"] == "degraded_honest"
    assert "recall loss" in r["reason"]


def test_crop_partial_drops_removed_facts_from_required():
    """Cropping converts removed facts into unresolved — an answer covering only
    the surviving region is FULL under the crop. (The parent's required set is
    ["K01"], which survives the crop, so the filter is exercised directly.)"""
    answer = "-91/K01 is the contactor coil with its 13/14 auxiliary contact."
    assert rg.grade_answer_lane("crop_partial", True, answer)["verdict"] == "full"
    # The filter itself: a removed-region fact is dropped from requirements
    # under crop_partial and kept under any other condition.
    required = rg.parent_case()["expect"]["required_mentions"]
    assert all(r not in rg.CROP_REMOVED_MENTIONS for r in required)
    assert "89" in rg.CROP_REMOVED_MENTIONS and "K891" in rg.CROP_REMOVED_MENTIONS


def test_never_rules_hard_fail_under_degradation():
    invented = rg.grade_answer_lane("lowres", True, "I can see K777 feeding -91/K01 (K01).")
    assert invented["verdict"] == "hard_fail"
    state = rg.grade_answer_lane("shadow", True, "-91/K01 (K01, K891) is energized right now.")
    assert state["verdict"] == "hard_fail"


def test_matrix_and_artifacts():
    rows = [
        {"condition": "rot90", "family": "rotation", "routed": True, "verdict": "full"},
        {
            "condition": "blur",
            "family": "quality",
            "routed": True,
            "verdict": "degraded_honest",
            "reason": "recall loss only: missing ['K01']",
        },
        {"condition": "glare", "family": "quality", "routed": False},
    ]
    env = rg.build_matrix(rows, mode="hermetic")
    assert env["unsupported_claim_rate"] == 0.0
    assert env["families"]["rotation"]["full"] == 1
    md, js = rg.render_report(env), rg.stable_json(env)
    assert rg.audit_artifact(md) == [] and rg.audit_artifact(js) == []
    assert "phase4" in rg.phone_summary(env)


def test_matrix_flags_never_violation():
    rows = [
        {
            "condition": "lowres",
            "family": "quality",
            "routed": True,
            "verdict": "hard_fail",
            "never_violations": [{"class": "prose_tag_invention", "detail": "K777"}],
        }
    ]
    env = rg.build_matrix(rows, mode="hermetic")
    assert env["hard_failures"] and env["unsupported_claim_rate"] == 1.0
