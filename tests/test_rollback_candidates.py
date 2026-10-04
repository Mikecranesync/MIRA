"""Contract for tools/rollback_candidates.py (SDLC v1 §10.2, Part B step 10).

Receipt fixtures mirror the three real production receipts of 2026-09-27..10-01
(runs 36350115024, 36369296665, 36805202089): the newest deploy covered only
mira-hub + mira-ask, so mira-web's current production SHA lives in an OLDER receipt —
the per-service walk is the point, not a convenience.
"""

from __future__ import annotations

import importlib.util
import json
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


def test_covered_exit_codes(tmp_path):
    root = real_three(tmp_path)
    ok = cli(
        "covered",
        "--receipts-dir",
        str(root),
        "--deploying",
        NEW,
        "--services",
        "mira-hub mira-web mira-ask",
    )
    assert ok.returncode == 0, ok.stdout + ok.stderr
    partial = cli(
        "covered",
        "--receipts-dir",
        str(root),
        "--deploying",
        NEW,
        "--services",
        "mira-hub mira-pipeline",
    )
    assert partial.returncode == 3 and "mira-pipeline" in partial.stdout
    (root / "36350115024" / "production-receipt.json").write_text("{", encoding="utf-8")
    broken = cli(
        "covered", "--receipts-dir", str(root), "--deploying", NEW, "--services", "mira-hub"
    )
    assert broken.returncode == 2


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


def test_stamp_never_overwrites(tmp_path):
    cands = {s: {"sha": A, "from_run_id": "1", "reason": "r"} for s in ALL}
    res, _ = _stamp(
        tmp_path, receipt(NEW, "1", "2026-10-04T00:00:00Z", rollback_candidate=cands), cands
    )
    assert res.returncode == 2 and "refusing to overwrite" in res.stderr


# ── designate ────────────────────────────────────────────────────────────────


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


# ── contracting migrations ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "sql",
    [
        "DROP TABLE legacy_rows;",
        "drop table if exists public.legacy_rows cascade;",
        "ALTER TABLE t DROP COLUMN c;",
        "ALTER TABLE t DROP c;",
        "ALTER TABLE IF EXISTS ONLY t ADD COLUMN d int, DROP COLUMN c;",
        "ALTER TABLE t RENAME COLUMN a TO b;",
        "ALTER TABLE t RENAME TO t2;",
        "ALTER TABLE t ALTER COLUMN tenant_id TYPE text USING tenant_id::text;",
        "ALTER TABLE t ALTER COLUMN c SET DATA TYPE bigint;",
        "ALTER TABLE t ALTER c SET NOT NULL;",
        "DROP TYPE status_enum;",
        "DROP FUNCTION IF EXISTS f(int, text);",
        "DROP VIEW v;",
        "DROP SCHEMA s;",
    ],
)
def test_contracting_statements_are_flagged(sql):
    assert rc.contracting_statements(sql), sql


@pytest.mark.parametrize(
    "sql",
    [
        "DROP POLICY IF EXISTS p ON t; CREATE POLICY p ON t USING (true);",
        "DROP INDEX IF EXISTS i; CREATE INDEX i ON t (c);",
        "DROP TRIGGER IF EXISTS trg ON t;",
        "ALTER TABLE t DROP CONSTRAINT IF EXISTS c_uniq;",
        "ALTER TABLE t ALTER COLUMN c DROP NOT NULL;",
        "ALTER TABLE t ALTER COLUMN c DROP DEFAULT;",
        "ALTER TABLE t ADD COLUMN IF NOT EXISTS c text;",
        "ALTER TABLE t ENABLE ROW LEVEL SECURITY;",
        "DROP FUNCTION IF EXISTS f(int); CREATE OR REPLACE FUNCTION f(int) RETURNS int AS 'select 1' LANGUAGE sql;",
        "DROP VIEW IF EXISTS v; CREATE VIEW v AS SELECT 1;",
        "-- DROP TABLE t;\n/* ALTER TABLE t DROP COLUMN c; */ SELECT 1;",
        "UPDATE t SET c = NULL; DELETE FROM t;",
    ],
)
def test_expand_and_idempotent_patterns_are_not_flagged(sql):
    assert rc.contracting_statements(sql) == [], sql


@pytest.mark.parametrize(
    "path",
    [
        "mira-hub/db/migrations/008_tenant_cmms_config.sql",
        "mira-hub/db/migrations/011_grant_app_kb_access.sql",
        "mira-hub/db/migrations/026_kg_entities_dedupe_and_constraint.sql",
    ],
)
def test_real_idempotent_migrations_are_not_flagged(path):
    """Real files that DROP POLICY/INDEX/CONSTRAINT and recreate — the false-positive guard."""
    assert rc.contracting_statements((REPO / path).read_text(encoding="utf-8")) == []


def test_a_real_type_change_is_flagged():
    hits = rc.contracting_statements(
        (REPO / "mira-hub/db/migrations/070_decision_traces_tenant_text.sql").read_text(
            encoding="utf-8"
        )
    )
    assert hits and all("TYPE TEXT" in h for h in hits)


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def _repo(tmp_path: Path) -> tuple[Path, str]:
    repo = tmp_path / "repo"
    (repo / "mira-hub/db/migrations").mkdir(parents=True)
    _git(repo.parent, "init", "-q", str(repo))
    for k, v in (("user.email", "t@example.com"), ("user.name", "t"), ("commit.gpgsign", "false")):
        _git(repo, "config", k, v)
    (repo / "mira-hub/db/migrations/001_a.sql").write_text("CREATE TABLE a (x int);\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "candidate")
    return repo, _git(repo, "rev-parse", "HEAD")


def test_contracting_since_finds_a_later_contraction(tmp_path):
    repo, cand = _repo(tmp_path)
    (repo / "mira-hub/db/migrations/002_b.sql").write_text("ALTER TABLE a ADD COLUMN y int;\n")
    (repo / "mira-hub/db/migrations/003_c.sql").write_text("ALTER TABLE a DROP COLUMN x;\n")
    (repo / "docs.sql").write_text("DROP TABLE a;\n")  # outside the migration dirs
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "head")
    head = _git(repo, "rev-parse", "HEAD")
    hits = rc.contracting_since(cand, head, repo)
    assert [h["path"] for h in hits] == ["mira-hub/db/migrations/003_c.sql"]
    res = cli("compat", "--candidate", cand, "--head", head, "--repo", str(repo))
    assert res.returncode == 1 and "CONTRACTING mira-hub/db/migrations/003_c.sql" in res.stdout


def test_contracting_since_is_clean_for_expand_only(tmp_path):
    repo, cand = _repo(tmp_path)
    (repo / "mira-hub/db/migrations/002_b.sql").write_text("ALTER TABLE a ADD COLUMN y int;\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "head")
    res = cli(
        "compat",
        "--candidate",
        cand,
        "--head",
        _git(repo, "rev-parse", "HEAD"),
        "--repo",
        str(repo),
    )
    assert res.returncode == 0, res.stdout + res.stderr


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
