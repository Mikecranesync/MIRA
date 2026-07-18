"""OCR floor + provenance tests for VisionWorker (OCR-regime repair PR-A)."""

from shared.workers.vision_worker import parse_ocr_reply


class TestParseOcrReply:
    def test_numbered_list(self):
        raw = "1. K17\n2. A1 A2\n3. 24VDC"
        assert parse_ocr_reply(raw) == ["K17", "A1 A2", "24VDC"]

    def test_markdown_table_and_fences(self):
        raw = "```\n| F12 | fuse |\n|:--|:--|\n{\n1. S1\n```"
        items = parse_ocr_reply(raw)
        assert "F12" in items and "fuse" in items and "S1" in items
        assert "{" not in items

    def test_empty(self):
        assert parse_ocr_reply("") == []
