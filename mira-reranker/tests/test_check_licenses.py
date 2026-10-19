"""The build-time license gate (CU-RR1): MIT/Apache or an owner-approved exception."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import check_licenses as cl  # noqa: E402


def test_mit_and_apache_pass_by_their_own_metadata():
    assert (
        cl.offenders(
            [
                ("fastapi", ["MIT"]),
                ("tokenizers", ["License :: OSI Approved :: Apache Software License"]),
            ]
        )
        == []
    )


def test_approved_exception_passes_under_any_name_spelling():
    assert cl.offenders([("typing_extensions", ["PSF-2.0"]), ("Starlette", ["BSD-3-Clause"])]) == []


def test_unapproved_bsd_package_fails():
    assert cl.offenders([("some-new-dep", ["BSD-3-Clause"])]) == ["some-new-dep: ['BSD-3-Clause']"]


def test_package_with_no_license_metadata_fails():
    assert cl.offenders([("mystery", [])]) == ["mystery: ['(no license metadata)']"]


def test_copyleft_fails_even_if_it_mentions_mit_nowhere():
    assert cl.offenders([("gpl-thing", ["GPL-3.0-only"])]) == ["gpl-thing: ['GPL-3.0-only']"]


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
