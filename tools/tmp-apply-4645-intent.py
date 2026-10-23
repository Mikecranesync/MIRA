#!/usr/bin/env python3
"""One-shot #4645 structural patch. Applied by CI, then deleted.

Gate-7 r1 flagged ACK synonym matching. Do not retune the regex.
Expand acknowledge vocabulary only when classifyIntent already says fault.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NQ = ROOT / "mira-hub/src/lib/notebook-query.ts"


def must_replace(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {n}")
    return text.replace(old, new, 1)


def main() -> None:
    nq = NQ.read_text()
    nq = must_replace(
        nq,
        """  [/\\bfault\\b|\\btrip\\b|\\balarm\\b|\\berror\\s*code\\b/i, [\"fault\"]],
  // Technician \"ACK\" names a pictogram key; OEM manuals say \"acknowledge\" /
  // \"group acknowledgment\" and never the token ACK (#4645 / Comfort p.74).
  [/\\back\\b/i, [\"acknowledge\", \"group acknowledgment\", \"fault clear\"]],
  // Fault-clear and acknowledge are the same operator-action class. Expand
  // only when the object is a fault/alarm so a parameter-reset is not flooded.
  [/\\b(?:reset|clear)\\b[^.?!]*\\b(?:fault|trip|alarm)|\\b(?:fault|trip|alarm)\\b[^.?!]*\\b(?:reset|clear)\\b/i, [\"acknowledge\", \"group acknowledgment\", \"fault clear\"]],
  [/\\breset\\b|\\bclear\\b/i, [\"fault clear\"]],
""",
        """  [/\\bfault\\b|\\btrip\\b|\\balarm\\b|\\berror\\s*code\\b/i, [\"fault\"]],
  [/\\breset\\b|\\bclear\\b/i, [\"fault clear\"]],
""",
        "ACK synonym rows",
    )
    nq = must_replace(
        nq,
        """  const synTerms = new Set<string>();
  for (const [re, terms] of SYNONYMS) {
    if (re.test(q)) for (const t of terms) synTerms.add(t);
  }
""",
        """  const synTerms = new Set<string>();
  for (const [re, terms] of SYNONYMS) {
    if (re.test(q)) for (const t of terms) synTerms.add(t);
  }
  // #4645: OEM manuals say \"acknowledge\", not ACK. Add that vocabulary when
  // the existing classifier already decided this is a fault-clear, not by
  // matching the token ACK/back. Navigation (\"go back\", \"back key\") is not fault.
  if (classifyIntent(q) === \"fault\") {
    for (const term of [\"acknowledge\", \"group acknowledgment\", \"fault clear\"]) synTerms.add(term);
  }
""",
        "intent-gated expansion",
    )
    if "[/\\back\\b/i, [\"acknowledge\"" in nq:
        raise SystemExit("ACK synonym row still present")
    if 'classifyIntent(q) === "fault"' not in nq:
        raise SystemExit("intent gate missing")
    NQ.write_text(nq)
    print("structural intent-gated expansion applied")


if __name__ == "__main__":
    main()
