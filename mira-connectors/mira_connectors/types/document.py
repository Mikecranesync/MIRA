"""Document / manual connector type base.

Extends the existing ``mira-crawler/ingest/`` pipeline conceptually: a document
connector discovers a manual/drawing/datasheet store (a folder, a SharePoint library,
an OEM portal), imports document metadata, and normalizes into ``CanonicalDocument``
rows. The heavy lifting — chunk → embed → dedup → store → kg_writer side-effect — stays
in ``mira-crawler/ingest/`` (this connector hands off ``CanonicalDocument`` records and
does not re-implement the tuned chunker/embedder/dedup).

Write-back ("export enriched records") for a document store means writing back derived
metadata (extracted UNS path, asset link, extracted fault codes) — never mutating the
source PDFs. It is gated by mode like CMMS; default read-only.
"""

from __future__ import annotations

from mira_connectors.base import BaseConnector, ConnectorKind
from mira_connectors.canonical import RecordType

DOCUMENT_RECORD_TYPES = [RecordType.DOCUMENT]


class DocumentConnector(BaseConnector):
    """Base for document/manual connectors. Hands canonical docs to mira-crawler ingest."""

    kind = ConnectorKind.DOCUMENT
