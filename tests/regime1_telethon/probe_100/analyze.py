"""Turn probe results into findings — variance first, because that is the point.

The variance block asked 10 prompts 5 times each. What matters is not that 50
answers came back, but whether the 5 answers to the SAME question agreed. This
reports that per prompt, on four axes that each fail differently:

  answer identity   byte-identical replies?          (the strictest read)
  citation set      same sources cited?              (#3331 — retrieval order)
  claim stability   same fault-code claim?           (what a technician acts on)
  posture           same clarify-vs-answer decision? (what the UX feels like)

Citation drift with a stable claim is retrieval nondeterminism that does not yet
hurt. Claim drift is a correctness defect. Posture drift is a UX defect. Lumping
them into one "flaky" number is what made #3326 hard to argue about for weeks.

    py -3 -m tests.regime1_telethon.probe_100.analyze --results docs/testing/probe-100/results.jsonl
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
from collections import defaultdict
from pathlib import Path

_SOURCE_RE = re.compile(r"\[source:\s*([^\]]+)\]", re.I)
_FAULT_CLAIM_RE = re.compile(
    r"\bF0*(\d{1,3})\b\s*(?:=|is|means)?\s*([A-Za-z][A-Za-z /-]{2,28})", re.I
)


def _norm(text: str) -> str:
    """Strip the progress stub and collapse whitespace for identity comparison."""
    body = "\n".join(ln for ln in text.splitlines() if ln.strip() != "Diagnosing...")
    return re.sub(r"\s+", " ", body).strip().lower()


def _citations(text: str) -> frozenset[str]:
    return frozenset(re.sub(r"\s+", " ", c).strip().lower() for c in _SOURCE_RE.findall(text))


def _fault_claims(text: str) -> frozenset[str]:
    out = set()
    for code, name in _FAULT_CLAIM_RE.findall(text):
        name = name.strip().lower()
        if name and name not in {"is", "on", "the", "a"}:
            out.add(f"f{int(code):03d}={name[:24]}")
    return frozenset(out)


def variance_report(rows: list[dict]) -> list[str]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["block"] == "variance":
            groups[r["group"]].append(r)

    out = ["## A — variance across identical repeats", ""]
    if not groups:
        return out + ["_no variance rows in this result set_", ""]

    out += [
        "| prompt | n | identical replies | citation sets | fault claims | posture (asks?) | latency s |",
        "|---|---|---|---|---|---|---|",
    ]
    detail: list[str] = []
    for gid, rs in sorted(groups.items()):
        rs = [r for r in rs if not r["reply"].startswith("__ERROR__")]
        if not rs:
            continue
        bodies = {_norm(r["reply"]) for r in rs}
        cites = {_citations(r["reply"]) for r in rs}
        claims = {_fault_claims(r["reply"]) for r in rs}
        asks = {r["asks_question"] for r in rs}
        lats = [r["seconds"] for r in rs if r["seconds"] > 0]

        def mark(n: int) -> str:
            return f"**{n} distinct**" if n > 1 else "1 (stable)"

        med = f"{statistics.median(lats):.0f}" if lats else "—"
        rng = f" ({min(lats):.0f}–{max(lats):.0f})" if len(lats) > 1 else ""
        out.append(
            f"| `{gid}` | {len(rs)} | {mark(len(bodies))} | {mark(len(cites))} | "
            f"{mark(len(claims))} | {'**varies**' if len(asks) > 1 else 'stable'} | {med}{rng} |"
        )

        if len(claims) > 1:
            detail.append(f"\n**`{gid}` — fault-code claim differed across repeats:**\n")
            for r in rs:
                c = sorted(_fault_claims(r["reply"])) or ["(no explicit claim)"]
                detail.append(f"- r{r['repeat']}: {', '.join(c)}")
        if len(cites) > 1 and len(claims) <= 1:
            detail.append(f"\n**`{gid}` — citations differed while the claim held steady:**\n")
            for r in rs:
                c = sorted(_citations(r["reply"])) or ["(none)"]
                detail.append(f"- r{r['repeat']}: {', '.join(c)}")

    out += [""] + detail + [""]
    return out


def block_report(rows: list[dict]) -> list[str]:
    out = ["## B–E — graded blocks", ""]
    by_block: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["block"] != "variance":
            by_block[r["block"]].append(r)

    out += ["| block | n | PASS | FAIL | GAP | OBSERVE |", "|---|---|---|---|---|---|"]
    for b, rs in sorted(by_block.items()):
        c = defaultdict(int)
        for r in rs:
            c[r["grade"]] += 1
        out.append(
            f"| {b} | {len(rs)} | {c['PASS']} | "
            f"{'**' + str(c['FAIL']) + '**' if c['FAIL'] else '0'} | {c['GAP']} | {c['OBSERVE']} |"
        )
    out.append("")

    bad = [r for r in rows if r["grade"] in ("FAIL", "GAP")]
    if bad:
        out += ["### Every FAIL and GAP, verbatim", ""]
        for r in sorted(bad, key=lambda r: (r["grade"], r["id"])):
            out += [
                f"**{r['grade']} · `{r['id']}`** ({r['seconds']}s)",
                "",
                f"> Q: {r['text']}",
                "",
                "```",
                r["reply"][:900],
                "```",
                "",
                "".join(f"- {n}\n" for n in r["notes"]),
                "",
            ]
    return out


def ux_report(rows: list[dict]) -> list[str]:
    live = [r for r in rows if r["seconds"] > 0]
    if not live:
        return []
    lats = sorted(r["seconds"] for r in live)
    p = lambda q: lats[min(len(lats) - 1, int(len(lats) * q))]  # noqa: E731
    asked = sum(r["asks_question"] for r in live)
    cited = sum(r["has_citation"] for r in live)
    admits = sum(r["admits_ignorance"] for r in live)
    chars = [r["chars"] for r in live]
    return [
        "## User-interaction profile",
        "",
        f"- **Latency** p50 {p(0.5):.0f}s · p90 {p(0.9):.0f}s · max {lats[-1]:.0f}s "
        f"({len(live)} turns)",
        f"- **Reply length** median {statistics.median(chars):.0f} chars · max {max(chars)} chars",
        f"- **Asked a clarifying question** {asked}/{len(live)} "
        f"({100 * asked / len(live):.0f}%) — every one of these is a turn the "
        "technician spends before getting an answer",
        f"- **Carried a citation** {cited}/{len(live)} ({100 * cited / len(live):.0f}%)",
        f"- **Admitted ignorance** {admits}/{len(live)} ({100 * admits / len(live):.0f}%)",
        "",
    ]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="docs/testing/probe-100/results.jsonl")
    ap.add_argument("--out", default="docs/testing/probe-100/REPORT.md")
    args = ap.parse_args()

    rows = [json.loads(ln) for ln in Path(args.results).read_text().splitlines() if ln.strip()]
    errs = [r for r in rows if r["reply"].startswith("__ERROR__")]

    lines = [
        "# 100-question live probe — staging bot",
        "",
        f"`{len(rows)}` turns against `@Mira_stagong_bot` via Telethon "
        f"({len(errs)} transport errors).",
        "",
        "Generated by `tests/regime1_telethon/probe_100/analyze.py`. "
        "Raw transcripts: `results.jsonl`.",
        "",
    ]
    lines += ux_report(rows)
    lines += variance_report(rows)
    lines += block_report(rows)

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"\n--- wrote {args.out}", file=__import__("sys").stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
