"""Claim race, lease validity, handoff and scope expansion (START_HERE §3, protocol §2)."""

from __future__ import annotations

from dataclasses import dataclass, replace

from .resource_keys import canonicalize, covers, keys_conflict

HOLDS_LEASE = frozenset({"ACTIVE", "BLOCKED"})
"""States in which the session holds the lease and may edit. BLOCKED = held, waiting on a human
gate or dependency: edits may continue, nothing may be pushed past the gate. LEASE_AT_RISK,
RELEASED and COMPLETE are read-only (law 6)."""


@dataclass(frozen=True)
class Claim:
    mission_id: str
    session_uuid: str
    resource_keys: tuple[str, ...]
    created_at: str
    """Server-stamped creation time of the claim comment (GitHub) — THE ordering key."""
    event_id: int
    """Server-issued comment/event id — the tiebreak when created_at ties."""
    claimed_at: str
    """Self-reported; recorded for the ledger, never consulted by the race."""
    status: str = "ACTIVE"
    generation: int = 1


def resolve_race(contender: Claim, others: list[Claim]) -> Claim | None:
    """The claim that wins `contender`'s race: the earliest-created lease-holding claim among
    `contender` and every other lease-holding claim whose keys OVERLAP the contender's.

    Disjoint claims are not in the same race — two sessions on unrelated keys both win.
    Ordering is (created_at, event_id), both server-issued: a session cannot win by
    back-dating `claimed_at`, and an older comment edited to insert a claim keeps its old
    created_at (the caller excludes comments created before the mission record)."""
    if contender.status not in HOLDS_LEASE:
        return None
    field = [contender] + [
        o
        for o in others
        if o.status in HOLDS_LEASE
        and keys_conflict(list(contender.resource_keys), list(o.resource_keys))
    ]
    return min(field, key=lambda c: (c.created_at, c.event_id))


def may_edit(claim: Claim) -> bool:
    return claim.status in HOLDS_LEASE


def may_push(claim: Claim) -> bool:
    """BLOCKED holds the lease but may not push past the gate it is blocked on."""
    return claim.status == "ACTIVE"


def accept_handoff(claim: Claim, new_session_uuid: str) -> Claim:
    """Transfers the SAME claim to a fresh session: same mission and keys, generation + 1.

    Never a second mission; a claim that no longer holds its lease cannot be handed off."""
    if claim.status not in HOLDS_LEASE:
        raise ValueError(f"cannot hand off a claim in state {claim.status}")
    return replace(claim, session_uuid=new_session_uuid, generation=claim.generation + 1)


def scope_expansion(claim: Claim, wanted: list[str]) -> list[str]:
    """Keys in `wanted` that the claim does not already cover — each needs a NEW claim.

    A claim never widens silently: editing a path outside its keys is the same race as any
    other session's, and the winner is decided by the same server-stamped ordering."""
    held = [canonicalize(k) for k in claim.resource_keys]
    # Coverage is ASYMMETRIC: a held parent covers a wanted child; a held child never covers
    # its parent, even though the two overlap for race purposes.
    return [canonicalize(w) for w in wanted if not any(covers(h, w) for h in held)]
