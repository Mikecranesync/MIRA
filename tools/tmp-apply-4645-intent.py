#!/usr/bin/env python3
"""One-shot #4645 structural patch. Applied by CI, then deleted.

Gate-7 r1 flagged ACK synonym matching. Do not retune the regex.
Expand acknowledge vocabulary only when classifyIntent already says fault.
"""
from __future__ import annotations

from pathlib import Path

NQ = Path(__file__).resolve().parents[1] / "mira-hub/src/lib/notebook-query.ts"


def main() -> None:
    text = NQ.read_text()
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    skip_ack_block = False
    ack_rows_removed = 0
    i = 0
    while i < len(lines):
        line = lines[i]
        if 'Technician "ACK" names a pictogram key' in line:
            skip_ack_block = True
        if skip_ack_block:
            if '["acknowledge"' in line or 'group acknowledgment' in line or line.lstrip().startswith("//"):
                if '["acknowledge"' in line:
                    ack_rows_removed += 1
                i += 1
                if ack_rows_removed >= 2 and not (i < len(lines) and (lines[i].lstrip().startswith("//") or '["acknowledge"' in lines[i])):
                    skip_ack_block = False
                continue
            skip_ack_block = False
        if (
            "const synTerms = new Set<string>();" in line
            and i + 3 < len(lines)
            and "for (const [re, terms] of SYNONYMS)" in lines[i + 1]
            and "classifyIntent(q)" not in "".join(lines[i : i + 12])
        ):
            out.append(line)
            out.append(lines[i + 1])
            out.append(lines[i + 2])
            out.append(lines[i + 3])
            out.append(
                "  // #4645: OEM manuals say \"acknowledge\", not ACK. Add that vocabulary when\n"
                "  // the existing classifier already decided this is a fault-clear, not by\n"
                "  // matching the token ACK/back. Navigation (\"go back\", \"back key\") is not fault.\n"
                "  if (classifyIntent(q) === \"fault\") {\n"
                "    for (const term of [\"acknowledge\", \"group acknowledgment\", \"fault clear\"]) synTerms.add(term);\n"
                "  }\n"
            )
            i += 4
            continue
        out.append(line)
        i += 1
    patched = "".join(out)
    if ack_rows_removed < 2:
        raise SystemExit(f"expected to remove 2 ACK synonym rows, removed {ack_rows_removed}")
    if 'classifyIntent(q) === "fault"' not in patched:
        raise SystemExit("intent gate missing")
    if any('["acknowledge", "group acknowledgment", "fault clear"]' in ln and "synTerms" not in ln for ln in patched.splitlines() if "SYNONYMS" in patched[: patched.find(ln) + 1] if False):
        pass
    syn_end = patched.find("const EXACT_PATTERNS")
    syn = patched[:syn_end]
    if '["acknowledge", "group acknowledgment", "fault clear"]' in syn:
        raise SystemExit("ACK synonym row still in SYNONYMS")
    NQ.write_text(patched)
    print(f"structural intent-gated expansion applied; removed {ack_rows_removed} synonym rows")


if __name__ == "__main__":
    main()
