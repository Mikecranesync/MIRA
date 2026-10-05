"""Contract for tools/r2_signal_floor.py — the R2/R3 mechanical floor (SDLC v1 §2.3).

Pure core (`classify_paths`, `parse_declared_risk`, `evaluate`) plus the CLI over the
lifecycle guard's changed-files JSON-lines shape. Every signal path asserted here is a
real repository path (a floor over phantom paths would protect nothing).
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "r2_signal_floor.py"

_spec = importlib.util.spec_from_file_location("r2_signal_floor", TOOL)
assert _spec is not None and _spec.loader is not None
floor = importlib.util.module_from_spec(_spec)
# dataclasses resolve string annotations through sys.modules[cls.__module__]
sys.modules["r2_signal_floor"] = floor
_spec.loader.exec_module(floor)


# ── signal paths are real ──────────────────────────────────────────────────


def test_every_signal_path_exists_in_the_repository():
    for _, pattern in floor._R3_SIGNALS + floor._R2_SIGNALS:
        assert (REPO / pattern.rstrip("/")).exists(), f"signal path is not in the repo: {pattern}"


# ── classification ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path,kind,cls",
    [
        ("mira-bots/shared/guardrails.py", "safety", "R3"),
        ("mira-hub/src/capabilities/answer-validation.ts", "safety", "R3"),
        ("mira-hub/src/lib/session.ts", "tenant", "R3"),
        ("mira-hub/db/migrations/104_new_table.sql", "migration", "R3"),
        ("mira-core/mira-ingest/db/migrations/014_x.sql", "migration", "R3"),
        # its expand labels decide rollback readiness (SDLC v1 step 10): a relabel is R3
        ("tools/migration_compat.txt", "migration", "R3"),
        ("mira-bots/shared/engine.py", "retrieval", "R2"),
        ("mira-bots/shared/inference/router.py", "retrieval", "R2"),
        ("mira-hub/src/lib/manual-rag.ts", "retrieval", "R2"),
        ("tests/eval/cases/foo.json", "retrieval", "R2"),
    ],
)
def test_signal_paths_classify(path, kind, cls):
    (hit,) = floor.classify_paths([path])
    assert (hit.kind, hit.floor, hit.path) == (kind, cls, path)


@pytest.mark.parametrize(
    "path",
    [
        "docs/architecture/mira-sdlc-v1.md",
        "mira-hub/src/lib/manual-rag.test.ts",  # exact-file signal: siblings are not signals
        "mira-bots/shared/engine_helpers.py",  # prefix is never a substring match
        "tests/test_r2_signal_floor.py",
        "mira-hub/db/migrations",  # the dir itself, no trailing content
    ],
)
def test_non_signal_paths_do_not_classify(path):
    assert floor.classify_paths([path]) == ()


def test_r3_wins_over_r2_for_one_path():
    # neon_recall.py is a tenant (R3) signal; it must not be downgraded to retrieval.
    (hit,) = floor.classify_paths(["mira-bots/shared/neon_recall.py"])
    assert hit.floor == "R3"


# ── Risk line ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "body,expected",
    [
        ("Risk: R2 — retrieval ranking change", "R2"),
        ("## Summary\n\nRisk: R3 — migration\n", "R3"),
        ("  Risk:R1 — tight", "R1"),
        ("Risk: R_ — <one-line reason>", None),  # the template placeholder
        ("Risk: R4 — nope", None),
        ("risk: R2", None),  # case matters: the template writes `Risk:`
        ("", None),
    ],
)
def test_declared_risk_parsing(body, expected):
    assert floor.parse_declared_risk(body) == expected


def test_first_risk_line_wins():
    assert floor.parse_declared_risk("Risk: R1 — a\nRisk: R3 — b") == "R1"


# ── evaluate ───────────────────────────────────────────────────────────────


def test_no_signal_paths_pass_even_without_a_risk_line():
    v = floor.evaluate(["docs/foo.md", "README.md"], "")
    assert (v.status, v.floor) == ("PASS", None)


def test_signal_path_without_risk_line_fails():
    v = floor.evaluate(["mira-bots/shared/engine.py"], "no risk line here")
    assert (v.status, v.floor, v.declared) == ("FAIL", "R2", None)


def test_under_declared_fails_and_names_the_floor():
    v = floor.evaluate(["mira-hub/db/migrations/104.sql"], "Risk: R1 — small")
    assert (v.status, v.floor, v.declared) == ("FAIL", "R3", "R1")
    assert "never lowers the floor" in v.reason


def test_declared_at_or_above_the_floor_passes():
    assert floor.evaluate(["mira-bots/shared/engine.py"], "Risk: R2 — x").status == "PASS"
    assert floor.evaluate(["mira-bots/shared/engine.py"], "Risk: R3 — x").status == "PASS"


def test_floor_is_the_max_over_all_signals():
    v = floor.evaluate(
        ["mira-bots/shared/engine.py", "mira-bots/shared/guardrails.py"], "Risk: R2 — x"
    )
    assert (v.status, v.floor) == ("FAIL", "R3")


# ── changed-files loader (the guard's data shape) ──────────────────────────


def test_loader_reads_jsonl_and_includes_rename_origins(tmp_path):
    f = tmp_path / "changes.jsonl"
    f.write_text(
        json.dumps({"filename": "a.py", "status": "modified", "previous_filename": None})
        + "\n"
        + json.dumps(
            {
                "filename": "mira-bots/shared/engine.py",
                "status": "renamed",
                "previous_filename": "mira-bots/shared/guardrails.py",
            }
        )
        + "\n"
    )
    assert floor.load_changed_paths(f) == [
        "a.py",
        "mira-bots/shared/engine.py",
        "mira-bots/shared/guardrails.py",
    ]


@pytest.mark.parametrize("bad", ['"just a string"', '{"status": "modified"}', "[1,2]"])
def test_loader_fails_closed_on_malformed_rows(tmp_path, bad):
    f = tmp_path / "changes.jsonl"
    f.write_text(bad + "\n")
    with pytest.raises(ValueError):
        floor.load_changed_paths(f)


# ── CLI ────────────────────────────────────────────────────────────────────


def _cli(tmp_path, rows, body):
    changes = tmp_path / "changes.jsonl"
    changes.write_text("".join(json.dumps(r) + "\n" for r in rows))
    pr_body = tmp_path / "body.md"
    pr_body.write_text(body)
    summary = tmp_path / "summary.md"
    return (
        subprocess.run(
            [
                sys.executable,
                "-I",
                str(TOOL),
                "--changes-json-file",
                str(changes),
                "--pr-body-file",
                str(pr_body),
                "--summary-file",
                str(summary),
            ],
            capture_output=True,
            text=True,
        ),
        summary,
    )


def test_cli_passes_and_writes_the_summary(tmp_path):
    res, summary = _cli(
        tmp_path, [{"filename": "mira-bots/shared/engine.py", "status": "modified"}], "Risk: R2 — x"
    )
    assert res.returncode == 0, res.stderr
    assert "R2 signal floor: PASS" in res.stdout
    assert "R2 retrieval mira-bots/shared/engine.py" in summary.read_text()


def test_cli_fails_on_an_under_declared_signal_change(tmp_path):
    res, _ = _cli(
        tmp_path,
        [{"filename": "mira-bots/shared/guardrails.py", "status": "modified"}],
        "Risk: R1 — x",
    )
    assert res.returncode == 1
    assert "::error::" in res.stderr and "R3" in res.stderr


def test_cli_fails_closed_on_malformed_input(tmp_path):
    changes = tmp_path / "changes.jsonl"
    changes.write_text("{not json\n")
    body = tmp_path / "body.md"
    body.write_text("Risk: R3 — x")
    res = subprocess.run(
        [
            sys.executable,
            "-I",
            str(TOOL),
            "--changes-json-file",
            str(changes),
            "--pr-body-file",
            str(body),
        ],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 2 and "::error::" in res.stderr


# ── workflow contract ──────────────────────────────────────────────────────


def test_workflow_installs_the_hash_locked_test_deps_before_the_self_test():
    """Codex F3 on PR #4218: setup-python ships no pytest; the lock must be installed first."""
    import yaml

    wf = yaml.safe_load((REPO / ".github" / "workflows" / "r2-signal-floor.yml").read_text())
    steps = wf["jobs"]["evaluate"]["steps"]
    names = [s.get("name") for s in steps]
    install = names.index("Install trusted-base test dependencies")
    assert (
        install
        < names.index("Evaluate the R2 signal floor")
        < names.index("Run trusted-base floor tests")
    )
    run = steps[install]["run"]
    assert "--require-hashes" in run and "-r requirements/ui-lifecycle-guard.txt" in run
    lock = (REPO / "requirements" / "ui-lifecycle-guard.txt").read_text()
    assert "pytest==" in lock, "the reused lock must actually carry pytest"
    # The guard's trust shape: evaluation runs with no token on the trusted base only.
    evaluate = steps[names.index("Evaluate the R2 signal floor")]
    assert "env" not in evaluate and "GH_TOKEN" not in json.dumps(evaluate)
    checkout = next(s for s in steps if str(s.get("uses", "")).startswith("actions/checkout@"))
    assert checkout["with"]["ref"] == "${{ needs.snapshot.outputs.base_sha }}"
    assert checkout["with"]["persist-credentials"] is False
