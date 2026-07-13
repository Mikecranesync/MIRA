"""PrintSense automated test harness.

Three layers over the frozen document corpus:
- ``corpus``     — immutable manifest + loader (frozen graphs, sha256-pinned images).
- Layer 1        — free deterministic render replay (``tests/printsense/test_render_corpus.py``).
- ``metamorphic``— image transforms + no-invention comparator (layer 2, paid nightly).
- ``telethon_e2e``— live staging E2E via a Telethon user (layer 3, pre-release).
- ``report``     — concise Markdown/HTML acceptance report.
"""
