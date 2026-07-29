"""Package marker so pytest imports these modules as ``tests.proveit.*``.

Without it, ``test_cli.py`` here collides with ``tests/printsense/test_cli.py``
(both map to bare module ``test_cli`` under pytest's default import mode),
which aborts collection of the whole offline eval suite with
"import file mismatch". Only this directory is packaged — tests/printsense/
must stay unpackaged because its tests import siblings by bare module name
(e.g. ``from test_privacy_guards import ...``), which relies on the directory
being placed on sys.path.
"""
