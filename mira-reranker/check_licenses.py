"""Build-time license gate for the mira-reranker image (CU-RR1).

Root CLAUDE.md allows Apache-2.0 or MIT only. Mike approved (2026-10-19) a recorded
exception for exactly the packages in APPROVED_EXCEPTIONS below — the complete audited
tree of this image that is neither MIT nor Apache — and for each one only the licenses
recorded next to it. This script runs as a Dockerfile RUN step after every install, so
the image build FAILS when any installed distribution makes a license statement that is
not acceptable for it.

Fail closed by construction:
- every statement a distribution makes (SPDX expression, each license classifier, and the
  free-text License field when it is a short identifier) must be acceptable;
- SPDX expressions keep their meaning: AND needs every operand, OR needs one;
- an identifier, classifier, or operator this file does not know (a WITH clause, GPL,
  Apache-1.1, ...) is unacceptable, never ignored;
- an approved exception widens the allowed set for THAT package only, by the licenses
  recorded for it — a renamed or relicensed package fails.

Stdlib only. Exit 0 = every package allowed; exit 1 = lists each offender.
"""

from __future__ import annotations

import importlib.metadata as md
import re
import sys

ALWAYS_ALLOWED = frozenset({"MIT", "Apache-2.0"})

# normalized name -> the canonical licenses approved for it (audited with pip-licenses).
APPROVED_EXCEPTIONS: dict[str, frozenset[str]] = {
    "certifi": frozenset({"MPL-2.0"}),
    "click": frozenset({"BSD-3-Clause"}),
    "fsspec": frozenset({"BSD-3-Clause"}),
    "httpcore": frozenset({"BSD-3-Clause", "BSD"}),
    "httpx": frozenset({"BSD-3-Clause", "BSD"}),
    "idna": frozenset({"BSD-3-Clause"}),
    "mpmath": frozenset({"BSD"}),
    "numpy": frozenset({"BSD"}),
    "protobuf": frozenset({"BSD-3-Clause"}),
    "starlette": frozenset({"BSD-3-Clause"}),
    "sympy": frozenset({"BSD"}),
    "tqdm": frozenset({"MPL-2.0"}),
    "typing-extensions": frozenset({"PSF-2.0"}),
    "uvicorn": frozenset({"BSD-3-Clause"}),
}

# Known spellings -> canonical id. "BSD" = BSD-family text that does not say which clause.
_CANONICAL = {
    "mit": "MIT",
    "mit license": "MIT",
    "apache-2.0": "Apache-2.0",
    "apache 2.0": "Apache-2.0",
    "apache software license": "Apache-2.0",
    "bsd-2-clause": "BSD-2-Clause",
    "bsd-3-clause": "BSD-3-Clause",
    "3-clause bsd license": "BSD-3-Clause",
    "bsd": "BSD",
    "bsd license": "BSD",
    "mpl-2.0": "MPL-2.0",
    "mozilla public license 2.0 (mpl 2.0)": "MPL-2.0",
    "psf-2.0": "PSF-2.0",
    "python software foundation license": "PSF-2.0",
}


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def canonical(text: str) -> str | None:
    return _CANONICAL.get(text.strip().lower())


def _tokens(expr: str) -> list[str]:
    return re.findall(r"\(|\)|[^\s()]+", expr)


def acceptable(statement: str, allowed: frozenset[str]) -> bool:
    """True only if the statement, read as one known license or as an SPDX expression
    over known ids, is satisfied by `allowed`. Anything unparseable is False."""
    whole = canonical(statement)
    if whole is not None:
        return whole in allowed
    toks = _tokens(statement)
    pos = 0

    def parse_or() -> bool | None:
        nonlocal pos
        left = parse_and()
        while left is not None and pos < len(toks) and toks[pos].upper() == "OR":
            pos += 1
            right = parse_and()
            left = None if right is None else (left or right)
        return left

    def parse_and() -> bool | None:
        nonlocal pos
        left = parse_atom()
        while left is not None and pos < len(toks) and toks[pos].upper() == "AND":
            pos += 1
            right = parse_atom()
            left = None if right is None else (left and right)
        return left

    def parse_atom() -> bool | None:
        nonlocal pos
        if pos >= len(toks):
            return None
        tok = toks[pos]
        pos += 1
        if tok == "(":
            inner = parse_or()
            if pos >= len(toks) or toks[pos] != ")":
                return None
            pos += 1
            return inner
        cid = canonical(tok)
        return None if cid is None else cid in allowed

    result = parse_or()
    return bool(result) and pos == len(toks)


def statements(meta: md.PackageMetadata) -> list[str]:
    """Every license statement the distribution makes about itself."""
    out = []
    if meta.get("License-Expression"):
        out.append(meta["License-Expression"])
    out += [
        c.split(" :: ")[-1]
        for c in (meta.get_all("Classifier") or [])
        if c.startswith("License ::")
    ]
    lines = (meta.get("License") or "").strip().splitlines()
    first = lines[0].strip() if lines else ""
    # The free-text field often holds a copyright line or the whole license text; that is
    # skipped only when other statements exist. Any short field that is not a copyright line
    # is a statement and must pass (so a field saying GPL-3.0 can never be ignored).
    if first and (not out or (len(first) <= 60 and not first.lower().startswith("copyright"))):
        out.append(first)
    return out


def offenders(dists: list[tuple[str, list[str]]]) -> list[str]:
    bad = []
    for name, stmts in dists:
        allowed = ALWAYS_ALLOWED | APPROVED_EXCEPTIONS.get(normalize(name), frozenset())
        if not stmts:
            bad.append(f"{name}: (no license metadata)")
            continue
        rejected = [s for s in stmts if not acceptable(s, allowed)]
        if rejected:
            bad.append(f"{name}: {rejected}")
    return sorted(bad)


def main() -> int:
    dists = [(d.metadata["Name"], statements(d.metadata)) for d in md.distributions()]
    bad = offenders(dists)
    if bad:
        print(
            "license gate FAILED — not MIT/Apache and not an approved exception:", file=sys.stderr
        )
        for line in bad:
            print(f"  {line}", file=sys.stderr)
        return 1
    n_ok, n_exc = len(dists), len(APPROVED_EXCEPTIONS)
    print(f"license gate: {n_ok} distributions OK ({n_exc} approved exceptions)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
