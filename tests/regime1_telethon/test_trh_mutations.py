"""TRH v2 — the mutation runner, and the guarantee it must never break.

`test_never_leaves_a_mutant_on_disk` is here because the runner DID leave one.
An early version wrote `bytes` through `write_text`, raised TypeError from
inside `finally`, and left `oracles.py` in the working tree with its vendor
scope deleted — silently converting the harness's core distinction into a
no-op. A tool that edits real source files earns this test.
"""

from __future__ import annotations

import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from tests.regime1_telethon.campaign.trh import mutations as mut  # noqa: E402


@pytest.fixture()
def scratch(tmp_path, monkeypatch):
    """A throwaway file under a fake REPO so nothing real is touched."""
    target = tmp_path / "victim.py"
    target.write_bytes(b"def f():\n    return GUARDED\n")
    monkeypatch.setattr(mut, "REPO", tmp_path)
    return target


def _m(**kw) -> mut.Mutation:
    base = dict(
        id="t",
        protects="p",
        target="victim.py",
        find="GUARDED",
        replace="BROKEN",
        guard_test="does/not/matter",
    )
    base.update(kw)
    return mut.Mutation(**base)


class TestRegistry:
    def test_every_mutation_names_what_it_protects_and_why(self):
        for m in mut.MUTATIONS:
            assert m.protects.strip(), f"{m.id} has no `protects`"
            assert m.why.strip(), f"{m.id} has no `why` — a reviewer cannot judge it"

    def test_every_mutation_has_a_guard_test(self):
        for m in mut.MUTATIONS:
            assert "::" in m.guard_test or m.guard_test.endswith(".py"), m.id

    def test_registry_covers_the_harness_core_claims(self):
        """If these three ever leave the registry, the harness is unverified."""
        ids = {m.id for m in mut.MUTATIONS}
        assert "upstream_first_precedence_reversed" in ids
        assert "ingest_scope_dropped" in ids
        assert "not_observed_folded_into_pass" in ids


class TestRunnerSafety:
    def test_never_leaves_a_mutant_on_disk_even_when_the_guard_explodes(self, scratch):
        """The regression that actually happened."""

        def boom(selector, timeout=900):
            raise RuntimeError("guard runner died")

        mut._run_guard = boom  # type: ignore[assignment]
        try:
            mut.run_one(_m(), allow_dirty=True)
        finally:
            mut._run_guard = mut.__dict__["_run_guard"]
        assert scratch.read_bytes() == b"def f():\n    return GUARDED\n"

    def test_restores_bytes_exactly_including_line_endings(self, scratch):
        """LF must not come back as CRLF: that shows up as a phantom dirty file."""
        scratch.write_bytes(b"a = 1\nGUARDED\nb = 2\n")
        mut._run_guard = lambda s, timeout=900: (True, "")  # type: ignore[assignment]
        mut.run_one(_m(), allow_dirty=True)
        assert scratch.read_bytes() == b"a = 1\nGUARDED\nb = 2\n"
        assert b"\r\n" not in scratch.read_bytes()

    def test_refuses_to_mutate_a_dirty_file(self, scratch, monkeypatch):
        monkeypatch.setattr(mut, "_is_dirty", lambda p: True)
        r = mut.run_one(_m())
        assert r.status == mut.SKIPPED
        assert "uncommitted" in r.detail

    def test_missing_find_string_is_stale_never_proven(self, scratch):
        """A no-op mutation would certify a protection that may not exist."""
        r = mut.run_one(_m(find="NOT_IN_THE_FILE"), allow_dirty=True)
        assert r.status == mut.STALE
        assert not r.ok

    def test_missing_target_is_stale(self, scratch):
        r = mut.run_one(_m(target="nope.py"), allow_dirty=True)
        assert r.status == mut.STALE


class TestVerdicts:
    def test_guard_failing_means_proven(self, scratch):
        mut._run_guard = lambda s, timeout=900: (True, "1 failed")  # type: ignore[assignment]
        assert mut.run_one(_m(), allow_dirty=True).status == mut.PROVEN

    def test_guard_staying_green_means_the_test_is_vacuous(self, scratch):
        mut._run_guard = lambda s, timeout=900: (False, "5 passed")  # type: ignore[assignment]
        r = mut.run_one(_m(), allow_dirty=True)
        assert r.status == mut.NOT_PROVEN
        assert "vacuous" in r.detail


class TestSummary:
    def test_separates_unmerged_targets_from_genuinely_stale_ones(self):
        """Lumping them together trains readers to ignore the section that matters."""
        results = [
            mut.MutationResult(_m(id="pending", requires="PR #123"), mut.STALE, "x"),
            mut.MutationResult(_m(id="rotted"), mut.STALE, "code moved"),
        ]
        out = mut.summarize(results)
        assert "Not applicable on this branch" in out
        assert "needs PR #123" in out
        assert "🚨 STALE" in out
        assert "rotted" in out.split("🚨 STALE")[1]

    def test_calls_out_vacuous_tests_by_name(self):
        results = [mut.MutationResult(_m(id="v", guard_test="a::b"), mut.NOT_PROVEN, "green")]
        out = mut.summarize(results)
        assert "Vacuous" in out and "a::b" in out


def test_the_real_registry_leaves_the_tree_clean():
    """Integration: run the registry for real and assert `git status` is unchanged.

    Skipped when the tree is already dirty — the assertion would be meaningless.
    """
    before = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=mut.REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
    ).stdout
    if before.strip():
        pytest.skip("working tree already dirty; cannot attribute a change to the runner")
    mut.run_all()
    after = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=mut.REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
    ).stdout
    assert after == before, f"the mutation run left the tree dirty:\n{after}"
