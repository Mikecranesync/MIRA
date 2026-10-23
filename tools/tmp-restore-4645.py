#!/usr/bin/env python3
"""One-shot restore of notebook-query.ts from dbb05d38 + PROC_SIGNALS fix. Deleted after apply."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NQ = ROOT / "mira-hub/src/lib/notebook-query.ts"
GOOD = "dbb05d38e929bc7334a5478d18abe57f7bf1bc54"

OLD_PROC = (
    "const PROC_SIGNALS =\n"
    "  /\\b(verify|check|set|press|remove|clear|reset|acknowledge|acknowledges|acknowledged|acknowledging|acknowledgment|correct|corrected|apply|turn|ensure|connect|disconnect|measure|inspect|replace|confirm|select|enter|navigate|attention|warning|caution|step|steps|procedure|follow)\\b/gi;\n"
)
NEW_PROC = (
    "const PROC_SIGNALS =\n"
    "  /\\b(verify|check|set|press|remove|clear|reset|correct|corrected|apply|turn|ensure|connect|disconnect|measure|inspect|replace|confirm|select|enter|navigate|attention|warning|caution|step|steps|procedure|follow)\\b/gi;\n"
)


def must_replace(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {n}")
    return text.replace(old, new, 1)


def main() -> None:
    nq = subprocess.check_output(
        ["git", "show", f"{GOOD}:mira-hub/src/lib/notebook-query.ts"],
        text=True,
    )
    if "isFactoryResetMaterial" not in nq:
        raise SystemExit("dbb05d38 notebook-query.ts missing isFactoryResetMaterial")
    if nq.strip() == "PLACEHOLDER":
        raise SystemExit("dbb05d38 notebook-query.ts is unexpectedly PLACEHOLDER")
    nq = must_replace(nq, OLD_PROC, NEW_PROC, "PROC_SIGNALS")
    if "reset|acknowledge|acknowledges|acknowledged|acknowledging|acknowledgment|correct" in nq:
        raise SystemExit("PROC_SIGNALS still contains acknowledge*")
    if "isFactoryResetMaterial" not in nq:
        raise SystemExit("lost isFactoryResetMaterial")
    if 'intent === "fault"' not in nq:
        raise SystemExit("lost fault-intent factory-restore demotion")
    NQ.write_text(nq)
    print("restored notebook-query.ts from dbb05d38; PROC_SIGNALS acknowledge* removed")


if __name__ == "__main__":
    main()
