"""The build-time license gate (CU-RR1): MIT/Apache, or an owner-approved exception for
that package's recorded licenses only. Fail closed on anything else."""

from __future__ import annotations

import sys
from email.message import Message
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import check_licenses as cl  # noqa: E402


@pytest.mark.parametrize(
    "name,stmts",
    [
        ("fastapi", ["MIT"]),
        ("tokenizers", ["Apache Software License"]),
        ("packaging", ["Apache-2.0 OR BSD-2-Clause"]),
        ("tqdm", ["MPL-2.0 AND MIT"]),
        ("typing_extensions", ["PSF-2.0"]),
        ("Starlette", ["BSD-3-Clause"]),
        ("numpy", ["BSD License"]),
    ],
)
def test_accepts_allowed_and_approved(name, stmts):
    assert cl.offenders([(name, stmts)]) == []


@pytest.mark.parametrize(
    "name,stmts",
    [
        ("new-dep", ["MIT AND GPL-3.0-only"]),  # Codex r4 F5: AND needs every operand
        ("new-dep", ["MIT AND BSD-3-Clause"]),  # AND of a known-but-unapproved license
        ("new-dep", ["Apache-1.1"]),  # Codex r4 F5: only Apache-2.0
        ("numpy", ["GPL-3.0-only"]),  # Codex r4 F5: approved name, unapproved license
        ("some-new-dep", ["BSD-3-Clause"]),  # BSD is approved per package, not globally
        ("new-dep", ["MIT", "GNU General Public License v3 (GPLv3)"]),  # every statement
        ("new-dep", ["Apache-2.0 WITH LLVM-exception"]),  # unknown operator
        ("new-dep", ["(MIT OR GPL-3.0"]),  # malformed
        ("mystery", []),
    ],
)
def test_rejects(name, stmts):
    assert cl.offenders([(name, stmts)]) != []


def _meta(**fields) -> Message:
    m = Message()
    for k, v in fields.items():
        for item in v if isinstance(v, list) else [v]:
            m[k.replace("_", "-")] = item
    return m


def test_a_short_license_field_is_never_ignored():
    meta = _meta(License="GPL-3.0", Classifier=["License :: OSI Approved :: MIT License"])
    assert "GPL-3.0" in cl.statements(meta)
    assert cl.offenders([("x", cl.statements(meta))]) != []


def test_a_copyright_line_is_skipped_when_a_classifier_speaks():
    meta = _meta(
        License="Copyright (c) 2005-2025, NumPy Developers.",
        Classifier=["License :: OSI Approved :: BSD License"],
    )
    assert cl.statements(meta) == ["BSD License"]


def test_the_approved_list_is_exactly_the_audited_fourteen():
    assert sorted(cl.APPROVED_EXCEPTIONS) == sorted(
        [
            "certifi",
            "click",
            "fsspec",
            "httpcore",
            "httpx",
            "idna",
            "mpmath",
            "numpy",
            "protobuf",
            "starlette",
            "sympy",
            "tqdm",
            "typing-extensions",
            "uvicorn",
        ]
    )
