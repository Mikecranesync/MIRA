"""Offline defect lab — RESCAN recorded campaign replies with deterministic
detectors. No live bot, no LLM and (after the first run) no network at all.

NAMING, precisely: this module does NOT replay anything. It reads assistant
text that a past live run already produced and runs detectors over it. Nothing
in MIRA is re-executed here (the one exception is inside the gates, which call
the real `resolve_uns_path`/`canonical_vendor` on stored user text).

Actual replay — historical technician turns driven through today's
`Supervisor.process_full()` with real session state — lives in `replay.py`.
An earlier version of this docstring said "replay", which was wrong and made
the two modules sound interchangeable. They are not.

Why this exists
---------------
Live Telethon rounds are slow, stochastic and expensive, and they only ever
exercise the scenarios in that run. Every defect this arc found, however, is
detectable from the TRANSCRIPT plus the corpus:

    contained repeat      CTX-004b   defect (B)   c6 t2_000
    fabricated specific   #3165                   c6/c7 t2_005
    re-ask supplied info  gates                   the PF-525 re-ask
    cross-vendor citation gates                   #3133 class
    uncited claim         gates
    repeated answer       gates                   tier-8 verbatim repeat

So the replies already captured across every ledger are a regression corpus.
This lab turns every past run into a check that costs nothing to re-run, and
prints ONE ranked verdict table instead of a transcript dump.

Usage
-----
    py -3 -m tests.regime1_telethon.campaign.offline_lab                 # offline, cached
    doppler run -p factorylm -c stg -- py -3 -m tests.regime1_telethon.campaign.offline_lab --resolve
    py -3 -m tests.regime1_telethon.campaign.offline_lab --strict        # exit 1 on any violation

``--resolve`` is the only mode that touches the database: it looks up parameter
tokens the cache has never seen and writes them back, so the next plain run is
free. Everything else is pure disk.
"""

from __future__ import annotations

import argparse
import collections
import difflib
import io
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2]))

from tests.regime1_telethon.campaign import fabrication, gates  # noqa: E402

LEDGER_DIR = HERE / "ledger"
CACHE = HERE / "param-corpus-cache.json"
REPORT_DIR = HERE.parents[2] / "docs" / "testing" / "campaign-reports"

# CTX-004b thresholds, mirrored from engine.py so the lab measures what
# production measures. Kept as literals with the engine values named in the
# comment, because the lab must run with no mira-bots import path.
REPEAT_MIN_LEN = 40  # engine _REPEAT_MIN_LEN
REPEAT_SIM = 0.9  # engine _REPEAT_REPLY_SIM
REPEAT_CONTAINED_FRAC = 0.35  # engine _REPEAT_CONTAINED_FRAC

_SOURCE_TAG = re.compile(r"\[Source:[^\]]*\]", re.IGNORECASE)


def _norm(text: str) -> str:
    text = _SOURCE_TAG.sub(" ", text or "")
    text = re.sub(r"---\s*Sources\s*---.*", " ", text, flags=re.DOTALL | re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip().lower()


def load_conversations() -> dict[tuple[str, str], list[dict]]:
    """{(campaign, conv_id): [{role, text, i}, ...]} from every ledger."""
    convs: dict[tuple[str, str], list[dict]] = collections.defaultdict(list)
    for path in sorted(LEDGER_DIR.glob("*.jsonl")):
        campaign = path.stem
        for line in io.open(path, encoding="utf-8"):
            if not line.strip():
                continue
            rec = json.loads(line)
            if rec.get("kind") != "turn":
                continue
            convs[(campaign, rec.get("conv", "?"))].append(
                {"role": rec.get("role"), "text": rec.get("text") or "", "i": rec.get("i")}
            )
    for turns in convs.values():
        turns.sort(key=lambda t: (t["i"] or 0, t["role"] != "tech"))
    return convs


def detect_contained_repeat(turns: list[dict]) -> list[dict]:
    """CTX-004b: a prior answer carried verbatim inside a later one."""
    out = []
    replies = [(t["i"], _norm(t["text"])) for t in turns if t["role"] == "mira"]
    for pos, (idx, cur) in enumerate(replies):
        for prev_idx, prev in replies[:pos]:
            if not prev or not cur or len(prev) < REPEAT_MIN_LEN:
                continue
            ratio = difflib.SequenceMatcher(None, cur, prev).ratio()
            contained = prev in cur and len(prev) / len(cur) >= REPEAT_CONTAINED_FRAC
            if ratio >= REPEAT_SIM or contained:
                out.append(
                    {
                        "detector": "contained_repeat" if contained else "near_duplicate",
                        "turn": idx,
                        # The SIGNATURE is what makes this readable across runs.
                        # Tier 8 is adaptive, so raw counts swing with the probe's
                        # path and a single-run count comparison is noise. Which
                        # TEMPLATE repeated is stable, and it is what names the
                        # defect: "before i diagnose, confirm the equipment" is
                        # the UNS gate, "before i can give you a confident
                        # diagnosis" is the self-critique clarifier.
                        "signature": prev[:60],
                        "detail": (
                            f"turn {prev_idx} reproduced in turn {idx} "
                            f"(ratio {ratio:.3f}, frac {len(prev) / len(cur):.3f})"
                        ),
                    }
                )
                break
    return out


def detect_fabricated(turns: list[dict], corpus: fabrication.CorpusIndex) -> list[dict]:
    """#3165: a parameter-shaped token asserted but absent from the corpus."""
    out = []
    supplied: list[str] = []
    for turn in turns:
        if turn["role"] != "mira":
            supplied.append(turn["text"])
            continue
        bad = fabrication.find_fabricated_claims(turn["text"], " ".join(supplied), corpus)
        for token in bad:
            out.append(
                {
                    "detector": "fabricated_specific",
                    "turn": turn["i"],
                    "detail": f"{token!r} asserted but absent from the corpus",
                }
            )
        supplied.append(turn["text"])
    return out


def detect_gate_violations(turns: list[dict], conv_id: str) -> list[dict]:
    transcript = [{"role": t["role"], "text": t["text"]} for t in turns]
    try:
        violations = gates.check_conversation(transcript, conv_id)
    except Exception as exc:  # noqa: BLE001 - a lab never dies on one conversation
        return [{"detector": "gate_error", "turn": None, "detail": f"{type(exc).__name__}: {exc}"}]
    return [
        {"detector": getattr(v, "gate", "gate"), "turn": None, "detail": str(v)[:200]}
        for v in violations
    ]


def _db_fetch():
    """Return a token->rowcount callable, or None when there is no database."""
    url = os.environ.get("NEON_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        return None
    try:
        import psycopg2
    except ImportError:
        return None
    if "channel_binding" in url:
        url = "&".join(p for p in url.split("&") if not p.startswith("channel_binding"))
    conn = psycopg2.connect(url)
    conn.set_session(readonly=True)

    def fetch(token: str):
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM knowledge_entries WHERE content ILIKE %s", (f"%{token}%",)
            )
            return cur.fetchone()[0]

    return fetch


# Known-benign findings, pinned so the lab's signal stays readable. Each entry
# is a REASON, not a mute: the asset-switch re-ask is the UNS confirmation gate
# doing its job, which is the false positive recorded when that gate was built.
NEGATIVE_CONTROLS = {
    "reasks_supplied_info": "UNS confirmation gate legitimately confirming an asset switch",
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--resolve", action="store_true", help="resolve unknown tokens against the DB")
    ap.add_argument("--strict", action="store_true", help="exit 1 if any unexpected violation")
    ap.add_argument("--report", action="store_true", help="write a markdown report")
    args = ap.parse_args()

    corpus = fabrication.CorpusIndex(CACHE, fetch=_db_fetch() if args.resolve else None)
    convs = load_conversations()

    findings: list[dict] = []
    unresolved: set[str] = set()
    for (campaign, conv_id), turns in sorted(convs.items()):
        supplied_all = " ".join(t["text"] for t in turns if t["role"] == "tech")
        for turn in turns:
            if turn["role"] != "mira":
                continue
            for token in fabrication.extract_param_claims(turn["text"], supplied_all):
                if corpus.rows(token) is None:
                    unresolved.add(token)
        for hit in (
            detect_contained_repeat(turns)
            + detect_fabricated(turns, corpus)
            + detect_gate_violations(turns, conv_id)
        ):
            hit.update(campaign=campaign, conv=conv_id)
            findings.append(hit)

    if args.resolve:
        corpus.save()

    by_detector = collections.Counter(f["detector"] for f in findings)
    real = [f for f in findings if f["detector"] not in NEGATIVE_CONTROLS]

    # Per-campaign is the decision-useful view: a fix lands as a COLUMN going to
    # zero between two runs of the same tiers, not as a single conversation flip.
    campaigns = sorted({c for c, _ in convs})
    dets = [d for d, _ in by_detector.most_common() if d not in NEGATIVE_CONTROLS]
    grid: dict[tuple[str, str], int] = collections.Counter(
        (f["campaign"], f["detector"]) for f in real
    )
    print()
    print("per-campaign (actionable only) — a fix is a column going to zero")
    header = "detector".ljust(22) + "".join(c.rjust(8) for c in campaigns)
    print(header)
    print("-" * len(header))
    for det in dets:
        row = det.ljust(22) + "".join(str(grid.get((c, det), 0)).rjust(8) for c in campaigns)
        print(row)

    print(f"conversations: {len(convs)}   ledgers: {len({c for c, _ in convs})}")
    print(f"replies scanned: {sum(1 for t in convs.values() for x in t if x['role'] == 'mira')}")
    if unresolved:
        print(f"UNRESOLVED tokens (run --resolve): {sorted(unresolved)}")
    print()
    print(f"{'detector':24} {'count':>5}  note")
    print("-" * 78)
    for det, count in by_detector.most_common():
        note = NEGATIVE_CONTROLS.get(det, "")
        print(f"{det:24} {count:5}  {'[negative control] ' + note if note else ''}")
    print()
    # Which TEMPLATE repeated, and in which runs. Tier 8 is adaptive, so a raw
    # count swings with the probe's path — the signature is the stable signal,
    # and a fix shows up as a row disappearing rather than a number falling.
    sigs = collections.defaultdict(set)
    for f in real:
        if f.get("signature"):
            sigs[f["signature"]].add(f["campaign"])
    if sigs:
        print()
        print("repeated TEMPLATE by run — a fix is a row that stops appearing")
        print("-" * 78)
        for sig, camps in sorted(sigs.items(), key=lambda kv: -len(kv[1])):
            print(f"  {sig[:56]:56} {','.join(sorted(camps))}")

    print()
    if real:
        print(f"ACTIONABLE ({len(real)}):")
        for f in real:
            print(f"  {f['campaign']:8} {f['conv'][:30]:30} turn={f['turn']}  {f['detail'][:110]}")
    else:
        print("ACTIONABLE: none — every finding is a pinned negative control.")

    if args.report:
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        out = REPORT_DIR / "offline-lab.md"
        lines = [
            "# Offline defect lab",
            "",
            "Deterministic rescan of recorded campaign replies. No live bot, no LLM.",
            "",
            f"- conversations: **{len(convs)}**",
            f"- replies scanned: "
            f"**{sum(1 for t in convs.values() for x in t if x['role'] == 'mira')}**",
            f"- actionable findings: **{len(real)}**",
            "",
            "| detector | count | note |",
            "|---|---|---|",
        ]
        for det, count in by_detector.most_common():
            note = NEGATIVE_CONTROLS.get(det, "")
            lines.append(f"| `{det}` | {count} | {'negative control — ' + note if note else ''} |")
        if real:
            lines += [
                "",
                "## Actionable",
                "",
                "| campaign | conversation | turn | detail |",
                "|---|---|---|---|",
            ]
            for f in real:
                lines.append(
                    f"| {f['campaign']} | `{f['conv']}` | {f['turn']} | {f['detail'][:160]} |"
                )
        out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"\nwrote {out}")

    return 1 if (args.strict and real) else 0


if __name__ == "__main__":
    raise SystemExit(main())
