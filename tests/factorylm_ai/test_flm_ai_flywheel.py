"""Tests for factorylm_ai.flywheel (records, redact, splits, export).

Hermetic: no network, tmp_path for every JSONL/file write, no time-of-day
dependence beyond ISO-timestamp parseability.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from factorylm_ai.flywheel.export import ExportRefused, export_together_jsonl
from factorylm_ai.flywheel.records import (
    new_eval_case,
    new_feedback_event,
    new_interaction_record,
    new_training_record,
)
from factorylm_ai.flywheel.redact import redact_record, redact_text
from factorylm_ai.flywheel.splits import assign_split, near_duplicate_key, split_records
from factorylm_ai.schemas.validate import SchemaError

# ---------------------------------------------------------------------------
# records.py — builders validate + reject bad shapes
# ---------------------------------------------------------------------------


def test_new_interaction_record_happy_path_validates() -> None:
    rec = new_interaction_record(
        channel="telegram", input_kind="photo", input_text="what is this relay"
    )
    assert rec["channel"] == "telegram"
    assert rec["input_kind"] == "photo"
    assert rec["input_text"] == "what is this relay"
    assert rec["human_rating"] == "unknown"
    assert rec["review_status"] == "draft"
    assert rec["sensitive"] is False
    assert rec["tags"] == []
    assert rec["interaction_id"].startswith("int_")
    datetime.fromisoformat(rec["ts"])  # must be a parseable ISO-8601 timestamp


def test_new_interaction_record_explicit_ids_are_honored() -> None:
    rec = new_interaction_record(
        channel="proofpack",
        input_kind="text",
        interaction_id="int_fixed_1",
        ts="2026-07-19T00:00:00Z",
    )
    assert rec["interaction_id"] == "int_fixed_1"
    assert rec["ts"] == "2026-07-19T00:00:00Z"


def test_new_interaction_record_rejects_bad_human_rating_enum() -> None:
    with pytest.raises(SchemaError):
        new_interaction_record(channel="telegram", input_kind="photo", human_rating="maybe")


def test_new_interaction_record_rejects_bad_review_status_enum() -> None:
    with pytest.raises(SchemaError):
        new_interaction_record(channel="telegram", input_kind="photo", review_status="pending")


def test_new_feedback_event_happy_path() -> None:
    fb = new_feedback_event(
        interaction_id="int_0001",
        kind="correction",
        text="K1 is actually on sheet 7, not 6.",
        corrected_fields={"shown_on_drawing": ["K1 coil at D1, sheet 7"]},
        reviewer="mike",
    )
    assert fb["kind"] == "correction"
    assert fb["interaction_id"] == "int_0001"
    assert fb["reviewer"] == "mike"
    assert fb["feedback_id"].startswith("fb_")
    datetime.fromisoformat(fb["ts"])


def test_new_feedback_event_defaults_text_and_optional_fields() -> None:
    fb = new_feedback_event(interaction_id="int_0001", kind="approval")
    assert fb["text"] == ""
    assert fb["corrected_fields"] is None
    assert fb["reviewer"] is None


def test_new_feedback_event_rejects_bad_kind_enum() -> None:
    with pytest.raises(SchemaError):
        new_feedback_event(interaction_id="int_0001", kind="shrug")


def test_new_training_record_happy_path_validates_and_assigns_split() -> None:
    rec = new_training_record(
        source_interaction_ids=["int_1"],
        messages=[{"role": "user", "content": "hi"}],
        tags=["m05"],
        sensitive=False,
        approved_by=None,
        record_id="rec-fixed-1",
    )
    assert rec["record_id"] == "rec-fixed-1"
    assert rec["source_interaction_ids"] == ["int_1"]
    assert rec["tools"] is None
    assert rec["tenant_id"] is None
    assert rec["approved_by"] is None
    assert rec["split"] == assign_split("rec-fixed-1")
    datetime.fromisoformat(rec["created_at"])


def test_new_training_record_explicit_split_overrides_hash() -> None:
    natural = assign_split("rec-fixed-2")
    forced = "holdout" if natural != "holdout" else "dev"
    rec = new_training_record(
        source_interaction_ids=["int_1"],
        messages=[{"role": "user", "content": "hi"}],
        tags=[],
        sensitive=False,
        approved_by="mike",
        record_id="rec-fixed-2",
        split=forced,
    )
    assert rec["split"] == forced


def test_new_training_record_rejects_bad_split_enum() -> None:
    with pytest.raises(SchemaError):
        new_training_record(
            source_interaction_ids=["int_1"],
            messages=[{"role": "user", "content": "hi"}],
            tags=[],
            sensitive=False,
            approved_by="mike",
            split="nope",
        )


def test_new_training_record_provenance_law_empty_source_ids_raises() -> None:
    with pytest.raises(ValueError, match="provenance law"):
        new_training_record(
            source_interaction_ids=[],
            messages=[{"role": "user", "content": "hi"}],
            tags=[],
            sensitive=False,
            approved_by="mike",
        )


def test_new_eval_case_happy_path_split_is_always_eval() -> None:
    case = new_eval_case(
        input_value="fault on the vfd, what do I do", expected_value="drive_fault_photo"
    )
    assert case["split"] == "eval"
    assert case["frozen"] is True
    assert case["judge"] == "deterministic"
    assert case["case_id"].startswith("ec_")
    assert case["input"] == "fault on the vfd, what do I do"
    assert case["expected"] == "drive_fault_photo"


def test_new_eval_case_frozen_can_be_overridden_but_split_cannot() -> None:
    case = new_eval_case(
        input_value={"query": "K1"}, expected_value={"chunk_id": "chunk_014"}, frozen=False
    )
    assert case["frozen"] is False
    assert case["split"] == "eval"  # not a parameter — always eval


def test_new_eval_case_rejects_bad_judge_enum() -> None:
    with pytest.raises(SchemaError):
        new_eval_case(input_value="x", expected_value="y", judge="vibes")


# ---------------------------------------------------------------------------
# redact.py
# ---------------------------------------------------------------------------


def test_redact_text_replaces_ip_mac_and_serial() -> None:
    text = "192.168.4.28 MAC 00:1B:44:11:3A:B7 SN X4J-99201"
    redacted = redact_text(text)
    assert "192.168.4.28" not in redacted
    assert "00:1B:44:11:3A:B7" not in redacted
    assert "X4J-99201" not in redacted
    assert "[IP]" in redacted
    assert "[MAC]" in redacted
    assert "[SN]" in redacted


def test_redact_text_leaves_clean_text_alone() -> None:
    assert redact_text("K1 relay is on sheet 6, check terminal A1.") == (
        "K1 relay is on sheet 6, check terminal A1."
    )


def test_redact_record_walks_input_text_final_text_and_messages() -> None:
    record: dict[str, Any] = {
        "input_text": "gateway 10.0.0.5",
        "final_text": "MAC is 00:1B:44:11:3A:B7",
        "messages": [
            {"role": "user", "content": "SN AB12-3456"},
            {"role": "assistant", "content": "no pii here"},
        ],
        "other_field": "192.168.1.1 should NOT be touched",
    }
    redacted = redact_record(record)

    assert redacted["input_text"] == "gateway [IP]"
    assert redacted["final_text"] == "MAC is [MAC]"
    assert redacted["messages"][0]["content"] == "[SN]"
    assert redacted["messages"][1]["content"] == "no pii here"
    # Only input_text/final_text/messages[].content are walked — everything
    # else on the record passes through untouched.
    assert redacted["other_field"] == "192.168.1.1 should NOT be touched"

    # Never mutates the caller's dict.
    assert record["input_text"] == "gateway 10.0.0.5"
    assert record["messages"][0]["content"] == "SN AB12-3456"


def test_redact_record_tolerates_missing_and_non_string_fields() -> None:
    record: dict[str, Any] = {"input_text": None, "sensitive": True}
    redacted = redact_record(record)
    assert redacted["input_text"] is None
    assert redacted["sensitive"] is True
    assert "final_text" not in redacted
    assert "messages" not in redacted


# ---------------------------------------------------------------------------
# splits.py — assign_split reproducibility + distribution
# ---------------------------------------------------------------------------


def test_assign_split_is_reproducible_across_calls() -> None:
    ids = [f"rec_{i}" for i in range(50)]
    first = [assign_split(i) for i in ids]
    second = [assign_split(i) for i in ids]
    assert first == second


def test_assign_split_only_returns_standard_buckets() -> None:
    for i in range(50):
        assert assign_split(f"rec_{i}") in {"train", "dev", "test", "holdout"}


def test_assign_split_distribution_sane_over_200_synthetic_ids() -> None:
    ids = [f"synthetic_{i}" for i in range(200)]
    counts = Counter(assign_split(i) for i in ids)
    train_fraction = counts["train"] / 200
    assert 0.55 <= train_fraction <= 0.85


def test_near_duplicate_key_ignores_case_and_whitespace() -> None:
    a = near_duplicate_key("K1 relay is on sheet 6.")
    b = near_duplicate_key("  k1   relay IS on sheet 6.  ")
    assert a == b


def test_near_duplicate_key_differs_for_different_text() -> None:
    a = near_duplicate_key("K1 relay is on sheet 6.")
    b = near_duplicate_key("F1 fuse is on sheet 3.")
    assert a != b


# ---------------------------------------------------------------------------
# splits.py — split_records: bucketing + near-dup cross-split guard
# ---------------------------------------------------------------------------


def test_split_records_buckets_by_existing_split_field() -> None:
    records = [
        new_training_record(
            source_interaction_ids=["int_1"],
            messages=[{"role": "user", "content": "alpha"}],
            tags=[],
            sensitive=False,
            approved_by="mike",
            record_id="rec-a",
            split="train",
        ),
        new_training_record(
            source_interaction_ids=["int_2"],
            messages=[{"role": "user", "content": "beta"}],
            tags=[],
            sensitive=False,
            approved_by="mike",
            record_id="rec-b",
            split="dev",
        ),
    ]
    buckets = split_records(records)
    assert {r["record_id"] for r in buckets["train"]} == {"rec-a"}
    assert {r["record_id"] for r in buckets["dev"]} == {"rec-b"}
    assert buckets["test"] == []
    assert buckets["holdout"] == []


def test_split_records_assigns_split_when_missing() -> None:
    record = {"record_id": "rec-nosplit", "messages": [{"role": "user", "content": "x"}]}
    buckets = split_records([record])
    expected = assign_split("rec-nosplit")
    assert len(buckets[expected]) == 1
    assert buckets[expected][0]["record_id"] == "rec-nosplit"
    assert buckets[expected][0]["split"] == expected
    # split_records never mutates the caller's original dict.
    assert "split" not in record


def test_split_records_reproducible_across_two_calls() -> None:
    records = [
        {"record_id": f"rec-{i}", "messages": [{"role": "user", "content": f"text {i}"}]}
        for i in range(20)
    ]
    first = split_records([dict(r) for r in records])
    second = split_records([dict(r) for r in records])
    for split in ("train", "dev", "test", "holdout"):
        first_ids = sorted(r["record_id"] for r in first[split])
        second_ids = sorted(r["record_id"] for r in second[split])
        assert first_ids == second_ids


def test_split_records_drops_train_copy_when_near_dup_of_holdout(
    caplog: pytest.LogCaptureFixture,
) -> None:
    shared_text = "k1 relay is on sheet 6, check terminal a1 for continuity."
    train_record = new_training_record(
        source_interaction_ids=["int_1"],
        messages=[{"role": "user", "content": shared_text.upper() + "   "}],
        tags=[],
        sensitive=False,
        approved_by="mike",
        record_id="rec-train-1",
        split="train",
    )
    holdout_record = new_training_record(
        source_interaction_ids=["int_2"],
        messages=[{"role": "user", "content": shared_text}],
        tags=[],
        sensitive=False,
        approved_by="mike",
        record_id="rec-holdout-1",
        split="holdout",
    )
    unrelated_train = new_training_record(
        source_interaction_ids=["int_3"],
        messages=[{"role": "user", "content": "totally unrelated content"}],
        tags=[],
        sensitive=False,
        approved_by="mike",
        record_id="rec-train-2",
        split="train",
    )

    with caplog.at_level(logging.WARNING, logger="factorylm-ai"):
        buckets = split_records([train_record, holdout_record, unrelated_train])

    train_ids = {r["record_id"] for r in buckets["train"]}
    assert "rec-train-1" not in train_ids  # dropped: near-dup of a holdout record
    assert "rec-train-2" in train_ids  # kept: no collision
    assert {r["record_id"] for r in buckets["holdout"]} == {"rec-holdout-1"}  # holdout untouched

    messages = [r.getMessage() for r in caplog.records]
    assert any("near-duplicate" in m and "rec-train-1" in m for m in messages)


def test_split_records_eval_split_never_collides_with_holdout_guard() -> None:
    eval_case = new_eval_case(input_value="k1 relay is on sheet 6.", expected_value="sheet_6")
    holdout_record = new_training_record(
        source_interaction_ids=["int_1"],
        messages=[{"role": "user", "content": "k1 relay is on sheet 6."}],
        tags=[],
        sensitive=False,
        approved_by="mike",
        record_id="rec-holdout-2",
        split="holdout",
    )
    buckets = split_records([eval_case, holdout_record])
    assert eval_case in buckets["eval"]
    assert {r["record_id"] for r in buckets["holdout"]} == {"rec-holdout-2"}


# ---------------------------------------------------------------------------
# export.py — helpers
# ---------------------------------------------------------------------------


def _training_record(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = dict(
        source_interaction_ids=["int_1"],
        messages=[
            {"role": "user", "content": "what is this relay"},
            {"role": "assistant", "content": "K1 is shown on sheet 6."},
        ],
        tags=["m05"],
        sensitive=False,
        approved_by="mike",
        split="train",
    )
    base.update(overrides)
    return new_training_record(**base)


# ---------------------------------------------------------------------------
# export.py — approval gate
# ---------------------------------------------------------------------------


def test_export_refuses_unapproved_record_and_writes_nothing(tmp_path: Path) -> None:
    approved = _training_record(record_id="rec-ok")
    unapproved = _training_record(record_id="rec-bad", approved_by=None)
    out_dir = tmp_path / "export"

    with pytest.raises(ExportRefused):
        export_together_jsonl([approved, unapproved], str(out_dir))

    assert not out_dir.exists()


def test_export_rejects_unknown_fmt(tmp_path: Path) -> None:
    rec = _training_record(record_id="rec-x")
    with pytest.raises(ValueError):
        export_together_jsonl([rec], str(tmp_path / "out"), fmt="yaml")


# ---------------------------------------------------------------------------
# export.py — sensitive / tenant skip
# ---------------------------------------------------------------------------


def test_export_skips_sensitive_by_default_and_includes_with_flag(tmp_path: Path) -> None:
    normal = _training_record(record_id="rec-normal")
    sensitive = _training_record(record_id="rec-sensitive", sensitive=True)

    default_dir = tmp_path / "default"
    export_together_jsonl([normal, sensitive], str(default_dir))
    lines = (default_dir / "train.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1

    included_dir = tmp_path / "included"
    export_together_jsonl([normal, sensitive], str(included_dir), include_tenant_sensitive=True)
    lines2 = (included_dir / "train.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(lines2) == 2


def test_export_skips_tenant_scoped_record_by_default(tmp_path: Path) -> None:
    tenant_record = _training_record(
        record_id="rec-tenant", tenant_id="9d1f8f0a-2222-4b3c-8a11-000000000001"
    )
    out_dir = tmp_path / "out"
    written = export_together_jsonl([tenant_record], str(out_dir))
    assert Path(written["train"]).read_text(encoding="utf-8").strip() == ""


# ---------------------------------------------------------------------------
# export.py — holdout is NEVER written
# ---------------------------------------------------------------------------


def test_export_never_writes_holdout(tmp_path: Path) -> None:
    train_rec = _training_record(record_id="rec-train")
    holdout_rec = _training_record(record_id="rec-holdout", split="holdout")
    out_dir = tmp_path / "out"

    written = export_together_jsonl([train_rec, holdout_rec], str(out_dir))

    assert set(written) == {"train", "dev", "test"}
    assert not (out_dir / "holdout.jsonl").exists()
    train_lines = Path(written["train"]).read_text(encoding="utf-8").strip().splitlines()
    assert len(train_lines) == 1
    assert json.loads(train_lines[0])["messages"][0]["content"] == "what is this relay"


def test_export_empty_input_still_creates_three_files(tmp_path: Path) -> None:
    out_dir = tmp_path / "empty_out"
    written = export_together_jsonl([], str(out_dir))
    assert set(written) == {"train", "dev", "test"}
    for path in written.values():
        assert Path(path).exists()
        assert Path(path).read_text(encoding="utf-8") == ""


# ---------------------------------------------------------------------------
# export.py — chat vs function_calling line shape
# ---------------------------------------------------------------------------


def test_export_chat_format_lines_are_messages_only(tmp_path: Path) -> None:
    rec = _training_record(record_id="rec-chat")
    out_dir = tmp_path / "out"

    written = export_together_jsonl([rec], str(out_dir), fmt="chat")

    line = json.loads(Path(written["train"]).read_text(encoding="utf-8").strip())
    assert set(line.keys()) == {"messages"}
    assert isinstance(line["messages"], list)
    assert line["messages"][0]["role"] == "user"


def test_export_chat_format_never_includes_tools_even_if_record_has_them(tmp_path: Path) -> None:
    tools = [{"type": "function", "function": {"name": "search_print_pages"}}]
    rec = _training_record(record_id="rec-chat-tools", tools=tools)
    out_dir = tmp_path / "out"

    written = export_together_jsonl([rec], str(out_dir), fmt="chat")

    line = json.loads(Path(written["train"]).read_text(encoding="utf-8").strip())
    assert "tools" not in line


def test_export_function_calling_format_carries_tools_and_tool_calls(tmp_path: Path) -> None:
    tools = [{"type": "function", "function": {"name": "search_print_pages", "parameters": {}}}]
    messages = [
        {"role": "user", "content": "where is K1"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "search_print_pages", "arguments": '{"query": "K1"}'},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call_1", "content": "K1 found on sheet 6"},
        {"role": "assistant", "content": "K1 is shown on sheet 6."},
    ]
    rec = _training_record(record_id="rec-fc", messages=messages, tools=tools)
    out_dir = tmp_path / "out"

    written = export_together_jsonl([rec], str(out_dir), fmt="function_calling")

    line = json.loads(Path(written["train"]).read_text(encoding="utf-8").strip())
    assert line["tools"] == tools
    roles = [m["role"] for m in line["messages"]]
    assert "tool" in roles
    assert any(m.get("tool_calls") for m in line["messages"] if m["role"] == "assistant")


# ---------------------------------------------------------------------------
# export.py — redaction happens before writing
# ---------------------------------------------------------------------------


def test_export_redacts_pii_before_writing(tmp_path: Path) -> None:
    rec = _training_record(
        record_id="rec-redact",
        messages=[{"role": "user", "content": "the gateway is at 192.168.4.28, help"}],
    )
    out_dir = tmp_path / "out"

    written = export_together_jsonl([rec], str(out_dir))

    text = Path(written["train"]).read_text(encoding="utf-8")
    assert "192.168.4.28" not in text
    assert "[IP]" in text


def test_export_creates_out_dir_and_deterministic_key_order(tmp_path: Path) -> None:
    out_dir = tmp_path / "nested" / "does" / "not" / "exist"
    assert not out_dir.exists()

    written = export_together_jsonl([_training_record(record_id="rec-1")], str(out_dir))

    assert out_dir.exists()
    assert list(written.keys()) == ["train", "dev", "test"]
