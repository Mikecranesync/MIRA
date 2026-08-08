"""Findings fingerprint + disposition round-trip.

The fingerprint is what makes a campaign finding trackable across rounds, so the
cases below are the REAL conversation ids from campaign c1/c1r1-c1r4 rather than
invented ones. If these stop unifying, the end-of-run report starts reporting
the same defect as new every round and the GitHub dedupe breaks.
"""

from __future__ import annotations

import pytest

from tests.regime1_telethon.campaign import findings


class TestFingerprint:
    @pytest.mark.parametrize(
        ("conv_id", "expected"),
        [
            # The same scenario across rounds 1 and 4 — round 1 has no seed
            # segment, round 4 does. Both must collapse to one finding.
            ("t1_013_reset_procedure", "t1:reset_procedure"),
            ("t1_s42_013_reset_procedure", "t1:reset_procedure"),
            # Tier 2, seeded and unseeded forms.
            ("t2_002_continuation_is_kept", "t2:continuation_is_kept"),
            ("t2_s42_000_pivot_after_fault", "t2:pivot_after_fault"),
            ("t2_000_pivot_after_fault", "t2:pivot_after_fault"),
            # Tier 8 uses a bare seed and appends the persona.
            ("t8_41_001_experienced", "t8:experienced"),
            ("t8_41_003_impatient", "t8:impatient"),
            # Tier 1 with a longer scenario name.
            ("t1_s42_012_fault_code_pf525", "t1:fault_code_pf525"),
        ],
    )
    def test_run_varying_segments_are_stripped(self, conv_id, expected):
        assert findings.fingerprint(conv_id) == expected

    def test_rounds_of_the_same_scenario_share_one_fingerprint(self):
        a = findings.fingerprint("t2_s42_000_pivot_after_fault")
        b = findings.fingerprint("t2_000_pivot_after_fault")
        assert a == b

    def test_distinct_scenarios_do_not_collide(self):
        ids = [
            "t1_013_reset_procedure",
            "t1_s42_012_fault_code_pf525",
            "t2_002_continuation_is_kept",
            "t8_41_003_impatient",
        ]
        assert len({findings.fingerprint(i) for i in ids}) == len(ids)

    def test_same_scenario_in_different_tiers_stays_distinct(self):
        """Tier is part of the identity — the same probe at T1 and T2 differs."""
        assert findings.fingerprint("t1_000_pivot_after_fault") != findings.fingerprint(
            "t2_000_pivot_after_fault"
        )

    def test_a_scenario_name_starting_with_digits_keeps_its_name(self):
        """A bare index is stripped; a name segment must not be.

        `525_shorthand` is a plausible scenario name (issue #3152). With only an
        index in front of it, the name survives intact.
        """
        assert findings.fingerprint("t1_013_525_on_cv200") == "t1:525_on_cv200"

    def test_nameless_tier3_conversations_stay_distinct(self):
        """Tier 3 ids carry no scenario name (`t3_<seed>_<i>`).

        There is nothing to unify, so the seed and index must SURVIVE — folding
        them away would merge every adaptive conversation into one finding.
        """
        assert findings.fingerprint("t3_41_000") != findings.fingerprint("t3_41_001")
        assert findings.fingerprint("t3_41_000") != findings.fingerprint("t3_99_000")


class TestDispositions:
    def test_round_trip(self, tmp_path):
        p = tmp_path / "d.yml"
        d = {
            "t1:reset_procedure": findings.Disposition(
                fingerprint="t1:reset_procedure",
                status=findings.FIXED,
                summary="hyphenated model shorthand did not resolve",
                fix="PR #3155",
                applied=True,
                first_seen="c1",
                last_seen="c1r4",
                convs=["t1_013_reset_procedure"],
            )
        }
        findings.save(d, p)
        back = findings.load(p)
        assert back["t1:reset_procedure"].status == findings.FIXED
        assert back["t1:reset_procedure"].applied is True
        assert back["t1:reset_procedure"].fix == "PR #3155"

    def test_missing_file_is_empty_not_an_error(self, tmp_path):
        assert findings.load(tmp_path / "nope.yml") == {}

    def test_unknown_status_is_rejected_loudly(self, tmp_path):
        p = tmp_path / "d.yml"
        p.write_text("t1:x:\n  status: PROBABLY_FINE\n", encoding="utf-8")
        with pytest.raises(ValueError, match="unknown status"):
            findings.load(p)

    def test_observe_creates_then_accumulates(self):
        d: dict[str, findings.Disposition] = {}
        findings.observe(d, "t1_013_reset_procedure", 1, "c1", summary="first")
        findings.observe(d, "t1_s42_013_reset_procedure", 1, "c1r4")
        assert list(d) == ["t1:reset_procedure"]
        row = d["t1:reset_procedure"]
        assert row.first_seen == "c1"
        assert row.last_seen == "c1r4"
        assert len(row.convs) == 2
        assert row.summary == "first"

    def test_observe_never_downgrades_a_human_decision(self):
        """A re-run must not silently reopen something already dispositioned."""
        d = {
            "t8:impatient": findings.Disposition(
                fingerprint="t8:impatient",
                status=findings.FALSE_POSITIVE,
                note="judge over-flagged an honest KB-gap admission",
                first_seen="c1",
            )
        }
        findings.observe(d, "t8_41_003_impatient", 8, "c2")
        assert d["t8:impatient"].status == findings.FALSE_POSITIVE
        assert d["t8:impatient"].last_seen == "c2"

    def test_regression_means_a_later_run_not_the_original_one(self):
        """The run that first caught the defect is not a regression of it."""
        d = findings.Disposition(
            fingerprint="t1:x",
            status=findings.FIXED,
            applied=True,
            first_seen="c1",
            last_seen="c1r1",
        )
        assert not findings.regressed(d, "c1")  # where it was found, pre-fix
        assert not findings.regressed(d, "c1r1")  # already recorded
        assert findings.regressed(d, "c2")  # new run, fix stopped holding

    def test_an_unfixed_finding_is_never_a_regression(self):
        d = findings.Disposition(fingerprint="t1:z", status=findings.OPEN, first_seen="c1")
        assert not findings.regressed(d, "c2")

    def test_a_fix_not_yet_merged_is_never_a_regression(self):
        """applied=false means the fix is not on main, so failing again is expected."""
        d = findings.Disposition(
            fingerprint="t1:w", status=findings.FIXED, applied=False, first_seen="c1"
        )
        assert not findings.regressed(d, "c2")


class TestReportComparison:
    """A tier that was not re-run must never be reported as fixed.

    c1r4 ran tiers 1-2 only. A naive set-difference against c1 announced the two
    tier-8 SUSPECTs as "now passing" — they had simply not been tested. That is
    the false reassurance the report exists to prevent.
    """

    @staticmethod
    def _v(conv, tier, verdict, campaign="x"):
        return dict(kind="verdict", conv=conv, tier=tier, verdict=verdict, deploy_sha="sha")

    def test_skipped_tier_is_not_reported_as_fixed(self):
        from tests.regime1_telethon.campaign import report

        previous = [
            self._v("t1_013_reset_procedure", 1, "FAIL"),
            self._v("t8_41_003_impatient", 8, "SUSPECT"),
        ]
        now = [self._v("t1_s42_013_reset_procedure", 1, "FAIL")]

        body = report.render("c1r4", now, {}, previous="c1", previous_verdicts=previous)

        assert "t8:impatient" not in body.split("**Now passing:**")[1].split("\n")[0]
        assert "Not re-run this round" in body
        assert "status UNKNOWN, not fixed" in body
        assert "t8:impatient" in body

    def test_a_genuinely_fixed_finding_is_reported_as_fixed(self):
        from tests.regime1_telethon.campaign import report

        previous = [self._v("t2_000_pivot_after_fault", 2, "FAIL")]
        now = [self._v("t2_s42_000_pivot_after_fault", 2, "PASS")]

        body = report.render("c2", now, {}, previous="c1", previous_verdicts=previous)
        passing_line = body.split("**Now passing:**")[1].split("\n")[0]
        assert "t2:pivot_after_fault" in passing_line

    def test_regression_is_called_out(self):
        from tests.regime1_telethon.campaign import findings, report

        disp = {
            "t1:reset_procedure": findings.Disposition(
                fingerprint="t1:reset_procedure",
                status=findings.FIXED,
                applied=True,
                fix="PR #3155",
                first_seen="c1",
                last_seen="c1r1",
            )
        }
        now = [self._v("t1_013_reset_procedure", 1, "FAIL")]
        body = report.render("c9", now, disp)
        assert "Regressions" in body
        assert "PR #3155" in body


class TestIssueBody:
    """A fingerprint covers a scenario FAMILY, and the mutator emits several
    language variants of it — some pass. The issue must cite only the failures."""

    def test_passing_variants_are_not_cited_as_evidence(self):
        from tests.regime1_telethon.campaign import findings, issues

        verdicts = [
            dict(kind="verdict", conv="t1_004_reset_procedure", tier=1, verdict="PASS"),
            dict(kind="verdict", conv="t1_013_reset_procedure", tier=1, verdict="FAIL"),
        ]
        d = findings.Disposition(fingerprint="t1:reset_procedure", summary="s")
        body = issues.build_body("t1:reset_procedure", d, "c1", verdicts)

        assert "t1_013_reset_procedure" in body
        assert "t1_004_reset_procedure" not in body, "a passing variant is not evidence"

    def test_the_replay_path_points_at_a_failing_transcript(self):
        from tests.regime1_telethon.campaign import findings, issues

        verdicts = [
            dict(kind="verdict", conv="t1_004_reset_procedure", tier=1, verdict="PASS"),
            dict(kind="verdict", conv="t1_013_reset_procedure", tier=1, verdict="FAIL"),
        ]
        d = findings.Disposition(fingerprint="t1:reset_procedure")
        body = issues.build_body("t1:reset_procedure", d, "c1", verdicts)
        assert "frozen/c1_t1_013_reset_procedure.json" in body

    def test_the_dedupe_marker_is_present_and_carries_the_fingerprint(self):
        from tests.regime1_telethon.campaign import findings, issues

        d = findings.Disposition(fingerprint="t8:impatient")
        verdicts = [dict(kind="verdict", conv="t8_41_003_impatient", tier=8, verdict="SUSPECT")]
        body = issues.build_body("t8:impatient", d, "c1", verdicts)
        assert issues.marker("t8:impatient") in body


class TestSummary:
    """The consolidated document's two load-bearing behaviours."""

    @staticmethod
    def _facts(campaign, tiers, verdicts, date="2026-08-08"):
        return dict(
            campaign=campaign,
            verdicts=verdicts,
            tiers=tiers,
            build="sha",
            passed=sum(1 for v in verdicts if v["verdict"] == "PASS"),
            total=len(verdicts),
            date=date,
        )

    def test_a_tier_that_was_not_run_is_marked_not_run_not_passing(self):
        from tests.regime1_telethon.campaign import summary

        facts = [
            self._facts(
                "c1",
                [1, 8],
                [
                    dict(conv="t1_000_x", tier=1, verdict="FAIL"),
                    dict(conv="t8_41_003_impatient", tier=8, verdict="SUSPECT"),
                ],
            ),
            # c1r4 ran tier 1 only — tier 8 must NOT read as a pass.
            self._facts("c1r4", [1], [dict(conv="t1_000_x", tier=1, verdict="FAIL")]),
        ]
        body = summary.render(facts, {})
        impatient_row = [ln for ln in body.splitlines() if ln.startswith("| `t8:impatient`")][0]
        assert summary.NOT_RUN in impatient_row, "a skipped tier must render as not-run"

    def test_always_green_scenarios_are_not_listed_as_findings(self):
        from tests.regime1_telethon.campaign import summary

        facts = [
            self._facts(
                "c1",
                [1],
                [
                    dict(conv="t1_000_greeting", tier=1, verdict="PASS"),
                    dict(conv="t1_001_broken", tier=1, verdict="FAIL"),
                ],
            )
        ]
        body = summary.render(facts, {})
        findings_section = body.split("## Finding")[1].split("## The findings")[0]
        assert "t1:broken" in findings_section
        assert "t1:greeting" not in findings_section, "a never-failing scenario is coverage"
        assert "t1:greeting" in body.split("## Coverage")[1]

    def test_runs_are_ordered_by_time_not_by_name(self):
        """c1r4 sorts before c2 alphabetically but ran after it would in name order —
        a mis-ordered matrix reads as a regression that never happened."""
        from tests.regime1_telethon.campaign import summary

        facts = [
            self._facts(
                "c1r4", [1], [dict(conv="t1_000_x", tier=1, verdict="FAIL")], date="2026-08-01"
            ),
            self._facts(
                "c2", [1], [dict(conv="t1_000_x", tier=1, verdict="PASS")], date="2026-08-02"
            ),
        ]
        body = summary.render(facts, {})
        header = [ln for ln in body.splitlines() if ln.startswith("| finding |")][0]
        assert header.index("c1r4") < header.index("c2")


class TestPhase0FlightSchool:
    """Gaps named by docs/superpowers/specs/2026-08-08-telethon-flight-school-design.md."""

    @staticmethod
    def _facts(campaign, tiers, verdicts, date="2026-08-08"):
        return dict(
            campaign=campaign,
            verdicts=verdicts,
            tiers=tiers,
            build="sha",
            passed=sum(1 for v in verdicts if v["verdict"] == "PASS"),
            total=len(verdicts),
            date=date,
        )

    def test_a_scenario_not_executed_is_not_run_even_when_its_tier_ran(self):
        """The spec's hardest rule: no unexecuted scenario may appear as PASS.

        Tier coverage is not scenario coverage. c2 below runs tier 1, but never
        runs `alpha` — inferring PASS from its sibling manufactures a green result.
        """
        from tests.regime1_telethon.campaign import summary

        facts = [
            self._facts("c1", [1], [
                dict(conv="t1_000_alpha", tier=1, verdict="FAIL"),
                dict(conv="t1_001_beta", tier=1, verdict="PASS"),
            ], date="2026-08-01"),
            self._facts("c2", [1], [dict(conv="t1_001_beta", tier=1, verdict="PASS")],
                        date="2026-08-02"),
        ]
        body = summary.render(facts, {})
        row = [ln for ln in body.splitlines() if ln.startswith("| `t1:alpha`")][0]
        c2_cell = row.split("|")[3].strip()
        assert c2_cell == summary.NOT_RUN, f"unexecuted scenario rendered as {c2_cell!r}"

    def test_every_campaign_seen_is_preserved_not_just_the_endpoints(self):
        """first_seen/last_seen lose the middle, and the middle is the shape."""
        d: dict[str, findings.Disposition] = {}
        for campaign in ("c1", "c1r2", "c2", "c3"):
            findings.observe(d, "t1_000_alpha", 1, campaign)
        row = d["t1:alpha"]
        assert row.seen_in == ["c1", "c1r2", "c2", "c3"]
        assert row.first_seen == "c1"
        assert row.last_seen == "c3"

    def test_a_run_already_on_record_is_not_a_regression(self):
        d = findings.Disposition(
            fingerprint="t1:x", status=findings.FIXED, applied=True,
            first_seen="c1", last_seen="c3", seen_in=["c1", "c1r2", "c3"],
        )
        assert not findings.regressed(d, "c1r2"), "a mid-history run is already known"
        assert findings.regressed(d, "c4"), "a run never seen before means it came back"

    def test_issue_dedupe_keys_on_the_defect_not_the_scenario(self):
        """One root cause revealed by two scenarios is ONE issue."""
        from tests.regime1_telethon.campaign import issues

        a = findings.Disposition(fingerprint="t1:reset_procedure", defect_id="CIT-005")
        b = findings.Disposition(fingerprint="t1:symptom_report", defect_id="CIT-005")
        assert issues.dedupe_key("t1:reset_procedure", a) == "CIT-005"
        assert issues.dedupe_key("t1:symptom_report", b) == "CIT-005"
        assert issues.marker("t1:reset_procedure", a) == issues.marker("t1:symptom_report", b)

    def test_dedupe_falls_back_to_the_scenario_until_a_defect_is_adjudicated(self):
        from tests.regime1_telethon.campaign import issues

        d = findings.Disposition(fingerprint="t1:reset_procedure")
        assert issues.dedupe_key("t1:reset_procedure", d) == "t1:reset_procedure"
        assert issues.dedupe_key("t1:reset_procedure", None) == "t1:reset_procedure"

    def test_defect_id_and_seen_in_survive_a_round_trip(self, tmp_path):
        p = tmp_path / "d.yml"
        findings.save({
            "t1:x": findings.Disposition(
                fingerprint="t1:x", defect_id="CIT-005", seen_in=["c1", "c2"]
            )
        }, p)
        back = findings.load(p)["t1:x"]
        assert back.defect_id == "CIT-005"
        assert back.seen_in == ["c1", "c2"]
