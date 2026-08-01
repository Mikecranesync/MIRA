"""URI redaction for durable evidence (rule 3 / PRD §21 — evidence carries no secrets).

A manifest is **durable**: ``FileRegistry`` serializes every field verbatim into a
JSON snapshot that outlives the process, and a Neon backend will outlive far more.
So a fetch URL persisted verbatim persists whatever the fetch URL carried — and in
this codebase a fetch URL is routinely a *credential*:

- a presigned S3/GCS link (``?X-Amz-Signature=…``, ``?X-Goog-Signature=…``);
- an OEM portal download with a session token (``?token=…``, ``?auth=…``);
- ``https://user:password@host/…`` userinfo from a mirrored feed.

None of that is provenance. The part of a URL that identifies *where a document
came from* is scheme + host + path; the query string and fragment are how the
fetch was *authorized*, and the userinfo is a raw credential. Byte identity —
``content_sha256`` — is what actually identifies the document, and it is already
the recall key (``source_hashes`` / ``dataset_id``).

Therefore every URI that reaches a durable evidence field is redacted to its
origin+path form. This is enforced in two places on purpose:

1. **at the producer boundary** — ``document_compiler`` redacts before it builds a
   manifest, so a caller cannot leak by passing a raw URL;
2. **at the validator** — ``schema.validate_manifest`` rejects an unredacted
   network URI, and ``InMemoryRegistry.register`` runs the validator on every
   write, so *any* producer (present or future) hits the same floor.

Scope is deliberately narrow. Only **network-fetch schemes** are redacted; the
contract's own opaque locators must pass through byte-identical, because they use
``#`` structurally and their identity feeds ``content_hash``:

    knowledge_entries:sha256:ab…#records=7      (index_ref)
    sha256:ab…#page=12                          (record source_locator)
    cas://printsense/ab…                        (printsense storage_ref)

Stdlib only. No I/O.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit

# Schemes whose URIs are *fetched over a network* and can therefore carry
# credentials. Deliberately an allowlist: an unknown scheme is left alone rather
# than mangled, because the contract's opaque locators are unknown schemes.
NETWORK_SCHEMES = frozenset(
    {"http", "https", "ftp", "ftps", "sftp", "s3", "gs", "gcs", "azure", "abfs", "abfss", "webdav"}
)


def _network_uri_spans(value: str) -> list[str]:
    """Every substring of ``value`` that starts a network-scheme URI.

    Scans for an embedded ``<scheme>://`` rather than only parsing ``value`` as a
    whole, because the real leak in this repo was **composite**:
    ``knowledge_entries:https://host/m.pdf?token=abc#records=7``. ``urlsplit`` reads
    that string's scheme as ``knowledge_entries`` — not a network scheme — so a
    whole-value parse says "clean" while a live token sits in the middle of it.
    """
    spans: list[str] = []
    for i in range(len(value)):
        if not value.startswith("://", i):
            continue
        j = i
        while j > 0 and (value[j - 1].isalnum() or value[j - 1] in "+-."):
            j -= 1
        if value[j:i].lower() in NETWORK_SCHEMES:
            spans.append(value[j:])
    return spans


def is_network_uri(value: str) -> bool:
    """True when the WHOLE of ``value`` is a URI in a credential-carrying scheme.

    Position-0 only: ``redact_uri`` rewrites a value wholesale, and rewriting a URI
    embedded in a larger composite locator would silently corrupt that locator's
    structure. An embedded URI is caught by ``uri_leaks_credentials`` and rejected
    at the validator instead — a composite locator should carry a content hash,
    not a URL.
    """
    if not value or "://" not in value:
        # Require an authority separator: `knowledge_entries:sha256:…` and
        # `sha256:…#page=1` are opaque locators, not network URIs.
        return False
    try:
        return urlsplit(value).scheme.lower() in NETWORK_SCHEMES
    except ValueError:
        return False


def redact_uri(value: str) -> str:
    """Strip credentials from a network URI; return anything else unchanged.

    Removes, in order: userinfo (``user:pass@``), the query string, and the
    fragment. Scheme, host, port, and path survive — that is the provenance.

    >>> redact_uri("https://u:p@cdn.example.com/a/m.pdf?token=abc#p=2")
    'https://cdn.example.com/a/m.pdf'
    >>> redact_uri("knowledge_entries:sha256:deadbeef#records=7")
    'knowledge_entries:sha256:deadbeef#records=7'

    A redacted URI is **not** marked as truncated: appending a marker would make
    the value differ from the same document fetched by a clean URL, splitting one
    dataset into two versions for no provenance gain. What was stripped is not
    recoverable from the manifest by design — that is the point.
    """
    if not is_network_uri(value):
        return value
    parts = urlsplit(value)
    netloc = parts.netloc
    if "@" in netloc:  # drop userinfo, keep host[:port]
        netloc = netloc.rsplit("@", 1)[1]
    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def uri_leaks_credentials(value: str) -> bool:
    """True when ``value`` contains a network URI still carrying userinfo/query/fragment.

    The validator's predicate. It must accept exactly what ``redact_uri`` emits, so
    ``uri_leaks_credentials(redact_uri(x))`` is always False for a whole-value URI.

    It also fires on a URI **embedded** in a composite locator, which necessarily
    means it fires on an embedded URI whose own ``#fragment`` is really the
    composite's suffix. That is intended, not a false positive: a composite locator
    must be built from a content hash (``knowledge_entries:sha256:…#records=7``),
    never from a fetch URL, so there is nothing legitimate to embed.
    """
    if not value:
        return False
    for span in _network_uri_spans(value):
        parts = urlsplit(span)
        if parts.query or parts.fragment or "@" in parts.netloc:
            return True
    return False


def redact_uris(values: list[str] | tuple[str, ...]) -> list[str]:
    """``redact_uri`` over a sequence, preserving order and duplicates-after-redaction.

    Two URLs that differ only in their query redact to the same string; the
    duplicate is dropped, because a manifest listing one origin twice is noise,
    and ``source_objects`` feeds the version key (a stable, deduplicated list is
    what makes the same bytes from the same origin one version).
    """
    out: list[str] = []
    for v in values:
        r = redact_uri(v)
        if r not in out:
            out.append(r)
    return out


# A network URI embedded in free text. Stops at whitespace and at the delimiters
# that normally *wrap* a URL in a message — quotes, brackets, angle brackets — so a
# quoted or parenthesized URL is still found. Trailing sentence punctuation is
# trimmed separately (it belongs to the prose, not the path).
_URI_IN_TEXT = re.compile(
    r"(?:" + "|".join(sorted(NETWORK_SCHEMES, key=len, reverse=True)) + r")://[^\s'\"<>`]+",
    re.IGNORECASE,
)
_TRAILING_PROSE = ".,;:!?)]}"


def scrub_text_uris(text: str) -> str:
    """Redact every network URI found inside a free-text string.

    For prose that is itself persisted — an exception message copied into the repair
    journal, a status line the cron stamps onto its queue. Splitting on spaces is
    **not** sufficient: a URL is routinely wrapped in quotes (``cannot open
    'https://…?token=…'``) or trailed by a comma, and those tokens do not parse as a
    URI, so a naive per-token pass returns them untouched — i.e. leaks.

    >>> scrub_text_uris("cannot open 'https://h/m.pdf?token=abc'")
    "cannot open 'https://h/m.pdf'"
    """
    if not text:
        return text

    def _sub(match: re.Match[str]) -> str:
        raw = match.group(0)
        trailing = ""
        while raw and raw[-1] in _TRAILING_PROSE:
            trailing = raw[-1] + trailing
            raw = raw[:-1]
        return redact_uri(raw) + trailing

    return _URI_IN_TEXT.sub(_sub, text)
