"""``python -m mira_contextualizer`` → launch the desktop app.

Absolute import so the frozen package-less __main__ entry works (see
[[pyinstaller-frozen-path-gotchas]])."""

from mira_contextualizer.app import main

if __name__ == "__main__":
    raise SystemExit(main())
