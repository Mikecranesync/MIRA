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

import re
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


# Query-parameter NAMES that carry a credential (round AD on #3481, round-27
# scope C F1 SUSTAINED). Matched on the percent-decoded name, NFKC-normalised,
# lower-cased, with EVERY non-alphanumeric character removed (round AL on
# #3481: a U+2011 hyphen, a full-width underscore, a full-width letter or a
# stray `&` inside the name all fold to the same key — refusing more is the
# fail-closed direction) — so `api_key`, `Api-Key`, `api%5Fkey`, `api‑key` and
# `X-Amz-Signature` all match; values are never inspected (a value that merely
# contains the word "token" is an ordinary query), and a longer name such as
# `tokenizer` is not the family.
_CREDENTIAL_QUERY_NAMES = frozenset(
    {
        "token",
        "accesstoken",
        "idtoken",
        "refreshtoken",
        "authtoken",
        "sessiontoken",
        "clienttoken",
        "oauthtoken",
        "bearer",
        "jwt",
        "sessionid",
        "apikey",
        "accesskey",
        "secretkey",
        "privatekey",
        "apisecret",
        "auth",
        "authorization",
        "password",
        "passwd",
        "secret",
        "clientsecret",
        "signature",
        "sig",
        "credential",
        "xamzsignature",
        "xamzcredential",
        "xgoogsignature",
        "xgoogcredential",
    }
)
_QUERY_NAME_NOISE_RE = re.compile(r"[^0-9a-z]")


def _fold_query_name(raw: str) -> str:
    """The comparison key of a query-parameter name: percent-decoded, NFKC,
    lower-cased, every non-alphanumeric character removed. Pure."""
    from unicodedata import normalize
    from urllib.parse import unquote

    return _QUERY_NAME_NOISE_RE.sub("", normalize("NFKC", unquote(raw)).lower())


def _credential_query_name(url: str) -> "str | None":
    """The first credential-family query-parameter NAME in ``url``, or None.

    The query is NFKC-normalised BEFORE it is split (round AM on #3481), so a
    full-width ``＆`` (U+FF06) or ``；`` (U+FF1B) is a pair separator too —
    refusing more is the fail-closed direction; values are still never read.
    """
    from unicodedata import normalize

    query = normalize("NFKC", str(url).strip().partition("?")[2].partition("#")[0])
    for pair in re.split(r"[&;]", query):
        if not pair:
            continue
        name = _fold_query_name(pair.split("=", 1)[0])
        if name in _CREDENTIAL_QUERY_NAMES:
            return name
    return None


def url_credential_reason(url: str) -> "str | None":
    """Why ``url`` must be refused as credential-bearing, or None.

    The ONE boundary rule every gate and store route consults before identity,
    log or SQL: userinfo in the authority of any ``scheme://authority`` form, or
    a credential-family query-parameter name. The reason names the class (and,
    for a query, the normalised parameter NAME) — never a value.
    """
    if url_has_userinfo(url):
        return "userinfo (credentials in the authority)"
    name = _credential_query_name(url)
    if name:
        return f"a credential-like query parameter ({name})"
    return None


def _credential_refused(reason: str) -> str:
    return (
        f"URL carries {reason} — refused; an authenticated source uses out-of-band "
        "secret-backed request headers, never a credential in the URL"
    )


_URL_SCHEME_RE = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*")


def url_has_userinfo(url: str) -> bool:
    """True when a ``scheme://authority`` URL of ANY scheme carries userinfo
    (``user:pass@host``, ``user@host``) in its authority.

    Pure, string-based on the same authority slice ``canonical_source_url`` uses
    (everything between ``//`` and the first ``/``, ``?`` or ``#``), so an ``@``
    in a path, query or fragment is not userinfo, and a value without a
    ``scheme://`` authority form (bare path, drive letter, ``mailto:``,
    ``file:/x``) is not a candidate. Every syntactically valid scheme counts —
    ``ftp``, ``s3``, a custom scheme, upper-case spellings, ``file://user@host`` —
    because the policy is any URL userinfo, not http/https only (round AB on
    #3481: the http/https-only first version let a direct store call persist
    ``ftp://user:pass@host``). Case- and padding-insensitive. Such a URL is
    refused at the hop-0 gate and at the store boundary: a credential is never
    stripped into another identity, never bound into SQL, never persisted, never
    logged.

    A **network-path reference** — ``//authority/path`` with no scheme (RFC 3986
    §4.2) — has an authority too, and its userinfo is userinfo (round AH on
    #3481, round-31 S2 F1): it parses to scheme ``""``, which the visibility
    floor classifies as *local*, so without this rule ``//user:pass@host/x``
    would be written tenant-private with the credential in ``source_url``. An
    opaque ``scheme:path`` value with an ``@`` (``mailto:a@b``,
    ``user:secret@host/path``) has no authority and stays a non-candidate —
    the two forms are syntactically indistinguishable, no crawler route
    produces the latter, and the hop-0 gate admits only http/https/file.
    """
    s = str(url).strip()
    if s.startswith("//"):
        authority = s[2:]  # network-path reference: an authority with no scheme
    else:
        head, sep, rest = s.partition(":")
        if not sep or not _URL_SCHEME_RE.fullmatch(head) or not rest.startswith("//"):
            return False
        authority = rest[2:]
    for stop in "/?#":
        idx = authority.find(stop)
        if idx != -1:
            authority = authority[:idx]
    return "@" in authority


def shared_corpus_allowed(url: str, *, policy: "dict | None" = None) -> tuple[bool, str]:
    """May this URL be written to the shared corpus? Fail-closed."""
    refusal = url_credential_reason(url)
    if refusal:
        return (False, _credential_refused(refusal))
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
    refusal = url_credential_reason(source_url)
    if refusal:  # before classification: a credential-bearing URL is never a document
        return (False, True, _credential_refused(refusal))
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
