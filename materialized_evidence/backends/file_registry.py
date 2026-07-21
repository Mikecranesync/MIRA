"""Durable JSON-snapshot registry (PR G) — first concrete MaterializationRegistry backend.

Reuses the tested ``InMemoryRegistry`` query logic verbatim (find / get /
effective_stale_state / downstream_of / lineage / cost_summary) and adds exactly
one thing: durability. It hydrates from a JSON snapshot on construction and
atomically rewrites the snapshot after every successful write (``register`` /
``mark_stale``), so recall survives a process exit — the whole reason for wiring
recall into a CLI.

Single-writer: the snapshot is rewritten whole, so concurrent writers would race.
Acceptable for the print path (serial; photo-batch concurrency=1); the
concurrent-safe backend is Neon (a later PR). Atomic tmp+replace mirrors
``printsense/cas.py``'s write idiom. Nothing here logs payload bytes.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from ..registry import InMemoryRegistry, StatusOverlay
from ..schema import EvidenceManifest
from .serialization import manifest_from_dict, overlay_from_dict, overlay_to_dict


class FileRegistry(InMemoryRegistry):
    """An ``InMemoryRegistry`` that persists to / hydrates from a JSON snapshot."""

    def __init__(self, snapshot_path: str | Path) -> None:
        super().__init__()
        self._snapshot_path = Path(snapshot_path)
        self._load()

    # -- persistence -----------------------------------------------------------

    def _load(self) -> None:
        if not self._snapshot_path.exists():
            return
        data = json.loads(self._snapshot_path.read_text("utf-8"))
        for md in data.get("manifests", []):
            m = manifest_from_dict(md)
            self._manifests[m.dataset_version_id] = m
        for dvid, overlays in data.get("overlays", {}).items():
            self._overlays[dvid] = [overlay_from_dict(o) for o in overlays]

    def _persist(self) -> None:
        data = {
            "manifests": [m.to_dict() for m in self._manifests.values()],
            "overlays": {
                dvid: [overlay_to_dict(o) for o in ovs] for dvid, ovs in self._overlays.items()
            },
        }
        self._snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._snapshot_path.with_suffix(self._snapshot_path.suffix + ".tmp")
        payload = json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")
        with open(tmp, "wb") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())  # durable before the atomic replace (survive a crash between the two)
        os.replace(tmp, self._snapshot_path)

    # -- writes (persist only after the in-memory mutation succeeds) -----------

    def register(self, manifest: EvidenceManifest) -> None:
        super().register(manifest)  # validates + enforces immutability; may raise
        self._persist()

    def mark_stale(
        self,
        dataset_version_id: str,
        reasons: list[str],
        *,
        tenant_id: str,
        at: str | None = None,
        trigger: str | None = None,
        origin_dataset_version_id: str | None = None,
        via_parent: str | None = None,
        propagation: str = "direct",
    ) -> StatusOverlay:
        overlay = super().mark_stale(
            dataset_version_id,
            reasons,
            tenant_id=tenant_id,
            at=at,
            trigger=trigger,
            origin_dataset_version_id=origin_dataset_version_id,
            via_parent=via_parent,
            propagation=propagation,
        )
        self._persist()
        return overlay
