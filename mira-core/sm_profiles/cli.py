"""CLI for SM Profile inspection.

Usage:
    python mira-core/sm_profiles/cli.py list
    python mira-core/sm_profiles/cli.py show <name>
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow direct script invocation without the parent (hyphenated dir) on sys.path.
if __package__ in (None, ""):
    _ROOT = Path(__file__).resolve().parent
    sys.path.insert(0, str(_ROOT.parent))
    from sm_profiles.profile_loader import list_profiles, load_profile  # type: ignore
else:
    from .profile_loader import list_profiles, load_profile


def _cmd_list() -> int:
    for name in list_profiles():
        print(name)
    return 0


def _cmd_show(name: str) -> int:
    try:
        profile = load_profile(name)
    except FileNotFoundError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2
    print(profile.model_dump_json(indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        sys.stderr.write("usage: cli.py list | show <name>\n")
        return 2
    if args[0] == "list":
        return _cmd_list()
    if args[0] == "show" and len(args) == 2:
        return _cmd_show(args[1])
    sys.stderr.write(f"unknown command: {' '.join(args)}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
