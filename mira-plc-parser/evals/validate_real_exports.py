"""Validate the parser against REAL, held-out PLC exports (generalization, on demand).

The committed goldens + scorer use synthetic fixtures (and the real CCW `.st` under plc/). This
script points the parser at a directory of *real vendor exports* you've downloaded locally -- e.g.
genuine Siemens TIA Openness XML blocks -- and reports how it did, WITHOUT committing those files
(many are GPL/vendor-licensed and must not enter this Apache/MIT repo).

Usage:
    python evals/validate_real_exports.py <dir>     # any folder of real exports
    python evals/validate_real_exports.py           # defaults to evals/real_samples/ (gitignored)

See evals/REAL_SAMPLES.md for vetted public sources + fetch commands + license notes.
Offline, read-only, stdlib-only.
"""
from __future__ import annotations

import sys
from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parents[1]
if str(_PKG_DIR) not in sys.path:
    sys.path.insert(0, str(_PKG_DIR))

from mira_plc_parser import render_json, run  # noqa: E402

DEFAULT_DIR = _PKG_DIR / "evals" / "real_samples"
_EXTS = (".xml", ".l5x", ".st", ".scl", ".csv")


def validate_dir(d: Path) -> list[dict]:
    rows = []
    for path in sorted(d.rglob("*")):
        if path.suffix.lower() not in _EXTS or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        r = render_json(run(path.name, text))
        c = r.get("counts", {})
        langs = sorted({s.get("type") for s in r.get("routine_summaries", [])})
        rows.append({
            "file": path.name, "fmt": r["detection"]["fmt"], "handled": r.get("handled"),
            "vendor": r.get("vendor"), "tags": c.get("tags", 0), "routines": c.get("routines", 0),
            "rungs": c.get("rungs", 0), "permissives": c.get("permissives", 0),
            "timer_chains": c.get("timer_chains", 0), "sequences": c.get("sequences", 0),
            "langs": langs, "warnings": r.get("warnings", [])[:2],
        })
    return rows


def main(argv: list[str]) -> int:
    d = Path(argv[1]) if len(argv) > 1 else DEFAULT_DIR
    if not d.exists():
        print("no sample dir: %s\n(create it and drop real exports in -- see evals/REAL_SAMPLES.md)" % d)
        return 0
    rows = validate_dir(d)
    if not rows:
        print("no exports found in %s (looked for %s)" % (d, ", ".join(_EXTS)))
        print("see evals/REAL_SAMPLES.md for where to fetch real samples.")
        return 0
    print("Real-export validation -- %d file(s) in %s\n" % (len(rows), d))
    for r in rows:
        ok = "OK " if r["handled"] else "XX "
        print("  %s %-34s %-16s tags=%-4s routines=%-3s rungs=%-3s langs=%s"
              % (ok, r["file"][:34], r["fmt"], r["tags"], r["routines"], r["rungs"], ",".join(r["langs"])))
        if any((r["permissives"], r["timer_chains"], r["sequences"])):
            print("        analysis: permissives=%s timer_chains=%s sequences=%s"
                  % (r["permissives"], r["timer_chains"], r["sequences"]))
        for w in r["warnings"]:
            print("        warn: %s" % w[:88])
    handled = sum(1 for r in rows if r["handled"])
    print("\n  %d/%d handled. (SCL bodies exercise the rung lift; LAD/FBD/GRAPH degrade to language-only.)"
          % (handled, len(rows)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
