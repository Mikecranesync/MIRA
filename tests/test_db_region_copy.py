"""tools/db_region_copy.py - the pure parts: address handling, refusals, command shape, comparison.

The copy itself needs two real databases; it is exercised by the db-region-copy workflow, whose
final step IS the comparison these tests pin. What is pinned here is everything that decides
whether a run is allowed to start and whether its result is allowed to pass.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys

import pytest

_PATH = pathlib.Path(__file__).resolve().parents[1] / "tools" / "db_region_copy.py"
_spec = importlib.util.spec_from_file_location("db_region_copy", _PATH)
assert _spec and _spec.loader
m = importlib.util.module_from_spec(_spec)
sys.modules["db_region_copy"] = m
_spec.loader.exec_module(m)

# Fixture addresses are assembled from parts so that no line of this file looks like a real
# connection string to a secret scanner. Nothing here is a credential.
_USER, _SRC_PW, _TGT_PW = "dbuser7", "fixture-src-word", "fixture-tgt-word"
_SRC_HOST = "ep-old-one-pooler.c-3.us-east-1.aws.neon.tech"
_TGT_HOST = "ep-new-one.c-5.us-west-2.aws.neon.tech"


def _url(host: str, password: str = _SRC_PW) -> str:
    return "postgresql" + "://" + _USER + ":" + password + "@" + host + "/neondb?sslmode=require"


SRC = _url(_SRC_HOST)
TGT = _url(_TGT_HOST, _TGT_PW)


# ---------------------------------------------------------------- addresses and secrets


def test_pooler_host_becomes_the_direct_host():
    assert (
        m.direct_host("ep-old-one-pooler.c-3.us-east-1.aws.neon.tech")
        == "ep-old-one.c-3.us-east-1.aws.neon.tech"
    )
    assert m.Address(SRC).host == "ep-old-one.c-3.us-east-1.aws.neon.tech"


def test_direct_host_is_left_alone_and_only_the_first_label_is_touched():
    assert (
        m.direct_host("ep-new-one.c-5.us-west-2.aws.neon.tech")
        == "ep-new-one.c-5.us-west-2.aws.neon.tech"
    )
    assert m.direct_host("db.my-pooler.example.com") == "db.my-pooler.example.com"


def test_secrets_travel_in_the_environment_never_in_a_command_line():
    a = m.Address(SRC)
    env = a.env("neondb")
    assert (
        env["PGPASSWORD"] == _SRC_PW and env["PGHOST"] == a.host and env["PGSSLMODE"] == "require"
    )
    for cmd in (
        m.dump_command("00000003-0000001B-1", ("public.t",), False),
        m.restore_command("neondb"),
    ):
        joined = " ".join(cmd)
        for secret in a.secrets() + [_SRC_PW, _TGT_PW, "neon.tech", "postgres:", "postgresql:"]:
            assert secret not in joined


def test_redact_removes_host_user_password_and_any_url():
    a, b = m.Address(SRC), m.Address(TGT)
    text = (
        f'connection to server at "{a.host}" failed for user {_USER} password {_SRC_PW}; see {TGT}'
    )
    out = m.redact(text, a, b)
    assert (
        _SRC_PW not in out
        and _TGT_PW not in out
        and a.host not in out
        and "neon.tech" not in out
        and "dbuser7" not in out
    )


def test_repr_never_shows_the_address():
    assert _SRC_PW not in repr(m.Address(SRC)) and "neon" not in repr(m.Address(SRC))


def test_an_empty_or_non_postgres_address_is_refused(monkeypatch):
    monkeypatch.delenv("NOPE", raising=False)
    with pytest.raises(m.Refusal):
        m.address_from_env("NOPE")
    with pytest.raises(m.Refusal):
        m.Address("https://example.com/neondb")


# ---------------------------------------------------------------- refusals before any copy


def _no_db(monkeypatch, relations="0"):
    calls = []

    def fake(addr, database, sql, timeout=1800):
        calls.append((addr.host, database, sql))
        return relations

    monkeypatch.setattr(m, "_psql", fake)
    return calls


def test_refuses_when_source_and_target_are_the_same_host(monkeypatch):
    _no_db(monkeypatch)
    with pytest.raises(m.Refusal, match="same host"):
        m.check_preconditions(
            m.Address(SRC), m.Address(SRC.replace("-pooler", "")), "neondb", "us-west-2"
        )


def test_refuses_a_target_outside_the_expected_region(monkeypatch):
    _no_db(monkeypatch)
    other = TGT.replace("us-west-2", "eu-central-1")
    with pytest.raises(m.Refusal, match="expected region"):
        m.check_preconditions(m.Address(SRC), m.Address(other), "neondb", "us-west-2")


def test_refuses_when_source_and_target_look_swapped(monkeypatch):
    _no_db(monkeypatch)
    with pytest.raises(m.Refusal, match="swapped"):
        m.check_preconditions(
            m.Address(TGT),
            m.Address(TGT.replace("ep-new-one", "ep-new-two")),
            "neondb",
            "us-west-2",
        )


def test_refuses_to_restore_over_a_target_that_is_not_empty(monkeypatch):
    _no_db(monkeypatch, relations="7")
    with pytest.raises(m.Refusal, match="not empty"):
        m.check_preconditions(m.Address(SRC), m.Address(TGT), "neondb", "us-west-2")


def test_the_emptiness_check_counts_every_kind_of_object(monkeypatch):
    calls = _no_db(monkeypatch)
    m.check_preconditions(m.Address(SRC), m.Address(TGT), "neondb", "us-west-2")
    sql = calls[-1][2]
    # Any relation kind (a foreign table or a composite type is not "empty"), plus functions,
    # types and extra schemas.
    assert "relkind IN" not in sql
    for catalog in (
        "pg_class",
        "pg_proc",
        "pg_type",
        "pg_namespace",
        "pg_operator",
        "pg_collation",
        "pg_ts_config",
        "pg_statistic_ext",
        "pg_largeobject_metadata",
        "pg_event_trigger",
        "pg_publication",
        "pg_foreign_server",
        "pg_extension",
    ):
        assert catalog in sql
    assert "<> 'public'" in sql


def test_the_emptiness_check_reads_the_target_not_the_source(monkeypatch):
    calls = _no_db(monkeypatch)
    m.check_preconditions(m.Address(SRC), m.Address(TGT), "neondb", "us-west-2")
    assert [c[0] for c in calls] == [m.Address(TGT).host]


# ---------------------------------------------------------------- command shape


def test_dump_reads_through_the_exported_snapshot_and_leaves_the_named_rows():
    cmd = m.dump_command("00000003-0000001B-1", ("public.cmms_sync_conflicts",), False)
    assert cmd[0] == "pg_dump" and "--snapshot=00000003-0000001B-1" in cmd
    assert "--exclude-table-data=public.cmms_sync_conflicts" in cmd and "--schema-only" not in cmd
    for s in m.EXCLUDED_SCHEMAS:
        assert f"--exclude-schema={s}" in cmd
    assert "--exclude-extension=pg_session_jwt" in cmd


def test_dump_never_carries_a_write_or_clean_flag():
    for structure in (True, False):
        cmd = m.dump_command("1-1", (), structure)
        assert not any(f in cmd for f in ("--clean", "-c", "--create", "-C", "--if-exists"))
    assert not any(
        f in m.restore_command("neondb") for f in ("--clean", "-c", "--create", "-C", "--if-exists")
    )


def test_structure_mode_copies_no_rows():
    assert "--schema-only" in m.dump_command("1-1", ("public.t",), True)


@pytest.mark.parametrize(
    "bad", ["cmms_sync_conflicts", "public.t; DROP TABLE x", "public.*", "a.b.c", "Public.T"]
)
def test_a_table_to_leave_behind_must_be_a_plain_schema_dot_table(bad):
    with pytest.raises(m.Refusal):
        m.dump_command("1-1", (bad,), False)


@pytest.mark.parametrize("bad", ["1-1; DROP", "abc xyz", "$(id)"])
def test_a_snapshot_id_of_the_wrong_shape_is_refused(bad):
    with pytest.raises(m.Refusal):
        m.dump_command(bad, (), False)


def test_the_inventory_is_read_only_sql():
    sql = m.inventory_sql().upper()
    for word in (
        "INSERT ",
        "UPDATE ",
        "DELETE ",
        "DROP ",
        "ALTER ",
        "CREATE ",
        "TRUNCATE ",
        "GRANT ",
        "COPY ",
    ):
        assert word not in sql, word
    assert (
        "'NEON_AUTH'" in sql and "'PGRST'" in sql
    )  # the excluded schemas are excluded from the inventory too


# ---------------------------------------------------------------- the comparison is the gate


def _inv(**over):
    base = {
        "server": {"major": 17, "encoding": "UTF8"},
        "extensions": {"vector": "0.8.0", "ltree": "1.3"},
        "roles": {"factorylm_app": {"login": False, "bypassrls": False}},
        "owner_can_use_restricted_role": True,
        "tables": {
            "public.a": {
                "rows": 10,
                "rls": True,
                "force_rls": False,
                "owner": "neondb_owner",
                "acl": "x",
                "columns": "c1",
            },
            "public.log": {
                "rows": 5000,
                "rls": True,
                "force_rls": False,
                "owner": "neondb_owner",
                "acl": "x",
                "columns": "c2",
            },
        },
        "policies": {"public.a.tenant": "p1"},
        "indexes": {"public.a_pkey": "i1"},
        "sequences": {"public.a_id_seq": 10},
        "ledger": "134:abc",
    }
    for k, v in over.items():
        base[k] = v
    return base


def _tables(**rows):
    t = _inv()["tables"]
    return {k: dict(v, rows=rows.get(k.split(".")[1], v["rows"])) for k, v in t.items()}


def test_identical_inventories_match():
    assert m.compare(_inv(), _inv()) == ([], [])


def test_a_named_table_may_be_left_behind_only_if_the_target_has_zero_rows():
    unexpected, expected = m.compare(_inv(), _inv(tables=_tables(log=0)), ("public.log",))
    assert unexpected == [] and len(expected) == 1 and "public.log" in expected[0]
    unexpected, _ = m.compare(_inv(), _inv(tables=_tables(log=4999)), ("public.log",))
    assert unexpected and "public.log" in unexpected[0]  # a PARTIAL copy is never acceptable


def test_a_row_count_difference_on_any_other_table_fails():
    unexpected, _ = m.compare(_inv(), _inv(tables=_tables(a=9)), ("public.log",))
    assert unexpected == ["tables: public.a rows source=10 target=9"]


def test_row_security_switched_off_on_the_target_fails_even_for_a_left_behind_table():
    t = _tables(log=0)
    t["public.log"]["rls"] = False
    unexpected, _ = m.compare(_inv(), _inv(tables=t), ("public.log",))
    assert unexpected == ["tables: public.log differs in rls"]


@pytest.mark.parametrize("field", ["acl", "owner", "columns", "force_rls"])
def test_any_other_table_property_difference_fails(field):
    t = _tables()
    t["public.a"][field] = "changed"
    unexpected, _ = m.compare(_inv(), _inv(tables=t))
    assert unexpected == [f"tables: public.a differs in {field}"]


def test_a_missing_or_extra_policy_fails_and_policies_are_never_tolerated():
    assert m.compare(_inv(), _inv(policies={}))[0] == [
        "policies: MISSING on target: public.a.tenant"
    ]
    assert m.compare(_inv(), _inv(policies={"public.a.tenant": "p1", "public.a.extra": "p2"}))[
        0
    ] == ["policies: only on target: public.a.extra"]
    assert m.compare(_inv(), _inv(policies={"public.a.tenant": "DIFFERENT"}), structure_only=True)[
        0
    ] == ["policies: differs: public.a.tenant"]


def test_a_missing_table_fails():
    t = _tables()
    del t["public.a"]
    assert "tables: MISSING on target: public.a" in m.compare(_inv(), _inv(tables=t))[0]


def test_extension_versions_may_differ_but_a_missing_extension_fails():
    unexpected, expected = m.compare(_inv(), _inv(extensions={"vector": "0.8.7", "ltree": "1.3"}))
    assert unexpected == [] and expected == ["extension version: vector 0.8.0 -> 0.8.7"]
    older = m.compare(_inv(), _inv(extensions={"vector": "0.7.9", "ltree": "1.3"}))
    assert older == (["extensions: vector is OLDER on target: 0.8.0 -> 0.7.9"], [])
    odd = m.compare(_inv(), _inv(extensions={"vector": "next", "ltree": "1.3"}))
    assert odd[0] == ["extensions: vector is OLDER on target: 0.8.0 -> next"]
    assert m._version_not_older("1.9", "1.10") and not m._version_not_older("1.10", "1.9")
    assert m.compare(_inv(), _inv(extensions={"ltree": "1.3"}))[0] == [
        "extensions: MISSING on target: vector"
    ]


def test_a_sequence_may_be_ahead_on_the_target_never_behind():
    assert m.compare(_inv(), _inv(sequences={"public.a_id_seq": 12})) == (
        [],
        ["sequence position: public.a_id_seq 10 -> 12"],
    )
    assert m.compare(_inv(), _inv(sequences={"public.a_id_seq": 9}))[0] == [
        "sequences: differs: public.a_id_seq"
    ]


def test_the_migration_ledger_must_match_in_a_full_copy():
    assert m.compare(_inv(), _inv(ledger="133:zzz"))[0] == [
        "ledger: source='134:abc' target='133:zzz'"
    ]


def test_losing_the_restricted_role_switch_fails():
    assert m.compare(_inv(), _inv(owner_can_use_restricted_role=False))[0] == [
        "owner_can_use_restricted_role: source=True target=False"
    ]


def test_a_changed_role_flag_fails():
    roles = {"factorylm_app": {"login": False, "bypassrls": True}}
    assert m.compare(_inv(), _inv(roles=roles))[0] == ["roles: differs: factorylm_app"]


def test_structure_mode_tolerates_rows_sequences_and_ledger_but_nothing_structural():
    target = _inv(tables=_tables(a=0, log=0), sequences={"public.a_id_seq": 0}, ledger="0:empty")
    unexpected, expected = m.compare(_inv(), target, structure_only=True)
    assert unexpected == [] and len(expected) == 4
    target["indexes"] = {}
    assert m.compare(_inv(), target, structure_only=True)[0] == [
        "indexes: MISSING on target: public.a_pkey"
    ]


def test_collapse_keeps_every_kind_but_not_every_line():
    lines = [f"rows left behind: t{i}" for i in range(50)] + ["extension version: vector 1 -> 2"]
    out = m.collapse(lines)
    assert "extension version: vector 1 -> 2" in out and len(out) == 5 and "47 more" in out[3]


# ---------------------------------------------------------------- content, not only counts


def test_same_row_count_with_different_content_fails():
    t = _tables()
    t["public.a"]["content"] = "12345"
    src = _inv()
    src["tables"]["public.a"]["content"] = "99999"
    assert m.compare(src, _inv(tables=t))[0] == [
        "tables: public.a same row count but DIFFERENT CONTENT"
    ]


def test_a_left_behind_table_is_not_judged_on_content():
    src = _inv()
    src["tables"]["public.log"]["content"] = "not read"
    tgt = _inv(tables=_tables(log=0))
    tgt["tables"]["public.log"]["content"] = "not read"
    assert m.compare(src, tgt, ("public.log",))[0] == []


def test_the_fingerprint_query_reads_every_table_except_the_ones_left_behind():
    sql = m.inventory_sql(True, ("public.cmms_sync_conflicts",))
    assert (
        "hashtextextended(t::text, 0)" in sql
        and "hashtextextended(t::text, 1)" in sql
        and "IN ('public.cmms_sync_conflicts') THEN 'not read'" in sql
    )
    assert "hashtextextended" not in m.inventory_sql(False)
    with pytest.raises(ValueError):
        m.inventory_sql(True, ("public.t'; DROP TABLE x; --",))


def test_only_the_known_platform_error_is_tolerated_from_the_restore():
    stderr = (
        "pg_restore: error: could not execute query: ERROR:  permission denied to change default privileges\n"
        "Command was: ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser;\n"
        'pg_restore: error: could not execute query: ERROR:  relation "public.t" does not exist\n'
        "pg_restore: warning: errors ignored on restore: 2\n"
    )
    tolerated, other = m.classify_restore_output(stderr)
    assert len(tolerated) == 1 and len(other) == 1 and "does not exist" in other[0]
    assert m.classify_restore_output("") == ([], [])


@pytest.mark.parametrize(
    "section", ["types", "rules", "extended_statistics", "event_triggers", "publications"]
)
def test_object_kinds_a_dump_could_drop_are_in_the_inventory_and_gate(section):
    assert f"'{section}'" in m.inventory_sql()
    src = _inv(**{section: {"public.thing": "x"}})
    assert m.compare(src, _inv(**{section: {}}))[0] == [
        f"{section}: MISSING on target: public.thing"
    ]


# ---------------------------------------------------------------- production stays out of reach

PROD = "ep-purple-hall-ahimeyn0"


@pytest.mark.parametrize(
    "host", [f"{PROD}.c-3.us-east-1.aws.neon.tech", f"{PROD}-pooler.c-3.us-east-1.aws.neon.tech"]
)
def test_a_refused_endpoint_is_refused_as_source_pooled_or_direct(monkeypatch, host):
    _no_db(monkeypatch)
    src = _url(host)
    with pytest.raises(m.Refusal, match="never to touch"):
        m.check_preconditions(m.Address(src), m.Address(TGT), "neondb", "us-west-2", (PROD,))


def test_a_refused_endpoint_is_refused_as_target_before_the_database_is_contacted(monkeypatch):
    calls = _no_db(monkeypatch)
    tgt = _url(f"{PROD}.c-5.us-west-2.aws.neon.tech")
    with pytest.raises(m.Refusal, match="never to touch"):
        m.check_preconditions(m.Address(SRC), m.Address(tgt), "neondb", "us-west-2", (PROD,))
    assert calls == []


def test_a_different_endpoint_with_a_similar_name_is_not_refused(monkeypatch):
    _no_db(monkeypatch)
    src = _url(f"{PROD}x.c-3.us-east-1.aws.neon.tech")
    m.check_preconditions(m.Address(src), m.Address(TGT), "neondb", "us-west-2", (PROD,))


_WORKFLOW = (
    pathlib.Path(__file__).resolve().parents[1] / ".github" / "workflows" / "db-region-copy.yml"
)


def test_the_workflow_reads_staging_only_and_names_production_only_to_refuse_it():
    text = _WORKFLOW.read_text(encoding="utf8")
    code = "\n".join(ln for ln in text.splitlines() if not ln.lstrip().startswith("#"))
    assert "--config stg" in code and "--config prd" not in code and "config prd" not in code
    assert "environment: staging" in code and "environment: production" not in code
    assert f"--refuse-host {PROD}" in code and code.count(PROD) == 1
    assert (
        "workflow_dispatch" in code
        and "schedule:" not in code
        and "pull_request" not in code
        and "push:" not in code
    )
    assert "default: 'structure'" in code and "copy staging to oregon" in code
    assert "contents: read" in code and "write" not in code.split("jobs:")[0]


def test_the_workflow_keeps_addresses_out_of_command_lines():
    """Every line that mentions an address variable is one of a few known-safe shapes."""
    safe = (
        "TARGET_DATABASE_URL: ${{ secrets.NEON_STG_USW2_DATABASE_URL }}",
        'if [ -z "${TARGET_DATABASE_URL:-}" ]; then',
        'if [ -z "${SOURCE_DATABASE_URL}" ]; then',
        'SOURCE_DATABASE_URL="$(doppler secrets get NEON_DATABASE_URL --project factorylm --config stg --plain)"',
        'echo "::add-mask::${SOURCE_DATABASE_URL}"',
        "export SOURCE_DATABASE_URL",
        "--source-env SOURCE_DATABASE_URL \\",
        "--target-env TARGET_DATABASE_URL \\",
    )
    lines = [ln.strip() for ln in _WORKFLOW.read_text(encoding="utf8").splitlines()]
    mentions = [
        ln
        for ln in lines
        if "DATABASE_URL" in ln and not ln.startswith("#") and "::error::" not in ln
    ]
    assert len(mentions) == len(safe)
    for ln in mentions:
        assert ln in safe, ln


# ---------------------------------------------------------------- both sides are read the same way


def test_both_inventories_run_under_the_same_pinned_session_settings(monkeypatch):
    seen = []

    def fake(addr, database, sql, timeout=1800):
        seen.append(sql)
        return "{}"

    monkeypatch.setattr(m, "_psql", fake)
    m.take_inventory(m.Address(TGT), "neondb", True, ("public.t",))
    assert seen[0].startswith(m.SESSION_PIN) and "READ ONLY" in seen[0]
    for setting in (
        "search_path = pg_catalog",
        "TimeZone = 'UTC'",
        "DateStyle = 'ISO, MDY'",
        "bytea_output = 'hex'",
    ):
        assert setting in m.SESSION_PIN


def test_role_and_database_settings_are_in_the_inventory_and_gate():
    assert "'settings'" in m.inventory_sql() and "pg_db_role_setting" in m.inventory_sql()
    src = _inv(settings={"neondb_owner|*": "search_path=app"})
    assert m.compare(src, _inv(settings={}))[0] == ["settings: MISSING on target: neondb_owner|*"]
    assert m.compare(src, _inv(settings={"neondb_owner|*": "search_path=other"}))[0] == [
        "settings: differs: neondb_owner|*"
    ]


# ---------------------------------------------------------------- reprinted definitions

_SRC_DEF = "CHECK (((status)::text = ANY ((ARRAY['a'::character varying, 'b c'::character varying])::text[])))"
_TGT_DEF = "CHECK (((status)::text = ANY (ARRAY[('a'::character varying)::text, ('b c'::character varying)::text])))"


def test_a_definition_reprinted_by_a_restore_compares_equal():
    assert _SRC_DEF != _TGT_DEF
    assert m.canonical_definition(_SRC_DEF) == m.canonical_definition(_TGT_DEF)


def test_grouping_parentheses_are_never_removed():
    a = m.canonical_definition("CHECK (((a = 1) OR (b = 1)) AND (c = 1))")
    b = m.canonical_definition("CHECK ((a = 1) OR ((b = 1) AND (c = 1)))")
    assert a != b


def test_canonical_form_keeps_calls_literals_and_other_casts_apart():
    c = m.canonical_definition
    assert c("CHECK (lower(name) = 'x')") != c("CHECK (lowername = 'x')")
    assert c("CHECK (x = '(a)::text')") != c("CHECK (x = 'a')")
    assert c("CHECK ((c)::bpchar = 'a')") != c("CHECK ((c)::text = 'a')")
    assert c("CHECK (x = 'a b')") != c("CHECK (x = 'ab')")
    assert c('CHECK ("my (col)" > 0)') != c('CHECK ("my col" > 0)')
    assert c("CHECK (n = numeric(10,2))") != c("CHECK (n = numeric10,2)")


def test_compare_tolerates_a_reprint_but_not_a_changed_constraint_or_index():
    for section in ("constraints", "indexes"):
        same = m.compare(
            _inv(**{section: {"public.a.k": _SRC_DEF}}), _inv(**{section: {"public.a.k": _TGT_DEF}})
        )
        assert same == ([], [f"{section}: reprinted by the restore, same meaning: public.a.k"])
        changed = m.compare(
            _inv(**{section: {"public.a.k": "CHECK (((a = 1) OR (b = 1)) AND (c = 1))"}}),
            _inv(**{section: {"public.a.k": "CHECK ((a = 1) OR ((b = 1) AND (c = 1)))"}}),
        )
        assert changed == ([f"{section}: differs: public.a.k"], [])
    # No other section gets the tolerance.
    pol = m.compare(_inv(policies={"p": _SRC_DEF}), _inv(policies={"p": _TGT_DEF}))
    assert pol[0] == ["policies: differs: p"]


def test_definitions_are_no_longer_normalized_inside_the_database_and_domains_are_read():
    sql = m.inventory_sql()
    assert "[()[:space:]]" not in sql
    assert "contypid" in sql and "typbasetype" in sql and "typnotnull" in sql


# ---------------------------------------------------------------- behaviour, not only source text


def test_objects_are_inventoried_on_what_changes_their_behaviour():
    sql = m.inventory_sql()
    # Functions: the full definition (volatility, strictness, language, settings) and the owner.
    assert "pg_get_functiondef(p.oid)" in sql and "p.proowner" in sql
    # Triggers: enabled or disabled is not part of the trigger definition text.
    assert "t.tgenabled" in sql
    # Sequences: how they count, separately from where they are.
    for column in ("increment_by", "min_value", "max_value", "cycle", "cache_size", "start_value"):
        assert column in sql
    # Tables: kind, persistence, partitioning, inheritance, column collation.
    for piece in (
        "c.relpersistence",
        "pg_get_partkeydef(c.oid)",
        "c.relpartbound",
        "pg_inherits",
        "a.attcollation",
    ):
        assert piece in sql
    # Views run with their owner's rights unless told otherwise.
    views = sql[sql.index("'views'") : sql.index("'sequences'")]
    assert (
        views.count("c.relowner") == 2
        and views.count("c.reloptions") == 2
        and views.count("c.relacl") == 2
    )
    assert "n.nspowner" in sql


def test_a_sequence_that_counts_differently_fails_even_at_the_same_position():
    src = _inv(sequences={"public.s": 5}, sequence_settings={"public.s": "bigint|1|1|9|1|false|1"})
    tgt = _inv(sequences={"public.s": 5}, sequence_settings={"public.s": "bigint|1|1|9|2|false|1"})
    assert m.compare(src, tgt)[0] == ["sequence_settings: differs: public.s"]
    assert m.compare(src, tgt, structure_only=True)[0] == ["sequence_settings: differs: public.s"]
