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
The remote half — which origins may reach the shared corpus — is the canonical
`provenance_policy.yaml`, loaded by `load_policy` below and consulted by
`tasks/ingest.py::shared_corpus_source_allowed`. The duplicate `sources.yaml`
host loader that used to live there is gone, so the ingest gate has one truth.

That covers CLASSIFICATION, not ACQUISITION: the feeder manifests still author
which URLs get fetched (see the policy file's header). Do not add a second
origin list here.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

__all__ = [
    "is_local_source",
    "visibility_for_source",
    "LOCAL_SOURCE_IS_PRIVATE",
    "load_policy",
    "classify_origin",
    "shared_corpus_allowed",
    "enforce_visibility",
    "POLICY_PATH",
]

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


# ── Canonical origin policy (CU-03a / Gate 6) ───────────────────────────────
#
# The remote half of provenance. `sources.yaml` used to be consulted directly by
# the curation gate while four-plus feeder manifests kept their own origin lists;
# structural discovery found 17 manifests and 38 origins, 31 absent from the
# gate. `provenance_policy.yaml` is now the single answer, and
# `tests/test_provenance_policy.py` fails if any configured origin lacks an entry.

_POLICY: dict | None = None
POLICY_PATH = Path(__file__).resolve().parents[1] / "provenance_policy.yaml"

#: Classifications that permit a shared-corpus write. Deliberately a whitelist —
#: an unknown or malformed classification must not read as permission.
_SHARED_OK = frozenset({"curated"})


def load_policy(path: "Path | None" = None) -> dict:
    """Load and cache the canonical origin policy. Raises if unreadable.

    Failing loud is the point: a missing or malformed policy must not silently
    degrade into "allow everything" (or into "allow nothing", which would look
    like an outage and get worked around).
    """
    global _POLICY  # noqa: PLW0603
    if _POLICY is not None and path is None:
        return _POLICY
    import yaml

    target = path or POLICY_PATH
    data = yaml.safe_load(target.read_text(encoding="utf-8")) or {}
    origins = data.get("origins")
    if not isinstance(origins, dict) or not origins:
        raise RuntimeError(f"provenance policy at {target} has no origins — refusing to guess")
    if path is None:
        _POLICY = data
    return data


def classify_origin(url: str, *, policy: "dict | None" = None) -> tuple[str, str]:
    """Return ``(classification, reason)`` for a URL's origin.

    An origin with no entry is ``unclassified`` — treated as refusal by
    `shared_corpus_allowed`, never as permission. That is what makes the
    consistency test meaningful: an unclassified origin fails closed in
    production as well as in CI.
    """
    if is_local_source(url):
        return ("local", "local filesystem source — always private")
    host = (urlparse(str(url)).hostname or "").lower()
    if not host:
        return ("unclassified", "no resolvable host")
    entries = (policy or load_policy()).get("origins", {})
    entry = entries.get(host)
    if entry:
        return (str(entry.get("classification", "unclassified")), str(entry.get("reason", "")))

    # A subdomain INHERITS its parent origin's classification. The gate this
    # replaced matched subdomains, and dropping that would have silently
    # refused e.g. `literature.rockwellautomation.com` under a curated
    # `rockwellautomation.com` — caught by an existing test, kept deliberately.
    #
    # Inheritance runs in BOTH directions: a subdomain of a `blocked` origin is
    # blocked too, so classifying an aggregator does not leave its CDN open.
    # The match is anchored on a dot boundary, so `evil-manualslib.com` cannot
    # inherit from `manualslib.com`; and the LONGEST parent wins, so a specific
    # entry always beats a broader one.
    best = None
    for parent in entries:
        if host.endswith("." + parent) and (best is None or len(parent) > len(best)):
            best = parent
    if best:
        e = entries[best]
        return (
            str(e.get("classification", "unclassified")),
            f"subdomain of {best}: {e.get('reason', '')}",
        )
    return ("unclassified", f"origin {host!r} has no entry in the canonical provenance policy")


_USERINFO_REFUSED = (
    "URL carries userinfo (credentials in the authority) — refused; an authenticated "
    "source uses out-of-band secret-backed request headers, never URL userinfo"
)


def url_has_userinfo(url: str) -> bool:
    """True when an http/https URL's authority carries userinfo (``user:pass@host``).

    Pure, string-based on the same authority slice ``canonical_source_url`` uses
    (everything between ``//`` and the first ``/``, ``?`` or ``#``), so an ``@``
    in a path, query or fragment is not userinfo. Case- and padding-insensitive
    on the scheme. Such a URL is refused at the hop-0 gate and at the store
    boundary (Gate 7 round Z on #3481): a credential is never stripped into
    another identity, never bound into SQL, never persisted, never logged.
    """
    s = str(url).strip()
    head, sep, rest = s.partition(":")
    if not sep or head.lower() not in ("http", "https") or not rest.startswith("//"):
        return False
    authority = rest[2:]
    for stop in "/?#":
        idx = authority.find(stop)
        if idx != -1:
            authority = authority[:idx]
    return "@" in authority


def shared_corpus_allowed(url: str, *, policy: "dict | None" = None) -> tuple[bool, str]:
    """May this URL be written to the shared corpus? Fail-closed."""
    if url_has_userinfo(url):
        return (False, _USERINFO_REFUSED)
    cls, reason = classify_origin(url, policy=policy)
    if cls in _SHARED_OK:
        return (True, reason)
    return (False, f"{cls}: {reason}")


def enforce_visibility(source_url: str, declared_private: bool) -> tuple[bool, bool, str]:
    """The write-boundary enforcement point. Returns ``(allowed, is_private, reason)``.

    **Every** storage route calls this, not just `tasks/ingest.py`. Gate 9 round 1
    found why that matters: the policy classified Reddit, patents and YouTube as
    private and ManualsLib as blocked, while four writers published those exact
    sources to the shared corpus with a hardcoded ``is_private=False``. A policy
    enforced at one door is a policy that documents an intention, which is worse
    than none because it reads as protection.

    Fixing the four callers would not have been the fix — the fifth writer would
    reintroduce it. Enforcement belongs at the boundary they all pass through.

    The decision, fail-closed at every step:

    ==================  ==========================================================
    classification      outcome
    ==================  ==========================================================
    ``blocked``         **refused** — the row is not written at all
    ``infrastructure``  **refused** — an API endpoint is not a document
    ``private``         written, **forced tenant-scoped**
    ``local``           written, **forced tenant-scoped** (the local-file floor)
    ``unclassified``    written, **forced tenant-scoped** — an origin nobody has
                        classified may be ingested but must never be shared. This
                        is what closes the arbitrary-crawl door: a depth-2 Apify
                        crawl returning an off-domain URL cannot publish it.
    ``curated``         the caller's declaration stands
    ==================  ==========================================================

    Note the asymmetry: this can make a row **more** private than the caller
    asked, never less, and it can refuse — it can never grant sharing that the
    caller did not request.
    """
    if url_has_userinfo(source_url):
        return (False, True, _USERINFO_REFUSED)  # before classification: never a document
    try:
        cls, reason = classify_origin(source_url)
    except Exception as exc:  # unreadable policy -> refuse, never publish
        return (False, True, f"provenance policy unreadable ({exc}) — refusing the write")

    if cls in ("blocked", "infrastructure"):
        return (False, True, f"{cls}: {reason}")
    if cls == "curated":
        return (True, bool(declared_private), reason)
    # private / local / unclassified -> ingest, but never shared
    return (True, True, f"{cls}: {reason}")
