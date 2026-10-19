"""Build-time license gate for the mira-reranker image (CU-RR1).

Root CLAUDE.md allows Apache-2.0 or MIT only. Mike approved (2026-10-19) a recorded
exception for exactly the packages in APPROVED_EXCEPTIONS below — the complete audited
tree of this image that is neither MIT nor Apache. This script runs as a Dockerfile RUN
step after every install, so the image build FAILS if any installed distribution is
neither MIT/Apache by its own metadata nor on that list. A new transitive dependency
therefore cannot ship silently; adding one needs a new owner approval and an edit here.

Stdlib only. Exit 0 = every package allowed; exit 1 = lists each offender.
"""

from __future__ import annotations

import importlib.metadata as md
import re
import sys

# name (normalized) -> license, as audited with pip-licenses in the built image.
APPROVED_EXCEPTIONS: dict[str, str] = {
    "certifi": "MPL-2.0",
    "click": "BSD-3-Clause",
    "fsspec": "BSD-3-Clause",
    "httpcore": "BSD-3-Clause",
    "httpx": "BSD-3-Clause",
    "idna": "BSD-3-Clause",
    "mpmath": "BSD-3-Clause",
    "numpy": "BSD-3-Clause",
    "protobuf": "BSD-3-Clause",
    "starlette": "BSD-3-Clause",
    "sympy": "BSD-3-Clause",
    "tqdm": "MPL-2.0 AND MIT",
    "typing-extensions": "PSF-2.0",
    "uvicorn": "BSD-3-Clause",
}

_ALLOWED = re.compile(r"\b(MIT|Apache)\b", re.IGNORECASE)


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def license_strings(meta: md.PackageMetadata) -> list[str]:
    """Every license statement the distribution makes about itself."""
    out = [meta.get("License-Expression") or ""]
    first_line = (meta.get("License") or "").strip().splitlines()
    out.append(first_line[0] if first_line else "")
    out += [c for c in (meta.get_all("Classifier") or []) if c.startswith("License ::")]
    return [s for s in out if s]


def offenders(dists: list[tuple[str, list[str]]]) -> list[str]:
    bad = []
    for name, licenses in dists:
        if normalize(name) in APPROVED_EXCEPTIONS:
            continue
        if any(_ALLOWED.search(s) for s in licenses):
            continue
        bad.append(f"{name}: {licenses or ['(no license metadata)']}")
    return sorted(bad)


def main() -> int:
    dists = [(d.metadata["Name"], license_strings(d.metadata)) for d in md.distributions()]
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
