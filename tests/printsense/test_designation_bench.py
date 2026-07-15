"""Tests for printsense.benchmarks.designation_bench (D18 synthetic benchmark)."""

import json
from printsense.benchmarks import designation_bench


class TestDesignationBench:
    """Deterministic synthetic European-designation benchmark tests."""

    def test_run_benchmark_returns_dict_with_required_keys(self):
        """Benchmark output has cases, metrics, hard_failures."""
        result = designation_bench.run_benchmark()
        assert isinstance(result, dict)
        assert "cases" in result
        assert "metrics" in result
        assert "hard_failures" in result
        assert isinstance(result["cases"], int)
        assert isinstance(result["metrics"], dict)
        assert isinstance(result["hard_failures"], list)

    def test_benchmark_has_exactly_ten_metrics(self):
        """All 10 required metric keys are present."""
        result = designation_bench.run_benchmark()
        expected_keys = {
            "lexical_accuracy", "parent_device_accuracy",
            "connection_point_accuracy", "terminal_role_accuracy",
            "profile_selection_accuracy", "ambiguity_calibration",
            "false_alias_rate", "false_continuity_rate",
            "raw_preservation", "safety_state_fabrication_rate"
        }
        assert set(result["metrics"].keys()) == expected_keys
        for key, val in result["metrics"].items():
            assert isinstance(val, (int, float)), f"{key} is {type(val)}"
            assert 0.0 <= val <= 1.0, f"{key}={val} out of [0,1]"

    def test_hard_failures_empty_on_clean_run(self):
        """No hard failures in clean benchmark run."""
        result = designation_bench.run_benchmark()
        assert result["hard_failures"] == []

    def test_false_alias_rate_is_zero(self):
        """Known non-aliases never emit ALIAS relationship types."""
        result = designation_bench.run_benchmark()
        assert result["metrics"]["false_alias_rate"] == 0.0

    def test_false_continuity_rate_is_zero(self):
        """No decoded outputs assert connection between terminals."""
        result = designation_bench.run_benchmark()
        assert result["metrics"]["false_continuity_rate"] == 0.0

    def test_raw_preservation_is_complete(self):
        """Every input is preserved in output['raw']."""
        result = designation_bench.run_benchmark()
        assert result["metrics"]["raw_preservation"] == 1.0

    def test_safety_state_fabrication_rate_is_zero(self):
        """No assertion of contact state outside safety caveat."""
        result = designation_bench.run_benchmark()
        assert result["metrics"]["safety_state_fabrication_rate"] == 0.0

    def test_benchmark_is_deterministic(self):
        """Two runs produce identical JSON output."""
        run1 = json.dumps(
            designation_bench.run_benchmark(), sort_keys=True)
        run2 = json.dumps(
            designation_bench.run_benchmark(), sort_keys=True)
        assert run1 == run2

    def test_report_is_ascii_cp1252_safe(self):
        """Rendered report contains no Unicode symbols."""
        result = designation_bench.run_benchmark()
        report = designation_bench.render_report(result)
        assert isinstance(report, str)
        # try to encode as cp1252 (will fail if any char is outside range)
        try:
            report.encode("cp1252")
        except UnicodeEncodeError as e:
            raise AssertionError(f"Report not cp1252-safe: {e}")

    def test_report_encodes_metrics(self):
        """Report includes metric values."""
        result = designation_bench.run_benchmark()
        report = designation_bench.render_report(result)
        for metric_key in ("lexical_accuracy", "false_alias_rate",
                           "raw_preservation"):
            # should appear somewhere in the report
            assert metric_key in report or str(
                result["metrics"][metric_key]) in report

    def test_sabotage_detects_alias_violation(self, monkeypatch):
        """Hard-failure gate catches simulated ALIAS_OF emission."""
        from printsense.designations import relationships as rel_module

        # Monkeypatch relate() to emit a fake CONFIRMED_ALIAS_OF
        original_relate = rel_module.relate

        def fake_relate(d1, d2):
            return [{"type": "CONFIRMED_ALIAS_OF", "from": d1.get("raw"),
                    "to": d2.get("raw")}]

        monkeypatch.setattr(rel_module, "relate", fake_relate)

        # Re-run benchmark with patched relate
        result = designation_bench.run_benchmark()

        # Restore original
        monkeypatch.setattr(rel_module, "relate", original_relate)

        # Should have detected the violation in hard_failures
        assert len(result["hard_failures"]) > 0
        assert any("ALIAS" in str(f) or "alias" in str(f).lower()
                   for f in result["hard_failures"])

    def test_cases_count_matches_fixtures(self):
        """cases count equals number of synthetic fixtures."""
        result = designation_bench.run_benchmark()
        assert result["cases"] >= 16, f"Expected >=16 cases, got {result['cases']}"


class TestDesignationBenchMain:
    """CLI interface tests."""

    def test_main_returns_zero_on_clean_run(self, capsys, tmp_path):
        """main() exits 0 when no hard failures."""
        import sys
        old_argv = sys.argv
        try:
            sys.argv = ["bench"]
            result = designation_bench.main(argv=["--json", str(tmp_path / "out.json")])
            assert result == 0
        finally:
            sys.argv = old_argv

    def test_main_prints_report_to_stdout(self, capsys):
        """main() prints ASCII report to stdout."""
        designation_bench.main(argv=[])
        captured = capsys.readouterr()
        assert captured.out
        assert "metric" in captured.out.lower() or "lexical" in captured.out.lower()

    def test_main_writes_json_when_requested(self, tmp_path):
        """main() writes JSON output file."""
        out_path = tmp_path / "result.json"
        designation_bench.main(argv=["--json", str(out_path)])
        assert out_path.exists()
        data = json.loads(out_path.read_text())
        assert "metrics" in data
        assert "cases" in data
