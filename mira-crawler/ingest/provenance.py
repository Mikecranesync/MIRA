"""Canonical source-provenance classification for corpus visibility.

**One place decides whether a source may enter the shared corpus.** Every write
path asks this module rather than carrying its own constant, because the
alternative has already produced two defects in this unit alone:

1. `tasks/ingest.py` recognised local files two different ways — a parsed
   `urlparse(url).scheme == "file"` for the download branch and a
   `url.lower().startswith("file://")` string test for the privacy floor. The
   single-slash form `file:/allowed/path/doc.pdf` (an empty authority, which
   RFC 8089 permits) satisfied the first and escaped the second, so a
   caller-supplied `is_private=False` survived to `insert_chunk`.
2. The folder watcher and the equipment-photo script each hardcoded
   `is_private=False` independently of any policy, so a human decision to make
   local sources private had to be applied in three unrelated files.

The rule this module enforces:

    **Every local filesystem source is private.**

Allowed-directory validation (`tasks/ingest.py::_validated_local_path`) answers
"may we *read* this path". It never answers "may every tenant read its
contents", and passing it must never lower a file's privacy classification.

Scope note: this module currently owns the *local vs remote* half of provenance.
The remote half — which curated hosts may reach the shared corpus — still lives
in `tasks/ingest.py::shared_corpus_source_allowed` against `sources.yaml`.
Unifying the two behind one auditable manifest is tracked separately; see the
CU-03 unit record. Do not add a second host list here in the meantime.
"""

from __future__ import annotations

from urllib.parse import urlparse

__all__ = ["is_local_source", "visibility_for_source", "LOCAL_SOURCE_IS_PRIVATE"]

#: The human policy decision this module encodes (owner: @Mikecranesync,
#: 2026-08-18): no folder-watcher file and no locally-ingested equipment photo
#: may be placed in the shared corpus.
LOCAL_SOURCE_IS_PRIVATE = True

#: Schemes that denote a file on local/mounted storage. `""` is included because
#: a bare filesystem path (`/inbox/doc.pdf`, `C:\inbox\doc.pdf`) parses to an
#: empty scheme — the folder watcher and the photo script pass paths, not URLs.
_LOCAL_SCHEMES = frozenset({"file", ""})


def is_local_source(source: str) -> bool:
    """True when ``source`` denotes a local file, by PARSED SCHEME.

    Case-insensitive and slash-count-insensitive by construction: `file:///x`,
    `file:/x`, `FILE://x` and `File:/x` all parse to scheme ``file``. Never
    compare URL prefixes as strings — that is exactly the bypass this replaces.

    A single-letter scheme is treated as local so a Windows drive path
    (`C:\\inbox\\doc.pdf`, which `urlparse` reads as scheme ``c``) cannot be
    mistaken for a network source.
    """
    if not source:
        return True  # no identifiable remote origin -> fail closed
    scheme = urlparse(str(source)).scheme.lower()
    if scheme in _LOCAL_SCHEMES:
        return True
    return len(scheme) == 1  # Windows drive letter


def visibility_for_source(source: str, *, declared_private: bool | None = None) -> bool:
    """Return the ``is_private`` value a write from ``source`` must use.

    ``declared_private`` is the caller's intent, when it has one. It can make a
    row **more** private, never less: a local source returns ``True`` whatever
    the caller asked for. That asymmetry is the point — this is a floor.
    """
    if is_local_source(source):
        return LOCAL_SOURCE_IS_PRIVATE
    if declared_private is None:
        return True  # unknown provenance -> fail closed
    return bool(declared_private)
