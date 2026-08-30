#!/usr/bin/env python3
"""CV-101 live gate — is the Discharge Conveyor producing genuine live telemetry?

One artifact, two jobs, because they are the same five questions:

  * **The 10:00 gate** — run it by hand the moment the bench link is restored and
    get GO / NO-GO instead of re-deriving SQL at the conveyor.
  * **The liveness alarm** — run it on a schedule so a stream can never again sit
    non-live for 12 days unnoticed. That silence, not the replay itself, was the
    real operational failure behind #3161.

`classify()` is pure: it takes already-fetched rows and returns a verdict, so the
whole decision is unit-testable with no database. The workflow
(`.github/workflows/cv101-live-gate.yml`) does the read-only SQL and pipes JSON in.

## The five checks

| # | Question | Fails when |
|---|---|---|
| 1 | **Identity** | observed `uns_path` != the allowlisted path (ADR-0034 / #3233) |
| 2 | **Freshness** | newest observation is older than `--max-observed-age-s` |
| 3 | **Provenance** | `simulated=true` or `source_system='simulator'` — synthetic traffic |
| 4 | **Continuity** | `live_ratio` collapsed (replay), or ingest has stopped |
| 5 | **Scope** | expected tag count missing, or a foreign source mapped in |

## Why `live_ratio`

`live_ratio = distinct(event_timestamp) / scans`, where `scans = rows / tag_count`.
The 033 schema separates observed-at (`event_timestamp`, source clock) from
received-at (`ingested_at`, server NOW). A replay keeps posting so row count stays
high while observed-time stands still:

    LIVE   -> live_ratio ~ 1.0, observed_span ~ ingest_span
    REPLAY -> live_ratio ~ 0.0, observed_span ~ 0 while ingest_span grows

Measured on prod 2026-08-14: 774,480 rows, **1** distinct observed timestamp —
still ~0.0000 under either formulation. Row count alone cannot tell the two apart,
which is why this gate keys on the ratio and never on volume.

**Per SCAN, not per ROW (fixed 2026-08-16).** The denominator was originally `rows`,
which made GO unreachable by construction: one scan reads all N tags and stamps them
with a single observation timestamp, so `rows = N x scans` and the ratio can never
exceed `1/N`. For CV-101's 12 tags that ceiling is **0.083**, below the 0.50
threshold — a perfectly healthy bench scored NO-GO forever. Caught on the live bench
2026-08-16 right after the Ignition trial reset restored the device connection:
2520 rows / 167 distinct / 12 tags = 0.0663, **80% of the theoretical maximum**, and
the gate still cried REPLAY. Dividing by scans asks what the gate actually means —
"of the scans in this window, how many carried a NEW observation?" — which is ~1.0
for a live stream at any tag count and still ~0 for a replay.

Exit: 0 = GO, 1 = NO-GO (named failure), 2 = UNKNOWN (could not determine).
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Optional

from machine_history_provenance import classify_event

EXIT_GO = 0
EXIT_NOGO = 1
EXIT_UNKNOWN = 2

# Which failure a NO-GO isolates to, so the person at the bench knows where to look.
CAUSE_ABSENT = "PHYSICAL_OR_GATEWAY"  # nothing arriving at all
CAUSE_REPLAY = "REPLAY"  # arriving, but observed-time frozen
CAUSE_IDENTITY = "ALLOWLIST_IDENTITY"  # landing under the wrong uns_path
CAUSE_PROVENANCE = "PROVENANCE"  # synthetic traffic answering for the rig
CAUSE_QUALITY = "GATEWAY_QUALITY"  # collector says the values are bad
CAUSE_STALE = "STALE_OBSERVATION"  # observations too old
CAUSE_SCOPE = "SCOPE"  # wrong tag set

class Verdict:
    def __init__(self, ok: bool, cause: Optional[str], lines: list, exit_code: int):
        self.ok = ok
        self.cause = cause
        self.lines = lines
        self.exit_code = exit_code

    def __repr__(self) -> str:  # pragma: no cover
        return "Verdict(ok=%r, cause=%r)" % (self.ok, self.cause)


def classify(
    rows: list,
    *,
    expected_uns_path: str,
    expected_tag_count: int = 12,
    max_observed_age_s: float = 300.0,
    max_ingest_age_s: float = 120.0,
    min_live_ratio: float = 0.5,
) -> Verdict:
    """Return GO/NO-GO for the CV-101 stream. Pure — no DB, no clock.

    `rows` is one dict per (source_system, source_connection_id) group, as
    produced by the workflow's SQL. Every threshold is an argument so the gate
    can be tuned without editing logic.
    """
    if not rows:
        return Verdict(
            False,
            CAUSE_ABSENT,
            [
                "NO-GO: no CV-101 telemetry in the observation window at all.",
                "  Nothing is arriving — look at the physical link, then the gateway timer.",
            ],
            EXIT_NOGO,
        )

    # CV-101 accepts exactly one provenance pair.  Keep every non-synthetic row
    # in the partition rather than dropping it: an approved group cannot mask a
    # foreign physical gateway or unknown provenance in the same probe result.
    physical = [r for r in rows if _is_cv101_physical(r)]
    synthetic = [r for r in rows if classify_event(r).provenance == "simulated"]
    non_approved = [
        r
        for r in rows
        if classify_event(r).provenance != "simulated" and not _is_cv101_physical(r)
    ]

    if non_approved:
        names = ", ".join(_label(r) for r in non_approved)
        return Verdict(
            False,
            CAUSE_PROVENANCE,
            [
                "NO-GO: non-approved provenance is present (%s)." % names,
                "  CV-101 requires exactly ignition/cv101-bench-gw with simulated=false.",
            ],
            EXIT_NOGO,
        )

    if not physical:
        names = ", ".join(_label(r) for r in synthetic)
        return Verdict(
            False,
            CAUSE_PROVENANCE,
            [
                "NO-GO: no positively approved CV-101 physical traffic is present (%s)." % names,
                "  Only ignition/cv101-bench-gw with simulated=false can satisfy this gate.",
            ],
            EXIT_NOGO,
        )

    # The busiest physical group is the stream under test.
    g = max(physical, key=lambda r: _num(r.get("rows"), 0))
    lines = ["source: %s" % _label(g)]
    fails = []

    rows_n = _num(g.get("rows"), 0)
    distinct_ts = _num(g.get("distinct_observed_ts"), 0)
    observed_age = _num(g.get("newest_observed_age_s"), None)
    ingest_age = _num(g.get("newest_ingest_age_s"), None)
    uns_paths = [p for p in (g.get("uns_paths") or []) if p]
    tag_count = _num(g.get("tag_count"), 0)
    bad_quality = _num(g.get("bad_quality_rows"), 0)

    # live_ratio is per-SCAN, not per-ROW.
    #
    # The original formulation was distinct_ts / rows, which is unreachable by
    # construction: a scan reads all N tags and stamps them with one observation
    # timestamp, so rows = N x scans and the ratio can never exceed 1/N. For CV-101's
    # 12 tags that ceiling is 0.083 — below the 0.50 threshold — so a perfectly healthy
    # bench could never score GO. Measured on the live bench 2026-08-16 after the
    # Ignition trial reset: 2520 rows, 167 distinct, 12 tags -> 0.0663, i.e. 80% of the
    # theoretical maximum, still reported as REPLAY.
    #
    # Dividing by scans instead asks the question the gate actually means: "of the
    # scans in this window, how many carried a NEW observation?" That is 1.0 for a live
    # stream regardless of tag count, and still ~0 for a replay (one frozen timestamp
    # over thousands of scans). The replay detection #3161 needed is preserved exactly;
    # only the false negative on healthy multi-tag streams is removed.
    scans = (rows_n / tag_count) if tag_count else rows_n
    live_ratio = (distinct_ts / scans) if scans else 0.0

    lines.append(
        "rows=%s distinct_observed_ts=%s tags=%s scans=%.0f live_ratio=%.4f"
        % (rows_n, distinct_ts, tag_count, scans, live_ratio)
    )
    lines.append("observed_age_s=%s ingest_age_s=%s" % (observed_age, ingest_age))

    # 4. Continuity — is anything still arriving?
    if ingest_age is None or ingest_age > max_ingest_age_s:
        fails.append((CAUSE_ABSENT, "ingest has stopped (newest ingest %ss ago)" % ingest_age))

    # 4. Continuity — replay detection. THE check #3161 needed.
    if rows_n and live_ratio < min_live_ratio:
        fails.append(
            (
                CAUSE_REPLAY,
                "live_ratio %.4f < %.2f — %.0f scans (%s rows / %s tags) carry only %s "
                "distinct observed timestamp(s); observed time is frozen while ingest "
                "advances" % (live_ratio, min_live_ratio, scans, rows_n, tag_count, distinct_ts),
            )
        )

    # 2. Freshness.
    if observed_age is None or observed_age > max_observed_age_s:
        fails.append(
            (
                CAUSE_STALE,
                "newest observation is %ss old (limit %ss)" % (observed_age, max_observed_age_s),
            )
        )

    # 5. Quality — the collector's own verdict on its values.
    if bad_quality and bad_quality >= rows_n:
        fails.append(
            (
                CAUSE_QUALITY,
                "every row is quality='bad' — the gateway says the values "
                "are untrustworthy (check the PLC link before anything else)",
            )
        )

    # 1. Identity — ADR-0034 / #3233.
    if not uns_paths:
        fails.append((CAUSE_IDENTITY, "rows carry no uns_path at all"))
    elif expected_uns_path not in uns_paths:
        fails.append(
            (
                CAUSE_IDENTITY,
                "observed uns_path %s != allowlisted %s" % (uns_paths, expected_uns_path),
            )
        )
    elif len(uns_paths) > 1:
        fails.append(
            (
                CAUSE_IDENTITY,
                "stream is split across %s uns_paths: %s" % (len(uns_paths), uns_paths),
            )
        )

    # 5. Scope.
    if tag_count and tag_count < expected_tag_count:
        fails.append(
            (
                CAUSE_SCOPE,
                "only %s of %s expected tags present" % (tag_count, expected_tag_count),
            )
        )

    if synthetic:
        lines.append(
            "note: synthetic traffic also present (%s) — excluded from this gate"
            % ", ".join(_label(r) for r in synthetic)
        )

    if fails:
        out = ["NO-GO: %s" % fails[0][0]]
        out += ["  - [%s] %s" % (c, m) for c, m in fails]
        return Verdict(False, fails[0][0], out + lines, EXIT_NOGO)

    return Verdict(
        True,
        None,
        ["GO: CV-101 telemetry is live, fresh, physical, continuous and canonically identified."]
        + lines,
        EXIT_GO,
    )


def _is_cv101_physical(r: dict) -> bool:
    """CV-101 is stricter than generic physical provenance: exact approved pair."""
    return classify_event(r).cv101_approved


def _label(r: dict) -> str:
    return "%s/%s" % (r.get("source_system") or "?", r.get("source_connection_id") or "?")


def _num(v, default):
    if v is None or v == "":
        return default
    try:
        return float(v) if isinstance(v, str) and "." in v else int(v)
    except (TypeError, ValueError):
        try:
            return float(v)
        except (TypeError, ValueError):
            return default


def main(argv: list) -> int:
    ap = argparse.ArgumentParser(description="CV-101 live gate (GO/NO-GO).")
    ap.add_argument("--expected-uns-path", required=True)
    ap.add_argument("--expected-tag-count", type=int, default=12)
    ap.add_argument("--max-observed-age-s", type=float, default=300.0)
    ap.add_argument("--max-ingest-age-s", type=float, default=120.0)
    ap.add_argument("--min-live-ratio", type=float, default=0.5)
    args = ap.parse_args(argv)

    raw = sys.stdin.read().strip()
    if not raw:
        print("UNKNOWN: no input on stdin — the SQL step produced nothing.")
        return EXIT_UNKNOWN
    try:
        rows = json.loads(raw)
    except json.JSONDecodeError as exc:
        print("UNKNOWN: could not parse probe output as JSON (%s)" % exc)
        return EXIT_UNKNOWN
    if rows is None:
        rows = []
    if not isinstance(rows, list):
        print("UNKNOWN: probe output was not a JSON array")
        return EXIT_UNKNOWN

    v = classify(
        rows,
        expected_uns_path=args.expected_uns_path,
        expected_tag_count=args.expected_tag_count,
        max_observed_age_s=args.max_observed_age_s,
        max_ingest_age_s=args.max_ingest_age_s,
        min_live_ratio=args.min_live_ratio,
    )
    for line in v.lines:
        print(line)
    return v.exit_code


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv[1:]))
