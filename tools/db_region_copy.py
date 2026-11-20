#!/usr/bin/env python3
"""Copy one Postgres database into an EMPTY database in another region, and check the copy.

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

What the comparison covers, and what it refuses. Row contents are checked for ordinary and
partitioned tables only. Every other relation kind is either one whose definition is compared
(indexes, sequences, views, composite types) or one this tool does NOT verify: a materialized
view, a foreign table, any kind it does not know, and large objects. A source holding any of
those is REFUSED before the dump (``unverifiable_contents``), so a MATCH never covers data the
tool did not look at. The rule is a whitelist of relation kinds, not a list of known gaps.

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
import threading
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
    """A precondition failed BEFORE the target was written. On its own it means nothing was
    written; once a restore has started, ``run_copy`` reports it as a failure after writing."""


class CopyFailure(Exception):
    """The copy failed after the restore had started. The target may hold part of a copy."""


class PartialCopy(Exception):
    """A run failed after at least one target database had been written to."""

    def __init__(self, copied: list[str], started: list[str], reason: str) -> None:
        super().__init__(reason)
        self.copied, self.started, self.reason = copied, started, reason


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


def _role_sections() -> str:
    """The two role sections, shared by the inventory and by the check made before any copy.

    ``role_edges`` is what a role can actually DO with another, asked of the server
    (``pg_has_role``) rather than read off a list of names: is it a member, does it inherit
    the other's rights without switching, may it switch to it, may it administer it. It covers
    every role an application role or the owner can reach, and every non-superuser role that
    can reach one of them.
    """
    roles = _in_list(APP_ROLES)
    known = _in_list(APP_ROLES + (OWNER_ROLE,))
    bits = " || ".join(
        f"pg_has_role(a.oid, b.oid, '{privilege}')::int::text"
        for privilege in ("MEMBER", "USAGE", "SET", "MEMBER WITH ADMIN OPTION")
    )
    return f"""'roles', (SELECT COALESCE(jsonb_object_agg(r.rolname, jsonb_build_object('login', r.rolcanlogin, 'super', r.rolsuper,
     'bypassrls', r.rolbypassrls, 'createrole', r.rolcreaterole, 'inherit', r.rolinherit,
     'member_of', COALESCE((SELECT string_agg(DISTINCT g.rolname, ',' ORDER BY g.rolname) FROM pg_auth_members m
        JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid AND g.rolname IN {roles}), ''),
     'settings', COALESCE((SELECT string_agg(x, ';' ORDER BY x) FROM pg_db_role_setting s, unnest(s.setconfig) x
        WHERE s.setrole = r.oid AND s.setdatabase = 0), ''))), '{{}}')
     FROM pg_roles r WHERE r.rolname IN {roles}),
 'role_edges', (SELECT COALESCE(jsonb_object_agg(a.rolname || '>' || b.rolname, {bits}), '{{}}')
     FROM pg_roles a, pg_roles b WHERE a.oid <> b.oid AND NOT a.rolsuper
     AND (a.rolname IN {known} OR b.rolname IN {known}) AND pg_has_role(a.oid, b.oid, 'MEMBER')),"""


def roles_sql() -> str:
    """Only the role sections: asked of both sides before anything is copied."""
    return "SELECT jsonb_build_object(" + _role_sections().rstrip(",") + ")::text;"


def inventory_sql(fingerprint: bool = False, no_fingerprint: tuple[str, ...] = ()) -> str:
    """One statement that returns the whole inventory as a single JSON line.

    With ``fingerprint`` every table also gets a content fingerprint: two sums, each of a
    differently seeded 64-bit hash of every row's text form. It does not depend on row order,
    so it needs no key, and two tables holding the same rows give the same pair. It is a check
    against rows lost or changed by a copy, not a cryptographic proof. Tables in
    ``no_fingerprint`` (the ones whose rows are deliberately left behind) are counted but not
    read row by row.

    The row is written ``ROW(t.*)``, never the bare alias ``t``: in a table that has a column
    named ``t``, a bare ``t`` is that one column, and the fingerprint would cover nothing else.
    """
    for t in no_fingerprint:
        if not _QUALIFIED.match(t):
            raise ValueError(f"unsafe table name {t!r}")
    if fingerprint:
        not_read = "(" + ", ".join(f"'{t}'" for t in no_fingerprint or ("",)) + ")"
        content = (
            f"CASE WHEN (n.nspname || '.' || c.relname) IN {not_read} THEN 'not read' ELSE"
            " (xpath('/row/h/text()', query_to_xml(format("
            "'SELECT COALESCE(sum(hashtextextended(ROW(t.*)::text, 0)), 0)::text || '':'' ||"
            " COALESCE(sum(hashtextextended(ROW(t.*)::text, 1)), 0)::text AS h FROM %I.%I t',"
            " n.nspname, c.relname), false, true, '')))[1]::text END"
        )
    else:
        content = "'not read'"
    skip = _in_list(("pg_catalog", "information_schema", "pg_toast") + EXCLUDED_SCHEMAS)
    user_ns = f"n.nspname NOT IN {skip} AND n.nspname NOT LIKE 'pg\\_temp%' AND n.nspname NOT LIKE 'pg\\_toast\\_temp%'"
    owner_and_roles = _in_list(APP_ROLES + (OWNER_ROLE,))
    ext_skip = _in_list(("plpgsql",) + EXCLUDED_EXTENSIONS)
    acl = "COALESCE((SELECT string_agg(a::text, ';' ORDER BY a::text) FROM unnest({col}) a), '')"
    # A restore RE-PARSES every expression, and Postgres then prints the same check differently:
    #   source:  (status)::text = ANY ((ARRAY['a'::character varying])::text[])
    #   target:  (status)::text = ANY (ARRAY[('a'::character varying)::text])
    # Same meaning, different text. The definitions are therefore returned as they are and
    # compared in ``compare`` through ``canonical_definition``. Row-security policies are NOT
    # given that tolerance: they are compared exactly.
    count = (
        "(xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),"
        " false, true, '')))[1]::text::bigint"
    )
    # A sequence's state is its stored value AND whether that value was already handed out.
    # pg_sequences shows NULL for "not handed out yet" and so hides the value; read the sequence.
    position = (
        "(xpath('/row/v/text()', query_to_xml(format('SELECT last_value::text || ''|'' || is_called::text"
        " AS v FROM %I.%I', s.schemaname, s.sequencename), false, true, '')))[1]::text"
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
 'schemas', (SELECT COALESCE(jsonb_object_agg(n.nspname, pg_get_userbyid(n.nspowner) || '|' || {acl.format(col="n.nspacl")}), '{{}}') FROM pg_namespace n WHERE {user_ns}),
 {_role_sections()}
 'settings', (SELECT COALESCE(jsonb_object_agg(COALESCE(r.rolname, '*') || '|' || COALESCE(d.datname, '*'),
     (SELECT string_agg(x, ';' ORDER BY x) FROM unnest(s.setconfig) x)), '{{}}')
     FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid = s.setrole LEFT JOIN pg_database d ON d.oid = s.setdatabase
     WHERE (s.setrole = 0 OR r.rolname IN {owner_and_roles}) AND (s.setdatabase = 0 OR d.datname = current_database())),
 'owner_can_use_restricted_role', (SELECT COALESCE(bool_and(pg_has_role('{OWNER_ROLE}', r.oid, 'SET')), false)
     FROM pg_roles r WHERE r.rolname = '{RESTRICTED_ROLE}'),
 'tables', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || c.relname, jsonb_build_object('rows', {count},
     'content', {content},
     'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'owner', pg_get_userbyid(c.relowner),
     'options', COALESCE(array_to_string(c.reloptions, ','), '') || '|' || c.relreplident::text
          || '|' || c.relkind::text || c.relpersistence::text || '|' || COALESCE(pg_get_partkeydef(c.oid), '')
          || '|' || COALESCE(pg_get_expr(c.relpartbound, c.oid), '') || '|' || COALESCE((SELECT string_agg(
             i.inhparent::regclass::text, ',' ORDER BY i.inhseqno) FROM pg_inherits i WHERE i.inhrelid = c.oid), ''),
     'acl', {acl.format(col="c.relacl")},
     'columns', (SELECT md5(COALESCE(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
          || ':' || COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') || ':' || a.attgenerated::text || ':' || a.attidentity::text
          || ':' || COALESCE(a.attacl::text, '') || ':' || COALESCE((SELECT k.collname FROM pg_collation k
             WHERE k.oid = a.attcollation), ''), '|' ORDER BY a.attnum), ''))
        FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))), '{{}}')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND {user_ns}),
 'policies', (SELECT COALESCE(jsonb_object_agg(schemaname || '.' || tablename || '.' || policyname,
     md5(permissive || '|' || array_to_string(roles, ',') || '|' || cmd || '|' || COALESCE(qual, '') || '|' || COALESCE(with_check, ''))), '{{}}')
     FROM pg_policies p WHERE p.schemaname NOT IN {skip}),
 'indexes', (SELECT COALESCE(jsonb_object_agg(schemaname || '.' || indexname, indexdef), '{{}}') FROM pg_indexes i WHERE i.schemaname NOT IN {skip}),
 'constraints', (SELECT COALESCE(jsonb_object_agg(k, v), '{{}}') FROM (
     SELECT n.nspname || '.' || cl.relname || '.' || co.conname AS k, pg_get_constraintdef(co.oid) AS v
       FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE {user_ns}
     UNION ALL
     SELECT 'domain ' || n.nspname || '.' || t.typname || '.' || co.conname, pg_get_constraintdef(co.oid)
       FROM pg_constraint co JOIN pg_type t ON t.oid = co.contypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE {user_ns}) q),
 'functions', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
     md5(CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) ELSE p.prokind::text || p.prosrc END)
     || ':' || pg_get_userbyid(p.proowner) || ':' || {acl.format(col="p.proacl")}), '{{}}')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE {user_ns} AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')),
 'triggers', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid)) || ':' || t.tgenabled::text), '{{}}')
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND {user_ns}),
 'views', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || c.relname, md5(pg_get_viewdef(c.oid)) || ':' || pg_get_userbyid(c.relowner)
     || ':' || COALESCE(array_to_string(c.reloptions, ','), '') || ':' || {acl.format(col="c.relacl")}), '{{}}')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'v' AND {user_ns}),
 'matviews', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || c.relname, md5(pg_get_viewdef(c.oid)) || ':' || pg_get_userbyid(c.relowner)
     || ':' || COALESCE(array_to_string(c.reloptions, ','), '') || ':' || {acl.format(col="c.relacl")}), '{{}}')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'm' AND {user_ns}),
 'sequences', (SELECT COALESCE(jsonb_object_agg(schemaname || '.' || sequencename, {position}), '{{}}') FROM pg_sequences s WHERE s.schemaname NOT IN {skip}),
 'sequence_settings', (SELECT COALESCE(jsonb_object_agg(schemaname || '.' || sequencename, data_type::text || '|' || start_value
     || '|' || min_value || '|' || max_value || '|' || increment_by || '|' || cycle::text || '|' || cache_size), '{{}}')
     FROM pg_sequences s WHERE s.schemaname NOT IN {skip}),
 'sequence_acl', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || c.relname, {acl.format(col="c.relacl")}), '{{}}')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'S' AND {user_ns}),
 'enums', (SELECT COALESCE(jsonb_object_agg(k, v), '{{}}') FROM (SELECT n.nspname || '.' || t.typname AS k,
     string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS v FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
     JOIN pg_namespace n ON n.oid = t.typnamespace WHERE {user_ns} GROUP BY 1) q),
 'types', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || t.typname, t.typtype::text
     || CASE WHEN t.typtype = 'd' THEN '|' || format_type(t.typbasetype, t.typtypmod) || '|' || t.typnotnull::text
          || '|' || COALESCE(t.typdefault, '')
          WHEN t.typtype = 'c' THEN '|' || COALESCE((SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod),
             ',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped), '')
          ELSE '' END), '{{}}') FROM pg_type t
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
 'unverified_relations', (SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || c.relname, c.relkind::text), '{{}}')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind NOT IN ('r', 'p', 'i', 'I', 'S', 'v', 'c', 't') AND {user_ns}),
 'large_objects', (SELECT count(*) FROM pg_largeobject_metadata),
 'default_acl', (SELECT COALESCE(jsonb_object_agg(pg_get_userbyid(a.defaclrole) || ':' || COALESCE(n.nspname, '*') || ':' || a.defaclobjtype::text,
     {acl.format(col="a.defaclacl")}), '{{}}')
     FROM pg_default_acl a LEFT JOIN pg_namespace n ON n.oid = a.defaclnamespace WHERE pg_get_userbyid(a.defaclrole) = '{OWNER_ROLE}'),
 'ledger', {ledger}
)::text;
"""


# Every section a complete inventory carries, read off the query above so that the two cannot
# drift apart. A comparison refuses to call two inventories a match unless both carry them all.
INVENTORY_SECTIONS = tuple(re.findall(r"^ '([a-z_]+)', ", inventory_sql(), re.MULTILINE))


# --------------------------------------------------------------------------- comparison


_UNVERIFIED_KIND = {"m": "materialized view", "f": "foreign table"}


def unverifiable_contents(inventory: dict[str, Any]) -> list[str]:
    """What a database holds whose CONTENTS this tool does not verify. Empty means none.

    An inventory that does not say (an older file, a failed section) counts as holding some:
    the answer has to be a positive "none", never an absence.
    """
    relations = inventory.get("unverified_relations")
    large_objects = inventory.get("large_objects")
    if not isinstance(relations, dict) or type(large_objects) is not int:
        return ["unknown: the inventory does not say what else the database holds"]
    found = [
        (_UNVERIFIED_KIND.get(kind) or f"relation of kind {kind!r}") + f" {name}"
        for name, kind in sorted(relations.items())
    ]
    if large_objects:
        found.append(f"{large_objects} large objects")
    return found


_FINGERPRINT = re.compile(r"^-?\d+:-?\d+$")


def compare(
    source: dict[str, Any],
    target: dict[str, Any],
    leave_rows: tuple[str, ...] = (),
    structure_only: bool = False,
) -> tuple[list[str], list[str]]:
    """Return ``(unexpected, expected)`` difference descriptions.

    ``expected`` holds only the differences this tool is built to tolerate; anything else is
    ``unexpected`` and fails the run. A match needs positive evidence: every section present on
    both sides, a content fingerprint on both sides for every table whose rows were copied, and
    ZERO rows on the target wherever rows were to be left behind (a named table in a full copy,
    every table in a structure-only one). Equal row counts are never enough by themselves.
    """
    unexpected: list[str] = []
    expected: list[str] = []
    unverifiable = unverifiable_contents(source)
    if unverifiable:
        unexpected.append(
            "source: holds contents this tool does not verify: " + ", ".join(unverifiable[:20])
        )
    for section in INVENTORY_SECTIONS:
        absent = [
            side for side, inv in (("source", source), ("target", target)) if section not in inv
        ]
        if absent:
            where = " and ".join(absent) + (" inventories" if len(absent) == 2 else " inventory")
            unexpected.append(f"{section}: missing from the {where}")
    for section in sorted(set(source) | set(target)):
        if section in INVENTORY_SECTIONS and (section not in source or section not in target):
            continue  # already reported above
        s, t = source.get(section), target.get(section)
        if not isinstance(s, dict) or not isinstance(t, dict):
            if s != t:
                if structure_only and section == "ledger":
                    expected.append("ledger: not copied in a structure-only run")
                else:
                    unexpected.append(f"{section}: source={s!r} target={t!r}")
            continue
        if section == "role_edges":
            edge_unexpected, edge_expected = compare_role_edges(s, t)
            unexpected += edge_unexpected
            expected += edge_expected
            continue
        for key in sorted(set(s) | set(t)):
            if key not in t:
                unexpected.append(f"{section}: MISSING on target: {key}")
                continue
            if key not in s:
                unexpected.append(f"{section}: only on target: {key}")
                continue
            a, b = s[key], t[key]
            if section == "tables" and isinstance(a, dict) and isinstance(b, dict):
                # Judged in full even when the two entries are equal: equal is not enough.
                problem, note = _compare_table(key, a, b, key in leave_rows, structure_only)
                if problem:
                    unexpected.append(problem)
                elif note:
                    expected.append(note)
                continue
            if a == b:
                continue
            if section == "extensions":
                if _version_not_older(a, b):
                    expected.append(f"extension version: {key} {a} -> {b}")
                else:
                    unexpected.append(f"extensions: {key} is OLDER on target: {a} -> {b}")
            elif (
                section in ("constraints", "indexes")
                and isinstance(a, str)
                and isinstance(b, str)
                and canonical_definition(a) == canonical_definition(b)
            ):
                expected.append(f"{section}: reprinted by the restore, same meaning: {key}")
            elif section == "sequences":
                settings = source.get("sequence_settings")
                setting = settings.get(key) if isinstance(settings, dict) else None
                problem, note = _compare_sequence(key, a, b, setting, structure_only)
                if problem:
                    unexpected.append(problem)
                else:
                    expected.append(note)
            else:
                unexpected.append(f"{section}: differs: {key}")
    return unexpected, expected


def _compare_table(
    key: str, a: dict[str, Any], b: dict[str, Any], left_behind: bool, structure_only: bool
) -> tuple[Optional[str], Optional[str]]:
    """One table: ``(unexpected, expected)``, at most one of them set."""
    rest_a = {k: v for k, v in a.items() if k not in ("rows", "content")}
    rest_b = {k: v for k, v in b.items() if k not in ("rows", "content")}
    if rest_a != rest_b:
        fields = sorted(k for k in set(rest_a) | set(rest_b) if rest_a.get(k) != rest_b.get(k))
        return f"tables: {key} differs in {', '.join(fields)}", None
    rows_a, rows_b = a.get("rows"), b.get("rows")
    if type(rows_a) is not int or type(rows_b) is not int:
        return f"tables: {key} has no row count: source={rows_a!r} target={rows_b!r}", None
    if structure_only or left_behind:
        if rows_b != 0:
            if structure_only:
                return (
                    f"tables: {key} has {rows_b} rows on the target in a structure-only copy",
                    None,
                )
            return f"tables: {key} was to be left behind but has {rows_b} rows on the target", None
        if rows_a == 0:
            return None, None
        return None, f"rows left behind: {key} source={rows_a} target=0"
    if rows_a != rows_b:
        return f"tables: {key} rows source={rows_a} target={rows_b}", None
    unread = [
        side
        for side, entry in (("source", a), ("target", b))
        if not (isinstance(entry.get("content"), str) and _FINGERPRINT.match(entry["content"]))
    ]
    if unread:
        return f"tables: {key} content was not fingerprinted on the {' and '.join(unread)}", None
    if a["content"] != b["content"]:
        return f"tables: {key} same row count but DIFFERENT CONTENT", None
    return None, None


def sequence_next(state: Any, increment: int) -> Optional[int]:
    """The value a sequence gives next, from its state ``"<stored value>|<true or false>"``.

    The flag says whether the stored value was already handed out: if so the next one is a
    step further, if not the stored value itself is next. ``None`` when the state is unreadable.
    """
    if not isinstance(state, str):
        return None
    value, _, called = state.partition("|")
    if called not in ("true", "false") or not re.fullmatch(r"-?\d+", value):
        return None
    return int(value) + increment if called == "true" else int(value)


def _compare_sequence(
    key: str, a: Any, b: Any, setting: Any, structure_only: bool
) -> tuple[Optional[str], str]:
    """Two differing sequence states: ``(unexpected, expected)``.

    The source may have moved on while the dump ran, so the target may be ahead - in the
    direction the sequence counts. It must never be behind: it would hand out a value that a
    copied row already uses. A sequence that cycles, or whose settings cannot be read, has no
    "ahead" and must match exactly.
    """
    fields = setting.split("|") if isinstance(setting, str) else []
    readable = len(fields) == 7 and re.fullmatch(r"-?[1-9]\d*", fields[4]) is not None
    if structure_only:
        # Nothing was copied: the target must still be exactly as created.
        if readable and b == f"{fields[1]}|false":
            return None, f"sequence position: {key} not copied in a structure-only run"
        return (
            f"sequences: {key} is not at its start on the target in a structure-only copy: {b}",
            "",
        )
    if readable and fields[5] == "false":
        increment = int(fields[4])
        next_a, next_b = sequence_next(a, increment), sequence_next(b, increment)
        if next_a is not None and next_b is not None and (next_b - next_a) * increment >= 0:
            return None, f"sequence position: {key} {a} -> {b}"
        if next_a is not None and next_b is not None:
            return (
                f"sequences: {key} is behind on the target and would reissue a value: {a} -> {b}",
                "",
            )
    return f"sequences: differs: {key} {a} -> {b}", ""


_EDGE = re.compile(r"^[01]{4}$")
_EDGE_MEANING = "(member, inherits, can switch to, can administer)"


def compare_role_edges(
    source: dict[str, Any], target: dict[str, Any]
) -> tuple[list[str], list[str]]:
    """Compare what each role can do with another: ``(unexpected, expected)``.

    The rule is that the target may not let anyone do more, and may not let an application
    role do less. Three differences follow from a new project and are reported as expected,
    never silently: the owner administers the application roles it created there; a platform
    role outside this tool's list reaches an application role on the source only; and a role
    belonging to a platform feature that is deliberately not carried exists on the source only.
    """
    unexpected: list[str] = []
    expected: list[str] = []
    known = APP_ROLES + (OWNER_ROLE,)
    for key in sorted(set(source) | set(target)):
        member, _, role = key.partition(">")
        a, b = source.get(key), target.get(key)
        if any(v is not None and not (isinstance(v, str) and _EDGE.match(v)) for v in (a, b)):
            unexpected.append(f"role_edges: unreadable: {key} source={a!r} target={b!r}")
        elif a == b:
            continue
        elif b is None:
            if role in EXCLUDED_SCHEMAS:
                expected.append(
                    f"role edge: {key} is on the source only (platform feature not carried)"
                )
            elif member not in known:
                expected.append(f"role edge: {key} is on the source only (platform role)")
            else:
                unexpected.append(f"role_edges: MISSING on target: {key}")
        elif a is None:
            if member == OWNER_ROLE and role in APP_ROLES and b == "1001":
                expected.append(
                    f"role edge: {key} the owner administers a role it created on the target"
                )
            else:
                unexpected.append(f"role_edges: only on target: {key}")
        elif member == OWNER_ROLE and role in APP_ROLES and a[:3] == b[:3] and b[3] == "1":
            expected.append(
                f"role edge: {key} the owner administers a role it created on the target"
            )
        else:
            unexpected.append(f"role_edges: {key} differs: source {a} target {b} {_EDGE_MEANING}")
    return unexpected, expected


_QUOTED = re.compile(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"")
_TYPE_NAME = r"[a-z][a-z ]*[a-z]"
# An array element this tool recognises: a string literal (set aside as \x00n\x00) or NULL,
# with a cast. A quoted NAME is set aside under a different marker and is not an element.
_CAST_LITERAL = "(?:\x00\\d+\x00|NULL)::" + _TYPE_NAME
_ARRAY_CAST_AS_A_WHOLE = re.compile(
    r"\(ARRAY\[(" + _CAST_LITERAL + r"(?:, " + _CAST_LITERAL + r")*)\]\)::(" + _TYPE_NAME + r")\[\]"
)


def canonical_definition(definition: str) -> str:
    """A constraint or index definition with ONE known reprint undone, and nothing else.

    A restore re-parses an expression, and Postgres then prints an array of string literals
    that was cast as a whole with the cast moved onto each element:

        (ARRAY['a'::character varying, 'b'::character varying])::text[]
        ARRAY[('a'::character varying)::text, ('b'::character varying)::text]

    The first form is rewritten into the second (an element is a string literal or NULL, with
    a cast). Every one of the reprints seen on real data has this shape. No other cast and no
    parenthesis is touched, so a definition that differs
    in any other way still differs here. Quoted strings and quoted names are set aside first,
    so text inside a literal is never rewritten.
    """
    quoted: list[str] = []

    def stash(match: re.Match[str]) -> str:
        quoted.append(match.group(0))
        mark = "\x00" if match.group(0).startswith("'") else "\x01"
        return f"{mark}{len(quoted) - 1}{mark}"

    def per_element(match: re.Match[str]) -> str:
        elements = match.group(1).split(", ")
        return "ARRAY[" + ", ".join(f"({e})::{match.group(2)}" for e in elements) + "]"

    text = _ARRAY_CAST_AS_A_WHOLE.sub(per_element, _QUOTED.sub(stash, definition))
    return re.sub("[\x00\x01](\\d+)[\x00\x01]", lambda q: quoted[int(q.group(1))], text)


def _version_not_older(source_version: Any, target_version: Any) -> bool:
    """An extension may be newer on the target, never older. Anything unreadable is not accepted."""
    parts = []
    for v in (source_version, target_version):
        if not isinstance(v, str) or not re.fullmatch(r"\d+(\.\d+)*", v):
            return False
        parts.append(tuple(int(x) for x in v.split(".")))
    return parts[1] >= parts[0]


# --------------------------------------------------------------------------- commands


SECTIONS = ("pre-data", "data", "post-data")


def copy_sections(structure_only: bool) -> tuple[str, ...]:
    """The archive sections a copy restores, in order. A structure-only copy skips the rows."""
    return ("pre-data", "post-data") if structure_only else SECTIONS


def dump_command(
    snapshot_id: Optional[str],
    leave_rows: tuple[str, ...],
    structure_only: bool,
    section: Optional[str] = None,
) -> list[str]:
    """argv for pg_dump. Contains no address and no secret (tested)."""
    if section is not None and section not in SECTIONS:
        raise Refusal(f"unknown archive section {section!r}")
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
    if section is not None:
        cmd.append(f"--section={section}")
    return cmd


def restore_command(database: str, exit_on_error: bool = False) -> list[str]:
    """argv for pg_restore. ``--no-owner``: every carried object belongs to the owner role on
    both sides, and the restoring user IS that role. ``exit_on_error`` stops at the first
    failed statement instead of carrying on."""
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", database):
        raise Refusal("unexpected database name")
    cmd = ["pg_restore", "--no-owner"]
    if exit_on_error:
        cmd.append("--exit-on-error")
    return cmd + [f"--dbname={database}"]


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
    assert_target_empty(target, database)


def assert_target_empty(target: Address, database: str) -> None:
    """Refuse unless the target database holds nothing. Run before anything else, and AGAIN
    immediately before each database's restore: the first check can be minutes old by then."""
    # "Empty" means no object of any kind: nothing in a user schema (any relation kind, so a
    # foreign table or a composite type counts; functions, types, operators, collations, text
    # search configurations, extended statistics), no schema besides public, and none of the
    # database-wide objects a restore could collide with (large objects, event triggers,
    # publications, foreign servers, extensions beyond the built-in plpgsql).
    user = "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'"
    in_schema = (
        ("pg_class", "relnamespace"),
        ("pg_proc", "pronamespace"),
        ("pg_type", "typnamespace"),
        ("pg_operator", "oprnamespace"),
        ("pg_collation", "collnamespace"),
        ("pg_ts_config", "cfgnamespace"),
        ("pg_statistic_ext", "stxnamespace"),
    )
    counts = [
        f"(SELECT count(*) FROM {catalog} o JOIN pg_namespace n ON n.oid = o.{column} WHERE {user})"
        for catalog, column in in_schema
    ]
    counts.append(f"(SELECT count(*) FROM pg_namespace n WHERE {user} AND n.nspname <> 'public')")
    counts += [
        f"(SELECT count(*) FROM {catalog})"
        for catalog in (
            "pg_largeobject_metadata",
            "pg_event_trigger",
            "pg_publication",
            "pg_foreign_server",
        )
    ]
    counts.append("(SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql')")
    n = _psql(target, database, "SELECT " + " + ".join(counts) + ";")
    if n != "0":
        raise Refusal(
            f"target database {database} is not empty ({n} objects); refusing to restore over it"
        )


def check_roles(source: Address, target: Address, database: str) -> list[str]:
    """Refuse, before anything is copied, unless the application roles on the target can do
    what they can do on the source. Roles are not carried by a dump; they are created by hand
    on the target, so this is where a mistake in that step is caught. Returns the differences
    that are expected on a new project, for the log."""
    sides = [json.loads(_psql(addr, database, roles_sql())) for addr in (source, target)]
    unexpected: list[str] = []
    roles = [side.get("roles") if isinstance(side.get("roles"), dict) else {} for side in sides]
    for name in sorted(set(APP_ROLES) | set(roles[0]) | set(roles[1])):
        if name not in roles[0] or name not in roles[1]:
            absent = "source" if name not in roles[0] else "target"
            unexpected.append(f"roles: {name} does not exist on the {absent}")
        elif roles[0][name] != roles[1][name]:
            unexpected.append(f"roles: differs: {name}")
    edges = [side.get("role_edges") for side in sides]
    if not isinstance(edges[0], dict) or not isinstance(edges[1], dict):
        raise Refusal("could not read what the application roles can do on both sides")
    edge_unexpected, expected = compare_role_edges(edges[0], edges[1])
    unexpected += edge_unexpected
    if unexpected:
        raise Refusal(
            "the application roles on the target do not match the source: "
            + "; ".join(unexpected[:12])
        )
    return expected


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


def pipe_dump_into_restore(
    dump_cmd: list[str],
    restore_cmd: list[str],
    dump_env: dict[str, str],
    restore_env: dict[str, str],
) -> tuple[int, bytes, int, bytes]:
    """Run the dump piped straight into the restore. Nothing touches the disk.

    Returns (dump exit code, dump stderr, restore exit code, restore stderr). The dump's error
    pipe is drained WHILE the restore runs: a pipe holds about 64 KB, and a dump that fills it
    would otherwise stop before finishing its data, with the restore waiting on it forever.
    """
    dump = subprocess.Popen(dump_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=dump_env)
    restore = subprocess.Popen(
        restore_cmd,
        stdin=dump.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=restore_env,
    )
    assert dump.stdout and dump.stderr
    dump.stdout.close()  # so the dump gets SIGPIPE if the restore dies
    captured: list[bytes] = []
    drain = threading.Thread(target=lambda: captured.append(dump.stderr.read()), daemon=True)
    drain.start()
    _, restore_err = restore.communicate()
    dump_rc = dump.wait()
    drain.join()
    return dump_rc, b"".join(captured), restore.returncode, restore_err


def copy_database(
    source: Address,
    target: Address,
    database: str,
    leave_rows: tuple[str, ...],
    structure_only: bool,
    log=print,
    before_restore=None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, float], list[str]]:
    """Copy one database.

    Returns (source inventory, target inventory, timings in seconds, restore errors that are
    NOT on the tolerated list - any of those fails the run).

    The archive is restored one section at a time, each from the same held snapshot. The
    first two - the objects, then the rows - stop at the FIRST error: if anything in the target
    collides with an object being created, the run ends there and no row is loaded on top of
    it. Only the last section (indexes, constraints, privileges) carries on past an error,
    because that is where the two tolerated platform statements are; its errors are sorted
    into tolerated and not.

    ``Refusal`` is raised only before the first restore starts (``before_restore`` is called
    at that moment); after it, every failure is a ``CopyFailure``.
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
        unverifiable = unverifiable_contents(src_inv)
        if unverifiable:
            raise Refusal(
                "the source holds contents this tool does not verify, so it will not copy it: "
                + ", ".join(unverifiable[:20])
            )

        # The first emptiness check ran before the source was read, which can be minutes ago.
        assert_target_empty(target, database)
        if before_restore is not None:
            before_restore()
        t1 = time.monotonic()
        tolerated: list[str] = []
        restore_errors: list[str] = []
        for section in copy_sections(structure_only):
            last = section == "post-data"
            dump_rc, dump_err, restore_rc, restore_err = pipe_dump_into_restore(
                dump_command(snapshot_id, leave_rows, structure_only, section),
                restore_command(database, exit_on_error=not last),
                source.env(database),
                target.env(database),
            )
            restore_text = restore_err.decode("utf8", "replace")
            if dump_rc != 0:
                raise CopyFailure(
                    f"pg_dump failed in the {section} section: "
                    + redact(dump_err.decode("utf8", "replace")[-600:], source, target)
                )
            if not last:
                if restore_rc != 0:
                    raise CopyFailure(
                        f"restore failed in the {section} section and was stopped there: "
                        + redact(restore_text[-600:], source, target)
                    )
                continue
            tolerated, restore_errors = classify_restore_output(restore_text)
            if restore_rc != 0 and not tolerated and not restore_errors:
                restore_errors = [f"pg_restore exited {restore_rc} without an error line"]
            restore_errors = [redact(ln, source, target)[:300] for ln in restore_errors]
        timings["dump_restore_s"] = time.monotonic() - t1
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

    try:
        t2 = time.monotonic()
        # planner statistics are not carried by a dump
        _psql(target, database, "ANALYZE;", timeout=3600)
        timings["analyze_s"] = time.monotonic() - t2
        t3 = time.monotonic()
        tgt_inv = take_inventory(target, database, not structure_only, leave_rows)
        timings["target_inventory_s"] = time.monotonic() - t3
    except Refusal as e:  # the restore has run: this is not "nothing was written"
        raise CopyFailure(f"the copy could not be checked: {e}") from e
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
    for line in check_roles(source, target, args.database[0]):
        print(f"[roles] expected difference: {line}")
    started: list[str] = []  # databases whose restore has begun
    copied: list[str] = []  # ... and finished
    try:
        failed = _copy_all(args, source, target, leave, structure, started, copied)
    except (Refusal, CopyFailure, OSError, subprocess.SubprocessError, ValueError) as e:
        if not started:
            raise
        # One line: the client's error text carries line breaks, and the verdict is read as a line.
        reason = " ".join(redact(f"{type(e).__name__}: {e}", source, target).split())
        raise PartialCopy(copied, [d for d in started if d not in copied], reason) from e
    return 1 if failed else 0


def _copy_all(
    args: argparse.Namespace,
    source: Address,
    target: Address,
    leave: tuple[str, ...],
    structure: bool,
    started: list[str],
    copied: list[str],
) -> bool:
    failed = False
    for database in args.database:
        print(f"== {database}: copying ({args.mode}) ==", flush=True)
        src_inv, tgt_inv, timings, restore_errors = copy_database(
            source,
            target,
            database,
            leave,
            structure,
            before_restore=lambda: started.append(database),
        )
        copied.append(database)
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
    return failed


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
        print(f"REFUSED: {e}. A precondition failed and nothing was written.", file=sys.stderr)
        return 2
    except PartialCopy as e:
        written = [f"{d} (copied)" for d in e.copied]
        written += [f"{d} (restore started, may be partial)" for d in e.started]
        print(
            f"FAILED AFTER WRITING to {', '.join(written)}: {e.reason}. The target is no longer "
            "empty: do not use it, and reset the target branch before any retry.",
            file=sys.stderr,
        )
        return 3


if __name__ == "__main__":
    sys.exit(main())
