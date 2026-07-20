"""Dependency invalidation (PR F) — propagate staleness through the lineage graph.

Turns the Appendix F invalidation matrix into executable behavior: invalidating a
materialization marks it stale (**direct**) and propagates staleness transitively
to every downstream dependent (**propagated**), using the registry's lineage
(``parent_dataset_versions`` edges — the same relationships ``downstream_of``
exposes).

Hard boundaries:
- Appends only to the registry's mutable overlay (``mark_stale``). It NEVER edits
  or deletes evidence, manifests, content hashes, payloads, or historical versions.
- Never crosses tenant or environment boundaries — even on malformed edges.
- Deterministic, cycle-safe (visited set), idempotent per ``trigger``.
- Executes no recomputation, schedules no jobs, calls no resolver, wires no
  Temporal/runtime. Separation of concerns: this marks staleness; the resolver
  independently returns ``blocked_dependency`` for a stale candidate.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .registry import MaterializationRegistry, StatusOverlay


@dataclass(frozen=True)
class InvalidationResult:
    """What one ``invalidate`` call did — enough to explain each stale transition."""

    trigger: str
    origin_dataset_version_id: str | None  # the directly-invalidated dataset (None if target absent)
    tenant_id: str
    environment: str | None = None
    affected: list[str] = field(default_factory=list)  # all stale-marked, direct + propagated
    newly_stale: list[str] = field(default_factory=list)
    already_stale: list[str] = field(default_factory=list)  # already stale for THIS trigger (idempotent)
    overlays: list[StatusOverlay] = field(default_factory=list)
    note: str = ""


def invalidate(
    registry: MaterializationRegistry,
    dataset_version_id: str,
    *,
    tenant_id: str,
    trigger: str,
    at: str | None = None,
    reason: str | None = None,
) -> InvalidationResult:
    """Mark ``dataset_version_id`` stale and propagate to its downstream dependents.

    Confined to ``tenant_id`` + the target's environment. Cycle-safe, deterministic,
    idempotent per ``trigger``. Returns the affected set and per-node provenance."""
    target = registry.get(dataset_version_id, tenant_id=tenant_id)
    if target is None:
        return InvalidationResult(
            trigger=trigger,
            origin_dataset_version_id=None,
            tenant_id=tenant_id,
            note="target not found or cross-tenant — nothing invalidated",
        )
    env = target.environment
    origin = dataset_version_id
    reason = reason or f"invalidated by trigger {trigger!r}"

    # Build child edges within the tenant + environment. The environment filter IS
    # the environment boundary; the tenant boundary is structural — ``find`` returns
    # only this tenant's manifests, so a foreign-tenant edge is never even seen.
    children: dict[str, list[str]] = {}
    for m in registry.find(tenant_id=tenant_id):
        if m.environment != env:
            continue
        for parent in m.parent_dataset_versions:
            children.setdefault(parent, []).append(m.dataset_version_id)
    for parent in children:
        children[parent] = sorted(set(children[parent]))  # dedup edges + deterministic order

    # BFS from the target, recording the parent each node was first reached through.
    via: dict[str, str | None] = {origin: None}
    order: list[str] = []
    visited: set[str] = set()
    queue: list[str] = [origin]
    while queue:
        node = queue.pop(0)
        if node in visited:
            continue
        visited.add(node)
        order.append(node)
        for child in children.get(node, []):
            if child not in via:
                via[child] = node
            if child not in visited:
                queue.append(child)

    affected: list[str] = []
    newly: list[str] = []
    already: list[str] = []
    overlays: list[StatusOverlay] = []
    for node in order:
        # missing node — handled safely (never crash). Children come from real
        # manifests so this only guards a malformed/removed node.
        if registry.get(node, tenant_id=tenant_id) is None:
            continue
        prior = any(
            o.trigger == trigger for o in registry.status_overlays(node, tenant_id=tenant_id)
        )
        overlay = registry.mark_stale(
            node,
            [reason],
            tenant_id=tenant_id,
            at=at,
            trigger=trigger,
            origin_dataset_version_id=origin,
            via_parent=via.get(node),
            propagation="direct" if node == origin else "propagated",
        )
        affected.append(node)
        overlays.append(overlay)
        (already if prior else newly).append(node)

    return InvalidationResult(
        trigger=trigger,
        origin_dataset_version_id=origin,
        tenant_id=tenant_id,
        environment=env.value,
        affected=affected,
        newly_stale=newly,
        already_stale=already,
        overlays=overlays,
    )
