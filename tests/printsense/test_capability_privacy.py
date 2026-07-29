"""Phase-1 capability bench — privacy & hermeticity guards.

The bench's artifacts go to an admin's phone and its fixtures are committed:
prove the artifacts carry no absolute paths/secrets, the committed corpus is
fully fictional, and the bench source cannot reach a paid SDK or the network.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

pytest.importorskip("pydantic")

from printsense.benchmarks import capability_bench as cb  # noqa: E402
from printsense.benchmarks import golden_corpus as gc  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
_BENCH_SOURCES = (
    REPO / "printsense/benchmarks/capability_bench.py",
    REPO / "printsense/benchmarks/golden_corpus.py",
    Path(__file__),
    REPO / "tests/printsense/test_capability_bench.py",
)


def test_artifacts_pass_self_audit():
    env = cb.run_corpus(enforce_freeze=False)
    for artifact in (cb.render_report(env), cb.stable_envelope_json(env), cb.phone_summary(env)):
        assert cb.audit_artifact(artifact) == [], artifact[:200]


def test_artifact_audit_has_teeth():
    """Positive controls: the auditor must catch every violation class.
    Probe strings are built dynamically so the literals never appear in this
    committed file (the path scan below covers committed sources)."""
    win_path = "C:" + "\\" + "Users" + "\\" + "nobody" + "\\" + "x.json"
    assert "absolute_windows_path" in cb.audit_artifact("see " + win_path)
    unix_path = "/" + "data" + "/printsense_commercial/t1"
    assert "absolute_unix_path" in cb.audit_artifact("stored at " + unix_path)
    assert "secret_assignment" in cb.audit_artifact(
        "api_" + 'key = "' + "AbCdEf0123456789XyZ" + '"'
    )
    assert "telegram_bot_token" in cb.audit_artifact("8721928417:" + "AA" * 18)
    assert cb.audit_artifact("devices: 3, xrefs: 2, sheet 91") == []


def test_committed_corpus_is_fictional_only():
    """Every device/cable/misread in committed truth follows the fictional
    9x-sheet grammar — no room for a real-world identifier to hide."""
    fictional = re.compile(
        r"^(-9\d/[A-Z][A-Z0-9]{2}(:[A-Z0-9]+)?|-W\d{3,4}[A-Z]?|"
        r"-WK\d{3,4}|-9[A-Z]/[A-Z]\d{2}|-9\d/\d[A-Z0-9]{2}|"
        r"-[A-Z]\d/[A-Z]\d{2}|10\d[A-Z]{1,2}|1LS)$"
    )
    for case in gc.CASES:
        t = case["truth"]
        for d in t["devices"]:
            assert fictional.match(d["tag"]), d["tag"]
        for m in t.get("known_misreads", []):
            assert fictional.match(m), m
        for w in t.get("cables", []):
            assert fictional.match(w), w


def test_no_absolute_paths_in_committed_bench_files():
    # pattern assembled from pieces so its own source line can never match
    sep = "/"
    pat = re.compile("|".join((r"[A-Za-z]:\\" + "Users", sep + "home" + sep, sep + "Users" + sep)))
    for src in _BENCH_SOURCES:
        assert not pat.search(src.read_text(encoding="utf-8")), src.name


def test_bench_sources_import_no_paid_sdk_or_network():
    """Hermeticity is load-bearing: the CI gate installs no anthropic SDK and
    the bot command must never trigger a paid call. Enforce at import level."""
    forbidden = re.compile(
        r"^\s*(import|from)\s+(anthropic|httpx|requests|socket|urllib|aiohttp)\b", re.MULTILINE
    )
    for src in _BENCH_SOURCES:
        assert not forbidden.search(src.read_text(encoding="utf-8")), src.name


def test_matrix_judge_lanes_never_own_truth():
    """The capability matrix may defer lanes to a judge for CLARITY only —
    no judge lane may be marked as owning a deterministic metric."""
    import json

    matrix = json.loads(
        (REPO / "printsense/benchmarks/capability_matrix.json").read_text(encoding="utf-8")
    )
    assert matrix["_meta"]["truth_status"] == "synthetic"
    for name, row in matrix["capabilities"].items():
        assert row["grading"] in ("deterministic", "constrained_judge", "human_confirmed"), name
        assert row["phase1"] in ("graded", "graded_existing", "partial", "deferred"), name
        if row["grading"] == "constrained_judge":
            assert row["phase1"] in ("deferred", "partial"), (
                f"{name}: a judge lane cannot be fully graded in the deterministic-only Phase 1"
            )
