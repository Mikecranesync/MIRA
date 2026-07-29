"""Materialization Registry (PR D) — locate evidence by source + dependency versions.

Answers the PRD §8 questions: what evidence datasets exist, which sources/versions
produced them, which tenant/assets they belong to, which are valid/stale/trusted,
which downstream datasets depend on them, and how much they cost.

What it does NOT do (PRD §8): it does not duplicate FactoryLM asset identity,
document storage, KG approval state, the Capability Pack registry, Temporal
history, or ``WorkflowRun`` — it REFERENCES those via the manifest's ``*_ref``
fields. It has **no approval mutation** — approval lives in the canonical systems;
the registry only records the ``approval_status``/``approval_refs`` the manifest
carries.

Vendor-neutral (ADR A6): ``MaterializationRegistry`` is the seam; ``InMemoryRegistry``
is the reference implementation used by tests and the recall resolver (PR E). A
persistent Neon/object-store backend is a later concrete PR that implements the
same protocol.

ADR A3 (immutable versions, mutable status overlays): a registered manifest is
immutable by ``dataset_version_id`` (re-registering a *different* manifest for the
same version is rejected); trust/stale transitions are recorded as append-only
``StatusOverlay`` records, never by mutating the stored manifest.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from .schema import (
    DatasetType,
    EvidenceManifest,
    StaleState,
    TrustStatus,
    validate_manifest,
)


class RegistryError(Exception):
    """A contract violation on a registry write (invalid/unhashed/immutable-conflict)."""


@dataclass(frozen=True)
class StatusOverlay:
    """An append-only status transition for a dataset version (ADR A3). Payload and
    the base manifest are never mutated; the effective status is the latest overlay."""

    dataset_version_id: str
    stale_state: StaleState
    stale_reasons: list[str] = field(default_factory=list)
    at: str | None = None  # RFC3339; caller stamps (no Date.now here)
    actor: str | None = None
    # invalidation provenance (PR F) — enough to reconstruct why this went stale
    trigger: str | None = None  # the originating invalidation cause
    origin_dataset_version_id: str | None = None  # the directly-invalidated dataset
    via_parent: str | None = None  # the upstream parent that propagated staleness here
    propagation: str = "direct"  # "direct" | "propagated"


@runtime_checkable
class MaterializationRegistry(Protocol):
    """The query surface the recall resolver (PR E) and MIRA runtime code against."""

    def register(self, manifest: EvidenceManifest) -> None: ...
    def get(self, dataset_version_id: str, *, tenant_id: str) -> EvidenceManifest | None: ...
    def find(
        self,
        *,
        tenant_id: str,
        dataset_type: DatasetType | None = None,
        dataset_id: str | None = None,
        source_hashes: list[str] | None = None,
        trust_status: TrustStatus | None = None,
        stale_state: StaleState | None = None,
    ) -> list[EvidenceManifest]: ...
    def downstream_of(self, dataset_version_id: str, *, tenant_id: str) -> list[EvidenceManifest]: ...
    def lineage(self, dataset_version_id: str, *, tenant_id: str) -> dict: ...
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
    ) -> StatusOverlay: ...
    def effective_stale_state(self, dataset_version_id: str, *, tenant_id: str) -> StaleState: ...
    def status_overlays(self, dataset_version_id: str, *, tenant_id: str) -> list[StatusOverlay]: ...


class InMemoryRegistry:
    """Reference implementation — hermetic, no I/O. Same protocol a Neon backend
    will implement. Tenant isolation is enforced on every read (PRD §21.1: tenant
    evidence cannot cross tenants)."""

    def __init__(self) -> None:
        self._manifests: dict[str, EvidenceManifest] = {}
        self._overlays: dict[str, list[StatusOverlay]] = {}

    # ── writes ────────────────────────────────────────────────────────────────

    def register(self, manifest: EvidenceManifest) -> None:
        problems = validate_manifest(manifest)
        if problems:
            raise RegistryError(f"invalid manifest: {problems}")
        if not manifest.content_hash or not manifest.manifest_hash:
            raise RegistryError(
                "register a hashed manifest (call materialized_evidence.with_hashes first)"
            )
        existing = self._manifests.get(manifest.dataset_version_id)
        if existing is not None and existing.manifest_hash != manifest.manifest_hash:
            raise RegistryError(
                f"immutable version conflict: {manifest.dataset_version_id} already registered "
                f"with a different manifest_hash (ADR A3 — versions are immutable)"
            )
        self._manifests[manifest.dataset_version_id] = manifest  # idempotent on same hash

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
        """Record a stale transition as an overlay (never mutates the manifest).

        Idempotent per trigger: if this dataset already carries an overlay for the
        same ``trigger``, the existing overlay is returned and no duplicate is
        appended — so repeating the same invalidation adds no semantic change."""
        if self.get(dataset_version_id, tenant_id=tenant_id) is None:
            raise RegistryError(f"unknown or cross-tenant dataset_version_id: {dataset_version_id}")
        if trigger is not None:
            for existing in self._overlays.get(dataset_version_id, []):
                if existing.trigger == trigger:
                    return existing
        overlay = StatusOverlay(
            dataset_version_id=dataset_version_id,
            stale_state=StaleState.STALE,
            stale_reasons=list(reasons),
            at=at,
            trigger=trigger,
            origin_dataset_version_id=origin_dataset_version_id,
            via_parent=via_parent,
            propagation=propagation,
        )
        self._overlays.setdefault(dataset_version_id, []).append(overlay)
        return overlay

    def status_overlays(self, dataset_version_id: str, *, tenant_id: str) -> list[StatusOverlay]:
        """The append-only status-transition history for a dataset version (tenant-
        isolated). Used for provenance inspection and idempotence checks."""
        if self.get(dataset_version_id, tenant_id=tenant_id) is None:
            raise RegistryError(f"unknown or cross-tenant dataset_version_id: {dataset_version_id}")
        return list(self._overlays.get(dataset_version_id, []))

    # ── reads (all tenant-isolated) ─────────────────────────────────────────────

    def get(self, dataset_version_id: str, *, tenant_id: str) -> EvidenceManifest | None:
        m = self._manifests.get(dataset_version_id)
        return m if (m is not None and m.tenant_id == tenant_id) else None

    def effective_stale_state(self, dataset_version_id: str, *, tenant_id: str) -> StaleState:
        m = self.get(dataset_version_id, tenant_id=tenant_id)
        if m is None:
            raise RegistryError(f"unknown or cross-tenant dataset_version_id: {dataset_version_id}")
        overlays = self._overlays.get(dataset_version_id, [])
        return overlays[-1].stale_state if overlays else m.stale_state

    def find(
        self,
        *,
        tenant_id: str,
        dataset_type: DatasetType | None = None,
        dataset_id: str | None = None,
        source_hashes: list[str] | None = None,
        trust_status: TrustStatus | None = None,
        stale_state: StaleState | None = None,
    ) -> list[EvidenceManifest]:
        out: list[EvidenceManifest] = []
        want_sources = set(source_hashes or [])
        for m in self._manifests.values():
            if m.tenant_id != tenant_id:
                continue
            if dataset_type is not None and m.dataset_type != dataset_type:
                continue
            if dataset_id is not None and m.dataset_id != dataset_id:
                continue
            if trust_status is not None and m.trust_status != trust_status:
                continue
            # exact-reuse source match: every requested source hash must be present
            if want_sources and not want_sources.issubset(set(m.source_hashes)):
                continue
            if stale_state is not None and (
                self.effective_stale_state(m.dataset_version_id, tenant_id=tenant_id) != stale_state
            ):
                continue
            out.append(m)
        return out

    def downstream_of(self, dataset_version_id: str, *, tenant_id: str) -> list[EvidenceManifest]:
        """Transitive descendants — every dataset whose lineage (via
        ``parent_dataset_versions``) reaches ``dataset_version_id``. This is the
        set an invalidation engine (PR F) would consider; the registry only reports
        it, it does not decide invalidation."""
        if self.get(dataset_version_id, tenant_id=tenant_id) is None:
            raise RegistryError(f"unknown or cross-tenant dataset_version_id: {dataset_version_id}")
        # build child edges within the tenant
        children: dict[str, list[str]] = {}
        for m in self._manifests.values():
            if m.tenant_id != tenant_id:
                continue
            for parent in m.parent_dataset_versions:
                children.setdefault(parent, []).append(m.dataset_version_id)
        seen: set[str] = set()
        stack = list(children.get(dataset_version_id, []))
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            stack.extend(children.get(node, []))
        return [self._manifests[v] for v in seen if v in self._manifests]

    def lineage(self, dataset_version_id: str, *, tenant_id: str) -> dict:
        m = self.get(dataset_version_id, tenant_id=tenant_id)
        if m is None:
            raise RegistryError(f"unknown or cross-tenant dataset_version_id: {dataset_version_id}")
        direct_children = [
            x.dataset_version_id
            for x in self._manifests.values()
            if x.tenant_id == tenant_id and dataset_version_id in x.parent_dataset_versions
        ]
        return {
            "dataset_version_id": dataset_version_id,
            "parents": list(m.parent_dataset_versions),
            "children": direct_children,
            "workflow_run_ref": m.workflow_run_ref,
            "temporal_workflow_id": m.temporal_workflow_id,
        }

    def cost_summary(self, *, tenant_id: str, dataset_type: DatasetType | None = None) -> dict:
        """Aggregate the economics the manifests carry (PRD §8 'how much did they
        cost', §16). Full recall-savings metrics are PR K; this is the raw roll-up."""
        ms = self.find(tenant_id=tenant_id, dataset_type=dataset_type)
        return {
            "datasets": len(ms),
            "provider_cost_usd": round(sum(m.provider_cost_usd or 0.0 for m in ms), 6),
            "compute_time_ms": sum(m.compute_time_ms or 0 for m in ms),
            "reused_parent_count": sum(m.reused_parent_count for m in ms),
        }
