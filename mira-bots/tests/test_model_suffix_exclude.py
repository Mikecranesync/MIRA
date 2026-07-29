"""Regression tests for #2914: widen the product-search model-suffix exclusion.

Sub-fix 3 of #2211 (deferred from PR #2913 because it changes retrieval SQL and
needed Neon-dialect verification on staging).

The old exclude was `model_number NOT ILIKE '%{name}0%'` — it only blocked the
single `0` suffix (so "PowerFlex 40" excluded "PowerFlex 400") but let
`401`-`409` and letter-suffixed variants (`40A`, `40P`) bleed into the base
model's results. The fix replaces it with a POSIX word-boundary regex used as
`NOT (model_number ~* :exclude_re)` that matches ANY alphanumeric suffix after
the model name while keeping the standalone base model.

`_model_suffix_exclude_regex` returns the POSIX ERE. Postgres `~*` is
case-insensitive; Python `re.IGNORECASE` mirrors its ASCII class semantics
(`[0-9A-Za-z]` / `[^0-9A-Za-z]`), so these unit assertions track what the SQL
does. The real Neon behaviour (PowerFlex 40 / 400 / 40P rows) was verified on
staging before shipping — see the PR body.
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, "mira-bots")

os.environ.setdefault("NEON_DATABASE_URL", "postgresql://test:test@localhost/test")

from shared.neon_recall import _model_suffix_exclude_regex  # noqa: E402


def _excluded(name: str, candidate: str) -> bool:
    """True if `candidate` would be dropped by `NOT (model_number ~* regex)`."""
    return re.search(_model_suffix_exclude_regex(name), candidate, re.IGNORECASE) is not None


class TestModelSuffixExclude:
    def test_base_model_kept(self):
        # The standalone base model must survive (this is the whole point).
        assert not _excluded("PowerFlex 40", "PowerFlex 40")

    def test_base_model_kept_with_trailing_space(self):
        assert not _excluded("PowerFlex 40", "PowerFlex 40 manual")

    def test_zero_suffix_excluded(self):
        # The one case the old ILIKE pattern already caught.
        assert _excluded("PowerFlex 40", "PowerFlex 400")

    def test_nonzero_digit_suffix_excluded(self):
        # 401-409 — MISSED by the old `%{name}0%` pattern.
        assert _excluded("PowerFlex 40", "PowerFlex 401")
        assert _excluded("PowerFlex 40", "PowerFlex 409")

    def test_letter_suffix_excluded(self):
        # Letter-suffixed variants — MISSED by the old pattern. 40P is real
        # staging data.
        assert _excluded("PowerFlex 40", "PowerFlex 40P")
        assert _excluded("PowerFlex 40", "PowerFlex 40A")

    def test_case_insensitive(self):
        assert _excluded("powerflex 40", "PowerFlex 40P")
        assert not _excluded("POWERFLEX 40", "powerflex 40")

    def test_regex_metacharacters_escaped(self):
        # A model name with regex-special chars must not corrupt the pattern:
        # "4.0" must match literally, not as "4<any char>0".
        assert _excluded("Drive 4.0", "Drive 4.0X")
        assert not _excluded("Drive 4.0", "Drive 4X0")  # '.' is literal, not wildcard
        assert not _excluded("Drive 4.0", "Drive 4.0")  # standalone base kept
