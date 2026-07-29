"""Hold-out evaluation harness guards — all hermetic, $0, no network."""

import asyncio
import json

import pytest

from factorylm_ai.dataset import holdout_eval as he


def test_prompt_set_deterministic() -> None:
    a = he.build_prompt_set()
    b = he.build_prompt_set()
    assert a["prompt_set_hash"] == b["prompt_set_hash"]
    assert len(a["prompts"]) == 25
    assert all(m["role"] in ("system", "user") for p in a["prompts"] for m in p["messages"]), (
        "reference answers must never appear in the prompt messages"
    )


def test_leakage_guard_trips_on_trained_holdout(monkeypatch, tmp_path) -> None:
    rows = [
        json.loads(line)
        for line in he.CANDIDATES.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    held = next(
        r
        for r in rows
        if r.get("split") == "held_out" and r["document_lineage_key"] == he.HELD_OUT_LINEAGE
    )
    fake_reviewed = tmp_path / "reviewed.jsonl"
    fake_reviewed.write_text(json.dumps(held) + "\n", encoding="utf-8")
    monkeypatch.setattr(he, "REVIEWED", fake_reviewed)
    with pytest.raises(SystemExit, match="LEAKAGE"):
        he.build_prompt_set()


def test_blinding_hides_model_identity(tmp_path) -> None:
    cfg = he.EvalConfig(out_dir=tmp_path, dry_run=True, budget_usd=0.0, authorization_path=None)
    asyncio.run(he.run_eval(cfg))
    blinded = (tmp_path / "outputs_blinded.jsonl").read_text(encoding="utf-8")
    assert he.TUNED_MODEL not in blinded
    assert "Qwen" not in blinded, "model names must not leak into the blinded file"
    sealed = json.loads((tmp_path / "sealed_mapping.json").read_text(encoding="utf-8"))
    sides = {(r["left_model"], r["right_model"]) for r in sealed["records"]}
    assert len(sides) == 2, "side assignment must vary across records (both orders present)"


def test_live_refused_without_authorization(tmp_path) -> None:
    cfg = he.EvalConfig(out_dir=tmp_path, dry_run=False, budget_usd=1.0, authorization_path=None)
    with pytest.raises(SystemExit, match="authorization"):
        asyncio.run(he.run_eval(cfg))


def test_deterministic_scores_flag_unsupported_numbers() -> None:
    prompt = {
        "messages": [{"role": "user", "content": "What is fault F059?"}],
        "evidence": {"claim": "F059 is Safety Open with code 59"},
        "safety_sensitive": True,
        "interaction_type": "diagnostic",
    }
    s = he.deterministic_scores("F059 is Safety Open, code 59. Set P044 to 77.", prompt)
    assert "77" in s["unsupported_numbers"]
    assert s["safety_stance_present"] is False
