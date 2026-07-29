"""Tests for the on-demand drive-pack gap report (pure aggregation — no DB)."""

from __future__ import annotations

import json

import gap_report


def _row(pack_id, question, created_at):
    return {"pack_id": pack_id, "user_message": question, "created_at": created_at}


def test_extract_tokens():
    assert gap_report.extract_tokens("what is P02.00 on the drive?") == ["P02.00"]
    assert gap_report.extract_tokens("tell me about CE10") == ["CE10"]
    assert gap_report.extract_tokens("how do I reset it") == []
    # first token wins as the grouping key; multiple are still all returned
    assert gap_report.extract_tokens("P01.24 vs P02.00") == ["P01.24", "P02.00"]


def test_aggregate_groups_by_pack_and_token():
    rows = [
        _row("durapulse_gs10", "what is p02.00", "2026-07-01T10:00:00"),
        _row("durapulse_gs10", "P02.00 meaning?", "2026-07-03T10:00:00"),
        _row("durapulse_gs10", "explain p00.03", "2026-07-02T10:00:00"),
        _row("powerflex_525", "what is F004", "2026-07-04T10:00:00"),
    ]
    report = gap_report.aggregate_gaps(rows)

    assert report["total_gaps"] == 4
    # Packs ranked by gap_count desc: gs10 (3) before pf525 (1).
    assert [p["pack_id"] for p in report["packs"]] == ["durapulse_gs10", "powerflex_525"]

    gs10 = report["packs"][0]
    assert gs10["gap_count"] == 3
    # Within gs10, P02.00 (2 asks) ranks above P00.03 (1 ask).
    assert gs10["tokens"][0]["token"] == "P02.00"
    assert gs10["tokens"][0]["count"] == 2
    # Recency captured (latest of the two P02.00 asks).
    assert gs10["tokens"][0]["last_asked"] == "2026-07-03T10:00:00"
    assert gs10["tokens"][1]["token"] == "P00.03"


def test_aggregate_untokenized_questions_bucket():
    rows = [
        _row("durapulse_gs10", "how do I reset the fault", "2026-07-01T10:00:00"),
        _row("durapulse_gs10", "is it broken", "2026-07-02T10:00:00"),
    ]
    report = gap_report.aggregate_gaps(rows)
    tokens = report["packs"][0]["tokens"]
    assert len(tokens) == 1
    assert tokens[0]["token"] == "(no parameter id)"
    assert tokens[0]["count"] == 2


def test_aggregate_caps_samples_at_three():
    rows = [_row("gs10", f"what is P02.00 ask {i}", f"2026-07-0{i}T10:00:00") for i in range(1, 6)]
    report = gap_report.aggregate_gaps(rows)
    bucket = report["packs"][0]["tokens"][0]
    assert bucket["count"] == 5
    assert len(bucket["samples"]) == 3  # capped


def test_aggregate_handles_missing_pack_id():
    rows = [_row(None, "what is P02.00", "2026-07-01T10:00:00")]
    report = gap_report.aggregate_gaps(rows)
    assert report["packs"][0]["pack_id"] == "unknown"


def test_aggregate_empty():
    report = gap_report.aggregate_gaps([])
    assert report["total_gaps"] == 0
    assert report["packs"] == []


def test_render_json_roundtrips():
    rows = [_row("durapulse_gs10", "what is p02.00", "2026-07-01T10:00:00")]
    report = gap_report.aggregate_gaps(rows, generated_at="2026-07-08T00:00:00")
    parsed = json.loads(gap_report.render_json(report))
    assert parsed["total_gaps"] == 1
    assert parsed["packs"][0]["pack_id"] == "durapulse_gs10"
    assert parsed["generated_at"] == "2026-07-08T00:00:00"


def test_render_md_contains_pack_and_token():
    rows = [
        _row("durapulse_gs10", "what is p02.00", "2026-07-01T10:00:00"),
        _row("durapulse_gs10", "P02.00 again", "2026-07-02T10:00:00"),
    ]
    md = gap_report.render_md(gap_report.aggregate_gaps(rows, generated_at="2026-07-08"))
    assert "# Drive-pack gap report" in md
    assert "## durapulse_gs10 — 2 gaps" in md
    assert "| P02.00 | 2 |" in md
    assert "2026-07-02" in md  # last-asked date rendered


def test_render_md_empty():
    md = gap_report.render_md(gap_report.aggregate_gaps([]))
    assert "No unmatched drive-pack questions" in md


def test_md_escapes_pipe_in_example():
    rows = [_row("gs10", "what is P02.00 | weird", "2026-07-01T10:00:00")]
    md = gap_report.render_md(gap_report.aggregate_gaps(rows))
    # The literal pipe in the question must be escaped so it doesn't break the table.
    assert "\\|" in md


# --- capture-schema guard (fail-clean when mig 013's meta column is absent) ---


class _FakeCursor:
    """Minimal cursor stub: returns a canned row for the information_schema probe."""

    def __init__(self, has_meta):
        self._has_meta = has_meta
        self._result = None

    def execute(self, sql, params=None):
        self._result = (1,) if self._has_meta else None

    def fetchone(self):
        return self._result


def test_capture_schema_ready_true_when_meta_present():
    assert gap_report.capture_schema_ready(_FakeCursor(has_meta=True)) is True


def test_capture_schema_ready_false_when_meta_absent():
    assert gap_report.capture_schema_ready(_FakeCursor(has_meta=False)) is False


def test_meta_missing_message_is_actionable():
    # The operator must be told exactly which migration to apply.
    assert "013" in gap_report.META_MISSING_MSG
    assert "conversation_eval.meta" in gap_report.META_MISSING_MSG


# --- grouping-key preference (model name must not hijack the parameter bucket) ---


def test_grouping_token_prefers_dotted_param_over_model():
    # "GS10 P01.24 meaning?" — model leads, but the gap groups under the parameter.
    assert gap_report.grouping_token(["GS10", "P01.24"]) == "P01.24"
    # Order-independent: parameter-first phrasing groups the same way.
    assert gap_report.grouping_token(["P01.24", "GS10"]) == "P01.24"


def test_grouping_token_falls_back_to_first_when_no_dotted():
    assert gap_report.grouping_token(["CE10"]) == "CE10"  # bare fault code
    assert gap_report.grouping_token([]) == gap_report._NO_TOKEN


def test_model_led_and_param_led_asks_consolidate_into_one_bucket():
    rows = [
        _row("durapulse_gs10", "what is P01.24 on the GS10?", "2026-07-01T10:00:00"),
        _row("durapulse_gs10", "GS10 P01.24 meaning?", "2026-07-02T10:00:00"),
    ]
    report = gap_report.aggregate_gaps(rows)
    pack = report["packs"][0]
    tokens = {t["token"]: t["count"] for t in pack["tokens"]}
    # Both asks land under P01.24 — no phantom "GS10" bucket.
    assert tokens == {"P01.24": 2}
