"""Contract for tools/rollback_candidates.py (SDLC v1 §10.2, Part B step 10).

Receipt fixtures mirror the three real production receipts of 2026-09-27..10-01
(runs 36350115024, 36369296665, 36805202089): the newest deploy covered only
mira-hub + mira-ask, so mira-web's current production SHA lives in an OLDER receipt —
the per-service walk is the point, not a convenience.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "rollback_candidates.py"

_spec = importlib.util.spec_from_file_location("rollback_candidates", TOOL)
assert _spec is not None and _spec.loader is not None
rc = importlib.util.module_from_spec(_spec)
sys.modules["rollback_candidates"] = rc
_spec.loader.exec_module(rc)

A = "0994b31a453cd0789661e21bb22db8f3e5eb926e"  # 2026-09-27, hub+web+ask
B = "76887423c6c84d0871d531af98927423b02bfb5a"  # 2026-09-28, hub+web+ask
C = "648896996d906b4c1df828a3eafd0771f6534a27"  # 2026-10-01, hub+ask only
NEW = "33dc98f6bac948a2587ed980c938b71d0fa4434a"
IMG = "sha256:" + "a" * 64
ALL = ("mira-hub", "mira-web", "mira-ask")


def receipt(sha: str, run_id: str, deployed_at: str, services=ALL, **extra) -> dict:
    data = {
        "schema": "factorylm.deploy-receipt/1",
        "environment": "production",
        "approved_rc_sha": sha,
        "run_id": run_id,
        "run_url": f"https://github.com/Mikecranesync/MIRA/actions/runs/{run_id}",
        "deployed_at": deployed_at,
        "built_images": {s: IMG for s in services},
        "running_images": {s: IMG for s in services},
        "runtime": {s: sha for s in services if s != "mira-ask"},
        "target": {"host": "h", "compose": "c"},
        "prior": {"sha": "f" * 40, "tag": None},
        "release_tag": "v1.0.0",
    }
    data.update(extra)
    return data


def write(root: Path, *receipts: dict) -> Path:
    for r in receipts:
        d = root / str(r["run_id"])
        d.mkdir(parents=True)
        (d / "production-receipt.json").write_text(json.dumps(r), encoding="utf-8")
    return root


def real_three(tmp_path: Path) -> Path:
    return write(
        tmp_path / "r",
        receipt(A, "36350115024", "2026-09-27T21:04:48Z"),
        receipt(B, "36369296665", "2026-09-28T02:23:24Z"),
        receipt(C, "36805202089", "2026-10-01T02:23:34Z", services=("mira-hub", "mira-ask")),
    )


def cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-I", str(TOOL), *args], capture_output=True, text=True, timeout=60
    )


# ── candidates for a deploy ──────────────────────────────────────────────────


def test_candidates_walk_per_service_not_per_receipt(tmp_path):
    cands = rc.candidates_for_deploy(rc.load_receipts(real_three(tmp_path)), NEW, ALL)
    assert cands["mira-hub"]["sha"] == C and cands["mira-hub"]["from_run_id"] == "36805202089"
    assert cands["mira-ask"]["sha"] == C
    # mira-web was NOT in the newest receipt: its current production SHA is B's.
    assert cands["mira-web"]["sha"] == B and cands["mira-web"]["from_run_id"] == "36369296665"
    assert rc.candidate_problems(cands, ALL, NEW) == []


def test_redeploying_the_current_sha_falls_through_to_the_one_before(tmp_path):
    cands = rc.candidates_for_deploy(rc.load_receipts(real_three(tmp_path)), C, ALL)
    assert {s: e["sha"] for s, e in cands.items()} == {s: B for s in ALL}


def test_a_service_never_receipted_gets_an_explicit_null(tmp_path):
    cands = rc.candidates_for_deploy(
        rc.load_receipts(real_three(tmp_path)), NEW, ("mira-pipeline",)
    )
    assert cands["mira-pipeline"]["sha"] is None and cands["mira-pipeline"]["from_run_id"] is None
    assert "no earlier production receipt" in cands["mira-pipeline"]["reason"]


def test_a_first_ever_deploy_with_no_receipts_still_stamps(tmp_path):
    """No production receipt anywhere: every service gets a null candidate, and stamp accepts it."""
    receipts = rc.load_receipts(tmp_path / "never-created")
    assert receipts == []
    cands = rc.candidates_for_deploy(receipts, NEW, ALL)
    assert {s: c["sha"] for s, c in cands.items()} == dict.fromkeys(ALL)
    assert rc.candidate_problems(cands, ALL, NEW) == []


def test_order_is_deployed_at_not_directory_name(tmp_path):
    root = write(
        tmp_path / "r",
        receipt(B, "900", "2026-09-28T02:23:24Z"),  # newer by time, smaller run id
        receipt(A, "999", "2026-09-27T21:04:48Z"),
    )
    assert (
        rc.candidates_for_deploy(rc.load_receipts(root), NEW, ("mira-hub",))["mira-hub"]["sha"] == B
    )


@pytest.mark.parametrize(
    "mutate,needle",
    [
        (lambda r: r.update(environment="staging"), "not a production"),
        (lambda r: r.update(schema="x"), "not a production"),
        (lambda r: r.update(approved_rc_sha="abc"), "approved_rc_sha"),
        (lambda r: r.update(run_id="1"), "artifact came from run"),
        (lambda r: r.update(built_images={}), "built_images"),
        (lambda r: r.update(deployed_at="yesterday"), "timestamp"),
        (lambda r: r.update(rollback_candidate={"mira-hub": {"sha": A}}), "rollback_candidate"),
    ],
)
def test_a_malformed_receipt_fails_closed(tmp_path, mutate, needle):
    r = receipt(A, "36350115024", "2026-09-27T21:04:48Z")
    mutate(r)
    root = write(tmp_path / "r", r) if r["run_id"] == "36350115024" else tmp_path / "r"
    if r["run_id"] != "36350115024":  # write under the run it claims NOT to be
        d = root / "36350115024"
        d.mkdir(parents=True)
        (d / "production-receipt.json").write_text(json.dumps(r), encoding="utf-8")
    with pytest.raises(ValueError, match=needle):
        rc.load_receipts(root)


def test_a_non_run_id_directory_fails_closed(tmp_path):
    (tmp_path / "r" / "latest").mkdir(parents=True)
    with pytest.raises(ValueError, match="not a run id"):
        rc.load_receipts(tmp_path / "r")


def test_candidates_cli_prints_one_line_of_json(tmp_path):
    out = cli(
        "candidates",
        "--receipts-dir",
        str(real_three(tmp_path)),
        "--deploying",
        NEW,
        "--services",
        "mira-hub mira-web mira-ask",
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.count("\n") == 1  # safe for $GITHUB_OUTPUT
    assert json.loads(out.stdout)["mira-web"]["sha"] == B


# ── stamp ────────────────────────────────────────────────────────────────────


def _stamp(tmp_path, receipt_obj, cands, services="mira-hub mira-web mira-ask"):
    path = tmp_path / "production-receipt.json"
    path.write_text(json.dumps(receipt_obj), encoding="utf-8")
    res = cli(
        "stamp",
        "--receipt",
        str(path),
        "--candidates-json",
        json.dumps(cands),
        "--services",
        services,
    )
    return res, json.loads(path.read_text(encoding="utf-8"))


def test_stamp_records_the_candidates(tmp_path):
    cands = rc.candidates_for_deploy(rc.load_receipts(real_three(tmp_path)), NEW, ALL)
    res, out = _stamp(tmp_path, receipt(NEW, "1", "2026-10-04T00:00:00Z"), cands)
    assert res.returncode == 0, res.stderr
    assert out["rollback_candidate"] == cands


@pytest.mark.parametrize(
    "cands,needle",
    [
        ({"mira-hub": {"sha": A, "from_run_id": "1", "reason": "r"}}, "deploy target set"),
        (
            {s: {"sha": NEW, "from_run_id": "1", "reason": "r"} for s in ALL},
            "equals the SHA being deployed",
        ),
        ({s: {"sha": "x", "from_run_id": "1", "reason": "r"} for s in ALL}, "40-hex"),
        (
            {s: {"sha": None, "from_run_id": "1", "reason": "r"} for s in ALL},
            "from_run_id without a sha",
        ),
        ({s: {"sha": A, "from_run_id": "1", "reason": ""} for s in ALL}, "reason"),
        ({s: {"sha": A, "from_run_id": "1"} for s in ALL}, "keys must be exactly"),
        ({s: {"sha": A, "from_run_id": "run-1", "reason": "r"} for s in ALL}, "not a run id"),
    ],
)
def test_stamp_refuses_a_bad_candidate_map(tmp_path, cands, needle):
    res, out = _stamp(tmp_path, receipt(NEW, "1", "2026-10-04T00:00:00Z"), cands)
    assert res.returncode == 2 and needle in res.stderr
    assert "rollback_candidate" not in out


def test_a_stamped_receipt_still_verifies_as_production(tmp_path):
    """The deploy job verifies AFTER stamping: the new field must not change the verdict."""
    spec = importlib.util.spec_from_file_location(
        "staging_receipt", REPO / "tools" / "staging_receipt.py"
    )
    sr = importlib.util.module_from_spec(spec)
    sys.modules["staging_receipt"] = sr
    spec.loader.exec_module(sr)
    at = "2026-10-04T12:00:00Z"
    path = tmp_path / "production-receipt.json"
    path.write_text(json.dumps(receipt(NEW, "36900000002", at)))
    cands = rc.candidates_for_deploy(rc.load_receipts(real_three(tmp_path)), NEW, ALL)

    def problems() -> list[str]:
        return sr.verify_receipt(
            json.loads(path.read_text()),
            approved_rc_sha=NEW,
            environment="production",
            now=datetime(2026, 10, 4, 12, 30, tzinfo=timezone.utc),
            max_age_hours=1,
            required_images=ALL,
        )

    assert problems() == []
    rc.main(
        [
            "stamp",
            "--receipt",
            str(path),
            "--candidates-json",
            json.dumps(cands),
            "--services",
            " ".join(ALL),
        ]
    )
    assert "rollback_candidate" in json.loads(path.read_text())
    assert problems() == []


def test_stamp_on_a_rerun_attempt_records_every_candidate_unresolved(tmp_path):
    path = tmp_path / "production-receipt.json"
    path.write_text(json.dumps(receipt(NEW, "36900000002", "2026-10-04T12:00:00Z")))
    cands = rc.candidates_for_deploy(rc.load_receipts(real_three(tmp_path)), NEW, ALL)
    rc.main(
        [
            "stamp",
            "--receipt",
            str(path),
            "--candidates-json",
            json.dumps(cands),
            "--services",
            " ".join(ALL),
            "--attempt",
            "2",
        ]
    )
    stamped = json.loads(path.read_text())["rollback_candidate"]
    assert all(e["sha"] is None and "attempt 2" in e["reason"] for e in stamped.values())
    assert rc.candidate_problems(stamped, ALL, NEW) == []


def test_designate_loses_a_service_whose_recorded_candidate_is_unresolved(tmp_path):
    """An unresolved null is uncertainty, not bootstrap: it must reach an incident."""
    unresolved = {
        s: {
            "sha": None,
            "from_run_id": None,
            "reason": "unresolved: run 1 may hold a newer deployment",
        }
        for s in ALL
    }
    plain_null = {
        s: {"sha": None, "from_run_id": None, "reason": "no earlier production receipt"}
        for s in ALL
    }
    r1 = rc.load_receipts(
        write(
            tmp_path / "a",
            receipt(C, "36805202089", "2026-10-01T02:23:34Z", rollback_candidate=unresolved),
        )
    )
    r2 = rc.load_receipts(
        write(
            tmp_path / "b",
            receipt(C, "36805202089", "2026-10-01T02:23:34Z", rollback_candidate=plain_null),
        )
    )
    assert sorted(rc.designate(r1, inventory=ALL)["lost"]) == sorted(ALL)
    assert rc.designate(r2, inventory=ALL)["lost"] == {}


def test_stamp_never_overwrites(tmp_path):
    cands = {s: {"sha": A, "from_run_id": "1", "reason": "r"} for s in ALL}
    res, _ = _stamp(
        tmp_path, receipt(NEW, "1", "2026-10-04T00:00:00Z", rollback_candidate=cands), cands
    )
    assert res.returncode == 2 and "refusing to overwrite" in res.stderr


# ── designate ────────────────────────────────────────────────────────────────


def test_designate_reports_an_inventory_service_lost_beyond_the_walk(tmp_path):
    """Codex #4222 r1 F1: a service the walk could not see is LOST, never silently absent."""
    receipts = rc.load_receipts(
        write(
            tmp_path / "r",
            receipt(C, "36805202089", "2026-10-01T02:23:34Z", services=("mira-hub",)),
        )
    )
    d = rc.designate(receipts, inventory=ALL)
    assert sorted(d["lost"]) == ["mira-ask", "mira-web"]
    assert all("no readable production receipt" in why for why in d["lost"].values())
    assert "mira-hub" in d["undesignated"] and "mira-hub" not in d["lost"]


def test_designate_reports_an_unreadable_inventory_service_lost_even_without_a_gap(tmp_path):
    """Codex #4222 r2 F1: GitHub omits expired artifacts and deletes old runs, so a missing
    receipt is missing history, never 'never deployed'."""
    receipts = rc.load_receipts(
        write(
            tmp_path / "r",
            receipt(C, "36805202089", "2026-10-01T02:23:34Z", services=("mira-hub",)),
        )
    )
    d = rc.designate(receipts, inventory=ALL)
    assert sorted(d["lost"]) == ["mira-ask", "mira-web"]
    assert "mira-web" not in d["undesignated"] and "mira-hub" in d["undesignated"]


def test_designate_with_a_gap_but_full_coverage_loses_nothing(tmp_path):
    receipts = rc.load_receipts(
        write(tmp_path / "r", receipt(C, "36805202089", "2026-10-01T02:23:34Z"))
    )
    assert rc.designate(receipts, inventory=ALL)["lost"] == {}


def test_designate_cli_takes_the_inventory_and_the_gap(tmp_path):
    root = write(
        tmp_path / "r", receipt(C, "36805202089", "2026-10-01T02:23:34Z", services=("mira-hub",))
    )
    out = tmp_path / "d.json"
    rc.main(
        [
            "designate",
            "--receipts-dir",
            str(root),
            "--out",
            str(out),
            "--inventory",
            "mira-hub mira-web",
        ]
    )
    assert sorted(json.loads(out.read_text())["lost"]) == ["mira-web"]


def _gap(run: str, updated: str, reason: str = "receipt gone after a successful upload"):
    return rc.Gap(run, rc._parse_ts(updated), reason)


def test_a_gap_newer_than_the_candidate_leaves_it_unresolved(tmp_path):
    """Codex #4222 r3 F7: a vanished re-run may hold the newest deployment."""
    receipts = rc.load_receipts(real_three(tmp_path))
    gaps = [_gap("36000000100", "2026-10-02T09:00:00Z")]
    cands = rc.candidates_for_deploy(receipts, NEW, ALL, gaps)
    assert {s: c["sha"] for s, c in cands.items()} == dict.fromkeys(ALL)
    assert all("unresolved: run 36000000100" in c["reason"] for c in cands.values())
    assert rc.candidate_problems(cands, ALL, NEW) == [], "the stamp still accepts it"


def test_a_gap_older_than_every_candidate_changes_nothing(tmp_path):
    receipts = rc.load_receipts(real_three(tmp_path))
    plain = rc.candidates_for_deploy(receipts, NEW, ALL)
    old = rc.candidates_for_deploy(
        receipts, NEW, ALL, [_gap("36000000100", "2026-06-01T00:00:00Z")]
    )
    assert old == plain


def test_a_gap_is_per_service(tmp_path):
    """Updated after Web's candidate (09-28) but before Hub's (10-01): only Web is unresolved."""
    receipts = rc.load_receipts(real_three(tmp_path))
    cands = rc.candidates_for_deploy(
        receipts, NEW, ALL, [_gap("36000000100", "2026-09-29T00:00:00Z")]
    )
    assert cands["mira-hub"]["sha"] == C and cands["mira-ask"]["sha"] == C
    assert cands["mira-web"]["sha"] is None


def test_designate_loses_a_service_an_unreadable_run_could_post_date(tmp_path):
    """Full coverage in the newest readable receipt is not chronological completeness."""
    receipts = rc.load_receipts(real_three(tmp_path))
    d = rc.designate(receipts, inventory=ALL, gaps=[_gap("36000000100", "2026-10-02T09:00:00Z")])
    assert sorted(d["lost"]) == list(sorted(ALL))
    assert all("may hold a deployment" in why for why in d["lost"].values())
    d_old = rc.designate(
        receipts, inventory=ALL, gaps=[_gap("36000000100", "2026-06-01T00:00:00Z")]
    )
    assert d_old["lost"] == {}


def test_load_gaps_fails_closed_on_a_malformed_line(tmp_path):
    good = tmp_path / "g.tsv"
    good.write_text("36000000100\t2026-10-02T09:00:00Z\treceipt gone\n\n")
    assert [g.run_id for g in rc.load_gaps(str(good))] == ["36000000100"]
    assert rc.load_gaps("") == []
    for bad in (
        "x\t2026-10-02T09:00:00Z\tr",
        "1\tyesterday\tr",
        "1\t2026-10-02T09:00:00Z\t ",
        "1\t2",
    ):
        (tmp_path / "b.tsv").write_text(bad + "\n")
        with pytest.raises(ValueError):
            rc.load_gaps(str(tmp_path / "b.tsv"))


def test_a_gap_just_before_the_candidate_counts_within_the_skew_margin(tmp_path):
    """deployed_at is the deploy host's clock, updatedAt GitHub's: compare with margin."""
    receipts = rc.load_receipts(real_three(tmp_path))
    near = rc.candidates_for_deploy(
        receipts, NEW, ALL, [_gap("36000000100", "2026-10-01T02:15:00Z")]
    )
    far = rc.candidates_for_deploy(
        receipts, NEW, ALL, [_gap("36000000100", "2026-10-01T01:30:00Z")]
    )
    assert near["mira-hub"]["sha"] is None, "8 minutes before the candidate is within the margin"
    assert far["mira-hub"]["sha"] == C


def test_window_start_is_days_before_now(capsys):
    from datetime import date as _date

    rc.main(["window-start", "--days", "121"])
    got = _date.fromisoformat(capsys.readouterr().out.strip())
    today = datetime.now(timezone.utc).date()
    assert (today - got).days == 121


def test_since_prints_the_oldest_receipt_time(tmp_path, capsys):
    rc.main(["since", "--receipts-dir", str(real_three(tmp_path))])
    assert capsys.readouterr().out.strip() == "2026-09-27T20:49:48Z", "oldest minus the skew margin"
    rc.main(["since", "--receipts-dir", str(tmp_path / "none")])
    assert capsys.readouterr().out.strip() == ""


def test_designate_without_the_field_designates_nothing(tmp_path):
    d = rc.designate(rc.load_receipts(real_three(tmp_path)))
    assert d["designated"] == []
    assert d["current"]["mira-web"] == {"sha": B, "run_id": "36369296665"}
    assert set(d["undesignated"]) == set(ALL)
    assert all("records no rollback_candidate" in v for v in d["undesignated"].values())


def test_designate_reads_the_newest_receipt_per_service_and_groups_by_sha(tmp_path):
    hub_ask = {
        "mira-hub": {"sha": B, "from_run_id": "36369296665", "reason": "prev"},
        "mira-ask": {"sha": B, "from_run_id": "36369296665", "reason": "prev"},
    }
    web_only = {"mira-web": {"sha": None, "from_run_id": None, "reason": "no earlier receipt"}}
    root = write(
        tmp_path / "r",
        receipt(A, "36350115024", "2026-09-27T21:04:48Z"),
        receipt(
            B,
            "36369296665",
            "2026-09-28T02:23:24Z",
            services=("mira-web",),
            rollback_candidate=web_only,
        ),
        receipt(
            C,
            "36805202089",
            "2026-10-01T02:23:34Z",
            services=("mira-hub", "mira-ask"),
            rollback_candidate=hub_ask,
        ),
    )
    d = rc.designate(rc.load_receipts(root))
    assert d["designated"] == [
        {"sha": B, "services": ["mira-ask", "mira-hub"], "designated_by_runs": ["36805202089"]}
    ]
    assert d["undesignated"] == {"mira-web": "run 36369296665: no earlier receipt"}


# ── migration labels (expand/contract, §10.2 Compatibility) ──────────────────
#
# compat never reads SQL. Each migration file carries a human label in
# tools/migration_compat.txt, bound to its exact content (sha256). A candidate stays valid
# only while every migration that changed after it is labelled ``expand``.

LABELS = "tools/migration_compat.txt"


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def _repo(tmp_path: Path) -> tuple[Path, str]:
    """A candidate commit with one migration, labelled ``unreviewed``."""
    repo = tmp_path / "repo"
    (repo / "mira-hub/db/migrations").mkdir(parents=True)
    (repo / "tools").mkdir()
    _git(repo.parent, "init", "-q", str(repo))
    for k, v in (("user.email", "t@example.com"), ("user.name", "t"), ("commit.gpgsign", "false")):
        _git(repo, "config", k, v)
    first = "CREATE TABLE a (x int);\n"
    (repo / "mira-hub/db/migrations/001_a.sql").write_text(first)
    (repo / LABELS).write_text(
        f"# label sha256 path\nunreviewed {_sha(first)} mira-hub/db/migrations/001_a.sql\n"
    )
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "candidate")
    return repo, _git(repo, "rev-parse", "HEAD")


def _land(repo: Path, files: dict[str, str], labels: dict[str, str]) -> str:
    """Commit ``files`` and append a label line per ``labels`` path (sha of that file)."""
    for path, text in files.items():
        (repo / path).parent.mkdir(parents=True, exist_ok=True)
        (repo / path).write_text(text)
    with (repo / LABELS).open("a") as fh:
        for path, label in labels.items():
            fh.write(f"{label} {_sha((repo / path).read_text())} {path}\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "head")
    return _git(repo, "rev-parse", "HEAD")


B002 = "mira-hub/db/migrations/002_b.sql"


def test_a_candidate_stays_valid_while_every_later_migration_is_labelled_expand(tmp_path):
    repo, cand = _repo(tmp_path)
    head = _land(repo, {B002: "ALTER TABLE a ADD COLUMN y int;\n"}, {B002: "expand"})
    assert rc.contracting_since(cand, head, repo) == []
    res = cli("compat", "--candidate", cand, "--head", head, "--repo", str(repo))
    assert res.returncode == 0, res.stdout + res.stderr


@pytest.mark.parametrize("label", ["contract", "unreviewed"])
def test_a_later_migration_not_labelled_expand_invalidates(tmp_path, label):
    repo, cand = _repo(tmp_path)
    head = _land(repo, {B002: "ALTER TABLE a ADD COLUMN y int;\n"}, {B002: label})
    hits = rc.contracting_since(cand, head, repo)
    assert [(h["path"], h["kind"]) for h in hits] == [(B002, label)]
    res = cli("compat", "--candidate", cand, "--head", head, "--repo", str(repo))
    assert res.returncode == 1 and f"{label.upper()} {B002}" in res.stdout


def test_an_unlabelled_later_migration_invalidates(tmp_path):
    repo, cand = _repo(tmp_path)
    head = _land(repo, {B002: "ALTER TABLE a ADD COLUMN y int;\n"}, {})
    assert [(h["path"], h["kind"]) for h in rc.contracting_since(cand, head, repo)] == [
        (B002, "unlabelled")
    ]


def test_a_label_for_other_content_does_not_count(tmp_path):
    """The label binds to the exact bytes: a line for other content proves nothing."""
    repo, cand = _repo(tmp_path)
    (repo / B002).write_text("ALTER TABLE a DROP COLUMN x;\n")
    with (repo / LABELS).open("a") as fh:
        fh.write(f"expand {_sha('ALTER TABLE a ADD COLUMN y int;' + chr(10))} {B002}\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "head")
    hits = rc.contracting_since(cand, _git(repo, "rev-parse", "HEAD"), repo)
    assert [(h["path"], h["kind"]) for h in hits] == [(B002, "unlabelled")]
    assert "different content" in hits[0]["reason"]


def _relabel(repo: Path, path: str, label: str) -> None:
    """Replace ``path``'s label line with one for its current content."""
    keep = [x for x in (repo / LABELS).read_text().splitlines() if not x.endswith(f" {path}")]
    keep.append(f"{label} {_sha((repo / path).read_text())} {path}")
    (repo / LABELS).write_text("\n".join(keep) + "\n")


def test_an_existing_migration_edited_after_the_candidate_invalidates_whatever_its_label(
    tmp_path,
):
    """An edited applied migration: the version the database ran may differ from the one
    labelled, so no label for the final bytes can clear it."""
    repo, cand = _repo(tmp_path)
    first = "mira-hub/db/migrations/001_a.sql"
    (repo / first).write_text("CREATE TABLE a (x bigint);\n")
    _relabel(repo, first, "expand")
    _git(repo, "commit", "-q", "-am", "rewrite an applied file")
    hits = rc.contracting_since(cand, _git(repo, "rev-parse", "HEAD"), repo)
    assert [(h["path"], h["kind"]) for h in hits] == [(first, "unlabelled")]
    assert "changed after the candidate" in hits[0]["reason"]


def test_an_earlier_version_cannot_hide_behind_the_final_label(tmp_path):
    """Codex #4222 r6 F14: a version applied in between stays live although the file was later
    rewritten and correctly relabelled; every version after the candidate counts."""
    repo, cand = _repo(tmp_path)
    ingest = "mira-core/mira-ingest/db/migrations/012_x.sql"
    _land(repo, {ingest: "ALTER TABLE chunks DROP COLUMN legacy;\n"}, {ingest: "contract"})
    (repo / ingest).write_text("ALTER TABLE chunks ADD COLUMN y int;\n")
    _relabel(repo, ingest, "expand")
    _git(repo, "commit", "-q", "-am", "rewrite and relabel")
    head = _git(repo, "rev-parse", "HEAD")
    hits = rc.contracting_since(cand, head, repo)
    assert [(h["path"], h["kind"]) for h in hits] == [(ingest, "unlabelled")]
    assert "changed after the candidate" in hits[0]["reason"]
    res = cli("compat", "--candidate", cand, "--head", head, "--repo", str(repo))
    assert res.returncode == 1, res.stdout


def test_an_existing_migration_edited_and_restored_still_invalidates(tmp_path):
    """Codex #4222 r6 F14: the intermediate version may have been applied."""
    repo, cand = _repo(tmp_path)
    first = repo / "mira-hub/db/migrations/001_a.sql"
    original = first.read_text()
    first.write_text("CREATE TABLE a (x bigint);\n")
    _git(repo, "commit", "-q", "-am", "edit")
    first.write_text(original)
    _git(repo, "commit", "-q", "-am", "restore")
    hits = rc.contracting_since(cand, _git(repo, "rev-parse", "HEAD"), repo)
    assert [(h["path"], h["kind"]) for h in hits] == [
        ("mira-hub/db/migrations/001_a.sql", "unlabelled")
    ]


def test_an_existing_migration_deleted_unchanged_leaves_the_candidate_valid(tmp_path):
    """A file the candidate already had is compatible with it by construction; deleting it
    later adds no schema change."""
    repo, cand = _repo(tmp_path)
    first = "mira-hub/db/migrations/001_a.sql"
    _git(repo, "rm", "-q", first)
    keep = [x for x in (repo / LABELS).read_text().splitlines() if not x.endswith(f" {first}")]
    (repo / LABELS).write_text("\n".join(keep) + "\n")
    _git(repo, "commit", "-q", "-am", "delete")
    assert rc.contracting_since(cand, _git(repo, "rev-parse", "HEAD"), repo) == []


def test_a_merge_commit_that_rewrites_a_migration_counts_as_a_version(tmp_path):
    """A merge resolution can introduce bytes neither parent had; the merge's own diff is a
    version too (git log -m), so the side branch's applied version still counts."""
    repo, cand = _repo(tmp_path)
    base = _git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    _git(repo, "checkout", "-q", "-b", "side")
    _land(repo, {B002: "ALTER TABLE a DROP COLUMN x;\n"}, {B002: "contract"})
    _git(repo, "checkout", "-q", base)
    (repo / "notes.txt").write_text("unrelated\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "unrelated")
    _git(repo, "merge", "-q", "--no-ff", "--no-commit", "side")
    (repo / B002).write_text("ALTER TABLE a ADD COLUMN y int;\n")
    _relabel(repo, B002, "expand")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "merge side, rewriting 002")
    hits = rc.contracting_since(cand, _git(repo, "rev-parse", "HEAD"), repo)
    assert [(h["path"], h["kind"]) for h in hits] == [(B002, "unlabelled")]


@pytest.mark.parametrize("label, expected", [("expand", []), ("contract", [(B002, "contract")])])
def test_a_migration_from_a_merged_branch_is_read_like_any_other(tmp_path, label, expected):
    repo, cand = _repo(tmp_path)
    base = _git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    _git(repo, "checkout", "-q", "-b", "side")
    _land(repo, {B002: "ALTER TABLE a ADD COLUMN y int;\n"}, {B002: label})
    _git(repo, "checkout", "-q", base)
    (repo / "notes.txt").write_text("unrelated\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "unrelated")
    _git(repo, "merge", "-q", "--no-ff", "side", "-m", "merge side")
    hits = rc.contracting_since(cand, _git(repo, "rev-parse", "HEAD"), repo)
    assert [(h["path"], h["kind"]) for h in hits] == expected


def test_a_migration_renamed_after_the_candidate_needs_a_label_at_its_new_path(tmp_path):
    repo, cand = _repo(tmp_path)
    _git(repo, "mv", "mira-hub/db/migrations/001_a.sql", "mira-hub/db/migrations/001_z.sql")
    _git(repo, "commit", "-q", "-m", "rename")
    hits = rc.contracting_since(cand, _git(repo, "rev-parse", "HEAD"), repo)
    assert [(h["path"], h["kind"]) for h in hits] == [
        ("mira-hub/db/migrations/001_z.sql", "unlabelled")
    ]


def test_compat_sees_a_migration_added_and_deleted_after_the_candidate(tmp_path):
    """Applied in between, its effect may be live although head no longer has the file."""
    repo, cand = _repo(tmp_path)
    _land(repo, {B002: "ALTER TABLE a ADD COLUMN y int;\n"}, {B002: "expand"})
    (repo / B002).unlink()
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "delete")
    hits = rc.contracting_since(cand, _git(repo, "rev-parse", "HEAD"), repo)
    assert [(h["path"], h["kind"]) for h in hits] == [(B002, "unlabelled")]
    assert "deleted before head" in hits[0]["reason"]


def test_compat_scans_the_ingest_migrations_too(tmp_path):
    repo, cand = _repo(tmp_path)
    ingest = "mira-core/mira-ingest/db/migrations/012_x.sql"
    head = _land(repo, {ingest: "ALTER TABLE chunks ADD COLUMN y int;\n"}, {})
    assert [h["path"] for h in rc.contracting_since(cand, head, repo)] == [ingest]


def test_a_non_ascii_migration_name_is_read_not_skipped(tmp_path):
    """git quotes such paths in its default output; compat reads NUL-separated output so the
    file is still seen (pre-round-7 screen: a quoted path used to be skipped as non-.sql)."""
    repo, cand = _repo(tmp_path)
    odd = "mira-hub/db/migrations/002_caf\u00e9.sql"
    head = _land(repo, {odd: "ALTER TABLE a DROP COLUMN x;\n"}, {odd: "contract"})
    assert [(h["path"], h["kind"]) for h in rc.contracting_since(cand, head, repo)] == [
        (odd, "contract")
    ]


def test_a_non_ascii_migration_the_candidate_had_is_read_too(tmp_path):
    repo, _ = _repo(tmp_path)
    odd = "mira-hub/db/migrations/002_caf\u00e9.sql"
    cand = _land(repo, {odd: "ALTER TABLE a ADD COLUMN y int;\n"}, {odd: "unreviewed"})
    (repo / odd).write_text("ALTER TABLE a DROP COLUMN x;\n")
    _git(repo, "commit", "-q", "-am", "edit")
    hits = rc.contracting_since(cand, _git(repo, "rev-parse", "HEAD"), repo)
    assert [(h["path"], h["kind"]) for h in hits] == [(odd, "unlabelled")]


def test_a_migration_name_with_whitespace_is_refused_by_the_gate():
    """The label format separates fields by whitespace, so such a name could never be
    labelled: the gate refuses it at authoring time (pre-round-7 screen)."""
    problems = "\n".join(rc.label_problems({}, {"mira-hub/db/migrations/003 add x.sql": "c" * 64}))
    assert "whitespace" in problems


@pytest.mark.parametrize(
    "raw",
    [
        ":100644 100644 " + "a" * 40 + " " + "b" * 40 + " M",  # metadata with no path after it
        ":100644 100644 " + "a" * 40 + " M\0mira-hub/db/migrations/x.sql\0",  # too few fields
    ],
)
def test_incomplete_git_output_is_an_error_not_a_crash(raw):
    """A truncated or malformed record must raise ValueError (compat exit 2, 'error'), never an
    IndexError, whose exit code 1 would read as a judged invalid (pre-round-7 screen)."""
    with pytest.raises(ValueError, match="git log"):
        rc._raw_versions(raw)


def test_raw_versions_reads_paths_and_ignores_deletions():
    a, b, z = "a" * 40, "b" * 40, "0" * 40
    raw = (
        f":000000 100644 {z} {a} A\0mira-hub/db/migrations/1.sql\0"
        f"\n:100644 000000 {a} {z} D\0mira-hub/db/migrations/1.sql\0"
        f":100644 100644 {a} {b} M\0mira-hub/db/migrations/notes.txt\0"
    )
    assert rc._raw_versions(raw) == {"mira-hub/db/migrations/1.sql": {a}}


def test_a_file_outside_the_migration_dirs_is_ignored(tmp_path):
    repo, cand = _repo(tmp_path)
    head = _land(repo, {"docs/notes.sql": "DROP TABLE a;\n"}, {})
    assert rc.contracting_since(cand, head, repo) == []


def test_compat_reads_the_labels_at_head_not_the_working_tree(tmp_path):
    repo, cand = _repo(tmp_path)
    head = _land(repo, {B002: "ALTER TABLE a ADD COLUMN y int;\n"}, {B002: "contract"})
    text = (repo / LABELS).read_text().replace("contract ", "expand ")
    (repo / LABELS).write_text(text)  # uncommitted relabel
    assert [h["kind"] for h in rc.contracting_since(cand, head, repo)] == ["contract"]


def test_a_missing_label_file_at_head_is_an_error_not_clean(tmp_path):
    repo, cand = _repo(tmp_path)
    (repo / LABELS).unlink()
    _git(repo, "commit", "-q", "-am", "drop labels")
    res = cli(
        "compat",
        "--candidate",
        cand,
        "--head",
        _git(repo, "rev-parse", "HEAD"),
        "--repo",
        str(repo),
    )
    assert res.returncode == 2, res.stdout + res.stderr


@pytest.mark.parametrize(
    "line, needle",
    [
        (f"safe {'a' * 64} mira-hub/db/migrations/x.sql", "unknown label"),
        ("expand abc mira-hub/db/migrations/x.sql", "sha256"),
        (f"expand {'a' * 64}", "expected"),
        (f"expand {'a' * 64} mira-hub/db/migrations/x.sql extra", "expected"),
        (f"expand {'A' * 64} mira-hub/db/migrations/x.sql", "sha256"),
    ],
)
def test_a_malformed_label_line_fails_closed(line, needle):
    with pytest.raises(ValueError, match=needle):
        rc.parse_labels(line + "\n")


def test_a_duplicate_label_fails_closed():
    line = f"expand {'a' * 64} mira-hub/db/migrations/x.sql\n"
    with pytest.raises(ValueError, match="more than once"):
        rc.parse_labels(line + line.replace("expand", "contract"))


def test_parse_labels_skips_comments_and_blank_lines():
    sha = "b" * 64
    text = f"# header\n\n  # indented comment\nexpand {sha} mira-hub/db/migrations/x.sql\n"
    assert rc.parse_labels(text) == {"mira-hub/db/migrations/x.sql": ("expand", sha)}


def test_label_problems_names_the_exact_line_to_add():
    sha_new, sha_old = "c" * 64, "d" * 64
    labels = {
        "mira-hub/db/migrations/001_a.sql": ("expand", sha_old),
        "mira-hub/db/migrations/009_gone.sql": ("unreviewed", "e" * 64),
    }
    files = {
        "mira-hub/db/migrations/001_a.sql": sha_new,
        "mira-hub/db/migrations/002_b.sql": sha_new,
    }
    problems = "\n".join(rc.label_problems(labels, files))
    assert f"unreviewed {sha_new} mira-hub/db/migrations/002_b.sql" in problems  # the line to add
    assert "001_a.sql" in problems and "different content" in problems
    assert "009_gone.sql" in problems and "no such migration" in problems
    assert rc.label_problems({p: ("expand", s) for p, s in files.items()}, files) == []


def test_every_migration_carries_a_label_for_its_exact_content():
    """The authoring-time gate (runs in CI's unit suite on every code PR): a new or edited
    migration fails here until its label line is added, so the judgment is made once, by
    the author, in the migration's own reviewed PR."""
    labels = rc.parse_labels((REPO / LABELS).read_text(encoding="utf-8"))
    files = {
        str(f.relative_to(REPO)): hashlib.sha256(f.read_bytes()).hexdigest()
        for d in rc.MIGRATION_DIRS
        for f in sorted((REPO / d).glob("*.sql"))
    }
    assert len(files) > 100, "found no migrations to check"
    problems = rc.label_problems(labels, files)
    assert problems == [], "\n".join(problems)


def test_migration_dirs_are_exactly_what_the_apply_workflows_apply():
    """``compat`` must scan every directory an apply-* workflow applies — a new one must fail here."""
    applied = set()
    workflows = sorted((REPO / ".github/workflows").glob("apply-*migrations.yml"))
    for wf in workflows:
        applied.update(re.findall(r'MIG_DIR="([^"]+)"', wf.read_text(encoding="utf-8")))
    assert len(workflows) >= 2 and applied, "found no apply-* migration workflows to compare"
    assert applied == set(rc.MIGRATION_DIRS)


def test_a_candidate_not_on_head_is_an_error_not_clean(tmp_path):
    repo, cand = _repo(tmp_path)
    res = cli("compat", "--candidate", "f" * 40, "--head", cand, "--repo", str(repo))
    assert res.returncode == 2


# ── refresh due ──────────────────────────────────────────────────────────────


def test_refresh_due_uses_the_earlier_expiry():
    now = datetime(2026, 10, 4, tzinfo=timezone.utc)
    staging = {"deployed_at": "2026-10-01T00:00:00Z"}  # valid until 10-08T00 (96h left)
    acc_late = {"expires_at": "2026-10-09T00:00:00Z"}
    acc_soon = {"expires_at": "2026-10-05T00:00:00Z"}  # 24h left
    assert rc.refresh_due(staging, acc_late, now, 72)[0] is False
    assert rc.refresh_due(staging, acc_soon, now, 72)[0] is True
    assert rc.refresh_due(staging, acc_late, now + timedelta(hours=30), 72)[0] is True
