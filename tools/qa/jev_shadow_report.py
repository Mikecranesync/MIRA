#!/usr/bin/env python3
"""Jev shadow vs MIRA `evidence_sufficient` — evidence collector and report.

Answers one question over real staging turns: when the Jev shadow judgment
(`answer_gate.jev_sufficient`, PR #3949) disagrees with MIRA's presence-based
`evidence_sufficient`, are the disagreements consistently useful?

Sources (merged, de-duplicated by trace id):
  --runs N          the last N successful `retrieval-acceptance.yml` runs' artifacts
                    (downloaded with `gh`). Acceptance turns are SWEPT from the
                    staging DB with their stranger tenant, so the artifact is the
                    only durable copy.
  --artifact PATH   a retrieval-acceptance.json already on disk (repeatable).
  --db              staging `decision_traces` (real usage, every tenant). Reads
                    ONLY the packet + non-text columns; refuses to run unless
                    `DOPPLER_CONFIG=stg` (`doppler run -p factorylm -c stg -- …`).

Eligible turn = the shadow ran or was skipped for a reason other than
`disabled`/`no_key` (those mean config never reached the container and are
reported as a defect, not as data). Judged turn = `jev_sufficient` non-null.

Because `evidence_sufficient` is true whenever chunks exist and Jev only runs
when chunks exist, every judged turn has `evidence_sufficient=true`; the only
possible disagreement is "MIRA says sufficient, Jev says low". Categories:

  D1 refused_jev_low        gate refused (insufficient_evidence) AND jev < LOW
                            → Jev agrees with the honest refusal; the presence flag was wrong.
  D2 answered_claim_jev_low answered AND jev < LOW AND ungrounded_unit_claim
                            → strongest signal of an ungrounded cited claim; adjudicate.
  D3 answered_jev_low       answered AND jev < LOW, no unit claim → partial/limitation answer
                            or Jev false negative; needs reading.
  D4 refused_jev_high       refused AND jev ≥ HIGH → retrieval fine, generation didn't use it.
  A  agree                  answered AND jev ≥ HIGH.
  U  uncertain              LOW ≤ jev < HIGH.

Never prints question or answer text; the packet holds none and the DB text
columns are never selected. Cost uses the vendor's published $/M input rate;
output tokens are free.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

LOW = 0.30
HIGH = 0.70
USD_PER_M_INPUT = 0.042  # api.typesafe.ai published rate (probe report, 2026-09-22)
LATENCY_CAP_MS = 1500  # DEFAULT_TIMEOUT_MS in jev-shadow.ts
TARGET_JUDGED = (50, 100)


def _gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def rows_from_artifact(path: Path, source: str) -> list[dict[str, Any]]:
    j = json.loads(path.read_text())
    out = []
    for r in j.get("rows", []):
        p = r.get("packet") or {}
        if not p:
            continue
        w = r.get("wire") or {}
        out.append(
            flatten(
                p,
                source=source,
                ts=j.get("ran_at"),
                trace_id=r.get("trace_id"),
                scenario=str(r.get("scenario") or "").split(" ")[0] or None,
                wire_status=w.get("status"),
                wire_citations=w.get("citations"),
                wire_basis=w.get("basis"),
            )
        )
    return out


def rows_from_runs(n: int) -> list[dict[str, Any]]:
    runs = json.loads(
        _gh(
            "run",
            "list",
            "--workflow",
            "retrieval-acceptance.yml",
            "--status",
            "success",
            "--limit",
            str(n),
            "--json",
            "databaseId,headSha,createdAt",
        )
    )
    out: list[dict[str, Any]] = []
    for run in runs:
        rid = str(run["databaseId"])
        with tempfile.TemporaryDirectory() as td:
            try:
                _gh("run", "download", rid, "-D", td)
            except subprocess.CalledProcessError:
                print(f"warn: run {rid} has no downloadable artifact (expired?)", file=sys.stderr)
                continue
            for f in Path(td).rglob("retrieval-acceptance.json"):
                for row in rows_from_artifact(f, source=f"run:{rid}"):
                    row["git_sha"] = row.get("git_sha") or run.get("headSha")
                    out.append(row)
    return out


def rows_from_db() -> list[dict[str, Any]]:
    if os.environ.get("DOPPLER_CONFIG") != "stg":
        sys.exit("refusing --db: DOPPLER_CONFIG != 'stg' (staging only; never point this at prod)")
    import psycopg2  # local dependency of the repo venv

    conn = psycopg2.connect(os.environ["NEON_DATABASE_URL"])
    conn.set_session(readonly=True)
    cur = conn.cursor()
    # Text columns (user_question, recommendation) are deliberately NOT selected.
    cur.execute(
        """
        SELECT otel_trace_id, ts, platform, git_sha, evidence_packet
          FROM decision_traces
         WHERE environment = 'staging'
           AND evidence_packet IS NOT NULL
           AND evidence_packet->'answer_gate' ? 'jev_skipped_reason'
         ORDER BY ts DESC
         LIMIT 2000
        """
    )
    out = []
    for trace_id, ts, platform, git_sha, packet in cur.fetchall():
        row = flatten(packet, source="db", ts=ts.isoformat() if ts else None, trace_id=trace_id)
        row["platform"] = platform
        row["git_sha"] = row.get("git_sha") or git_sha
        out.append(row)
    return out


def flatten(p: dict[str, Any], **extra: Any) -> dict[str, Any]:
    ag = p.get("answer_gate") or {}
    rt = p.get("retrieval") or {}
    cx = p.get("context") or {}
    gen = p.get("generation") or {}
    ids = p.get("ids") or {}
    tm = p.get("timings_ms") or {}
    return {
        "turn_id": ids.get("turn_id"),
        "git_sha": p.get("git_sha"),
        "environment": p.get("environment"),
        "retrieval_strategy": rt.get("strategy"),
        "retrieval_executed": rt.get("executed"),
        "chunk_count": cx.get("chunk_count"),
        "candidate_count": rt.get("candidate_count"),
        "oem_manufacturer_source": rt.get("oem_manufacturer_source"),
        "distinct_sources": len({str(d).split("#")[0] for d in (rt.get("returned_doc_ids") or [])}),
        "visual_evidence_count": cx.get("visual_evidence_count"),
        "system_prompt_kind": cx.get("system_prompt_kind"),
        "evidence_sufficient": ag.get("evidence_sufficient"),
        "decision": ag.get("decision"),
        "reason": ag.get("reason"),
        "refusal_phrase_matched": ag.get("refusal_phrase_matched"),
        "ungrounded_unit_claim": ag.get("ungrounded_unit_claim"),
        "safety_classification": ag.get("safety_classification"),
        "jev_aware": "jev_skipped_reason" in ag,
        "jev_sufficient": ag.get("jev_sufficient"),
        "jev_skipped_reason": ag.get("jev_skipped_reason"),
        "jev_latency_ms": ag.get("jev_latency_ms"),
        "jev_input_tokens": ag.get("jev_input_tokens"),
        "served_provider": gen.get("served_provider"),
        "generation_ms": tm.get("generation"),
        "total_ms": tm.get("total"),
        **extra,
    }


def categorize(r: dict[str, Any]) -> str:
    j = r.get("jev_sufficient")
    if j is None:
        return "skipped:" + str(r.get("jev_skipped_reason")) if r.get("jev_aware") else "pre_shadow"
    refused = r.get("decision") == "insufficient_evidence"
    if j < LOW:
        if refused:
            return "D1 refused_jev_low"
        return (
            "D2 answered_claim_jev_low" if r.get("ungrounded_unit_claim") else "D3 answered_jev_low"
        )
    if j >= HIGH:
        return "D4 refused_jev_high" if refused else "A agree"
    return "U uncertain"


def report(
    rows: list[dict[str, Any]], out_md: Path, out_csv: Path, baseline: list[dict[str, Any]]
) -> int:
    seen: set[str] = set()
    uniq = []
    for r in rows:
        k = r.get("trace_id") or f"{r['source']}:{r.get('scenario')}"
        if k in seen:
            continue
        seen.add(k)
        r["category"] = categorize(r)
        uniq.append(r)

    pre_shadow = [r for r in uniq if not r.get("jev_aware")]
    config_defects = [r for r in uniq if r["jev_skipped_reason"] in ("disabled", "no_key")]
    eligible = [r for r in uniq if r.get("jev_aware") and r not in config_defects]
    judged = [r for r in eligible if r["jev_sufficient"] is not None]
    zero_chunk = [r for r in eligible if r["jev_skipped_reason"] == "no_evidence"]
    zero_chunk_bad = [r for r in zero_chunk if (r.get("chunk_count") or 0) > 0]
    judged_bad = [r for r in judged if not (r.get("chunk_count") or 0)]

    with out_csv.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=sorted({k for r in uniq for k in r}))
        w.writeheader()
        w.writerows(uniq)

    lat = [r["jev_latency_ms"] for r in judged if isinstance(r.get("jev_latency_ms"), (int, float))]
    toks = [
        r["jev_input_tokens"] for r in judged if isinstance(r.get("jev_input_tokens"), (int, float))
    ]
    cats: dict[str, list[dict[str, Any]]] = {}
    for r in judged:
        cats.setdefault(r["category"], []).append(r)

    L = []
    L.append("# Jev shadow vs `evidence_sufficient` — staging evidence report\n")
    L.append(
        f"Packets: {len(uniq)} · pre-shadow builds: {len(pre_shadow)} · eligible: {len(eligible)} · judged: {len(judged)} · zero-chunk skips: {len(zero_chunk)} · config defects (`disabled`/`no_key`): {len(config_defects)}"
    )
    lo, hi = TARGET_JUDGED
    L.append(
        f"\nProgress toward the {lo}–{hi} judged-turn window: **{len(judged)}/{lo}**. Real staging usage preferred; do not fabricate traffic.\n"
    )
    if config_defects:
        L.append(
            f"**DEFECT:** {len(config_defects)} packet(s) skipped as `disabled`/`no_key` on staging — the flag or key never reached the container. Not evidence. Trace ids: "
            + ", ".join(str(r["trace_id"])[:12] for r in config_defects[:10])
            + "\n"
        )
    L.append("## Invariants\n")
    L.append(
        f"- Zero-chunk turns never call Jev: {'OK' if not zero_chunk_bad else 'VIOLATED'} ({len(zero_chunk)} skipped with chunk_count=0{'' if not zero_chunk_bad else '; ' + str(len(zero_chunk_bad)) + ' had chunks'})"
    )
    L.append(
        f"- Every judged turn had chunks: {'OK' if not judged_bad else 'VIOLATED (' + str(len(judged_bad)) + ')'}"
    )
    L.append(
        f"- Every judged turn has `evidence_sufficient=true` (presence law): {'OK' if all(r['evidence_sufficient'] for r in judged) else 'VIOLATED'}"
    )
    if lat:
        L.append(
            f"- Jev latency ms: p50 {statistics.median(lat):.0f} · max {max(lat)} · cap {LATENCY_CAP_MS} (`timeout` skips: {sum(1 for r in eligible if r['jev_skipped_reason'] == 'timeout')})"
        )
    if toks:
        usd = sum(toks) * USD_PER_M_INPUT / 1e6
        L.append(
            f"- Cost (actual, from `jev_input_tokens`): {sum(toks)} input tokens over {len(toks)} calls = ${usd:.6f} (${usd / len(toks):.6f}/call at ${USD_PER_M_INPUT}/M input; output free)"
        )
    else:
        L.append(
            "- Cost: `jev_input_tokens` absent from these packets (pre-field builds); bound by construction ≤ ~1,200 input tokens/call ≈ $0.00005/call"
        )
    if baseline:
        by = {}
        for r in baseline:
            by.setdefault(r.get("scenario"), []).append(r.get("total_ms") or 0)
        cur = {}
        for r in uniq:
            if str(r.get("source", "")).split(":")[0] in ("run", "file"):
                cur.setdefault(r.get("scenario"), []).append(r.get("total_ms") or 0)
        L.append(
            "- Turn total_ms, baseline (pre-Jev) vs current acceptance rows, per scenario: "
            + "; ".join(
                f"#{s}: {statistics.median(by[s]):.0f}→{statistics.median(cur[s]):.0f}"
                for s in sorted(by)
                if s in cur
            )
        )
    L.append("\n## Disagreement categories (judged turns)\n")
    L.append("| category | n | meaning |\n|---|---|---|")
    meaning = {
        "D1 refused_jev_low": "gate refused AND jev<0.30 — Jev agrees with the honest refusal; presence flag wrong",
        "D2 answered_claim_jev_low": "answered AND jev<0.30 AND ungrounded_unit_claim — likely ungrounded cited claim; adjudicate",
        "D3 answered_jev_low": "answered AND jev<0.30, no unit claim — partial/limitation answer or Jev false negative; read it",
        "D4 refused_jev_high": "refused AND jev≥0.70 — retrieval fine, generation didn't use it",
        "A agree": "answered AND jev≥0.70",
        "U uncertain": "0.30 ≤ jev < 0.70",
    }
    for c in [
        "D1 refused_jev_low",
        "D2 answered_claim_jev_low",
        "D3 answered_jev_low",
        "D4 refused_jev_high",
        "A agree",
        "U uncertain",
    ]:
        L.append(f"| {c} | {len(cats.get(c, []))} | {meaning[c]} |")
    dis = sum(
        len(cats.get(c, []))
        for c in (
            "D1 refused_jev_low",
            "D2 answered_claim_jev_low",
            "D3 answered_jev_low",
            "D4 refused_jev_high",
        )
    )
    L.append(
        f"\nDisagreements: {dis}/{len(judged)} judged turns."
        + (" Too few judged turns to conclude; keep collecting." if len(judged) < lo else "")
    )
    L.append(
        "\n## Concrete examples (trace id · source · strategy · chunks · decision · jev · claim)\n"
    )
    for c, rs in sorted(cats.items()):
        L.append(f"**{c}**")
        for r in rs[:8]:
            L.append(
                f"- `{str(r.get('trace_id'))[:16]}` · {r.get('source')}{(' case ' + str(r.get('scenario'))) if r.get('scenario') else ''} · {r.get('retrieval_strategy')} · chunks={r.get('chunk_count')} · {r.get('decision')}/{r.get('reason')} · jev={r.get('jev_sufficient')} · unit_claim={r.get('ungrounded_unit_claim')} · lat={r.get('jev_latency_ms')}ms"
            )
    L.append(f"\nCSV: `{out_csv}` (one row per packet; no text fields).")
    out_md.write_text("\n".join(L) + "\n")
    print("\n".join(L))
    return 1 if (config_defects or zero_chunk_bad or judged_bad) else 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--runs",
        type=int,
        default=0,
        help="download the last N successful acceptance runs' artifacts",
    )
    ap.add_argument(
        "--artifact",
        action="append",
        default=[],
        help="retrieval-acceptance.json on disk (repeatable)",
    )
    ap.add_argument(
        "--db",
        action="store_true",
        help="read staging decision_traces (requires DOPPLER_CONFIG=stg)",
    )
    ap.add_argument(
        "--baseline-artifact", help="a pre-Jev retrieval-acceptance.json for the latency comparison"
    )
    ap.add_argument(
        "--out", default="/tmp/jev-shadow-report", help="output path prefix (.md/.csv appended)"
    )
    a = ap.parse_args()
    rows: list[dict[str, Any]] = []
    if a.runs:
        rows += rows_from_runs(a.runs)
    for f in a.artifact:
        rows += rows_from_artifact(Path(f), source=f"file:{Path(f).name}")
    if a.db:
        rows += rows_from_db()
    if not rows:
        sys.exit("no packets found — pass --runs N, --artifact PATH and/or --db")
    baseline = (
        rows_from_artifact(Path(a.baseline_artifact), source="baseline")
        if a.baseline_artifact
        else []
    )
    return report(rows, Path(a.out + ".md"), Path(a.out + ".csv"), baseline)


if __name__ == "__main__":
    sys.exit(main())
