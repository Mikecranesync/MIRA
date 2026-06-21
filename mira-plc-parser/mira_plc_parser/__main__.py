"""`python -m mira_plc_parser ...` -> the offline CLI (works from source, no install).

Absolute (not relative) import on purpose: this module is both the `python -m` entry point
*and* the PyInstaller entry script. PyInstaller runs it as a package-less top-level `__main__`,
where `from .cli import ...` raises "attempted relative import with no known parent package".
The absolute import resolves in both contexts (and makes PyInstaller bundle the package).
"""
from mira_plc_parser.cli import main

raise SystemExit(main())
