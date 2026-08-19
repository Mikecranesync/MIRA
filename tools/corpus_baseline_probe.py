#!/usr/bin/env python3
"""Read-only corpus tagging baseline probe for issue #3177 (PRD Phase 0).

WHAT IT MEASURES
    Per manufacturer: total rows, rows with a blank ``model_number``, rows carrying
    a model tag, and rows whose ``content`` matches a *pinned* fault-clear phrase
    set. Plus the ``_product_search`` candidate-set counts and the PowerFlex 525
    control-group gate the PRD stops on.

POPULATION (one, for every query)
    The **shared OEM corpus** -- ``is_private = false``, no tenant predicate. That is
    both the population ``_product_search`` reads for a tenant-less caller and the one
    ``.claude/rules/knowledge-entries-tenant-scoping.md`` prescribes for an aggregate
    over the shared corpus (never ``tenant_id = $caller``, which reintroduces #1761).
    Mixing scopes across the tables would give a Phase 5 delta an inconsistent
    denominator, so the scope is defined once in ``SHARED_CORPUS``.

PREDICATE PROVENANCE
    The candidate-set predicates are **imported** from
    ``mira-bots/shared/neon_recall.py`` (``_model_suffix_exclude_regex``,
    ``_approval_filter_sql``), never re-implemented here -- see
    ``production_predicates()``. Because the approval filter is env-dependent
    (``MIRA_ENFORCE_APPROVED_RETRIEVAL``, default false), every run prints which mode
    produced its numbers; candidate counts are not comparable across gate states.

WHY IT EXISTS
    ``mira-crawler/crawler/base_crawler.py::process()`` read the source entry's model
    into ``equipment_id`` but omitted it from the ``store_chunks(...)`` call, so
    ``store_chunks``' ``model_number=""`` default won. A blank ``model_number`` then
    breaks three systems at once:

    1. ``neon_recall._product_search`` filters ``model_number ILIKE :pat`` -- the row
       is not a candidate for any model-scoped query;
    2. ``ingest/store.py``'s ``if kg_writer is not None and manufacturer and
       model_number:`` guard is False -- no equipment/manual entity is registered;
    3. nested under (2), ``link_chunk_to_equipment`` and the fault-code extractor
       never run.

    The PRD (``docs/plans/2026-08-17-corpus-candidate-set-repair-prd.md``) Phase 0
    exit is a COMMITTED baseline: "No baseline, no claim of improvement."

SAFETY
    * Read-only. Every statement is asserted to start with SELECT/WITH, runs inside
      ``SET TRANSACTION READ ONLY``, and the transaction is rolled back. There is no
      write path in this file.
    * Fails CLOSED against production -- see ``assert_not_production()``. Three
      independent layers must all pass before a connection is opened.

USAGE
    doppler run --project factorylm --config stg -- py -3 tools/corpus_baseline_probe.py
    py -3 tools/corpus_baseline_probe.py --print-sql        # dry run, no connection

Report: ``docs/testing/2026-08-18-3177-corpus-baseline.md``.
Raw psql query set (a superset, for a human with psql):
``docs/testing/sql/2026-08-18-phase0-candidate-set-baseline.sql``.
"""

from __future__ import annotations

import argparse
import functools
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

# --------------------------------------------------------------------------
# Production guard
# --------------------------------------------------------------------------

# Doppler configs this probe may run under. ``prd`` is absent on purpose and is
# additionally rejected by name below.
ALLOWED_ENVS = ("stg", "dev", "dev_personal")

# Known production Neon endpoint fragments. Already documented in `docs/README.md`
# and `docs/AUDIT.md`; no new secret is introduced here.
PROD_HOST_FRAGMENTS = ("ep-purple-hall",)

# Anything self-describing as production.
PROD_URL_MARKERS = ("prd", "production")


class ProductionRefused(RuntimeError):
    """Raised when the resolved target could be production. Never caught."""


def _host_of(url: str) -> str:
    return url.split("@", 1)[-1].split("/", 1)[0].split("?", 1)[0]


def assert_not_production(url: str, requested_env: str) -> str:
    """Fail closed unless the target is provably non-production.

    Three independent layers, all of which must pass:

    1. **Requested env** must be in ``ALLOWED_ENVS``; ``prd``/``prod`` is refused
       by name.
    2. **Provenance** -- ``DOPPLER_CONFIG`` (injected by ``doppler run``) must be
       present AND equal ``requested_env``. This is what makes the guard
       un-foolable by a flag mismatch: ``doppler run --config prd -- ... --env stg``
       is refused because the injected config says ``prd``. An ABSENT
       ``DOPPLER_CONFIG`` means the connection string's provenance is unverifiable,
       which is a refusal, not a pass -- that is the fail-closed half.
    3. **Resolved endpoint** must not match a known prod host fragment, and neither
       the host nor the database name may self-describe as production.

    Returns the (safe) host for logging. Raises ``ProductionRefused`` otherwise.
    """
    env = requested_env.strip().lower()
    if env in ("prd", "prod", "production"):
        raise ProductionRefused(
            f"refusing env={requested_env!r}: this probe never runs against production. "
            "Prod read-only inspection goes through .github/workflows/db-inspect.yml "
            "(docs/environments.md hard rule #1)."
        )
    if env not in ALLOWED_ENVS:
        raise ProductionRefused(
            f"refusing env={requested_env!r}: not in the allowlist {ALLOWED_ENVS}."
        )

    doppler_config = os.getenv("DOPPLER_CONFIG", "").strip().lower()
    if not doppler_config:
        raise ProductionRefused(
            "DOPPLER_CONFIG is not set, so the connection string's provenance cannot "
            "be verified. Failing closed. Re-run under:\n"
            f"  doppler run --project factorylm --config {env} -- "
            "py -3 tools/corpus_baseline_probe.py"
        )
    if doppler_config != env:
        raise ProductionRefused(
            f"env mismatch: --env={env!r} but DOPPLER_CONFIG={doppler_config!r}. "
            "The injected Doppler config is authoritative; refusing rather than "
            "guessing which one you meant."
        )

    host = _host_of(url)
    dbname = url.rsplit("/", 1)[-1].split("?", 1)[0] if "/" in url else ""
    haystack = f"{host} {dbname}".lower()
    for frag in PROD_HOST_FRAGMENTS:
        if frag in haystack:
            raise ProductionRefused(
                f"resolved endpoint {host!r} matches the known production fragment "
                f"{frag!r}. Refusing."
            )
    for marker in PROD_URL_MARKERS:
        if marker in haystack:
            raise ProductionRefused(
                f"resolved endpoint {host!r} / database {dbname!r} self-describes as "
                f"production ({marker!r}). Refusing."
            )
    return host


# --------------------------------------------------------------------------
# Production predicates (imported, never re-implemented)
# --------------------------------------------------------------------------


@functools.cache
def production_predicates() -> tuple[Callable[[str], str], str, bool]:
    r"""Return ``_product_search``'s own predicate helpers, imported from production.

    Returns ``(model_suffix_exclude_regex, approval_filter_sql, approval_gate_on)``.

    This probe is designated the Phase 5 before/after instrument, so a *copy* of a
    production predicate is a latent lie: the copy and the original drift and the delta
    silently stops measuring what it claims to. Two predicates were re-implemented here
    and both had already diverged or were env-dependent:

    * ``_model_suffix_exclude_regex`` escapes POSIX ERE metacharacters
      (``re.sub(r"([\.^$*+?()\[\]{}|])", ...)``) before building
      ``(^|[^0-9A-Za-z]){name}[0-9A-Za-z]``. The local copy interpolated the RAW tag --
      harmless for ``GS10``/``PowerFlex 525``, wrong for any model containing a
      metacharacter.
    * ``_approval_filter_sql()`` appends ``" AND verified = true"`` when
      ``MIRA_ENFORCE_APPROVED_RETRIEVAL`` is true (default false). It was omitted
      entirely, so the "candidates" column matched production only by coincidence of
      today's flag value.

    `neon_recall`'s module-level imports are stdlib-only (its DB imports are lazy), so
    this costs nothing at import time. The ``sys.path`` insert is scoped to this call and
    undone in ``finally`` -- a module-scope insert would leave ``mira-bots/`` on the path
    for the whole process and let ``shared`` shadow inside a pytest session (the #3089
    failure mode; same reasoning as ``tools/gate7_review.py::_load_pii_redactors``).

    Fails CLOSED: if the import breaks there is no local fallback, because a fallback is
    exactly the divergence this function exists to remove.
    """
    root = str(Path(__file__).resolve().parents[1] / "mira-bots")
    sys.path.insert(0, root)
    try:
        from shared.neon_recall import (  # noqa: PLC0415 - scoped on purpose
            _approval_filter_sql,
            _model_suffix_exclude_regex,
            approval_gate_enabled,
        )
    except ImportError as exc:  # pragma: no cover - the canonical module must exist
        raise RuntimeError(
            "cannot import mira-bots/shared/neon_recall.py, which owns the predicates "
            "this probe mirrors. Refusing to fall back to a local copy: a copy is the "
            "drift this probe must not have. Run from a full checkout."
        ) from exc
    finally:
        try:
            sys.path.remove(root)
        except ValueError:  # pragma: no cover
            pass

    return _model_suffix_exclude_regex, _approval_filter_sql(), approval_gate_enabled()


# --------------------------------------------------------------------------
# Pinned probe definitions
# --------------------------------------------------------------------------

# Recon finding (2026-08-18): the "PF525 has 113 fault-clear rows" number quoted in
# #3177 does NOT reproduce, and the phrase list behind it was never written down.
# The phrase sets are therefore PINNED here by name so a Phase 5 before/after delta
# is falsifiable. Do not edit a set in place -- add a new named set.
PHRASE_SETS: dict[str, tuple[str, ...]] = {
    "issue3177": (
        "clear the fault by",
        "clears the fault queue",
        "acknowledge the fault",
        "to reset the fault",
        "resetting a fault",
    ),
    "broad": (
        "reset the fault",
        "fault reset",
        "clear the fault",
        "clear fault",
        "clears the fault",
    ),
}

DEFAULT_MANUFACTURERS = ("AutomationDirect", "Rockwell Automation", "Allen-Bradley")

# (label, model tag) -- the treatment and the PRD's control group.
DEFAULT_PRODUCTS = (("GS10", "GS10"), ("PowerFlex 525", "PowerFlex 525"))

# ONE population for every table below: the SHARED OEM CORPUS (`is_private = false`).
#
# Previously only Q_PRODUCT's `candidates` column carried `is_private = false` while the
# three aggregates carried no tenant predicate at all -- so a Phase 5 delta would have
# compared a shared-corpus numerator against a HYBRID (shared OEM + private per-tenant
# upload) denominator. `.claude/rules/knowledge-entries-tenant-scoping.md`: an aggregate
# scoped to the shared corpus adds `is_private = false` and NEVER `tenant_id = $caller`
# (the latter reintroduces #1761, the ~0-row OEM corpus).
#
# `is_private = false` is also exactly what `_product_search` builds for a tenant-less
# caller (`neon_recall.py`: `tenant_filter = "is_private = false"` when `tenant_id` is
# None), which is the right population for this probe: #3177 is a defect in the OEM
# crawler write path, and the probe has no caller tenant to stand in for.
SHARED_CORPUS = "is_private = false"

Q_TAGGING_HEALTH = f"""
SELECT manufacturer,
       count(*)                                                               AS total_rows,
       count(*) FILTER (WHERE model_number IS NULL OR btrim(model_number)='') AS blank_model,
       count(DISTINCT nullif(btrim(model_number),''))                         AS distinct_models,
       count(*) FILTER (WHERE embedding IS NOT NULL)                          AS embedded_rows
FROM knowledge_entries
WHERE {SHARED_CORPUS}
  AND manufacturer = ANY(%(mfrs)s)
GROUP BY manufacturer
ORDER BY total_rows DESC
"""

Q_FAULT_CLEAR = f"""
SELECT manufacturer,
       count(*) FILTER (WHERE content ILIKE ANY(%(pats)s)) AS fault_clear_rows
FROM knowledge_entries
WHERE {SHARED_CORPUS}
  AND manufacturer = ANY(%(mfrs)s)
GROUP BY manufacturer
"""

Q_CORPUS = f"""
SELECT count(*)                                                               AS total_rows,
       count(*) FILTER (WHERE model_number IS NULL OR btrim(model_number)='') AS blank_model,
       count(*) FILTER (WHERE (model_number IS NULL OR btrim(model_number)='')
                          AND equipment_entity_id IS NOT NULL)                AS blank_with_fk,
       count(*) FILTER (WHERE model_number IS NOT NULL AND btrim(model_number)<>''
                          AND equipment_entity_id IS NOT NULL)                AS tagged_with_fk
FROM knowledge_entries
WHERE {SHARED_CORPUS}
"""


def q_product(approval_filter_sql: str) -> str:
    """Mirror `_product_search`'s candidate predicates for the shared OEM corpus.

    `candidates` = embedded + model-tag match + the suffix-exclude that discards
    filename-derived tags like 'GS10USERMANUAL' + the approval filter, all on the
    `is_private = false` population -- i.e. every predicate inside `_product_search`'s
    CTE `WHERE`, for a tenant-less caller.

    `approval_filter_sql` is `neon_recall._approval_filter_sql()` verbatim: the empty
    string, or `" AND verified = true"` when `MIRA_ENFORCE_APPROVED_RETRIEVAL` is true.
    It is passed in (not read here) so the caller can print which mode produced the
    numbers -- a candidate count is not comparable across gate states.
    """
    return f"""
SELECT count(*) FILTER (WHERE model_number ILIKE %(like)s)                    AS tagged_rows,
       count(*) FILTER (WHERE content ILIKE %(like)s)                         AS content_rows,
       count(*) FILTER (WHERE embedding IS NOT NULL
                          AND model_number ILIKE %(like)s
                          AND NOT (model_number ~* %(excl)s){approval_filter_sql}) AS candidates,
       count(*) FILTER (WHERE model_number ILIKE %(like)s
                          AND content ILIKE ANY(%(pats)s))                    AS fault_clear_rows
FROM knowledge_entries
WHERE {SHARED_CORPUS}
"""


def all_queries(approval_filter_sql: str) -> tuple[tuple[str, str], ...]:
    """Every statement this probe runs, in report order."""
    return (
        ("tagging health", Q_TAGGING_HEALTH),
        ("fault-clear phrase probe", Q_FAULT_CLEAR),
        ("per-product candidate set", q_product(approval_filter_sql)),
        ("corpus-wide blast radius", Q_CORPUS),
    )


def assert_read_only(sql: str) -> None:
    """Every statement this probe runs must be a plain SELECT."""
    head = sql.strip().split(None, 1)[0].upper()
    if head not in ("SELECT", "WITH"):
        raise RuntimeError(f"non-SELECT statement refused: {sql.strip()[:60]!r}")


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------


def md_table(headers: list[str], rows: list[list[Any]]) -> str:
    def cell(value: Any) -> str:
        if isinstance(value, bool):
            return str(value)
        return f"{value:,}" if isinstance(value, int) else str(value)

    out = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join("---" for _ in headers) + "|",
    ]
    out += ["| " + " | ".join(cell(c) for c in row) + " |" for row in rows]
    return "\n".join(out)


def pct(num: int, den: int) -> str:
    return "n/a" if not den else f"{100.0 * num / den:.1f}%"


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------


def build_report(
    cur: Any,
    mfrs: list[str],
    phrases: tuple[str, ...],
    products: tuple[tuple[str, str], ...],
) -> str:
    exclude_regex, approval_sql, gate_on = production_predicates()
    pats = [f"%{p}%" for p in phrases]
    out: list[str] = []

    # Stated, not implied: a delta is only meaningful between runs sharing BOTH.
    out.append(
        "**Population:** shared OEM corpus (`is_private = false`) for every table "
        "below - the population `_product_search` reads for a tenant-less caller. "
        "**Approval gate** (`MIRA_ENFORCE_APPROVED_RETRIEVAL`): "
        f"**{'ON' if gate_on else 'off'}** "
        f"(candidate predicate suffix: `{approval_sql.strip() or 'none'}`).\n"
    )

    cur.execute(Q_TAGGING_HEALTH, {"mfrs": mfrs})
    health = {row[0]: row for row in cur.fetchall()}
    cur.execute(Q_FAULT_CLEAR, {"mfrs": mfrs, "pats": pats})
    faults = {row[0]: row[1] for row in cur.fetchall()}

    rows: list[list[Any]] = []
    for mfr in sorted(health, key=lambda m: -health[m][1]):
        _, total, blank, distinct, embedded = health[mfr]
        rows.append(
            [mfr, total, blank, pct(blank, total), total - blank, distinct,
             embedded, faults.get(mfr, 0)]
        )
    out.append("### Per-manufacturer tagging health\n")
    out.append(
        md_table(
            ["manufacturer", "rows", "blank model_number", "% blank", "tagged",
             "distinct models", "embedded", "fault-clear rows"],
            rows,
        )
    )

    rows = []
    for label, tag in products:
        cur.execute(
            q_product(approval_sql),
            {
                "like": f"%{tag}%",
                # Production's own escaped builder -- never a re-implementation.
                "excl": exclude_regex(tag),
                "pats": pats,
            },
        )
        tagged, content_rows, candidates, fault_clear = cur.fetchone()
        rows.append([label, tagged, content_rows, candidates, fault_clear])
    out.append("\n### Per-product candidate set (`_product_search` predicates)\n")
    out.append(
        md_table(
            ["product", "rows tagged", "rows whose content mentions it",
             "candidates", "fault-clear rows under the tag"],
            rows,
        )
    )

    cur.execute(Q_CORPUS)
    total, blank, blank_fk, tagged_fk = cur.fetchone()
    out.append("\n### Corpus-wide blast radius\n")
    out.append(
        md_table(
            ["bucket", "rows", "with equipment_entity_id", "% with FK"],
            [
                ["tagged model_number", total - blank, tagged_fk,
                 pct(tagged_fk, total - blank)],
                ["blank model_number", blank, blank_fk, pct(blank_fk, blank)],
            ],
        )
    )
    out.append(
        f"\nCorpus: **{total:,}** rows, **{blank:,}** blank `model_number` "
        f"({pct(blank, total)})."
    )
    return "\n".join(out)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only #3177 corpus tagging baseline probe (PRD Phase 0). "
            "STAGING by default; refuses production, fail closed."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "doppler run --project factorylm --config stg -- "
            "py -3 tools/corpus_baseline_probe.py"
        ),
    )
    parser.add_argument(
        "--env",
        default="stg",
        help=(
            f"target Doppler config, one of {ALLOWED_ENVS} (default: stg). Must match "
            "the injected DOPPLER_CONFIG. 'prd' is refused."
        ),
    )
    parser.add_argument(
        "--phrase-set",
        default="issue3177",
        choices=sorted(PHRASE_SETS),
        help="pinned fault-clear phrase list (default: issue3177)",
    )
    parser.add_argument(
        "--manufacturers",
        default=",".join(DEFAULT_MANUFACTURERS),
        help="comma-separated manufacturer names to profile",
    )
    parser.add_argument(
        "--print-sql",
        action="store_true",
        help="dry run: print the resolved probe config and queries, open no connection",
    )
    args = parser.parse_args(argv)

    phrases = PHRASE_SETS[args.phrase_set]
    mfrs = [m.strip() for m in args.manufacturers.split(",") if m.strip()]

    _, approval_sql, gate_on = production_predicates()

    if args.print_sql:
        print("# dry run -- no connection opened")
        print(f"# env={args.env}  phrase_set={args.phrase_set} ({len(phrases)} phrases)")
        print(f"# manufacturers: {mfrs}")
        print(f"# phrases: {list(phrases)}")
        print(f"# products: {[p[0] for p in DEFAULT_PRODUCTS]}")
        print(f"# population: {SHARED_CORPUS} (shared OEM corpus, every query)")
        print(
            f"# MIRA_ENFORCE_APPROVED_RETRIEVAL={'true' if gate_on else 'false'} "
            f"-> approval filter: {approval_sql.strip() or '(none)'}"
        )
        for label, sql in all_queries(approval_sql):
            assert_read_only(sql)
            print(f"\n-- {label} (read-only assertion: OK)\n{sql.strip()}")
        return 0

    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        print(
            "ERROR: NEON_DATABASE_URL not set. Run under `doppler run --project "
            f"factorylm --config {args.env} -- ...`",
            file=sys.stderr,
        )
        return 2

    try:
        host = assert_not_production(url, args.env)
    except ProductionRefused as exc:
        print(f"REFUSED (production guard): {exc}", file=sys.stderr)
        return 3

    for _, sql in all_queries(approval_sql):
        assert_read_only(sql)

    # Neon from Windows: channel_binding negotiation fails (root CLAUDE.md gotcha).
    if "channel_binding" not in url:
        url += ("&" if "?" in url else "?") + "channel_binding=disable"

    try:
        import psycopg
    except ImportError:
        print(
            "ERROR: psycopg (v3) is required: uv pip install 'psycopg[binary]'",
            file=sys.stderr,
        )
        return 2

    print(
        f"<!-- probe: env={args.env} host={host} phrase_set={args.phrase_set} "
        f"population={SHARED_CORPUS} approval_gate={'on' if gate_on else 'off'} -->"
    )
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
            print(build_report(cur, mfrs, phrases, DEFAULT_PRODUCTS))
        conn.rollback()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
