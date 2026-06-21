"""Approval registry — the human-approval source of truth (pillar 5: Governance).

A deliberately boring, JSON-backed placeholder approval model. It answers four
questions the governance gates need:

- Is this **asset** approved for answering?
- Is this **document** approved, and what is its version / last-updated time?
- Have the document's **embeddings** been refreshed since it was last updated?
  (If not → stale-context incident.)
- Is an asset→document **mapping** approved, or only proposed?

It is a *placeholder* by design: the goal says "if approval data exists, use it;
if not, add a minimal placeholder that can be expanded later." Two real approval
systems already exist and SHOULD supersede this when wired to live data:

- ``simlab.approval.ApprovalStore`` — asset-agent lifecycle (draft→…→approved),
  SQLite, mirrors Hub migrations 046/047. Use ``asset_agent_approved()`` to read
  it when a store is supplied.
- Hub ``ai_suggestions`` / ``relationship_proposals`` — KG mapping approval.

The JSON file shape (see ``approvals.example.json``)::

    {
      "approved_assets": ["enterprise.plant1.packaging.line2.conv_belt_01", …],
      "documents": {
        "troubleshooting.md": {
          "approved": true,
          "version": "3",
          "updated_at": "2026-05-01T00:00:00Z",
          "embeddings_refreshed_at": "2026-05-02T00:00:00Z"
        }, …
      },
      "approved_mappings": [
        {"asset": "…conv_belt_01", "document": "troubleshooting.md"}
      ]
    }

Everything here is read-only. Nothing in this module ever auto-approves.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        # Accept trailing 'Z'.
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@dataclass
class DocumentApproval:
    """Approval + freshness metadata for one document."""

    name: str
    approved: bool = False
    version: Optional[str] = None
    updated_at: Optional[str] = None
    embeddings_refreshed_at: Optional[str] = None

    def is_stale(self, *, max_age_days: Optional[float] = None) -> bool:
        """True if the document changed after its embeddings were last refreshed.

        This is the "policy/manual updated but embeddings not refreshed" incident:
        retrieval would serve vectors that predate the current document text.
        ``max_age_days`` optionally also flags documents whose embeddings are
        simply old, independent of an update.
        """
        updated = _parse_iso(self.updated_at)
        refreshed = _parse_iso(self.embeddings_refreshed_at)
        if updated is not None:
            if refreshed is None or refreshed < updated:
                return True
        if max_age_days is not None and refreshed is not None:
            age = (datetime.now(timezone.utc) - refreshed).total_seconds() / 86400.0
            if age > max_age_days:
                return True
        return False


@dataclass
class ApprovalRegistry:
    """In-memory view of the approval JSON. Construct via ``load`` / ``from_dict``."""

    approved_assets: set[str] = field(default_factory=set)
    documents: dict[str, DocumentApproval] = field(default_factory=dict)
    approved_mappings: set[tuple[str, str]] = field(default_factory=set)
    # Optional live asset-agent store (simlab.approval.ApprovalStore or compatible)
    _agent_store: Any = None

    # -- construction ------------------------------------------------------

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ApprovalRegistry":
        docs: dict[str, DocumentApproval] = {}
        for name, meta in (data.get("documents") or {}).items():
            meta = meta or {}
            docs[name] = DocumentApproval(
                name=name,
                approved=bool(meta.get("approved", False)),
                version=str(meta["version"]) if meta.get("version") is not None else None,
                updated_at=meta.get("updated_at"),
                embeddings_refreshed_at=meta.get("embeddings_refreshed_at"),
            )
        mappings = {
            (m["asset"], m["document"])
            for m in (data.get("approved_mappings") or [])
            if m.get("asset") and m.get("document")
        }
        return cls(
            approved_assets=set(data.get("approved_assets") or []),
            documents=docs,
            approved_mappings=mappings,
        )

    @classmethod
    def load(cls, path: str | Path) -> "ApprovalRegistry":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls.from_dict(data)

    @classmethod
    def empty(cls) -> "ApprovalRegistry":
        """A registry that approves nothing — every answer trips governance.

        The honest default when no approval data is supplied: govern-closed, not
        govern-open. Tests and the eval pack supply a real registry.
        """
        return cls()

    def with_agent_store(self, store: Any) -> "ApprovalRegistry":
        """Attach a live ``ApprovalStore`` for asset-agent lifecycle reads."""
        self._agent_store = store
        return self

    # -- queries (read-only) ----------------------------------------------

    def asset_approved(self, asset: Optional[str]) -> bool:
        """True if the asset (id or UNS path) is approved.

        Prefers the live asset-agent store when attached (state == 'approved'),
        else falls back to the JSON ``approved_assets`` list. Matches either the
        bare asset id or its full UNS path so callers can pass either.
        """
        if not asset:
            return False
        if self._agent_store is not None:
            try:
                if self._agent_store.agent_state(asset) == "approved":
                    return True
            except Exception:  # noqa: BLE001 — store optional / shape may differ
                pass
        if asset in self.approved_assets:
            return True
        # tolerate id-vs-path mismatch: approve if any approved path ends with the id
        return any(p == asset or p.endswith("." + asset) for p in self.approved_assets)

    def document(self, name: Optional[str]) -> Optional[DocumentApproval]:
        if not name:
            return None
        if name in self.documents:
            return self.documents[name]
        # tolerate path-vs-basename
        base = name.split("/")[-1].split("\\")[-1]
        return self.documents.get(base)

    def document_approved(self, name: Optional[str]) -> bool:
        doc = self.document(name)
        return bool(doc and doc.approved)

    def mapping_status(self, asset: Optional[str], document: Optional[str]) -> str:
        """Return 'approved' | 'proposed' for an asset→document mapping.

        Anything not in ``approved_mappings`` is treated as 'proposed' (the safe
        default — an unverified mapping is never silently trusted).
        """
        if not asset or not document:
            return "proposed"
        if (asset, document) in self.approved_mappings:
            return "approved"
        base = document.split("/")[-1].split("\\")[-1]
        if (asset, base) in self.approved_mappings:
            return "approved"
        # tolerate id-vs-path on the asset side
        for a, d in self.approved_mappings:
            if (a == asset or asset.endswith("." + a) or a.endswith("." + asset)) and d in (
                document,
                base,
            ):
                return "approved"
        return "proposed"
