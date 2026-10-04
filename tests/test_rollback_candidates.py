"""Contract for tools/rollback_candidates.py (SDLC v1 §10.2, Part B step 10).

Receipt fixtures mirror the three real production receipts of 2026-09-27..10-01
(runs 36350115024, 36369296665, 36805202089): the newest deploy covered only
mira-hub + mira-ask, so mira-web's current production SHA lives in an OLDER receipt —
the per-service walk is the point, not a convenience.
"""

from __future__ import annotations

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
    gap = "the production receipt of run 1 has expired"
    d = rc.designate(receipts, inventory=ALL, evidence_gap=gap)
    assert sorted(d["lost"]) == ["mira-ask", "mira-web"]
    assert all(gap in why for why in d["lost"].values())
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
    assert rc.designate(receipts, inventory=ALL, evidence_gap="window")["lost"] == {}


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
            "--evidence-gap",
            "walked the newest 1 deploy runs",
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


def test_since_prints_the_oldest_receipt_time(tmp_path, capsys):
    rc.main(["since", "--receipts-dir", str(real_three(tmp_path))])
    assert capsys.readouterr().out.strip() == "2026-09-27T21:04:48Z"
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
        # a recreated name is not proof of compatibility (Codex #4222 r1 F3)
        "DROP FUNCTION IF EXISTS f(int); CREATE OR REPLACE FUNCTION f(int) RETURNS int AS 'select 1' LANGUAGE sql;",
        "DROP FUNCTION f(integer); CREATE FUNCTION f(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;",
        "DROP TABLE t; CREATE TABLE t (replacement int);",
        "DROP VIEW IF EXISTS v; CREATE VIEW v AS SELECT 1;",
        "DROP TYPE IF EXISTS s; CREATE TYPE s AS ENUM ('a');",
        # quoted identifiers with whitespace (Codex #4222 r2 F2)
        'ALTER TABLE "maintenance assets" DROP COLUMN c;',
        'ALTER TABLE public."a b" RENAME COLUMN x TO y;',
        # every statement inside a dynamic EXECUTE string, and dynamic DDL we cannot parse
        "DO $$ BEGIN EXECUTE 'ALTER TABLE t ADD COLUMN x int; ALTER TABLE t DROP COLUMN y'; END $$;",
        "DO $$ BEGIN EXECUTE 'ALTER TABLE ' || quote_ident(t) || ' DROP COLUMN c'; END $$;",
        "DO $$ BEGIN EXECUTE format('ALTER TABLE %I DROP COLUMN %I', t, c); END $$;",
        "DO $$ BEGIN EXECUTE format('ALTER TABLE %I ' || 'RENAME TO %I', a, b); END $$;",
        # an EXECUTE string is SQL: decoded and checked like any other (Codex #4222 r3 F2)
        """DO $$ BEGIN EXECUTE 'ALTER TABLE "maintenance assets" DROP COLUMN c'; END $$;""",
        """DO $$ BEGIN EXECUTE 'ALTER TABLE t ALTER COLUMN "old value" SET NOT NULL'; END $$;""",
        "DO $$ BEGIN EXECUTE 'ALTER TABLE t ALTER COLUMN c SET DEFAULT ''('', DROP COLUMN d'; END $$;",
        # a statement assembled in a variable and then executed cannot be parsed
        "DO $$ DECLARE s text; BEGIN s := 'ALTER TABLE ' || t || ' DROP COLUMN c'; EXECUTE s; END $$;",
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
        "-- DROP TABLE t;\n/* ALTER TABLE t DROP COLUMN c; */ SELECT 1;",
        "UPDATE t SET c = NULL; DELETE FROM t;",
        # a quoted identifier that merely contains keywords is a name, not an action
        'ALTER TABLE "drop column" ADD COLUMN x int;',
        "DO $$ BEGIN EXECUTE format('ALTER TABLE %I ADD COLUMN x int', t); END $$;",
        "DO $$ BEGIN EXECUTE 'GRANT SELECT ON ' || t || ' TO r'; END $$;",
        # IS NOT NULL is a predicate, not SET NOT NULL
        "DO $$ BEGIN IF x IS NOT NULL THEN EXECUTE 'DELETE FROM t WHERE ' || cond; END IF; END $$;",
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


@pytest.mark.parametrize(
    "sql",
    [
        # a paren inside a literal must not swallow the following action
        "ALTER TABLE t ALTER COLUMN c SET DEFAULT '(', DROP COLUMN d;",
        "ALTER TABLE t ALTER COLUMN c SET DEFAULT ')', DROP COLUMN d;",
        "ALTER TABLE t ALTER COLUMN c SET DEFAULT 'it''s (', DROP COLUMN d;",
        # a comment marker inside a literal must not hide the rest of the line
        "ALTER TABLE t ADD COLUMN n text DEFAULT '--', DROP COLUMN d;",
        "ALTER TABLE t ADD COLUMN n text DEFAULT '/*', DROP COLUMN d; -- */",
        # a semicolon inside a literal must not cut the statement short
        "ALTER TABLE t ALTER COLUMN c SET DEFAULT 'a;b', DROP COLUMN d;",
    ],
)
def test_string_literals_cannot_hide_a_contraction(sql):
    assert rc.contracting_statements(sql), sql


@pytest.mark.parametrize(
    "sql",
    [
        "ALTER TABLE t ALTER COLUMN c SET DEFAULT 'x, DROP COLUMN y';",
        "INSERT INTO notes (body) VALUES ('ALTER TABLE t DROP COLUMN c; DROP TABLE t');",
        "SELECT E'x\\', DROP TABLE t; --';",
    ],
)
def test_string_literals_cannot_fake_a_contraction(sql):
    assert rc.contracting_statements(sql) == [], sql


@pytest.mark.parametrize(
    "sql",
    [
        "DO $$ BEGIN IF EXISTS (SELECT 1) THEN ALTER TABLE t RENAME COLUMN a TO b; END IF; END $$;",
        "DO $tag$ BEGIN ALTER TABLE t DROP COLUMN c; END $tag$;",
        "DO $$ BEGIN DROP TABLE legacy_rows; END $$;",
        # dynamic DDL inside a body still runs
        "DO $$ BEGIN EXECUTE 'ALTER TABLE t DROP COLUMN c'; END $$;",
        # a paren inside a literal inside a body, or inside a quoted identifier, cannot
        # swallow the next action
        "DO $$ BEGIN ALTER TABLE t ALTER COLUMN c SET DEFAULT '(', DROP COLUMN d; END $$;",
        'ALTER TABLE t ADD COLUMN "x(" int, DROP COLUMN d;',
        # comment markers and semicolons inside a literal inside a body (Codex #4222 r1 F2)
        "DO $$ BEGIN ALTER TABLE t ALTER COLUMN c SET DEFAULT '--', DROP COLUMN d; END $$;",
        "DO $$ BEGIN ALTER TABLE t ALTER COLUMN c SET DEFAULT '/*', DROP COLUMN d; END $$;",
        "DO $$ BEGIN ALTER TABLE t ALTER COLUMN c SET DEFAULT 'a;b', DROP COLUMN d; END $$;",
        "CREATE FUNCTION g() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN "
        "EXECUTE 'ALTER TABLE t ' || 'x'; ALTER TABLE t DROP COLUMN d; END $f$;",
        # an E'' string with a backslash-escaped quote is one literal
        "ALTER TABLE t ALTER COLUMN c SET DEFAULT E'it\\'s (', DROP COLUMN d;",
        # a stray apostrophe inside a body must not merge the statements after it
        "DO $$ BEGIN RAISE NOTICE $q$it's$q$; END $$; "
        "ALTER TABLE t ADD COLUMN x int; ALTER TABLE t DROP COLUMN y;",
        # an apostrophe inside a dollar-quoted body is not the start of a literal
        "COMMENT ON TABLE t IS $$it's$$; ALTER TABLE t DROP COLUMN c; SELECT 'x';",
    ],
)
def test_ddl_inside_a_do_block_is_still_checked(sql):
    assert rc.contracting_statements(sql), sql


@pytest.mark.parametrize(
    "sql",
    [
        "DO $$ BEGIN ALTER TABLE t ADD CONSTRAINT k UNIQUE (c); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
        "DO $$ BEGIN ALTER TABLE t DROP CONSTRAINT IF EXISTS k; END $$;",
        "DO $$ BEGIN -- ALTER TABLE t DROP COLUMN c;\n PERFORM 1; END $$;",
    ],
)
def test_expand_patterns_inside_a_do_block_are_not_flagged(sql):
    assert rc.contracting_statements(sql) == [], sql


@pytest.mark.parametrize(
    "sql",
    [
        "BEGIN; SET LOCAL lock_timeout = '5s'; COMMIT;",
        "CREATE TABLE IF NOT EXISTS t (id uuid PRIMARY KEY, x text);",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON t (x);",
        "CREATE SEQUENCE IF NOT EXISTS s;",
        "COMMENT ON COLUMN t.x IS 'why';",
        "GRANT SELECT, INSERT ON t TO factorylm_app;",
        "ALTER TABLE t ADD COLUMN IF NOT EXISTS y text;",
        "ALTER TABLE t ADD COLUMN y int NOT NULL DEFAULT 0, ADD COLUMN z text;",
        # everything on a table a plain CREATE TABLE made earlier in the same file
        "CREATE TABLE n (x int); CREATE UNIQUE INDEX ni ON n (x); "
        "ALTER TABLE n ENABLE ROW LEVEL SECURITY; DROP POLICY IF EXISTS p ON n; "
        "CREATE POLICY p ON n USING (true); REVOKE DELETE ON n FROM PUBLIC; INSERT INTO n VALUES (1);",
        # foreign keys among tables new in this file, or to itself, bind nothing older
        "CREATE TABLE p (id int PRIMARY KEY, parent int REFERENCES p (id)); "
        "CREATE TABLE c (pid int REFERENCES p (id));",
    ],
)
def test_expand_only_statements_are_proven(sql):
    assert rc.unproven_statements(sql) == [], sql


@pytest.mark.parametrize(
    "sql",
    [
        # each needs a human: older code can mis-read or mis-write through it
        "INSERT INTO existing (x) VALUES (1);",
        "UPDATE existing SET x = 1;",
        "DELETE FROM existing;",
        "TRUNCATE existing;",
        "CREATE UNIQUE INDEX u ON existing (x);",
        "DROP INDEX IF EXISTS i;",
        "ALTER TABLE existing DROP CONSTRAINT IF EXISTS c;",
        "ALTER TABLE existing ADD CONSTRAINT c CHECK (x > 0);",
        "ALTER TABLE existing ADD COLUMN y int NOT NULL;",
        "ALTER TABLE existing ADD COLUMN y int UNIQUE;",
        "ALTER TABLE existing ADD COLUMN y uuid REFERENCES parent (id);",
        "ALTER TABLE existing ADD y int;",
        "ALTER TABLE existing ENABLE ROW LEVEL SECURITY;",
        "CREATE POLICY p ON existing USING (false);",
        "REVOKE SELECT ON existing FROM factorylm_app;",
        "ALTER TABLE existing ALTER COLUMN x DROP DEFAULT;",
        "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
        "CREATE OR REPLACE VIEW v AS SELECT 1;",
        "CREATE VIEW v AS SELECT 1;",
        "CREATE EXTENSION IF NOT EXISTS ltree;",
        "CREATE TRIGGER tr BEFORE INSERT ON existing FOR EACH ROW EXECUTE FUNCTION f();",
        "DO $$ BEGIN PERFORM 1; END $$;",
        "ALTER TYPE e RENAME VALUE 'a' TO 'b';",
        "ALTER VIEW v RENAME TO w;",
        "VACUUM existing;",
        # IF NOT EXISTS proves nothing: the table may predate this file
        "CREATE TABLE IF NOT EXISTS existing (x int); CREATE UNIQUE INDEX u ON existing (x);",
        # a statement smuggled after the new table is still checked on its own target
        "CREATE TABLE n (x int); INSERT INTO existing SELECT x FROM n;",
        # a new table can still bind an existing one: its foreign key can block older
        # code's deletes, and inheritance or partitioning puts its rows in older reads
        "CREATE TABLE n (x uuid REFERENCES existing (id));",
        "CREATE TABLE n (x int); ALTER TABLE n ADD CONSTRAINT f FOREIGN KEY (x) REFERENCES existing (id);",
        "CREATE TABLE n () INHERITS (existing);",
        "CREATE TABLE n PARTITION OF existing FOR VALUES IN (1);",
    ],
)
def test_anything_not_provably_expand_only_is_unproven(sql):
    assert rc.unproven_statements(sql), sql


def test_compat_fails_on_an_unproven_migration_alone(tmp_path):
    repo, cand = _repo(tmp_path)
    (repo / "mira-hub/db/migrations/002_b.sql").write_text(
        "CREATE TRIGGER tr BEFORE INSERT ON a FOR EACH ROW EXECUTE FUNCTION f();\n"
    )
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "head")
    head = _git(repo, "rev-parse", "HEAD")
    res = cli("compat", "--candidate", cand, "--head", head, "--repo", str(repo))
    assert res.returncode == 1 and "UNPROVEN mira-hub/db/migrations/002_b.sql" in res.stdout
    assert "0 contracting and 1 not provably expand-only" in res.stdout


def test_migration_dirs_are_exactly_what_the_apply_workflows_apply():
    """``compat`` must scan every directory an apply-* workflow applies — a new one must fail here."""
    applied = set()
    workflows = sorted((REPO / ".github/workflows").glob("apply-*migrations.yml"))
    for wf in workflows:
        applied.update(re.findall(r'MIG_DIR="([^"]+)"', wf.read_text(encoding="utf-8")))
    assert len(workflows) >= 2 and applied, "found no apply-* migration workflows to compare"
    assert applied == set(rc.MIGRATION_DIRS)


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
    assert {h["path"] for h in hits} == {"mira-hub/db/migrations/003_c.sql"}
    assert {h["kind"] for h in hits} == {"contracting", "unproven"}
    res = cli("compat", "--candidate", cand, "--head", head, "--repo", str(repo))
    assert res.returncode == 1 and "CONTRACTING mira-hub/db/migrations/003_c.sql" in res.stdout


def test_contracting_since_scans_the_ingest_migrations_too(tmp_path):
    repo, cand = _repo(tmp_path)
    ingest = repo / "mira-core/mira-ingest/db/migrations"
    ingest.mkdir(parents=True)
    (ingest / "012_x.sql").write_text("ALTER TABLE chunks DROP COLUMN legacy;\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "head")
    hits = rc.contracting_since(cand, _git(repo, "rev-parse", "HEAD"), repo)
    assert {h["path"] for h in hits} == {"mira-core/mira-ingest/db/migrations/012_x.sql"}
    assert set(rc.MIGRATION_DIRS) == {
        "mira-hub/db/migrations",
        "mira-core/mira-ingest/db/migrations",
    }


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
