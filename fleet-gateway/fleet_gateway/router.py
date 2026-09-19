"""Physical-node router: node name → (CAO instance, worktree provisioner).

The bug this closes (#3552): the Gateway had effectively ONE CAO client, so a
``role=charlie`` launch was accepted but physically ran on Bravo. Physical node
is a COMPUTER NAME (bravo / charlie), and it is separate from provider
(claude / codex), agent profile, and session role. This router is the single
place that turns a node name into the concrete Bravo-CAO (127.0.0.1:9889) or
Charlie-CAO (127.0.0.1:19889 over the SSH tunnel) plus that node's own
worktree provisioner.

Fail-closed: a node with no configured target raises — it is NEVER silently
defaulted to Bravo (defaulting to Bravo *is* the #3552 failure mode).
"""

from __future__ import annotations

from dataclasses import dataclass

from fleet_gateway.cao import CAOClient
from fleet_gateway.errors import ContractViolation
from fleet_gateway.worktree import WorktreeProvisioner


@dataclass(frozen=True)
class NodeTarget:
    """Everything node-specific: which CAO instance, which worktree provisioner."""

    node: str
    cao: CAOClient
    worktrees: WorktreeProvisioner


class NodeRouter:
    """Map a physical node name to its CAO + worktree provisioner. Fail-closed."""

    def __init__(self, targets: dict[str, NodeTarget], *, default_node: str = "bravo") -> None:
        self._targets: dict[str, NodeTarget] = {
            k.strip().lower(): v for k, v in targets.items()
        }
        if not self._targets:
            raise ValueError("NodeRouter requires at least one node target")
        self._default = default_node.strip().lower()
        if self._default not in self._targets:
            # The default (node the Gateway physically runs on) must be routable.
            self._default = next(iter(self._targets))

    def target(self, node: str | None) -> NodeTarget:
        """Resolve a node to its target, or fail closed on an unknown node."""
        key = (node or "").strip().lower()
        target = self._targets.get(key)
        if target is None:
            raise ContractViolation(f"unknown physical node: {node!r} (no CAO configured)")
        return target

    def default_target(self) -> NodeTarget:
        """Target for node-less operations (e.g. fleet_status = the local node)."""
        return self._targets[self._default]

    @property
    def nodes(self) -> frozenset[str]:
        return frozenset(self._targets)

    def is_single(self) -> bool:
        """True when every node resolves to the SAME CAO instance (legacy mode).

        In legacy single-CAO construction, node routing is a no-op, so session
        ops can safely skip strict node resolution. In true multi-node mode this
        is False and callers MUST resolve the owning node (never default).
        """
        return len({id(t.cao) for t in self._targets.values()}) == 1

    @classmethod
    def single(cls, cao: CAOClient, worktrees: WorktreeProvisioner) -> NodeRouter:
        """Legacy shim: map every allowed node to one CAO + one provisioner.

        Preserves the pre-router construction (a single ``cao`` + ``worktrees``)
        used by the existing test suite. This does NOT provide physical
        separation — it is only for callers that genuinely have one node.
        """
        return cls(
            {
                "bravo": NodeTarget("bravo", cao, worktrees),
                "charlie": NodeTarget("charlie", cao, worktrees),
            }
        )
