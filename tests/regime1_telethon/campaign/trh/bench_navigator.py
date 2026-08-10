"""Paired benchmark: production retrieval vs Manual Navigator.

Ground truth is the FROZEN TRH oracle registry — not a new expectation set
written to suit the challenger. `reset_procedure`, `fault_code_pf525`,
`fault_code_gs10`, `reset_procedure_gs10` and `fault_code_pf525_overvoltage`
already declare their expected passages, their polysemy/adjacent traps and their
vendor scope, and they were frozen before this lane existed. Grading the
experiment against expectations it could influence would make any win
unfalsifiable.

Reported per question, both lanes:

    found      did an expected passage appear at all
    rank@      rank of the FIRST expected passage (lower is better)
    recall@k   fraction of expected passages retrieved
    traps      known WRONG-SENSE / adjacent-fault passages returned
    scope      any chunk from outside the oracle's vendor  <- contamination
    path       the navigation path, when there is one

`no-answer correctness` is scored on the GS10 fault-clear oracle, where the
right behaviour is to return nothing: the corpus has zero fault-clear passages
for AutomationDirect (#3177), so a lane that produces something there is
fabricating or has crossed vendors.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
for p in (REPO, os.path.join(REPO, "mira-bots")):
    if p not in sys.path:
        sys.path.insert(0, p)

from shared.manual_nav import route  # noqa: E402
from tests.regime1_telethon.campaign.trh import oracles as om  # noqa: E402

#: (oracle id, question, expect_no_answer)
CASES: tuple[tuple[str, str, bool], ...] = (
    ("reset_procedure", "How do I reset a PowerFlex 525 after an undervoltage fault?", False),
    ("reset_procedure", "PowerFlex 525 F004 — how do I clear the fault?", False),
    ("fault_code_pf525", "What does F004 mean on a PowerFlex 525?", False),
    ("fault_code_pf525_overvoltage", "What does F005 mean on a PowerFlex 525?", False),
    ("fault_code_gs10", "What does CE10 mean on my DURApulse GS10 drive?", False),
    ("reset_procedure_gs10", "How do I clear a fault on the AutomationDirect GS10?", True),
)


def _ollama_embedder(model: str = "nomic-embed-text:latest"):
    """Production-strength embeddings, or None. Never silently lexical-only."""
    import httpx

    base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

    def embed(q: str):
        try:
            r = httpx.post(f"{base}/api/embeddings", json={"model": model, "prompt": q}, timeout=30)
            return r.json()["embedding"]
        except Exception:  # noqa: BLE001
            return None

    return embed


@dataclass
class LaneScore:
    lane: str
    found: bool = False
    first_rank: int | None = None
    recall: float = 0.0
    n_chunks: int = 0
    traps: list[int] = field(default_factory=list)
    off_scope: int = 0
    path: str = ""
    reason: str = ""


def _chunk_text(c: dict) -> str:
    for k in ("content", "snippet", "text"):
        if c.get(k):
            return str(c[k])
    return ""


def score_lane(lane_name: str, chunks: list[dict], oracle, reason: str, path: str) -> LaneScore:
    s = LaneScore(lane_name, n_chunks=len(chunks), reason=reason, path=path)
    hits, missing = oracle.retrieval_hits(chunks)
    s.found = bool(hits)
    s.first_rank = min((h.rank for h in hits), default=None)
    total = len(oracle.expected_evidence) or 1
    s.recall = len(hits) / total
    s.traps = [t.rank for t in oracle.trap_hits(chunks)]

    # Cross-vendor contamination: any chunk whose manufacturer/model contradicts
    # the oracle's scope. This is the metric the experiment must not worsen.
    want_mfr = (oracle.scope.get("manufacturer") or "").lower()
    want_model = (oracle.scope.get("model") or "").lower()
    model_digits = "".join(ch for ch in want_model if ch.isdigit())
    for c in chunks:
        mfr = str(c.get("manufacturer") or "").lower()
        mdl = str(c.get("model_number") or "").lower()
        if want_mfr and mfr and want_mfr.split()[0] not in mfr and mfr.split()[0] not in want_mfr:
            s.off_scope += 1
        elif model_digits and mdl and model_digits not in mdl:
            s.off_scope += 1
    return s


def run(limit: int = 10, verbose: bool = False) -> list[dict]:
    registry = om.load()
    embed = _ollama_embedder()
    rows: list[dict] = []
    for oracle_id, question, expect_none in CASES:
        oracle = registry[oracle_id]
        mfr = oracle.scope.get("manufacturer", "")
        model = oracle.scope.get("model", "")
        lanes = route.run(
            question,
            manufacturer=mfr,
            model=model,
            limit=limit,
            embedder=embed,
            lane=route.LANE_BOTH,
        )
        rec = {"oracle": oracle_id, "question": question, "expect_none": expect_none}
        for name, lr in lanes.items():
            rec[name] = score_lane(name, lr.chunks, oracle, lr.reason, lr.path)
            if lr.error:
                rec[name].reason = f"ERROR {lr.error}"
        rows.append(rec)
        if verbose:
            print(f"\n=== {oracle_id}: {question}")
            for name in (route.LANE_CURRENT, route.LANE_NAVIGATOR):
                s = rec.get(name)
                if s:
                    print(
                        f"  {name:10} found={s.found} rank={s.first_rank} "
                        f"recall={s.recall:.2f} traps={s.traps} off_scope={s.off_scope} "
                        f"n={s.n_chunks} [{s.reason}]"
                    )
                    if s.path:
                        print(f"             path: {s.path}")
    return rows


def table(rows: list[dict]) -> str:
    out = [
        "| case | lane | found | rank@1st | recall | traps | off-scope | n |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        for name in (route.LANE_CURRENT, route.LANE_NAVIGATOR):
            s = r.get(name)
            if not s:
                continue
            tag = "**no-answer expected**" if r["expect_none"] else ""
            out.append(
                f"| `{r['oracle']}` {tag} | {name} | {'YES' if s.found else 'no'} | "
                f"{s.first_rank if s.first_rank is not None else '—'} | {s.recall:.2f} | "
                f"{len(s.traps)} | {s.off_scope} | {s.n_chunks} |"
            )
    return "\n".join(out)


def verdict(rows: list[dict]) -> str:
    cur = [r[route.LANE_CURRENT] for r in rows if route.LANE_CURRENT in r]
    nav = [r[route.LANE_NAVIGATOR] for r in rows if route.LANE_NAVIGATOR in r]
    answerable = [r for r in rows if not r["expect_none"]]

    def _found(lane):
        return sum(1 for r in answerable if r.get(lane) and r[lane].found)

    lines = [
        "",
        "## Verdict",
        "",
        f"- expected passage found (answerable cases): "
        f"current **{_found(route.LANE_CURRENT)}/{len(answerable)}**, "
        f"navigator **{_found(route.LANE_NAVIGATOR)}/{len(answerable)}**",
        f"- mean recall: current **{sum(s.recall for s in cur) / max(len(cur), 1):.2f}**, "
        f"navigator **{sum(s.recall for s in nav) / max(len(nav), 1):.2f}**",
        f"- cross-vendor/off-scope chunks: current **{sum(s.off_scope for s in cur)}**, "
        f"navigator **{sum(s.off_scope for s in nav)}**",
        f"- wrong-sense trap hits: current **{sum(len(s.traps) for s in cur)}**, "
        f"navigator **{sum(len(s.traps) for s in nav)}**",
    ]
    for r in rows:
        if r["expect_none"]:
            c, n = r.get(route.LANE_CURRENT), r.get(route.LANE_NAVIGATOR)
            lines.append(
                f"- no-answer correctness (`{r['oracle']}`): current returned "
                f"{c.n_chunks if c else '?'} chunk(s), navigator returned "
                f"{n.n_chunks if n else '?'} — **fewer is correct here**"
            )
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    rows = run(limit=a.limit, verbose=not a.quiet)
    print("\n" + table(rows))
    print(verdict(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
