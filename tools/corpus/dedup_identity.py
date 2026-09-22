"""What counts as "the same chunk" — a pure function, so it can be tested.

The predecessor partitioned on `md5(content)` scoped by `model_number ILIKE
'%525%'`. Two consequences, both measured:

  * Identical boilerplate in DIFFERENT publications collapsed together — 45 rows
    deleted from the `520-qs001` Quick Start because their text also appears in
    the `520-um001` User Manual. A Quick Start citation would then resolve to the
    User Manual. That is provenance corruption, not deduplication.
  * `'%525%'` is a substring over a free-text column, so it would equally match
    an unrelated model containing "525".

A duplicate is only a duplicate when it is the same TEXT in the same DOCUMENT
from the same MANUFACTURER at the same REVISION. Anything short of that is a
distinct fact about a distinct artefact, even when the bytes agree.

Kept deliberately as a pure function over a row dict: the identity rule is the
part that caused data loss, so it must be unit-testable without a database.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

_NOISE = re.compile(r"\s*\(\d+\)\s*$")
_SCHEME = re.compile(r"^[a-z]+://", re.IGNORECASE)
#: Rockwell-style publication id, e.g. `520-um001` from `520-um001_-en-e.pdf`.
_PUB_RE = re.compile(r"^([0-9]{3,4}-[a-z]{2}\d{3})", re.IGNORECASE)
#: Revision/language suffix, e.g. `-en-e` -> revision token `en-e`.
_REV_RE = re.compile(r"_?-([a-z]{2}-[a-z0-9]+)", re.IGNORECASE)


def canonical_document(source_url: str | None) -> str:
    """Publication identity, collapsing ingest-path variants of ONE document.

    `gdrive://520-um001_-en-e (1).pdf`, `520-um001_-en-e.pdf` and the Rockwell
    literature URL are all publication `520-um001`. A Quick Start (`520-qs001`)
    is NOT — different publication, different document, never deduped together.
    """
    if not source_url:
        return ""
    url = _SCHEME.sub("", str(source_url).strip())
    stem = url.rsplit("/", 1)[-1]
    stem = re.sub(r"\.(pdf|html?|txt|md)$", "", stem, flags=re.IGNORECASE)
    stem = _NOISE.sub("", stem).strip().lower()
    m = _PUB_RE.match(stem)
    return m.group(1).lower() if m else stem


def document_revision(source_url: str | None) -> str:
    """Language/revision token, so two revisions of one publication stay distinct."""
    if not source_url:
        return ""
    stem = _SCHEME.sub("", str(source_url).strip()).rsplit("/", 1)[-1]
    m = _REV_RE.search(stem)
    return m.group(1).lower() if m else ""


def _norm_vendor(v: str | None) -> str:
    return " ".join((v or "").lower().split())


@dataclass(frozen=True)
class DedupKey:
    manufacturer: str
    document: str
    revision: str
    content_sha: str

    def as_tuple(self) -> tuple[str, str, str, str]:
        return (self.manufacturer, self.document, self.revision, self.content_sha)


def dedup_key(row: dict) -> DedupKey:
    """The identity two rows must SHARE before either may be retired.

    Content hash is the last component, not the first: it is necessary and never
    sufficient. Rows lacking a resolvable document identity get a key that cannot
    collide with anything (the row id), so an un-attributable chunk is never
    deduplicated away on text alone.
    """
    doc = canonical_document(row.get("source_url"))
    if not doc:
        return DedupKey(
            _norm_vendor(row.get("manufacturer")),
            f"__unattributed__:{row.get('id')}",
            "",
            "",
        )
    content = row.get("content") or ""
    return DedupKey(
        _norm_vendor(row.get("manufacturer")),
        doc,
        document_revision(row.get("source_url")),
        hashlib.sha256(content.encode("utf-8")).hexdigest(),
    )


def group(rows: list[dict]) -> dict[tuple, list[dict]]:
    out: dict[tuple, list[dict]] = {}
    for r in rows:
        out.setdefault(dedup_key(r).as_tuple(), []).append(r)
    return out


def plan_retirements(rows: list[dict], prefer_url: str | None = None) -> list[dict]:
    """Rows to quarantine: every member of a group beyond the one kept.

    Preference order within a group: the citable ingest if named, then the lowest
    page number (the printed manual's own ordering), then row id for determinism —
    a canonicalizer that picks a different survivor between runs makes every
    citation unfalsifiable.
    """
    retire: list[dict] = []
    for _key, members in group(rows).items():
        if len(members) < 2:
            continue
        ordered = sorted(
            members,
            key=lambda r: (
                0 if (prefer_url and r.get("source_url") == prefer_url) else 1,
                r.get("source_page") if r.get("source_page") is not None else 1 << 30,
                str(r.get("id")),
            ),
        )
        retire.extend(ordered[1:])
    return retire
