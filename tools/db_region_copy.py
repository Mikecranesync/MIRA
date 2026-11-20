#!/usr/bin/env python3
"""Copy one Postgres database into an EMPTY database in another region, and prove the copy.

Why this exists: the Hub server (Oregon) and its Neon database (Virginia) are a continent
apart, and every query pays the trip. Neon cannot change a project's region in place, so the
data has to be copied into a new project. See docs/runbooks/db-region-move.md.

What it does (subcommand ``copy``):

1. Opens ONE read-only transaction on the source and exports its snapshot.
2. Takes a structural inventory of the source inside that transaction.
3. Runs ``pg_dump`` through the SAME exported snapshot, piped straight into ``pg_restore``.
   Nothing is written to disk.
4. Takes the same inventory of the target and compares the two. The run fails unless the only
   differences are the declared ones (tables whose rows were deliberately left behind,
   extension versions, sequences that advanced during the dump).

Because the inventory and the dump read through one snapshot, the comparison is exact even
while the source is being written to. Writes made to the source after that instant are NOT
carried: stop writers first when that matters.

Safety properties, each covered by tests/test_db_region_copy.py:

* The source is only ever read (a READ ONLY transaction, and ``pg_dump``).
* The target must be empty and must be a different host in the expected region, or the run
  refuses before copying anything.
* Addresses and passwords travel in the child processes' environment, never in a command
  line, and are redacted from anything this tool prints.

Stdlib only. Needs ``psql``, ``pg_dump`` and ``pg_restore`` of the SERVER's major version on
PATH (a version-16 ``pg_dump`` refuses a version-17 server).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from typing import Any, Optional
from urllib.parse import unquote, urlparse

# Pieces created by Neon's own optional features (sign-in, Data API). They belong to
# Neon-managed roles that an ordinary owner cannot recreate, nothing in this repo reads them,
# and a new project gets them by enabling the feature - not by copying.
EXCLUDED_SCHEMAS = ("neon_auth", "pgrst", "auth")
EXCLUDED_EXTENSIONS = ("pg_session_jwt",)
# The application's own roles. They must exist on the target BEFORE the copy (a dump does not
# carry roles), with the same flags; the inventory compares them.
APP_ROLES = ("factorylm_app", "anonymous", "authenticated", "authenticator")
OWNER_ROLE = "neondb_owner"
RESTRICTED_ROLE = "factorylm_app"

_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")
_QUALIFIED = re.compile(r"^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$")


class Refusal(Exception):
    """A precondition failed. Nothing was copied."""


# --------------------------------------------------------------------------- addresses


class Address:
    """A parsed database address. ``repr`` never shows a secret."""

    def __init__(self, url: str) -> None:
        p = urlparse(url)
        if p.scheme not in ("postgres", "postgresql") or not p.hostname or not p.username:
            raise Refusal("database address is missing or not a postgres URL")
        self.host = direct_host(p.hostname)
        self.port = str(p.port or 5432)
        self.user = unquote(p.username)
        self.password = unquote(p.password or "")
        self.database = unquote(p.path.lstrip("/")) or "postgres"

    def env(self, database: Optional[str] = None) -> dict[str, str]:
        """Environment for a child process. Secrets go here, never in argv."""
        return {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "PGHOST": self.host,
            "PGPORT": self.port,
            "PGUSER": self.user,
            "PGPASSWORD": self.password,
            "PGDATABASE": database or self.database,
            "PGSSLMODE": "require",
            "PGCONNECT_TIMEOUT": "20",
            "PGAPPNAME": "db_region_copy",
        }

    def secrets(self) -> list[str]:
        return [s for s in (self.password, self.host, self.user) if s]

    def __repr__(self) -> str:  # pragma: no cover - defensive
        return "Address(<redacted>)"


def direct_host(host: str) -> str:
    """Neon's pooler host is the endpoint id plus ``-pooler``. Dump and restore, and an
    exported snapshot, need the direct host: a transaction pooler does not keep one backend
    per client."""
    first, dot, rest = host.partition(".")
    if first.endswith("-pooler"):
        first = first[: -len("-pooler")]
    return first + dot + rest


def redact(text: str, *addresses: Address) -> str:
    for a in addresses:
        for s in a.secrets():
            text = text.replace(s, "***")
    return re.sub(r"postgres(ql)?://\S+", "postgres://***", text)


def address_from_env(name: str) -> Address:
    value = os.environ.get(name, "")
    if not value:
        raise Refusal(f"environment variable {name} is empty")
    return Address(value)


# --------------------------------------------------------------------------- inventory SQL


# Both inventories run under the same session settings. A row's text form, and the way
# Postgres prints a definition, depend on them (time zone, date style, how names are
# qualified), and a role or database default could differ between the two sides.
SESSION_PIN = (
    "SET statement_timeout = 0;\n"
    "SET idle_in_transaction_session_timeout = 0;\n"
    "SET search_path = pg_catalog;\n"
    "SET TimeZone = 'UTC';\n"
    "SET DateStyle = 'ISO, MDY';\n"
    "SET IntervalStyle = 'postgres';\n"
    "SET extra_float_digits = 1;\n"
    "SET bytea_output = 'hex';\n"
    "SET lc_monetary = 'C';\n"
)


def _in_list(names: tuple[str, ...]) -> str:
    for n in names:
        if not _IDENT.match(n):
            raise ValueError(f"unsafe identifier {n!r}")
    return "(" + ", ".join(f"'{n}'" for n in names) + ")"


def inventory_sql(fingerprint: bool = False, no_fingerprint: tuple[str, ...] = ()) -> str:
    """One statement that returns the whole inventory as a single JSON line.

    With ``fingerprint`` every table also gets a content fingerprint: the sum of a 64-bit hash
    of each row's text form. It does not depend on row order, so it needs no key, and two
    tables holding the same rows give the same number. Tables in ``no_fingerprint`` (the ones
    whose rows are deliberately left behind) are counted but not read row by row.
    """
    for t in no_fingerprint:
        if not _QUALIFIED.match(t):
            raise ValueError(f"unsafe table name {t!r}")
    if fingerprint:
        not_read = "(" + ", ".join(f"'{t}'" for t in no_fingerprint or ("",)) + ")"
        content = (
            f"CASE WHEN (n.nspname || '.' || c.relname) IN {not_read} THEN 'not read' ELSE"
            " (xpath('/row/h/text()', query_to_xml(format("
            "'SELECT COALESCE(sum(hashtextextended(t::text, 0)), 0)::text AS h FROM %I.%I t',"
            " n.nspname, c.relname), false, true, '')))[1]::text END"
        )
    else:
        content = "'not read'"
    skip = _in_list(("pg_catalog", "information_schema", "pg_toast") + EXCLUDED_SCHEMAS)
    user_ns = f"n.nspname NOT IN {skip} AND n.nspname NOT LIKE 'pg\\_temp%' AND n.nspname NOT LIKE 'pg\\_toast\\_temp%'"
    roles = _in_list(APP_ROLES)
    owner_and_roles = _in_list(APP_ROLES + (OWNER_ROLE,))
    ext_skip = _in_list(("plpgsql",) + EXCLUDED_EXTENSIONS)
    acl = "COALESCE((SELECT string_agg(a::text, ';' ORDER BY a::text) FROM unnest({col}) a), '')"
    # A restore RE-PARSES every expression, and Postgres then prints the same check differently:
    #   source:  (status)::text = ANY ((ARRAY['a'::character varying])::text[])
    #   target:  (status)::text = ANY (ARRAY[('a'::character varying)::text])
    # Same meaning, different text. So constraint and index definitions are compared after
    # removing text-type casts, parentheses and whitespace. Row-security policies are NOT
    # loosened this way: they are compared exactly.
    canon = (
        "md5(regexp_replace(regexp_replace({expr}, '::(character varying|text|bpchar|name)(\\[\\])?', '', 'g'),"
        " '[()[:space:]]', '', 'g'))"
    )
    count = (
        "(xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),"
        " false, true, '')))[1]::text::bigint"
    )
    ledger = (
        "CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN NULL ELSE"
        " (xpath('/row/d/text()', query_to_xml($q$SELECT count(*) || ':' || md5(COALESCE(string_agg("
        "migration_name || ':' || COALESCE(content_sha256, ''), E'\\n' ORDER BY migration_name), ''))"
        " AS d FROM public.schema_migrations$q$, false, true, '')))[1]::text END"
    )
    return f"""
SELECT jsonb_build_object(
 'server', (SELECT jsonb_build_object('major', current_setting('server_version_num')::int / 10000,
     'encoding', pg_encoding_to_char(d.encoding), 'collate', d.datcollate, 'ctype', d.datctype)
     FROM pg_database d WHERE d.datname = current_database()),
 'extensions', (SELECT COALESCE(jsonb_object_agg(extname, extversion), '{{}}') FROM pg_extension WHERE extname NOT IN {ext_skip}),
 'schemas', (SELECT COALESCE(jsonb_object_agg(n.nspname, {acl.format(col="n.nspacl")}), '{{}}') FROM pg_namespace n WHERE {user_ns}),
 'roles', (SELECT COALESCE(jsonb_object_agg(r.rolname, jsonb_build_object('login', r.rolcanlogin, 'super', r.rolsuper,
     'bypassrls', r.rolbypassrls, 'createrole', r.rolcreaterole, 'inherit', r.rolinherit,
     'member_of', COALESCE((SELECT string_agg(DISTINCT g.rolname, ',' ORDER BY g.rolname) FROM pg_auth_members m
        JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid AND g.rolname IN {roles}), ''),
     'settings', COALESCE((SELECT string_agg(x, ';' ORDER BY x) FROM pg_db_role_setting s, unnest(s.setconfig) x
        WHERE s.setrole = r.oid AND s.setdatabase = 0), ''))), '{{}}')
     FROM pg_roles r WHERE r.rolname IN {roles}),
 'settings', (SELECT COALESCE(jsonb_object_agg(COALESCE(r.rolname, '*') || '|' || COALESCE(d.datname, '*'),
     (SELECT string_agg(x, ';' ORDER BY x) FROM unnest(s.setconfig) x)), '{{}}')
     FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid = s.setrole LEFT JOIN pg_database d ON d.oid = s.setdatabase
     WHERE (s.setrole = 0 OR r.rolname IN {owner_and_roles}) AND (s.setdatabase = 0 OR d.datname = current_database())),
 'owner_can_use_restricted_role', (SELECT COALESCE(bool_and(pg_has_role('{OWNER_ROLE}', r.oid, 'SET')), false)
     FROM pg_roles r WHERE r.rolname = '{RESTRICTED_ROLE}'),
 'tables', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || c.relname, jsonb_build_object('rows', {count},
     'content', {content},
     'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'owner', pg_get_userbyid(c.relowner),
     'options', COALESCE(array_to_string(c.reloptions, ','), '') || '|' || c.relreplident::text,
     'acl', {acl.format(col="c.relacl")},
     'columns', (SELECT md5(COALESCE(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
          || ':' || COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') || ':' || a.attgenerated::text || ':' || a.attidentity::text
          || ':' || COALESCE(a.attacl::text, ''), '|' ORDER BY a.attnum), ''))
        FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))), '{{}}')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND {user_ns}),
 'policies', (SELECT COALESCE(jsonb_object_agg(schemaname || '.' || tablename || '.' || policyname,
     md5(permissive || '|' || array_to_string(roles, ',') || '|' || cmd || '|' || COALESCE(qual, '') || '|' || COALESCE(with_check, ''))), '{{}}')
     FROM pg_policies p WHERE p.schemaname NOT IN {skip}),
 'indexes', (SELECT COALESCE(jsonb_object_agg(schemaname || '.' || indexname, {canon.format(expr="indexdef")}), '{{}}') FROM pg_indexes i WHERE i.schemaname NOT IN {skip}),
 'constraints', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || cl.relname || '.' || co.conname, {canon.format(expr="pg_get_constraintdef(co.oid)")}), '{{}}')
     FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE {user_ns}),
 'functions', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
     md5(p.prosrc) || ':' || p.prosecdef::text || ':' || {acl.format(col="p.proacl")}), '{{}}')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE {user_ns} AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')),
 'triggers', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))), '{{}}')
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND {user_ns}),
 'views', (SELECT COALESCE(jsonb_object_agg(schemaname || '.' || viewname, md5(definition)), '{{}}') FROM pg_views v WHERE v.schemaname NOT IN {skip}),
 'matviews', (SELECT COALESCE(jsonb_object_agg(schemaname || '.' || matviewname, md5(definition)), '{{}}') FROM pg_matviews v WHERE v.schemaname NOT IN {skip}),
 'sequences', (SELECT COALESCE(jsonb_object_agg(schemaname || '.' || sequencename, COALESCE(last_value, 0)), '{{}}') FROM pg_sequences s WHERE s.schemaname NOT IN {skip}),
 'sequence_acl', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || c.relname, {acl.format(col="c.relacl")}), '{{}}')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'S' AND {user_ns}),
 'enums', (SELECT COALESCE(jsonb_object_agg(k, v), '{{}}') FROM (SELECT n.nspname || '.' || t.typname AS k,
     string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS v FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
     JOIN pg_namespace n ON n.oid = t.typnamespace WHERE {user_ns} GROUP BY 1) q),
 'types', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || t.typname, t.typtype::text), '{{}}') FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace WHERE {user_ns} AND t.typtype IN ('c', 'd', 'e', 'r')
     AND (t.typrelid = 0 OR (SELECT k.relkind FROM pg_class k WHERE k.oid = t.typrelid) = 'c')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')),
 'rules', (SELECT COALESCE(jsonb_object_agg(schemaname || '.' || tablename || '.' || rulename, md5(definition)), '{{}}')
     FROM pg_rules r WHERE r.schemaname NOT IN {skip}),
 'extended_statistics', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || s.stxname, md5(pg_get_statisticsobjdef(s.oid))), '{{}}')
     FROM pg_statistic_ext s JOIN pg_namespace n ON n.oid = s.stxnamespace WHERE {user_ns}),
 'event_triggers', (SELECT COALESCE(jsonb_object_agg(evtname, evtevent), '{{}}') FROM pg_event_trigger
     WHERE pg_get_userbyid(evtowner) = '{OWNER_ROLE}'),
 'publications', (SELECT COALESCE(jsonb_object_agg(pubname, puballtables), '{{}}') FROM pg_publication),
 'large_objects', (SELECT count(*) FROM pg_largeobject_metadata),
 'default_acl', (SELECT COALESCE(jsonb_object_agg(pg_get_userbyid(a.defaclrole) || ':' || COALESCE(n.nspname, '*') || ':' || a.defaclobjtype::text,
     {acl.format(col="a.defaclacl")}), '{{}}')
     FROM pg_default_acl a LEFT JOIN pg_namespace n ON n.oid = a.defaclnamespace WHERE pg_get_userbyid(a.defaclrole) = '{OWNER_ROLE}'),
 'ledger', {ledger}
)::text;
"""


# --------------------------------------------------------------------------- comparison


def compare(
    source: dict[str, Any],
    target: dict[str, Any],
    leave_rows: tuple[str, ...] = (),
    structure_only: bool = False,
) -> tuple[list[str], list[str]]:
    """Return ``(unexpected, expected)`` difference descriptions.

    ``expected`` holds only the differences this tool is built to tolerate; anything else is
    ``unexpected`` and fails the run. A table named in ``leave_rows`` must have ZERO rows on the
    target - leaving rows behind is allowed, a partial copy is not.
    """
    unexpected: list[str] = []
    expected: list[str] = []
    for section in sorted(set(source) | set(target)):
        s, t = source.get(section), target.get(section)
        if not isinstance(s, dict) or not isinstance(t, dict):
            if s != t:
                if structure_only and section == "ledger":
                    expected.append("ledger: not copied in a structure-only run")
                else:
                    unexpected.append(f"{section}: source={s!r} target={t!r}")
            continue
        for key in sorted(set(s) | set(t)):
            if key not in t:
                unexpected.append(f"{section}: MISSING on target: {key}")
                continue
            if key not in s:
                unexpected.append(f"{section}: only on target: {key}")
                continue
            a, b = s[key], t[key]
            if a == b:
                continue
            if section == "extensions":
                expected.append(f"extension version: {key} {a} -> {b}")
            elif section == "sequences" and (structure_only or _not_behind(a, b)):
                expected.append(f"sequence position: {key} {a} -> {b}")
            elif section == "tables" and isinstance(a, dict) and isinstance(b, dict):
                rest_a = {k: v for k, v in a.items() if k not in ("rows", "content")}
                rest_b = {k: v for k, v in b.items() if k not in ("rows", "content")}
                if rest_a != rest_b:
                    fields = sorted(
                        k for k in set(rest_a) | set(rest_b) if rest_a.get(k) != rest_b.get(k)
                    )
                    unexpected.append(f"tables: {key} differs in {', '.join(fields)}")
                elif structure_only or (key in leave_rows and b.get("rows") == 0):
                    expected.append(
                        f"rows left behind: {key} source={a.get('rows')} target={b.get('rows')}"
                    )
                elif a.get("rows") != b.get("rows"):
                    unexpected.append(
                        f"tables: {key} rows source={a.get('rows')} target={b.get('rows')}"
                    )
                else:
                    unexpected.append(f"tables: {key} same row count but DIFFERENT CONTENT")
            else:
                unexpected.append(f"{section}: differs: {key}")
    return unexpected, expected


def _not_behind(source_value: Any, target_value: Any) -> bool:
    """A sequence may have advanced on the source while the dump ran; it must never be behind."""
    try:
        return int(target_value) >= int(source_value)
    except (TypeError, ValueError):
        return False


# --------------------------------------------------------------------------- commands


def dump_command(
    snapshot_id: Optional[str], leave_rows: tuple[str, ...], structure_only: bool
) -> list[str]:
    """argv for pg_dump. Contains no address and no secret (tested)."""
    for t in leave_rows:
        if not _QUALIFIED.match(t):
            raise Refusal(f"table to leave behind must be schema.table, got {t!r}")
    if snapshot_id is not None and not re.match(r"^[0-9A-Fa-f-]+$", snapshot_id):
        raise Refusal("unexpected snapshot id shape")
    cmd = ["pg_dump", "--format=custom", "--no-publications", "--no-subscriptions"]
    if snapshot_id is not None:
        cmd.append(f"--snapshot={snapshot_id}")
    cmd += [f"--exclude-schema={s}" for s in EXCLUDED_SCHEMAS]
    cmd += [f"--exclude-extension={e}" for e in EXCLUDED_EXTENSIONS]
    if structure_only:
        cmd.append("--schema-only")
    else:
        cmd += [f"--exclude-table-data={t}" for t in leave_rows]
    return cmd


def restore_command(database: str) -> list[str]:
    """argv for pg_restore. ``--no-owner``: every carried object belongs to the owner role on
    both sides, and the restoring user IS that role."""
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", database):
        raise Refusal("unexpected database name")
    return ["pg_restore", "--no-owner", f"--dbname={database}"]


def _psql(addr: Address, database: str, sql: str, timeout: int = 1800) -> str:
    r = subprocess.run(
        ["psql", "--no-psqlrc", "-qAt", "-v", "ON_ERROR_STOP=1"],
        input=sql,
        capture_output=True,
        text=True,
        env=addr.env(database),
        timeout=timeout,
    )
    if r.returncode != 0:
        raise Refusal("psql failed: " + redact(r.stderr.strip()[-400:], addr))
    return r.stdout.strip()


def check_preconditions(
    source: Address,
    target: Address,
    database: str,
    expect_region: str,
    refuse_hosts: tuple[str, ...] = (),
) -> None:
    for prefix in refuse_hosts:
        if not re.match(r"^[a-z0-9-]{6,}$", prefix):
            raise Refusal("a refused host must be an endpoint id (letters, digits, dashes)")
        for side, addr in (("source", source), ("target", target)):
            if addr.host.split(".")[0] == prefix or addr.host.startswith(prefix + "-"):
                raise Refusal(f"{side} is an endpoint this run is told never to touch")
    if source.host == target.host:
        raise Refusal("source and target are the same host")
    if expect_region and f".{expect_region}." not in target.host:
        raise Refusal(f"target host is not in the expected region {expect_region}")
    if expect_region and f".{expect_region}." in source.host:
        raise Refusal(f"source host is already in {expect_region}: source and target look swapped")
    skip = _in_list(("pg_catalog", "information_schema", "pg_toast"))
    n = _psql(
        target,
        database,
        f"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p','v','m','S') AND n.nspname NOT IN {skip};",
    )
    if n != "0":
        raise Refusal(
            f"target database {database} is not empty ({n} relations); refusing to restore over it"
        )


def take_inventory(
    addr: Address, database: str, fingerprint: bool = False, no_fingerprint: tuple[str, ...] = ()
) -> dict[str, Any]:
    return json.loads(
        _psql(
            addr,
            database,
            SESSION_PIN
            + "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
            + inventory_sql(fingerprint, no_fingerprint)
            + "\nROLLBACK;",
            timeout=7200,
        )
    )


# pg_restore keeps going after an error, so its exit code alone says little. These are the only
# errors a correct copy produces: the dump carries the platform's own default-privilege
# statements (owned by a platform role), and an ordinary owner may not replay them. The
# OWNER's default privileges are compared in the inventory, so nothing is taken on trust.
TOLERATED_RESTORE_ERRORS = ("permission denied to change default privileges",)


def classify_restore_output(stderr_text: str) -> tuple[list[str], list[str]]:
    """Split pg_restore's stderr into ``(tolerated, not_tolerated)`` error lines."""
    tolerated: list[str] = []
    other: list[str] = []
    for ln in stderr_text.splitlines():
        if "error:" not in ln:
            continue
        (tolerated if any(t in ln for t in TOLERATED_RESTORE_ERRORS) else other).append(ln.strip())
    return tolerated, other


def copy_database(
    source: Address,
    target: Address,
    database: str,
    leave_rows: tuple[str, ...],
    structure_only: bool,
    log=print,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, float], list[str]]:
    """Copy one database.

    Returns (source inventory, target inventory, timings in seconds, restore errors that are
    NOT on the tolerated list - any of those fails the run).
    """
    timings: dict[str, float] = {}
    holder = subprocess.Popen(
        ["psql", "--no-psqlrc", "-qAt", "-v", "ON_ERROR_STOP=1"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=source.env(database),
    )
    assert holder.stdin and holder.stdout
    try:
        t0 = time.monotonic()
        # The holder stays idle inside its transaction for the whole dump; do not let the
        # server reap it. READ ONLY + REPEATABLE READ: it can change nothing and sees one instant.
        holder.stdin.write(
            SESSION_PIN
            + "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
            + "SELECT pg_export_snapshot();\n"
        )
        holder.stdin.flush()
        snapshot_id = holder.stdout.readline().strip()
        if not snapshot_id:
            raise Refusal(
                "could not export a snapshot: "
                + redact((holder.stderr.read() if holder.stderr else "")[-300:], source)
            )
        holder.stdin.write(inventory_sql(not structure_only, leave_rows) + "\n")
        holder.stdin.flush()
        line = holder.stdout.readline()
        if not line.strip():
            holder.stdin.close()
            raise Refusal(
                "source inventory failed: "
                + redact((holder.stderr.read() if holder.stderr else "")[-400:], source)
            )
        src_inv = json.loads(line)
        timings["source_inventory_s"] = time.monotonic() - t0

        t1 = time.monotonic()
        dump = subprocess.Popen(
            dump_command(snapshot_id, leave_rows, structure_only),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=source.env(database),
        )
        restore = subprocess.Popen(
            restore_command(database),
            stdin=dump.stdout,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=target.env(database),
        )
        assert dump.stdout
        dump.stdout.close()  # so pg_dump gets SIGPIPE if pg_restore dies
        _, restore_err = restore.communicate()
        dump_err = dump.stderr.read() if dump.stderr else b""
        dump_rc = dump.wait()
        timings["dump_restore_s"] = time.monotonic() - t1
        if dump_rc != 0:
            raise Refusal(
                "pg_dump failed: "
                + redact(dump_err.decode("utf8", "replace")[-600:], source, target)
            )
        tolerated, restore_errors = classify_restore_output(restore_err.decode("utf8", "replace"))
        if restore.returncode != 0 and not tolerated and not restore_errors:
            restore_errors = [f"pg_restore exited {restore.returncode} without an error line"]
        restore_errors = [redact(ln, source, target)[:300] for ln in restore_errors]
        log(
            f"[{database}] pg_restore: {len(tolerated)} tolerated errors (platform default "
            f"privileges), {len(restore_errors)} other errors"
        )
    finally:
        try:
            holder.stdin.write("ROLLBACK;\n\\q\n")
            holder.stdin.close()
        except (BrokenPipeError, ValueError, OSError):
            pass
        try:
            holder.wait(timeout=30)
        except subprocess.TimeoutExpired:
            # A read-only transaction needs no clean close; a dead connection must not turn a
            # finished copy into a failure.
            holder.kill()
            holder.wait(timeout=30)

    t2 = time.monotonic()
    _psql(
        target, database, "ANALYZE;", timeout=3600
    )  # planner statistics are not carried by a dump
    timings["analyze_s"] = time.monotonic() - t2
    t3 = time.monotonic()
    tgt_inv = take_inventory(target, database, not structure_only, leave_rows)
    timings["target_inventory_s"] = time.monotonic() - t3
    return src_inv, tgt_inv, timings, restore_errors


def collapse(lines: list[str], keep: int = 8) -> list[str]:
    """Show every kind of expected difference, but not hundreds of lines of one kind."""
    kinds: dict[str, list[str]] = {}
    for ln in lines:
        kinds.setdefault(ln.split(":", 1)[0], []).append(ln)
    out: list[str] = []
    for kind, group in kinds.items():
        out += (
            group
            if len(group) <= keep
            else group[:3] + [f"{kind}: ... and {len(group) - 3} more of this kind"]
        )
    return out


def summarize(inv: dict[str, Any]) -> str:
    tables = inv.get("tables", {})
    return (
        f"{len(tables)} tables, {sum(int(t.get('rows') or 0) for t in tables.values())} rows, "
        f"{sum(1 for t in tables.values() if t.get('rls'))} with row security, {len(inv.get('policies', {}))} policies, "
        f"{len(inv.get('indexes', {}))} indexes, {len(inv.get('functions', {}))} functions, ledger {inv.get('ledger')}"
    )


def run_copy(args: argparse.Namespace) -> int:
    source, target = address_from_env(args.source_env), address_from_env(args.target_env)
    leave = tuple(args.leave_rows or ())
    structure = args.mode == "structure"
    failed = False
    for database in args.database:
        check_preconditions(
            source, target, database, args.expect_target_region, tuple(args.refuse_host or ())
        )
    for database in args.database:
        print(f"== {database}: copying ({args.mode}) ==", flush=True)
        src_inv, tgt_inv, timings, restore_errors = copy_database(
            source, target, database, leave, structure
        )
        if args.out_dir:
            os.makedirs(args.out_dir, exist_ok=True)
            for name, inv in (("source", src_inv), ("target", tgt_inv)):
                with open(
                    os.path.join(args.out_dir, f"{database}-{name}.json"), "w", encoding="utf8"
                ) as fh:
                    json.dump(inv, fh, indent=1, sort_keys=True)
        print(f"[{database}] source: {summarize(src_inv)}")
        print(f"[{database}] target: {summarize(tgt_inv)}")
        print(f"[{database}] timings: " + ", ".join(f"{k}={v:.0f}" for k, v in timings.items()))
        size = _psql(
            target, database, "SELECT pg_size_pretty(pg_database_size(current_database()));"
        )
        print(f"[{database}] target size after copy: {size}")
        unexpected, expected = compare(src_inv, tgt_inv, leave, structure)
        unexpected = [f"restore error: {e}" for e in restore_errors] + unexpected
        for line in collapse(expected):
            print(f"[{database}] expected difference: {line}")
        for line in unexpected[:200]:
            print(f"[{database}] UNEXPECTED: {line}")
        if not tgt_inv.get("owner_can_use_restricted_role") and database == args.database[0]:
            unexpected.append(
                "owner cannot SET ROLE to the restricted application role on the target"
            )
            print(f"[{database}] UNEXPECTED: {unexpected[-1]}")
        verdict = (
            "MATCH" if not unexpected else f"MISMATCH ({len(unexpected)} unexpected differences)"
        )
        print(f"[{database}] VERDICT: {verdict}; {len(expected)} expected differences", flush=True)
        failed = failed or bool(unexpected)
    return 1 if failed else 0


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("copy", help="copy source into an empty target and compare")
    c.add_argument(
        "--source-env",
        required=True,
        help="NAME of the environment variable holding the source address",
    )
    c.add_argument(
        "--target-env",
        required=True,
        help="NAME of the environment variable holding the target address",
    )
    c.add_argument(
        "--database", action="append", required=True, help="database name; repeat for more than one"
    )
    c.add_argument(
        "--expect-target-region",
        required=True,
        help="region token the target host must contain, e.g. us-west-2",
    )
    c.add_argument(
        "--leave-rows",
        action="append",
        help="schema.table whose rows are deliberately not carried; repeatable",
    )
    c.add_argument(
        "--refuse-host",
        action="append",
        help="endpoint id that must be neither source nor target (e.g. production's); repeatable",
    )
    c.add_argument("--mode", choices=("structure", "full"), default="structure")
    c.add_argument(
        "--out-dir",
        help="write the two inventories here (they contain no row data and no addresses)",
    )
    i = sub.add_parser("inventory", help="print a structural inventory of one database")
    i.add_argument("--env", required=True)
    i.add_argument("--database", required=True)
    i.add_argument("--out", required=True)
    i.add_argument("--fingerprint", action="store_true", help="also hash every table's rows")
    i.add_argument("--leave-rows", action="append", help="schema.table not to hash; repeatable")
    d = sub.add_parser("compare", help="compare two saved inventories")
    d.add_argument("source")
    d.add_argument("target")
    d.add_argument("--leave-rows", action="append")
    d.add_argument("--structure-only", action="store_true")
    args = p.parse_args(argv)
    try:
        if args.cmd == "copy":
            return run_copy(args)
        if args.cmd == "inventory":
            inv = take_inventory(
                address_from_env(args.env),
                args.database,
                args.fingerprint,
                tuple(args.leave_rows or ()),
            )
            with open(args.out, "w", encoding="utf8") as fh:
                json.dump(inv, fh, indent=1, sort_keys=True)
            print(summarize(inv))
            return 0
        with open(args.source, encoding="utf8") as a, open(args.target, encoding="utf8") as b:
            unexpected, expected = compare(
                json.load(a), json.load(b), tuple(args.leave_rows or ()), args.structure_only
            )
        for line in expected:
            print("expected difference: " + line)
        for line in unexpected:
            print("UNEXPECTED: " + line)
        print("VERDICT: " + ("MATCH" if not unexpected else f"MISMATCH ({len(unexpected)})"))
        return 1 if unexpected else 0
    except Refusal as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
