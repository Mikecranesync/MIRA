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


# ---------------------------------------------------------------------------
# Windows portability regression — the file:// URL the sync task emits must be
# parseable by the SAME parse the consumer uses.
#
# tasks/ingest.py::_validated_local_path resolves a file:// URL with
# url2pathname(urlparse(url).path) and then requires containment in the allowed
# base. An f-string URL (`file://{path}`) puts a Windows drive letter in the URL
# AUTHORITY and leaves `path` empty, so a legitimately contained file resolves
# elsewhere and is refused (fail-closed). as_uri() emits the three-slash form
# that round-trips. POSIX output is unchanged by the fix, so this test pins the
# contract on every platform rather than only the one that was broken.
# ---------------------------------------------------------------------------


class TestFileUrlRoundTripsThroughConsumerParse:
    """The URL gdrive emits must survive the consumer's urlparse+url2pathname."""

    @staticmethod
    def _consumer_parse(url: str) -> Path:
        """Byte-for-byte the resolution tasks/ingest.py::_validated_local_path does."""
        from urllib.parse import urlparse
        from urllib.request import url2pathname

        return Path(url2pathname(urlparse(url).path)).resolve()

    def test_emitted_url_round_trips_to_the_same_file(self, tmp_path: Path):
        pdf = tmp_path / "manual.pdf"
        pdf.write_bytes(b"%PDF-1.4")

        url = pdf.resolve().as_uri()

        assert self._consumer_parse(url) == pdf.resolve()

    def test_emitted_url_round_trips_with_spaces_in_the_path(self, tmp_path: Path):
        """as_uri() percent-encodes; url2pathname decodes. Drive folders have spaces."""
        folder = tmp_path / "drive inbox"
        folder.mkdir()
        pdf = folder / "my manual.pdf"
        pdf.write_bytes(b"%PDF-1.4")

        url = pdf.resolve().as_uri()

        assert "%20" in url
        assert self._consumer_parse(url) == pdf.resolve()

    def test_fstring_form_is_the_regression_being_prevented(self, tmp_path: Path):
        """Documents WHY as_uri() is required: on Windows the f-string form loses
        the path entirely. On POSIX the two forms coincide, so this asserts only
        that as_uri() is never worse."""
        pdf = tmp_path / "manual.pdf"
        pdf.write_bytes(b"%PDF-1.4")
        resolved = pdf.resolve()

        good = self._consumer_parse(resolved.as_uri())
        assert good == resolved

        naive = self._consumer_parse(f"file://{resolved}")
        if naive != resolved:  # Windows
            assert good == resolved, "as_uri() must survive where the f-string fails"

    def test_call_site_uses_as_uri_not_an_fstring(self):
        """Structural lock on the PRODUCTION call site.

        The round-trip tests above prove what a correct URL does; this proves
        gdrive.py actually builds one. Without it the tests pass while the
        shipped f-string is still there (they only exercise the stdlib).
        Mirrors the structural-invariant style used in
        tests/test_write_path_visibility.py.
        """
        import ast
        import pathlib

        src = pathlib.Path(__file__).resolve().parents[1] / "tasks" / "gdrive.py"
        tree = ast.parse(src.read_text(encoding="utf-8", errors="replace"))

        assigns = [
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.Assign)
            and any(
                isinstance(t, ast.Name) and t.id == "file_url" for t in n.targets
            )
        ]
        assert assigns, "file_url assignment not found in gdrive.py — test is stale"

        for node in assigns:
            assert not isinstance(node.value, ast.JoinedStr), (
                "file_url must not be built with an f-string: on Windows "
                "`file://{path}` puts the drive letter in the URL authority and the "
                "consumer's containment check fails closed. Use path.resolve().as_uri()."
            )
            assert (
                isinstance(node.value, ast.Call)
                and getattr(node.value.func, "attr", "") == "as_uri"
            ), "file_url must be built with .as_uri()"
