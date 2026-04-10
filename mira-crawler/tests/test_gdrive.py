"""Tests for tasks/gdrive.py — Google Drive sync task.

All tests run offline — no network calls, no Redis, no rclone, no Celery broker.
"""

from __future__ import annotations

from pathlib import Path

# ---------------------------------------------------------------------------
# M12 regression — case-insensitive PDF glob
# ---------------------------------------------------------------------------


class TestScanPdfFiles:

    def test_finds_lowercase_pdf(self, tmp_path: Path):
        """Standard lowercase .pdf files are found."""
        from tasks.gdrive import _scan_pdf_files

        (tmp_path / "manual.pdf").write_bytes(b"%PDF-1.4 lower")

        result = _scan_pdf_files(tmp_path)

        assert len(result) == 1
        assert result[0].name == "manual.pdf"

    def test_finds_uppercase_PDF(self, tmp_path: Path):
        """Files with .PDF extension are found (M12 fix — case-insensitive)."""
        from tasks.gdrive import _scan_pdf_files

        (tmp_path / "Manual.PDF").write_bytes(b"%PDF-1.4 upper")

        result = _scan_pdf_files(tmp_path)

        assert len(result) == 1, (
            "Expected 1 PDF result but got none — .PDF extension not matched (M12 bug)"
        )
        assert result[0].name == "Manual.PDF"

    def test_finds_mixed_case_PDF(self, tmp_path: Path):
        """Mixed-case extensions like .Pdf are also matched."""
        from tasks.gdrive import _scan_pdf_files

        (tmp_path / "Datasheet.Pdf").write_bytes(b"%PDF-1.4 mixed")

        result = _scan_pdf_files(tmp_path)

        assert len(result) == 1
        assert result[0].name == "Datasheet.Pdf"

    def test_finds_pdfs_in_subdirectories(self, tmp_path: Path):
        """PDFs nested in subdirectories are found via rglob."""
        from tasks.gdrive import _scan_pdf_files

        subdir = tmp_path / "equipment" / "drives"
        subdir.mkdir(parents=True)
        (subdir / "gs20.pdf").write_bytes(b"%PDF lower nested")
        (subdir / "GS20_MANUAL.PDF").write_bytes(b"%PDF upper nested")

        result = _scan_pdf_files(tmp_path)

        assert len(result) == 2

    def test_mixed_lowercase_uppercase_returns_all(self, tmp_path: Path):
        """A directory with both .pdf and .PDF files returns all of them."""
        from tasks.gdrive import _scan_pdf_files

        (tmp_path / "a.pdf").write_bytes(b"%PDF lower")
        (tmp_path / "B.PDF").write_bytes(b"%PDF upper")
        (tmp_path / "C.Pdf").write_bytes(b"%PDF mixed")
        (tmp_path / "not_a_pdf.txt").write_bytes(b"text file")

        result = _scan_pdf_files(tmp_path)

        assert len(result) == 3

    def test_non_pdf_files_excluded(self, tmp_path: Path):
        """Non-PDF files (.docx, .txt, .jpg) are not returned."""
        from tasks.gdrive import _scan_pdf_files

        (tmp_path / "report.docx").write_bytes(b"word doc")
        (tmp_path / "readme.txt").write_bytes(b"text")
        (tmp_path / "photo.jpg").write_bytes(b"jpeg")

        result = _scan_pdf_files(tmp_path)

        assert result == []

    def test_nonexistent_directory_returns_empty(self):
        """Non-existent base directory returns empty list without raising."""
        from tasks.gdrive import _scan_pdf_files

        result = _scan_pdf_files(Path("/nonexistent/path/that/does/not/exist"))

        assert result == []

    def test_result_is_sorted(self, tmp_path: Path):
        """Returned paths are in a consistent (sorted) order, not arbitrary."""
        from tasks.gdrive import _scan_pdf_files

        (tmp_path / "c.pdf").write_bytes(b"%PDF c")
        (tmp_path / "a.pdf").write_bytes(b"%PDF a")
        (tmp_path / "b.pdf").write_bytes(b"%PDF b")

        result = _scan_pdf_files(tmp_path)

        # Use the same comparator as the implementation (sorted(results) on Path objects)
        assert result == sorted(result), "Results must be in sorted Path order"

    def test_accepts_string_path(self, tmp_path: Path):
        """_scan_pdf_files accepts a plain string path as well as Path objects."""
        from tasks.gdrive import _scan_pdf_files

        (tmp_path / "file.pdf").write_bytes(b"%PDF str input")

        result = _scan_pdf_files(str(tmp_path))

        assert len(result) == 1
